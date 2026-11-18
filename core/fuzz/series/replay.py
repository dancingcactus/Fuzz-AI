"""Replay series detection over a COPY of a store, day by day, through the core's own detection (docs/series.md,
"Next"). For tuning settings.py and the judge before detection runs on the live queue.

    sqlite3 ~/Library/Application\\ Support/Fuzz/fuzz.db ".backup /tmp/replay/fuzz.db"
    cp ~/Library/Application\\ Support/Fuzz/config.json /tmp/replay/
    python -m fuzz.series.replay /tmp/replay [--no-judge] [--client copilot]

It WIPES every series in the store it's given (that's why it refuses the live one), then for each day: tasks and
signals after that day don't exist yet (Index as_of), detection runs, and its judge items go to the configured
client in one tools-free call (cached in series_judge_cache.json next to the copy, so a rerun costs nothing) or,
with --no-judge, the scripted answer (a series named for its first anchor). A refused or missing verdict is a
wait. The report names real work: keep it out of git.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

from ..db import Core, FuzzError, default_home, iso, parse_iso
from . import detect, index as index_mod, record

PROMPT = """You keep one person's "series" up to date as their work arrives. A series is a project, launch,
escalation, spec, customer engagement or transition with several parts that will wrap up some day, even if nobody
knows when. An ongoing area of responsibility (the product they own, a customer account in general, their team, a
standing duty, weekly reporting) is an AREA, not a series.

