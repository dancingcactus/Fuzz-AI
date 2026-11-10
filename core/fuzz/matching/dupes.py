"""Catching the duplicates matching's own passes miss (design: "Catching duplicates").

Three gaps, all closed here with code, no judge:
  - a task you capture never went through matching. After it's gathered (or straight away with gathering
    off) it gets a matching record of its own: a signal and a candidate from its ask and the links Fuzz
    found, kept as a source with role "ignored" so no list shows it. That gives it entities and a vector,
    so later signals can find it, and it's checked against the open tasks now.
  - asks judged in one run couldn't see each other: a shortlist is frozen before earlier candidates in the
    run create their tasks. A "new" verdict is checked against the tasks made since its shortlist froze.
  - a ticket key or document link two tasks share is the identifier that stays the same across email,
    Slack and meetings, so it counts as a match whichever channels they came from. A link on many live
    tasks (a wiki home page) doesn't.
A likely match becomes a duplicate card, one per task they may be the same as: a second possible duplicate
of the same task joins the open card. The same ask again from the same sender in one run (a reminder sent
five times) isn't asked about at all: it's folded into the first. When the task they may be the same as
closes, settle() answers its cards for you.
likely() also ranks the choices for "Same as…" in task detail.
"""

import json
import re

from .. import cards, events, states, tasks
from . import entities, matcher, vectors

LINK_COMMON = 3                               # a link on more than this many live tasks is too common to count
DUP_SEM = {"hash": 0.75, "ollama": 0.85}      # meaning alone, close enough to ask
PEOPLE_SEM = {"hash": 0.5, "ollama": 0.75}    # sharing only people (never your regulars), with meaning this close
SAME_AS_LIMIT = 5


# ---------------------------------------------------------------- identifiers: tickets and document links

def ident(url):
    """A link as an identifier, or None when it's too general to say anything (a site's home page)."""
    i = entities.normalize_url(url or "")
    if i.startswith(("ticket:", "gdoc:")):
        return i
    host, _, path = i.partition("/")
    return f"doc:{i}" if host and path.strip("/") else None


def _idents(links, *texts):
    out = {x for x in (ident(u) for u in links or []) if x}
    out |= {"ticket:" + k for k in entities.tickets_in(*texts)}
    return out


def task_idents(core, t):
    """The tickets and documents a task points to: its link sources, the links of the messages behind it,
    and ticket keys in its title and ask."""
    links = [r["link"] for r in core.all("SELECT link FROM sources WHERE task_id=? AND user_id=? AND role='link' "
                                         "AND withdrawn=0 AND link IS NOT NULL", (t["id"], core.user_id))]
    texts = [t["title"], t["ask"]]   # a dict or a raw row
    for r in core.all("SELECT c.payload cp, g.payload gp FROM sources s JOIN candidates c ON c.id=s.candidate_id "
                      "JOIN signals g ON g.key=c.signal_key AND g.user_id=c.user_id "
                      "WHERE s.task_id=? AND s.user_id=? AND s.withdrawn=0", (t["id"], core.user_id)):
        cp, gp = json.loads(r["cp"] or "{}"), json.loads(r["gp"] or "{}")
        links += (cp.get("links") or []) + (gp.get("links") or [])
        texts += [cp.get("ask"), gp.get("quote")]
    return _idents(links, *texts)


def cand_idents(ctx, cand):
    s = matcher.candidate_signal(ctx, cand)
    c = json.loads(cand["payload"]) if isinstance(cand["payload"], str) else (cand["payload"] or {})
    return _idents((c.get("links") or []) + (s.get("links") or []), cand["ask"], s.get("quote"))


def _shared(core, mine, others):
    """{task_id: [idents shared with mine]}, leaving out idents that are on too many live tasks."""
    idx = {tid: task_idents(core, t) for tid, t in others.items()}
    live = [tid for tid, t in others.items() if t["state"] in states.LIVE]
    common = {i for i in mine if sum(i in idx[tid] for tid in live) > LINK_COMMON}
    return {tid: sorted((mine & ids) - common) for tid, ids in idx.items() if (mine & ids) - common}


