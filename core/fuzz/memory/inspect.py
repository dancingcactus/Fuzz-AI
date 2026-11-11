"""The inspector: everything memory holds, and why, for building and debugging it. Read-only.

Nothing here writes: no events, no fact_views (debugging must never raise trust), no files. `at` works trust
out at another date without saving anything. `fuzz inspect` and GET /inspect/... return the same JSON.
"""

import json

from ..db import FuzzError, parse_iso
from ..matching import entities, who
from . import briefs, extract, facts, knowledge, mcards

STATES = ("provisional", "stale", "disputed", "merged", "thin", "undefined")


def _payload(r):
    p = r["payload"]
    return p if isinstance(p, dict) else json.loads(p)


def _now(core, at):
    return parse_iso(at) if at else core.now()


def _ident(core, eid):
    return [{"type": r["type"], "value": r["value"]} for r in core.all(
        "SELECT type, value FROM identifiers WHERE entity_id=? AND user_id=?", (eid, core.user_id))]


def _aliases(core, eid):
    return [r["alias"] for r in core.all("SELECT alias FROM aliases WHERE entity_id=? ORDER BY alias", (eid,))]


def _row(core, e, now):
    fs = facts.for_entity(core, e["id"], now) if e["redirect_to"] is None else []
    n_sight = core.one("SELECT COUNT(DISTINCT signal_key) n FROM sightings WHERE user_id=? AND entity_id=?",
                       (core.user_id, e["id"]))["n"]
    n_ment = core.one("SELECT COUNT(*) n FROM mentions WHERE entity_id=?", (e["id"],))["n"]
    flags = []
    if e["provisional"]:
        flags.append("provisional")
    if any(f["trust"]["stale"] for f in fs):
        flags.append("stale")
    if any(f["disputed"] for f in fs):
        flags.append("disputed")
    if e["redirect_to"]:
        flags.append("merged")
    if len(fs) <= 1:
        flags.append("thin")
    if e["type"] in ("term", "tool") and not any(f["attr"] in ("definition", "what_it_is") for f in fs):
        flags.append("undefined")
    return {"id": e["id"], "type": e["type"], "name": entities.display_name(core.conn, e), "provisional": bool(e["provisional"]),
            "redirect_to": e["redirect_to"], "facts": len(fs), "sightings": n_sight, "mentions": n_ment, "flags": flags}


def entities_list(core, type=None, q=None, state=None, at=None, limit=500):
    if state and state not in STATES:
        raise FuzzError(f"state is one of {', '.join(STATES)}", "state")
    now = _now(core, at)
    sql, args = "SELECT * FROM entities WHERE user_id=?", [core.user_id]
    if type:
        sql += " AND type=?"
        args.append(type)
    if q:
        sql += " AND (lower(name) LIKE ? OR id IN (SELECT entity_id FROM aliases WHERE alias LIKE ?) OR id IN " \
               "(SELECT entity_id FROM identifiers WHERE value LIKE ?))"
        args += [f"%{q.lower()}%"] * 3
    rows = [_row(core, e, now) for e in core.all(sql + " ORDER BY id DESC LIMIT ?", args + [limit])]
    if state:
        rows = [r for r in rows if state in r["flags"]]
    counts = {r["type"]: r["n"] for r in core.all("SELECT type, COUNT(*) n FROM entities WHERE user_id=? GROUP BY type", (core.user_id,))}
    return {"counts": counts, "entities": rows, "at": now.isoformat()}


def _chain(core, eid):
    out, cur = [], eid
    while True:
        r = core.one("SELECT redirect_to FROM entities WHERE id=?", (cur,))
        if not r or not r["redirect_to"] or r["redirect_to"] in out:
            return out
        cur = r["redirect_to"]
        out.append(cur)


