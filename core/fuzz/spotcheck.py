"""Spot checks: Fuzz checks its own work on a few things a week (docs/evals.md).

Two cards, neither about a task in your queue:
  - "Was there anything for you here?" on a message extraction read and found nothing for you in. This is the
    only way to estimate how often extraction misses an ask that isn't skewed toward the misses you'd notice
    anyway. Weighted toward direct messages, with some purely random. Nothing makes a skip case (a solved case
    that must stay solved); There was makes a keep case and a task for the ask. Both wait for the executor to
    fetch the message's text, as Not a task's cases do.
  - "How did Fuzz do on this?" on a task the executor worked on lately: right, or what was off (gathered the
    wrong context, gave up too early, guessed when it should have asked, asked when the answer was there, the
    brief is wrong). The answers are labels for the executor's evals: each one off is turned into an invented
    global case by hand (`fuzz eval spots`).

A few a week at most (config evals.spot_checks_per_week, evals.run_checks_per_week; 0 turns one off), one open
of each kind at a time. Undo takes the label back.
"""

import json
import random
from datetime import timedelta

from . import cards, evals, events, tasks
from .db import FuzzError, iso

KINDS = ("spot_message", "spot_run")
PER_WEEK = {"spot_message": 3, "spot_run": 2}
CONFIG_KEY = {"spot_message": "spot_checks_per_week", "spot_run": "run_checks_per_week"}
LOOK_BACK = timedelta(days=14)   # messages and runs this recent: you can still remember them
DIRECT_SHARE = 2 / 3             # how often the pick comes from direct messages, when there are any
OFF = {"context": "Gathered the wrong context", "gave_up": "Handed back too early",
       "guessed": "Guessed when it should have asked", "asked": "Asked when the answer was there",
       "brief": "The brief is wrong"}
WORKED = ("task.handed_back", "task.gathered", "task.draft_ready", "permission.asked")
SOURCE_LABEL = {"email": "an email", "slack": "Slack", "meeting": "a meeting summary"}


def _cfg(core, kind):
    v = (core.config.get("evals") or {}).get(CONFIG_KEY[kind])
    return PER_WEEK[kind] if v is None else int(v)


def _room(core, kind):
    """Whether another card of this kind may be raised now."""
    if _cfg(core, kind) <= 0:
        return False
    if core.one("SELECT 1 FROM cards WHERE user_id=? AND kind=? AND status='open'", (core.user_id, kind)):
        return False
    week = iso(core.now() - timedelta(days=7))
    n = core.one("SELECT COUNT(*) n FROM cards WHERE user_id=? AND kind=? AND created_at>?",
                 (core.user_id, kind, week))["n"]
    return n < _cfg(core, kind)


def _rng(core, kind):
    return random.Random(f"{core.user_id}:{kind}:{core.now().date().isoformat()}")


# ---- messages extraction found nothing in

def _direct(p, me, anchor=None):
    """A DM (a Slack channel id starting with D), or an email to the person alone."""
    if (anchor or "").startswith("slack:D") or (p.get("channel") or "").lower().startswith(("dm", "direct")):
        return True
    people = [x for x in (p.get("people") or []) if isinstance(x, dict)]
    mine = {e.lower() for e in me.get("emails") or []}
    others = [x for x in people if (x.get("email") or "").lower() not in mine]
    return p.get("source") == "email" and bool(people) and not others


def skipped(core):
    """Recent messages extraction read and made no ask of the person's from, not checked or cased before."""
    since = iso(core.now() - LOOK_BACK)
    rows = core.all(
        "SELECT s.key, s.source, s.anchor, s.link, s.ts, s.payload FROM signals s WHERE s.user_id=? AND s.ts>=? "
        "AND s.source IN ('email', 'slack', 'meeting') "
        "AND NOT EXISTS (SELECT 1 FROM candidates c WHERE c.user_id=s.user_id AND c.signal_key=s.key "
        "                AND c.kind='ask' AND COALESCE(c.owner, 'me')='me') "
        "AND NOT EXISTS (SELECT 1 FROM eval_cases e WHERE e.user_id=s.user_id AND e.signal_key=s.key) "
        "AND NOT EXISTS (SELECT 1 FROM cards k WHERE k.user_id=s.user_id AND k.kind='spot_message' "
        "                AND json_extract(k.payload, '$.signal_key')=s.key) ORDER BY s.ts", (core.user_id, since))
    for r in rows:
        r["payload"] = json.loads(r["payload"]) if isinstance(r["payload"], str) else (r["payload"] or {})
    return rows


