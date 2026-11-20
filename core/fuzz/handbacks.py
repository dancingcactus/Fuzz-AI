"""Labelling real handbacks, for the personal executor evals (docs/evals.md "Labelling handbacks").

The executor hands a task back (or asks permission) when it can't go on. Sometimes that was right; sometimes
the answer was in front of it. This lists the real ones and turns what you say into a private, replayable case:

  ask      it was right to ask (optionally why: access, context, judgement or ambiguity). The case expects the
           same: it hands back or asks permission, and drafts nothing
  proceed  it should have gone on. You say what it should have done (draft it, or give the answer as a result),
           where the answer was (the thread, a linked document, your calendar) and the fact, in your words

A replay needs a world, and the store keeps only a quote of the message and the task's links. So the world is
that quote, plus the fact you typed, put where you said it was: a case is only as fair as that fact. (Ask
cases have no fact to type; they're as fair as the quote is complete.)

Private and local: scope personal, 90 days, and when a case ends, its world goes with it (evals._close). The
origin is `handback:<id>` and the case has no signal_key, so it never touches the message's extraction labels,
Not a task, or the spot checks, which all read signal_key.
"""

import json
from datetime import timedelta

from . import evals
from .db import FuzzError, iso

WORKED = ("task.handed_back", "permission.asked")
LABELS = ("ask", "proceed")
CAUSES = ("access", "context", "judgement", "ambiguity")
INSTEAD = ("draft", "result")
FOUND_IN = ("thread", "doc", "calendar")
LOOK_BACK = timedelta(days=30)
QUEUE_MAX = 30
FACT_MAX = 500
DOC_LINK = "https://docs.example.com/d/linked"   # the harness's stand-in, when the task had no link to put it at


def _data(e):
    p = json.loads(e["payload"]) if isinstance(e["payload"], str) else (e["payload"] or {})
    return p.get("data") or {}


def queue(core, limit=QUEUE_MAX):
    """Recent handbacks and permission asks with no case yet, newest first. A result handed back is a finished
    answer, not a question, so it isn't here."""
    since = iso(core.now() - LOOK_BACK)
    marks = ",".join("?" * len(WORKED))
    rows = core.all(
        f"SELECT e.id, e.ts, e.type, e.task_id, e.payload, t.title, t.quick_answers, t.variant_tags FROM events e "
        f"JOIN tasks t ON t.id=e.task_id WHERE e.user_id=? AND e.ts>=? AND e.actor='fuzz:executor' "
        f"AND e.type IN ({marks}) "
        "AND NOT EXISTS (SELECT 1 FROM feedback f JOIN eval_cases c ON c.user_id=f.user_id "
        "                AND c.origin='handback:' || f.id WHERE f.user_id=e.user_id AND f.kind='handback' "
        "                AND f.a=e.id AND c.status!='retired') ORDER BY e.id DESC", (core.user_id, since, *WORKED))
    out = []
    for e in rows:
        d = _data(e)
        if d.get("result"):
            continue
        asked_permission = e["type"] == "permission.asked"
        tags = json.loads(e["variant_tags"]) if isinstance(e["variant_tags"], str) else (e["variant_tags"] or [])
        qa = json.loads(e["quick_answers"]) if isinstance(e["quick_answers"], str) else (e["quick_answers"] or [])
        steps = [r["text"] for r in core.all(
            "SELECT json_extract(payload, '$.log.text') text FROM events WHERE user_id=? AND task_id=? "
            "AND actor='fuzz:executor' AND type='task.step' AND id<? ORDER BY id DESC LIMIT 5",
            (core.user_id, e["task_id"], e["id"])) if r["text"]]
        out.append({"event_id": e["id"], "task_id": e["task_id"], "title": e["title"], "ts": e["ts"],
                    "asked": "permission" if asked_permission else "handback",
                    "question": (f"Use {d.get('resource')}? {d.get('why') or ''}".strip() if asked_permission
                                 else d.get("question")),
                    # the options are the task's now, so only while it's still the handback that asked them
                    "options": qa if "handed_back" in tags and not asked_permission else [],
                    "steps": list(reversed(steps))})
        if len(out) >= limit:
            break
    return out


# ---- a case from a label

def _world(core, task_id, ts, instead, found_in, fact):
    """The task and its world, as far as the store knows it, plus the fact you typed where you said it was."""
    t = core.one("SELECT title FROM tasks WHERE user_id=? AND id=?", (core.user_id, task_id))
    links = {r["title"] or r["link"]: r["link"] for r in core.all(
        "SELECT title, link FROM sources WHERE user_id=? AND task_id=? AND role='link' AND link IS NOT NULL "
        "AND withdrawn=0", (core.user_id, task_id))}
    day = (ts or core.now_iso())[:10]
    task = {"title": t["title"]}
    world = {}
    o = core.one("SELECT s.payload, s.quote, s.ts FROM sources so JOIN signals s ON s.user_id=so.user_id "
                 "AND s.key=so.signal_key WHERE so.user_id=? AND so.task_id=? AND so.role='origin' "
                 "AND so.withdrawn=0 ORDER BY so.id LIMIT 1", (core.user_id, task_id))
    if o:   # the quote is all the store keeps of the message
        p = json.loads(o["payload"]) if isinstance(o["payload"], str) else (o["payload"] or {})
        f = p.get("from") if isinstance(p.get("from"), dict) else {}
        who = f.get("name") or f.get("email") or "Someone"
        world["mail"] = [{"id": "m1", "from": f"{who} <{f['email']}>" if f.get("email") else who,
                          "subject": p.get("title") or p.get("channel") or task["title"],
                          "date": (o["ts"] or ts or "")[:10] or day, "text": (o["quote"] or p.get("quote") or "")}]
        task["from_message"] = "m1"
    if fact:
        if found_in == "thread":
            world.setdefault("mail", []).append({"id": f"m{len(world.get('mail', [])) + 1}",
                                                 "from": "Someone in the thread", "subject": task["title"],
                                                 "date": day, "text": fact})
        elif found_in == "doc":
            url = next(iter(links.values()), None) or DOC_LINK
            links = links or {"The linked document": url}
            world["docs"] = {url: {"title": next(iter(links)), "text": fact}}
        elif found_in == "calendar":
            world["calendar"] = [{"title": fact, "start": f"{day}T09:00:00Z", "end": f"{day}T10:00:00Z"}]
    if links:
        task["links"] = links
    return {"now": ts or core.now_iso(), "task": task, "world": world}


