"""Cards: every card is a decision. The core owns the kinds and their answers; the AI fills in content.

This module keeps the bookkeeping (one card per task, which card a state needs, queue order,
the view a UI gets). What each answer does lives in answers.py.
"""

from dataclasses import dataclass

from . import events, timeres
from .db import FuzzError

@dataclass(frozen=True)
class CardKind:
    """Everything the core knows about one kind of card, except what its answers do (answers.HANDLERS)."""
    family: str                    # routing | question | approval | deliverables: how the UI lays it out
    prompt: str                    # the question, with {other}, {term} or {resource} from the card
    options: tuple = ()            # its answers; a task card works its own out from the task (task_options)
    suggested: str | None = None   # the answer Fuzz leans toward
    safe: str | None = None        # what "Not sure yet" settles on after POSTPONE_LIMIT (None: just closes it)
    scheduled: bool = False        # carries Schedule options ("Not now" on a draft picks a time)

    @property
    def postpones(self):
        """Offers "Not sure yet", so it can be put off and then settled on its safe answer."""
        return "not_sure" in self.options


CARD_KINDS = {
    "task": CardKind("routing", "What should happen to this?", scheduled=True),
    "duplicate": CardKind("question", "Same as “{other}”?", ("merge", "keep_separate", "not_sure"),
                          suggested="merge", safe="keep_separate"),
    "entity_person": CardKind("question", "Are these the same person?", ("same", "different", "not_sure"),
                              suggested="same", safe="different"),
    "entity_term": CardKind("question", "What is {term}?", ("define", "same_as", "not_sure"), suggested="define"),
    "is_task": CardKind("question", "Is this a task for you?", ("mine", "not_task", "someone_else", "not_sure"),
                        suggested="mine", safe="mine"),
    "draft": CardKind("approval", "Is this draft okay?", ("approve", "edit", "send_back", "schedule", "done"),
                      suggested="approve", scheduled=True),
    "nudge": CardKind("approval", "Can Fuzz chase this reply?", ("approve", "edit", "not_yet", "schedule"),
                      suggested="approve", scheduled=True),
    "permission": CardKind("approval", "Can Fuzz use {resource}?", ("allow_once", "always_allow", "deny"),
                           suggested="allow_once"),
    # a hold on your calendar for booked time (or taking one off)
    "hold": CardKind("approval", "Add a hold for this to your calendar?", ("approve", "always_allow", "skip"),
                     suggested="approve"),
    "part_of": CardKind("deliverables", "Is this part of that deliverable?", ("yes", "no", "not_sure"),
                        suggested="yes", safe="no"),
    # the card's own ask narrows them (payload.options)
    "deliverable": CardKind("deliverables", "Where is this deliverable?",
                            ("keep_going", "make_active", "its_done", "let_go", "not_sure"),
                            suggested="keep_going", safe="keep_going"),
    "deliverable_new": CardKind("deliverables", "Track these tasks as one deliverable?", ("track", "no", "not_sure"),
                                suggested="track", safe="no"),
    "week_plan": CardKind("deliverables", "Which are this week’s active ones?", ("keep_these", "keep_steps", "not_now"),
                          suggested="keep_these"),
    # Was this a decision? (memory/mcards.py)
    "decision": CardKind("question", "Was this a decision?", ("record", "not_decision", "not_sure"),
                         suggested="record", safe="not_decision"),
    # two sources disagree: which is right?
    "fact_conflict": CardKind("question", "Which is right?", ("first", "second", "neither", "not_sure"),
                              suggested="first"),
    # Is it this one? the message Fuzz found for an ask it missed (missed.py)
    "missed": CardKind("question", "Is it this one?", ("yes", "not_quite", "skip"), suggested="yes"),
}


def kind_spec(name):
    if name not in CARD_KINDS:
        raise FuzzError(f"Unknown card kind {name!r}", "kind")
    return CARD_KINDS[name]


# A task card's answers depend on why it's in front of you. schedule is Later (bring it back then); book is
# Book time (hold the time). do_now, after_others and first_step are a big task's choices with book; decide
# and draft_it answer "What's in the way?"
TASK_OPTIONS = ["assign", "deep_work", "session", "schedule", "done", "park", "wait", "someone_else", "drop", "find_out",
                "book", "do_now", "after_others", "first_step", "decide", "draft_it"]
