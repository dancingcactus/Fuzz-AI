"""Memory's question cards, and the cap that keeps a new job from flooding triage.

Kinds: entity_person (are these the same person?), entity_term (what is this?), decision (was this a decision?)
and fact_conflict (two sources disagree: which is right?). None of them is about a task. Each is raised at most
once per subject, whatever its answer, and at most memory.daily_cards (2) a day. What's
over the cap stays as it is (an inferred definition, a proposed decision) and is asked about on a later day.
"""

from datetime import timedelta

from .. import cards, events, timeres
from ..db import FuzzError, parse_iso
from ..matching import entities, who
from . import facts, trust as trust_mod

KINDS = ("entity_person", "entity_term", "decision", "fact_conflict")
DAILY_CARDS = 2   # the same every day, onboarding or not: memory's questions never crowd out the work
ONBOARDING_DAYS = 60


def cfg(core):
    return core.config.get("memory") or {}


def onboarding_from(core):
    v = cfg(core).get("onboarding_from")
    if v:
        return parse_iso(v)
    row = core.one("SELECT created_at FROM users WHERE id=?", (core.user_id,))
    return parse_iso(row["created_at"]) if row and row.get("created_at") else core.now()


def onboarding(core):
    """The first 60 days (memory.onboarding_days) from memory.onboarding_from, or from when the store began."""
    days = int(cfg(core).get("onboarding_days", ONBOARDING_DAYS))
    start = onboarding_from(core)
    return start <= core.now() < start + timedelta(days=days)


def cap(core):
    c = cfg(core)
    return int(c.get("daily_cards", DAILY_CARDS))


def _today_start(core):
    tz = timeres.local_tz(core)
    local = core.now().astimezone(tz)
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


def raised_today(core):
    start = _today_start(core).isoformat()
    from ..db import iso
    start = iso(parse_iso(start))
    return core.one(f"SELECT COUNT(*) n FROM cards WHERE user_id=? AND kind IN ({','.join('?' * len(KINDS))}) "
                    "AND created_at>=?", (core.user_id, *KINDS, start))["n"]


def _asked(core, kind, key):
    """Already asked about this subject (any answer, or still open)."""
    return core.one("SELECT 1 FROM cards WHERE user_id=? AND kind=? AND json_extract(payload,'$.key')=?",
                    (core.user_id, kind, key)) is not None


# ---------------------------------------------------------------- what could be asked, in order

def candidates(core):
    """Everything memory could ask about now, most important first: conflicts, decisions, people, terms.
    Each is (kind, key, build) where build() returns create()'s arguments."""
    out = []
    out += _conflicts(core)
    out += _decisions(core)
    out += _people(core)
    out += _terms(core)
    return [c for c in out if not _asked(core, c[0], c[1])]


def held(core):
    """What would be asked but the cap holds back today (for the inspector)."""
    room = max(cap(core) - raised_today(core), 0)
    return [{"kind": k, "key": key} for k, key, _ in candidates(core)[room:]]


def raise_cards(core, actor="system"):
    """Raise what fits under today's cap. Returns the card ids."""
    settle_conflicts(core, actor)
    room = cap(core) - raised_today(core)
    made = []
    if room <= 0:
        return made
    for kind, key, build in candidates(core)[:room]:
        args = build()
        if args is None:
            continue
        with core.tx(actor):
            payload = dict(args.pop("payload", {}), key=key)
            made.append(cards.create(core, kind, payload=payload, **args))
    return made


def _conflicts(core):
    out = []
    seen = set()
    for r in core.all("SELECT DISTINCT entity_id FROM facts WHERE user_id=? AND status='live'", (core.user_id,)):
        eid = facts.follow(core, r["entity_id"])
        if eid in seen:
            continue
        seen.add(eid)
        for a, b in facts.disputes(core, eid):
            lo, hi = sorted((a["id"], b["id"]))
            key = f"facts:{lo}:{hi}"
            out.append(("fact_conflict", key, lambda a=a, b=b, eid=eid: _conflict_args(core, eid, a, b)))
    return out


