"""Answering from memory: who is X, what is Y, why did we decide Z. The fuzz-recall MCP role and the app's ask
box use these; the executor gets who_is and what_is for context while drafting.

Every answer carries its sources (link, who, when) and a trust label, so the reader can say "Fuzz's guess" or
"disputed" where it applies. Answering counts as showing you those facts (exposure); the inspector never does.
"""

import re
import uuid

from .. import events
from ..db import FuzzError
from ..matching import entities
from . import briefs, facts, knowledge, mcards

WORD = re.compile(r"[a-z0-9]+")
STOP = set("a an and are as at be by did do does for from how i in is it its me my of on or our the this to "
           "was we were what when where which who why with you your".split())


def _label(level):
    return mcards.label(level)


def _src(core, s):
    said = facts.entity(core, s["said_by"]) if s.get("said_by") else None
    return {"link": s.get("link"), "kind": s.get("source_kind"), "when": s.get("source_ts") or s.get("captured_at"),
            "who": entities.display_name(core.conn, said) if said else None, "ref": s.get("source_ref")}


def _fact_out(core, f):
    return {"fact_id": f["id"], "attr": f["attr"], "value": f["value"], "trust": _label(f["trust"]["level"]),
            "level": f["trust"]["level"], "disputed": f.get("disputed", False), "how": f["how"],
            "sources": [_src(core, s) for s in f.get("sources") or []]}


def find(core, name, types=("person",)):
    """Entities matching a name, an email or an alias (exact first, then a word that starts with it)."""
    q = (name or "").strip().lower()
    if not q:
        raise FuzzError("name is who or what to look up", "name")
    marks = ",".join("?" * len(types))
    hits = []
    if "@" in q:
        eid = entities._by_identifier(core, "email", q)
        if eid:
            hits.append(eid)
    for r in core.all(f"SELECT DISTINCT e.id FROM aliases a JOIN entities e ON e.id=a.entity_id WHERE e.user_id=? "
                      f"AND e.type IN ({marks}) AND a.alias=?", (core.user_id, *types, q)):
        hits.append(r["id"])
    if not hits:
        for r in core.all(f"SELECT DISTINCT e.id FROM aliases a JOIN entities e ON e.id=a.entity_id WHERE e.user_id=? "
                          f"AND e.type IN ({marks}) AND (a.alias LIKE ? OR a.alias LIKE ?) LIMIT 10",
                          (core.user_id, *types, q + "%", "% " + q + "%")):
            hits.append(r["id"])
    return list(dict.fromkeys(facts.follow(core, h) for h in hits))


def _interactions(core, eid, limit=6):
    ids = facts.closure(core, eid)
    rows = core.all(f"SELECT g.source, g.ts, g.quote, g.link, s.role FROM sightings s JOIN signals g ON g.key=s.signal_key "
                    f"AND g.user_id=s.user_id WHERE s.user_id=? AND s.entity_id IN ({','.join('?' * len(ids))}) "
                    f"AND s.role IN ('from','on','named') GROUP BY g.key ORDER BY g.ts DESC LIMIT ?", (core.user_id, *ids, limit))
    return [{"via": r["source"], "when": r["ts"], "what": r["quote"], "link": r["link"], "role": r["role"]} for r in rows]


def _entity_answer(core, eid, surface="recall", record=True):
    e = facts.entity(core, eid)
    fs = [f for f in facts.for_entity(core, eid) if f["state"] == "winner"]
    kn, ds = knowledge.for_entity(core, eid)
    out = {"entity_id": eid, "type": e["type"], "name": entities.display_name(core.conn, e),
           "aliases": [a["alias"] for a in core.all("SELECT alias FROM aliases WHERE entity_id=?", (eid,))],
           "facts": [_fact_out(core, f) for f in fs],
           "knowledge": [{"knowledge_id": k["id"], "kind": k["kind"], "title": k["title"], "summary": k["summary_md"],
                          "link": k["link"], "when": k["source_ts"]} for k in kn[:5]],
           "decisions": [_decision_out(core, d) for d in ds[:5]]}
    if e["type"] == "person":
        out["recent"] = _interactions(core, eid)
        out["open"] = briefs.open_items(core, eid)
    else:
        out["came_up"] = _interactions(core, eid, 4)
    if record:
        facts.record_views(core, [f["id"] for f in fs], surface)
    return out