BIG_LEAD = ["do_now", "book", "after_others", "first_step"]   # a big task's card leads with these
DOING_OPTIONS = ["done", "pause", "assign", "deep_work", "session", "book", "find_out"]   # the working card's ways out
WAY_OPTIONS = ["find_out", "do_now", "deep_work", "book", "first_step", "decide", "draft_it", "after_others", "drop"]
REVIEW_OPTIONS = ["keep_parked", "now", "schedule", "drop"]   # a parked task back to ask "Still want this?"
CHECK_BACK_OPTIONS = ["got_it", "nudge", "keep_waiting", "drop"]   # a waiting task back to ask "Did they get back to you?"
# a task you've scheduled again and again, back to ask what's in the way: unclear (Fuzz works out the
# first step), now (it still matters: an ordinary card), or park, let go, or one more time
PUT_OFF_OPTIONS = ["unclear", "now", "book", "schedule", "park", "drop"]
BLOCK_END_OPTIONS = ["done", "keep_going", "book", "pause"]   # a booked block ended: "How far did you get?"
MISSED_OPTIONS = ["book", "schedule", "park", "drop", "done"]   # "The block for this went by. Find another time?"
# The first of these tags a task has picks its card's answers; without one, TASK_OPTIONS (see task_options)
TASK_VARIANTS = (("block_end", BLOCK_END_OPTIONS), ("missed_block", MISSED_OPTIONS), ("doing", DOING_OPTIONS),
                 ("in_the_way", WAY_OPTIONS), ("review", REVIEW_OPTIONS), ("check_back", CHECK_BACK_OPTIONS),
                 ("put_off", PUT_OFF_OPTIONS))
PUT_OFF_PROMPT = "This keeps coming back. Is something in the way?"

# Variant tags that only make sense while the task sits in triage.
TRIAGE_TAGS = {"handed_back", "result", "returning", "reopened", "stale", "review", "check_back", "put_off",
               "found_out", "doing", "block", "after_others", "ask_book", "in_the_way", "first_step",
               "block_end", "missed_block"}


def open_cards(core, task_id):
    return core.all("SELECT * FROM cards WHERE user_id=? AND task_id=? AND status='open' ORDER BY id",
                    (core.user_id, task_id))


def get(core, card_id):
    c = core.one("SELECT * FROM cards WHERE id=? AND user_id=?", (card_id, core.user_id))
    if c is None:
        raise FuzzError(f"No card {card_id}", "card_id", 404)
    return c


def next_order(core, where="back"):
    if where == "front":
        row = core.one("SELECT COALESCE(MIN(order_key), 0) m FROM cards WHERE user_id=?", (core.user_id,))
        return row["m"] - 1
    row = core.one("SELECT COALESCE(MAX(order_key), 0) m FROM cards WHERE user_id=?", (core.user_id,))
    return row["m"] + 1


def withdraw(core, ch, task_id, keep=None):
    """Close the open cards of a task that is leaving the state they were about. A duplicate card that asks
    about other tasks too stays, on the next of them."""
    from .matching import dupes
    for c in open_cards(core, task_id):
        if c["id"] != keep and ch.pending("cards", c["id"]).get("status", "open") == "open":
            rest = [d["id"] for d in dupes.card_dupes(core, c) if d["id"] != task_id] if c["kind"] == "duplicate" else []
            if rest:
                dupes.rehome(core, c, rest, c["other_id"], ch=ch)
            else:
                ch.card(c["id"], status="withdrawn")


def mark_answered(core, ch, card, option, value=None):
    ch.card(card["id"], status="answered", answer={"option": option, "value": value})


