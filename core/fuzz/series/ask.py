"""Starting a series yourself, and the series cards (docs/series.md, "Starting one yourself", "Facts").

start(): New task's + → Series → Start a new series from this. Your note becomes the seed: Fuzz gathers the
tasks, people and anchors that go with it, and the series waits for your OK on a series_new card in Triage
(and in New on the Series page).

The cards:
  series_new     a series you started: Looks right · Adjust on its sheet · Not a series ▾
  series_role    the first time Fuzz names one to you: I'm driving it · I'm helping · Just keeping up · Not a series
  series_next    a suggested task (suggest.py): Add it · I'll do it · Not needed
  series_season  new work on a wrapped series: Start season 2 · Not part of it
"""

import json

from .. import cards, events, states
from ..db import FuzzError
from . import index as index_mod
from . import record

ROLE_FROM_OPTION = {"drive": "drive", "help": "contribute", "follow": "follow"}
GATHER_MAX = 12


def _words(text):
    from ..focus import _words as w
    return {index_mod.norm(x) for x in w(text)} - {""}


def gather(core, note, idx=None):
    """What goes with a note: {tasks, unsure, anchors, words}. Tasks share its distinctive words; anchors are
    what at least 2 of them carry; one task that only half fits is offered as unsure, with why."""
    idx = idx or index_mod.Index(core)
    words = _words(note)
    df = {}
    texts = {tid: f" {index_mod.norm(t['title'])} {index_mod.norm(t.get('ask') or '')} " for tid, t in idx.tasks.items()}
    for w in words:
        df[w] = sum(1 for x in texts.values() if f" {w} " in x)
    broad = max(idx.cfg["broad_floor"], idx.cfg["broad"] * len(idx.tasks))
    rare = sorted((w for w in words if 0 < df[w] <= broad), key=lambda w: df[w])
    hits = {}
    for tid, x in texts.items():
        shared = [w for w in rare if f" {w} " in x]
        if shared:
            hits[tid] = shared
    open_first = sorted(hits, key=lambda t: (-len(hits[t]), idx.tasks[t]["state"] not in states.LIVE, -t))
    need = max(1, (len(rare) + 1) // 2)   # at least half of the note's distinctive words
    sure = [t for t in open_first if len(hits[t]) >= need][:GATHER_MAX]
    loose = [t for t in open_first if t not in sure]
    counts = {}
    for t in sure:
        for k in idx.feats.get(t, {}):
            counts[k] = counts.get(k, 0) + 1
    anchors = {k: idx.labels.get(k, k) for k, c in counts.items() if c >= 2 and idx.weight(k) > 0
               and index_mod.kind_of(k) not in ("person", "dm")}
    # tasks that carry those anchors strongly, though they don't say the words
    line = idx.cfg["attach_score"]
    for tid in idx.tasks:
        if tid not in sure and len(sure) < GATHER_MAX and sum(idx.weight(k) for k in idx.feats.get(tid, {}) if k in anchors) >= line:
            sure.append(tid)
    unsure = None
    if loose:
        t = loose[0]
        unsure = {"id": t, "title": idx.tasks[t]["title"],
                  "why": f"It says “{hits[t][0]}”, but nothing else ties it to the rest."}
    else:   # a task that shares some of the anchors, not enough to count
        part = sorted(((sum(idx.weight(k) for k in idx.feats.get(t, {}) if k in anchors), t) for t in idx.tasks if t not in sure),
                      reverse=True)
        if part and part[0][0] >= line / 2:
            t = part[0][1]
            shared = [anchors[k] for k in idx.feats.get(t, {}) if k in anchors]
            unsure = {"id": t, "title": idx.tasks[t]["title"],
                      "why": f"It shares {shared[0]} with them, but not much else."}
    return {"tasks": sure, "unsure": unsure, "anchors": anchors, "words": rare[:3]}


def start(core, note, task_id=None, name=None):
    """You asked Fuzz to start a series from this note (and the task you were writing, if it was captured).
    Returns {series_id, card_id}."""
    note = (note or "").strip()
    if not note:
        raise FuzzError("Say what the series is about, like “The Northwind pilot”", "note")
    idx = index_mod.Index(core)
    g = gather(core, note, idx)
    tids = list(dict.fromkeys(([int(task_id)] if task_id else []) + g["tasks"]))
    for t in tids:
        if t not in idx.tasks:
            raise FuzzError(f"No task {t}", "task_id", 404)
    sname = (name or note.splitlines()[0])[:record.NAME_MAX]
    people = _people(core, tids)
    with core.tx("human"):
        ch = events.Changes()
        sid = record.make(core, ch, sname, state="inferred", origin="asked", why="You started it.",
                          task_ids=[t for t in tids if not idx.tasks[t].get("series_id")], seed=g["anchors"])
        for w in g["words"]:
            ch.anchor(core.new_id("series_anchors"), series_id=sid, key="word:" + w, label=f"the words “{w}”",
                      how="added", removed=0)
        events.emit(core, "series.asked", changes=ch, data={"series_id": sid, "note": note[:200], "tasks": tids},
                    log=None)
        cid = cards.create(core, "series_new", None, prompt=f"Is this the series “{sname}”?",
                           reason="You asked Fuzz to start it. Check what it gathered.",
                           payload={"series_id": sid, "name": sname, "tasks": tids, "unsure": g["unsure"],
                                    "anchors": [{"key": "word:" + w, "label": f"the words “{w}”"} for w in g["words"]]
                                    + [{"key": k, "label": v} for k, v in g["anchors"].items()],
                                    "people": people}, where="front")
    return {"series_id": sid, "card_id": cid}


def _people(core, tids):
    from .. import people as people_mod, tasks
    seen = {}
    for t in tids[:10]:
        row = tasks.get(core, t)
        for p in people_mod.for_task(core, row) if row else []:
            seen.setdefault(p["name"], p.get("email"))
    return [{"name": n, "email": e} for n, e in list(seen.items())[:6]]


def role_card(core, s, reason=None):
    """The first time Fuzz names a series to you: what's your part? Once, and not when you've said."""
    from ..memory import facts
    if s.get("entity_id") and facts.winners(core, s["entity_id"]).get("your_role"):
        return None
    if core.one("SELECT 1 x FROM cards WHERE user_id=? AND kind='series_role' AND json_extract(payload,'$.series_id')=?",
                (core.user_id, s["id"])):
        return None
    with core.tx("system"):
        ch = events.Changes()
        record.meet(core, ch, s)
        if not ch.empty():
            events.emit(core, "series.named", changes=ch, data={"series_id": s["id"], "met": True})
        return cards.create(core, "series_role", None, prompt=f"Fuzz noticed a series: {s['name']}. What’s your part?",
                            reason=reason or "Fuzz will suggest next steps that fit. Skip it and Fuzz takes it you’re helping.",
                            payload={"series_id": s["id"], "name": s["name"]})


# ---------------------------------------------------------------- answers

def answer(core, card, option, value=None):
    p = card.get("payload") or {}
    kind = card["kind"]
    s = record.require(core, p["series_id"])
    v = value if isinstance(value, dict) else {}
    if option == "not_series":
        why = "ongoing" if v.get("why") == "ongoing" else "not_series"
        return record.drop(core, s["id"], why=why, card=card, option=option, value=value)
    if kind == "series_new":
        if option != "looks_right":
            raise FuzzError(f"option {option} isn't an answer on this card", "option")
        return _looks_right(core, card, s, p, v)
    if kind == "series_role":
        from ..memory import facts
        role = ROLE_FROM_OPTION[option]
        with core.tx("human"):
            facts.edit(core, s["entity_id"], "your_role", role, card=card, option=option)
            ch = events.Changes()
            record.meet(core, ch, s)
            if not ch.empty():
                events.emit(core, "series.named", changes=ch, data={"series_id": s["id"], "met": True})
        return
    if kind == "series_next":
        return _next(core, card, s, p, option, v)
    if kind == "series_season":
        if option == "season2":
            return record.reopen(core, s["id"], p.get("tasks") or [], card=card)
        with core.tx("human"):   # not part of it: those tasks aren't put into it again
            ch = events.Changes()
            cards.mark_answered(core, ch, card, option)
            events.emit(core, "card.answered", changes=ch, data={"kind": kind, "option": option})
            for t in p.get("tasks") or []:
                core.q("INSERT INTO feedback (user_id, ts, kind, a, b, note) VALUES (?,?,?,?,?,?)",
                       (core.user_id, core.now_iso(), "series_left_out", t, s["id"], "season card"))
        return
    raise FuzzError(f"option {option} isn't an answer on this card", "option")


def _looks_right(core, card, s, p, v):
    """Your OK on a series you started: the tasks you kept (and the unsure one if you ticked it), the anchors you
    kept, your part, its done-when and its name."""
    from ..memory import facts
    offered = list(p.get("tasks") or []) + ([p["unsure"]["id"]] if p.get("unsure") else [])
    kept = v.get("tasks")
    kept = [int(t) for t in kept if int(t) in offered] if isinstance(kept, list) else list(p.get("tasks") or [])
    removed = [k for k in v.get("removed_anchors") or [] if isinstance(k, str)]
    role = v.get("role")
    if role is not None and role not in ROLE_FROM_OPTION and role not in record.ROLES:
        raise FuzzError("role is drive, help or follow", "value.role")
    done_when = (v.get("done_when") or "").strip()
    if done_when:
        from ..deliverables import check_done_when
        done_when = check_done_when(done_when)
    idx = index_mod.Index(core)
    rows = {a["key"]: a for a in idx.rows.get(s["id"], [])}

    def extra(ch):
        for t in offered:
            cur = idx.tasks.get(t, {}).get("series_id")
            if t in kept and cur in (None, s["id"]):
                ch.task(t, series_id=s["id"])
            elif t not in kept and cur == s["id"]:
                ch.task(t, series_id=None)
        for k in removed:
            if k in rows:
                ch.anchor(rows[k]["id"], removed=1)
            else:
                ch.anchor(core.new_id("series_anchors"), series_id=s["id"], key=k, label=idx.labels.get(k, k),
                          how="removed", removed=1)

    with core.tx("human"):
        record.name(core, s["id"], v.get("name") or None, card=card, option="looks_right", value=v, extra=extra)
        for t in offered:
            if t not in kept:
                core.q("INSERT INTO feedback (user_id, ts, kind, a, b, note) VALUES (?,?,?,?,?,?)",
                       (core.user_id, core.now_iso(), "series_unlinked", t, s["id"], "series_new card"))
        if role:
            facts.edit(core, s["entity_id"], "your_role", ROLE_FROM_OPTION.get(role, role))
        if done_when:
            facts.edit(core, s["entity_id"], "done_when", done_when)


def _next(core, card, s, p, option, v):
    """A suggestion: Add it (a task in Triage, already in the series), I'll do it (straight to My work), or
    Not needed (noted, never suggested again; kept as an outcome for evals)."""
    from .. import tasks
    title = (v.get("title") or p.get("title") or "").strip()
    with core.tx("human"):
        ch = events.Changes()
        cards.mark_answered(core, ch, card, option, v or None)
        events.emit(core, "card.answered", changes=ch, data={"kind": "series_next", "option": option,
                                                             "series_id": s["id"], "detector": p.get("detector")})
        core.q("INSERT INTO feedback (user_id, ts, kind, a, b, note) VALUES (?,?,?,?,?,?)",
               (core.user_id, core.now_iso(), "series_suggestion", s["id"], None,
                json.dumps({"key": p.get("key"), "detector": p.get("detector"), "outcome": option, "title": title})))
        if option in ("add", "mine"):
            if not title:
                raise FuzzError("value.title is the task to add", "value.title")
            tid = tasks.capture(core, title, actor="human")
            record.link(core, tid, s["id"])
            if option == "mine":
                tasks.deep_work(core, tid)
            return {"task_id": tid}
