"""What the Series page and the series sheet show (docs/series.md, "Surfaces").

Sections: New (one you started, waiting for your OK) · Going · Gone quiet · Fuzz is watching (inferred, not
met yet: Keep it / Not a series) · Wrapped. Forming series and areas never show.
"""

from .. import states
from . import index as index_mod
from . import record, suggest

SECTIONS = ("new", "going", "quiet", "watching", "wrapped")
TRUST_LABEL = {"confirmed": "Confirmed", "authoritative": "From the owner", "reported": "Reported",
               "inferred": "Fuzz noticed", "stale": "Out of date"}
ROLE_LABEL = {"drive": "You’re driving it", "contribute": "You’re helping", "follow": "You’re keeping up"}
SOURCE_LABEL = {"email": "email", "slack": "Slack", "meeting": "a meeting", "calendar": "the calendar", "doc": "a doc",
                "directory": "the directory", "you": "you", "teams": "Teams"}


def section(s):
    if s["kind"] != "series" or s["state"] in ("dropped", "forming"):
        return None
    if s["state"] == "wrapped":
        return "wrapped"
    if s["state"] == "dormant":
        return "quiet"
    if s["origin"] == "asked" and not s.get("named_at"):
        return "new"
    if s["state"] == "inferred" and not s.get("met"):
        return "watching"
    return "going"


def _facts(core, s):
    from ..memory import facts
    return facts.for_entity(core, s["entity_id"]) if s.get("entity_id") else []


def _fact_view(core, f):
    who = None
    if f.get("said_by"):
        from ..memory import facts as fmod
        e = fmod.entity(core, f["said_by"])
        if e:
            from ..matching import entities
            who = entities.display_name(core.conn, e)
    src = "you" if f["how"] == "edited" else (f"{who} on {SOURCE_LABEL.get(f.get('source_kind'), 'a message')}" if who
                                              else SOURCE_LABEL.get(f.get("source_kind"), "a message"))
    return {"fact_id": f["id"], "attr": f["attr"], "value": f["value"], "trust": f["trust"]["level"],
            "trust_label": TRUST_LABEL.get(f["trust"]["level"], f["trust"]["level"]), "source": src, "link": f.get("link"),
            "as_of": f.get("source_ts") or f.get("captured_at")}


def _winners(core, s):
    out = {}
    for f in _facts(core, s):
        if f["state"] == "winner" and f["attr"] not in out:
            out[f["attr"]] = f
    ms = out.get("next_milestone")
    if ms:   # holds until its date: a milestone that has passed isn't shown
        d = suggest.milestone_date(core, ms["value"])
        if d and d < core.now():
            out.pop("next_milestone")
    return out


def _people(core, tids, limit=6):
    from .. import people as people_mod, tasks
    seen = {}
    for t in tids[:12]:
        row = tasks.get(core, t)
        for p in people_mod.for_task(core, row) if row else []:
            seen[p["name"]] = seen.get(p["name"], 0) + 1
    return [n for n, _ in sorted(seen.items(), key=lambda x: -x[1])][:limit]


def _about(s, w, idx, members, open_, people):
    """The one line under its name that says what it is. The goal when Fuzz has one (a guess until you say so),
    else a line from its own tasks, which is always a guess: (text, how, guess, fact_id)."""
    g = w.get("goal")
    if g:
        sure = g["how"] == "edited" or g.get("confirmed_at") or (g.get("trust") or {}).get("level") == "confirmed"
        return g["value"], "goal", not sure, None if sure else g["id"]
    if not members:
        return "Nothing in it yet. Add a task, or tell Fuzz what it’s about.", "tasks", True, None
    pick = sorted(open_ or members, key=lambda t: idx.tasks[t].get("created_at") or "", reverse=True)[0]
    n = len(members)
    who = f" with {people[0]}" + (f" and {people[1]}" if len(people) > 1 else "") if people else ""
    return f"From {n} {'task' if n == 1 else 'tasks'}{who}, like “{idx.tasks[pick]['title']}”.", "tasks", True, None


def _last(idx, members):
    """What moved last: the member task that changed most recently."""
    if not members:
        return None
    t = max(members, key=lambda t: idx.tasks[t].get("state_changed_at") or idx.tasks[t].get("created_at") or "")
    r = idx.tasks[t]
    return {"id": t, "title": r["title"], "state": r["state"], "at": r.get("state_changed_at") or r.get("created_at")}


