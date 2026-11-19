"""While you were away: what Fuzz did on its own since you were last here, for the Guide.

Not a full accounting. It's there so you can see Fuzz working behind the scenes, mostly on the tasks that
never reach your screen because Fuzz closed them or moved them to waiting. The window goes back to the
last thing you did, and never less than two hours.
"""

import json
from datetime import timedelta

from .db import iso, parse_iso

MIN_HOURS = 2
# What each kind of event counts as, most reassuring first. One task shows as its first kind only.
KINDS = [
    ("closed", ("task.done",)),
    ("wrapped", ()),   # a series Fuzz saw was finished: this, series and split come from series events (see _series)
    ("sent", ("task.sent",)),
    ("drafted", ("task.draft_ready",)),
    ("waiting", ("task.waiting",)),
    ("merged", ("task.merged",)),
    ("let_go", ("task.let_go",)),
    ("new", ("task.extracted",)),
    ("series", ()),    # a series Fuzz started
    ("split", ()),     # work Fuzz saw was more than one series, so it started one for each part
    ("reopened", ("task.reopened", "task.came_back")),
    ("updated", ("task.reply_in",)),
]
ORDER = [k for k, _ in KINDS]
KIND_OF = {t: k for k, types in KINDS for t in types}
# Fuzz's own roles. A Claude session you opened is you working, so it doesn't count.
FUZZ = ("fuzz:extractor", "fuzz:executor", "fuzz:sender", "system")
CLOSED = ("done", "dropped", "letgo", "resolved")
MAX_ITEMS = 100   # the expand lists every task; this only guards a very long time away
# Series Fuzz started (made visible at once, or promoted from forming: forming ones aren't on your screen yet),
# split into parts, or found finished (its done-when checked and true).
SERIES_EVENTS = ("series.inferred", "series.split", "series.wrapped")
LIVE_SERIES = ("inferred", "named", "dormant", "wrapped")


def window(core):
    """(since, last_here): back to the last thing you did, and at least MIN_HOURS."""
    now = core.now()
    r = core.one("SELECT max(ts) AS ts FROM events WHERE user_id=? AND actor='human' AND ts<=?",
                 (core.user_id, iso(now)))
    last = parse_iso(r["ts"]) if r and r["ts"] else None
    floor = now - timedelta(hours=MIN_HOURS)
    return (min(floor, last) if last else floor), last


def summary(core):
    since, last = window(core)
    now = core.now_iso()
    rows = core.all(
        "SELECT e.id, e.ts, e.actor, e.type, e.task_id, e.payload, t.title, t.state FROM events e "
        "JOIN tasks t ON t.id=e.task_id AND t.user_id=e.user_id "
        f"WHERE e.user_id=? AND e.ts>=? AND e.ts<=? AND e.actor IN ({','.join('?' * len(FUZZ))}) "
        f"AND e.type IN ({','.join('?' * len(KIND_OF))}) ORDER BY e.id DESC",
        (core.user_id, iso(since), now, *FUZZ, *KIND_OF))
    counts, best = {}, {}
    for r in rows:
        kind = KIND_OF[r["type"]]
        p = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"] or "{}")
        if kind == "updated" and not p.get("changes"):
            continue   # a reply Fuzz read but that changed nothing
        if kind == "reopened" and r["type"] == "task.came_back" and r["actor"] != "fuzz:extractor":
            continue   # a scheduled check-back, not something Fuzz noticed
        if kind in ("closed", "let_go") and r["state"] not in CLOSED:
            continue   # you've since opened it again
        seen = counts.setdefault(kind, set())
        if kind != "merged" and r["task_id"] in seen:
            continue
        seen.add(r["task_id"] if kind != "merged" else r["id"])
        text = ((p.get("log") or {}).get("text") or "").strip()
        cur = best.get(r["task_id"])
        if cur is None or ORDER.index(kind) < ORDER.index(cur["kind"]):
            best[r["task_id"]] = {"kind": kind, "task_id": r["task_id"], "title": r["title"], "text": text, "at": r["ts"]}
    for i in _series(core, since, now):
        key = i.pop("key")
        counts.setdefault(i["kind"], set()).add(key)
        best[key] = i
    # most reassuring first, newest first within a kind
    by_kind = {}
    for i in sorted(best.values(), key=lambda i: i["at"], reverse=True):
        by_kind.setdefault(i["kind"], []).append(i)
    items = [i for k in ORDER for i in by_kind.get(k, [])][:MAX_ITEMS]
    return {
        "since": iso(since),
        "last_here": iso(last) if last else None,
        "counts": {k: len(counts[k]) for k in ORDER if counts.get(k)},
        "items": items,
    }


