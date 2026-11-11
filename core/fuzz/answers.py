"""answer(card_id, option, value): one call for every card kind.

The table below mirrors "What each answer writes" in the design doc. A new kind or answer is a
code change here; the AI only fills in wording.
"""

from . import cards, drafts, events, groups, tasks
from .config import gathers
from .db import FuzzError

POSTPONE_LIMIT = 2   # after two "Not sure yet", the core takes the safe answer
UNCLEAR = ("This keeps getting put off, so something about it is probably unclear. Work out what's actually being "
           "asked and what done looks like, and find the smallest first step. If one thing is still unclear, hand it "
           "back with that one question.")
SAFE = {"duplicate": "keep_separate", "entity_person": "different", "entity_term": None, "is_task": "mine",
        "part_of": "no", "deliverable": "keep_going", "deliverable_new": "no",
        "decision": "not_decision", "fact_conflict": None}


def _task_answer(core, card, t, option, value):
    hold = groups.holds(core, t)   # working through its group: Fuzz starts once it has every answer
    if option == "add_to_reply":   # a late ask joins the thread's reply waiting for your OK
        return drafts.add_to_reply(core, card, t)
    if option == "find_out":   # you need to know something first: Fuzz looks, the task stays yours
        return tasks.find_out(core, t["id"], value, card=card)
    # working sessions: a big task's four choices, the working card's Pause, and "What's in the way?"
    if option == "book":
        return tasks.book(core, t["id"], (value or {}).get("anchor") if isinstance(value, dict) else value, card=card)
    if option == "do_now":
        return tasks.do_now(core, t["id"], card=card)
    if option == "pause":
        return tasks.pause(core, t["id"], card=card, left_off=value)
    if option == "after_others":
        return tasks.after_others(core, t["id"], card=card)
    if option == "first_step":
        return tasks.first_step(core, t["id"], card=card)
    if option == "keep_going":   # the block's over and you're on a roll: it runs on, if the calendar is free
        from . import booking
        return booking.keep_going(core, t["id"], card=card)
    if option == "decide":   # can't decide: Fuzz lays out the options with a suggested default
        return tasks.find_out(core, t["id"], tasks.DECIDE, card=card)
    if option == "draft_it":   # don't want to write it: Fuzz drafts it for your OK
        return tasks.assign(core, t["id"], instructions=tasks.DRAFT_IT, card=card, option="draft_it", hold=hold)
    if option == "assign":
        v = value if isinstance(value, dict) else {"instructions": value}
        return tasks.assign(core, t["id"], instructions=v.get("instructions"), refs=v.get("refs"), card=card,
                            value=value, hold=hold)
    if option == "quick":
        text = value if isinstance(value, str) else (value or {}).get("text")
        if not text or text not in (t.get("quick_answers") or []) and not (value or {}).get("custom"):
            raise FuzzError("value is one of the quick answers on this card", "value")
        with core.tx("human"):
            ch = events.Changes()
            cards.mark_answered(core, ch, card, "quick", text)
            events.emit(core, "card.answered", task_id=t["id"], changes=ch, data={"kind": "task", "option": "quick"},
                        log=("guidance", f"You answered: {text}"))
            tasks.assign(core, t["id"], instructions=text, hold=hold)
        return
    if option == "session":
        return tasks.session(core, t["id"], card=card)
    if option == "schedule":
        v = value if isinstance(value, dict) else {}
        return tasks.schedule(core, t["id"], v.get("anchor"), card=card, instructions=v.get("instructions"),
                              gather=gathers(core.config))
    if option == "done":
        return tasks.done(core, t["id"], card=card)
    if option == "park":
        return tasks.park(core, t["id"], card=card)
    if option == "wait":
        return tasks.wait(core, t["id"], on=value if isinstance(value, str) else None, card=card,
                          plan=gathers(core.config))
    if option == "someone_else":
        return tasks.theirs(core, t["id"], on=value if isinstance(value, str) else None, card=card)
    if option == "drop":
        return tasks.let_go(core, t["id"], card=card)
    if option == "keep":
        return tasks.keep_stale(core, t["id"], card)
    if option == "keep_parked":
        return tasks.keep_parked(core, t["id"], card)
    if option == "now":
        return tasks.clarify(core, t["id"], card)
    if option == "got_it":
        return tasks.clarify(core, t["id"], card, "got_it", f"{t.get('waiting_on') or 'They'} got back to you.")
    if option == "keep_waiting":
        return tasks.wait(core, t["id"], on=t.get("waiting_on"), card=card, option="keep_waiting",
                          plan=gathers(core.config))
    if option == "unclear":   # it keeps coming back: Fuzz works out what's actually asked and the first step
        return tasks.assign(core, t["id"], card=card, option="unclear", instructions=UNCLEAR, hold=hold)
    if option == "nudge":
        who = t.get("waiting_on") or "them"
        return tasks.assign(core, t["id"], card=card, option="nudge", hold=hold,
                            instructions=f"Draft a short, friendly nudge to {who} (a nudge.* draft in the same thread) "
                                         f"asking where this stands.")


