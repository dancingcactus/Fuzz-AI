"""Series detection, as things come in (docs/series.md, "Detection, as things come in").

Runs after matching in submit_signals. Cheap stages first, a judgment only when unsure:

1. Attach (no AI). A task in no series joins the one whose anchors it clearly matches. A second series
   close behind is "also touches" (worked out when read), never a question. A task that matches a wrapped
   series asks "Start season 2?" instead.
2. Forming series that now pass the rules become series, no AI: the judge already named them.
3. Seed (no AI). Anchors (topics, tickets, terms, channels, meetings; never documents) on enough free tasks
   propose candidates; heavily overlapping ones merge. One that passes the rules becomes a judge item, shown
   with the series and forming series nearest to it, and any area it sits in. Areas' anchors never seed,
   but a cluster inside an area that has grown (area_regrow) goes back to the judge.
4. A forming series that hasn't grown for forming_stall_days goes back to the judge: merge, wait or drop.

Judge items wait in series_items and reach the extractor through get_pending_judgments, next to the
matcher's; its verdicts come back through submit_verdicts (apply_verdict). It may only use the ids and
task numbers an item gave it; anything else is refused with the field to fix.
"""

import json
from datetime import timedelta

from .. import events
from ..db import FuzzError, iso
from . import index as index_mod
from . import record

CANDIDATE_ACTIONS = ("new", "join", "split", "area", "wait")
STALL_ACTIONS = ("merge", "wait", "drop")


def _pending(core):
    return core.all("SELECT * FROM series_items WHERE user_id=? AND status='pending' ORDER BY id", (core.user_id,))


def _claimed(core):
    out = set()
    for it in _pending(core):
        item = json.loads(it["item"])
        out |= {t["id"] for t in item.get("tasks") or []}
    return out


def _waits(core):
    out = {}
    for r in core.all("SELECT keys, size FROM series_waits WHERE user_id=?", (core.user_id,)):
        out[r["keys"]] = r["size"]
    return out


def run(core, actor="fuzz:extractor", as_of=None):
    """One detection run. Returns counts: attached, promoted, items, season cards."""
    out = {"attached": 0, "promoted": 0, "items": 0, "season": 0}
    if not (core.config.get("series") or {}).get("detect", True):
        return out
    idx = index_mod.Index(core, as_of)
    cfg = idx.cfg
    claimed = _claimed(core)
    said_no = record.unlinked_pairs(core)

    # 1. attach
    attachable = [s for s, r in idx.series.items() if r["kind"] == "series"
                  and r["state"] in ("forming", "inferred", "named", "dormant", "wrapped")]
    for tid, t in sorted(idx.tasks.items()):
        if t.get("series_id") or tid in claimed or not idx.feats.get(tid):
            continue
        sc = [(v, s) for v, s in idx.scores(tid, attachable) if (tid, s) not in said_no and v >= cfg["attach_score"]]
        if not sc:
            continue
        sid = sc[0][1]
        if idx.series[sid]["state"] == "wrapped":
            if _season_card(core, idx.series[sid], tid, actor):
                out["season"] += 1
            continue
        record.link(core, tid, sid, actor="system", quiet=True, why="anchors")
        idx.tasks[tid] = dict(t, series_id=sid)
        idx.members.setdefault(sid, set()).add(tid)
        out["attached"] += 1

    # 2. forming series that pass the rules
    for sid, s in idx.series.items():
        if s["kind"] == "series" and s["state"] == "forming" and not idx.rules(idx.members.get(sid, ())):
            with core.tx(actor):
                ch = events.Changes()
                ch.series(sid, state="inferred")
                events.emit(core, "series.inferred", changes=ch, data={"series_id": sid, "from": "forming",
                                                                      "tasks": len(idx.members.get(sid, ()))})
            s["state"] = "inferred"
            out["promoted"] += 1

    # 3. seed
    waits = _waits(core)
    free = {t for t, r in idx.tasks.items() if not r.get("series_id") and t not in claimed}
    removed = {a["key"] for rows in idx.rows.values() for a in rows if a["removed"]}
    seeds = []
    for k, ts in idx.index.items():
        if index_mod.kind_of(k) in cfg["seed_kinds"] and k not in idx.area_keys and k not in removed and idx.weight(k) > 0:
            f = ts & free
            if len(f) >= cfg["seed_min"]:
                seeds.append(({k}, set(f)))
    seeds = _merge_seeds(seeds, cfg)
    taken = set()
    for keys, ts in seeds:
        ts = ts - taken
        if idx.rules(ts) or _waited(waits, keys, len(ts), cfg["regrow"]):
            continue
        taken |= ts
        _add_item(core, "candidate", _candidate_item(idx, ts, keys))
        out["items"] += 1
    # an area's second look: its cluster has grown since it was ruled
    for sid, s in idx.series.items():
        if s["kind"] != "area":
            continue
        akeys = set(idx.anchors(sid))
        ts = {t for t in free - taken if akeys & set(idx.feats.get(t, {}))}
        need = max(cfg["seed_min"], int((s.get("ruled_size") or 0) * cfg["area_regrow"]))
        if len(ts) < need or idx.rules(ts) or _waited(waits, f"area:{sid}", len(ts), cfg["regrow"]):
            continue
        taken |= ts
        record.remember_wait(core, f"area:{sid}", len(ts))
        _add_item(core, "candidate", _candidate_item(idx, ts, akeys & {k for t in ts for k in idx.feats.get(t, {})}, area=sid))
        out["items"] += 1

    # 4. forming series that stalled
    stalled = iso(core.now() - timedelta(days=cfg["forming_stall_days"]))
    asked = {json.loads(i["item"]).get("series", {}).get("id") for i in _pending(core) if i["kind"] == "stall"}
    for sid, s in idx.series.items():
        if s["kind"] == "series" and s["state"] == "forming" and (s.get("grown_at") or "") < stalled and sid not in asked:
            _add_item(core, "stall", _stall_item(idx, sid))
            out["items"] += 1
    record.sync_identifiers(core)
    return out