def entity_detail(core, eid, at=None):
    e = core.one("SELECT * FROM entities WHERE id=? AND user_id=?", (eid, core.user_id))
    if e is None:
        raise FuzzError(f"No entity {eid}", "entity_id", 404)
    now = _now(core, at)
    head = facts.follow(core, eid)
    merged_in = [i for i in facts.closure(core, head) if i != head]
    ids = facts.closure(core, head)
    marks = ",".join("?" * len(ids))
    all_facts = facts.for_entity(core, head, now, include_all=True)
    seen = facts.views(core, [f["id"] for f in all_facts])
    for f in all_facts:
        f["views"] = seen.get(f["id"], [])
        if f.get("said_by"):
            f["said_by_name"] = entities.display_name(core.conn, facts.entity(core, f["said_by"]))
    mentions = core.all(f"SELECT m.candidate_id, m.entity_id, m.strength, c.ask, c.signal_key, c.status, "
                        f"(SELECT s.task_id FROM sources s WHERE s.candidate_id=c.id LIMIT 1) task_id FROM mentions m "
                        f"JOIN candidates c ON c.id=m.candidate_id WHERE m.entity_id IN ({marks}) ORDER BY m.candidate_id DESC LIMIT 50",
                        tuple(ids))
    sightings = core.all(f"SELECT s.signal_key, s.role, s.ts, g.source, g.quote, g.link FROM sightings s LEFT JOIN signals g "
                         f"ON g.key=s.signal_key AND g.user_id=s.user_id WHERE s.user_id=? AND s.entity_id IN ({marks}) "
                         f"ORDER BY s.ts DESC LIMIT 50", (core.user_id, *ids))
    card_rows = [c for c in core.all("SELECT * FROM cards WHERE user_id=? AND kind IN ('entity_person','entity_term',"
                                     "'fact_conflict') ORDER BY id DESC", (core.user_id,))
                 if set(_card_entities(c)) & set(ids)]
    links = core.all(f"SELECT * FROM entity_links WHERE a IN ({marks}) OR b IN ({marks})", (*ids, *ids))
    evs = []
    fact_ids = {f["id"] for f in all_facts}
    for r in core.all("SELECT id, ts, actor, type, payload, run_id FROM events WHERE user_id=? AND (type LIKE 'entity.%' "
                      "OR type LIKE 'fact.%') ORDER BY id DESC LIMIT 400", (core.user_id,)):
        d = _payload(r).get("data") or {}
        touched = {d.get("entity_id"), d.get("from"), d.get("into"), d.get("a"), d.get("b")}
        if touched & set(ids) or d.get("fact_id") in fact_ids:
            evs.append({"id": r["id"], "ts": r["ts"], "actor": r["actor"], "type": r["type"], "data": d, "run_id": r["run_id"]})
    kn, ds = knowledge.for_entity(core, head)
    return {"entity": dict(e, display_name=entities.display_name(core.conn, e)), "follows_to": _chain(core, eid),
            "merged_in": merged_in, "aliases": _aliases(core, eid), "identifiers": _ident(core, eid),
            "entity_links": links, "facts": all_facts, "mentions": mentions, "sightings": sightings,
            "cards": [{"id": c["id"], "kind": c["kind"], "status": c["status"], "answer": c.get("answer"),
                       "created_at": c.get("created_at"), "payload": c.get("payload")} for c in card_rows],
            "knowledge": kn, "decisions": ds, "events": evs[:60], "at": now.isoformat()}


def _card_entities(c):
    p = c.get("payload") or {}
    return [x for x in (p.get("entity_a"), p.get("entity_b"), p.get("entity_id")) if x]


def fact_detail(core, fid, at=None):
    f = facts.get(core, fid)
    now = _now(core, at)
    head = facts.follow(core, f["entity_id"])
    judged = next((x for x in facts.for_entity(core, head, now, include_all=True)
                   if x["id"] == fid or fid in [s["fact_id"] for s in x.get("sources") or []]), None)
    rivals = [x for x in facts.for_entity(core, head, now) if x["attr"] == f["attr"] and x["id"] != (judged or {}).get("id")]
    why_lost = None
    if judged and judged.get("state") == "superseded":
        win = next((x for x in rivals if x["state"] == "winner"), None)
        if win:
            why_lost = (f"Fact {win['id']} wins: {win['trust']['level']} beats {judged['trust']['level']}"
                        if win["trust"]["level"] != judged["trust"]["level"] else
                        f"Fact {win['id']} wins: same level, newer source ({win.get('source_ts')} vs {judged.get('source_ts')})")
    return {"fact": f, "judged": judged, "rivals": rivals, "why_lost": why_lost,
            "views": facts.views(core, [fid]).get(fid, []), "at": now.isoformat()}


