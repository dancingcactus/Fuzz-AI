"""Replay: series detection as things come in, one run per day, over a copy of the Fuzz store. Read-only.

Each signal arrives at its own time. Per run (a day):
  1. attach   (no AI) a task not in a series joins the one whose anchors it clearly matches; a near tie is a judge item
  2. seed     (no AI) anchors on >=3 unattached tasks form candidates; one that passes the rules is a judge item,
              shown with the existing series nearest to it
  3. judge    (AI, one call per run, only when there are items) new | join | split | area | wait; attach-or-none
Series membership is sticky. Areas are remembered so their anchors never seed again. "wait" asks again only
once the candidate has grown.

Usage: python stream.py <fuzz.db> [--no-judge]
Judge answers are cached next to the db (judge_cache.json), so a rerun with the same inputs costs nothing.
"""
import collections
import hashlib
import json
import math
import os
import re
import sqlite3
import subprocess
import sys

DB = sys.argv[1]
USE_JUDGE = "--no-judge" not in sys.argv
CACHE = os.path.join(os.path.dirname(os.path.abspath(DB)), "judge_cache.json")
MIN_TASKS, MIN_ORIGINS, MIN_DAYS = 4, 2, 3
ATTACH, CLOSE, SEED_MIN, BROAD, REGROW, N_FLOOR = 6.0, 0.6, 3, 0.10, 2, 150
BASE = {"topic": 3.0, "ticket": 3.0, "document": 3.0, "term": 2.0, "proj": 1.0, "tool": 1.0, "org": 1.0,
        "chan": 2.0, "dm": 0.75, "person": 0.75}
SEED_KINDS = {"topic", "ticket", "term", "chan"}
LIVE = {"triage", "working", "queued", "review", "mine", "session", "deepwork", "scheduled", "waiting", "parked"}

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
tasks = {r["id"]: r for r in db.execute("SELECT * FROM tasks WHERE state!='merged'")}
me = {r["id"] for r in db.execute("SELECT id FROM entities WHERE type='person' AND lower(name) LIKE '%justin grover%'")}
ents = {r["id"]: r for r in db.execute("SELECT id,type,name FROM entities")}
labels = {}


def norm(s):
    w = re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split()
    return " ".join(x[:-1] if len(x) > 3 and x.endswith("s") and not x.endswith("ss") else x for x in w)


def row_feats(r):
    f = {}
    try:
        p = json.loads(r["payload"] or "{}")
    except ValueError:
        p = {}
    for tp in p.get("topics") or []:
        if norm(tp):
            f["topic:" + norm(tp)] = "topic “%s”" % tp
    if r["source"] == "slack" and r["source_id"]:
        ch = r["source_id"].split(":")[0]
        f[("dm:" if ch.startswith("D") else "chan:") + ch] = ("Slack DM " if ch.startswith("D") else "Slack channel ") + ch
    for m in db.execute("SELECT entity_id FROM mentions WHERE candidate_id=? AND strength!='provisional'", (r["cid"],)):
        e = ents.get(m["entity_id"])
        if not e or e["id"] in me or "[bot]" in (e["name"] or ""):
            continue
        typ, name = e["type"], e["name"] or ""
        if typ == "ticket":
            f["ticket:%d" % e["id"]] = "ticket " + name
            if name.split("-")[0]:
                f["proj:" + name.split("-")[0]] = "ticket project " + name.split("-")[0]
        elif typ in BASE:
            f["%s:%d" % (typ, e["id"])] = "%s %s" % (typ, name)
    return f


# Every signal that touched a task is an event at the signal's time; a task captured by hand arrives featureless.
events = []
had = set()
for r in db.execute("""SELECT s.task_id, c.id cid, c.payload, g.source, g.source_id, g.anchor, g.ts
     FROM sources s JOIN candidates c ON c.id=s.candidate_id LEFT JOIN signals g ON g.key=c.signal_key AND g.user_id=c.user_id
     WHERE s.role IN ('origin','update','context') AND s.withdrawn=0"""):
    t = r["task_id"]
    if t not in tasks:
        continue
    f = row_feats(r)
    labels.update(f)
    events.append(((r["ts"] or tasks[t]["created_at"] or "")[:19], t, f, r["anchor"] or "task:%d" % t))
    had.add(t)
for t, row in tasks.items():
    if t not in had:
        events.append(((row["created_at"] or "")[:19], t, {}, "task:%d" % t))