def pick_message(core):
    pool = skipped(core)
    if not pool:
        return None
    me = core.config.get("me") or {}
    direct = [r for r in pool if _direct(dict(r["payload"], source=r["source"]), me, r["anchor"])]
    rng = _rng(core, "spot_message")
    if direct and rng.random() < DIRECT_SHARE:
        return rng.choice(direct), "a direct message"
    return rng.choice(pool), "picked at random"


def _who(f):
    return (f.get("name") or f.get("email")) if isinstance(f, dict) else None


def raise_message(core, actor="system"):
    if not _room(core, "spot_message"):
        return None
    got = pick_message(core)
    if not got:
        return None
    s, why = got
    p = s["payload"]
    payload = {"signal_key": s["key"], "source": s["source"], "from": _who(p.get("from")),
               "title": p.get("title") or p.get("channel"), "quote": (p.get("quote") or "")[:300],
               "link": s["link"], "ts": s["ts"], "why": why}
    where = SOURCE_LABEL.get(s["source"], "a message") + (f" from {payload['from']}" if payload["from"] else "")
    with core.tx(actor):
        return cards.create(core, "spot_message", payload=payload,
                            reason=f"I read {where} ({why}) and found nothing for you in it. Checking myself: "
                                   "was there?")


# ---- tasks the executor worked on

def worked(core):
    """Tasks the executor did something you can judge on lately: handed back, gathered, drafted, asked."""
    since = iso(core.now() - LOOK_BACK)
    marks = ",".join("?" * len(WORKED))
    return core.all(
        f"SELECT e.task_id, MAX(e.id) event_id, e.type FROM events e JOIN tasks t ON t.id=e.task_id "
        f"WHERE e.user_id=? AND e.ts>=? AND e.actor='fuzz:executor' AND e.type IN ({marks}) "
        "AND NOT EXISTS (SELECT 1 FROM cards k WHERE k.user_id=e.user_id AND k.kind='spot_run' "
        "                AND json_extract(k.payload, '$.task_id')=e.task_id) "
        "GROUP BY e.task_id ORDER BY e.task_id", (core.user_id, since, *WORKED))


WHAT = {"task.handed_back": "handed it back to you", "task.gathered": "gathered context for it",
        "task.draft_ready": "drafted something for it", "permission.asked": "asked for permission"}


def raise_run(core, actor="system"):
    if not _room(core, "spot_run"):
        return None
    pool = worked(core)
    if not pool:
        return None
    w = _rng(core, "spot_run").choice(pool)
    t = tasks.get(core, w["task_id"])
    if not t:
        return None
    steps = [r["text"] for r in core.all(
        "SELECT json_extract(payload, '$.log.text') text FROM events WHERE user_id=? AND task_id=? "
        "AND actor='fuzz:executor' AND type='task.step' ORDER BY id DESC LIMIT 5", (core.user_id, t["id"]))
        if r["text"]]
    payload = {"task_id": t["id"], "title": t["title"], "did": WHAT.get(w["type"], "worked on it"),
               "event_id": w["event_id"], "summary": (t.get("summary") or "")[:400],
               "steps": list(reversed(steps)), "off": OFF}
    with core.tx(actor):
        return cards.create(core, "spot_run", payload=payload,
                            reason=f"I worked on “{t['title']}” and {payload['did']}. Checking myself: was that right?")


def raise_cards(core, actor="system"):
    """The scheduler's tick: at most one new card of each kind, within the week's few."""
    return [c for c in (raise_message(core, actor), raise_run(core, actor)) if c]


# ---- your answers

def _feedback(core, kind, a, note):
    return core.q("INSERT INTO feedback (user_id, ts, kind, a, note) VALUES (?,?,?,?,?)",
                  (core.user_id, core.now_iso(), kind, a, note)).lastrowid


def answer(core, card, option, value):
    p = card.get("payload") or {}
    ch = events.Changes()
    data = {"card_id": card["id"], "kind": card["kind"], "option": option}
    if card["kind"] == "spot_message":
        data.update(_answer_message(core, card, p, option, value))
    elif card["kind"] == "spot_run":
        data.update(_answer_run(core, p, option, value))
    else:
        raise FuzzError(f"not a spot check: {card['kind']}", "kind")
    cards.mark_answered(core, ch, card, option, value)
    events.emit(core, "eval.spot_checked", task_id=data.get("task_id"), changes=ch, data=data)


