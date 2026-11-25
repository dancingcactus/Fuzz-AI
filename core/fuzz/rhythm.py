"""Focus time and Triage time: the rhythm Fuzz keeps on your calendar (docs/book-then-work.md).

You say once when you usually get things done. Fuzz keeps the next two weeks of Focus time and a Triage slot on
your calendar, adds the week that has just come into view each week, and learns from what happens: a block is kept
when you opened it, and productive when you got work done. A change is only ever proposed, as the next week's card.

State is one user_state key (`rhythm`), written through the event log like the calendar report, so it replays and
undoes with everything else:

    best      morning | afternoon | late | varies | None (not answered)
    asked_at  when the question was last asked, and asks how many times it has been
    triage    {"at": "HH:MM", "minutes": 30}: chosen once, kept (a habit beats an optimum)
    slots     [{id, kind: focus | triage, start, end, status, title, link, bucket, minutes?, finished?}]
    proposed_at  when the last weekly proposal was made
    pending   the card id of a proposal waiting for your OK

A slot's status: proposed (a card waits), held (the sender adds it to your calendar), ics (you download it), kept,
missed, skipped.
"""

import json
import math
from datetime import datetime, time, timedelta

from . import booking, cards, events, timeres
from .db import FuzzError, iso, parse_iso

KEY = "rhythm"
KINDS = ("rhythm_best", "rhythm_plan")
ANSWERS = ("morning", "afternoon", "late", "varies")
WINDOWS = {"morning": (9.0, 12.0), "afternoon": (13.0, 16.0), "late": (15.0, 17.5)}   # local hours where you do your best work
HOLDER_TAG = "rhythm_holder"
HOLDER_TITLE = "Calendar holds from Fuzz"
LIVE_STATUS = ("proposed", "held", "ics")
SETTLED = ("kept", "missed")
KEEP_DAYS = 60          # how long finished slots are remembered
ASK_AGAIN_DAYS = 7      # a Not now comes back once, a week later
SUSTAINED = 4           # a part of the day is judged on its last four blocks
BEFORE = timedelta(minutes=10)   # opening a block a few minutes early still counts


def _cfg(core):
    r = core.config.get("rhythm") or {}
    return {"weeks_ahead": int(r.get("weeks_ahead", 2)), "focus_per_week": int(r.get("focus_per_week", 3)),
            "focus_minutes": int(r.get("focus_minutes", 90)), "triage_minutes": int(r.get("triage_minutes", 30))}


# ---------------------------------------------------------------- state

def load(core):
    row = core.one("SELECT value FROM user_state WHERE user_id=? AND key=?", (core.user_id, KEY))
    try:
        st = json.loads((row or {}).get("value") or "{}")
    except (TypeError, ValueError):
        st = {}
    st.setdefault("best", None)
    st.setdefault("asked", 0)
    st.setdefault("asked_at", None)
    st.setdefault("triage", None)
    st.setdefault("slots", [])
    st.setdefault("proposed_at", None)
    st.setdefault("pending", None)
    st.setdefault("notice", None)
    return st


def _save(ch, st):
    ch.state(KEY, json.dumps(st))


def view(core):
    """What the UI and Settings show: your answer, the Triage time, and what is coming up."""
    st, now = load(core), core.now()
    up = [s for s in st["slots"] if s["status"] in LIVE_STATUS and parse_iso(s["end"]) > now]
    return {"best": st["best"], "triage": st["triage"], "upcoming": sorted(up, key=lambda s: s["start"]),
            "learned": effective_best(core, st), "pending": st["pending"], "notice": st["notice"]}


# ---------------------------------------------------------------- the day, in your hours

def _tz(core):
    return timeres.local_tz(core)


def _hours(core):
    """Your working hours (the onboarding's hours card): (from, until, weekends). Around the clock: 9 to 17."""
    ex = core.config.get("extract") or {}
    h = ex.get("hours")
    if not h:
        return 9.0, 17.0, True
    return float(h[0]), float(h[1]), bool(ex.get("weekends"))


def _at(day, hour, tz):
    return datetime.combine(day, time(int(hour), int(round((hour % 1) * 60))), tzinfo=tz)


def _ceil30(dt):
    mins = dt.minute + dt.second / 60
    add = (30 - mins % 30) % 30
    return (dt + timedelta(minutes=add)).replace(second=0, microsecond=0)


