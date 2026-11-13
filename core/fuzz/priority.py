"""What a check-in decides: each card's categories, today's set for your energy, and its order
(docs/energy-and-priority.md, issue #9).

Categories are tags, not tiers: a card can carry several. Each is a yes/no test on data the core has.
The names are internal; what the UI says follows docs/fuzz-tone.md.

Your energy is your last check-in answer today (user_state "energy", "<level>@<local date>"). Until
you've answered one today the queue keeps its usual order: urgent, then focus.
"""

import json

from . import timeres
from .db import iso

LEVELS = ("good", "okay", "tired", "overloaded")
DEFAULT_MINS = 15        # a task with no estimate: 15 minutes, normal energy
QUICK_MINS = 5
DEEP_MINS = 30
WARM_UP = 2              # the warm-up on a tired or overloaded day: the quickest one or two
STRETCH = {"good": 5, "okay": 4, "tired": 3, "overloaded": 2}   # cards between check-ins; how many "a few more" brings

CATEGORIES = ("urgent", "vip", "returned", "waiting", "goal", "quick", "low", "deep", "coming_back")

ORDER = {
    "good": ("urgent", "vip", "returned", "waiting", "deep", "coming_back", "goal"),
    "okay": ("urgent", "vip", "returned", "quick", "waiting", "goal", "coming_back"),
    "tired": ("urgent", "vip", "returned", "waiting", "quick", "low"),
    "overloaded": ("urgent", "quick"),
}
RETURNED_KINDS = {"draft", "nudge", "permission"}
RETURNED_TAGS = {"handed_back", "result", "found_out"}
COMING_BACK_TAGS = {"put_off", "stale", "in_the_way"}
# A card asking its own question (a handback, a result, "Still want this?", "Did they get back to you?", a
# booked block, "What's in the way?") would lose it if a check-in moved it: it stays, last, instead
KEEP_TAGS = {"handed_back", "result", "found_out", "review", "check_back", "put_off", "in_the_way", "doing",
             "block", "block_end", "missed_block"}
HOLD_TAG = "checkin_hold"   # held by a check-in: it comes back tomorrow as an ordinary card, not a "coming back"


# ---------------------------------------------------------------- your energy

def today(core):
    return core.now().astimezone(timeres.local_tz(core)).date().isoformat()


def energy(core):
    """Your last check-in answer today, or None."""
    row = core.one("SELECT value FROM user_state WHERE user_id=? AND key='energy'", (core.user_id,))
    level, _, day = ((row or {}).get("value") or "").partition("@")
    return level if level in LEVELS and day == today(core) else None


def energy_value(core, level):
    return f"{level}@{today(core)}"


def up(level):
    """One level up, for momentum: Overloaded → Tired → Okay (Okay and Good stay)."""
    return {"overloaded": "tired", "tired": "okay"}.get(level, level)


def down(level):
    return {"good": "okay", "okay": "tired", "tired": "overloaded"}.get(level, level)


# ---------------------------------------------------------------- VIPs

def vip_list(cfg):
    """Your manager and a few more people, from Settings (config "vips"). Names, emails or Slack IDs."""
    v = cfg.get("vips") or {}
    out = [v.get("manager") or ""] + list(v.get("people") or [])
    return [x.strip() for x in out if isinstance(x, str) and x.strip()]


def is_vip(person, vips):
    """A sender matches by email, Slack ID or full name; a one-word entry ("Priya") matches a first name."""
    if not person or not vips:
        return False
    name = (person.get("name") or "").strip().lower()
    keys = {name, (person.get("email") or "").strip().lower(), (person.get("slack_id") or "").strip().lower()} - {""}
    first = name.split(" ")[0] if name else ""
    for v in vips:
        v = v.lower()
        if v in keys or (" " not in v and "@" not in v and v == first):
            return True
    return False


# ---------------------------------------------------------------- categories