def who_is(core, name, record=True):
    hits = find(core, name, ("person",))
    if not hits:
        return {"found": False, "name": name, "say": f"Fuzz has no record of {name} yet."}
    if len(hits) > 1:
        return {"found": False, "ambiguous": [{"entity_id": h, "name": entities.display_name(core.conn, facts.entity(core, h))}
                                              for h in hits[:8]], "say": "More than one person matches. Ask again by full name."}
    return dict(_entity_answer(core, hits[0], record=record), found=True)


def what_is(core, term, record=True):
    hits = find(core, term, ("term", "tool", "org", "document", "ticket"))
    if not hits:
        return {"found": False, "term": term, "say": f"Fuzz hasn't come across {term}."}
    return dict(_entity_answer(core, hits[0], record=record), found=True,
                **({"also": [entities.display_name(core.conn, facts.entity(core, h)) for h in hits[1:5]]} if len(hits) > 1 else {}))


def _decision_out(core, d):
    who = facts.entity(core, d["decided_by"]) if d.get("decided_by") else None
    later = knowledge.reversed_by(core, d["id"])
    trust = "confirmed" if d.get("confirmed_at") else "inferred" if d["how"] == "inferred" else \
        "authoritative" if d["authority"] == "owner" else "reported"
    return {"decision_id": d["id"], "what": d["what"], "why": d.get("why"), "alternatives": d.get("alternatives") or [],
            "status": d["status"], "decided_by": entities.display_name(core.conn, who) if who else None,
            "when": d.get("decided_at") or d["captured_at"], "link": d.get("link"), "trust": _label(trust),
            "reverses": d.get("reverses"), "reversed_by": [x["id"] for x in later]}


def _words(text):
    return [w for w in WORD.findall((text or "").lower()) if w not in STOP and len(w) > 1]


def _score(qw, text):
    tw = _words(text)
    if not tw or not qw:
        return 0.0
    hit = sum(1 for w in qw if any(t == w or (len(w) > 3 and t.startswith(w)) for t in tw))
    return hit / len(qw)


def why(core, question, limit=5):
    """Decisions and knowledge that answer a 'why' or 'what do we know about' question, best first."""
    qw = _words(question)
    if not qw:
        raise FuzzError("question is what you want to know", "question")
    ds = []
    for d in core.all("SELECT * FROM decision_log WHERE user_id=? AND status IN ('recorded','proposed','reversed')", (core.user_id,)):
        s = _score(qw, " ".join([d["what"], d.get("why") or "", " ".join(d.get("alternatives") or [])]))
        if s > 0:
            ds.append((s + (0.1 if d["status"] == "recorded" else 0), d))
    ks = []
    for k in core.all("SELECT * FROM knowledge WHERE user_id=? AND status='live'", (core.user_id,)):
        s = _score(qw, (k["title"] or "") + " " + k["summary_md"])
        if s > 0:
            ks.append((s, k))
    ds.sort(key=lambda x: -x[0])
    ks.sort(key=lambda x: -x[0])
    return {"decisions": [_decision_out(core, d) for _, d in ds[:limit]],
            "knowledge": [{"knowledge_id": k["id"], "kind": k["kind"], "title": k["title"], "summary": k["summary_md"],
                           "link": k["link"], "when": k["source_ts"] or k["captured_at"]} for _, k in ks[:limit]],
            "say": None if ds or ks else "Fuzz has nothing on that yet."}