def why_not(core, a, b):
    """Why no "same person?" card was raised for two entities."""
    ea, eb = (core.one("SELECT * FROM entities WHERE id=? AND user_id=?", (x, core.user_id)) for x in (a, b))
    if not ea or not eb:
        raise FuzzError("Both ids must be entities", "a")
    reasons = []
    if facts.follow(core, a) == facts.follow(core, b):
        reasons.append("They're already the same entity (merged).")
    if core.one("SELECT 1 FROM entity_links WHERE (a=? AND b=?) OR (a=? AND b=?)", (a, b, b, a)):
        reasons.append("You said they're different people.")
    if ea["type"] != "person" or eb["type"] != "person":
        reasons.append("Only people are compared.")
    prov = [e for e in (ea, eb) if e["provisional"]]
    holder = next((e for e in prov if who.is_holder(e)), None)
    if not prov:
        reasons.append("Neither is provisional: both were seen with an email or Slack ID, so the matcher trusts them.")
    elif len(prov) == 2:
        reasons.append("Both are provisional (name only): Fuzz waits until one of them is seen with an email or Slack ID.")
    else:
        p, k = (ea, eb) if ea["provisional"] else (eb, ea)
        n = (p["name"] or "").strip().lower()
        if not any(mcards._could_be(n, al) for al in _aliases(core, k["id"])):
            reasons.append(f"“{p['name']}” doesn't look like a short form of any of {k['name']}'s names.")
        others = [x for x in core.all("SELECT * FROM entities WHERE user_id=? AND type='person' AND provisional=0 AND "
                                      "redirect_to IS NULL AND id!=?", (core.user_id, k["id"]))
                  if any(mcards._could_be(n, al) for al in _aliases(core, x["id"]))]
        if others and not holder:   # a first name's card offers each one it could be
            reasons.append(f"“{p['name']}” could also be {', '.join(entities.display_name(core.conn, x) for x in others[:3])}, "
                           "so Fuzz doesn't guess.")
    key = f"who:{holder['id']}" if holder else f"people:{min(a, b)}:{max(a, b)}"
    asked = core.one("SELECT id, status FROM cards WHERE user_id=? AND kind='entity_person' AND (json_extract(payload,'$.key')=? "
                     "OR json_extract(payload,'$.entity_b')=?)", (core.user_id, key, holder["id"] if holder else -1))
    if asked:
        reasons.append(f"It was asked already: card {asked['id']} ({asked['status']}).")
    if not reasons:
        held = [h for h in mcards.held(core) if h["key"] == key]
        reasons.append("Held back by today's card cap: it'll be asked on a later day." if held else
                       "Nothing stops it: it's raised on the next pass.")
    return {"a": _row(core, ea, core.now()), "b": _row(core, eb, core.now()), "reasons": reasons}


def knowledge_list(core):
    out = []
    for k in core.all("SELECT * FROM knowledge WHERE user_id=? ORDER BY id DESC LIMIT 300", (core.user_id,)):
        out.append(dict(k, links=_named_links(core, knowledge.links_of(core, "knowledge", k["id"]))))
    return {"knowledge": out}


def _named_links(core, links):
    for ln in links:
        if ln["target_type"] == "entity":
            e = facts.entity(core, ln["target_id"])
            ln["name"] = entities.display_name(core.conn, e) if e else None
    return links


def decisions_list(core):
    out = []
    for d in core.all("SELECT * FROM decision_log WHERE user_id=? ORDER BY id DESC LIMIT 300", (core.user_id,)):
        who = facts.entity(core, d["decided_by"]) if d["decided_by"] else None
        out.append(dict(d, decided_by_name=entities.display_name(core.conn, who) if who else None,
                        links=_named_links(core, knowledge.links_of(core, "decision", d["id"])),
                        reversed_by=[x["id"] for x in knowledge.reversed_by(core, d["id"])]))
    return {"decisions": out}


def runs_list(core, limit=30):
    return {"runs": core.all("SELECT id, role, client, model, prompt_version, trigger, started_at, finished_at, outcome "
                             "FROM runs WHERE user_id=? AND role IN ('extractor','ask','recall') ORDER BY id DESC LIMIT ?",
                             (core.user_id, limit))}