def _merge_seeds(seeds, cfg):
    merged = True
    while merged:
        merged = False
        seeds.sort(key=lambda s: (-len(s[1]), sorted(s[0])))
        for i in range(len(seeds)):
            for j in range(i + 1, len(seeds)):
                a, b = seeds[i][1], seeds[j][1]
                inter = len(a & b)
                if inter and (inter / len(a | b) >= cfg["merge_jaccard"] or inter / min(len(a), len(b)) >= cfg["merge_inside"]):
                    seeds[i] = (seeds[i][0] | seeds[j][0], a | b)
                    del seeds[j]
                    merged = True
                    break
            if merged:
                break
    return seeds


def _waited(waits, keys, size, regrow):
    """The judge said wait (or split, or left part of it) on a cluster sharing these keys, and it hasn't grown enough."""
    if isinstance(keys, str):
        return keys in waits and size < waits[keys] + regrow
    for k, n in waits.items():
        if k.startswith("area:"):
            continue
        if set(json.loads(k)) & keys and size < n + regrow:
            return True
    return False


def _task_line(idx, tid):
    t = idx.tasks[tid]
    return {"id": tid, "title": (t["title"] or "")[:120], "state": t["state"]}


def _series_line(idx, sid):
    s = idx.series[sid]
    ms = sorted(idx.members.get(sid, ()))
    return {"id": sid, "name": s["name"], "state": s["state"], "tasks": len(ms),
            "examples": [(idx.tasks[t]["title"] or "")[:80] for t in ms[:3]]}


def _nearby(idx, ts, exclude=()):
    """Series and forming series closest to these tasks: join targets, so pieces can merge back."""
    cand = [s for s, r in idx.series.items() if r["kind"] == "series" and r["state"] in ("forming", "inferred", "named", "dormant")
            and s not in exclude]
    near = sorted(((sum(idx.score(t, s) for t in ts), s) for s in cand), reverse=True)
    return [s for v, s in near[:4] if v > 0]


def _candidate_item(idx, ts, keys, area=None):
    ts = sorted(ts)
    areas = [area] if area else [s for s, r in idx.series.items() if r["kind"] == "area"
                                 and set(idx.anchors(s)) & {k for t in ts for k in idx.feats.get(t, {})}]
    inside = [{"id": s, "name": idx.series[s]["name"], "why": idx.series[s].get("why")} for s in areas[:2]]
    yours = []
    for s, r in idx.series.items():   # you started or kept a series where an area covers its anchors: you won
        if r["kind"] == "series" and idx.yours(s) and set(idx.anchors(s)) & idx.area_keys:
            yours.append(r["name"])
    return {"tasks": [_task_line(idx, t) for t in ts],
            "anchors": [idx.labels.get(k, k) for k in sorted(keys)][:8], "keys": sorted(keys),
            "nearby": [_series_line(idx, s) for s in _nearby(idx, ts)],
            "inside_area": inside, "your_series_inside_areas": yours[:5]}


def _stall_item(idx, sid):
    ms = sorted(idx.members.get(sid, ()))
    return {"series": dict(_series_line(idx, sid), needs=idx.rules(ms)),
            "tasks": [_task_line(idx, t) for t in ms],
            "nearby": [_series_line(idx, s) for s in _nearby(idx, ms, exclude=(sid,))]}


