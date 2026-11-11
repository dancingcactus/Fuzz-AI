"""What the extractor hands memory: facts, terms, decisions and meeting summaries on signals, then a second pass
(get_lookups, submit_facts, submit_knowledge, report_meetings) that fills in from context.

Anything the core refuses (a person fact outside the allowlist, an unresolvable subject) doesn't fail the batch:
it's recorded in memory_refusals with the reason, counted in the reply, and shown in the inspector.
"""

import json
from datetime import timedelta

from .. import events
from ..db import FuzzError, iso, parse_iso
from ..matching import entities, who
from . import facts, knowledge

SETTLE_DAYS = 2
SETTLE_MESSAGES = 5
LOOKUP_LIMIT = {"people": 10, "things": 5, "terms": 10, "threads": 5, "links": 5, "decisions": 20}


def _cfg(core):
    return core.config.get("memory") or {}


def _me(core):
    return core.config.get("me", {})


def _person(core, p, ctx=None):
    if not p:
        return None
    r = entities.resolve_person(core, p, _me(core), ctx)
    return r[0] if r else None


def sight(core, eid, key, role, ts):
    if eid:
        core.q("INSERT OR IGNORE INTO sightings VALUES (?,?,?,?,?)", (core.user_id, eid, key, role, ts))


def _try(core, counts, item, fn):
    try:
        return fn()
    except FuzzError as e:
        facts.record_refusal(core, item, str(e))
        counts["refused"] = counts.get("refused", 0) + 1
        counts.setdefault("refusals", []).append(str(e))
        return None


# ---------------------------------------------------------------- on each signal

def ingest_signal(core, s, key, cand_ids):
    """Memory's share of one new signal. Runs inside submit_signals' transaction."""
    counts = {}
    if s.get("withdrawn"):
        return counts
    ts = s.get("ts")
    ctx = who.Context(core, s, key, _me(core))
    # a meeting's "from" is its title, not a person
    sender = _person(core, s.get("from"), ctx) if s.get("from") and s["source"] != "meeting" else None
    sight(core, sender, key, "from", ts)
    for p in s.get("people") or []:
        sight(core, _person(core, p, ctx), key, "on", ts)
    for cid in cand_ids:
        for m in core.all("SELECT entity_id FROM mentions WHERE candidate_id=?", (cid,)):
            e = facts.entity(core, m["entity_id"])
            # a matcher topic isn't jargon: only terms the extractor flags (terms) get "What is this?" and the glossary
            sight(core, m["entity_id"], key, "topic" if e and e["type"] in ("term", "tool") else "named", ts)
    meeting_id = None
    if s.get("meeting"):
        meeting_id = _try(core, counts, s["meeting"], lambda: _meeting(core, s, key))
        if meeting_id:
            counts["knowledge"] = counts.get("knowledge", 0) + 1
    for t in s.get("terms") or []:
        if _try(core, counts, t, lambda t=t: _term(core, t, s, key)) is not None:
            counts["terms"] = counts.get("terms", 0) + 1
    for f in s.get("facts") or []:
        r = _try(core, counts, f, lambda f=f: _fact(core, f, s, key, sender, ctx))
        if r and r[1]:
            counts["facts"] = counts.get("facts", 0) + 1
    for d in s.get("decisions") or []:
        r = _try(core, counts, d, lambda d=d: _decision(core, d, s, key, sender, meeting_id, ctx))
        if r and r[1]:
            counts["decisions"] = counts.get("decisions", 0) + 1
    return counts


def _source_kind(s):
    return s["source"] if s["source"] in facts.SOURCE_KINDS else "doc"


def _fact(core, f, s, key, sender, ctx=None):
    eid = facts.resolve_about(core, f.get("about") or {}, _me(core), ctx)
    if eid is None:
        raise FuzzError("Facts about the person themself aren't kept", "about")
    said = _person(core, f["said_by"], ctx) if f.get("said_by") else sender
    sight(core, eid, key, "about", s.get("ts"))
    return facts.add(core, eid, f.get("attr"), f.get("value"), how=f.get("how") or "stated", said_by=said,
                     source_kind=_source_kind(s), source_ref=key, link=s.get("link"), source_ts=s.get("ts"))


