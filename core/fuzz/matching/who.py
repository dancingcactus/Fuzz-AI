"""Who a first name means. Fuzz never makes a person from a first name alone.

A message that names someone by first name only ("Nick") is settled by its context, strongest first:
1. On the message: someone with that first name is on it (its sender or the people on it) by email, Slack ID
   or full name.
2. On the thread: they're on another message in the same email or Slack thread, or in the same Slack DM.
3. In the channel: they've come up in this Slack channel before.
4. The people they're usually with: how often they appear alongside the others on this message, weighting each
   of those others by how rarely they come up (someone on every thread tells you nothing) and each shared
   message by how few people were on it (a 40-person announcement says little).
1 and 2 decide on their own. 3 and 4 decide only with a clear lead and enough shared history, measured against
someone Fuzz doesn't know yet: a lone candidate with a thin history isn't a guess. Otherwise the mention waits
on a holder, one name-only entity per first name: a bucket for mentions not yet settled, not a person. A
"Which Nick?" card asks about it.

appearances is the index this reads: who was on which message, by email, Slack ID or full name only (never
a guess), with the message's thread, channel and size. Derived from signals, so it can be rebuilt any time.
"""

import json
import math

BIG = 15          # a message with more people on it than this says nothing about who's with whom
MIN_SCORE = 2.0   # rules 3 and 4 need at least this much shared history to decide
LEAD = 2.0        # ... and this many times the runner-up's


def first_only(person):
    """A name alone, one word: "Nick", not "Nick Ricci" or nick@acme.example."""
    name = (person.get("name") or "").strip()
    return bool(name) and not person.get("email") and not person.get("slack_id") and len(name.split()) == 1


def candidates(core, first, loose=False):
    """The people a first name could mean: known people (an email or Slack ID) or people known by full name,
    with that first name or alias. Never another holder. loose: a first name it could be short for too
    ("Pat" for Patricia), for asking; a guess takes the name as written."""
    first = first.strip().lower()
    rows = core.conn.execute(
        "SELECT DISTINCT e.id, a.alias FROM aliases a JOIN entities e ON e.id=a.entity_id WHERE a.alias LIKE ? "
        "AND e.type='person' AND e.user_id=? AND e.redirect_to IS NULL AND (e.provisional=0 OR instr(trim(e.name),' ')>0) "
        "ORDER BY e.id", (first + "%", core.user_id)).fetchall()
    out = []
    for r in rows:
        if r["id"] in out or shared(core, r["id"]):
            continue
        ok = r["alias"] == first or (loose and len(first) >= 3 and "@" not in r["alias"]
                                     and r["alias"].split(" ")[0].startswith(first))
        if ok and r["id"] not in out:
            out.append(r["id"])
    return out


def shared(core, eid):
    """A notification sender that speaks for many people ("James Torio via Adobe Wiki", "Sanjeev Purohit (Jira)"
    from one address), so it has picked up their first names. Never who a first name means."""
    names = [r["alias"] for r in core.conn.execute("SELECT alias FROM aliases WHERE entity_id=? AND instr(alias,' ')>0",
                                                   (eid,)).fetchall() if "@" not in r["alias"]]
    firsts = {n.split(" ")[0] for n in names}
    relay = any(" via " in n or n.rstrip().endswith(")") for n in names)
    return len(firsts) >= 3 or (len(firsts) >= 2 and relay)


def holder(core, first):
    """The name-only entity holding this first name's unsettled mentions, if there is one."""
    row = core.conn.execute(
        "SELECT id FROM entities WHERE user_id=? AND type='person' AND provisional=1 AND redirect_to IS NULL "
        "AND lower(trim(name))=? ORDER BY id LIMIT 1", (core.user_id, first.strip().lower())).fetchone()
    return row["id"] if row else None


def is_holder(e):
    return bool(e) and e["type"] == "person" and e["provisional"] and e["redirect_to"] is None and \
        len((e["name"] or "").split()) == 1


def solid_id(core, person, me):
    """The person someone is by email, Slack ID or full name, read only. None for a first name, someone new,
    or the user."""
    from .entities import _by_identifier, _is_me
    if not person or _is_me(person, me):
        return None
    email = (person.get("email") or "").lower()
    if email:
        return _by_identifier(core, "email", email)
    if person.get("slack_id"):
        return _by_identifier(core, "slack", person["slack_id"])
    name = (person.get("name") or "").strip().lower()
    if len(name.split()) < 2:
        return None
    rows = core.conn.execute("SELECT DISTINCT e.id FROM aliases a JOIN entities e ON e.id=a.entity_id WHERE a.alias=? "
                             "AND e.type='person' AND e.user_id=? AND e.redirect_to IS NULL", (name, core.user_id)).fetchall()
    return rows[0]["id"] if len(rows) == 1 else None


def _people(signal):
    out = [signal["from"]] if signal.get("from") and signal.get("source") != "meeting" else []
    out += list(signal.get("people") or [])
    out += list((signal.get("meeting") or {}).get("attendees") or [])
    return [p for p in out if isinstance(p, dict)]