# ---------------------------------------------------------------- scoring

def _not_to_ask(core, task_id):
    """Tasks you already said differ from this one, or that it's already being asked about."""
    out = set()
    for r in core.all("SELECT a, b FROM task_links WHERE (a=? OR b=?) AND kind IN ('kept_separate', 'possible_duplicate')",
                      (task_id, task_id)):
        out.add(r["b"] if r["a"] == task_id else r["a"])
    return out


def likely(ctx, cand, others, strict=True):
    """Tasks the candidate is likely the same as, best first: [(task_id, reason, scores)].

    strict: only ones close enough to ask about (a shared ticket or document, or very close in meaning).
    Otherwise the ranked shortlist "Same as…" offers."""
    if not others:
        return []
    fam = matcher._family(ctx.embedder.model) if ctx.embedder else "hash"
    shared = _shared(ctx.core, cand_idents(ctx, cand), others)
    escore, names = matcher.stage2_entities(ctx, cand, others)
    sem = matcher.stage3_semantic(ctx, cand, list(others)) or {}
    out = []
    mine = _words(cand["ask"])
    for tid in others:
        e, s, link = escore.get(tid, 0), sem.get(tid, 0), shared.get(tid)
        # the same words: works with no embedder (Ollama down), where meaning can't be measured
        same_words = max(_overlap(mine, _words(others[tid]["title"])), _overlap(mine, _words(others[tid]["ask"]))) >= WORDS_SAME
        # the same people alone never make two asks the same: they need to mean nearly the same thing too
        people_only = all(n.startswith("person:") for n in names.get(tid, []))
        close = (bool(link) or s >= DUP_SEM[fam] or same_words
                 or (e >= matcher.STRONG_ENTITY and s >= (PEOPLE_SEM if people_only else matcher.SEM_MIN_ENTITY)[fam]))
        loose = close or s >= matcher.SEM_FLOOR[fam] or e >= matcher.ENTITY_MIN
        if not (close if strict else loose):
            continue
        why = (f"Both point to {_name(link[0])}" if link else
               f"Same {', '.join(n.split(':', 1)[1] for n in names.get(tid, [])[:2])}" if e >= matcher.STRONG_ENTITY
               else "Asks for nearly the same thing")
        out.append((tid, why, {"link": link or [], "entity": e, "semantic": s}))
    out.sort(key=lambda x: (bool(x[2]["link"]), x[2]["semantic"], x[2]["entity"]), reverse=True)
    return out


WORDS_SAME = 0.8   # share of words two asks have in common to count as the same ask


def _words(text):
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in vectors.STOP and len(w) > 1}


def _overlap(a, b):
    return len(a & b) / len(a | b) if a and b else 0.0


def _name(i):
    kind, _, rest = i.partition(":")
    if kind == "ticket":
        return rest
    if kind == "gdoc":
        return "the same Google file"
    return tasks.link_title("https://" + rest)


# ---------------------------------------------------------------- a captured task's matching record

def _captured(core, t):
    return bool(core.one("SELECT id FROM events WHERE user_id=? AND task_id=? AND type='task.captured'",
                         (core.user_id, t["id"])))


def _yours(core):
    return {r["task_id"] for r in core.all("SELECT task_id FROM events WHERE user_id=? AND type='task.captured' "
                                           "AND actor='human'", (core.user_id,))}


def capture_key(task_id):
    return f"capture:task{task_id}:1"


def _cand(core, key):
    """A candidate row as matching reads it (payload still JSON text)."""
    return core.q("SELECT * FROM candidates WHERE user_id=? AND signal_key=?", (core.user_id, key)).fetchone()