def _duplicate(core, card, t, option, value):
    """One answer for every task the card asks about (the same ask may have come in several times)."""
    from . import matching
    from .matching import dupes
    ids = [d["id"] for d in dupes.card_dupes(core, card)] or [card["task_id"]]
    for i, tid in enumerate(ids):
        if option == "merge":
            matching.merge(core, tid, card["other_id"], card=card if i == 0 else None)
        elif option == "keep_separate":
            matching.keep_separate(core, tid, card["other_id"], card=card if i == 0 else None)


def _entity_person(core, card, t, option, value):
    """Same person: b (the name-only one) joins the one you picked, a by default. Different, or someone else:
    kept apart from every one the card offered, and when you name them ("Nick Moreno") the name-only one
    becomes that person, so the next "Nick" has two to choose from."""
    p = card.get("payload") or {}
    a, b = p.get("entity_a"), p.get("entity_b")
    offered = p.get("candidates") or [a]
    with core.tx("human"):
        ch = events.Changes()
        if option == "same":
            into = int(value) if isinstance(value, (int, str)) and str(value).isdigit() else a
            if into not in offered:
                raise FuzzError("value is one of the people the card offered", "value")
            cards.mark_answered(core, ch, card, option, into if into != a else None)
            core.q("UPDATE entities SET redirect_to=?, provisional=0 WHERE id=? AND user_id=?", (into, b, core.user_id))
            events.emit(core, "entity.merged", task_id=card["task_id"], changes=ch, data={"from": b, "into": into})
        else:
            name = value.strip() if option == "different" and isinstance(value, str) else ""
            if name and len(name.split()) < 2:
                raise FuzzError("value is their full name, first and last", "value")
            cards.mark_answered(core, ch, card, option, name or None)
            for o in offered:
                core.q("INSERT OR IGNORE INTO entity_links VALUES (?,?,?)", (o, b, "different"))
            data = {"a": a, "b": b, "others": [o for o in offered if o != a]}
            if name:
                old = core.one("SELECT name FROM entities WHERE id=?", (b,))["name"]
                have = {r["alias"] for r in core.all("SELECT alias FROM aliases WHERE entity_id=?", (b,))}
                core.q("UPDATE entities SET name=? WHERE id=? AND user_id=?", (name, b, core.user_id))
                added = [x for x in dict.fromkeys([name.lower(), name.split()[0].lower()]) if x not in have]
                for x in added:
                    core.q("INSERT OR IGNORE INTO aliases VALUES (?,?)", (b, x))
                data["renamed"] = {"from": old, "to": name, "aliases": added}
            events.emit(core, "entity.kept_separate", task_id=card["task_id"], changes=ch, data=data)
        if card["task_id"]:
            cards.sync(core, card["task_id"])


def _entity_term(core, card, t, option, value):
    from .memory import facts
    p = card.get("payload") or {}
    eid = p.get("entity_id")
    with core.tx("human"):
        if option == "define":
            if not isinstance(value, str) or not value.strip():
                raise FuzzError("value is the definition", "value")
            e = facts.require_entity(core, eid)
            # a fact you wrote: it wins over Fuzz's guess, and Undo takes it back
            facts.edit(core, eid, "what_it_is" if e["type"] == "tool" else "definition", value, card=card, option="define")
            core.q("UPDATE entities SET provisional=0 WHERE id=? AND user_id=?", (eid, core.user_id))
            events.emit(core, "entity.defined", task_id=card["task_id"], data={"entity_id": eid})
        else:
            if not isinstance(value, int):
                raise FuzzError("value is the id of the existing entity", "value")
            ch = events.Changes()
            cards.mark_answered(core, ch, card, option, value)
            core.q("UPDATE entities SET redirect_to=? WHERE id=? AND user_id=?", (value, eid, core.user_id))
            events.emit(core, "entity.merged", task_id=card["task_id"], changes=ch, data={"from": eid, "into": value})
        if card["task_id"]:
            cards.sync(core, card["task_id"])


def _decision(core, card, t, option, value):
    from .memory import mcards
    return mcards.answer_decision(core, card, option, value)


def _fact_conflict(core, card, t, option, value):
    from .memory import mcards
    return mcards.answer_conflict(core, card, option, value)