def search(core, query, limit=10):
    """Across entities, facts, knowledge and decisions."""
    qw = _words(query)
    if not qw:
        raise FuzzError("query is what to look for", "query")
    ents = []
    for e in core.all("SELECT * FROM entities WHERE user_id=? AND redirect_to IS NULL AND name IS NOT NULL", (core.user_id,)):
        s = _score(qw, e["name"])
        if s > 0:
            ents.append((s, e))
    fs = []
    for f in core.all("SELECT * FROM facts WHERE user_id=? AND status='live'", (core.user_id,)):
        s = _score(qw, f["value"])
        if s > 0:
            fs.append((s, f))
    ents.sort(key=lambda x: -x[0])
    fs.sort(key=lambda x: -x[0])
    w = why(core, query, limit)
    return {"entities": [{"entity_id": e["id"], "type": e["type"], "name": e["name"]} for _, e in ents[:limit]],
            "facts": [{"fact_id": f["id"], "entity_id": facts.follow(core, f["entity_id"]),
                       "about": entities.display_name(core.conn, facts.entity(core, facts.follow(core, f["entity_id"]))),
                       "attr": f["attr"], "value": f["value"]} for _, f in fs[:limit]],
            "decisions": w["decisions"], "knowledge": w["knowledge"]}


def correct(core, attr, value, fact_id=None, entity_id=None, name=None):
    """The person, in their own session, says what's right: a confirmed fact (undoable). Only the interactive
    recall role has this; a headless ask run doesn't, since nobody is there to vouch for it."""
    if fact_id:
        eid = facts.get(core, fact_id)["entity_id"]
    elif entity_id:
        eid = entity_id
    elif name:
        hits = find(core, name, ("person", "term", "tool", "org"))
        if len(hits) != 1:
            raise FuzzError(f"{'No' if not hits else 'More than one'} entity matches {name!r}: pass entity_id", "name")
        eid = hits[0]
    else:
        raise FuzzError("Pass fact_id, entity_id or name", "fact_id")
    fid = facts.edit(core, facts.follow(core, eid), attr, value, actor="human")
    if fact_id and facts.get(core, fact_id)["attr"] == attr and facts.norm(facts.get(core, fact_id)["value"]) != facts.norm(value):
        facts.reject(core, fact_id, actor="human")
    return {"fact_id": fid}


def for_task(core, t, limit=6):
    """The task's people (from its messages) and the known terms in its words, with their winning facts."""
    from .. import people as people_mod
    out = {"people": [], "terms": []}
    for p in people_mod.for_task(core, t)[:limit]:
        eid = entities.lookup_person(core, {"name": p["name"], "email": p["email"]})
        if not eid:
            continue
        eid = facts.follow(core, eid)
        fs = [f for f in facts.for_entity(core, eid) if f["state"] == "winner"]
        if fs:
            out["people"].append({"name": p["name"], "entity_id": eid, "facts": [_fact_brief(f) for f in fs]})
    text = " ".join(x or "" for x in (t.get("title"), t.get("ask"), t.get("context_md"))).lower()
    words = set(re.findall(r"[a-z0-9][a-z0-9\-]+", text))
    for e in core.all("SELECT DISTINCT e.id, e.name FROM entities e JOIN aliases a ON a.entity_id=e.id WHERE e.user_id=? "
                      "AND e.type IN ('term','tool') AND e.redirect_to IS NULL", (core.user_id,)):
        names = {a["alias"] for a in core.all("SELECT alias FROM aliases WHERE entity_id=?", (e["id"],))}
        if not any(n in words or (" " in n and n in text) for n in names):
            continue
        fs = [f for f in facts.for_entity(core, e["id"]) if f["state"] == "winner"]
        if fs:
            out["terms"].append({"term": e["name"], "entity_id": e["id"], "facts": [_fact_brief(f) for f in fs]})
        if len(out["terms"]) >= limit:
            break
    return out


def _fact_brief(f):
    return {"fact_id": f["id"], "attr": f["attr"], "value": f["value"], "trust": _label(f["trust"]["level"]),
            **({"disputed": True} if f.get("disputed") else {})}


# ---------------------------------------------------------------- the app's ask box

def answer(core, ask_id, text, sources=None):
    """The headless ask run's reply to the question it was given: the UI shows it as Fuzz's answer."""
    if not ask_id or not (text or "").strip():
        raise FuzzError("ask_id and text are required", "text")
    with core.tx("fuzz:recall"):
        events.emit(core, "memory.answered", data={"ask_id": ask_id, "text": text.strip()[:4000],
                                                   "sources": list(sources or [])[:10]})
    return {"ok": True}


def new_ask_id():
    return uuid.uuid4().hex[:12]