events.sort(key=lambda e: e[0])

index = collections.defaultdict(set)    # feature -> tasks
feats = collections.defaultdict(dict)   # task -> features
origins = collections.defaultdict(set)
dates = collections.defaultdict(set)
seen = set()
series = {}                             # sid -> {name, tasks, keys, area, why, day}
home = {}                               # task -> sid (series or forming, never an area)
area_tasks = set()                       # tasks an area covers: they don't seed, but can still join a series
area_keys = set()
waiting = {}                            # frozenset(seed keys) -> size when the judge said wait
asked_attach = set()
log, stats = [], collections.Counter()


def weight(k):
    n, N = len(index[k]), max(len(seen), N_FLOOR)
    if n < 2 or n > max(8, BROAD * len(seen)):
        return 0.0
    return BASE[k.split(":")[0]] * math.log(N / n)


def anchors_of(ts):
    c = collections.Counter(k for t in ts for k in feats[t] if weight(k) > 0)
    return {k for k, n in c.items() if n >= 2}


def score(t, sid):
    a = anchors_of(series[sid]["tasks"])
    return sum(weight(k) for k in feats[t] if k in a)


def rules(ts):
    orig = set().union(*(origins[t] for t in ts)) if ts else set()
    days = set().union(*(dates[t] for t in ts)) if ts else set()
    fails = []
    if len(ts) < MIN_TASKS:
        fails.append("%d tasks" % len(ts))
    if len(orig) < MIN_ORIGINS:
        fails.append("1 origin")
    if len(days) < MIN_DAYS:
        fails.append("%d active days" % len(days))
    return fails


def title(t):
    return (tasks[t]["title"] or "")[:90]


def new_series(name, ts, keys, area, why, day, forming=False):
    sid = "s%d" % (len(series) + 1)
    series[sid] = dict(name=name, tasks=set(ts), keys=set(keys), area=area, why=why, day=day, forming=forming)
    for t in ts:
        if area:
            area_tasks.add(t)
        else:
            home[t] = sid
    if area:
        area_keys.update(keys)
    return sid


def top_label(keys, ts):
    ks = sorted(keys, key=lambda k: -sum(1 for t in ts if k in feats[t]))
    return labels.get(ks[0], "?") if ks else "?"


PROMPT = """You keep one person's "series" up to date as new work arrives. A series is a project, launch,
escalation, spec, engagement or transition with several parts that will wrap up at some point, even if nobody
knows when. An ongoing area of responsibility (the product they own, a customer account in general, their team,
a standing duty) is an AREA, not a series.

For each item below, answer with one action.
Candidate items (p…): a new cluster of tasks.
  "new"   it is one series: give "name" (2-5 plain words) and "bounded": true
  "join"  it belongs to one of the nearby series listed with it: give "series"
  "split" it mixes several bodies of work: give "parts", each {"name","bounded","tasks":[task numbers]};
          leave out tasks that fit no part. A part that is an area gets "bounded": false
  "area"  the whole cluster is an ongoing area
  "wait"  too early to tell
Attach items (a…): a task that matches more than one series. "attach" with "series": one of the ids offered, or null.

Use only ids and task numbers that appear in the item. Answer with JSON only:
{"items":[{"id":"p1","action":"new","name":"...","bounded":true,"why":"short clause"},
          {"id":"p2","action":"split","parts":[{"name":"...","bounded":true,"tasks":[12,15,19,22]}],"why":"..."},
          {"id":"a1","action":"attach","series":"s3"}]}

Items:
"""


def run_judge(text):
    cache = {}
    if os.path.exists(CACHE):
        with open(CACHE) as f:
            cache = json.load(f)
    h = hashlib.sha256(text.encode()).hexdigest()
    if h not in cache:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "core"))
        from fuzz import adapters
        with open(os.path.expanduser("~/Library/Application Support/Fuzz/config.json")) as f:
            client = json.load(f)["engine"]["client"]
        res = subprocess.run(adapters.get(client).discovery_command(text, None), capture_output=True, text=True, timeout=600)
        raw = res.stdout[res.stdout.find("{"): res.stdout.rfind("}") + 1]
        cache[h] = json.loads(raw) if raw else {"items": [], "error": res.stderr[-300:]}
        with open(CACHE, "w") as f:
            json.dump(cache, f)
        stats["judge calls (live)"] += 1
    stats["judge runs"] += 1
    return cache[h]


by_day = collections.defaultdict(list)
for e in events:
    by_day[e[0][:10]].append(e)

