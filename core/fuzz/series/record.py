"""The series record: a projected `series` row for its lifecycle, an entity for its aliases and facts, and
its anchors (docs/series.md, "The record").

Lifecycle: forming -> inferred -> named (you accepted or renamed it) -> dormant / wrapped / dropped.
An area is a row with kind 'area': it keeps its anchors and the judge's reason, takes no tasks, and never
appears in the app.

Every change is an event, so Undo and replay work. Membership (tasks.series_id, the primary series) is
sticky: only you, the judge's first verdict, or attach (for a task in no series) set it.
"""

import json
from datetime import timedelta

from .. import cards, events, states
from ..db import FuzzError, iso, parse_iso
from . import index as index_mod

NAME_MAX = 80
ROLES = ("drive", "contribute", "follow")


def get(core, sid):
    return core.one("SELECT * FROM series WHERE id=? AND user_id=?", (int(sid), core.user_id))


def require(core, sid, kind="series"):
    s = get(core, sid)
    if s is None or (kind and s["kind"] != kind):
        raise FuzzError(f"No series {sid}", "series_id", 404)
    return s


def live(core, kind="series"):
    return core.all("SELECT * FROM series WHERE user_id=? AND kind=? AND state NOT IN ('dropped') ORDER BY id",
                    (core.user_id, kind))


def _clean_name(name):
    n = " ".join((name or "").split())[:NAME_MAX]
    if not n:
        raise FuzzError("name is what you'd call it, in a few plain words, like “Northwind pilot”", "name")
    return n


def _entity(core, kind, name):
    from ..matching import entities
    return entities._new_entity(core, kind, name, False)


def make(core, ch, name, kind="series", state="inferred", origin="inferred", why=None, task_ids=(), seed=None,
         ruled_size=None):
    """Write a new series (or area) into ch, with its entity and seed anchors. Inside a transaction.
    seed: {key: label}. Tasks only join a series, never an area. Returns its id."""
    name = _clean_name(name)
    sid = core.new_id("series")
    now = core.now_iso()
    eid = _entity(core, kind, name)
    ch.series(sid, kind=kind, name=name, state=state, origin=origin, entity_id=eid, muted=0,
              met=1 if origin == "asked" else 0, named_at=None, why=(why or None) and why[:300],
              ruled_size=ruled_size, season=1, evidence=None, check_due=0, grown_at=now, created_at=now)
    for key, label in (seed or {}).items():
        ch.anchor(core.new_id("series_anchors"), series_id=sid, key=key, label=label, how="seed", removed=0)
    if kind == "series":
        for tid in task_ids:
            ch.task(int(tid), series_id=sid)
    return sid


def link(core, task_id, sid, actor="human", quiet=False, why=None):
    """The task's primary series is now this one: its "Part of …" line. Undo puts it back."""
    from .. import tasks
    t = tasks.require(core, task_id)
    s = require(core, sid)
    if s["state"] == "dropped":
        raise FuzzError(f"“{s['name']}” isn't a series any more", "series_id", 409)
    with core.tx(actor):
        ch = events.Changes()
        ch.task(t["id"], series_id=s["id"])
        ch.series(s["id"], grown_at=core.now_iso())
        if s["state"] == "dormant":
            ch.series(s["id"], state="named" if s.get("named_at") else "inferred")
        events.emit(core, "series.linked", task_id=t["id"], changes=ch,
                    data={"series_id": s["id"], "quiet": quiet, "from": t.get("series_id"), **({"why": why} if why else {})},
                    log=None if quiet else ("status", f"Part of {s['name']}."))
    return s["id"]


def unlink(core, task_id, actor="human"):
    """Out of its series. Fuzz won't put it back in that one by itself."""
    from .. import tasks
    t = tasks.require(core, task_id)
    if not t.get("series_id"):
        raise FuzzError("This task isn't part of a series", "task_id", 409)
    s = get(core, t["series_id"])
    with core.tx(actor):
        ch = events.Changes()
        ch.task(t["id"], series_id=None)
        events.emit(core, "series.unlinked", task_id=t["id"], changes=ch, data={"series_id": t["series_id"]},
                    log=("status", f"You took this out of {s['name'] if s else 'its series'}."))
        core.q("INSERT INTO feedback (user_id, ts, kind, a, b, note) VALUES (?,?,?,?,?,?)",
               (core.user_id, core.now_iso(), "series_unlinked", t["id"], t["series_id"], None))