Answer every item with one of its "actions":
- series_candidate: "new" with "name" (2-5 plain, specific words) and "bounded" (false makes it an area); "join"
  with "series_id" from its "nearby" (a forming piece included: that's how pieces come back together); "split" with
  "parts": [{"name", "bounded", "tasks": [task ids]}] only when it really mixes separate bodies of work; "area"; or
  "wait". Prefer "wait" over "split" when the parts would be small (fewer than four tasks each). Inside an area, a
  bounded effort is still a series.
- series_stall (a forming piece that stopped growing): "merge" with a nearby "series_id", "wait", or "drop".
Use only ids and task numbers an item gives. Reply with JSON only: {"verdicts": [{"series_item": 1, "action": "new",
"name": "...", "bounded": true, "why": "short clause"}]}

Items:
"""


def _scripted(item):
    if item["kind"] == "series_stall":
        return {"series_item": item["series_item"], "action": "wait"}
    name = (item.get("anchors") or ["New series"])[0].split("“")[-1].rstrip("”") or "New series"
    return {"series_item": item["series_item"], "action": "new", "name": name[:80], "bounded": True}


def _judge(home, client, items, stats):
    text = PROMPT + json.dumps(items, ensure_ascii=False)
    path = os.path.join(home, "series_judge_cache.json")
    cache = json.load(open(path)) if os.path.exists(path) else {}
    key = hashlib.sha256(text.encode()).hexdigest()
    if key not in cache:
        from .. import adapters
        argv = adapters.get(client).discovery_command(text, None)
        res = subprocess.run(argv, capture_output=True, text=True, timeout=900, cwd=home)
        raw = res.stdout[res.stdout.find("{"): res.stdout.rfind("}") + 1]
        try:
            cache[key] = json.loads(raw) if raw else {"verdicts": [], "error": res.stderr[-300:]}
        except ValueError:
            cache[key] = {"verdicts": [], "error": "unparseable reply"}
        json.dump(cache, open(path, "w"))
        stats["judge calls (live)"] = stats.get("judge calls (live)", 0) + 1
    stats["judge runs"] = stats.get("judge runs", 0) + 1
    return cache[key].get("verdicts") or []


def wipe(core):
    with core.tx("system"):
        for t in ("series", "series_anchors", "series_items", "series_waits"):
            core.q(f"DELETE FROM {t} WHERE user_id=?", (core.user_id,))
        core.q("UPDATE tasks SET series_id=NULL WHERE user_id=?", (core.user_id,))
        core.q("DELETE FROM feedback WHERE user_id=? AND kind LIKE 'series%'", (core.user_id,))
        core.q("DELETE FROM identifiers WHERE user_id=? AND type='anchor'", (core.user_id,))
        core.q("DELETE FROM cards WHERE user_id=? AND kind LIKE 'series%'", (core.user_id,))


def replay(home, judge=True, client=None):
    clock = {"t": datetime.now(timezone.utc)}
    core = Core(home, clock=lambda: clock["t"])
    client = client or (core.config.get("engine") or {}).get("client")
    wipe(core)
    days = sorted({(t["created_at"] or "")[:10] for t in core.all("SELECT created_at FROM tasks WHERE user_id=? AND state!='merged'",
                                                                    (core.user_id,)) if t["created_at"]})
    log, stats = [], {}
    names = lambda: {s["id"]: s["name"] for s in core.all("SELECT id, name FROM series WHERE user_id=?", (core.user_id,))}
    for day in days:
        clock["t"] = parse_iso(day + "T23:59:00Z")
        as_of = iso(clock["t"])
        with core.tx("fuzz:extractor"):
            out = detect.run(core, as_of=as_of)
        for k, v in out.items():
            stats[k] = stats.get(k, 0) + v
        items = detect.pending_items(core)
        if not items:
            continue
        stats["judge items"] = stats.get("judge items", 0) + len(items)
        verdicts = {v.get("series_item"): v for v in (_judge(home, client, items, stats) if judge and client else map(_scripted, items))
                    if isinstance(v, dict)}
        for i, it in enumerate(items):
            v = verdicts.get(it["series_item"]) or {"series_item": it["series_item"], "action": "wait"}
            v = {k: v[k] for k in ("series_item", "action", "name", "bounded", "series_id", "parts", "why") if k in v}
            try:
                row, item = detect.check(core, i, v)
            except FuzzError as e:
                log.append(f"{day}  refused: {e}")
                stats["refused"] = stats.get("refused", 0) + 1
                v = {"series_item": it["series_item"], "action": "wait"}
                row, item = detect.check(core, i, v)
            with core.tx("fuzz:extractor"):
                o = detect.apply_verdict(core, row, item, v, as_of=as_of)
            stats["verdict: " + v["action"]] = stats.get("verdict: " + v["action"], 0) + 1
            what = v.get("name") or names().get(v.get("series_id")) or ""
            log.append(f"{day}  {it['kind'][7:]} ({len(it.get('tasks') or [])} tasks) → {v['action']} {what} [{o}]"
                       + (f" — {v['why']}" if v.get("why") else ""))
    idx = index_mod.Index(core)
    lines = [f"Series replay over {len(days)} days ({days[0] if days else '-'} → {days[-1] if days else '-'}), "
             f"judge {'on (' + str(client) + ')' if judge and client else 'scripted'}",
             "Stats: " + " · ".join(f"{k} {v}" for k, v in sorted(stats.items())), "", "TIMELINE"] + ["  " + x for x in log]
    real = [s for s in idx.series.values() if s["kind"] == "series" and s["state"] != "forming"]
    lines += ["", f"SERIES AT THE END: {len(real)}"]
    for s in sorted(real, key=lambda s: -len(idx.members.get(s["id"], ()))):
        ms = sorted(idx.members.get(s["id"], ()))
        lines.append(f"  {s['name']}  {len(ms)} tasks ({len(idx.live_tasks(s['id']))} open) · {s['state']}" + (f" · {s['why']}" if s.get("why") else ""))
        for t in ms:
            lines.append(f"     - #{t:<5} {idx.tasks[t]['state']:<9} {idx.tasks[t]['title'][:90]}")
    lines.append("")
    lines.append("AREAS: " + "; ".join(f"{s['name']} ({s.get('ruled_size') or 0})" for s in idx.series.values() if s["kind"] == "area"))
    lines.append("STILL FORMING: " + "; ".join(f"{s['name']} ({len(idx.members.get(s['id'], ()))}, needs "
                                                f"{', '.join(idx.rules(idx.members.get(s['id'], ())))})"
                                                for s in idx.series.values() if s["state"] == "forming"))
    inseries = sum(1 for t in idx.tasks.values() if t.get("series_id") in {s["id"] for s in real})
    lines.append(f"Tasks in a series: {inseries} of {len(idx.tasks)}")
    core.close()
    return "\n".join(lines)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("home", help="a folder holding a COPY of fuzz.db (and its config.json)")
    p.add_argument("--no-judge", action="store_true")
    p.add_argument("--client")
    a = p.parse_args(argv)
    if os.path.realpath(a.home) == os.path.realpath(default_home()):
        sys.exit("That's the live store: replay wipes series. Copy it first (sqlite3 fuzz.db \".backup <copy>/fuzz.db\").")
    print(replay(a.home, judge=not a.no_judge, client=a.client))


if __name__ == "__main__":
    main()