def _size(signal):
    seen = set()
    for p in _people(signal):
        seen.add((p.get("email") or p.get("slack_id") or p.get("name") or "").strip().lower())
    return len(seen - {""})


def place_of(signal):
    return signal["source_id"].split(":")[0] if signal.get("source") == "slack" and signal.get("source_id") else None


class Context:
    """One message: where it was, and who on it is known for sure."""

    def __init__(self, core, signal, key, me):
        self.core, self.key, self.me = core, key, me
        self.thread = signal.get("anchor")
        self.place = place_of(signal)
        self.ts = signal.get("ts")
        self._signal = signal
        self._others = None

    @property
    def others(self):
        if self._others is None:
            ids = [solid_id(self.core, p, self.me) for p in _people(self._signal)]
            self._others = sorted({i for i in ids if i})
        return self._others


def record(core, signal, key, me):
    """Index who was on this message, for the next first name's context."""
    size = _size(signal)
    for eid in set(filter(None, (solid_id(core, p, me) for p in _people(signal)))):
        core.conn.execute("INSERT OR IGNORE INTO appearances VALUES (?,?,?,?,?,?,?)",
                          (core.user_id, eid, key, signal.get("anchor"), place_of(signal), size, signal.get("ts")))
    core.conn.execute("INSERT OR IGNORE INTO appearance_signals VALUES (?,?)", (core.user_id, key))


def index(core, me):
    """Index every message not yet indexed (the messages from before the index existed). Returns how many."""
    rows = core.conn.execute("SELECT key, payload FROM signals s WHERE user_id=? AND NOT EXISTS (SELECT 1 FROM "
                             "appearance_signals x WHERE x.user_id=s.user_id AND x.signal_key=s.key)",
                             (core.user_id,)).fetchall()
    for r in rows:
        record(core, json.loads(r["payload"]), r["key"], me)
    return len(rows)


def rank(core, first, ctx):
    """Each person the first name could mean on this message, best first: [{id, score, sure, why}]."""
    cands = candidates(core, first)
    if not cands:
        return []
    index(core, ctx.me)
    q = core.conn.execute
    out = {c: {"id": c, "score": 0.0, "sure": False, "why": []} for c in cands}
    for c in cands:
        if c in ctx.others:
            out[c].update(sure=True, why=["On this message"])
    if len(cands) == 1 and not out[cands[0]]["sure"]:
        # the only one, known by just this word ("Uber", or Amar by Slack ID): nothing to tell apart
        e = q("SELECT name FROM entities WHERE id=?", (cands[0],)).fetchone()
        if (e["name"] or "").strip().lower() == first.strip().lower():
            out[cands[0]].update(sure=True, why=[f"The only one called {first}"])
    if ctx.thread:
        for r in q("SELECT DISTINCT entity_id FROM appearances WHERE user_id=? AND thread=? AND signal_key!=?",
                   (core.user_id, ctx.thread, ctx.key)):
            if r["entity_id"] in out and not out[r["entity_id"]]["sure"]:
                dm = (ctx.place or "").startswith("D")
                out[r["entity_id"]].update(sure=True, why=["In this DM" if dm else "On this thread"])
    if ctx.place:
        for c in cands:
            n = q("SELECT COUNT(*) n FROM appearances WHERE user_id=? AND entity_id=? AND place=? AND signal_key!=?",
                  (core.user_id, c, ctx.place, ctx.key)).fetchone()["n"]
            if n and ctx.place.startswith("D") and not out[c]["sure"]:
                out[c].update(sure=True, why=["In this DM"])
            elif n:
                out[c]["score"] += min(n, 3)
                out[c]["why"].append(f"In this channel {n} time{'s' if n > 1 else ''}")
    others = [o for o in ctx.others if o not in out]
    if others:
        total = q("SELECT COUNT(*) n FROM appearance_signals WHERE user_id=?", (core.user_id,)).fetchone()["n"] or 1
        for o in others:
            df = q("SELECT COUNT(*) n FROM appearances WHERE user_id=? AND entity_id=?", (core.user_id, o)).fetchone()["n"]
            rare = math.log(1 + total / max(df, 1))
            for c in cands:
                rows = q("SELECT a.size FROM appearances a JOIN appearances b ON b.user_id=a.user_id AND "
                         "b.signal_key=a.signal_key WHERE a.user_id=? AND a.entity_id=? AND b.entity_id=? AND "
                         "a.signal_key!=? AND a.size<=?", (core.user_id, c, o, ctx.key, BIG)).fetchall()
                if rows:
                    out[c]["score"] += rare * sum(1 / max(r["size"] - 1, 1) for r in rows)
                    out[c].setdefault("with", []).append((o, len(rows)))
    for c in out.values():
        if c.get("with"):
            n = sum(k for _, k in c["with"])
            c["why"].append(f"With these people on {n} other message{'s' if n > 1 else ''}")
        c.pop("with", None)
        c["score"] = round(c["score"], 2)
    return sorted(out.values(), key=lambda c: (not c["sure"], -c["score"], c["id"]))