def _signal(core, key):
    s = core.one("SELECT key, source, payload FROM signals WHERE user_id=? AND key=?", (core.user_id, key))
    if not s:
        raise FuzzError("Fuzz no longer has a record of that message", "card_id", 409)
    p = json.loads(s["payload"]) if isinstance(s["payload"], str) else s["payload"]
    msg = {k: p[k] for k in evals.MESSAGE_FIELDS if p.get(k) is not None}
    msg.setdefault("source", s["source"])
    return msg


def _answer_message(core, card, p, option, value):
    if option not in ("nothing", "had_ask"):
        raise FuzzError("option is nothing or had_ask", "option")
    msg = _signal(core, p.get("signal_key"))
    fid = _feedback(core, "spot_check", None, option)
    if option == "nothing":
        # extraction was right: a solved case that must stay solved. origin spot: so no lesson is made of it
        origin = f"spot:{fid}"
        evals.add_case(core, "extract", "skip", msg, {"has_my_ask": False, "strict": True}, origin, status="pending",
                       signal_key=p["signal_key"], quote=p.get("quote"),
                       note="Spot check: you said it held nothing for you")
        return {"feedback_id": fid, "case_origin": origin}
    said = value.strip() if isinstance(value, str) and value.strip() else None
    ask = said or f"Follow up on {p.get('from') or 'the'} message" + (f": {p['title']}" if p.get("title") else "")
    origin = f"feedback:{fid}"   # a miss: the examples learner makes a keep lesson of it once its text is in
    evals.add_case(core, "extract", "keep", msg, {"has_my_ask": True, "ask": ask[:300]}, origin, status="pending",
                   signal_key=p["signal_key"], quote=p.get("quote"),
                   note="Fuzz missed this: a spot check found it (extraction read it and saw no ask)")
    return {"feedback_id": fid, "case_origin": origin, "task_id": _capture(core, ask, p)}


def _capture(core, ask, p):
    got = tasks.capture(core, ask)
    tid = got["id"] if isinstance(got, dict) else got
    if p.get("link") and tasks.LINK_RE.match(p["link"]):
        tasks._link_source(core, tid, p.get("title") or "The message", p["link"], None)
    return tid


def _answer_run(core, p, option, value):
    if option not in ("right", "off"):
        raise FuzzError("option is right or off", "option")
    v = value if isinstance(value, dict) else {}
    what = [w for w in (v.get("what") or []) if w in OFF]
    if option == "off" and not what and not (v.get("note") or "").strip():
        raise FuzzError(f"say what was off: value.what from {', '.join(OFF)}, or value.note", "value")
    note = {"option": option, "what": what, "note": (v.get("note") or "").strip()[:500] or None,
            "did": p.get("did"), "event_id": p.get("event_id")}
    fid = _feedback(core, "spot_run", p.get("task_id"), json.dumps(note))
    return {"feedback_id": fid, "task_id": p.get("task_id")}


def undo(core, e):
    """Undo of a spot-check answer: its case goes, with its text, and its label with it."""
    d = e["payload"].get("data") or {}
    if d.get("case_origin"):
        evals.retire(core, d["case_origin"], "You undid the spot check.", withdrawn=True)
    if d.get("feedback_id"):
        core.q("UPDATE feedback SET note=COALESCE(note, '') || ' (undone)' WHERE id=? AND user_id=?",
               (d["feedback_id"], core.user_id))


def run_labels(core):
    """What you said about the executor's work, for turning into invented executor cases (`fuzz eval spots`)."""
    out = []
    for f in core.all("SELECT f.id, f.ts, f.a, f.note, t.title FROM feedback f LEFT JOIN tasks t ON t.id=f.a "
                      "WHERE f.user_id=? AND f.kind='spot_run' ORDER BY f.id DESC", (core.user_id,)):
        note = f["note"] or ""
        if note.endswith("(undone)"):
            continue
        n = json.loads(note)
        out.append({"feedback_id": f["id"], "ts": f["ts"], "task_id": f["a"], "title": f["title"],
                    "verdict": n["option"], "off": [OFF[w] for w in n.get("what") or []], "note": n.get("note"),
                    "did": n.get("did")})
    return out