def _record(ctx, t):
    """Give a captured task the signal and candidate matching keeps for every other task, once. Returns the candidate."""
    core = ctx.core
    key = capture_key(t["id"])
    row = _cand(core, key)
    if row:
        return row
    links = [r["link"] for r in core.all("SELECT link FROM sources WHERE task_id=? AND user_id=? AND role='link' "
                                         "AND withdrawn=0 AND link IS NOT NULL ORDER BY id", (t["id"], core.user_id))]
    ask = (t.get("ask") or t["title"]).strip()
    sig = {"source": "capture", "source_id": f"task{t['id']}", "version": "1", "quote": ask[:600], "links": links,
           "candidates": [{"ask": ask[:300], "owner": "me", "links": links}]}
    matcher.ingest(ctx, [sig])
    row = _cand(core, key)
    core.q("UPDATE candidates SET status='decided' WHERE id=?", (row["id"],))
    core.q("INSERT OR IGNORE INTO sources (user_id, task_id, candidate_id, signal_key, role, title, added_run) "
           "VALUES (?,?,?,?,?,?,?)", (core.user_id, t["id"], row["id"], key, "ignored", "For matching", ctx.run_id))
    matcher._add_anchors(ctx, t["id"], row)   # a ticket in it is an anchor, as on any other task
    return row


def check_captured(core, task_id, embedder=None):
    """Match a task you captured, once it's been looked up (or straight away with gathering off). A likely
    match becomes a duplicate card, which comes before the task's own card. Returns the other task's id, or None."""
    t = tasks.get(core, task_id)
    if not t or t["state"] not in states.LIVE or not _captured(core, t):
        return None
    ctx = matcher.Context(core, embedder)
    with core.tx("system"):
        cand = _record(ctx, t)
        # Against what arrived from elsewhere: two things you typed yourself are yours to tell apart
        skip = _not_to_ask(core, t["id"]) | {t["id"]} | _yours(core)
        others = {tid: r for tid, r in matcher.eligible_tasks(ctx).items() if tid not in skip and r["state"] in states.LIVE}
        hits = likely(ctx, cand, others)
        if not hits:
            return None
        other, why, scores = hits[0]
        ask(core, t["id"], other, why, scores.get("semantic"))
    return other


def ask(core, task_id, other_id, why, confidence=None):
    """A duplicate card on task_id about other_id, before its own card: the routing card waits until it's answered."""
    core.q("INSERT OR REPLACE INTO task_links VALUES (?,?,?,?,?)", (task_id, other_id, "possible_duplicate", confidence, why))
    open_ = cards.open_cards(core, task_id)
    if any(c["kind"] == "duplicate" for c in open_):
        return None
    ch = events.Changes()
    for c in open_:
        if c["kind"] == "task":
            ch.card(c["id"], status="withdrawn")
    if not ch.empty():
        events.emit(core, "card.updated", task_id=task_id, changes=ch, data={"kind": "task", "why": "duplicate_first"})
    return card_for(core, task_id, other_id, why, where="front")


# ---------------------------------------------------------------- the same run

def run_mates(ctx, cand, frozen_after):
    """Tasks matching made after this candidate's shortlist froze, except asks from the same message."""
    if frozen_after is None:
        return {}
    core = ctx.core
    rows = core.all("SELECT DISTINCT task_id FROM decisions WHERE user_id=? AND id>? AND task_id IS NOT NULL "
                    "AND outcome IN ('new', 'possible_duplicate', 'related')", (core.user_id, frozen_after))
    siblings = matcher._sibling_tasks(ctx, cand)
    out = {}
    for r in rows:
        t = tasks.live(core, r["task_id"])
        if t and t["id"] not in siblings and t["state"] in states.LIVE:
            out[t["id"]] = t
    return out


def same_run(ctx, cand, frozen_after):
    """The task an ask judged new is likely the same as, among those made since its shortlist froze:
    (task_id, reason, semantic, repeat) or None. repeat: it's the same ask again from the same sender (a
    reminder email sent five times), which matching folds in rather than asking you."""
    hits = likely(ctx, cand, run_mates(ctx, cand, frozen_after))
    if not hits:
        return None
    tid, why, scores = hits[0]
    who = repeat_of(ctx, cand, tid)
    if who:
        return tid, f"The same ask from {who} again, after #{tid} in the same run", scores.get("semantic"), True
    return tid, f"{why}, and came in with #{tid} in the same run", scores.get("semantic"), False