for day in sorted(by_day):
    touched = []
    for ts, t, f, origin in by_day[day]:
        seen.add(t)
        origins[t].add(origin)
        if tasks[t]["group_id"]:
            origins[t].add("group:%d" % tasks[t]["group_id"])
        dates[t].add(day)
        for k, lab in f.items():
            feats[t][k] = lab
            index[k].add(t)
        if t not in home:
            touched.append(t)

    # 1. attach
    items, ctx = [], {}
    live_series = [s for s in series if not series[s]["area"] and not series[s]["forming"]]
    for t in dict.fromkeys(touched):
        sc = sorted(((score(t, s), s) for s in series if not series[s]["area"]), reverse=True)
        sc = [x for x in sc if x[0] >= ATTACH]
        if not sc:
            continue
        if len(sc) == 1 or sc[1][0] < CLOSE * sc[0][0]:
            sid = sc[0][1]
            home[t] = sid
            series[sid]["tasks"].add(t)
            stats["attached (no AI)"] += 1
            log.append("%s  attach #%d → %s%s" % (day, t, series[sid]["name"], " (forming)" if series[sid]["forming"] else ""))
        elif t not in asked_attach:
            asked_attach.add(t)
            opts = [s for _, s in sc[:3]]
            aid = "a%d" % (len(items) + 1)
            ctx[aid] = ("attach", t, opts)
            items.append("%s task #%d “%s” could join: %s" % (aid, t, title(t), "; ".join(
                "%s “%s”" % (s, series[s]["name"]) for s in opts)))

    # forming series that now pass the rules become series, no AI needed: the judge already named them
    for sid, s in series.items():
        if s["forming"] and not rules(s["tasks"]):
            s["forming"] = False
            stats["forming → series (no AI)"] += 1
            log.append("%s  forming “%s” passes the rules → series (%d tasks)" % (day, s["name"], len(s["tasks"])))

    # 2. seed
    seeds = []
    for k, ts in index.items():
        if k.split(":")[0] in SEED_KINDS and k not in area_keys and weight(k) > 0:
            free = {t for t in ts if t not in home and t not in area_tasks}
            if len(free) >= SEED_MIN:
                seeds.append(({k}, free))
    merged = True
    while merged:
        merged = False
        seeds.sort(key=lambda s: -len(s[1]))
        for i in range(len(seeds)):
            for j in range(i + 1, len(seeds)):
                a, b = seeds[i][1], seeds[j][1]
                inter = len(a & b)
                if inter and (inter / len(a | b) >= 0.4 or inter / min(len(a), len(b)) >= 0.8):
                    seeds[i] = (seeds[i][0] | seeds[j][0], a | b)
                    del seeds[j]
                    merged = True
                    break
            if merged:
                break
    claimed = set()
    for keys, ts in seeds:
        ts = ts - claimed
        if rules(ts):
            continue
        key = frozenset(keys)
        if key in waiting and len(ts) < waiting[key] + REGROW:
            continue
        claimed |= ts
        near = sorted(((sum(score(t, s) for t in ts), s) for s in live_series), reverse=True)
        near = [s for v, s in near[:3] if v > 0]
        pid = "p%d" % (len(items) + 1)
        ctx[pid] = ("promote", ts, keys, near)
        items.append("%s candidate (%d tasks) anchors: %s\n   tasks: %s%s" % (
            pid, len(ts), "; ".join(labels.get(k, k) for k in list(keys)[:5]),
            " | ".join("#%d %s" % (t, title(t)) for t in sorted(ts)[:12]),
            ("\n   nearby series: " + "; ".join("%s “%s” (%d tasks, e.g. %s)" % (
                s, series[s]["name"], len(series[s]["tasks"]), title(min(series[s]["tasks"]))) for s in near)) if near else ""))

    if not items:
        continue
    stats["judge items"] += len(items)

    # 3. judge
    if USE_JUDGE:
        verdicts = {v.get("id"): v for v in run_judge(PROMPT + "\n".join(items)).get("items", [])}
    else:
        verdicts = {}
        for iid, c in ctx.items():
            verdicts[iid] = {"action": "attach", "series": c[2][0] if c[2] else None} if c[0] == "attach" else \
                {"action": "new", "name": top_label(c[2], c[1]), "bounded": True}
    for iid, c in ctx.items():
        v = verdicts.get(iid) or {"action": "wait"}
        act = v.get("action")
        if c[0] == "attach":
            sid = v.get("series")
            if sid in c[2]:
                home[c[1]] = sid
                series[sid]["tasks"].add(c[1])
                log.append("%s  judge: attach #%d → %s" % (day, c[1], series[sid]["name"]))
            stats["attach items"] += 1
            continue
        _, ts, keys, near = c
        stats["candidate items"] += 1
        stats["verdict: " + str(act)] += 1
        if act == "new":
            bounded = v.get("bounded", True)
            sid = new_series(v.get("name") or top_label(keys, ts), ts, keys, not bounded, v.get("why", ""), day)
            log.append("%s  judge: %s “%s” (%d tasks)%s" % (day, "new series" if bounded else "AREA", series[sid]["name"], len(ts), " — " + v.get("why", "") if v.get("why") else ""))
        elif act == "join" and v.get("series") in near:
            sid = v["series"]
            for t in ts:
                home[t] = sid
            series[sid]["tasks"] |= ts
            series[sid]["keys"] |= keys
            log.append("%s  judge: join %d tasks → %s" % (day, len(ts), series[sid]["name"]))
        elif act == "split":
            left = set(ts)
            parts = []
            for p in v.get("parts") or []:
                pts ={t for t in (int(str(x).lstrip("#")) for x in p.get("tasks", []) if str(x).lstrip("#").isdigit()) if t in left}
                if not pts:
                    continue
                left -= pts
                if not p.get("bounded", True):
                    new_series(p.get("name") or "?", pts, set(), True, "", day)
                    parts.append("area “%s” (%d)" % (p.get("name"), len(pts)))
                elif rules(pts):
                    new_series(p.get("name") or "?", pts, keys, False, v.get("why", ""), day, forming=True)
                    parts.append("forming “%s” (%d, needs: %s)" % (p.get("name"), len(pts), ", ".join(rules(pts))))
                else:
                    new_series(p.get("name") or "?", pts, keys, False, v.get("why", ""), day)
                    parts.append("series “%s” (%d)" % (p.get("name"), len(pts)))
            waiting[frozenset(keys)] = len(ts)
            log.append("%s  judge: SPLIT %d tasks into %s" % (day, len(ts), "; ".join(parts) or "nothing usable"))
        elif act == "area":
            new_series(top_label(keys, ts), ts, keys, True, v.get("why", ""), day)
            log.append("%s  judge: AREA “%s” (%d tasks) — %s" % (day, top_label(keys, ts), len(ts), v.get("why", "")))
        else:
            waiting[frozenset(keys)] = len(ts)
            log.append("%s  judge: wait on “%s” (%d tasks)" % (day, top_label(keys, ts), len(ts)))