def summary(core, s, idx=None):
    """One card on the Series page."""
    idx = idx or index_mod.get(core)
    w = _winners(core, s)
    members = sorted(idx.members.get(s["id"], ()))
    open_ = [t for t in members if idx.tasks[t]["state"] in states.LIVE]
    role = (w.get("your_role") or {}).get("value")
    st = w.get("status")
    people = _people(core, open_ or members, 4)
    about, about_how, about_guess, about_fact = _about(s, w, idx, members, open_, people)
    return {"id": s["id"], "name": s["name"], "state": s["state"], "origin": s["origin"], "section": section(s),
            "muted": bool(s["muted"]), "season": s.get("season") or 1, "role": role, "role_label": ROLE_LABEL.get(role),
            "about": about, "about_how": about_how, "about_guess": about_guess, "about_fact_id": about_fact,
            "status": _fact_view(core, st) if st else None,
            "done_when": (w.get("done_when") or {}).get("value"),
            "next_milestone": (w.get("next_milestone") or {}).get("value"),
            "next": suggest.next_for(core, s["id"]),
            "open": len(open_), "done": len([t for t in members if idx.tasks[t]["state"] == "done"]),
            "people": people, "evidence": s.get("evidence"), "last": _last(idx, members),
            "last_moved": idx.last_moved(s["id"]) or None, "focus_task_ids": open_}


def _people_detail(core, members, owner=None, limit=60):
    """Everyone in its tasks, the ones in the most first: {name, tasks, how}. how says how they're in it: the owner,
    someone you're waiting on, who sent its asks."""
    from .. import people as people_mod, tasks
    book = {}
    for t in members[-limit:]:
        row = tasks.get(core, t)
        if not row:
            continue
        live = row["state"] in states.LIVE
        for p in people_mod.for_task(core, row):
            b = book.setdefault(p["name"], {"name": p["name"], "tasks": 0, "sent": 0, "waiting": 0})
            b["tasks"] += 1
            kinds = {c.get("kind") for c in p.get("contributions") or []}
            b["sent"] += "sent" in kinds
            b["waiting"] += "waiting" in kinds and live
    out = []
    for b in sorted(book.values(), key=lambda b: (-b["tasks"], b["name"].lower())):
        how = []
        if owner and owner.strip().lower() == b["name"].lower():
            how.append("Owner")
        if b["waiting"]:
            how.append("You’re waiting on them")
        if b["sent"]:
            how.append("Sent one of its asks" if b["sent"] == 1 else f"Sent {b['sent']} of its asks")
        out.append({"name": b["name"], "tasks": b["tasks"], "how": " · ".join(how)})
    return out


def page(core):
    """GET /series: the page's sections, each a list of cards."""
    idx = index_mod.get(core)
    out = {k: [] for k in SECTIONS}
    for s in idx.series.values():
        sec = section(s)
        if sec:
            out[sec].append(summary(core, s, idx))
    for k in out:
        out[k].sort(key=lambda x: (x["last_moved"] or "") if k != "new" else str(x["id"]), reverse=True)
    return {"sections": out, "counts": {k: len(v) for k, v in out.items()}}