REPEAT_WORDS = 0.9   # share of words two asks have in common to be the same ask repeated
NOT_SENDERS = ("fuzz", "capture")   # asks Fuzz or you made: there's no one repeating themselves


def _sender(s):
    """Who sent a signal, as one comparable string: their email, Slack id or else their name."""
    f = s.get("from") or {}
    key = f.get("email") or f.get("slack_id") or f.get("name")
    return key.strip().lower() if isinstance(key, str) and key.strip() else None


def repeat_of(ctx, cand, task_id):
    """The sender's name when the candidate is the ask task_id came from, sent again: the same sender and
    nearly the same words. None otherwise."""
    s = matcher.candidate_signal(ctx, cand)
    me = _sender(s)
    if not me or s.get("source") in NOT_SENDERS:
        return None
    origin = ctx.core.q("SELECT c.* FROM sources so JOIN candidates c ON c.id=so.candidate_id WHERE so.task_id=? "
                        "AND so.user_id=? AND so.role='origin' ORDER BY so.id LIMIT 1",
                        (task_id, ctx.core.user_id)).fetchone()
    if origin is None:
        return None
    o = matcher.candidate_signal(ctx, origin)
    if o.get("source") != s.get("source") or _sender(o) != me:
        return None
    if _overlap(_words(cand["ask"]), _words(origin["ask"])) < REPEAT_WORDS:
        return None
    return (s.get("from") or {}).get("name") or "the same sender"


# ---------------------------------------------------------------- one card per task they're the same as

def card_dupes(core, card):
    """The tasks a duplicate card asks about, its own first, then the ones folded in, each only while it
    still waits for the answer (in triage)."""
    ids = dict.fromkeys([card["task_id"]] + ((card.get("payload") or {}).get("dupes") or []))
    out = [tasks.get(core, i) for i in ids]
    return [t for t in out if t and t["state"] == "triage"]


def _open_card_about(core, other_id, but=None):
    return core.one("SELECT * FROM cards WHERE user_id=? AND kind='duplicate' AND status='open' AND other_id=? "
                    "AND task_id IS NOT ? ORDER BY id LIMIT 1", (core.user_id, other_id, but))


def card_for(core, task_id, other_id, why, where="back"):
    """The duplicate card asking whether task_id is the same as other_id. One card per task they may be the
    same as: a second possible duplicate of #162 joins the open card about #162, so one answer settles them
    all. Returns the card id."""
    c = _open_card_about(core, other_id, but=task_id)
    if c is None:
        return cards.create(core, "duplicate", task_id, other_id=other_id, reason=why, suggested="merge", where=where)
    p = dict(c.get("payload") or {})
    have = p.get("dupes") or []
    if task_id not in have and task_id != c["task_id"]:
        ch = events.Changes()
        ch.card(c["id"], payload=dict(p, dupes=have + [task_id]))
        events.emit(core, "card.updated", task_id=c["task_id"], changes=ch,
                    data={"kind": "duplicate", "card_id": c["id"], "added": task_id})
    return c["id"]


def folded_into(core, t):
    """The open duplicate card another task holds that asks about t too, or None."""
    for c in core.all("SELECT * FROM cards WHERE user_id=? AND kind='duplicate' AND status='open' AND task_id!=?",
                      (core.user_id, t["id"])):
        if t["id"] in ((c.get("payload") or {}).get("dupes") or []):
            return c
    return None


# ---------------------------------------------------------------- the task they're the same as closes

