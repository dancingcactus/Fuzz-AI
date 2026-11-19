"""Dry run of series detection over a copy of the Fuzz store. Read-only.

Usage: python detect.py <fuzz.db> [edge_threshold] [max_df_share]
"""
import collections, json, math, re, sqlite3, sys
from datetime import datetime

DB = sys.argv[1]
EDGE = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
MAX_SHARE = float(sys.argv[3]) if len(sys.argv) > 3 else 0.06
MIN_TASKS, MIN_ORIGINS, MIN_DAYS = 4, 2, 14
LIVE = {"triage", "working", "queued", "review", "mine", "session", "deepwork", "scheduled", "waiting", "parked"}
BASE = {"topic": 3.0, "ticket": 3.0, "document": 3.0, "term": 2.0, "proj": 1.0, "tool": 1.0, "org": 1.0,
        "chan": 2.0, "dm": 0.75, "person": 0.75}

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
tasks = {r["id"]: r for r in db.execute("SELECT * FROM tasks WHERE state!='merged'")}
N = len(tasks)

me = {r["id"] for r in db.execute("SELECT id FROM entities WHERE type='person' AND lower(name) LIKE '%justin grover%'")}
ents = {r["id"]: r for r in db.execute("SELECT id,type,name FROM entities")}


def norm(s):
    w = re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split()
    return " ".join(x[:-1] if len(x) > 3 and x.endswith("s") and not x.endswith("ss") else x for x in w)


feats = collections.defaultdict(dict)      # task -> {feature_key: label}
origins = collections.defaultdict(set)     # task -> origin anchors
times = collections.defaultdict(list)      # task -> signal timestamps

rows = db.execute("""SELECT s.task_id, c.id cid, c.payload, g.source, g.source_id, g.anchor, g.ts
  FROM sources s JOIN candidates c ON c.id=s.candidate_id LEFT JOIN signals g ON g.key=c.signal_key AND g.user_id=c.user_id
  WHERE s.role IN ('origin','update','context') AND s.withdrawn=0""")
for r in rows:
    t = r["task_id"]
    if t not in tasks:
        continue
    if r["anchor"]:
        origins[t].add(r["anchor"])
    if r["ts"]:
        times[t].append(r["ts"])
    try:
        p = json.loads(r["payload"] or "{}")
    except ValueError:
        p = {}
    for tp in p.get("topics") or []:
        if norm(tp):
            feats[t]["topic:" + norm(tp)] = "topic “%s”" % tp
    if r["source"] == "slack" and r["source_id"]:
        ch = r["source_id"].split(":")[0]
        if ch.startswith("D"):
            feats[t]["dm:" + ch] = "Slack DM " + ch
        else:
            feats[t]["chan:" + ch] = "Slack channel " + ch
    for m in db.execute("SELECT entity_id FROM mentions WHERE candidate_id=? AND strength!='provisional'", (r["cid"],)):
        e = ents.get(m["entity_id"])
        if not e or e["id"] in me:
            continue
        typ, name = e["type"], e["name"] or ""
        if typ == "ticket":
            feats[t]["ticket:%d" % e["id"]] = "ticket " + name
            pre = name.split("-")[0]
            if pre:
                feats[t]["proj:" + pre] = "ticket project " + pre
        elif typ in BASE:
            feats[t]["%s:%d" % (typ, e["id"])] = "%s %s" % (typ, name)
for t, r in tasks.items():
    if r["group_id"]:
        origins[t].add("group:%d" % r["group_id"])
    if not origins[t]:
        origins[t].add("task:%d" % t)     # captured by hand: its own origin

df = collections.Counter(k for f in feats.values() for k in f)
cap = max(8, int(MAX_SHARE * N))
dropped = sorted(((n, k) for k, n in df.items() if n > cap), reverse=True)


def weight(k):
    n = df[k]
    if n < 2 or n > cap:
        return 0.0
    return BASE[k.split(":")[0]] * math.log(N / n)


labels = {}
for f in feats.values():
    labels.update(f)

# Anchor-seeded clusters: each strong anchor on >=3 tasks proposes its task set; heavily overlapping sets merge.
SEED_KINDS = {"topic", "ticket", "term", "chan"}
by_feat = collections.defaultdict(set)
for t, f in feats.items():
    for k in f:
        if weight(k) > 0:
            by_feat[k].add(t)
seeds = [({k}, set(ts)) for k, ts in by_feat.items() if k.split(":")[0] in SEED_KINDS and len(ts) >= 3]
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


def fit(t, keys):
    return sum(weight(k) for k in keys if k in feats[t])