def _series(core, since, now):
    """What Fuzz did to series in the window, newest first. Each series shows once, finished before started;
    a split is one line naming its parts, so its parts don't show again as new. Each item has a key for counting."""
    rows = core.all(
        f"SELECT id, ts, type, payload FROM events WHERE user_id=? AND ts>=? AND ts<=? AND actor IN ({','.join('?' * len(FUZZ))}) "
        f"AND type IN ({','.join('?' * len(SERIES_EVENTS))}) ORDER BY id DESC",
        (core.user_id, iso(since), now, *FUZZ, *SERIES_EVENTS))
    cache = {}

    def get(sid):
        if sid not in cache:
            s = core.one("SELECT id, name, kind, state, origin FROM series WHERE id=? AND user_id=?", (sid, core.user_id))
            if s:
                s["n"] = core.one("SELECT count(*) AS n FROM tasks WHERE series_id=? AND user_id=?", (sid, core.user_id))["n"]
            cache[sid] = s
        return cache[sid]

    def shown(sid):   # still on your Series page: not an area, not forming, not dropped or merged away
        s = get(sid) if sid else None
        return s if s and s["kind"] == "series" and s["state"] in LIVE_SERIES else None

    def item(kind, key, s, title, text, at):
        return {"kind": kind, "key": key, "series_id": s["id"], "task_id": None, "title": title, "text": text, "at": at}

    splits, finished, started, in_split = [], {}, {}, set()
    for r in rows:
        p = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"] or "{}")
        d = p.get("data") or {}
        if r["type"] == "series.split":
            parts = [s for s in (shown(m.get("series_id")) for m in d.get("parts") or [] if not m.get("area")) if s]
            src = get(d["from"]) if d.get("from") else None
            if len(parts) == 1 and not src:   # only one part still shows: to you, that's just a new series
                started.setdefault(parts[0]["id"], _started(item, parts[0], r["ts"]))
                continue
            if not parts:
                continue
            in_split |= {s["id"] for s in parts}
            names = _and([s["name"] for s in parts])
            if src:   # an existing series, split
                title, text = src["name"], f"Fuzz split it into {names}."
            else:   # new work the judge saw was more than one thing
                n = sum(s["n"] for s in parts)
                title, text = names, f"Fuzz saw {_tasks(n)} were {len(parts)} separate pieces of work and started a series for each."
            splits.append(item("split", ("split", r["id"]), parts[0], title, text, r["ts"]))
            continue
        s = shown(d.get("series_id"))
        if not s:
            continue
        if r["type"] == "series.wrapped":
            if s["state"] == "wrapped" and s["id"] not in finished:   # not reopened for season 2 since
                ev = (d.get("evidence") or "").strip()
                finished[s["id"]] = item("wrapped", ("series", s["id"]), s, s["name"],
                                         f"Fuzz checked and it’s finished: {ev}" if ev else "Fuzz checked and it’s finished.",
                                         r["ts"])
        elif s["origin"] == "inferred":   # not one you started or split out yourself
            started.setdefault(s["id"], _started(item, s, r["ts"]))
    return splits + list(finished.values()) + \
        [i for sid, i in started.items() if sid not in finished and sid not in in_split]


def _started(item, s, at):
    text = f"Fuzz grouped {_tasks(s['n'])} that go together into a new series." if s["n"] else "Fuzz started a new series."
    return item("series", ("series", s["id"]), s, s["name"], text, at)


def _tasks(n):
    return f"{n} task{'' if n == 1 else 's'}"


def _and(names):
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