def settle_conflicts(core, actor="system"):
    """An open "which is right?" whose two facts no longer disagree (one was rejected or undone, or they turn
    out to say the same thing) has nothing left to ask: withdraw it."""
    for c in core.all("SELECT * FROM cards WHERE user_id=? AND kind='fact_conflict' AND status='open'", (core.user_id,)):
        p = c.get("payload") or {}
        ids = sorted(f["id"] for f in p.get("facts") or [])
        eid = p.get("entity_id")
        live = eid is not None and any(sorted((a["id"], b["id"])) == ids
                                       for a, b in facts.disputes(core, facts.follow(core, eid)))
        if live:
            continue
        with core.tx(actor):
            ch = events.Changes()
            ch.card(c["id"], status="withdrawn")
            events.emit(core, "card.updated", changes=ch, data={"kind": "fact_conflict", "why": "no_longer_disputed"})


def _attr_phrase(name, attr):
    """Verizon's manager; what Verizon is, not Verizon's what it is."""
    if attr == "what_it_is":
        return f"what {name} is"
    return f"{name}'s {attr.replace('_', ' ')}"


def _conflict_args(core, eid, a, b):
    e = facts.entity(core, eid)
    name = entities.display_name(core.conn, e)
    return {"prompt": f"Which is right about {name}?",
            "reason": f"Two sources disagree on {_attr_phrase(name, a['attr'])}, and neither is more "
                      "trustworthy than the other.",
            "payload": {"entity_id": eid, "name": name, "attr": a["attr"],
                        "facts": [_fact_brief(core, a), _fact_brief(core, b)]}}


def _fact_brief(core, f):
    said = facts.entity(core, f["said_by"]) if f.get("said_by") else None
    return {"id": f["id"], "value": f["value"], "level": f["trust"]["level"], "source_kind": f["source_kind"],
            "link": f["link"], "source_ts": f["source_ts"],
            "said_by": entities.display_name(core.conn, said) if said else None}


def _decisions(core):
    out = []
    for d in core.all("SELECT * FROM decision_log WHERE user_id=? AND status='proposed' ORDER BY id", (core.user_id,)):
        out.append(("decision", f"decision:{d['id']}", lambda d=d: _decision_args(core, d)))
    return out


def _decision_args(core, d):
    who = facts.entity(core, d["decided_by"]) if d.get("decided_by") else None
    why = ("Fuzz pieced this together; nobody said it in so many words." if d["how"] == "inferred" else
           "It sounded like a decision, but Fuzz isn't sure." if (d.get("confidence") or 0) < 0.8 else
           "It came from a recap, not from whoever decided it.")
    return {"prompt": "Was this a decision?", "reason": why,
            "payload": {"decision_id": d["id"], "what": d["what"], "why": d.get("why"),
                        "alternatives": d.get("alternatives") or [], "link": d.get("link"),
                        "decided_by": entities.display_name(core.conn, who) if who else None,
                        "decided_at": d.get("decided_at")}}


