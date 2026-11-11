"""Knowledge items (meeting notes, thread digests, reference summaries, learnings) and the decision log.

Both keep a summary and a link back, never a copy: the source system is the record. Each is linked to the
entities, tasks and groups it's about through memory_links (later: workstreams), in the same event that writes it.

A decision is recorded without asking only when it came from the decision-maker's own words, with high
confidence. Anything else is proposed and asked about ("Was this a decision?"): rule 4, an inferred decision
never records itself. A decision that reverses an earlier one links to it, and the earlier one becomes reversed
once the later one is recorded.
"""

from .. import cards, events
from ..db import FuzzError
from . import facts

KINDS = ("meeting", "thread", "reference", "learning")
AUTO_RECORD = 0.8
SUMMARY_MAX = 4000


def _links(core, ch, item_type, item_id, links):
    for ln in links or []:
        kind, ttype, tid = ln
        if tid is None:
            continue
        lid = core.new_id("memory_links")
        ch.mlink(lid, item_type=item_type, item_id=item_id, kind=kind, target_type=ttype, target_id=tid, removed=0)


def add_knowledge(core, kind, title, summary_md, source_ref=None, link=None, source_ts=None, how="extracted",
                  said_by=None, links=(), actor=None):
    """One knowledge item. The same kind and source again (a thread re-digested once it settled again) updates
    the summary in place. Returns (id, created)."""
    if kind not in KINDS:
        raise FuzzError(f"kind is one of {', '.join(KINDS)}", "kind")
    summary = (summary_md or "").strip()
    if not summary:
        raise FuzzError("summary_md is a short Markdown summary", "summary_md")
    if len(summary) > SUMMARY_MAX:
        raise FuzzError(f"summary_md is at most {SUMMARY_MAX} characters: a summary, not a copy", "summary_md")
    title = (title or "").strip()[:200] or None
    old = core.one("SELECT * FROM knowledge WHERE user_id=? AND kind=? AND source_ref=? AND status='live'",
                   (core.user_id, kind, source_ref)) if source_ref else None
    with core.tx(actor):
        ch = events.Changes()
        if old:
            if old["summary_md"] == summary and old["title"] == title:
                return old["id"], False
            ch.knowledge(old["id"], summary_md=summary, title=title, source_ts=source_ts or old["source_ts"])
            have = {(r["kind"], r["target_type"], r["target_id"]) for r in core.all(
                "SELECT * FROM memory_links WHERE item_type='knowledge' AND item_id=? AND removed=0", (old["id"],))}
            _links(core, ch, "knowledge", old["id"], [ln for ln in links or [] if tuple(ln) not in have])
            events.emit(core, "knowledge.added", changes=ch, data={"knowledge_id": old["id"], "kind": kind, "updated": True})
            return old["id"], False
        kid = core.new_id("knowledge")
        auth = "owner" if said_by is None and kind == "learning" else "other"
        ch.knowledge(kid, kind=kind, title=title, summary_md=summary, source_ref=source_ref, link=link,
                     source_ts=source_ts, captured_at=core.now_iso(), how=how, authority=auth, status="live")
        _links(core, ch, "knowledge", kid, links)
        events.emit(core, "knowledge.added", changes=ch, data={"knowledge_id": kid, "kind": kind})
    return kid, True


def reject_knowledge(core, kid, actor="human"):
    with core.tx(actor):
        ch = events.Changes()
        ch.knowledge(kid, status="rejected")
        events.emit(core, "knowledge.rejected", changes=ch, data={"knowledge_id": kid})


# ---------------------------------------------------------------- decisions