class Context:
    """What the categories need, read once for the whole queue (the same queries for 3 cards or 30)."""

    def __init__(self, core, task_ids, goal=()):
        self.vips = vip_list(core.config)
        self.goal = set(goal)   # in your focus, or this week's active deliverables' (the caller reads focus.py)
        self.senders, self.nudged = {}, set()
        ids = sorted({i for i in task_ids if i})
        if ids:
            marks = ",".join("?" * len(ids))
            for r in core.all(f"SELECT s.task_id, g.payload FROM sources s JOIN signals g ON g.user_id=s.user_id "
                              f"AND g.key=s.signal_key WHERE s.user_id=? AND s.withdrawn=0 "
                              f"AND s.role IN ('origin', 'update') AND s.task_id IN ({marks})",
                              (core.user_id, *ids)):
                p = r["payload"]
                p = json.loads(p) if isinstance(p, str) else (p or {})
                if p.get("from"):
                    self.senders.setdefault(r["task_id"], []).append(p["from"])
                if p.get("nudge"):
                    self.nudged.add(r["task_id"])
        local = core.now().astimezone(timeres.local_tz(core))
        self.day_end = iso(local.replace(hour=23, minute=59, second=59, microsecond=0))   # expires today


def mins(card, task):
    if task is None or card.get("kind") not in ("task", None):
        return 1   # a question, a duplicate, an approval: seconds
    return task.get("effort_mins") or DEFAULT_MINS


def categories(card, task, ctx):
    """The card's categories, a set. card may be None for a task with no card (a held one)."""
    card = card or {"kind": "task", "payload": {}}
    t = task or {}
    tags = set(t.get("variant_tags") or [])
    kind = card.get("kind")
    payload = card.get("payload") or {}
    m = mins(card, task)
    out = set()
    if (t.get("deadline_level") or 0) >= 1 or (t.get("expires_at") and t["expires_at"] <= ctx.day_end):
        out.add("urgent")
    if any(is_vip(p, ctx.vips) for p in ctx.senders.get(t.get("id"), [])):
        out.add("vip")
    if kind in RETURNED_KINDS or tags & RETURNED_TAGS:
        out.add("returned")
    if payload.get("reply_draft") or t.get("id") in ctx.nudged:
        out.add("waiting")
    if t.get("id") in ctx.goal:   # in your focus, or this week's active deliverables'
        out.add("goal")
    if m <= QUICK_MINS:
        out.add("quick")
    if t.get("energy") == "low":
        out.add("low")
    if task is not None and (t.get("energy") == "high" or m >= DEEP_MINS):
        out.add("deep")
    if tags & COMING_BACK_TAGS or (t.get("reschedules") or 0) > 0 or ("returning" in tags and HOLD_TAG not in tags):
        out.add("coming_back")
    return out


def included(level, cats):
    """Is the card in today's set for this energy? Urgent is never left out."""
    if "urgent" in cats or level in (None, "good", "okay"):
        return True
    if "coming_back" in cats:
        return False   # the hardest cards for an ADHD brain: not when tired or overloaded
    if level == "tired":
        return bool(cats & {"vip", "returned", "waiting", "quick", "low"})
    return "quick" in cats and bool(cats & {"vip", "returned"})


def rank(level, cats):
    """Where the card's best category sits in the order for this energy (lower first)."""
    order = ORDER[level]
    if level == "okay" and "coming_back" in cats and "urgent" not in cats:
        return order.index("coming_back")   # late on an okay day, whatever else it is
    hits = [order.index(c) for c in cats if c in order]
    if hits:
        return min(hits)
    return len(order) + 1 if "deep" in cats else len(order)   # Rest; Deep work after it (on Okay)


def soon(task):
    """Due within the hour, or past its time (deadline level 3): it goes ahead of the warm-up."""
    return ((task or {}).get("deadline_level") or 0) >= 3


def keys(level, rows):
    """rows: [(card, task, cats, base)] where base is the tie-break (focus, postponed, order_key).
    Returns {card id: sort key} for the middle of the queue's key: today's set first, then the order for
    your energy, the warm-up and anything due within the hour ahead of it."""
    warm = set()
    if level in ("tired", "overloaded"):
        pool = [(mins(c, t), base, c["id"]) for c, t, cats, base in rows
                if included(level, cats) and cats & ({"quick", "low"} if level == "tired" else {"quick"})
                and not soon(t)]
        warm = {cid for _, _, cid in sorted(pool)[:WARM_UP]}
    out = {}
    for c, t, cats, base in rows:
        inn = included(level, cats)
        if not inn:
            pos = (1, 0, 0)
        elif soon(t):
            pos = (0, -2, 0)
        elif c["id"] in warm:
            pos = (0, -1, mins(c, t))
        else:
            pos = (0, rank(level, cats), mins(c, t) if level == "overloaded" else 0)   # overloaded: quickest first
        out[c["id"]] = pos + tuple(base)
    return out