def create(core, kind, task_id=None, other_id=None, prompt=None, reason=None, suggested=None, payload=None,
           where="back"):
    """Write card.created. Runs inside the caller's transaction, so it joins the caller's undo group."""
    from . import tasks
    cid = core.new_id("cards")
    ch = events.Changes()
    payload = dict(payload or {})
    if where == "next":   # right after the card in front (a Find out… answer that just landed)
        front = queue(core)
        payload.update(next=True, after=front[0][0]["id"] if front else None)
    spec = kind_spec(kind)
    fields = dict(kind=kind, task_id=task_id, other_id=other_id, prompt=prompt, reason=reason,
                  suggested=suggested or spec.suggested, payload=payload, status="open",
                  postponed=0, order_key=next_order(core, "back" if where == "next" else where),
                  created_at=core.now_iso())
    if kind != "task":
        fields["options"] = list(spec.options)
    if spec.scheduled:
        fields["schedule_options"] = timeres.build_options(core, tasks.get(core, task_id))
    ch.card(cid, **fields)
    events.emit(core, "card.created", task_id=task_id, changes=ch, data={"kind": kind, "card_id": cid})
    return cid


def sync(core, task_id, where="back"):
    """Make sure a task has the card its state calls for. Call at the end of any command that moves a task.

    where: "front" puts a new card at the head of the queue (you pulled it back, a reply came in); "next"
    right after the card in front (a Find out… answer)."""
    from . import tasks
    t = tasks.get(core, task_id)
    if t is None:
        return None
    open_ = open_cards(core, task_id)
    tags = t.get("variant_tags") or []
    from .matching import dupes
    if t["state"] in ("merged", "done", "letgo"):   # cards asking whether others are the same as this one
        dupes.settle(core, task_id)
        return None
    if t["state"] == "triage" and not open_:   # asked about on another task's duplicate card, with it
        folded = dupes.folded_into(core, t)
        if folded:
            return folded["id"]
    if t["state"] == "triage" and not open_ and "missed_found" in tags:
        return None   # its "Is it this one?" card is made with the find (missed.report) and comes back with Undo
    if t["state"] == "triage" and not open_ and "unconfirmed" in tags:
        # Asks from one message that may not be yours share one card, so a broadcast email is one answer
        c = _asking_card(core, t)
        if c is None:
            return create(core, "is_task", task_id, reason=t.get("reason"), payload={"asks": [task_id]}, where=where)
        have = (c.get("payload") or {}).get("asks") or [c["task_id"]]
        if task_id not in have:
            ch = events.Changes()
            ch.card(c["id"], payload=dict(c.get("payload") or {}, asks=have + [task_id]))
            events.emit(core, "card.updated", task_id=c["task_id"], changes=ch,
                        data={"kind": "is_task", "card_id": c["id"], "added": task_id})
        return c["id"]
    if t["state"] == "triage" and not open_:
        from . import drafts
        reply = not tags and drafts.group_reply(core, t)   # a late ask from a thread whose reply waits for your OK
        if reply:
            return create(core, "task", task_id, payload={"reply_draft": reply["id"]}, suggested="add_to_reply",
                          reason=f"A reply to {_group_title(core, t)} is waiting for your OK. Add this to it?", where=where)
        from . import booking
        if "block_end" in tags:
            return create(core, "task", task_id, reason=t.get("reason"), prompt="How far did you get?", suggested="done",
                          where="front" if where == "back" else where)
        if "missed_block" in tags:
            return create(core, "task", task_id, reason=t.get("reason"), prompt="The block for this went by. Find another time?",
                          suggested="book", where=where)
        if "doing" in tags:   # the working card: Do it now, a booked block starting, or step 1 of a big one
            return create(core, "task", task_id, reason=t.get("reason"), suggested="done",
                          prompt="Step 1 is about two minutes. Then book the rest." if "first_step" in tags
                          else "You’re on this one.", where="front" if where == "back" else where)
        if "in_the_way" in tags:
            from .tasks import WAY_PROMPT
            return create(core, "task", task_id, reason=t.get("reason"), prompt=WAY_PROMPT, suggested="find_out",
                          payload={"at_end": True}, where=where)
        if "ask_book" in tags or "after_others" in tags:
            return create(core, "task", task_id, reason=t.get("reason"),
                          suggested="book" if "ask_book" in tags else "do_now",
                          payload={"at_end": True} if "after_others" in tags else None, where=where)
        return create(core, "task", task_id, reason=t.get("reason"),
                      prompt=PUT_OFF_PROMPT if "put_off" in tags else None,
                      suggested="book" if booking.is_big(core, t) and not t.get("gaps") and not (
                          {"review", "check_back", "put_off", "stale", "result", "handed_back"} & set(tags))
                      else review_suggests(core, t) if "review" in tags else "nudge" if "check_back" in tags
                      else "unclear" if "put_off" in tags else "keep" if "stale" in tags else "done" if "result" in tags
                      # the brief has gaps: finding out comes first
                      else "find_out" if t.get("gaps") and "found_out" not in tags
                      else ("quick" if t.get("quick_answers") else "assign"),
                      where="back" if "handed_back" in tags else where)
    if t["state"] == "review" and not any(c["kind"] in ("draft", "nudge") for c in open_):
        d = core.one("SELECT * FROM drafts WHERE task_id=? AND status='pending' AND kind NOT IN ('calendar_hold', "
                     "'calendar_remove') ORDER BY id DESC LIMIT 1", (task_id,))
        if d:
            kind = "nudge" if d["kind"].startswith("nudge") else "draft"
            from .drafts import guessed
            g = guessed(d)
            if g:   # rule 4: a guess can't drive a send on its own, so Edit comes first
                return create(core, kind, task_id, payload={"draft_id": d["id"], "guessed": g}, suggested="edit",
                              reason="Fuzz guessed " + "; ".join(x["text"] for x in g) + ". Check it before it goes.")
            return create(core, kind, task_id, payload={"draft_id": d["id"]})
    return None