def unlinked_pairs(core):
    """(task, series) pairs you took apart: attach never puts them back together."""
    return {(r["a"], r["b"]) for r in core.all("SELECT a, b FROM feedback WHERE user_id=? AND kind IN "
                                                 "('series_unlinked', 'series_left_out')", (core.user_id,))}


def name(core, sid, new_name=None, actor="human", card=None, option=None, value=None, extra=None):
    """You accepted it (Keep it, Looks right) or renamed it: named, and met. extra(ch) adds to the same event."""
    s = require(core, sid)
    n = _clean_name(new_name) if new_name else s["name"]
    with core.tx(actor):
        ch = events.Changes()
        state = s["state"] if s["state"] in ("wrapped",) else "named"
        ch.series(s["id"], name=n, state=state, met=1, named_at=core.now_iso())
        if card:
            cards.mark_answered(core, ch, card, option, value)
        if extra:
            extra(ch)
        if n != s["name"] and s.get("entity_id"):
            core.q("UPDATE entities SET name=? WHERE id=? AND user_id=?", (n, s["entity_id"], core.user_id))
            core.q("INSERT OR IGNORE INTO aliases VALUES (?,?)", (s["entity_id"], n.lower()))
        events.emit(core, "series.named", changes=ch, data={"series_id": s["id"], "from": s["name"], "to": n})
    return s["id"]


def meet(core, ch, s):
    """It's in front of you now (a card about it): no longer only "Fuzz is watching"."""
    if not s.get("met"):
        ch.series(s["id"], met=1)


def drop(core, sid, why="not_series", actor="human", card=None, option="not_series", value=None):
    """Not a series. why: not_series (its tasks go free, and its cluster isn't proposed again until it grows)
    or ongoing (it's an area: kept, never shown, and its anchors stop proposing series)."""
    s = require(core, sid)
    idx = index_mod.get(core)
    members = sorted(idx.members.get(s["id"], ()))
    anchors = idx.anchors(s["id"])
    with core.tx(actor):
        ch = events.Changes()
        for tid in members:
            ch.task(tid, series_id=None)
        if card:
            cards.mark_answered(core, ch, card, option, value)
        _withdraw_cards(core, ch, s["id"], keep=card["id"] if card else None)
        if why == "ongoing":
            ch.series(s["id"], kind="area", state="area", ruled_size=len(members), why="You said it's ongoing.")
            have = {a["key"] for a in idx.rows.get(s["id"], [])}
            for k, label in anchors.items():
                if k not in have:
                    ch.anchor(core.new_id("series_anchors"), series_id=s["id"], key=k, label=label, how="seed", removed=0)
            events.emit(core, "series.area_marked", changes=ch, data={"series_id": s["id"], "by": "you", "tasks": members})
        else:
            ch.series(s["id"], state="dropped")
            events.emit(core, "series.dropped", changes=ch, data={"series_id": s["id"], "tasks": members})
        if anchors and members:
            remember_wait(core, list(anchors), len(members))
        sync_identifiers(core)


def remember_wait(core, keys, size):
    core.q("INSERT OR REPLACE INTO series_waits (user_id, keys, size, ts) VALUES (?,?,?,?)",
           (core.user_id, json.dumps(sorted(keys)) if isinstance(keys, list) else keys, size, core.now_iso()))


def _withdraw_cards(core, ch, sid, keep=None):
    for c in core.all("SELECT * FROM cards WHERE user_id=? AND status='open' AND kind LIKE 'series%'", (core.user_id,)):
        if (c.get("payload") or {}).get("series_id") == sid and c["id"] != keep:
            ch.card(c["id"], status="withdrawn")