def run_detail(core, run_id):
    r = core.one("SELECT * FROM runs WHERE id=? AND user_id=?", (run_id, core.user_id))
    if r is None:
        raise FuzzError(f"No run {run_id}", "run_id", 404)
    signals = core.all("SELECT key, source, ts, quote, payload FROM signals WHERE user_id=? AND run_id=? ORDER BY ts",
                       (core.user_id, run_id))
    submitted = {"facts": [], "terms": [], "decisions": [], "meetings": []}
    for s in signals:
        p = s["payload"] if isinstance(s["payload"], dict) else json.loads(s["payload"])
        for k, name in (("facts", "facts"), ("terms", "terms"), ("decisions", "decisions")):
            submitted[name] += [dict(x, signal=s["key"]) for x in p.get(k) or []]
        if p.get("meeting"):
            submitted["meetings"].append(dict(p["meeting"], signal=s["key"]))
    accepted = {}
    made_cards = []
    for e in core.all("SELECT type, payload FROM events WHERE user_id=? AND run_id=?", (core.user_id, run_id)):
        accepted[e["type"]] = accepted.get(e["type"], 0) + 1
        if e["type"] == "card.created":
            made_cards.append(_payload(e)["data"])
    refused = [dict(x, item=json.loads(x["item"])) for x in core.all(
        "SELECT ts, item, reason FROM memory_refusals WHERE user_id=? AND run_id=? ORDER BY id", (core.user_id, run_id))]
    return {"run": r, "signals": len(signals), "submitted": submitted, "accepted": accepted, "refused": refused,
            "cards": made_cards, "held_by_cap": mcards.held(core)}


def briefs_state(core):
    m = extract.meetings(core) or {}
    out = []
    lead = float((core.config.get("memory") or {}).get("brief_lead_mins", briefs.LEAD_MINS))
    from datetime import timedelta
    for x in sorted(m.get("meetings") or [], key=lambda x: x["start"]):
        key = briefs.meeting_key(x)
        f = core.one("SELECT id, path, updated_at FROM memory_files WHERE user_id=? AND kind='brief' AND meeting_key=?",
                     (core.user_id, key))
        sent = core.one("SELECT id, ts FROM events WHERE user_id=? AND type='brief.due' AND json_extract(payload,'$.data.meeting_key')=?",
                        (core.user_id, key))
        out.append({"meeting": x, "key": key, "wants_brief": briefs.wants_brief(core, x),
                    "fires_at": (parse_iso(x["start"]) - timedelta(minutes=lead)).isoformat(), "fired": sent,
                    "file": dict(f, url=f"artifact.html?id=k{f['id']}") if f else None})
    return {"read_at": m.get("at"), "read_now": extract.meetings_stale(core), "onboarding": mcards.onboarding(core),
            "onboarding_from": mcards.onboarding_from(core).isoformat(), "card_cap": mcards.cap(core),
            "cards_today": mcards.raised_today(core), "meetings": out,
            "files": [dict(f, url=f"artifact.html?id=k{f['id']}") for f in briefs.files(core)]}


def overview(core):
    """Counts for the inspector's header."""
    n = lambda sql: core.one(sql, (core.user_id,))["n"]   # noqa: E731
    return {"entities": n("SELECT COUNT(*) n FROM entities WHERE user_id=?"),
            "facts": n("SELECT COUNT(*) n FROM facts WHERE user_id=? AND status='live'"),
            "knowledge": n("SELECT COUNT(*) n FROM knowledge WHERE user_id=? AND status='live'"),
            "decisions": n("SELECT COUNT(*) n FROM decision_log WHERE user_id=? AND status IN ('recorded','proposed')"),
            "refusals": n("SELECT COUNT(*) n FROM memory_refusals WHERE user_id=?"),
            "open_cards": core.one(f"SELECT COUNT(*) n FROM cards WHERE user_id=? AND status='open' AND kind IN "
                                   f"({','.join('?' * len(mcards.KINDS))})", (core.user_id, *mcards.KINDS))["n"],
            "held_by_cap": len(mcards.held(core))}