home = {}
multi = collections.Counter()
for t in tasks:
    fits = [(fit(t, keys), i) for i, (keys, ts) in enumerate(seeds) if t in ts]
    if fits:
        multi[len(fits)] += 1
        home[t] = max(fits)[1]
comps = [set(t for t, i in home.items() if i == n) for n in range(len(seeds))]
seed_keys = [keys for keys, _ in seeds]
comps = [c for c in comps if c]


def ts_of(t):
    r = tasks[t]
    vals = [v for v in [r["created_at"], r["state_changed_at"], r["updated_at"]] + times[t] if v]
    return [datetime.fromisoformat(v.replace("Z", "+00:00")[:25]) for v in vals]


now = max(d for t in tasks for d in ts_of(t))


def describe(comp):
    alld = [d for t in comp for d in ts_of(t)]
    span = (max(alld) - min(alld)).days
    orig = set().union(*(origins[t] for t in comp))
    shared = collections.Counter(k for t in comp for k in feats[t] if weight(k) > 0)
    anchors = [(n, k) for k, n in shared.items() if n >= 2]
    anchors.sort(key=lambda x: (-x[0] * weight(x[1]), x[1]))
    live = [t for t in comp if tasks[t]["state"] in LIVE]
    last = max(alld)
    if not live:
        status = "would be wrapped (nothing open)"
    elif (now - last).days > 14:
        status = "gone quiet (%d days)" % (now - last).days
    else:
        status = "going"
    fails = []
    if len(comp) < MIN_TASKS:
        fails.append("%d tasks < %d" % (len(comp), MIN_TASKS))
    if len(orig) < MIN_ORIGINS:
        fails.append("1 origin")
    days = len({d.date() for t in comp for d in ts_of(t)})
    if days < 3:
        fails.append("active on %d days < 3" % days)
    return dict(span=span, orig=len(orig), anchors=anchors, live=len(live), status=status, fails=fails,
                start=min(alld).date(), last=last.date())


out = []
P = out.append
P("Series detection dry run · %d tasks (merged excluded) · edge ≥ %.1f · features on more than %d tasks dropped as too broad" % (N, EDGE, cap))
P("Rules: ≥%d tasks, ≥%d origins, active on ≥3 days (min span %d ignored). %d tasks have any usable feature; %d candidate clusters." % (
    MIN_TASKS, MIN_ORIGINS, MIN_DAYS, sum(1 for t in tasks if any(weight(k) > 0 for k in feats[t])), len(comps)))
P("")
P("Tasks that fit more than one candidate series: %d (one series per task picks the best fit)" % sum(n for k, n in multi.items() if k > 1))
P("Too broad, ignored: " + "; ".join("%s (%d)" % (labels[k], n) for n, k in dropped[:15]))
P("")
desc = [(c, describe(c)) for c in comps]
desc.sort(key=lambda x: (bool(x[1]["fails"]), -len(x[0])))
kept = [x for x in desc if not x[1]["fails"]]
near = [x for x in desc if x[1]["fails"]]
P("=" * 100)
P("WOULD BE DETECTED: %d series" % len(kept))
P("=" * 100)
for i, (c, d) in enumerate(kept, 1):
    name = labels[d["anchors"][0][1]] if d["anchors"] else "?"
    P("")
    P("%d. [%s] named from: %s" % (i, d["status"], name))
    P("   %d tasks (%d open) · %d origins · %s → %s (%d days)" % (len(c), d["live"], d["orig"], d["start"], d["last"], d["span"]))
    P("   Spotted by: " + "; ".join("%s ×%d" % (labels[k], n) for n, k in d["anchors"][:8]))
    for t in sorted(c, key=lambda t: tasks[t]["created_at"] or ""):
        r = tasks[t]
        P("     - #%-4d %-9s %s" % (t, r["state"], (r["title"] or "")[:90]))
P("")
P("=" * 100)
P("NEAR MISSES (clustered, but fail a rule): %d" % len(near))
P("=" * 100)
for c, d in near:
    name = labels[d["anchors"][0][1]] if d["anchors"] else "?"
    P("  · %s: %d tasks — fails %s — e.g. %s" % (name, len(c), ", ".join(d["fails"]),
      " | ".join((tasks[t]["title"] or "")[:50] for t in sorted(c)[:3])))