def _term(core, t, s, key):
    name = (t.get("term") or "").strip()
    if not name:
        raise FuzzError("term is the word or acronym as written", "term")
    typ = t.get("kind") or "term"
    eid = facts.resolve_about(core, {"type": typ, "name": name}, _me(core))
    # first seen as a matcher topic ("qbr"): take the spelling the extractor gives ("QBR"), and its kind
    core.q("UPDATE entities SET name=? WHERE id=? AND name=lower(name) AND name!=?", (name, eid, name))
    if typ == "tool":
        core.q("UPDATE entities SET type='tool' WHERE id=? AND type='term'", (eid,))
    facts.add_aliases(core, eid, t.get("aliases"))
    sight(core, eid, key, "term", s.get("ts"))
    if t.get("best_guess"):
        attr = "definition" if typ == "term" else "what_it_is"
        facts.add(core, eid, attr, t["best_guess"], how="inferred", source_kind=_source_kind(s), source_ref=key,
                  link=s.get("link"), source_ts=s.get("ts"))
    return eid


def _decision(core, d, s, key, sender, meeting_id, ctx=None):
    by = _person(core, d["decided_by"], ctx) if d.get("decided_by") else None
    links = []
    if meeting_id:
        links.append(("from", "knowledge", meeting_id))
    for p in s.get("people") or []:
        pid = _person(core, p, ctx)
        if pid and pid != by:
            links.append(("involves", "entity", pid))
    return knowledge.add_decision(core, d.get("what"), why=d.get("why"), alternatives=d.get("alternatives"),
                                  decided_by=by, decided_at=s.get("ts"), source_ref=key, link=s.get("link"),
                                  how=d.get("how") or "stated", said_by=sender, confidence=d.get("confidence"),
                                  reverses=d.get("reverses"), links=links)


def meeting_ref(s):
    anchor = s.get("anchor") or ""
    return anchor.split("#")[0] if anchor.startswith("meeting:") else f"meeting:{s['source_id'].split('#')[0]}"


def _meeting(core, s, key):
    m = s["meeting"]
    body = (m.get("summary") or "").strip()
    qs = [q for q in m.get("open_questions") or [] if q.strip()]
    if qs:
        body += "\n\n**Open questions**\n" + "\n".join(f"- {q.strip()}" for q in qs)
    links = []
    for p in m.get("attendees") or []:
        pid = _person(core, p)
        sight(core, pid, key, "on", s.get("ts"))
        links.append(("attendee", "entity", pid))
    kid, _ = knowledge.add_knowledge(core, "meeting", m.get("title") or (s.get("from") or {}).get("name"), body,
                                     source_ref=meeting_ref(s), link=s.get("link"), source_ts=s.get("ts"), links=links)
    return kid


# ---------------------------------------------------------------- the second pass