def checks(which, instead):
    """What the case expects: behaviour, never wording."""
    if which == "ask":
        return [{"one_of": ["hand_back", "request_permission"]}, {"not_called": "save_draft"}]
    if instead == "result":   # a result still ends in hand_back, with result true
        return [{"called": "update_brief"}, {"called": "hand_back"},
                {"arg_has": {"tool": "hand_back", "field": "result", "any": ["true"]}}]
    return [{"called": "save_draft"}, {"not_called": "hand_back"}, {"not_called": "request_permission"}]


def label(core, event_id, which, cause=None, instead=None, found_in=None, fact=None):
    """Say whether a handback was right. A newer label for the same handback retires the one before."""
    if which not in LABELS:
        raise FuzzError(f"label is one of {', '.join(LABELS)}", "label")
    e = core.one("SELECT id, ts, type, task_id FROM events WHERE user_id=? AND id=? AND actor='fuzz:executor'",
                 (core.user_id, event_id))
    if not e or e["type"] not in WORKED:
        raise FuzzError("that isn't a handback or a permission ask", "event_id", 404)
    fact = fact.strip()[:FACT_MAX] if isinstance(fact, str) and fact.strip() else None
    if which == "ask":
        if cause not in CAUSES + (None, ""):
            raise FuzzError(f"cause is one of {', '.join(CAUSES)}", "cause")
        instead = found_in = fact = None
    else:
        if instead not in INSTEAD:
            raise FuzzError(f"say what it should have done: {', '.join(INSTEAD)}", "instead")
        if found_in not in FOUND_IN or not fact:
            raise FuzzError("say where the answer was (thread, doc or calendar) and what it said, in your words: "
                            "without it a replay can't tell going on from guessing", "fact")
        cause = None
    for old in core.all("SELECT c.origin FROM feedback f JOIN eval_cases c ON c.user_id=f.user_id "
                        "AND c.origin='handback:' || f.id WHERE f.user_id=? AND f.kind='handback' AND f.a=? "
                        "AND c.status!='retired'", (core.user_id, event_id)):
        evals.retire(core, old["origin"], "You labelled it again.", withdrawn=True)
    note = json.dumps({"label": which, "cause": cause or None, "instead": instead, "found_in": found_in})
    fid = core.q("INSERT INTO feedback (user_id, ts, kind, a, note) VALUES (?,?,?,?,?)",
                 (core.user_id, core.now_iso(), "handback", event_id, note)).lastrowid
    inp = _world(core, e["task_id"], e["ts"], instead, found_in, fact)
    expected = {"checks": checks(which, instead), "label": which, "cause": cause or None, "instead": instead}
    cid = evals.add_case(core, "executor", "behaviour", inp, expected, f"handback:{fid}", status="active",
                         expires_at=evals.expires(core),
                         note="Right to ask" + (f" ({cause})" if cause else "") if which == "ask"
                         else f"Should have gone on: {'gave the answer' if instead == 'result' else 'drafted it'}")
    return one(core, cid)


def one(core, case_id):
    c = core.one("SELECT * FROM eval_cases WHERE user_id=? AND id=?", (core.user_id, case_id))
    if not c:
        raise FuzzError(f"no eval case {case_id}", "case_id", 404)
    return _view(evals._decode(c))


def _view(c):
    exp, inp = c["expected"], c["input"]
    return {"id": c["id"], "label": exp.get("label"), "cause": exp.get("cause"), "instead": exp.get("instead"),
            "title": (inp.get("task") or {}).get("title"), "status": c["status"], "note": c.get("note"),
            "expires_at": c.get("expires_at")}


def mine(core):
    """The personal executor cases still in play, newest first."""
    rows = core.all("SELECT * FROM eval_cases WHERE user_id=? AND surface='executor' AND scope='personal' "
                    "AND status='active' AND origin LIKE 'handback:%' ORDER BY id DESC", (core.user_id,))
    return [_view(evals._decode(r)) for r in rows]


def remove(core, case_id):
    """Take a label back: the case goes, and its world with it."""
    c = core.one("SELECT origin, status FROM eval_cases WHERE user_id=? AND id=? AND surface='executor' "
                 "AND scope='personal'", (core.user_id, case_id))
    if not c:
        raise FuzzError(f"no eval case {case_id}", "case_id", 404)
    if c["status"] != "retired":
        evals.retire(core, c["origin"], "You took the label back.", withdrawn=True)
    return {"case_id": case_id, "status": "retired"}