# ---------------------------------------------------------------------------------------------------------
# The judge: one tools-free model call over every candidate with 2+ tasks. It may only use candidate ids it was
# given; it merges the same body of work, says whether each series has an implied end (bounded) or is an
# ongoing area, and names it. The core then re-applies the rules to merged series and keeps bounded ones.
JUDGE_PROMPT = """You are grouping one person's work tasks into "series": a project, launch, escalation, spec,
engagement or transition with several parts that will wrap up at some point, even if nobody knows when.

Below are candidate clusters a program found. Do three things:
1. MERGE candidates that are the same body of work (e.g. the same project under slightly different topic names).
   Do not merge things that merely share a product or customer name.
2. For each resulting series, decide BOUNDED: true if it has an implied end (it could be finished, wrapped or
   handed off); false if it is an ongoing area of responsibility (the product the person owns, a customer
   account in general, their team, a standing duty). Areas are not series.
3. NAME each series in 2-5 plain words, the way the person would say it.

Use only the candidate ids given. Every id must appear exactly once, in a series or in "not_series".
Answer with JSON only, no prose:
{"series":[{"name":"...","candidates":["c1","c4"],"bounded":true,"why":"one short clause"}],
 "not_series":[{"candidate":"c7","why":"one short clause"}]}

Candidates:
"""


def judge():
    import os
    import subprocess
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "core"))
    from fuzz import adapters

    cands = {}
    for c, d in desc:
        if len(c) >= 2:
            cands["c%d" % (len(cands) + 1)] = (c, d)
    lines = []
    for cid, (c, d) in cands.items():
        tops = "; ".join(labels[k] for n, k in d["anchors"][:5])
        titles = " | ".join((tasks[t]["title"] or "")[:100] for t in sorted(c)[:8])
        lines.append("%s (%d tasks) anchors: %s\n  tasks: %s" % (cid, len(c), tops, titles))
    with open(os.path.expanduser("~/Library/Application Support/Fuzz/config.json")) as f:
        client = json.load(f)["engine"]["client"]
    argv = adapters.get(client).discovery_command(JUDGE_PROMPT + "\n".join(lines), None)
    res = subprocess.run(argv, capture_output=True, text=True, timeout=600)
    raw = res.stdout[res.stdout.find("{"): res.stdout.rfind("}") + 1]
    if not raw:
        P("")
        P("JUDGE FAILED: no JSON back. stderr: " + res.stderr[-500:])
        return
    verdict = json.loads(raw)

    used, refused, series, areas = set(), [], [], []
    for s in verdict.get("series", []):
        ids = [i for i in s.get("candidates", []) if i in cands and i not in used]
        refused += [i for i in s.get("candidates", []) if i not in cands]
        used.update(ids)
        if not ids:
            continue
        comp = set().union(*(cands[i][0] for i in ids))
        d = describe(comp)
        why = s.get("why", "")
        if not s.get("bounded", False):
            areas.append("%s (%d tasks, %s) — ongoing area — %s" % (s.get("name"), len(comp), "+".join(ids), why))
        elif d["fails"]:
            areas.append("%s (%d tasks, %s) — fails %s — %s" % (s.get("name"), len(comp), "+".join(ids), ", ".join(d["fails"]), why))
        else:
            series.append((s.get("name") or "?", ids, comp, d, why))
    not_ids = {n.get("candidate") for n in verdict.get("not_series", [])}
    for n in verdict.get("not_series", []):
        cid = n.get("candidate")
        if cid in cands and cid not in used:
            c, d = cands[cid]
            areas.append("%s (%d tasks, %s) — not a series — %s" % (labels[d["anchors"][0][1]] if d["anchors"] else "?", len(c), cid, n.get("why", "")))

    series.sort(key=lambda r: -len(r[2]))
    P("")
    P("=" * 100)
    P("AFTER THE JUDGE (%s, %d candidates sent): %d series" % (client, len(cands), len(series)))
    P("=" * 100)
    for name, ids, comp, d, why in series:
        P("")
        P("%s  [%s] %d tasks (%d open) · from %s · %s" % (name, d["status"], len(comp), d["live"], "+".join(ids), why))
        for t in sorted(comp, key=lambda t: tasks[t]["created_at"] or ""):
            P("     - #%-4d %-9s %s" % (t, tasks[t]["state"], (tasks[t]["title"] or "")[:90]))
    P("")
    P("NOT SERIES:")
    for a in areas:
        P("  · " + a)
    skipped = [i for i in cands if i not in used and i not in not_ids]
    P("")
    P("Judge hygiene: unknown ids refused: %s · ids skipped: %s" % (", ".join(refused) or "none", ", ".join(skipped) or "none"))


if "--judge" in sys.argv:
    judge()
print("\n".join(out))
