"""Suggesting new tasks: the point of series (docs/series.md, "Suggesting new tasks").

Detectors read a series' timeline (its tasks, the decisions and facts from their messages, its deliverables):

  follow_through  a decision about it was logged, and no task or sent message has acted on it since
  prep            its next milestone is coming and nothing is getting ready for it
  stall           it's going, nothing moved for stall_days, and someone owes you a reply: a nudge
  at_risk         a deliverable of its is due soon with work still open, or its done-when's milestone is near

"Usual next step" (mined from its own history) waits for evals first.

Each suggestion is a series_next card with its reason: Add it · I'll do it · Not needed. Rate-limited per series
per week and per run, hottest series first (an active deliverable, your focus, recent activity). Your part gates
them: driving gets every kind, helping your parts (prep, stall, at risk), keeping up only what lands on you (a
reply owed to you). Muted, forming, quiet and wrapped series get none. The first suggestion for a series you
haven't met yet comes after the card asking your part.
"""

import json
import re
from datetime import datetime, timedelta

from .. import cards, events, states
from ..db import iso, parse_iso
from . import index as index_mod
from . import record

AUDIENCE = {"follow_through": ("drive",), "prep": ("drive", "contribute"), "stall": ("drive", "contribute", "follow"),
            "at_risk": ("drive", "contribute"), "usual_next": ("drive", "contribute")}
MONTHS = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}


def milestone_date(core, text):
    """The date in "Pilot go-live, Jan 15" or "2026-12-01", as a UTC datetime at day's end; None when there isn't one."""
    t = (text or "").lower()
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return parse_iso(m.group(0))
    m = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b", t)
    if not m:
        return None
    now = core.now()
    try:
        d = datetime(now.year, MONTHS[m.group(1)], int(m.group(2)), 23, 59, tzinfo=now.tzinfo)
    except ValueError:
        return None
    if d < now - timedelta(days=60):   # "Jan 15" said in November is next year's
        d = d.replace(year=now.year + 1)
    return d


def _facts(core, s):
    from ..memory import facts
    return facts.winners(core, s["entity_id"]) if s.get("entity_id") else {}


def role(core, s):
    return _facts(core, s).get("your_role") or "contribute"   # skipping the role card means helping


