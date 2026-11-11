"""Facts about entities, each with where it came from and how it was learned.

One row per claim. Nothing is deleted: a fact that loses a conflict is still live and is shown as superseded;
one you said is wrong is rejected; an undone one is undone. Which fact wins, and whether two disagree badly
enough to ask you (disputed), is worked out when read, from trust (memory/trust.py).

The privacy guardrail is an allowlist per entity type, checked here at write time whatever the caller: person
records hold working context only.
"""

import json
import re
from datetime import timedelta

from .. import events
from ..db import FuzzError, parse_iso
from ..matching import entities
from . import trust as trust_mod

# What each entity type may hold. Anything else is refused, and the refusal is recorded for the inspector.
ALLOWED = {
    "person": ("role", "team", "company", "manager", "projects", "owns", "cares_about", "how_met", "works_hours",
               "prefers"),
    "org": ("relationship", "contacts", "what_it_is", "owner"),
    "tool": ("what_it_is", "owner", "used_for", "definition"),
    "term": ("definition", "stands_for", "used_for"),
    "document": ("what_it_is", "owner"),
    "ticket": ("what_it_is", "owner"),
}
# One value at a time: a newer or better-sourced value supersedes the old one. The rest hold several.
SINGLE = {"role", "team", "company", "manager", "how_met", "works_hours", "definition", "stands_for", "what_it_is",
          "owner", "relationship"}
HOW = ("stated", "extracted", "inferred", "edited")
SOURCE_KINDS = ("email", "slack", "meeting", "calendar", "doc", "directory", "you", "teams")
CONFLICT_DAYS = 30   # two equally trusted sources this close together that disagree: ask, don't pick
VALUE_MAX = 500


def norm(v):
    return re.sub(r"\s+", " ", (v or "").strip().rstrip(".")).casefold()


# ---------------------------------------------------------------- entities

def follow(core, eid):
    return entities._follow(core, eid) if eid else None


def closure(core, eid):
    """The entity and every entity merged into it (redirect_to pointing at it, at any depth)."""
    eid = follow(core, eid)
    out, todo = [eid], [eid]
    while todo:
        rows = core.all("SELECT id FROM entities WHERE redirect_to=? AND user_id=?", (todo.pop(), core.user_id))
        for r in rows:
            if r["id"] not in out:
                out.append(r["id"])
                todo.append(r["id"])
    return out


def entity(core, eid):
    return core.one("SELECT * FROM entities WHERE id=? AND user_id=?", (eid, core.user_id))


def require_entity(core, eid):
    e = entity(core, eid)
    if e is None:
        raise FuzzError(f"No entity {eid}", "entity_id", 404)
    return e


def resolve_about(core, ref, me=None):
    """The entity a fact is about: {type, name?, email?, slack_id?}. Returns its id, or None for the person
    themself (facts about you aren't kept)."""
    if not isinstance(ref, dict):
        raise FuzzError("about is {type, name, email?, slack_id?}", "about")
    typ = ref.get("type") or "person"
    me = me if me is not None else core.config.get("me", {})
    name = (ref.get("name") or "").strip()
    if typ == "person":
        r = entities.resolve_person(core, {k: ref[k] for k in ("name", "email", "slack_id") if ref.get(k)}, me)
        return r[0] if r else None
    if not name:
        raise FuzzError(f"about.name is required for a {typ}", "about.name")
    if typ == "term":
        return entities.resolve_term(core, name)[0]
    if typ in ("tool", "org"):
        if typ == "org" and ref.get("domain"):
            eid = entities._by_identifier(core, "domain", ref["domain"].lower())
            if eid:
                return eid
        eid = entities._unique_alias(core, typ, name)
        if eid is None:
            eid = entities._new_entity(core, typ, name, False)
            if typ == "org" and ref.get("domain"):
                entities._add_identifier(core, "domain", ref["domain"].lower(), eid)
        return eid
    raise FuzzError("about.type is person, org, tool or term", "about.type")