def lookups(core):
    """What Fuzz would like filled in: thin people and things, terms with no definition, threads that have
    settled, links not yet summarised, and the recent decisions a new one may reverse."""
    lim = dict(LOOKUP_LIMIT, **(_cfg(core).get("lookup_limits") or {}))
    me = _me(core)
    people = []
    for e in core.all("SELECT * FROM entities WHERE user_id=? AND type='person' AND redirect_to IS NULL ORDER BY id DESC",
                      (core.user_id,)):
        if len(people) >= lim["people"]:
            break
        n = core.one("SELECT COUNT(*) n FROM facts WHERE user_id=? AND entity_id=? AND status='live'", (core.user_id, e["id"]))["n"]
        if n > 1:
            continue
        ident = {r["type"]: r["value"] for r in core.all("SELECT type, value FROM identifiers WHERE entity_id=?", (e["id"],))}
        p = {"entity_id": e["id"], "name": entities.display_name(core.conn, e), "email": ident.get("email")}
        if entities._is_me({"name": p["name"], "email": p["email"]}, me):
            continue
        people.append(p)
    things = [{"entity_id": e["id"], "type": e["type"], "name": e["name"]} for e in core.all(
        "SELECT e.* FROM entities e WHERE e.user_id=? AND e.type IN ('org','tool') AND e.redirect_to IS NULL AND NOT EXISTS "
        "(SELECT 1 FROM facts f WHERE f.entity_id=e.id AND f.status='live') ORDER BY e.id DESC LIMIT ?", (core.user_id, lim["things"]))]
    terms = [{"entity_id": e["id"], "term": e["name"]} for e in core.all(
        "SELECT e.* FROM entities e WHERE e.user_id=? AND e.type='term' AND e.redirect_to IS NULL AND NOT EXISTS "
        "(SELECT 1 FROM facts f WHERE f.entity_id=e.id AND f.status='live' AND f.attr='definition' AND f.how!='inferred') "
        "ORDER BY e.id DESC LIMIT ?", (core.user_id, lim["terms"]))]
    return {"people": people, "things": things, "terms": terms, "threads": settled_threads(core, lim["threads"]),
            "links": unsummarised_links(core, lim["links"]), "decisions": [
                {"id": d["id"], "what": d["what"], "status": d["status"], "decided_at": d["decided_at"]}
                for d in core.all("SELECT * FROM decision_log WHERE user_id=? AND status IN ('recorded','proposed') "
                                  "ORDER BY id DESC LIMIT ?", (core.user_id, lim["decisions"]))],
            "known_terms": [r["name"] for r in core.all("SELECT name FROM entities WHERE user_id=? AND type IN ('term','tool') "
                                                        "AND redirect_to IS NULL AND name IS NOT NULL ORDER BY name", (core.user_id,))],
            "meetings": {"read_now": meetings_stale(core), "days": 2}}


def settled_threads(core, limit=5):
    """Email and Slack threads with at least 5 messages and none for 2 days, not digested since their last message."""
    days = float(_cfg(core).get("settle_days", SETTLE_DAYS))
    n = int(_cfg(core).get("settle_messages", SETTLE_MESSAGES))
    before = iso(core.now() - timedelta(days=days))
    out = []
    for r in core.all("SELECT anchor, COUNT(*) n, MAX(ts) last, MIN(link) link FROM signals WHERE user_id=? AND anchor IS NOT NULL "
                      "AND (anchor LIKE 'email:%' OR anchor LIKE 'slack:%') GROUP BY anchor HAVING n>=? AND last<? "
                      "ORDER BY last DESC", (core.user_id, n, before)):
        k = core.one("SELECT source_ts FROM knowledge WHERE user_id=? AND kind='thread' AND source_ref=? AND status='live'",
                     (core.user_id, r["anchor"]))
        if k and (k["source_ts"] or "") >= r["last"]:
            continue
        title = core.one("SELECT json_extract(payload,'$.title') t FROM signals WHERE user_id=? AND anchor=? AND "
                         "json_extract(payload,'$.title') IS NOT NULL LIMIT 1", (core.user_id, r["anchor"]))
        out.append({"source_ref": r["anchor"], "messages": r["n"], "last": r["last"], "link": r["link"],
                    "title": (title or {}).get("t")})
        if len(out) >= limit:
            break
    return out


def unsummarised_links(core, limit=5):
    seen, out = set(), []
    for r in core.all("SELECT payload, ts FROM signals WHERE user_id=? ORDER BY ts DESC LIMIT 400", (core.user_id,)):
        p = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"])
        for url in p.get("links") or []:
            ref = entities.normalize_url(url)
            if ref in seen:
                continue
            seen.add(ref)
            if core.one("SELECT 1 FROM knowledge WHERE user_id=? AND kind='reference' AND source_ref=?", (core.user_id, ref)):
                continue
            out.append({"source_ref": ref, "link": url})
            if len(out) >= limit:
                return out
    return out


def submit_facts(core, items):
    """Facts found in the second pass: the org directory (source_kind directory), a wiki page, a search."""
    counts = {"facts": 0, "skipped": 0}
    for f in items:
        def one(f=f):
            eid = facts.resolve_about(core, f.get("about") or {}, _me(core))
            if eid is None:
                raise FuzzError("Facts about the person themself aren't kept", "about")
            said = _person(core, f["said_by"]) if f.get("said_by") else None
            return facts.add(core, eid, f.get("attr"), f.get("value"), how=f.get("how") or "stated", said_by=said,
                             source_kind=f.get("source_kind") or "directory", source_ref=f.get("source_ref"),
                             link=f.get("link"), source_ts=f.get("source_ts") or core.now_iso())
        r = _try(core, counts, f, one)
        if r:
            counts["facts" if r[1] else "skipped"] += 1
    return counts