def sheet(core, sid):
    """GET /series/<id>: Next in …, What Fuzz knows, Open work, Deliverables, Decided, People, How Fuzz spots it,
    and Also touches this."""
    from .. import tasks
    s = record.require(core, sid)
    idx = index_mod.get(core)
    out = summary(core, s, idx)
    members = sorted(idx.members.get(s["id"], ()), key=lambda t: idx.tasks[t].get("created_at") or "", reverse=True)
    out["knows"] = [_fact_view(core, f) for f in _facts(core, s) if f["state"] == "winner"
                    and not (f["attr"] == "next_milestone" and out["next_milestone"] is None)]
    if out["knows"]:
        from ..memory import facts
        facts.record_views(core, [f["fact_id"] for f in out["knows"]], "sheet")
    out["entity_id"] = s.get("entity_id")
    line = lambda t: {"id": t, "title": idx.tasks[t]["title"], "state": idx.tasks[t]["state"],
                      "summary": idx.tasks[t].get("summary")}
    out["open_tasks"] = [line(t) for t in members if idx.tasks[t]["state"] in states.LIVE]
    out["done_tasks"] = [line(t) for t in members if idx.tasks[t]["state"] in ("done", "letgo")][:20]
    dids = sorted({idx.tasks[t]["deliverable_id"] for t in members if idx.tasks[t].get("deliverable_id")})
    out["deliverables"] = [{"id": d["id"], "title": d["title"], "state": d["state"], "tier": d["tier"], "done_when": d["done_when"],
                            "due": d.get("due")} for d in (core.one("SELECT * FROM deliverables WHERE id=?", (x,)) for x in dids) if d]
    keys = [r["signal_key"] for r in core.all(
        f"SELECT DISTINCT signal_key FROM sources WHERE user_id=? AND signal_key IS NOT NULL AND task_id IN ({','.join('?' * len(members))})",
        (core.user_id, *members))] if members else []
    decided = core.all(f"SELECT * FROM decision_log WHERE user_id=? AND status='recorded' AND source_ref IN ({','.join('?' * len(keys))}) "
                       "ORDER BY COALESCE(decided_at, captured_at) DESC LIMIT 10", (core.user_id, *keys)) if keys else []
    out["decided"] = [{"id": d["id"], "what": d["what"], "why": d.get("why"), "at": d.get("decided_at") or d["captured_at"],
                       "link": d.get("link")} for d in decided]
    owner = next((f["value"] for f in out["knows"] if f["attr"] == "owner"), None)
    out["people"] = _people_detail(core, sorted(members), owner)
    from .. import outputs
    out["artifacts"] = outputs.for_tasks(core, members)
    removed = {a["key"]: a for a in idx.rows.get(s["id"], []) if a["removed"] and a["how"] not in ("exclude", "unexcluded")}
    anchors = idx.anchors(s["id"])
    mine = idx.added(s["id"])
    out["anchors"] = [{"key": k, "label": v, "yours": k in mine, "tasks": len(set(idx.index.get(k, ())) & set(members))}
                      for k, v in sorted(anchors.items(), key=lambda kv: (kv[0] not in mine, -len(idx.index.get(kv[0], ()))))]
    out["removed_anchors"] = [{"key": k, "label": a["label"] or idx.labels.get(k, k)} for k, a in removed.items()]
    # Keeps work out: new work that says one doesn't join; "tasks" is how many already in it say it (they stay)
    out["excluded_anchors"] = [{"key": k, "label": v, "tasks": len(set(idx.index.get(k, ())) & set(members))}
                               for k, v in idx.excluded(s["id"]).items()]
    touching = idx.touching(s["id"])
    out["also_touches"] = [{"id": t, "title": idx.tasks[t]["title"], "series_id": idx.tasks[t].get("series_id"),
                            "series": (idx.series.get(idx.tasks[t].get("series_id")) or {}).get("name")}
                           for t in touching if idx.tasks[t]["state"] in states.LIVE][:10]
    out["why"] = s.get("why")
    out["suggestions"] = [{"card_id": c["id"], "title": (c.get("payload") or {}).get("title"), "why": c.get("reason")}
                          for c in core.all("SELECT * FROM cards WHERE user_id=? AND kind='series_next' AND status='open' ORDER BY id",
                                            (core.user_id,)) if (c.get("payload") or {}).get("series_id") == s["id"]]
    out["can_know"] = ["goal", "your_role", "owner", "for", "status", "blocked_on", "next_milestone", "cadence", "scope_out",
                       "done_when"]
    return out


def focus_ids(core, s):
    """What Work on … puts in Focus: its open tasks, and the open ones filed elsewhere that also touch it."""
    idx = index_mod.get(core)
    ids = [t for t in sorted(idx.members.get(s["id"], ())) if idx.tasks[t]["state"] in states.LIVE]
    return ids + [t for t in idx.touching(s["id"]) if idx.tasks[t]["state"] in states.LIVE and t not in ids]


def task_line(core, t):
    """A task's "Part of …" line, and the other series it also touches."""
    idx = index_mod.get(core)
    out = {}
    s = idx.series.get(t.get("series_id")) if t.get("series_id") else None
    if s and s["kind"] == "series":
        out["series"] = {"id": s["id"], "name": s["name"], "state": s["state"]}
    touches = [idx.series[x] for x in idx.also_touches(t["id"]) if x in idx.series]
    if touches:
        out["also_touches"] = [{"id": x["id"], "name": x["name"]} for x in touches if section(x)]
    return out


def choices(core, task_id):
    """"Part of…" in task detail: series, likeliest first (its anchor score), then the rest by name."""
    idx = index_mod.get(core)
    live = [s for s, r in idx.series.items() if section(r) in ("new", "going", "quiet", "watching")]
    sc = dict((s, v) for v, s in idx.scores(task_id, live))
    live.sort(key=lambda s: (-sc.get(s, 0), idx.series[s]["name"].lower()))
    return [{"series_id": s, "name": idx.series[s]["name"], "score": round(sc.get(s, 0), 2)} for s in live]