def _add_item(core, kind, item):
    core.q("INSERT INTO series_items (user_id, kind, item, status, created_at) VALUES (?,?,?,?,?)",
           (core.user_id, kind, json.dumps(item), "pending", core.now_iso()))


def _season_card(core, s, tid, actor):
    """New work on a wrapped series: "Start season 2?". One card per series, collecting the tasks."""
    from .. import cards
    for c in core.all("SELECT * FROM cards WHERE user_id=? AND status='open' AND kind='series_season'", (core.user_id,)):
        p = c.get("payload") or {}
        if p.get("series_id") == s["id"]:
            if tid in (p.get("tasks") or []):
                return False
            with core.tx(actor):
                ch = events.Changes()
                ch.card(c["id"], payload=dict(p, tasks=(p.get("tasks") or []) + [tid]))
                events.emit(core, "card.updated", changes=ch, data={"kind": "series_season", "added": tid})
            return False
    asked = {t for c in core.all("SELECT payload FROM cards WHERE user_id=? AND kind='series_season'", (core.user_id,))
             for t in ((c.get("payload") or {}).get("tasks") or [])}
    if tid in asked:   # you already answered for this task
        return False
    with core.tx(actor):
        cards.create(core, "series_season", None, prompt=f"New work came in for {s['name']}, which is wrapped. Start season 2?",
                     payload={"series_id": s["id"], "tasks": [tid], "name": s["name"]})
    return True


# ---------------------------------------------------------------- the judge's side

def pending_items(core):
    """What get_pending_judgments shows the extractor for series, with the actions each item allows."""
    out = []
    for it in _pending(core):
        item = json.loads(it["item"])
        base = {"series_item": it["id"], "kind": "series_" + it["kind"],
                "actions": list(CANDIDATE_ACTIONS if it["kind"] == "candidate" else STALL_ACTIONS)}
        item = {k: v for k, v in item.items() if k != "keys"}
        out.append(dict(base, **item))
    return out


def pending_count(core):
    return core.one("SELECT COUNT(*) n FROM series_items WHERE user_id=? AND status='pending'", (core.user_id,))["n"]


def _ids(nums, field):
    out = []
    for i, x in enumerate(nums or []):
        s = str(x).lstrip("#")
        if not s.isdigit():
            raise FuzzError(f"{field}[{i}] is a task number from the item", f"{field}[{i}]")
        out.append(int(s))
    return out


def check(core, i, v):
    """Refuse a verdict that uses an id or task number its item didn't give. Raises FuzzError with the field."""
    f = f"verdicts[{i}]"
    row = core.one("SELECT * FROM series_items WHERE id=? AND user_id=?", (v["series_item"], core.user_id))
    if row is None:
        raise FuzzError(f"{f}.series_item {v['series_item']} isn't a pending series item", f"{f}.series_item")
    if row["status"] != "pending":
        return row, None
    item = json.loads(row["item"])
    act = v.get("action")
    allowed = CANDIDATE_ACTIONS if row["kind"] == "candidate" else STALL_ACTIONS
    if act not in allowed:
        raise FuzzError(f"{f}.action is one of {', '.join(allowed)} for this item", f"{f}.action")
    near = {s["id"] for s in item.get("nearby") or []}
    tids = {t["id"] for t in item.get("tasks") or []}
    if act in ("join", "merge"):
        if v.get("series_id") not in near:
            raise FuzzError(f"{f}.series_id is one of the item's nearby ids: {sorted(near) or 'none'}", f"{f}.series_id")
    if act == "new" and not (v.get("name") or "").strip():
        raise FuzzError(f"{f}.name is the series' name in 2-5 plain words", f"{f}.name")
    if act == "split":
        parts = v.get("parts") or []
        if not parts:
            raise FuzzError(f"{f}.parts lists each part's name, bounded and tasks", f"{f}.parts")
        for j, p in enumerate(parts):
            pf = f"{f}.parts[{j}]"
            if not (p.get("name") or "").strip():
                raise FuzzError(f"{pf}.name is the part's name", f"{pf}.name")
            nums = _ids(p.get("tasks"), f"{pf}.tasks")
            bad = [n for n in nums if n not in tids]
            if bad:
                raise FuzzError(f"{pf}.tasks has task numbers the item didn't give: {bad}", f"{pf}.tasks")
    return row, item


