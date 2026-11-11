"""Memory's question cards, and the cap that keeps a new job from flooding triage.

Kinds: entity_person (are these the same person?), entity_term (what is this?), decision (was this a decision?)
and fact_conflict (two sources disagree: which is right?). None of them is about a task. Each is raised at most
once per subject, whatever its answer, and at most memory.daily_cards a day (more in onboarding mode). What's
over the cap stays as it is (an inferred definition, a proposed decision) and is asked about on a later day.
"""

from datetime import timedelta

from .. import cards, events, timeres
from ..db import FuzzError, parse_iso
from ..matching import entities
from . import facts, trust as trust_mod

KINDS = ("entity_person", "entity_term", "decision", "fact_conflict")
DAILY_CARDS = 5
ONBOARDING_CARDS = 10
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
    return int(c.get("onboarding_cards", ONBOARDING_CARDS) if onboarding(core) else c.get("daily_cards", DAILY_CARDS))


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


def _conflict_args(core, eid, a, b):
    e = facts.entity(core, eid)
    name = entities.display_name(core.conn, e)
    return {"prompt": f"Which is right about {name}?",
            "reason": f"Two sources disagree on {name}'s {a['attr'].replace('_', ' ')}, and neither is more "
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
    """A provisional name-only person ("Pat") whose name starts one known person's name ("Patricia Lee"),
    and that pair isn't already known to be different."""
    out = []
    known = core.all("SELECT * FROM entities WHERE user_id=? AND type='person' AND provisional=0 AND redirect_to IS NULL",
                     (core.user_id,))
    for p in core.all("SELECT * FROM entities WHERE user_id=? AND type='person' AND provisional=1 AND redirect_to IS NULL "
                      "AND name IS NOT NULL ORDER BY id", (core.user_id,)):
        n = p["name"].strip().lower()
        if not n:
            continue
        hits = [k for k in known if any(_could_be(n, a["alias"]) for a in
                                        core.all("SELECT alias FROM aliases WHERE entity_id=?", (k["id"],)))]
        hits = [k for k in hits if not _different(core, p["id"], k["id"])]
        if len(hits) == 1:
            k = hits[0]
            out.append(("entity_person", f"people:{min(k['id'], p['id'])}:{max(k['id'], p['id'])}",
                        lambda k=k, p=p: _person_args(core, k, p)))
    return out


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
    seen = core.one("SELECT MAX(ts) ts, COUNT(*) n FROM sightings WHERE user_id=? AND entity_id=?", (core.user_id, e["id"]))
    detail = " · ".join(x for x in (w.get("role"), w.get("team")) if x) or (ident["value"] if ident else "Name only")
    return {"entity_id": e["id"], "name": entities.display_name(core.conn, e),
            "where": {"email": "Email", "slack": "Slack"}.get((ident or {}).get("type"), "Mentioned"),
            "detail": detail, "seen": f"Seen {seen['n']} times" if seen and seen["n"] else "Not seen yet"}


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