def mute(core, sid, on=True, actor="human"):
    s = require(core, sid)
    with core.tx(actor):
        ch = events.Changes()
        ch.series(s["id"], muted=1 if on else 0)
        if on:
            for c in core.all("SELECT * FROM cards WHERE user_id=? AND status='open' AND kind='series_next'", (core.user_id,)):
                if (c.get("payload") or {}).get("series_id") == s["id"]:
                    ch.card(c["id"], status="withdrawn")
        events.emit(core, "series.muted", changes=ch, data={"series_id": s["id"], "muted": bool(on)})


def set_role(core, sid, role, actor="human"):
    """Your part in it: a fact you stated (your_role)."""
    from ..memory import facts
    s = require(core, sid)
    if role not in ROLES:
        raise FuzzError(f"role is one of {', '.join(ROLES)}", "role")
    return facts.edit(core, s["entity_id"], "your_role", role, actor=actor)


# ---------------------------------------------------------------- anchors: how Fuzz spots it

def anchor_key(text):
    """What you typed into "How Fuzz spots it": a ticket key, a #channel, or words."""
    from ..matching import entities
    t = (text or "").strip()
    if not t:
        raise FuzzError("Say a word, a ticket key or a Slack channel", "add")
    keys = entities.tickets_in(t.upper())
    if keys and keys[0] == t.upper():
        return ("ticket_key:" + keys[0], f"ticket {keys[0]}")
    if "@" in t and " " not in t:   # an email list
        return ("list:" + t.lower(), f"email list {t.lower()}")
    w = index_mod.norm(t.lstrip("#"))
    if not w:
        raise FuzzError("Say a word, a ticket key or a Slack channel", "add")
    return ("word:" + w, f"the words “{t}”")


def _resolve_key(core, key, label):
    """A ticket key you typed becomes the ticket entity's anchor when Fuzz knows that ticket; else words."""
    if key.startswith("ticket_key:"):
        k = key.split(":", 1)[1]
        e = core.one("SELECT id FROM entities WHERE user_id=? AND type='ticket' AND upper(name)=?", (core.user_id, k))
        return (f"ticket:{e['id']}", label) if e else ("word:" + index_mod.norm(k), label)
    return key, label


def _index_words(idx, keyed):
    """Words nobody has used yet as an anchor: index them now, so a preview can say what they'd catch."""
    for k, label in keyed:
        if k.startswith("word:") and k not in idx.index:
            w = f" {k[5:]} "
            for tid, t in idx.tasks.items():
                if w in f" {index_mod.norm(t['title'])} {index_mod.norm(t.get('ask') or '')} ":
                    idx.feats.setdefault(tid, {})[k] = label
                    idx.index.setdefault(k, set()).add(tid)


def preview_anchors(core, sid, add=(), remove=(), exclude=()):
    """What a change to its anchors would have caught: tasks that would join (free ones scoring past the
    attach line) and members that would no longer score; for an exclusion, the free tasks it would keep out and
    the members that already say it (they stay: an exclusion only stops new work). Read-only."""
    s = require(core, sid)
    idx = index_mod.get(core)
    adds = [_resolve_key(core, *anchor_key(a)) for a in add or []]
    outs = [_resolve_key(core, *anchor_key(a)) for a in exclude or []]
    _index_words(idx, adds + outs)
    cur = idx.anchors(s["id"])
    new = dict(cur)
    for k in remove or []:
        new.pop(k, None)
    for k, label in adds:
        new[k] = label
    added_keys = {k for k, _ in adds} | idx.added(s["id"])
    line = idx.cfg["attach_score"]

    def sc(tid, anchors):
        return sum(idx.weight(k, added=k in added_keys) for k in idx.feats.get(tid, {}) if k in anchors)

    join = [t for t, r in idx.tasks.items() if not r.get("series_id") and sc(t, new) >= line > sc(t, cur)]
    lose = [t for t in idx.members.get(s["id"], ()) if sc(t, new) < line <= sc(t, cur)]
    out_keys = {k for k, _ in outs}
    says = lambda t: bool(out_keys & set(idx.feats.get(t, {})))
    keep_out = [t for t, r in idx.tasks.items() if not r.get("series_id") and says(t) and sc(t, cur) >= line]
    already = [t for t in idx.members.get(s["id"], ()) if says(t)]
    line_of = lambda ts: [{"id": t, "title": idx.tasks[t]["title"]} for t in sorted(ts)][:20]
    return {"would_join": line_of(join), "would_stop_matching": line_of(lose),
            "would_keep_out": line_of(keep_out), "already_in": line_of(already),
            "anchors": [{"key": k, "label": v} for k, v in new.items()]}


