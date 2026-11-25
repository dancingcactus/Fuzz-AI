"""Dump mode (docs/dump-mode.md): pour it all out in one box, and Fuzz splits it into a short list.

A dump goes through three steps, and nothing is created until the third:

  start()    the raw text is kept (table dumps) and the splitter, a short run of the `split` role, is started
  submit()   the splitter's answer: items grouped as task, note, later or done. Stored on the dump, nothing else
  commit()   the items you ticked become tasks, all in one transaction, so one Undo takes the lot back

In Focus time there is no review: submit() commits what the splitter found at once, and the tasks go straight
into the session like any other capture there.

The dump and its items are not events (the raw text is the most personal thing Fuzz holds, and you can delete
it), so what Undo puts back outside the projection is the dump's own state (UNDO_HOOKS: dump.committed).
No scores, no counts shown back: a dump is never graded.
"""

import json
from datetime import timedelta

from . import config, events, tasks
from .db import FuzzError, parse_iso

GROUPS = ("task", "note", "later", "done")
TASK_GROUPS = ("task", "later")                  # the groups that become tasks; a note or a done item is only kept
KEEP = {"task": True, "note": True, "later": True, "done": False}   # what's ticked when Fuzz shows the split
TEXT_MAX = 20000
ITEM_MAX = 40                                     # a dump must not become a pile of cards
ITEM_TEXT_MAX = 300
INSTRUCTION_MAX = 500
STALE_MINUTES = 10                                # a split that hasn't come back by then is shown as failed


def _row(core, dump_id):
    r = core.one("SELECT * FROM dumps WHERE id=? AND user_id=?", (dump_id, core.user_id))
    if not r:
        raise FuzzError(f"No dump {dump_id}", "dump_id", 404)
    return r


def _items(row):
    try:
        return json.loads(row.get("items") or "[]")
    except ValueError:
        return []


def start(core, text, deep_work=False):
    """Keep the text and make the dump; the caller starts the splitter. Returns the dump id."""
    text = (text or "").strip()
    if not text:
        raise FuzzError("Write or paste what's on your mind first", "text")
    if len(text) > TEXT_MAX:
        raise FuzzError(f"A dump is at most {TEXT_MAX} characters. Split it into two", "text")
    with core.tx("human"):
        return core.q("INSERT INTO dumps (user_id, text, state, deep_work, created_at, split_at) VALUES (?,?,?,?,?,?)",
                      (core.user_id, text, "splitting", 1 if deep_work else 0, core.now_iso(), core.now_iso())).lastrowid


def revise(core, dump_id, instruction):
    """Tell Fuzz to change the split: it runs again with your words and the list it made. Returns the dump id."""
    r = _row(core, dump_id)
    instruction = (instruction or "").strip()
    if not instruction:
        raise FuzzError("Say what to change", "instruction")
    if len(instruction) > INSTRUCTION_MAX:
        raise FuzzError(f"Say it in {INSTRUCTION_MAX} characters or fewer", "instruction")
    if r["state"] not in ("ready", "failed"):
        raise FuzzError("This dump isn't waiting for your review", "dump_id", 409)
    with core.tx("human"):
        core.q("UPDATE dumps SET state='splitting', instruction=?, error=NULL, split_at=? WHERE id=?",
               (instruction, core.now_iso(), dump_id))
    return dump_id


def get_for_splitter(core, dump_id):
    """What the splitter reads: the text (as data, never instructions), your last instruction, and its last list."""
    r = _row(core, dump_id)
    if r["state"] != "splitting":
        raise FuzzError("This dump isn't waiting for a split", "dump_id", 409)
    return {"dump_id": dump_id, "text": r["text"], "instruction": r.get("instruction"),
            "previous": [{"group": i["group"], "text": i["text"]} for i in _items(r)] or None,
            "max_items": ITEM_MAX}


def _clean(items):
    if not isinstance(items, list):
        raise FuzzError("items is a list of {group, text}", "items")
    out = []
    for n, i in enumerate(items):
        if not isinstance(i, dict):
            raise FuzzError(f"items[{n}] is {{group, text}}", "items")
        group, text = i.get("group"), " ".join(str(i.get("text") or "").split())
        if group not in GROUPS:
            raise FuzzError(f"items[{n}].group is one of {', '.join(GROUPS)}", "items")
        if not text:
            raise FuzzError(f"items[{n}].text is what the item says", "items")
        out.append({"id": len(out) + 1, "group": group, "text": text[:ITEM_TEXT_MAX], "keep": KEEP[group]})
    if len(out) > ITEM_MAX:
        raise FuzzError(f"At most {ITEM_MAX} items: merge the small ones, a dump must not become a pile of cards", "items")
    return out


def submit(core, dump_id, items, say=None):
    """The splitter's answer. It's stored and nothing is created, except in Focus time, where it's committed at once.
    Returns {dump_id, state, items}."""
    r = _row(core, dump_id)
    if r["state"] != "splitting":
        raise FuzzError("This dump isn't waiting for a split", "dump_id", 409)
    items = _clean(items)
    say = " ".join(str(say or "").split())[:300] or None
    with core.tx("human"):
        core.q("UPDATE dumps SET state='ready', items=?, say=?, error=NULL, split_at=? WHERE id=?",
               (json.dumps(items), say, core.now_iso(), dump_id))
    out = {"dump_id": dump_id, "state": "ready", "items": len(items)}
    if r["deep_work"]:
        out.update(commit(core, dump_id))
        out["state"] = "committed"
    return out