def _bucket(dt, tz):
    h = dt.astimezone(tz).hour
    return "morning" if h < 12 else "afternoon" if h < 15 else "late"


def _free(core, a, b, tz):
    """Free time between a and b as [(start, end, title)]: what the executor last reported from your calendar, else your
    working hours. Fuzz's own blocks and holds come out in _gaps."""
    cal = booking.calendar(core)
    out = []
    if cal is not None:
        for s in cal.get("slots") or []:
            x, y = max(parse_iso(s["start"]), a), min(parse_iso(s["end"]), b)
            if y > x:
                out.append((x, y, s.get("title")))
        return out
    h0, h1, weekends = _hours(core)
    day = a.astimezone(tz).date()
    while _at(day, 0, tz) < b:
        if weekends or day.weekday() < 5:
            x, y = max(_at(day, h0, tz), a), min(_at(day, min(h1, 23.99), tz), b)
            if y > x:
                out.append((x, y, None))
        day += timedelta(days=1)
    return out


def _taken(core, st):
    out = list(booking.own_blocks(core))
    for s in st["slots"]:
        if s["status"] in LIVE_STATUS:
            out.append((parse_iso(s["start"]), parse_iso(s["end"])))
    return sorted(out)


def _link(core, kind, end, tz, start=None):
    base = (booking._bcfg(core).get("ui_url") or "http://127.0.0.1:8765/").rstrip("/")
    until = end.astimezone(tz).strftime("%H:%M")
    frm = f"&from={start.astimezone(tz).strftime('%H:%M')}" if start is not None else ""
    return f"{base}/#/{'triage' if kind == 'triage' else 'work'}?until={until}{frm}"


def _slot(core, kind, start, end, tz, title=None):
    return {"id": f"{kind}-{start.astimezone(tz).strftime('%Y%m%dT%H%M')}", "kind": kind, "start": iso(start), "end": iso(end),
            "status": "proposed", "title": title or ("Triage time" if kind == "triage" else "Focus time"),
            "link": _link(core, kind, end, tz, start), "bucket": _bucket(start, tz)}


# ---------------------------------------------------------------- learning

def _history(st, bucket):
    """A part of the day's recent blocks, newest last: [(status, minutes)]. Triage doesn't count: it is a habit."""
    rows = [s for s in st["slots"] if s["kind"] == "focus" and s.get("bucket") == bucket and s["status"] in SETTLED]
    return [(s["status"], s.get("minutes") or 0) for s in sorted(rows, key=lambda s: s["start"])][-SUSTAINED:]


def effective_best(core, st=None):
    """The part of the day the next proposals aim at: what you said, unless the last few blocks there were mostly missed
    and another part of the day did better. Never silent: the weekly card says when it changes (see `_why`)."""
    st = st or load(core)
    best = st["best"]
    if best in (None, "varies"):
        return best
    here = _history(st, best)
    if len(here) >= SUSTAINED and sum(1 for x, _ in here if x == "missed") >= SUSTAINED - 1:
        scored = []
        for b in ANSWERS[:3]:
            if b == best:
                continue
            h = _history(st, b)
            if h and sum(1 for x, _ in h if x == "kept") >= 2:
                scored.append((sum(1 for x, _ in h if x == "kept") / len(h), b))
        if scored:
            return max(scored)[1]
    return best


def _why(core, st):
    eff = effective_best(core, st)
    if st["best"] in ANSWERS and eff != st["best"]:
        names = {"morning": "Mornings", "afternoon": "Afternoons", "late": "Late afternoons"}
        return f"{names[st['best']]} have been hard to get to, so this time I aimed at {names[eff].lower()}."
    return None