def settle(core, target_id):
    """The open duplicate cards about a task that just left your queue. cards.sync runs it after any move.

    Merged into another task: the cards ask about that one instead. Done or let go: the possible duplicates
    follow it in, since your answer about it is the answer about the same ask again (split one back out if
    it isn't); the card is answered for you. Merged into one of the possible duplicates: nothing to ask."""
    t = tasks.get(core, target_id)
    if t is None or t["state"] not in ("merged", "done", "letgo"):
        return
    for c in core.all("SELECT * FROM cards WHERE user_id=? AND kind='duplicate' AND status='open' AND other_id=?",
                      (core.user_id, target_id)):
        into = tasks.live(core, target_id)
        dupes = card_dupes(core, c)
        rest = [d["id"] for d in dupes if into is None or d["id"] != into["id"]]
        if into is None or not rest:
            _withdraw(core, c, "target_closed")
        elif into["id"] in {d["id"] for d in dupes}:   # merged into one of them: the rest ask about that one
            rehome(core, c, rest, into["id"])
        elif into["state"] in ("done", "letgo"):
            how = ("someone else’s" if "theirs" in (into.get("variant_tags") or []) else
                   "done" if into["state"] == "done" else "let go")
            for i, d in enumerate(dupes):
                matcher.merge(core, d["id"], into["id"], card=c if i == 0 else None, actor="system",
                              log=f"#{into['id']} is {how}, so Fuzz merged in #{d['id']}, the same ask "
                                  f"(“{d['title']}”). Split it back out if it isn’t.")
        else:
            rehome(core, c, rest, into["id"])


def rehome(core, c, ids, other_id, ch=None):
    """Point a duplicate card at ids (the first is its own task) and other_id. With ch, it joins the
    caller's change instead of emitting its own (cards.withdraw, while the card's own task moves on)."""
    fields = dict(task_id=ids[0], other_id=other_id, payload=dict(c.get("payload") or {}, dupes=ids[1:]))
    if ch is not None:
        ch.card(c["id"], **fields)
        return
    with core.tx("system"):
        ch = events.Changes()
        ch.card(c["id"], **fields)
        events.emit(core, "card.updated", task_id=ids[0], changes=ch,
                    data={"kind": "duplicate", "card_id": c["id"], "other_id": other_id, "was": c["other_id"]})


def _withdraw(core, c, why):
    with core.tx("system"):
        ch = events.Changes()
        ch.card(c["id"], status="withdrawn")
        events.emit(core, "card.updated", task_id=c["task_id"], changes=ch,
                    data={"kind": "duplicate", "card_id": c["id"], "why": why})
        for d in card_dupes(core, c):   # the ones folded in get a card of their own
            cards.sync(core, d["id"])


# ---------------------------------------------------------------- "Same as…" in task detail

def same_as_choices(core, task_id, embedder=None):
    """The open tasks this one is most likely the same as, for "Same as…": [{task_id, title, state, why}]."""
    t = tasks.require(core, task_id)
    ctx = matcher.Context(core, embedder)
    with core.tx("system"):
        cand = _candidate_for(ctx, t)
        if cand is None:
            return []
        skip = {r["b"] if r["a"] == t["id"] else r["a"] for r in core.all(
            "SELECT a, b FROM task_links WHERE (a=? OR b=?) AND kind='kept_separate'", (t["id"], t["id"]))} | {t["id"]}
        others = {tid: r for tid, r in matcher.eligible_tasks(ctx).items() if tid not in skip and r["state"] in states.LIVE}
        hits = likely(ctx, cand, others, strict=False)[:SAME_AS_LIMIT]
    return [{"task_id": tid, "title": others[tid]["title"], "state": others[tid]["state"], "why": why}
            for tid, why, _ in hits]


def _candidate_for(ctx, t):
    """The candidate a task came from, or its capture record (made now if a captured task has none)."""
    row = ctx.core.q("SELECT c.* FROM sources s JOIN candidates c ON c.id=s.candidate_id WHERE s.task_id=? "
                     "AND s.user_id=? AND s.role IN ('origin', 'ignored') ORDER BY s.role='origin' DESC, s.id LIMIT 1",
                     (t["id"], ctx.core.user_id)).fetchone()
    if row:
        if vectors.get(ctx.conn, "candidate", row["id"], ctx.embedder.model if ctx.embedder else "") is None and ctx.embed_ok:
            v = ctx.embed([row["ask"] or t["title"]])
            if v:
                vectors.put(ctx.conn, "candidate", row["id"], ctx.embedder.model, v[0])
        return row
    return _record(ctx, t) if _captured(ctx.core, t) else None
