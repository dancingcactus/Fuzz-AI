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
    ("sent", ("task.sent",)),
    ("drafted", ("task.draft_ready",)),
    ("waiting", ("task.waiting",)),
    ("merged", ("task.merged",)),
    ("let_go", ("task.let_go",)),
    ("new", ("task.extracted",)),
    ("series", ()),   # a series Fuzz started: from series events, not task ones (see _series)
    ("reopened", ("task.reopened", "task.came_back")),
    ("updated", ("task.reply_in",)),
]
ORDER = [k for k, _ in KINDS]
KIND_OF = {t: k for k, types in KINDS for t in types}
# Fuzz's own roles. A Claude session you opened is you working, so it doesn't count.
FUZZ = ("fuzz:extractor", "fuzz:executor", "fuzz:sender", "system")
CLOSED = ("done", "dropped", "letgo", "resolved")
MAX_ITEMS = 100   # the expand lists every task; this only guards a very long time away
# Where a series Fuzz started shows up: made visible at once or promoted from forming (inferred), or a part of
# a cluster the judge split. Forming ones aren't on your screen yet; they count when they're promoted.
SERIES_EVENTS = ("series.inferred", "series.split")


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
        counts.setdefault("series", set()).add(i["series_id"])
        best[("series", i["series_id"])] = i
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
    """The series Fuzz started in the window that are still on your Series page, newest first, once each."""
    rows = core.all(
        f"SELECT ts, type, payload FROM events WHERE user_id=? AND ts>=? AND ts<=? AND actor IN ({','.join('?' * len(FUZZ))}) "
        f"AND type IN ({','.join('?' * len(SERIES_EVENTS))}) ORDER BY id DESC",
        (core.user_id, iso(since), now, *FUZZ, *SERIES_EVENTS))
    found = {}
    for r in rows:
        p = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"] or "{}")
        d = p.get("data") or {}
        sids = [d.get("series_id")] if r["type"] == "series.inferred" else \
            [m.get("series_id") for m in d.get("parts") or [] if not m.get("area") and m.get("state") == "inferred"]
        for sid in sids:
            if sid and sid not in found:
                found[sid] = r["ts"]
    out = []
    for sid, at in found.items():
        s = core.one("SELECT name, kind, state, origin FROM series WHERE id=? AND user_id=?", (sid, core.user_id))
        if not s or s["kind"] != "series" or s["origin"] != "inferred" or s["state"] in ("dropped", "forming"):
            continue   # since dropped or merged away, or one you started
        n = core.one("SELECT count(*) AS n FROM tasks WHERE series_id=? AND user_id=?", (sid, core.user_id))["n"]
        text = f"Fuzz grouped {n} task{'' if n == 1 else 's'} that go together into a new series." if n else \
            "Fuzz started a new series."
        out.append({"kind": "series", "series_id": sid, "task_id": None, "title": s["name"], "text": text, "at": at})
    return out