def apply_verdict(core, row, item, v, as_of=None):
    """Turn one series verdict into series, areas, forming pieces or a wait. Inside submit_verdicts' transaction."""
    if item is None:
        return "skipped"
    idx = index_mod.Index(core, as_of)
    act = v["action"]
    why = (v.get("why") or "")[:300] or None
    keys = item.get("keys") or []
    labels = {k: idx.labels.get(k, k) for k in keys}
    tids = [t["id"] for t in item.get("tasks") or []]
    free = [t for t in tids if t in idx.tasks and not idx.tasks[t].get("series_id")]
    outcome = act
    if row["kind"] == "candidate":
        if act == "new" and v.get("bounded", True) is False:
            act = "area"
        if act == "new":
            state = "forming" if idx.rules(free) else "inferred"
            with core.tx():
                ch = events.Changes()
                sid = record.make(core, ch, v["name"], state=state, why=why, task_ids=free, seed=labels)
                events.emit(core, "series.inferred" if state == "inferred" else "series.formed", changes=ch,
                            data={"series_id": sid, "tasks": free, "item": row["id"]})
            outcome = "new" if state == "inferred" else "forming"
        elif act == "join":
            sid = v["series_id"]
            target = idx.series.get(sid)
            if target is None:
                outcome = "skipped"
            else:
                with core.tx():
                    ch = events.Changes()
                    for t in free:
                        ch.task(t, series_id=sid)
                    ch.series(sid, grown_at=core.now_iso())
                    members = list(idx.members.get(sid, set()) | set(free))
                    if target["state"] == "forming" and not idx.rules(members):
                        ch.series(sid, state="inferred")
                    events.emit(core, "series.linked", changes=ch, data={"series_id": sid, "tasks": free, "item": row["id"]})
        elif act == "area":
            with core.tx():
                ch = events.Changes()
                sid = record.make(core, ch, v.get("name") or (list(labels.values()) or ["An area"])[0], kind="area", state="area",
                                  why=why, seed=labels, ruled_size=len(tids))
                events.emit(core, "series.area_marked", changes=ch, data={"series_id": sid, "item": row["id"]})
        elif act == "split":
            left = set(free)
            made = []
            with core.tx():
                ch = events.Changes()
                for p in v.get("parts") or []:
                    pts = [t for t in _ids(p.get("tasks"), "parts") if t in left]
                    if not pts:
                        continue
                    left -= set(pts)
                    pkeys = {k: lab for k, lab in labels.items() if sum(1 for t in pts if k in idx.feats.get(t, {})) >= 2}
                    if p.get("bounded", True) is False:
                        sid = record.make(core, ch, p["name"], kind="area", state="area", why=why, seed=pkeys or labels,
                                          ruled_size=len(pts))
                        made.append({"series_id": sid, "area": True})
                    else:
                        state = "forming" if idx.rules(pts) else "inferred"
                        sid = record.make(core, ch, p["name"], state=state, why=why, task_ids=pts, seed=pkeys)
                        made.append({"series_id": sid, "state": state, "tasks": pts})
                events.emit(core, "series.split", changes=ch, data={"item": row["id"], "parts": made})
            for t in left:   # the judge left these out: attach doesn't put them into its parts anyway
                for m in made:
                    core.q("INSERT INTO feedback (user_id, ts, kind, a, b, note) VALUES (?,?,?,?,?,?)",
                           (core.user_id, core.now_iso(), "series_left_out", t, m["series_id"], f"item {row['id']}"))
            record.remember_wait(core, keys, len(tids))
        else:   # wait
            record.remember_wait(core, keys, len(tids))
    else:   # a forming series that stalled
        sid = item["series"]["id"]
        s = idx.series.get(sid)
        if s is None or s["state"] != "forming":
            outcome = "skipped"
        elif act == "merge":
            record.merge(core, sid, v["series_id"], actor=core._actor, why=why)
        elif act == "drop":
            ms = sorted(idx.members.get(sid, ()))
            with core.tx():
                ch = events.Changes()
                for t in ms:
                    ch.task(t, series_id=None)
                ch.series(sid, state="dropped")
                events.emit(core, "series.dropped", changes=ch, data={"series_id": sid, "tasks": ms, "by": "judge"})
            akeys = list(idx.anchors(sid))
            if akeys:
                record.remember_wait(core, akeys, len(ms))
        else:   # wait: asked again after another quiet stretch
            with core.tx():
                ch = events.Changes()
                ch.series(sid, grown_at=core.now_iso())
                events.emit(core, "series.reviewed", changes=ch, data={"series_id": sid, "wait": True})
    core.q("UPDATE series_items SET status='decided', verdict=?, decided_at=? WHERE id=?",
           (json.dumps(v), core.now_iso(), row["id"]))
    return outcome
