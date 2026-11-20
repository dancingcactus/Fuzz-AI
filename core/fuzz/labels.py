"""Labelling messages by hand, for the personal evals (docs/evals.md "Labelling cases by hand").

Corrections make personal cases only when you happen to correct something: Not a task, a miss you report, a spot
check. This lists the messages extraction read, with what it made of each, so you can say what each one held and
the case set grows where it's thin, not where you happened to notice.

Three labels, each a case for extraction:
  mine     an ask of yours: a keep case (the ask, in your words if you give them)
  others   an ask, but someone else's: a skip case. "Unclear" isn't a wrong answer for it, so it isn't strict
  nothing  no ask at all: a skip case, strict as Not a task is (an "Is this yours?" card would be noise)

A label's text isn't in the store (a signal keeps only a quote), so the case waits for the executor to fetch it,
as Not a task's cases do, and expires after KEEP_DAYS like them. The origin is `label:<id>`, not `feedback:<id>`:
the examples learner reads `feedback:` origins, so a hand label scores the app and teaches it nothing. That's
the point of a debugging page; a lesson still comes from a correction.
"""

import json
from datetime import timedelta

from . import evals
from .db import FuzzError, iso

LABELS = ("mine", "others", "nothing")
LOOK_BACK = timedelta(days=30)
QUEUE_MAX = 40
ASK_MAX = 300
# what extraction made of a message, worst-understood first: the labels that teach the evals most
VERDICT_ORDER = {"unclear": 0, "others": 1, "none": 2, "mine": 3}


def _payload(r):
    return json.loads(r["payload"]) if isinstance(r["payload"], str) else (r["payload"] or {})


def verdict(candidates):
    """What extraction made of a message: mine, unclear, others (someone else's) or none (no ask)."""
    owners = [(c["owner"] or "me") for c in candidates if c["kind"] == "ask"]
    if not owners:
        return "none"
    if "me" in owners:
        return "mine"
    return "unclear" if "unclear" in owners else "others"


def queue(core, limit=QUEUE_MAX, source=None, saw=None):
    """Recent messages with no case yet, as extraction saw them. Filters: source (email | slack | meeting) and
    saw (what extraction made of it). Least understood first, then newest."""
    since = iso(core.now() - LOOK_BACK)
    rows = core.all("SELECT s.key, s.source, s.link, s.ts, s.quote, s.payload FROM signals s "
                    "WHERE s.user_id=? AND s.ts>=? AND s.source IN ('email', 'slack', 'meeting') "
                    "AND NOT EXISTS (SELECT 1 FROM eval_cases e WHERE e.user_id=s.user_id AND e.signal_key=s.key "
                    "                AND e.status!='retired') ORDER BY s.ts DESC", (core.user_id, since))
    out = []
    for r in rows:
        if source and r["source"] != source:
            continue
        cands = core.all("SELECT kind, owner, ask FROM candidates WHERE user_id=? AND signal_key=? ORDER BY idx",
                         (core.user_id, r["key"]))
        v = verdict(cands)
        if saw and v != saw:
            continue
        p = _payload(r)
        f = p.get("from") if isinstance(p.get("from"), dict) else {}
        out.append({"key": r["key"], "source": r["source"], "from": f.get("name") or f.get("email"),
                    "title": p.get("title") or p.get("channel"), "quote": (r["quote"] or p.get("quote") or "")[:300],
                    "link": r["link"], "ts": r["ts"], "saw": v,
                    "asks": [{"ask": c["ask"], "owner": c["owner"] or "me"} for c in cands if c["kind"] == "ask"]})
    out.sort(key=lambda x: VERDICT_ORDER[x["saw"]])   # stable: newest first within a verdict
    return out[:limit]