def detect(core, s, idx):
    """Every suggestion its timeline supports now: [{detector, key, title, why}]."""
    cfg = idx.cfg
    out = []
    members = sorted(idx.members.get(s["id"], ()))
    if not members:
        return out
    rows = {t: idx.tasks[t] for t in members}
    now = core.now()
    # follow_through
    keys = [r["signal_key"] for r in core.all(
        f"SELECT DISTINCT signal_key FROM sources WHERE user_id=? AND signal_key IS NOT NULL AND task_id IN ({','.join('?' * len(members))})",
        (core.user_id, *members))]
    if keys:
        since = iso(now - timedelta(days=cfg["decision_window_days"]))
        settled = iso(now - timedelta(days=cfg["decision_wait_days"]))
        ds = core.all(f"SELECT * FROM decision_log WHERE user_id=? AND status='recorded' AND source_ref IN ({','.join('?' * len(keys))}) "
                      "AND COALESCE(decided_at, captured_at) >= ? AND COALESCE(decided_at, captured_at) <= ? ORDER BY id",
                      (core.user_id, *keys, since, settled))
        ds += core.all("SELECT d.* FROM decision_log d JOIN memory_links l ON l.item_type='decision' AND l.item_id=d.id "
                       "WHERE d.user_id=? AND l.kind='series' AND l.target_id=? AND l.removed=0 AND d.status='recorded' "
                       "AND COALESCE(d.decided_at, d.captured_at) >= ? AND COALESCE(d.decided_at, d.captured_at) <= ?",
                       (core.user_id, s["id"], since, settled))
        for d in {d["id"]: d for d in ds}.values():
            at = d.get("decided_at") or d["captured_at"]
            acted = any((r.get("created_at") or "") > at for r in rows.values()) or core.one(
                f"SELECT 1 x FROM events WHERE user_id=? AND type='task.sent' AND ts > ? AND task_id IN ({','.join('?' * len(members))}) LIMIT 1",
                (core.user_id, at, *members))
            if not acted:
                day = parse_iso(at).strftime("%A")
                out.append({"detector": "follow_through", "key": f"follow_through:decision{d['id']}",
                            "title": f"Follow up on the decision to {d['what'][:1].lower() + d['what'][1:]}"[:120],
                            "why": f"No one has followed up on {day}’s decision to {d['what'][:1].lower() + d['what'][1:]}."[:240]})
    known = _facts(core, s)
    # prep
    ms = known.get("next_milestone")
    when = milestone_date(core, ms) if ms else None
    if when and now <= when <= now + timedelta(days=cfg["prep_days"]):
        recent = iso(now - timedelta(days=cfg["prep_days"]))
        preparing = [r for r in rows.values() if r["state"] in states.LIVE and (r.get("created_at") or "") >= recent]
        if not preparing:
            out.append({"detector": "prep", "key": f"prep:{index_mod.norm(ms)}", "title": f"Get ready for {ms}"[:120],
                        "why": f"{ms} is coming up and nothing in {s['name']} is getting ready for it."})
    # stall
    last = idx.last_moved(s["id"])
    quiet = iso(now - timedelta(days=cfg["stall_days"]))
    if last and last < quiet:
        # its own tasks first, then ones filed elsewhere that also touch it: the reply is owed either way
        touching = [idx.tasks[t] for t in idx.touching(s["id"])]
        for r in list(rows.values()) + touching:
            if r["state"] == "waiting" and r.get("waiting_on"):
                out.append({"detector": "stall", "key": f"stall:task{r['id']}:{last[:10]}",
                            "title": f"Nudge {r['waiting_on']} about “{r['title']}”"[:120],
                            "why": f"Nothing in {s['name']} has moved for {cfg['stall_days']} days, and {r['waiting_on']} owes you a reply."})
                break
    # at_risk: a deliverable of its, due soon, with work open
    soon = now + timedelta(days=cfg["risk_days"])
    dids = {r["deliverable_id"] for r in rows.values() if r.get("deliverable_id")}
    for did in sorted(dids):
        d = core.one("SELECT * FROM deliverables WHERE id=? AND user_id=? AND state='open'", (did, core.user_id))
        due = parse_iso(d["due"]) if d and d.get("due") else None
        if not due or not (now <= due <= soon):
            continue
        left = [r for r in rows.values() if r.get("deliverable_id") == did and r["state"] in states.LIVE]
        if left:
            out.append({"detector": "at_risk", "key": f"at_risk:deliverable{did}:{d['due'][:10]}",
                        "title": f"Finish “{left[0]['title']}” for {d['title']}"[:120],
                        "why": f"{d['title']} is due {due.strftime('%A')} and {len(left)} of its tasks are still open."})
    out += usual_next(core, s, rows, cfg)
    dw = known.get("done_when")
    if dw and when and now <= when <= soon and not out:
        out.append({"detector": "at_risk", "key": f"at_risk:done_when:{index_mod.norm(ms)}",
                    "title": f"Check what’s left before {ms}"[:120],
                    "why": f"{s['name']} is done when {dw[:1].lower() + dw[1:]}, and {ms} is close."})
    return out


_DATEISH = re.compile(r"\b(\d+(st|nd|rd|th)?|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|"
                      r"saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|"
                      r"june|july|august|september|october|november|december|today|tomorrow|this|next|week|weekly|"
                      r"week's|weeks)\b")


def gist(title):
    """A task's title without its dates: "Send Priya the status note, Nov 14" and "… Nov 21" are one step."""
    return " ".join(_DATEISH.sub(" ", index_mod.norm(title)).split())