def decide(ranked):
    """The one it is, or None when it's not clear enough to say."""
    sure = [c for c in ranked if c["sure"]]
    if len(sure) == 1:
        return sure[0]
    if sure or not ranked:
        return None
    best = ranked[0]
    second = ranked[1]["score"] if len(ranked) > 1 else 0.0
    return best if best["score"] >= MIN_SCORE and best["score"] >= LEAD * second else None


def guess(core, first, ctx):
    """The entity id a first name means on this message, or None."""
    if ctx is None:
        return None
    best = decide(rank(core, first, ctx))
    return best["id"] if best else None


# ---------------------------------------------------------------- a holder's messages

def holder_messages(core, hid):
    """The messages a holder's mentions came from, newest first. hid: one id, or a list of them."""
    ids = list(hid) if isinstance(hid, (list, tuple)) else [hid]
    marks = ",".join("?" * len(ids))
    return core.conn.execute(
        "SELECT g.key, g.payload FROM signals g WHERE g.user_id=? AND g.key IN ("
        f"SELECT signal_key FROM sightings WHERE user_id=? AND entity_id IN ({marks}) UNION "
        f"SELECT c.signal_key FROM mentions m JOIN candidates c ON c.id=m.candidate_id WHERE c.user_id=? AND m.entity_id IN ({marks})) "
        "ORDER BY g.ts DESC", (core.user_id, core.user_id, *ids, core.user_id, *ids)).fetchall()


def rank_holder(core, hid, me, also=()):
    """Who a holder's mentions could be, over all its messages: [{id, score, sure, settles, why}], best first.
    settles: how many of its messages would go to that person on their own."""
    e = core.conn.execute("SELECT * FROM entities WHERE id=?", (hid,)).fetchone()
    first = (e["name"] or "").strip()
    total = {}
    msgs = holder_messages(core, [hid, *also])
    for m in msgs:
        r = rank(core, first, Context(core, json.loads(m["payload"]), m["key"], me))
        best = decide(r)
        for c in r:
            t = total.setdefault(c["id"], {"id": c["id"], "score": 0.0, "sure": 0, "settles": 0, "why": []})
            t["score"] += c["score"] + (5 if c["sure"] else 0)
            t["sure"] += 1 if c["sure"] else 0
            t["settles"] += 1 if best and best["id"] == c["id"] else 0
            t["why"] += [w for w in c["why"] if w not in t["why"]]
    for t in total.values():
        t["score"] = round(t["score"], 2)
    return sorted(total.values(), key=lambda t: (-t["score"], t["id"])), len(msgs)


# ---------------------------------------------------------------- settling the name-only people already there

def settle(core, apply=False):
    """For the people made from a first name before this: one holder per first name (they used to pile up,
    a new one each time a name was shared), and a holder whose every message settles on one person on its
    own joins that person. Returns the plan; apply carries it out, each move an entity.merged you can undo.
    Anything less clear stays, for a "Which Nick?" card."""
    me = core.config.get("me", {})
    index(core, me)
    rows = core.conn.execute("SELECT * FROM entities WHERE user_id=? AND type='person' AND provisional=1 AND "
                             "redirect_to IS NULL AND name IS NOT NULL ORDER BY id", (core.user_id,)).fetchall()
    by = {}
    for e in rows:
        if is_holder(e):
            by.setdefault(e["name"].strip().lower(), []).append(e)
    name_of = lambda i: core.conn.execute("SELECT name FROM entities WHERE id=?", (i,)).fetchone()["name"]
    plan = []
    for first, hs in sorted(by.items()):
        keep, dups = hs[0], hs[1:]
        for d in dups:
            plan.append({"from": d["id"], "into": keep["id"], "name": keep["name"], "to": keep["name"],
                         "why": "The same first name, waiting in two places"})
        ranked, n = rank_holder(core, keep["id"], me, also=[d["id"] for d in dups])
        top = ranked[0] if ranked else None
        if top and n and top["settles"] == n:
            plan.append({"from": keep["id"], "into": top["id"], "name": keep["name"], "to": name_of(top["id"]),
                         "why": "; ".join(top["why"]) or "Every message points to them", "messages": n})
        else:
            plan.append({"from": keep["id"], "into": None, "name": keep["name"], "messages": n,
                         "could_be": [name_of(r["id"]) for r in ranked[:3]],
                         "why": "Not clear enough: a card will ask" if ranked else "No one known by that name yet"})
    if apply:
        from .. import events
        for step in plan:
            if not step["into"]:
                continue
            with core.tx("human"):
                ch = events.Changes()
                for c in core.conn.execute("SELECT id FROM cards WHERE user_id=? AND kind='entity_person' AND status='open' "
                                           "AND json_extract(payload,'$.entity_b')=?", (core.user_id, step["from"])).fetchall():
                    ch.card(c["id"], status="expired", answer={"option": "same", "value": step["into"]})
                core.conn.execute("UPDATE entities SET redirect_to=? WHERE id=? AND user_id=?",
                                  (step["into"], step["from"], core.user_id))
                events.emit(core, "entity.merged", changes=ch, data={"from": step["from"], "into": step["into"],
                                                                   "settled": True},
                            log=("status", f"“{step['name']}” is {step['to']}: {step['why']}."))
    return plan