def label(core, signal_key, which, ask=None):
    """Say what a message held. A newer label retires the one before, so the changed case reads as relabelled
    in a comparison (docs/evals.md). Returns the case."""
    if which not in LABELS:
        raise FuzzError(f"label is one of {', '.join(LABELS)}", "label")
    s = core.one("SELECT key, source, payload FROM signals WHERE user_id=? AND key=?", (core.user_id, signal_key))
    if not s:
        raise FuzzError("Fuzz no longer has a record of that message", "signal_key", 404)
    p = _payload(s)
    msg = {k: p[k] for k in evals.MESSAGE_FIELDS if p.get(k) is not None}
    msg.setdefault("source", s["source"])
    said = ask.strip()[:ASK_MAX] if isinstance(ask, str) and ask.strip() else None
    if which == "mine":
        if not said:   # their own words are best; else extraction's, else the message's title
            held = core.one("SELECT ask FROM candidates WHERE user_id=? AND signal_key=? AND kind='ask' "
                            "AND COALESCE(owner, 'me')='me' AND ask IS NOT NULL ORDER BY idx LIMIT 1",
                            (core.user_id, signal_key))
            said = (held["ask"] if held else None) or p.get("title") or "Follow up on this message"
        kind, expected = "keep", {"has_my_ask": True, "ask": said[:ASK_MAX]}
    else:
        kind, expected = "skip", {"has_my_ask": False, **({"strict": True} if which == "nothing" else {})}
    for old in core.all("SELECT origin FROM eval_cases WHERE user_id=? AND signal_key=? AND status!='retired'",
                        (core.user_id, signal_key)):
        evals.retire(core, old["origin"], "You labelled it again.", withdrawn=True)
    fid = core.q("INSERT INTO feedback (user_id, ts, kind, a, note) VALUES (?,?,?,?,?)",
                 (core.user_id, core.now_iso(), "label", None, which)).lastrowid
    cid = evals.add_case(core, "extract", kind, msg, expected, f"label:{fid}", status="pending",
                         signal_key=signal_key, quote=p.get("quote") or None,
                         note=f"You labelled it by hand: {WORDS[which]}")
    return one(core, cid)


WORDS = {"mine": "an ask of yours", "others": "an ask, someone else's", "nothing": "nothing for anyone"}


def one(core, case_id):
    c = core.one("SELECT * FROM eval_cases WHERE user_id=? AND id=?", (core.user_id, case_id))
    if not c:
        raise FuzzError(f"no eval case {case_id}", "case_id", 404)
    return _view(evals._decode(c))


def _view(c):
    msg, exp = c["input"], c["expected"]
    f = msg.get("from") if isinstance(msg.get("from"), dict) else {}
    which = "mine" if c["kind"] == "keep" else ("nothing" if exp.get("strict") else "others")
    return {"id": c["id"], "label": which, "kind": c["kind"], "status": c["status"], "ask": exp.get("ask"),
            "source": msg.get("source"), "from": f.get("name") or f.get("email"),
            "title": msg.get("title") or msg.get("channel"), "quote": c.get("quote"), "note": c.get("note"),
            "by_hand": str(c["origin"]).startswith("label:"), "expires_at": c.get("expires_at"),
            "signal_key": c.get("signal_key")}


def mine(core):
    """The personal extraction cases still in play, newest first: what you can relabel or take back."""
    rows = core.all("SELECT * FROM eval_cases WHERE user_id=? AND surface='extract' AND scope='personal' "
                    "AND status IN ('pending', 'unconfirmed', 'active') AND origin NOT LIKE 'seed:%' "
                    "ORDER BY id DESC", (core.user_id,))
    return [_view(evals._decode(r)) for r in rows]


def remove(core, case_id):
    """Take a label back: the case goes with its text, and a lesson a correction made of it goes too."""
    c = core.one("SELECT origin, status FROM eval_cases WHERE user_id=? AND id=? AND scope='personal'",
                 (core.user_id, case_id))
    if not c:
        raise FuzzError(f"no eval case {case_id}", "case_id", 404)
    if c["status"] != "retired":
        evals.retire(core, c["origin"], "You took the label back.", withdrawn=True)
    return {"case_id": case_id, "status": "retired"}