def submit_knowledge(core, items):
    """Thread digests, reference summaries and learnings, each with its link, and any decisions in them."""
    counts = {"knowledge": 0, "updated": 0, "decisions": 0}
    for k in items:
        def one(k=k):
            links = []
            for ref in k.get("about") or []:
                eid = facts.resolve_about(core, ref, _me(core))
                if eid:
                    links.append(("about", "entity", eid))
            ref = k.get("source_ref") or (entities.normalize_url(k["link"]) if k.get("link") and k.get("kind") == "reference" else None)
            kid, made = knowledge.add_knowledge(core, k.get("kind"), k.get("title"), k.get("summary_md"), source_ref=ref,
                                                link=k.get("link"), source_ts=k.get("source_ts"), links=links)
            for d in k.get("decisions") or []:
                by = _person(core, d["decided_by"]) if d.get("decided_by") else None
                said = _person(core, d["said_by"]) if d.get("said_by") else None
                _, dm = knowledge.add_decision(core, d.get("what"), why=d.get("why"), alternatives=d.get("alternatives"),
                                               decided_by=by, decided_at=d.get("decided_at") or k.get("source_ts"),
                                               source_ref=ref, link=k.get("link"), how=d.get("how") or "stated",
                                               said_by=said, confidence=d.get("confidence"), reverses=d.get("reverses"),
                                               links=[("from", "knowledge", kid)])
                counts["decisions"] += 1 if dm else 0
            return made
        r = _try(core, counts, k, one)
        if r is not None:
            counts["knowledge" if r else "updated"] += 1
    return counts


# ---------------------------------------------------------------- meetings, for briefs

def meetings(core):
    row = core.one("SELECT value FROM user_state WHERE user_id=? AND key='meetings'", (core.user_id,))
    v = (row or {}).get("value")
    return json.loads(v) if isinstance(v, str) and v.startswith("{") else None


def meetings_stale(core):
    """Read the calendar again: never read, older than 6 hours, or a meeting starts within 2 hours and the
    report is more than an hour old (a meeting moved since then would keep its old brief time)."""
    m = meetings(core)
    if m is None:
        return True
    at = parse_iso(m["at"])
    now = core.now()
    if at < now - timedelta(hours=6):
        return True
    soon = any(now <= parse_iso(x["start"]) <= now + timedelta(hours=2) for x in m.get("meetings") or [])
    return soon and at < now - timedelta(hours=1)


def report_meetings(core, items, actor=None):
    """The meetings in the next days, as read from the calendar with the AI's own connector:
    [{id, title, start, end, attendees: [{name, email}], series?}]. Replaces the last report."""
    if not isinstance(items, list):
        raise FuzzError("meetings is a list of {id, title, start, end, attendees}", "meetings")
    clean = []
    for i, m in enumerate(items):
        try:
            a, b = parse_iso(m.get("start")), parse_iso(m.get("end"))
        except (TypeError, ValueError, AttributeError):
            a = b = None
        if not m.get("id") or not a or not b or b < a:
            raise FuzzError(f"meetings[{i}] needs id, start and end (ISO times)", f"meetings[{i}]")
        people = [{k: p[k] for k in ("name", "email") if p.get(k)} for p in m.get("attendees") or [] if isinstance(p, dict)]
        clean.append({"id": str(m["id"])[:200], "title": (m.get("title") or "").strip()[:200] or "Meeting",
                      "start": iso(a), "end": iso(b), "attendees": people[:60],
                      "series": (m.get("series") or None) and str(m["series"])[:200], "link": m.get("link")})
    with core.tx(actor):
        ch = events.Changes()
        ch.state("meetings", json.dumps({"meetings": clean, "at": core.now_iso()}))
        events.emit(core, "calendar.reported", changes=ch, data={"meetings": len(clean)})
    return {"meetings": len(clean)}