def _asking_card(core, t):
    """The open is_task card of another task from the same origin, which this one's ask joins."""
    if not t.get("group_id"):
        return None
    return core.one("SELECT c.* FROM cards c JOIN tasks t ON t.id=c.task_id WHERE c.user_id=? AND c.kind='is_task' "
                    "AND c.status='open' AND t.group_id=? AND c.task_id!=? ORDER BY c.id LIMIT 1",
                    (core.user_id, t["group_id"], t["id"]))


def asks(core, card):
    """What an is_task card asks about: its own task first, then the ones folded in, each only while it is
    still in triage waiting for the answer."""
    from . import tasks
    ids = dict.fromkeys([card["task_id"]] + ((card.get("payload") or {}).get("asks") or []))
    out = [tasks.get(core, i) for i in ids]
    return [t for t in out if t and t["state"] == "triage" and "unconfirmed" in (t.get("variant_tags") or [])]


def covered(core, t):
    """A task with no card of its own because another task's is_task or duplicate card asks about it too."""
    from .matching import dupes
    c = _asking_card(core, t)
    return bool(c) and t["id"] in ((c.get("payload") or {}).get("asks") or []) or bool(dupes.folded_into(core, t))


def refresh_schedule_options(core, ch, task_id):
    from . import tasks
    t = dict(tasks.get(core, task_id))
    t.update(ch.pending("tasks", task_id))
    for c in open_cards(core, task_id):
        if CARD_KINDS[c["kind"]].scheduled:
            ch.card(c["id"], schedule_options=timeres.build_options(core, t))


def review_suggests(core, t):
    """Kept parked through enough reviews already: the card leans toward letting it go."""
    return "drop" if (t.get("reviews") or 0) >= core.config["review"]["let_go_after"] else "keep_parked"


def task_options(task):
    tags = task.get("variant_tags") or []
    for tag, opts in TASK_VARIANTS:
        if tag in tags:
            return list(opts)
    opts = list(TASK_OPTIONS)
    if "stale" in tags:
        opts.insert(0, "keep")
    if "handed_back" in tags and task.get("quick_answers"):
        opts.insert(0, "quick")
    return opts


def _group_title(core, t):
    g = core.one("SELECT title FROM groups WHERE id=?", (t["group_id"],))
    return f"“{g['title']}”" if g else "this thread"


def options(card, task):
    if card["kind"] == "task":
        opts = task_options(task)
        if (card.get("payload") or {}).get("reply_draft"):
            opts.insert(0, "add_to_reply")
        return opts
    if card["kind"] in ("draft", "nudge"):   # the kind's options now, so a card made before Schedule can use it
        return list(CARD_KINDS[card["kind"]].options)
    if card["kind"] == "deliverable" and (card.get("payload") or {}).get("options"):
        return list(card["payload"]["options"])
    if card["kind"] == "week_plan":
        return ["keep_steps", "not_now"] if (card.get("payload") or {}).get("steps") else ["keep_these", "not_now"]
    return card.get("options") or list(CARD_KINDS[card["kind"]].options)