def add_decision(core, what, why=None, alternatives=None, decided_by=None, decided_at=None, source_ref=None,
                 link=None, how="extracted", said_by=None, confidence=None, reverses=None, links=(), actor=None):
    """A detected decision. Recorded at once only from the decision-maker's own words with high confidence;
    otherwise proposed, for a "Was this a decision?" card. Returns (id, created)."""
    what = (what or "").strip()
    if not what:
        raise FuzzError("what is the decision, in a sentence", "what")
    if how not in facts.HOW:
        raise FuzzError(f"how is one of {', '.join(facts.HOW)}", "how")
    for d in core.all("SELECT * FROM decision_log WHERE user_id=? AND status NOT IN ('undone') AND source_ref IS ?",
                      (core.user_id, source_ref)):
        if facts.norm(d["what"]) == facts.norm(what):
            return d["id"], False
    if reverses is not None and core.one("SELECT 1 FROM decision_log WHERE id=? AND user_id=?", (reverses, core.user_id)) is None:
        raise FuzzError(f"No decision {reverses} to reverse: use an id from get_lookups' decisions", "reverses")
    owner = bool(decided_by and said_by and facts.follow(core, decided_by) == facts.follow(core, said_by))
    authority = "owner" if owner else "other"
    conf = float(confidence) if confidence is not None else None
    auto = how != "inferred" and owner and (conf or 0) >= AUTO_RECORD
    with core.tx(actor):
        did = core.new_id("decision_log")
        ch = events.Changes()
        ch.decision(did, what=what[:300], why=(why or None), alternatives=list(alternatives or []), decided_by=decided_by,
                    decided_at=decided_at, source_ref=source_ref, link=link, how=how, authority=authority,
                    confidence=conf, status="recorded" if auto else "proposed", reverses=reverses,
                    captured_at=core.now_iso(), confirmed_at=None)
        if auto and reverses:
            ch.decision(reverses, status="reversed")
        links = list(links or []) + ([("decided_by", "entity", decided_by)] if decided_by else [])
        _links(core, ch, "decision", did, links)
        events.emit(core, "decision.recorded" if auto else "decision.detected", changes=ch,
                    data={"decision_id": did, "reverses": reverses, "auto": auto})
    return did, True


def get_decision(core, did):
    d = core.one("SELECT * FROM decision_log WHERE id=? AND user_id=?", (did, core.user_id))
    if d is None:
        raise FuzzError(f"No decision {did}", "decision_id", 404)
    return d


def record_decision(core, did, card=None, edits=None, actor="human"):
    """You said it was a decision (with any edits): recorded and confirmed; the one it reverses is reversed."""
    d = get_decision(core, did)
    with core.tx(actor):
        ch = events.Changes()
        fields = {"status": "recorded", "confirmed_at": core.now_iso()}
        for k in ("what", "why"):
            if edits and isinstance(edits.get(k), str) and edits[k].strip():
                fields[k] = edits[k].strip()
        ch.decision(d["id"], **fields)
        if d.get("reverses"):
            ch.decision(d["reverses"], status="reversed")
        if card:
            cards.mark_answered(core, ch, card, "record", edits)
        events.emit(core, "decision.recorded", changes=ch, data={"decision_id": d["id"], "reverses": d.get("reverses")})


def reject_decision(core, did, card=None, actor="human"):
    d = get_decision(core, did)
    with core.tx(actor):
        ch = events.Changes()
        ch.decision(d["id"], status="rejected")
        if card:
            cards.mark_answered(core, ch, card, "not_decision")
        events.emit(core, "decision.rejected", changes=ch, data={"decision_id": d["id"]})


def links_of(core, item_type, item_id):
    return core.all("SELECT * FROM memory_links WHERE user_id=? AND item_type=? AND item_id=? AND removed=0",
                    (core.user_id, item_type, item_id))


def reversed_by(core, did):
    return core.all("SELECT * FROM decision_log WHERE user_id=? AND reverses=? AND status NOT IN ('undone','rejected')",
                    (core.user_id, did))


def for_entity(core, eid):
    """Knowledge and decisions linked to the entity (and anything merged into it)."""
    ids = facts.closure(core, eid)
    marks = ",".join("?" * len(ids))
    rows = core.all(f"SELECT item_type, item_id, kind FROM memory_links WHERE user_id=? AND target_type='entity' "
                    f"AND removed=0 AND target_id IN ({marks})", (core.user_id, *ids))
    kn = [core.one("SELECT * FROM knowledge WHERE id=?", (r["item_id"],)) for r in rows if r["item_type"] == "knowledge"]
    ds = [core.one("SELECT * FROM decision_log WHERE id=?", (r["item_id"],)) for r in rows if r["item_type"] == "decision"]
    kn = [k for k in {k["id"]: k for k in kn if k and k["status"] == "live"}.values()]
    ds = [d for d in {d["id"]: d for d in ds if d and d["status"] not in ("undone", "rejected")}.values()]
    return sorted(kn, key=lambda k: k["source_ts"] or k["captured_at"], reverse=True), \
        sorted(ds, key=lambda d: d["decided_at"] or d["captured_at"], reverse=True)