def edit_anchors(core, sid, add=(), remove=(), actor="human", restore=(), exclude=(), unexclude=()):
    """Add anchors you typed and remove ones Fuzz found (Undo puts them back; so does restore, by key). A
    removed anchor isn't suggested again. exclude (typed, like add) keeps new work that says it out of the
    series; unexclude (by key) takes that back. One event, so one Undo. Returns the added keys."""
    s = require(core, sid)
    idx = index_mod.get(core)
    rows = {a["key"]: a for a in idx.rows.get(s["id"], [])}
    adds = [_resolve_key(core, *anchor_key(a)) for a in add or []]
    outs = [_resolve_key(core, *anchor_key(a)) for a in exclude or []]
    if not adds and not remove and not restore and not outs and not unexclude:
        raise FuzzError("Add or remove at least one", "add")
    with core.tx(actor):
        ch = events.Changes()
        for k, label in outs:   # an exclusion replaces whatever the key was: it can't bring work in and keep it out
            if k in rows:
                ch.anchor(rows[k]["id"], how="exclude", removed=0, label=label)
            else:
                ch.anchor(core.new_id("series_anchors"), series_id=s["id"], key=k, label=label, how="exclude", removed=0)
        for k in unexclude or []:
            if k in rows and rows[k]["how"] == "exclude":
                ch.anchor(rows[k]["id"], how="unexcluded", removed=1)
        for k in restore or []:
            if k in rows and rows[k]["removed"]:
                ch.anchor(rows[k]["id"], removed=0, how="added" if rows[k]["how"] == "added" else "seed")
        for k in remove or []:
            if k in rows:
                ch.anchor(rows[k]["id"], removed=1, how="removed" if rows[k]["how"] != "added" else "added")
            else:
                ch.anchor(core.new_id("series_anchors"), series_id=s["id"], key=k, label=idx.labels.get(k, k),
                          how="removed", removed=1)
        for k, label in adds:
            if k in rows:
                ch.anchor(rows[k]["id"], removed=0, how="added", label=label)
            else:
                ch.anchor(core.new_id("series_anchors"), series_id=s["id"], key=k, label=label, how="added", removed=0)
        events.emit(core, "series.anchors", changes=ch,
                    data={"series_id": s["id"], "added": [k for k, _ in adds], "removed": list(remove or []),
                          "excluded": [k for k, _ in outs], "unexcluded": list(unexclude or [])})
        sync_identifiers(core)
    return [k for k, _ in adds]


def sync_identifiers(core):
    """A series' anchors are its entity's identifiers (type anchor, value "<key>#s<series>"; one anchor can belong
    to several series, so the value names it). Derived: rewritten from the anchors as they stand after any change
    to them and after each detection run, so they always say what the index says."""
    idx = index_mod.Index(core)
    core.q("DELETE FROM identifiers WHERE user_id=? AND type='anchor'", (core.user_id,))
    for sid, s in idx.series.items():
        if not s.get("entity_id"):
            continue
        for k in idx.anchors(sid):
            core.q("INSERT OR REPLACE INTO identifiers (user_id, type, value, entity_id) VALUES (?,?,?,?)",
                   (core.user_id, "anchor", f"{k}#s{sid}", s["entity_id"]))


def series_for_anchor(core, key):
    """The series an anchor belongs to, by their entities' identifiers."""
    return [int(r["value"].rsplit("#s", 1)[1]) for r in core.all(
        "SELECT value FROM identifiers WHERE user_id=? AND type='anchor' AND value LIKE ?", (core.user_id, f"{key}#s%"))]


# ---------------------------------------------------------------- wrapping, seasons, merging, going quiet