# ---------------------------------------------------------------- the queue

def moment(core):
    row = core.one("SELECT value FROM user_state WHERE user_id=? AND key='moment'", (core.user_id,))
    return (row or {}).get("value") or "any"


def queue(core, front=None):
    """Open cards in triage order: the working card (a booked block), then time-sensitive, then your focus,
    handbacks and postponed last, then the moment, then order. A card you sent to the end of the list waits
    behind all of them, deadline or not. front: the card on screen, which stays first while it's open (a
    focus or a refined focus never changes the card in front)."""
    from . import focus
    m = moment(core)
    fids = focus.focus_ids(core)
    cards = core.all("SELECT * FROM cards WHERE user_id=? AND status='open'", (core.user_id,))
    by_id = {t["id"]: t for t in core.all(   # every card's task in one query, not one each
        "SELECT * FROM tasks WHERE user_id=? AND id IN (SELECT task_id FROM cards WHERE user_id=? AND status='open')",
        (core.user_id, core.user_id))}
    keyed = []
    for c in cards:
        t = by_id.get(c["task_id"]) if c["task_id"] else None
        tags = (t or {}).get("variant_tags") or []
        urgent = 0 if t and t.get("deadline_level", 0) >= 1 else 1
        back = 1 if ("handed_back" in tags or c["postponed"]) else 0
        fits = 0
        if m == "quick":
            fits = 0 if (t and (t.get("effort_mins") or 99) <= 5) else 1
        elif m == "low":
            fits = 0 if (t and t.get("energy") == "low") else 1
        at_end = 1 if (c.get("payload") or {}).get("at_end") else 0
        # the working card (Do it now, or a booked block that started) is first, ahead of deadlines; so are
        # Monday's deliverable cards, that day
        doing = 0 if ("doing" in tags and c["kind"] == "task") or (c.get("payload") or {}).get("monday") else 1
        infocus = 0 if t and t["id"] in fids else 1
        k = (doing, at_end, urgent, infocus, back, fits, c["order_key"] or 0)
        keyed.append((k, c, t))
    out = [(c, t) for _, c, t in sorted(_back_to_back(core, keyed), key=lambda x: x[0])]
    # A Find out… answer that landed comes next, right after the card in front, which never changes under you
    # (and once that card is answered, it's the one in front)
    nxt = [x for x in out if (x[0].get("payload") or {}).get("next")]
    if nxt:
        rest = [x for x in out if not (x[0].get("payload") or {}).get("next")]
        behind = rest[:1] if rest and any((x[0].get("payload") or {}).get("after") == rest[0][0]["id"] for x in nxt) else []
        out = behind + nxt + rest[len(behind):]
    if front is not None:   # the card on screen stays first
        pin = [x for x in out if x[0]["id"] == front]
        out = pin + [x for x in out if x[0]["id"] != front]
    return out


def _back_to_back(core, keyed):
    """A group's cards come one after another, where its first one would be; the group you're working
    through comes before everything else, new arrivals and deadlines too. A card you sent to the end
    stays there. Returns the rows with their final keys."""
    from . import groups
    run = groups.run(core)
    lead = {}
    for k, c, t in keyed:
        gid = (t or {}).get("group_id")
        if gid and k[0] and not k[1] and c["kind"] in groups.ROUTING:
            lead.setdefault(gid, []).append(k)
    lead = {g: min(ks) for g, ks in lead.items() if len(ks) > 1 or (run and run["group_id"] == g)}
    out = []
    for k, c, t in keyed:
        gid = (t or {}).get("group_id")
        if not k[0]:   # the working card stays first
            out.append(((-1,) + k + (0,) + k, c, t))
        elif gid in lead and not k[1] and c["kind"] in groups.ROUTING:
            first = 0 if run and run["group_id"] == gid else 1
            out.append(((first,) + lead[gid] + (gid,) + k, c, t))
        else:
            out.append(((1,) + k + (0,) + k, c, t))
    return out