def _people(core):
    """Who someone is. A first name's holder ("Nick": mentions not yet settled, matching/who.py) and the people
    it could be, ranked by its messages' context. And a name-only full name ("Pat Lee") that could be one
    known person ("Patricia Lee")."""
    out = []
    me = core.config.get("me", {})
    for h in core.all("SELECT * FROM entities WHERE user_id=? AND type='person' AND provisional=1 AND redirect_to IS NULL "
                      "AND name IS NOT NULL ORDER BY id", (core.user_id,)):
        if _asked_about(core, h["id"]):
            continue
        if who.is_holder(h):
            cands = [c for c in who.candidates(core, h["name"], loose=True) if not _different(core, h["id"], c)]
            if cands:
                out.append(("entity_person", f"who:{h['id']}", lambda h=h, cands=cands: _which_args(core, h, cands, me)))
            continue
        n = h["name"].strip().lower()
        known = core.all("SELECT * FROM entities WHERE user_id=? AND type='person' AND provisional=0 AND redirect_to IS NULL",
                         (core.user_id,))
        hits = [k for k in known if any(_could_be(n, a["alias"]) for a in
                                        core.all("SELECT alias FROM aliases WHERE entity_id=?", (k["id"],)))]
        hits = [k for k in hits if not _different(core, h["id"], k["id"])]
        if len(hits) == 1:
            k = hits[0]
            out.append(("entity_person", f"people:{min(k['id'], h['id'])}:{max(k['id'], h['id'])}",
                        lambda k=k, h=h: _person_args(core, k, h)))
    return out


def _asked_about(core, eid):
    """A card already asked who this name-only person is, in any form."""
    return core.one("SELECT 1 FROM cards WHERE user_id=? AND kind='entity_person' AND json_extract(payload,'$.entity_b')=?",
                    (core.user_id, eid)) is not None


def _which_args(core, h, cands, me):
    """"Which Nick is this?": the holder's messages, and up to three people it could be, likeliest first."""
    ranked, n = who.rank_holder(core, h["id"], me)
    why = {r["id"]: r["why"] for r in ranked}
    order = [r["id"] for r in ranked if r["id"] in cands] + [c for c in cands if c not in why]
    top = order[:3]
    rows = [core.one("SELECT * FROM entities WHERE id=?", (c,)) for c in top]
    name = h["name"]
    profiles = [_profile(core, h)] + [dict(_profile(core, r), why=why.get(r["id"], [])) for r in rows]
    prompt = which_prompt(core, {"name": name, "candidates": top})
    many = f"{n} messages" if n != 1 else "a message"
    return {"prompt": prompt,
            "reason": f"“{name}” came up by first name only in {many}, and nothing on them says who it is.",
            "payload": {"entity_a": top[0], "entity_b": h["id"], "candidates": top, "name": name, "profiles": profiles}}


def _could_be(name, alias):
    """"pat" could be "patricia lee" (its first name starts with it); "pat lee" could be "patricia lee"."""
    if not alias or alias == name or "@" in alias:
        return False
    first, *rest = name.split(" ")
    afirst, *arest = alias.split(" ")
    if len(first) < 3 or not afirst.startswith(first):
        return False
    return not rest or (bool(arest) and arest[-1] == rest[-1])


def _different(core, a, b):
    return core.one("SELECT 1 FROM entity_links WHERE (a=? AND b=?) OR (a=? AND b=?)", (a, b, b, a)) is not None


def _profile(core, e):
    ident = core.one("SELECT type, value FROM identifiers WHERE entity_id=? ORDER BY type LIMIT 1", (e["id"],))
    w = facts.winners(core, e["id"])
    seen = core.one("SELECT COUNT(DISTINCT k) n FROM (SELECT signal_key k FROM sightings WHERE user_id=? AND entity_id=? "
                    "UNION ALL SELECT c.signal_key FROM mentions m JOIN candidates c ON c.id=m.candidate_id "
                    "WHERE c.user_id=? AND m.entity_id=?)", (core.user_id, e["id"], core.user_id, e["id"]))
    detail = " · ".join(x for x in (w.get("role"), w.get("team")) if x) or (ident["value"] if ident else "Name only")
    return {"entity_id": e["id"], "name": entities.display_name(core.conn, e),
            "where": {"email": "Email", "slack": "Slack"}.get((ident or {}).get("type"), "Mentioned"),
            "detail": detail, "seen": f"Seen {seen['n']} times" if seen and seen["n"] else "Not seen yet",
            "sources": _sources(core, e["id"])}


ROLE = {"from": "Sent it", "on": "On it", "named": "Named", "about": "About them"}