def usual_next(core, s, rows, cfg):
    """Usual next step, mined from its own history: a step it repeats on a rhythm (the same task, at least
    usual_min times, about the same days apart) that's due again with nothing open for it."""
    by = {}
    for r in rows.values():
        g = gist(r["title"])
        if g and r.get("created_at"):
            by.setdefault(g, []).append(r)
    out = []
    now = core.now()
    for g, rs in by.items():
        if len(rs) < cfg["usual_min"] or any(r["state"] in states.LIVE for r in rs):
            continue
        times = sorted(parse_iso(r["created_at"]) for r in rs)
        gaps = sorted((b - a).total_seconds() / 86400 for a, b in zip(times, times[1:]))
        gap = gaps[len(gaps) // 2]
        if gap < cfg["usual_gap_min_days"] or gaps[-1] > 2 * gap:   # not a rhythm
            continue
        due = times[-1] + timedelta(days=gap)
        if now < due - timedelta(days=1):
            continue
        last = max(rs, key=lambda r: r["created_at"])
        every = "week" if 5 <= gap <= 9 else f"{round(gap)} days"
        out.append({"detector": "usual_next", "key": f"usual_next:{g}:{due.date().isoformat()}", "title": last["title"][:120],
                    "why": f"You’ve done this every {every}, {len(rs)} times now, and this round’s isn’t started."})
    return out


def _heat(core, s, idx, fids):
    members = idx.members.get(s["id"], set())
    h = 0
    if core.one(f"SELECT 1 x FROM deliverables WHERE user_id=? AND state='open' AND tier='active' AND id IN "
                f"(SELECT deliverable_id FROM tasks WHERE series_id=?)", (core.user_id, s["id"])):
        h += 3
    if members & fids:
        h += 2
    last = idx.last_moved(s["id"])
    if last and record.recent(core, last, 2):
        h += 1
    return h


def _said(core):
    out = set()
    for c in core.all("SELECT payload FROM cards WHERE user_id=? AND kind='series_next'", (core.user_id,)):
        out.add((c.get("payload") or {}).get("key"))
    for r in core.all("SELECT note FROM feedback WHERE user_id=? AND kind='series_suggestion'", (core.user_id,)):
        try:
            out.add(json.loads(r["note"]).get("key"))
        except (TypeError, ValueError):
            pass
    return out


def run(core):
    """Run the detectors and raise the cards the limits allow. Returns how many suggestions came out."""
    from .. import focus
    from . import ask
    idx = index_mod.Index(core)
    cfg = idx.cfg
    said = _said(core)
    # lessons from Not needed (learning/learners/series.py): kinds of suggestion you don't want in a series
    quiet = {r["key"] for r in core.all("SELECT key FROM lessons WHERE user_id=? AND surface='series_suggest' AND status='active'",
                                        (core.user_id,))}
    fids = focus.focus_ids(core)
    week = iso(core.now() - timedelta(days=7))
    going = [s for s in idx.series.values() if s["kind"] == "series" and s["state"] in ("inferred", "named") and not s["muted"]]
    going.sort(key=lambda s: (-_heat(core, s, idx, fids), s["id"]))
    n = 0
    for s in going:
        if n >= cfg["suggest_per_run"]:
            break
        made = core.one("SELECT COUNT(*) n FROM cards WHERE user_id=? AND kind='series_next' AND created_at>=? AND "
                        "json_extract(payload,'$.series_id')=?", (core.user_id, week, s["id"]))["n"]
        room = cfg["suggest_per_week"] - made
        if room <= 0:
            continue
        r = role(core, s)
        for sug in detect(core, s, idx):
            if room <= 0 or n >= cfg["suggest_per_run"]:
                break
            if sug["key"] in said or r not in AUDIENCE[sug["detector"]] or f"series:{s['id']}:{sug['detector']}" in quiet:
                continue
            if not s.get("met"):
                ask.role_card(core, s, reason=f"Fuzz has a next step to suggest in it. {sug['why']}")
                s = record.get(core, s["id"])
            with core.tx("system"):
                cards.create(core, "series_next", None, prompt=f"Next in {s['name']}: {sug['title']}", reason=sug["why"],
                             payload=dict(sug, series_id=s["id"], name=s["name"]))
            said.add(sug["key"])
            room -= 1
            n += 1
    return n


def next_for(core, sid):
    """The suggestion shown on its card and sheet: the open one, else what the detectors would say now (not raised)."""
    for c in core.all("SELECT * FROM cards WHERE user_id=? AND kind='series_next' AND status='open' ORDER BY id", (core.user_id,)):
        if (c.get("payload") or {}).get("series_id") == sid:
            p = c["payload"]
            return {"card_id": c["id"], "title": p.get("title"), "why": p.get("why") or c.get("reason"), "detector": p.get("detector")}
    return None


def tick(core):
    """The clock's share: wake series that moved, put quiet ones to rest, and suggest."""
    out = {"woke": record.wake_if_moved(core), "dormant": record.check_dormant(core)}
    if (core.config.get("series") or {}).get("suggest", True):
        out["suggested"] = run(core)
    return out