def add_aliases(core, eid, aliases):
    for a in aliases or []:
        a = (a or "").strip().lower()
        if a:
            core.q("INSERT OR IGNORE INTO aliases VALUES (?,?)", (eid, a))


# ---------------------------------------------------------------- writing

def record_refusal(core, item, reason):
    core.q("INSERT INTO memory_refusals (user_id, run_id, ts, item, reason) VALUES (?,?,?,?,?)",
           (core.user_id, (core.run or {}).get("id"), core.now_iso(), json.dumps(item, default=str), reason))


def check(core, eid, attr, value, how):
    """Refuse what the record may not hold. Raises FuzzError naming the field."""
    e = require_entity(core, eid)
    allowed = ALLOWED.get(e["type"], ())
    if attr not in allowed:
        raise FuzzError(f"attr {attr!r} isn't kept for a {e['type']}: one of {', '.join(allowed) or 'none'}. "
                        "Person records hold working context only.", "attr")
    if how not in HOW:
        raise FuzzError(f"how is one of {', '.join(HOW)}", "how")
    v = (value or "").strip() if isinstance(value, str) else None
    if not v:
        raise FuzzError("value is a short text", "value")
    if len(v) > VALUE_MAX:
        raise FuzzError(f"value is at most {VALUE_MAX} characters: a summary, not a copy", "value")
    return e, v


def authority_for(core, eid, how, said_by, source_kind):
    if how == "edited":
        return "you"
    if source_kind == "directory":
        return "official"
    if said_by and follow(core, said_by) == follow(core, eid):
        return "owner"
    return "other"


def add(core, eid, attr, value, how="extracted", said_by=None, source_kind=None, source_ref=None, link=None,
        source_ts=None, actor=None, confirmed=False, data=None):
    """Write one fact (fact.added). The same claim from the same source again is the same fact: returns
    (fact_id, created)."""
    ensure_migrated(core)
    e, v = check(core, eid, attr, value, how)
    if source_kind and source_kind not in SOURCE_KINDS:
        raise FuzzError(f"source_kind is one of {', '.join(SOURCE_KINDS)}", "source_kind")
    ids = closure(core, e["id"])
    for f in core.all(f"SELECT * FROM facts WHERE user_id=? AND attr=? AND status='live' AND entity_id IN "
                      f"({','.join('?' * len(ids))})", (core.user_id, attr, *ids)):
        if norm(f["value"]) == norm(v) and (f["source_ref"] or "") == (source_ref or "") and f["how"] == how:
            return f["id"], False
    auth = authority_for(core, e["id"], how, said_by, source_kind)
    with core.tx(actor):
        fid = core.new_id("facts")
        ch = events.Changes()
        now = core.now_iso()
        ch.fact(fid, entity_id=e["id"], attr=attr, value=v, how=how, authority=auth, said_by=said_by,
                source_kind=source_kind, source_ref=source_ref, link=link, source_ts=source_ts, captured_at=now,
                status="live", confirmed_at=now if (confirmed or how == "edited") else None)
        events.emit(core, "fact.added", changes=ch,
                    data=dict(data or {}, fact_id=fid, entity_id=e["id"], attr=attr, how=how))
    return fid, True


def get(core, fid):
    f = core.one("SELECT * FROM facts WHERE id=? AND user_id=?", (fid, core.user_id))
    if f is None:
        raise FuzzError(f"No fact {fid}", "fact_id", 404)
    return f


def confirm(core, fid, actor="human", card=None, option="confirm", value=None):
    from .. import cards
    f = get(core, fid)
    with core.tx(actor):
        ch = events.Changes()
        ch.fact(f["id"], confirmed_at=core.now_iso(), status="live")
        if card:
            cards.mark_answered(core, ch, card, option, value)
        events.emit(core, "fact.confirmed", changes=ch, data={"fact_id": f["id"], "entity_id": f["entity_id"]})