def wrap(core, sid, evidence, actor="human", card=None, option=None):
    s = require(core, sid)
    if s["state"] == "wrapped":
        raise FuzzError(f"“{s['name']}” is already wrapped", "series_id", 409)
    with core.tx(actor):
        ch = events.Changes()
        ch.series(s["id"], state="wrapped", evidence=(evidence or "")[:300] or None, check_due=0)
        if card:
            cards.mark_answered(core, ch, card, option)
        _withdraw_cards(core, ch, s["id"], keep=card["id"] if card else None)
        events.emit(core, "series.wrapped", changes=ch, data={"series_id": s["id"], "evidence": evidence, "name": s["name"]})


def reopen(core, sid, task_ids=(), actor="human", card=None, option="season2"):
    """Start season 2: it's going again, with the new work in it."""
    s = require(core, sid)
    with core.tx(actor):
        ch = events.Changes()
        ch.series(s["id"], state="named" if s.get("named_at") else "inferred", evidence=None, season=(s.get("season") or 1) + 1,
                  grown_at=core.now_iso())
        for tid in task_ids:
            ch.task(int(tid), series_id=s["id"])
        if card:
            cards.mark_answered(core, ch, card, option)
        events.emit(core, "series.reopened", changes=ch, data={"series_id": s["id"], "season": (s.get("season") or 1) + 1,
                                                               "tasks": list(task_ids)})


def merge(core, from_sid, into_sid, actor="system", why=None):
    """Two pieces of one body of work: from's tasks move into into, and from is dropped."""
    a, b = require(core, from_sid), require(core, into_sid)
    idx = index_mod.get(core)
    with core.tx(actor):
        ch = events.Changes()
        for tid in sorted(idx.members.get(a["id"], ())):
            ch.task(tid, series_id=b["id"])
        ch.series(a["id"], state="dropped")
        ch.series(b["id"], grown_at=core.now_iso())
        _withdraw_cards(core, ch, a["id"])
        events.emit(core, "series.merged", changes=ch, data={"from": a["id"], "into": b["id"], "why": why})
        sync_identifiers(core)


def split(core, sid, parts, actor="human"):
    """You split it: each part ({name, task_ids}) becomes its own series, named and met, with your part in the
    original copied over. A short name (three words or fewer) is also a way to spot it, so new work that says it
    lands there. Tasks you put in no part stay in the original; if none stay, the original goes. One Undo.
    Returns the new series' ids."""
    from ..memory import facts
    s = require(core, sid)
    if s["state"] == "dropped":
        raise FuzzError(f"“{s['name']}” isn't a series any more", "series_id", 409)
    if not isinstance(parts, list) or not parts:
        raise FuzzError("parts lists each part's name and the tasks that go in it", "parts")
    idx = index_mod.get(core)
    members = set(idx.members.get(s["id"], ()))
    seen, clean = set(), []
    for j, p in enumerate(parts):
        if not isinstance(p, dict):
            raise FuzzError("each part is {name, task_ids}", f"parts[{j}]")
        nm = _clean_name(p.get("name"))
        tids = p.get("task_ids") or []
        if not isinstance(tids, list) or not all(isinstance(t, int) for t in tids):
            raise FuzzError("task_ids is a list of task ids", f"parts[{j}].task_ids")
        bad = [t for t in tids if t not in members]
        if bad:
            raise FuzzError(f"Tasks {bad} aren't part of “{s['name']}”", f"parts[{j}].task_ids")
        if seen & set(tids):
            raise FuzzError("A task can go in only one part", f"parts[{j}].task_ids")
        seen |= set(tids)
        clean.append((nm, tids))
    if len(clean) < 2 and not (members - seen):
        raise FuzzError("Split it into at least two parts, or leave some tasks where they are", "parts")
    role = (facts.winners(core, s["entity_id"]).get("your_role") if s.get("entity_id") else None)
    now = core.now_iso()
    made = []
    with core.tx(actor):
        ch = events.Changes()
        for nm, tids in clean:
            words = len(nm.split()) <= 3 and index_mod.norm(nm)
            nid = make(core, ch, nm, state="named", origin="split", why=f"You split it out of {s['name']}.", task_ids=tids)
            ch.series(nid, met=1, named_at=now)
            if words:
                ch.anchor(core.new_id("series_anchors"), series_id=nid, key="word:" + words, label=f"the words “{nm}”",
                          how="added", removed=0)
            made.append({"series_id": nid, "name": nm, "tasks": tids})
        rest = sorted(members - seen)
        if not rest:
            ch.series(s["id"], state="dropped")
            _withdraw_cards(core, ch, s["id"])
        else:
            ch.series(s["id"], grown_at=now)
        events.emit(core, "series.split", changes=ch,
                    data={"from": s["id"], "parts": made, "kept": rest, "dropped": not rest})
        if role in ROLES:
            for m in made:
                eid = core.one("SELECT entity_id FROM series WHERE id=?", (m["series_id"],))["entity_id"]
                facts.edit(core, eid, "your_role", role, actor=actor)
        sync_identifiers(core)
    return [m["series_id"] for m in made]