def fail(core, dump_id, why):
    """The split didn't come back. The text is still kept, and you can add it as one task."""
    with core.tx("human"):
        core.q("UPDATE dumps SET state='failed', error=? WHERE id=? AND user_id=? AND state='splitting'",
               (str(why)[:300], dump_id, core.user_id))


def _state(core, r):
    if r["state"] == "splitting" and r.get("split_at") \
            and core.now() - parse_iso(r["split_at"]) > timedelta(minutes=STALE_MINUTES):
        return "failed"
    return r["state"]


def view(core, dump_id):
    r = _row(core, dump_id)
    state = _state(core, r)
    linked = {i["id"]: i["task_id"] for i in core.all("SELECT id, task_id FROM dump_items WHERE dump_id=?", (dump_id,))}
    out = {"id": r["id"], "state": state, "text": r["text"], "deep_work": bool(r["deep_work"]), "say": r["say"],
           "instruction": r["instruction"], "created_at": r["created_at"], "items": _items(r),
           "error": r["error"] if state == "failed" else None}
    if state == "failed" and not out["error"]:
        out["error"] = "Fuzz took too long to split it"
    if state in ("committed", "undone"):
        out["task_ids"] = sorted(t for t in linked.values() if t)
    return out


def commit(core, dump_id, accept=None):
    """Create what you ticked, in one transaction, and link each item to its dump.

    accept: the ids of the items to keep. None means what the split ticked by default (KEEP). Tasks and later items
    become tasks (a later one is parked); notes and done items are only kept with the dump. A dump may make no
    tasks. Returns {task_ids, kept, gather}: gather says the new tasks wait for Fuzz to look them up first, so the
    caller starts that."""
    r = _row(core, dump_id)
    if r["state"] not in ("ready", "undone"):
        raise FuzzError("This dump has no split waiting for you", "dump_id", 409)
    items = _items(r)
    if accept is None:
        accept = [i["id"] for i in items if i["keep"]]
    elif not isinstance(accept, list) or any(not isinstance(a, int) for a in accept):
        raise FuzzError("accept is a list of item ids", "accept")
    chosen = [dict(i, keep=i["id"] in set(accept)) for i in items]
    gather = config.gathers(core.config) and not r["deep_work"]
    made = []
    with core.tx("human"):
        for i in chosen:
            if not i["keep"]:
                continue
            tid = None
            if i["group"] in TASK_GROUPS:
                tid = tasks.capture(core, i["text"], gather=gather, deep_work=bool(r["deep_work"]))
                if i["group"] == "later" and not r["deep_work"]:
                    tasks.park(core, tid)
                made.append(tid)
            core.q("INSERT INTO dump_items (dump_id, user_id, grp, text, task_id) VALUES (?,?,?,?,?)",
                   (dump_id, core.user_id, i["group"], i["text"], tid))
        core.q("UPDATE dumps SET state='committed', items=?, decided_at=? WHERE id=?",
               (json.dumps(chosen), core.now_iso(), dump_id))
        events.emit(core, "dump.committed", data={"dump_id": dump_id, "task_ids": made})
    return {"task_ids": made, "kept": sum(1 for i in chosen if i["keep"]), "gather": bool(gather and made)}


def undo_committed(core, event):
    """Undo took the tasks back: the dump is ready for review again, and its links are gone."""
    dump_id = event["payload"]["data"]["dump_id"]
    core.q("DELETE FROM dump_items WHERE dump_id=? AND user_id=?", (dump_id, core.user_id))
    core.q("UPDATE dumps SET state=?, decided_at=NULL WHERE id=? AND user_id=?",
           ("undone", dump_id, core.user_id))


def discard(core, dump_id):
    """Delete the dump: its text, its split and its links. Tasks it made stay; they're yours now."""
    _row(core, dump_id)
    with core.tx("human"):
        core.q("DELETE FROM dump_items WHERE dump_id=? AND user_id=?", (dump_id, core.user_id))
        core.q("DELETE FROM dumps WHERE id=? AND user_id=?", (dump_id, core.user_id))
    return {"deleted": dump_id}


def as_one_task(core, dump_id):
    """The split isn't coming: keep the whole text as one task, the way the box does without Dump mode."""
    r = _row(core, dump_id)
    gather = config.gathers(core.config) and not r["deep_work"]
    with core.tx("human"):
        tid = tasks.capture(core, r["text"], gather=gather, deep_work=bool(r["deep_work"]))
        core.q("INSERT INTO dump_items (dump_id, user_id, grp, text, task_id) VALUES (?,?,?,?,?)",
               (dump_id, core.user_id, "task", r["text"][:ITEM_TEXT_MAX], tid))
        core.q("UPDATE dumps SET state='committed', decided_at=? WHERE id=?", (core.now_iso(), dump_id))
        events.emit(core, "dump.committed", data={"dump_id": dump_id, "task_ids": [tid]})
    return {"task_ids": [tid], "kept": 1, "gather": bool(gather)}


def for_task(core, task_id):
    """The dump a task came from, for a line on its page: {dump_id, created_at} or None."""
    r = core.one("SELECT d.id, d.created_at FROM dump_items i JOIN dumps d ON d.id=i.dump_id "
                 "WHERE i.task_id=? AND i.user_id=?", (task_id, core.user_id))
    return {"dump_id": r["id"], "created_at": r["created_at"]} if r else None