def reject(core, fid, actor="human", card=None, option="reject", value=None, extra=None):
    from .. import cards
    f = get(core, fid)
    with core.tx(actor):
        ch = events.Changes()
        ch.fact(f["id"], status="rejected")
        for k, fields in (extra or {}).items():
            ch.fact(k, **fields)
        if card:
            cards.mark_answered(core, ch, card, option, value)
        events.emit(core, "fact.rejected", changes=ch, data={"fact_id": f["id"], "entity_id": f["entity_id"]})


def edit(core, eid, attr, value, actor="human", card=None, option="edit"):
    """You said what it is: a confirmed fact that wins over anything else for a single-valued attribute."""
    from .. import cards
    ensure_migrated(core)
    e, v = check(core, eid, attr, value, "edited")
    with core.tx(actor):
        fid = core.new_id("facts")
        ch = events.Changes()
        now = core.now_iso()
        ch.fact(fid, entity_id=e["id"], attr=attr, value=v, how="edited", authority="you", said_by=None,
                source_kind="you", source_ref=None, link=None, source_ts=now, captured_at=now, status="live",
                confirmed_at=now)
        if card:
            cards.mark_answered(core, ch, card, option, v)
        events.emit(core, "fact.edited", changes=ch, data={"fact_id": fid, "entity_id": e["id"], "attr": attr})
    return fid


def record_views(core, fact_ids, surface):
    """The facts were shown to you (a brief delivered, a recall answer, a sheet): exposure, for rule 6.
    Never called by the inspector, so debugging doesn't raise trust."""
    now = core.now_iso()
    for fid in dict.fromkeys(fact_ids or []):
        core.q("INSERT INTO fact_views VALUES (?,?,?,?)", (core.user_id, fid, now, surface))


# ---------------------------------------------------------------- reading

def views(core, fact_ids):
    if not fact_ids:
        return {}
    out = {}
    for r in core.all(f"SELECT fact_id, shown_at FROM fact_views WHERE user_id=? AND fact_id IN "
                      f"({','.join('?' * len(fact_ids))})", (core.user_id, *fact_ids)):
        out.setdefault(r["fact_id"], []).append(r["shown_at"])
    return out


def _judge(core, rows, now):
    """Each fact with its trust, then per attribute: which value wins, which are superseded, and whether the
    top two disagree badly enough to ask (disputed)."""
    seen = views(core, [f["id"] for f in rows])
    for f in rows:
        f["trust"] = trust_mod.trust(f, now, seen.get(f["id"], ()), trust_mod.half_life(core, f["attr"]))
    out = []
    by_attr = {}
    for f in rows:
        by_attr.setdefault(f["attr"], []).append(f)
    for attr, fs in by_attr.items():
        groups = {}
        for f in fs:
            groups.setdefault(norm(f["value"]), []).append(f)
        ranked = []
        for vals in groups.values():
            vals.sort(key=lambda f: trust_mod.order_key(f, f["trust"]))
            ranked.append(vals)
        ranked.sort(key=lambda vals: trust_mod.order_key(vals[0], vals[0]["trust"]))
        disputed = attr in SINGLE and len(ranked) > 1 and _real_conflict(ranked[0][0], ranked[1][0])
        for i, vals in enumerate(ranked):
            best = vals[0]
            state = "winner" if i == 0 or attr not in SINGLE else "superseded"
            best = dict(best, state=state, disputed=disputed and i < 2,
                        sources=[_source(f) for f in vals], corroborated=len(vals))
            out.append(best)
    out.sort(key=lambda f: (f["attr"], f["state"] != "winner", trust_mod.order_key(f, f["trust"])))
    return out


def _real_conflict(a, b):
    """Both equally trusted (authoritative or reported, not stale), neither confirmed, and their sources close
    in time: nothing says which is right, so ask instead of picking."""
    ta, tb = a["trust"], b["trust"]
    if ta["level"] != tb["level"] or ta["level"] not in ("authoritative", "reported"):
        return False
    da, db = (parse_iso(f.get("source_ts") or f.get("captured_at")) for f in (a, b))
    return abs((da - db).total_seconds()) <= CONFLICT_DAYS * 86400