def _is_task(core, card, t, option, value):
    """One card can ask about several asks from the same message. Mine takes the ids you ticked (all of
    them without a list); the ones you didn't tick are someone else's. The other answers cover them all."""
    many = cards.asks(core, card) or [t]
    if option == "mine":
        ids = {a["id"] for a in many}
        pick = set(value) if isinstance(value, list) else ids
        if not pick or pick - ids:
            raise FuzzError(f"value is the ids of the asks that are yours, from {sorted(ids)}", "value")
        with core.tx("human"):
            for a in many:
                if a["id"] not in pick:
                    tasks.theirs(core, a["id"], card=card if a["id"] == t["id"] else None, option="mine")
                    _not_task(core, a["id"], "is_task card: not ticked")
            for a in many:
                if a["id"] in pick:
                    ch = events.Changes()
                    if a["id"] == t["id"]:
                        cards.mark_answered(core, ch, card, option, value)
                    ch.task(a["id"], owner="me", variant_tags=tasks._tags(a, remove=("unconfirmed",)), question=None)
                    events.emit(core, "task.confirmed", task_id=a["id"], changes=ch, log=("status", "You said this is yours."))
                    cards.sync(core, a["id"])
        return
    if option == "not_task":
        with core.tx("human"):
            for a in many:
                tasks.let_go(core, a["id"], card=card if a["id"] == t["id"] else None, option="not_task",
                             why="You said this isn't a task.")
                _not_task(core, a["id"], "is_task card")
        return
    if option == "someone_else":
        with core.tx("human"):
            for a in many:
                tasks.theirs(core, a["id"], on=value if isinstance(value, str) else None,
                             card=card if a["id"] == t["id"] else None)
        return


def _not_task(core, task_id, note):
    core.q("INSERT INTO feedback (user_id, ts, kind, a, note) VALUES (?,?,?,?,?)",
           (core.user_id, core.now_iso(), "not_task", task_id, note))


def _draft(core, card, t, option, value):
    if option == "approve":
        return drafts.approve(core, card)
    if option == "edit":
        return drafts.edit(core, card, value)
    if option == "send_back":
        return drafts.send_back(core, card, value)
    if option == "not_yet":
        return drafts.not_yet(core, card)
    if option == "done":   # you sent it yourself, so Fuzz doesn't
        return drafts.done_myself(core, card)
    if option == "schedule":   # not now: the draft waits, and asks for your OK again at that time
        v = value if isinstance(value, dict) else {}
        return tasks.schedule(core, t["id"], v.get("anchor"), card=card)


def _permission(core, card, t, option, value):
    return drafts.answer_permission(core, card, option)


def _hold(core, card, t, option, value):
    from . import booking
    return booking.answer_hold(core, card, option)


def _deliverable(core, card, t, option, value):
    from . import deliverables
    return deliverables.answer(core, card, option, value)


HANDLERS = {"task": _task_answer, "duplicate": _duplicate, "entity_person": _entity_person,
            "entity_term": _entity_term, "is_task": _is_task, "draft": _draft, "nudge": _draft,
            "permission": _permission, "hold": _hold, "part_of": _deliverable, "deliverable": _deliverable,
            "deliverable_new": _deliverable, "week_plan": _deliverable, "decision": _decision,
            "fact_conflict": _fact_conflict}


def answer(core, card_id, option, value=None):
    card = cards.get(core, card_id)
    if card["status"] != "open":
        raise FuzzError(f"Card {card_id} is already {card['status']}", "card_id", 409)
    t = tasks.get(core, card["task_id"]) if card["task_id"] else None
    allowed = cards.options(card, t or {})
    if option not in allowed:
        raise FuzzError(f"option must be one of {', '.join(allowed)}", "option")
    line = None
    with core.tx("human"):
        if option == "not_sure":
            _postpone(core, card, t)
        else:
            HANDLERS[card["kind"]](core, card, t, option, value)
        if card["kind"] in groups.ROUTING and t:   # working through a group: the run goes on, or it's collected
            line = groups.after_answer(core, t["id"])
    out = {"card_id": card_id, "option": option}
    if line:
        out["collected"] = line
    return out


def _postpone(core, card, t):
    if card["postponed"] >= POSTPONE_LIMIT:
        safe = SAFE[card["kind"]]
        with core.tx("system"):
            ch = events.Changes()
            ch.card(card["id"], status="expired", answer={"option": safe, "value": None})
            events.emit(core, "card.expired", task_id=card["task_id"], changes=ch,
                        data={"kind": card["kind"], "safe_answer": safe},
                        log=("status", "Fuzz took the safe answer, since this was postponed twice."))
            if card["kind"] == "duplicate":
                from . import matching
                from .matching import dupes
                for d in dupes.card_dupes(core, card) or [{"id": card["task_id"]}]:
                    matching.keep_separate(core, d["id"], card["other_id"], card=None, feedback=False)
            many = cards.asks(core, card) if card["kind"] == "is_task" else []
            for a in many:
                ch = events.Changes()
                ch.task(a["id"], variant_tags=tasks._tags(a, remove=("unconfirmed",)))
                events.emit(core, "task.confirmed", task_id=a["id"], changes=ch, data={"by": "expiry"})
            for tid in [a["id"] for a in many] or ([card["task_id"]] if card["task_id"] else []):
                cards.sync(core, tid)
        return
    ch = events.Changes()
    ch.card(card["id"], postponed=card["postponed"] + 1, order_key=cards.next_order(core))
    events.emit(core, "card.postponed", task_id=card["task_id"], changes=ch, data={"kind": card["kind"]})