def evaluate(core):
    """Settle the blocks that ended: kept when a human action moved work into the session (or, for Triage time, any action)
    inside the block, else missed. Each block once. Returns how many were settled."""
    st, now = load(core), core.now()
    n = 0
    for s in st["slots"]:
        if s["status"] not in ("held", "ics") or parse_iso(s["end"]) > now:
            continue
        a, b = parse_iso(s["start"]) - BEFORE, parse_iso(s["end"])
        if s["kind"] == "focus":
            kept = core.one("SELECT 1 x FROM events WHERE user_id=? AND actor='human' AND ts>=? AND ts<=? "
                            "AND type IN ('task.assigned', 'task.captured') AND payload LIKE '%deepwork%'", (core.user_id, iso(a), iso(b)))
        else:
            kept = core.one("SELECT 1 x FROM events WHERE user_id=? AND actor='human' AND ts>=? AND ts<=? "
                            "AND type LIKE 'card.%'", (core.user_id, iso(a), iso(b))) or core.one(
                "SELECT 1 x FROM events WHERE user_id=? AND actor='human' AND ts>=? AND ts<=? AND type LIKE 'task.%'",
                (core.user_id, iso(a), iso(b)))
        s["status"] = "kept" if (kept or s.get("minutes")) else "missed"
        n += 1
    cutoff = iso(now - timedelta(days=KEEP_DAYS))
    kept_slots = [s for s in st["slots"] if s["end"] >= cutoff]
    if n or len(kept_slots) != len(st["slots"]):
        st["slots"] = kept_slots
        with core.tx("system"):
            ch = events.Changes()
            _save(ch, st)
            events.emit(core, "rhythm.evaluated", changes=ch, data={"settled": n})
    return n


def outcome(core, minutes, finished=False):
    """The Focus time wrap-up says how it went: minutes worked, and whether something was finished. It lands on the
    block you are in (or the one that just ended), which is how a block's time is judged 'productive'."""
    try:
        minutes = max(0, int(minutes))
    except (TypeError, ValueError):
        raise FuzzError("minutes is how long you worked, a whole number", "minutes")
    st, now = load(core), core.now()
    hit = None
    for s in st["slots"]:
        if s["kind"] == "focus" and parse_iso(s["start"]) - BEFORE <= now <= parse_iso(s["end"]) + timedelta(minutes=30) \
                and s["status"] in ("held", "ics", "kept", "missed"):
            hit = s
    if hit is None:
        return {"slot": None}
    hit["minutes"] = (hit.get("minutes") or 0) + minutes
    hit["finished"] = bool(hit.get("finished") or finished)
    if hit["status"] == "missed" and hit["minutes"] > 0:
        hit["status"] = "kept"   # a late wrap-up: you were there
    with core.tx("human"):
        ch = events.Changes()
        _save(ch, st)
        events.emit(core, "rhythm.outcome", changes=ch, data={"slot": hit["id"], "minutes": minutes, "finished": bool(finished)})
    return {"slot": hit["id"], "minutes": hit["minutes"]}


# ---------------------------------------------------------------- the planner

def _working_days(core, now, tz, weeks):
    h0, h1, weekends = _hours(core)
    day = now.astimezone(tz).date()
    for i in range(weeks * 7):
        d = day + timedelta(days=i)
        if weekends or d.weekday() < 5:
            yield d


def pick_triage_time(core, st, now):
    """The Triage time, chosen once: a half hour that is free on the most coming days and outside your best hours."""
    tz, c = _tz(core), _cfg(core)
    h0, h1, _ = _hours(core)
    best = st["best"]
    window = WINDOWS.get(best) if best in WINDOWS else None
    free = _free(core, now, now + timedelta(days=14), tz)
    taken = _taken(core, st)
    days = list(_working_days(core, now, tz, 2))[:10]
    scored = []
    t = h0
    while t + c["triage_minutes"] / 60 <= h1 + 1e-9:
        if not (window and t < window[1] and t + c["triage_minutes"] / 60 > window[0]):
            n = 0
            for d in days:
                a, b = _at(d, t, tz), _at(d, t, tz) + timedelta(minutes=c["triage_minutes"])
                if a < now:
                    continue
                for x, y, _ in free:
                    if any(g0 <= a and b <= g1 for g0, g1 in booking._gaps(x, y, taken)):
                        n += 1
                        break
            scored.append((-n, t))
        t += 0.5
    if not scored:
        return {"at": "%02d:%02d" % (int(h0), int(round((h0 % 1) * 60))), "minutes": c["triage_minutes"]}
    _, t = min(scored)
    return {"at": "%02d:%02d" % (int(t), int(round((t % 1) * 60))), "minutes": c["triage_minutes"]}