def task_summary(t):
    if t is None:
        return None
    keys = ("id", "state", "assignee", "title", "ask", "owner", "due", "context_md", "summary", "question",
            "quick_answers", "variant_tags", "reason", "effort_mins", "energy", "deadline_level", "notes", "waiting_on",
            "schedule_anchor", "schedule_fire_at", "created_at", "state_changed_at", "group_id", "next_step",
            "reschedules", "step_count", "gaps", "find_out")
    return {k: t.get(k) for k in keys}


def view(core, card, task=None):
    """The card as a UI gets it: the decision, its answers and what it is about."""
    from . import tasks
    task = task if task is not None else (tasks.get(core, card["task_id"]) if card["task_id"] else None)
    other = tasks.get(core, card["other_id"]) if card.get("other_id") and card["kind"] == "duplicate" else None
    payload = card.get("payload") or {}
    if card["kind"] == "entity_person" and card["status"] == "open":   # where each one came up, as of now
        from .memory import mcards
        payload = mcards.upgrade_person(core, payload)
        payload = dict(payload, profiles=mcards.fresh_profiles(core, payload))
    prompt = card.get("prompt")
    suggested, reason = card.get("suggested"), card.get("reason")
    if card["kind"] == "entity_person" and card["status"] == "open" and payload.get("name"):
        prompt = mcards.which_prompt(core, payload)
        reason = f"“{payload['name']}” came up by first name only, and nothing on its messages says who it is."
        top = (payload.get("profiles") or [{}, {}])[1:2] or [{}]
        if not top[0].get("why"):   # nothing links them: Fuzz doesn't lean either way
            suggested = None
    if card["kind"] in ("task", "draft", "nudge", "is_task") and task and task.get("question"):
        prompt = task["question"]
    many = asks(core, card) if card["kind"] == "is_task" and card["status"] == "open" else []
    if not prompt and len(many) > 1:
        prompt = "Are any of these yours?"
    if card["kind"] == "duplicate" and card["status"] == "open":
        from .matching import dupes
        same = dupes.card_dupes(core, card)
    else:
        same = []
    if not prompt and len(same) > 1:
        prompt = f"Are these {len(same)} the same as “{(other or {}).get('title', 'another task')}”?"
    if not prompt:
        prompt = CARD_KINDS[card["kind"]].prompt.format(other=(other or {}).get("title", "another task"),
                                              term=payload.get("term", "this"),
                                              resource=payload.get("resource", "this"))
    out = {"id": card["id"], "kind": card["kind"], "family": CARD_KINDS[card["kind"]].family, "status": card["status"],
           "prompt": prompt, "reason": reason or (task or {}).get("reason"),
           "options": options(card, task or {}), "suggested": suggested,
           "postponed": card["postponed"], "payload": payload, "task": task_summary(task),
           "created_at": card.get("created_at")}
    if len(many) > 1:
        out["asks"] = [task_summary(a) for a in many]
    if len(same) > 1:   # one answer settles them all
        out["dupes"] = [task_summary(d) for d in same]
    if card["kind"] == "task":
        out["schedule_options"] = card.get("schedule_options") or []
        if task:   # its size, a big task's four choices, and the times Book time offers
            from . import booking
            sz = booking.size(core, task)
            if sz:
                out["size"] = sz
            plain = not ({"review", "check_back", "put_off", "doing", "result", "handed_back"} & set(task.get("variant_tags") or []))
            if sz and sz["big"] and plain:
                out["lead"] = list(BIG_LEAD)
            if "book" in out["options"]:
                out["book_options"] = booking.options(core, task)
    elif CARD_KINDS[card["kind"]].scheduled:   # a draft card made before it had Schedule options works them out now
        out["schedule_options"] = card.get("schedule_options") or (timeres.build_options(core, task) if task else [])
    if other:
        out["other"] = task_summary(other)
    if payload.get("draft_id"):
        from . import drafts
        d = core.one("SELECT * FROM drafts WHERE id=?", (payload["draft_id"],))
        out["draft"] = d
        if d and task:
            out["after_approve"] = drafts.after_approve(core, d, task)
    return out