def check_dormant(core):
    """Gone quiet: a series none of whose tasks moved for dormant_days. Returns how many went quiet."""
    idx = index_mod.get(core)
    days = idx.cfg["dormant_days"]
    cutoff = iso(core.now() - timedelta(days=days))
    n = 0
    for sid, s in list(idx.series.items()):
        if s["kind"] != "series" or s["state"] not in ("inferred", "named"):
            continue
        last = idx.last_moved(sid) or s.get("created_at") or ""
        if last and last < cutoff and (s.get("grown_at") or "") < cutoff:
            with core.tx("system"):
                ch = events.Changes()
                ch.series(sid, state="dormant")
                events.emit(core, "series.dormant", changes=ch, data={"series_id": sid, "last": last})
            n += 1
    return n


def wake_if_moved(core):
    """A dormant series whose task moved again goes back to going."""
    idx = index_mod.get(core)
    cutoff = iso(core.now() - timedelta(days=idx.cfg["dormant_days"]))
    n = 0
    for sid, s in list(idx.series.items()):
        if s["kind"] == "series" and s["state"] == "dormant" and (idx.last_moved(sid) or "") >= cutoff:
            with core.tx("system"):
                ch = events.Changes()
                ch.series(sid, state="named" if s.get("named_at") else "inferred")
                events.emit(core, "series.woke", changes=ch, data={"series_id": sid})
            n += 1
    return n


# ---------------------------------------------------------------- done-when: Fuzz checks it

def mark_check(core, ch, task):
    """A task of this series just closed: Fuzz checks its done-when on its next run."""
    if task.get("series_id"):
        ch.series(task["series_id"], check_due=1)


def to_check(core):
    """whoami's series_to_check: series with a done-when whose task closed, or that you asked Fuzz to check."""
    from ..memory import facts
    out = []
    for s in core.all("SELECT * FROM series WHERE user_id=? AND kind='series' AND check_due=1 AND state IN "
                      "('inferred','named','dormant')", (core.user_id,)):
        dw = facts.winners(core, s["entity_id"]).get("done_when") if s.get("entity_id") else None
        if dw:
            out.append({"id": s["id"], "name": s["name"], "done_when": dw})
    return out


def report_done(core, sid, evidence=None, cant_check=None, actor="fuzz:executor"):
    """The executor checked a series' done-when. True: wrapped with the evidence (Undo). Couldn't reach it:
    not checked again until another task closes. Not true yet: don't call."""
    s = require(core, sid)
    if cant_check:
        with core.tx(actor):
            ch = events.Changes()
            ch.series(s["id"], check_due=0)
            events.emit(core, "series.reviewed", changes=ch, data={"series_id": s["id"], "cant_check": cant_check[:200]})
        return {"state": s["state"], "checked": False}
    if not (evidence or "").strip():
        raise FuzzError("evidence says what you saw, like “NW-342 is accepted and Northwind confirmed in writing”", "evidence")
    if s["state"] not in ("inferred", "named", "dormant"):
        raise FuzzError(f"“{s['name']}” is {s['state']}: nothing to check", "series_id", 409)
    wrap(core, s["id"], evidence.strip(), actor=actor)
    return {"state": "wrapped"}


def recent(core, ts, days):
    d = parse_iso(ts) if ts else None
    return bool(d) and d >= core.now() - timedelta(days=days)


LIVE = index_mod.LIVE_SERIES
STATES_LIVE = states.LIVE
