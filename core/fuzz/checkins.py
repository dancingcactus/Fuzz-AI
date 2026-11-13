"""Check-ins: how you're doing, and what it changes about the queue (docs/energy-and-priority.md).

When to ask, and how, is the UI's job (it counts the cards to the next one and keeps the ADHD niceties:
a break offer, skipping with Esc). The core keeps the answers in the log and does what an answer means
for the queue: your energy today sets today's set and its order (priority.py). On a tired or overloaded
day what's left out moves to tomorrow morning in the same command, so one Undo puts it all back.
"""

import json

from . import cards, events, focus, priority, tasks
from .db import FuzzError

ANSWERS = priority.LEVELS
FOLLOW_UPS = ("take_5", "hold_rest", "quick_first")
MOMENT = {"good": "any", "okay": "any", "tired": "low", "overloaded": "quick"}
TOMORROW = {"type": "day_part", "day": "tomorrow", "part": "morning"}


def _hold(core, t):
    # held by a check-in, not by you: it comes back as an ordinary card, never a "keeps coming back"
    tasks.schedule(core, t["id"], TOMORROW, offered_only=False, add_tags=(priority.HOLD_TAG,))


def held_ids(core):
    row = core.one("SELECT value FROM user_state WHERE user_id=? AND key='checkin_held'", (core.user_id,))
    try:
        return json.loads((row or {}).get("value") or "[]")
    except ValueError:
        return []


def record(core, answer, follow_up=None):
    """Write checkin.answered and set your energy for today (and the moment). Tired and overloaded move
    the task cards outside today's set to tomorrow morning, and the Deep work ones to the Deep Work pool;
    hold_rest moves every task card that isn't time-sensitive. All in one command, so one Undo puts them
    all back."""
    if answer not in ANSWERS:
        raise FuzzError(f"answer must be one of {', '.join(ANSWERS)}", "answer")
    if follow_up not in (None,) + FOLLOW_UPS:
        raise FuzzError(f"follow_up must be one of {', '.join(FOLLOW_UPS)}", "follow_up")
    moment = "quick" if follow_up == "quick_first" else MOMENT[answer]
    held, deep = [], []
    with core.tx("human"):
        ch = events.Changes()
        ch.state("moment", moment)
        ch.state("energy", priority.energy_value(core, answer))
        if follow_up == "take_5":
            ch.state("break_until", core.now_iso())
        out = [(c, t) for c, t in cards.queue(core) if c["kind"] == "task" and t]
        if follow_up == "hold_rest":
            held = [t for c, t in out if t.get("deadline_level", 0) == 0]
        elif answer in ("tired", "overloaded"):
            out_ = [(c, t) for c, t in out if not priority.included(answer, set(c["categories"]))
                    and not priority.KEEP_TAGS & set(t.get("variant_tags") or [])]
            # Deep work waits in the Deep Work pool for a session with time, not for tomorrow morning
            deep = [t for c, t in out_ if "deep" in c["categories"]]
            held = [t for c, t in out_ if "deep" not in c["categories"]]
        ch.state("checkin_held", json.dumps(sorted({t["id"] for t in held} | set(held_ids(core)))))
        events.emit(core, "checkin.answered", changes=ch,
                    data={"answer": answer, "follow_up": follow_up, "moment": moment, "held": len(held),
                          "deep_work": len(deep)})
        for t in held:
            _hold(core, t)
        for t in deep:
            tasks.deep_work(core, t["id"], log=("status", "A check-in put this in Deep Work: it waits there for a "
                                                          "session with time and energy for it."))
    return {"moment": moment, "energy": answer, "held": len(held), "deep_work": len(deep)}


def more(core):
    """Momentum ("Sure, just a few more"): one level up (Overloaded → Tired → Okay), and a few of the cards a
    check-in held come back: as many as the new level's stretch, the ones it would put first. The rest stay
    held. Never a card you scheduled yourself."""
    level = priority.energy(core) or "okay"
    new = priority.up(level)
    back = []
    with core.tx("human"):
        ch = events.Changes()
        ch.state("energy", priority.energy_value(core, new))
        ch.state("moment", MOMENT[new])
        ids = held_ids(core)
        rows = [t for t in (tasks.get(core, i) for i in ids)
                if t and t["state"] == "scheduled" and priority.HOLD_TAG in (t.get("variant_tags") or [])]
        ctx = priority.Context(core, [t["id"] for t in rows], focus.focus_ids(core) | focus.weekly_ids(core))
        # a few more, not the whole pile: the new level's stretch, the ones it would put first
        cats = {t["id"]: priority.categories(None, t, ctx) for t in rows}
        order = priority.keys(new, [({"id": t["id"], "kind": "task", "payload": {}}, t, cats[t["id"]],
                                     (t.get("order_key") or 0,)) for t in rows])
        back = sorted((t for t in rows if priority.included(new, cats[t["id"]])), key=lambda t: order[t["id"]])
        back = back[:priority.STRETCH[new]]
        ch.state("checkin_held", json.dumps([i for i in ids if i not in {t["id"] for t in back}]))
        events.emit(core, "checkin.more", changes=ch, data={"from": level, "to": new, "back": len(back)})
        for t in back:
            tasks.bring_back(core, t["id"], tags=(), reason="You had energy for a few more.",
                             log=("status", "Back from tomorrow: you had energy for a few more."))
    return {"energy": new, "back": len(back)}