out = []
P = out.append
P("Series as things come in: %d tasks replayed over %d days (%s → %s), judge %s" % (
    len(tasks), len(by_day), min(by_day), max(by_day), "on" if USE_JUDGE else "off (top anchor names it)"))
P("Stats: " + " · ".join("%s %d" % kv for kv in sorted(stats.items())))
P("")
P("TIMELINE")
for line in log:
    P("  " + line)
real = sorted((s for s in series if not series[s]["area"] and not series[s]["forming"]), key=lambda s: -len(series[s]["tasks"]))
P("")
P("=" * 100)
P("SERIES AT THE END: %d" % len(real))
P("=" * 100)
for s in real:
    ts = series[s]["tasks"]
    live = sum(1 for t in ts if tasks[t]["state"] in LIVE)
    P("")
    P("%s  %d tasks (%d open) · formed %s%s" % (series[s]["name"], len(ts), live, series[s]["day"], " · " + series[s]["why"] if series[s]["why"] else ""))
    for t in sorted(ts, key=lambda t: tasks[t]["created_at"] or ""):
        P("     - #%-4d %-9s %s" % (t, tasks[t]["state"], title(t)))
P("")
P("AREAS (remembered; their anchors no longer seed): " + "; ".join(
    "%s (%d)" % (series[s]["name"], len(series[s]["tasks"])) for s in series if series[s]["area"]))
P("STILL FORMING: " + "; ".join("%s (%d, needs %s)" % (series[s]["name"], len(series[s]["tasks"]), ", ".join(rules(series[s]["tasks"]))) for s in series if series[s]["forming"]))
P("Tasks in no series: %d of %d" % (len(tasks) - len([t for t in home if not series[home[t]]["forming"]]), len(tasks)))
print("\n".join(out))