def plan(core, st=None, now=None):
    """The slots to add so that two weeks stay scheduled. Pure over the state, the calendar report and the clock:
    {"slots": [...], "skipped": [dates a Triage slot had no room], "triage": {at, minutes}}."""
    st = st or load(core)
    now = now or core.now()
    tz, c = _tz(core), _cfg(core)
    h0, h1, weekends = _hours(core)
    end = now + timedelta(days=7 * c["weeks_ahead"])
    triage = st["triage"] or pick_triage_time(core, st, now)
    taken = _taken(core, st)
    free = _free(core, now, end, tz)
    out, skipped = [], []
    have = {(s["kind"], s["id"]) for s in st["slots"]}

    def gaps(a, b):
        res = []
        for x, y, title in free:
            lo, hi = max(x, a), min(y, b)
            if hi > lo:
                res += [(g0, g1, title) for g0, g1 in booking._gaps(lo, hi, sorted(taken))]
        return res

    # Triage time: the same time every working day, skipped (and said once) when the day has no room
    hh, mm = (int(x) for x in triage["at"].split(":"))
    for d in _working_days(core, now, tz, c["weeks_ahead"]):
        a = datetime.combine(d, time(hh, mm), tzinfo=tz)
        b = a + timedelta(minutes=triage["minutes"])
        if a < now or ("triage", f"triage-{a.strftime('%Y%m%dT%H%M')}") in have:
            continue
        if any(g0 <= a and b <= g1 for g0, g1, _t in gaps(a, b)):
            s = _slot(core, "triage", a, b, tz)
            out.append(s)
            taken.append((a, b))
            taken.sort()
        else:
            skipped.append(d.isoformat())

    # Focus time: up to focus_per_week a week, on different days, in your best hours (a Focus time slot of your own first)
    best = effective_best(core, st)
    window = WINDOWS.get(best) if best in WINDOWS else (h0, h1)
    today = now.astimezone(tz).date()
    weeks = {}
    for d in _working_days(core, now, tz, c["weeks_ahead"]):
        weeks.setdefault((d - today).days // 7, []).append(d)   # a week is seven days from today, so two weeks stay scheduled
    for wk, days in sorted(weeks.items()):
        def in_week(s):
            return (datetime.fromisoformat(s["start"]).astimezone(tz).date() - today).days // 7 == wk
        mine = [s for s in st["slots"] + out if s["kind"] == "focus" and s["status"] not in ("skipped",) and in_week(s)]
        need = c["focus_per_week"] - len(mine)
        used = {datetime.fromisoformat(s["start"]).astimezone(tz).date() for s in mine}
        cand = []
        for d in days:
            if d in used:
                continue
            best_of_day = []
            for g0, g1, title in gaps(max(_at(d, window[0], tz), now), _at(d, window[1], tz)):
                start = _ceil30(g0)
                stop = start + timedelta(minutes=c["focus_minutes"])
                if stop <= g1 and stop <= _at(d, min(window[1], 23.99), tz) + timedelta(minutes=1):
                    best_of_day.append((0 if booking.is_focus(core, title) else 1, start, stop))
            if best_of_day:
                f, start, stop = min(best_of_day)
                cand.append((f, d, start, stop))
        for _, d, start, stop in sorted(cand, key=lambda x: (x[0], x[1]))[:max(0, need)]:
            out.append(_slot(core, "focus", start, stop, tz))
            taken.append((start, stop))
    known = {x["id"] for x in st["slots"]}   # a slot you skipped, or already have, is never proposed again
    out = [x for x in out if x["id"] not in known]
    return {"slots": sorted(out, key=lambda s: s["start"]), "skipped": skipped, "triage": triage}


def _lines(core, slots):
    tz = _tz(core)
    out = []
    for s in slots:
        a, b = parse_iso(s["start"]).astimezone(tz), parse_iso(s["end"]).astimezone(tz)
        out.append(f"{a.strftime('%a %-d %b')} {a.strftime('%-H:%M')}–{b.strftime('%-H:%M')}: {s['title']}")
    return out


# ---------------------------------------------------------------- proposing, applying

def _via(core):
    return "calendar" if booking.can_hold(core) else "file"


def _auto(core, st):
    """A top-up may happen without a card when you always allow your own calendar and you already said yes to a plan.
    The first plan always asks: Book time's grant covers one task's hold, not weeks of events nobody has seen."""
    from . import drafts
    said_yes = any(s["status"] in ("held", "ics", "kept", "missed") for s in st["slots"])
    return said_yes and booking.can_hold(core) and drafts.has_grant(core, "calendar", "own")


def propose(core, now=None):
    """Keep two weeks scheduled: once a week (or when nothing is ahead), add what's missing. With Always allow for your own
    calendar it just happens; otherwise one card asks. Safe to call every minute. Returns what it did."""
    st, now = load(core), now or core.now()
    if st["best"] is None:   # the question comes first
        return None
    if st["pending"] and cards.get(core, st["pending"]) and cards.get(core, st["pending"])["status"] == "open":
        return None
    if st["proposed_at"] and now - parse_iso(st["proposed_at"]) < timedelta(days=6):
        return None   # once a week, and a Skip holds until the next one
    new = plan(core, st, now)
    if not new["slots"]:
        return None
    if new["triage"] and not st["triage"]:
        st["triage"] = new["triage"]
    why = _why(core, st)
    st["proposed_at"] = iso(now)
    if _auto(core, st):
        names = {s["kind"] for s in new["slots"]}
        st["notice"] = {"text": "I added the next week of " + " and ".join(sorted(
            {"focus": "Focus time", "triage": "Triage time"}[k] for k in names)) + " to your calendar.", "seen": False}
        _apply(core, st, new["slots"], "calendar")
        return {"applied": len(new["slots"]), "card": None}
    via = _via(core)
    payload = {"slots": new["slots"], "via": via, "lines": _lines(core, new["slots"]), "skipped": new["skipped"],
               "triage": st["triage"]}
    reason = (why + " " if why else "") + ("Fuzz adds these to your calendar once you say yes." if via == "calendar"
                                           else "No calendar tool is set up, so this is a calendar file to download.")
    with core.tx("system"):
        for s in new["slots"]:
            s["status"] = "proposed"
        st["slots"] = st["slots"] + new["slots"]
        cid = cards.create(core, "rhythm_plan", None, prompt="Keep your Focus time and Triage time on your calendar?",
                           reason=reason, payload=payload)
        st["pending"] = cid
        ch = events.Changes()
        _save(ch, st)
        events.emit(core, "rhythm.planned", changes=ch, data={"slots": len(new["slots"]), "card": cid, "via": via})
    return {"applied": 0, "card": cid}


def _holder(core, ch):
    """The task that owns the holds. It is nothing you see: merged away, so no list, queue or match shows it."""
    row = core.one("SELECT id FROM tasks WHERE user_id=? AND variant_tags LIKE ?", (core.user_id, f'%"{HOLDER_TAG}"%'))
    if row:
        return row["id"]
    tid = core.new_id("tasks")
    now = core.now_iso()
    ch.task(tid, state="merged", assignee=None, title=HOLDER_TITLE, owner="me", order_key=0, variant_tags=[HOLDER_TAG],
            created_at=now, state_changed_at=now, title_history=[], steps_used=0, attempts=0, deadline_level=0)
    events.emit(core, "task.captured", task_id=tid, changes=ch, data={"holder": True})
    return tid


def _apply(core, st, slots, via, by="grant"):
    """Make the slots real: for the sender (one hold each, owned by the holder task), or to download. Its own transaction."""
    status = "held" if via == "calendar" else "ics"
    with core.tx("human" if by == "human" else "system"):
        ch = events.Changes()
        holder = _holder(core, ch) if via == "calendar" else None
        ids = {x["id"] for x in slots}
        for x in slots:
            x["status"] = status
        st["slots"] = [x for x in st["slots"] if x["id"] not in ids] + slots
        if holder is not None:
            for x in slots:
                did = core.new_id("drafts")
                dch = events.Changes()
                dch.draft(did, task_id=holder, kind="calendar_hold", target="Your calendar",
                          body=f"{x['link']}\n{x['title']}, from Fuzz.", status="approved", created_at=core.now_iso(), final=1,
                          meta={"title": x["title"], "start": x["start"], "end": x["end"], "rhythm": x["id"]},
                          approved_by=by, approved_at=core.now_iso())
                events.emit(core, "task.draft_ready", task_id=holder, changes=dch,
                            data={"draft_id": did, "kind": "calendar_hold", "rhythm": True})
        st["pending"] = None
        ch2 = events.Changes()
        _save(ch2, st)
        events.emit(core, "rhythm.applied", changes=ch2, data={"slots": len(slots), "via": via})


def answer_plan(core, card, t, option, value):
    """The weekly card: Put them on my calendar (approve), Always allow for my calendar, or Skip."""
    st = load(core)
    wanted = {x["id"] for x in (card.get("payload") or {}).get("slots", [])}
    mine = [x for x in st["slots"] if x["id"] in wanted]
    with core.tx("human"):
        ch = events.Changes()
        cards.mark_answered(core, ch, card, option)
        if option == "always_allow":
            ch.grant(core.new_id("grants"), scope="calendar", resource="own", kind="always", task_id=None)
        if option == "skip":
            for x in mine:
                x["status"] = "skipped"
            st["pending"] = None
            _save(ch, st)
        events.emit(core, "card.answered", changes=ch, data={"kind": "rhythm_plan", "option": option})
    if option != "skip":
        _apply(core, load(core), [x for x in load(core)["slots"] if x["id"] in wanted],
               (card.get("payload") or {}).get("via") or _via(core), by="human")


def mark_downloaded(core):
    """The calendar file went out: nothing to wait for. (The slots stay `ics` until they are kept or missed.)"""
    return {"ok": True}


# ---------------------------------------------------------------- asking when you work best

def ask(core, now=None):
    """The one question, after the first calendar read (so Fuzz can show real slots right away): When do you usually get
    things done? A Not now comes back once, a week later."""
    from . import onboarding
    st, now = load(core), now or core.now()
    if st["best"] is not None or st["asked"] >= 2:
        return None
    ob = onboarding.load(core)
    if not ob.get("done"):
        return None
    if booking.calendar(core) is None and not (ob.get("finished_at") and now - parse_iso(ob["finished_at"]) >= timedelta(days=3)):
        return None   # after the first calendar read; or a few days on, if it never comes (Fuzz then plans in your working hours)
    if st["asked_at"] and now - parse_iso(st["asked_at"]) < timedelta(days=ASK_AGAIN_DAYS):
        return None
    if core.one("SELECT 1 x FROM cards WHERE user_id=? AND kind='rhythm_best' AND status='open'", (core.user_id,)):
        return None
    with core.tx("system"):
        cid = cards.create(core, "rhythm_best", None, prompt="When do you usually get things done?",
                           reason="I’ll find open time on your calendar then, and learn what works. It’s a first guess; I’ll adjust.")
        st["asked"] += 1
        st["asked_at"] = iso(now)
        ch = events.Changes()
        _save(ch, st)
        events.emit(core, "rhythm.asked", changes=ch, data={"card": cid})
    return cid


def answer_best(core, card, t, option, value):
    st = load(core)
    with core.tx("human"):
        ch = events.Changes()
        cards.mark_answered(core, ch, card, option)
        if option in ANSWERS:
            st["best"] = option
            _save(ch, st)
        events.emit(core, "rhythm.best_set" if option in ANSWERS else "card.answered", changes=ch,
                    data={"kind": "rhythm_best", "option": option})
    if option in ANSWERS:
        propose(core)


def see(core):
    """The Guide said the one line about an automatic top-up: it isn't said again."""
    st = load(core)
    if st.get("notice") and not st["notice"].get("seen"):
        st["notice"]["seen"] = True
        with core.tx("human"):
            ch = events.Changes()
            _save(ch, st)
            events.emit(core, "rhythm.applied", changes=ch, data={"seen": True})
    return {"ok": True}


def set_best(core, answer):
    """Settings can say it too, without the card."""
    if answer not in ANSWERS:
        raise FuzzError(f"answer must be one of {', '.join(ANSWERS)}", "answer")
    st = load(core)
    st["best"] = answer
    with core.tx("human"):
        ch = events.Changes()
        _save(ch, st)
        events.emit(core, "rhythm.best_set", changes=ch, data={"option": answer})
    return view(core)


def tick(core):
    """Run by the clock (scheduler.tick): settle blocks that ended, ask the one question, keep two weeks scheduled."""
    out = {"settled": evaluate(core), "asked": None, "proposed": None}
    out["asked"] = ask(core)
    out["proposed"] = propose(core)
    return out