def _sources(core, eid, limit=3):
    """Where this person came up, most recent first: what was said, where and when, with a link back.
    Telling two people apart needs the context each name came up in, not just the name. Sightings only
    began with memory, so the asks the matcher tied to them (mentions) count too, one line per message."""
    out = []
    for s in core.all(
            "SELECT SUBSTR(MIN(x.role), 2) role, MAX(g.ts) ts, g.source, g.quote, g.link FROM ("
            "  SELECT signal_key, CASE role WHEN 'from' THEN '1from' WHEN 'on' THEN '2on' WHEN 'about' THEN '3about' "
            "  ELSE '4' || role END role FROM sightings WHERE user_id=? AND entity_id=?"
            "  UNION ALL SELECT c.signal_key, '4named' FROM mentions m JOIN candidates c ON c.id=m.candidate_id "
            "  WHERE c.user_id=? AND m.entity_id=?"
            ") x JOIN signals g ON g.key=x.signal_key AND g.user_id=? "
            "GROUP BY x.signal_key ORDER BY ts DESC LIMIT ?",
            (core.user_id, eid, core.user_id, eid, core.user_id, limit)):
        out.append({"where": {"email": "Email", "slack": "Slack", "teams": "Teams", "meeting": "Meeting"}
                    .get(s["source"], (s["source"] or "").title()), "role": ROLE.get(s["role"], s["role"]),
                    "quote": s["quote"], "link": s["link"], "ts": s["ts"]})
    return out


def which_prompt(core, payload):
    name, cands = payload["name"], payload.get("candidates") or []
    if len(cands) != 1:
        return f"Which {name} is this?"
    e = core.one("SELECT * FROM entities WHERE id=?", (cands[0],))
    return f"Is “{name}” {entities.display_name(core.conn, e)}?"


def upgrade_person(core, payload):
    """A same-person card raised before "Which Nick?" asks it the new way when its name-only one is a first
    name's holder: the one it offered, and room to name someone else. And no notification sender is offered."""
    if payload.get("candidates"):
        keep = [c for c in payload["candidates"] if not who.shared(core, c)] or payload["candidates"][:1]
        return dict(payload, candidates=keep, entity_a=keep[0]) if keep != payload["candidates"] else payload
    if not payload.get("entity_a") or not payload.get("entity_b"):
        return payload
    h = core.one("SELECT * FROM entities WHERE user_id=? AND id=?", (core.user_id, payload["entity_b"]))
    if not who.is_holder(h):
        return payload
    return dict(payload, candidates=[payload["entity_a"]], name=h["name"])


def fresh_profiles(core, payload):
    """An open same-person card's profiles as they are now, sources included, for cards raised before
    profiles carried them or people seen since. Falls back to what the card was raised with."""
    if payload.get("candidates"):
        ids = [payload.get("entity_b")] + list(payload["candidates"])
        why = {p.get("entity_id"): p.get("why") for p in payload.get("profiles") or []}
        rows = [core.one("SELECT * FROM entities WHERE user_id=? AND id=?", (core.user_id, i)) for i in ids]
        if not all(rows):
            return payload.get("profiles") or []
        return [dict(_profile(core, r), **({"why": why[r["id"]]} if why.get(r["id"]) is not None else {})) for r in rows]
    ids = [payload.get("entity_a"), payload.get("entity_b")]
    rows = [core.one("SELECT * FROM entities WHERE user_id=? AND id=?", (core.user_id, i)) if i else None for i in ids]
    if not all(rows):
        return payload.get("profiles") or []
    return [_profile(core, r) for r in rows]


def _person_args(core, known, prov):
    a, b = _profile(core, known), _profile(core, prov)
    return {"reason": f"“{b['name']}” came up by name only, and {a['name']} is the one person it could be.",
            "payload": {"entity_a": known["id"], "entity_b": prov["id"], "profiles": [a, b]}}