def _source(f):
    return {"fact_id": f["id"], "how": f["how"], "authority": f["authority"], "said_by": f["said_by"],
            "source_kind": f["source_kind"], "source_ref": f["source_ref"], "link": f["link"],
            "source_ts": f["source_ts"], "captured_at": f["captured_at"]}


def for_entity(core, eid, now=None, include_all=False):
    """The entity's facts, judged. include_all: rejected and undone ones too (for the inspector). Read-only."""
    ids = closure(core, eid)
    now = now or core.now()
    q = f"SELECT * FROM facts WHERE user_id=? AND entity_id IN ({','.join('?' * len(ids))})"
    rows = core.all(q + " AND status='live' ORDER BY id", (core.user_id, *ids))
    out = _judge(core, rows, now)
    if include_all:
        for f in core.all(q + " AND status!='live' ORDER BY id", (core.user_id, *ids)):
            f["trust"] = trust_mod.trust(f, now, (), trust_mod.half_life(core, f["attr"]))
            out.append(dict(f, state=f["status"], disputed=False, sources=[_source(f)], corroborated=1))
    return out


def winners(core, eid, now=None):
    """{attr: value or [values]}, the record as it stands."""
    out = {}
    for f in for_entity(core, eid, now):
        if f["state"] != "winner":
            continue
        if f["attr"] in SINGLE:
            out[f["attr"]] = f["value"]
        else:
            out.setdefault(f["attr"], []).append(f["value"])
    return out


def disputes(core, eid, now=None):
    """[(a, b)] pairs of facts that disagree and need you."""
    fs = [f for f in for_entity(core, eid, now) if f["disputed"]]
    by = {}
    for f in fs:
        by.setdefault(f["attr"], []).append(f)
    return [(v[0], v[1]) for v in by.values() if len(v) >= 2]


def is_unconfirmed_inference(core, fid):
    """Rule 4: keyed on how, never on the trust level. A guess exposure raised is still a guess."""
    f = core.one("SELECT how, confirmed_at, status FROM facts WHERE id=? AND user_id=?", (fid, core.user_id))
    return bool(f) and f["status"] == "live" and f["how"] == "inferred" and not f["confirmed_at"]


# ---------------------------------------------------------------- definitions, and the entity tables' undo

def ensure_migrated(core):
    """Old stores kept a term's definition in entities.definition with no provenance: each becomes a fact
    you wrote (an event, so rebuild keeps it). Emits nothing when there's nothing to move."""
    rows = core.all("SELECT e.id, e.definition FROM entities e WHERE e.user_id=? AND e.definition IS NOT NULL "
                    "AND e.definition != '' AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.entity_id=e.id "
                    "AND f.attr='definition' AND f.user_id=e.user_id)", (core.user_id,))
    if not rows:
        return 0
    with core.tx("system"):
        for r in rows:
            fid = core.new_id("facts")
            ch = events.Changes()
            now = core.now_iso()
            ch.fact(fid, entity_id=r["id"], attr="definition", value=r["definition"], how="edited", authority="you",
                    said_by=None, source_kind="you", source_ref=None, link=None, source_ts=None, captured_at=now,
                    status="live", confirmed_at=now)
            events.emit(core, "fact.added", changes=ch, data={"fact_id": fid, "entity_id": r["id"],
                                                              "attr": "definition", "migrated": True})
    return len(rows)


def undo_entity_event(core, e):
    """Undo of entity.merged / entity.kept_separate: the entity tables are derived, so put them back by hand.
    Facts follow redirect_to when read, so un-merging splits them back too."""
    d = e["payload"].get("data") or {}
    if e["type"] == "entity.merged" and d.get("from"):
        core.q("UPDATE entities SET redirect_to=NULL WHERE id=? AND user_id=?", (d["from"], core.user_id))
    if e["type"] == "entity.kept_separate" and d.get("a") and d.get("b"):
        core.q("DELETE FROM entity_links WHERE a=? AND b=?", (d["a"], d["b"]))


def recent(core, days):
    return core.now() - timedelta(days=days)
