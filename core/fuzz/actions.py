"""The human commands every interface shares: answering a card and acting on a task directly.

Each returns (result, follow-ups). The result is what the interface shows; the follow-ups are the runs
the command should start, which the interface hands to followups.run() once the command has committed.
HTTP, the CLI and anything else that answers for you go through here, so they can't drift apart.
"""

from . import answers, cards, config, engine, evals, events, matching, missed, onboarding, tasks
from .db import FuzzError
from .memory import facts as mfacts

GATHER_AFTER = ("schedule", "wait", "keep_waiting", "nudge")   # answers that give Fuzz something to look into or draft
GATHER = [{"kind": "gather"}]   # after a file lands: a task captured with files waits for them before it's gathered


def capture(core, text, docs=None, due=None, missed=False, uploading=False):
    """New task. It goes to Fuzz first when gathering is on (or Fuzz missed it). Returns (task id, gathering, follow-ups)."""
    gather = config.gathers(core.config) or bool(missed)
    tid = tasks.capture(core, text, docs, due=due, gather=gather, uploading=uploading, missed=missed)
    return tid, gather, (list(GATHER) if gather else [])


def _kickoff(core, task_id, card=None):
    """You handed Fuzz the onboarding's kickoff task: it asks the app what it can reach (one slow run, as a
    follow-up), then puts one permission card per source in front of you."""
    client = onboarding.start_kickoff(core, task_id, card)
    out = {"task_id": task_id, "state": tasks.get(core, task_id)["state"], "kickoff": True}
    return out, ([{"kind": "discover", "task_id": task_id, "client": client}] if client else [])


def answer_card(core, card_id, option, value=None):
    """Answer a card: the kickoff's own rules, the answer itself, and what it starts."""
    card = cards.get(core, card_id)
    kickoff = card["status"] == "open" and onboarding.is_kickoff(core, card["task_id"])
    if kickoff and card["kind"] == "task" and option in ("assign", "quick"):
        return _kickoff(core, card["task_id"], card)
    asked = option
    if kickoff and card["kind"] == "permission" and option == "allow_once":
        option = "always_allow"   # reading is the point of these cards: allowing turns its tools on
    out = answers.answer(core, card_id, option, value)
    if kickoff and card["kind"] == "permission":
        onboarding.after_answer(core, card["task_id"])
    follow = []
    if asked in GATHER_AFTER:
        follow.append({"kind": "gather"})
    if out.get("collected") or option == "add_to_reply":   # Fuzz can start on the ones you handed it
        follow.append({"kind": "group_run"})
    if option == "find_out":   # at once, not at the next scheduled run: the card comes back as soon as it lands
        follow.append({"kind": "find_out", "task_id": card["task_id"]})
    return out, follow


def _reopen(core, tid, body):
    where = body.get("where", "front")
    if where not in ("front", "back"):
        raise FuzzError("where must be front or back", "where")
    tasks.bring_back(core, tid, where=where, reason="You brought this back.", type="task.reopened",
                     tags=("returning",))


# verb -> (what it does, what it starts). body is the request's JSON object.
TASK_VERBS = {
    "assign": (lambda core, tid, body: tasks.assign(core, tid, body.get("instructions"), refs=body.get("refs")), ()),
    "done": (lambda core, tid, body: tasks.done(core, tid), ()),
    "park": (lambda core, tid, body: tasks.park(core, tid), ()),
    "wait": (lambda core, tid, body: tasks.wait(core, tid, body.get("on"), plan=config.gathers(core.config)),
             ("gather",)),
    "theirs": (lambda core, tid, body: tasks.theirs(core, tid, body.get("on")), ()),
    "letgo": (lambda core, tid, body: tasks.let_go(core, tid), ()),
    "session": (lambda core, tid, body: tasks.session(core, tid), ()),
    "schedule": (lambda core, tid, body: tasks.schedule(core, tid, body.get("anchor"),
                                                        instructions=body.get("instructions"),
                                                        gather=config.gathers(core.config)), ("gather",)),
    "back": (lambda core, tid, body: tasks.to_back(core, tid), ()),
    "find_out": (lambda core, tid, body: tasks.find_out(core, tid, body.get("question")), ("find_out",)),
    "reopen": (_reopen, ()),
}


def task_action(core, task_id, verb, body=None):
    """Act on a task directly, not through its card: POST /tasks/{id}/<verb> and `fuzz task`."""
    body = body or {}
    if verb not in TASK_VERBS:
        raise FuzzError(f"action must be one of {', '.join(TASK_VERBS)}", "action")
    if verb == "assign" and onboarding.is_kickoff(core, task_id) and tasks.get(core, task_id)["state"] == "triage":
        return _kickoff(core, task_id)
    do, starts = TASK_VERBS[verb]
    do(core, task_id, body)
    follow = [{"kind": k, "task_id": task_id} for k in starts]
    return {"task_id": task_id, "state": tasks.get(core, task_id)["state"]}, follow


# What undo puts back outside the projection, by the event that changed it (see events.undo)
UNDO_HOOKS = {
    # the side tables a merge moved
    "task.merged": lambda core, e: matching.unmerge_side_tables(core, e["payload"]["data"]["merge_id"]),
    # the entity tables are derived, not replayed
    "entity.merged": mfacts.undo_entity_event,
    "entity.kept_separate": mfacts.undo_entity_event,
    # Not a task taken back: its eval case was a wrong label
    "task.let_go": lambda core, e: evals.retire_for_task(core, e["task_id"]),
    # Yes taken back: the case waits on the card again
    "task.missed_confirmed": missed.undo_confirmed,
    "engine.selected": lambda core, e: engine.restore_selection(core, e["payload"]["data"].get("prior")),
}


def undo(core, group=None):
    """Undo one of your commands (the newest, or the group named): POST /undo and `fuzz undo`."""
    return events.undo(core, group, hooks=UNDO_HOOKS)