def _terms(core):
    """Terms whose only definition is Fuzz's guess (or none), most mentioned first."""
    out = []
    rows = core.all("SELECT e.*, (SELECT COUNT(*) FROM sightings s WHERE s.entity_id=e.id AND s.user_id=e.user_id "
                    "AND s.role='term') n FROM entities e WHERE e.user_id=? AND e.type IN ('term','tool') AND e.redirect_to IS NULL "
                    "AND EXISTS (SELECT 1 FROM sightings s WHERE s.entity_id=e.id AND s.user_id=e.user_id AND s.role='term') "
                    "ORDER BY n DESC, e.id", (core.user_id,))
    for e in rows:
        defs = [f for f in facts.for_entity(core, e["id"]) if f["attr"] in ("definition", "what_it_is")]
        if any(f["trust"]["base"] != "inferred" for f in defs):
            continue
        if not defs and (e["n"] or 0) < 2:   # an undefined term seen once can wait to come up again
            continue
        out.append(("entity_term", f"term:{e['id']}", lambda e=e, defs=defs: _term_args(core, e, defs)))
    return out


def _term_args(core, e, defs):
    guess = defs[0]["value"] if defs else None
    mentions = []
    for s in core.all("SELECT g.source, g.quote, g.ts FROM sightings s JOIN signals g ON g.key=s.signal_key AND "
                      "g.user_id=s.user_id WHERE s.user_id=? AND s.entity_id=? ORDER BY s.ts DESC LIMIT 3",
                      (core.user_id, e["id"])):
        if s["quote"]:
            mentions.append({"where": s["source"].title(), "text": s["quote"]})
    return {"reason": ("This is Fuzz's best guess from how it was used. Correct it if it's off." if guess else
                       "It keeps coming up and Fuzz doesn't know what it means."),
            "payload": {"entity_id": e["id"], "term": e["name"], "best_guess": guess, "mentions": mentions,
                        "fact_id": defs[0]["id"] if defs else None}}


# ---------------------------------------------------------------- answers

def answer_conflict(core, card, option, value):
    p = card.get("payload") or {}
    fs = [f["id"] for f in p.get("facts") or []]
    if len(fs) != 2:
        raise FuzzError("This card has lost its facts", "card_id", 409)
    if option in ("first", "second"):
        win, lose = (fs[0], fs[1]) if option == "first" else (fs[1], fs[0])
        with core.tx("human"):
            ch = events.Changes()
            ch.fact(win, confirmed_at=core.now_iso())
            ch.fact(lose, status="rejected")
            cards.mark_answered(core, ch, card, option, value)
            events.emit(core, "fact.confirmed", changes=ch, data={"fact_id": win, "rejected": lose,
                                                                  "entity_id": p.get("entity_id")})
        return
    if option == "neither":
        if not isinstance(value, str) or not value.strip():
            raise FuzzError("value is what it actually is", "value")
        with core.tx("human"):
            facts.edit(core, p["entity_id"], p["attr"], value, card=card, option="neither")
            for fid in fs:
                facts.reject(core, fid)
        return
    raise FuzzError("option is first, second or neither", "option")


def answer_decision(core, card, option, value):
    from . import knowledge
    did = (card.get("payload") or {}).get("decision_id")
    if option == "record":
        return knowledge.record_decision(core, did, card=card, edits=value if isinstance(value, dict) else None)
    if option == "not_decision":
        return knowledge.reject_decision(core, did, card=card)
    raise FuzzError("option is record or not_decision", "option")


def view_extra(core, card):
    """What a memory card adds to its view: the trust of each side now, for the UI."""
    return {}


def label(level):
    return {"confirmed": "Confirmed", "authoritative": "Official", "reported": "Reported",
            "inferred": "Fuzz's guess", "stale": "May be out of date"}.get(level, level)


__all__ = ["raise_cards", "candidates", "held", "answer_conflict", "answer_decision", "onboarding", "cap", "trust_mod"]
