"""The duplicate matcher's replay eval (docs/evals.md, "Duplicate matching"): no model, the same answer every run.

Labelled pairs are scored on the same features and formula dupes.likely uses (features, is_close), at the
thresholds in force and across a sweep of the semantic threshold, for precision and recall at each.

  - personal: your answers. A merge says two tasks were the same; Keep separate says they differ; a split
    after a merge says the merge was wrong. The newest answer on a pair wins. Scored on a throwaway copy of
    your store with each merge's side tables put back, so a merged task is judged as it was before it moved;
    your store is never written, but for the run's record.
  - global: invented pairs in eval_seeds/dupes.json with the traps that hold for anyone (a ticket key two
    channels share, the same title for two tickets, the same person asking two things). Scored in a fresh
    store with the hash embedder, so CI gets the same answer every time.

A run is an eval_runs row (surface "dupes"): per pair, whether the matcher at the thresholds in force got it
right, gated like any run on "nothing that was right went wrong". Its meta holds the sweep, which the
thresholds learner reads to propose a better threshold for your yes.
"""

import json
import os
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path

from .. import config as config_mod, evals, learning, tasks
from ..db import Core, FuzzError
from . import dupes, matcher

SURFACE = "dupes"
SEEDS = evals.SEEDS / "dupes.json"
GRID = {"hash": [round(0.40 + 0.05 * i, 2) for i in range(12)],     # 0.40 … 0.95
        "ollama": [round(0.70 + 0.02 * i, 2) for i in range(15)]}   # 0.70 … 0.98


# ---- labels

def labels(core):
    """Your answers on pairs of tasks: [{a, b, same, how}], the newest per pair."""
    out = {}
    for f in core.all("SELECT id, kind, a, b FROM feedback WHERE user_id=? AND kind IN ('merge', 'keep', 'split') "
                      "AND a IS NOT NULL AND b IS NOT NULL ORDER BY id", (core.user_id,)):
        out[tuple(sorted((f["a"], f["b"])))] = {"a": f["a"], "b": f["b"], "same": f["kind"] == "merge",
                                                 "how": f["kind"], "feedback_id": f["id"]}
    return list(out.values())


# ---- scoring one pair

def _row(core, tid):
    return core.q("SELECT * FROM tasks WHERE id=? AND user_id=?", (tid, core.user_id)).fetchone()


def _candidate(ctx, a):
    """The candidate task a was made from (its creation decision's, which a merge doesn't move), or a captured
    task's matching record."""
    core = ctx.core
    row = core.q("SELECT c.* FROM decisions d JOIN candidates c ON c.id=d.candidate_id WHERE d.user_id=? "
                 "AND d.task_id=? ORDER BY d.id LIMIT 1", (core.user_id, a)).fetchone()
    if row:
        return row
    t = tasks.get(core, a)
    return dupes._candidate_for(ctx, t) if t else None


def _features(ctx, a, b):
    with ctx.core.tx("system"):
        cand = _candidate(ctx, a)
        tb = _row(ctx.core, b)
        if cand is None or tb is None:
            return None
        f = dupes.features(ctx, cand, {b: tb})[b]
    f = dict(f, link=list(f["link"]))
    f.pop("names", None)   # what they share by name stays in your store
    return f


# ---- the two sets, each in a store of its own

def _copy_store(core):
    """A throwaway copy of the store, with the config, so the replay can write what matching writes."""
    home = tempfile.mkdtemp(prefix="fuzz-replay-")
    target = sqlite3.connect(os.path.join(home, "fuzz.db"))
    core.conn.backup(target)
    target.close()
    cfg = os.path.join(core.home, "config.json")
    if os.path.exists(cfg):
        shutil.copy(cfg, os.path.join(home, "config.json"))
    return home, Core(home, core.user_id, clock=core.clock)


def _unmerge(copy, pairs):
    """Put back what each labelled merge moved, so both tasks read as they did before it."""
    for p in pairs:
        m = copy.one("SELECT id FROM merges WHERE user_id=? AND undone=0 AND ((from_task=? AND into_task=?) OR "
                     "(from_task=? AND into_task=?))", (copy.user_id, p["a"], p["b"], p["b"], p["a"]))
        if m:
            with copy.tx("system"):
                matcher.unmerge_side_tables(copy, m["id"])


def personal(core, embedder=None):
    """Your labelled pairs, scored on a copy of your store: [{key, a, b, same, how, features}]."""
    pairs = labels(core)
    if not pairs:
        return [], None
    home, copy = _copy_store(core)
    try:
        _unmerge(copy, pairs)
        ctx = matcher.Context(copy, embedder)
        fam = dupes.family(ctx)
        out = []
        for p in pairs:
            f = _features(ctx, p["a"], p["b"])
            if f is not None:
                out.append(dict(p, key=f"pair:{min(p['a'], p['b'])}-{max(p['a'], p['b'])}", scope="personal",
                                features=f))
        return out, fam
    finally:
        copy.close()
        shutil.rmtree(home, ignore_errors=True)


def global_pairs(path=None):
    p = Path(path) if path else SEEDS
    if not p.exists():
        return []
    data = json.loads(p.read_text())
    if data.get("format", 1) not in evals.FORMATS:
        raise FuzzError(f"{p.name} is format {data.get('format')}", "format")
    return data["pairs"]


def global_set(path=None, clock=None):
    """The invented pairs, each pair's two tasks captured in a fresh store with the hash embedder."""
    cases = global_pairs(path)
    if not cases:
        return [], "hash"
    home = tempfile.mkdtemp(prefix="fuzz-replay-global-")
    try:
        cfg = config_mod.load(home)
        cfg["me"] = {"names": ["Alex Chen"], "emails": ["alex@acme.example"]}
        cfg["embedder"], cfg["tz"] = "hash", "UTC"
        cfg["evals"] = {"spot_checks_per_week": 0, "run_checks_per_week": 0}
        config_mod.save(home, cfg)
        core = Core(home, 1, clock=clock)
        try:
            ctx = matcher.Context(core)
            out = []
            for c in cases:
                ids = []
                for side in ("a", "b"):
                    t = c[side]
                    # as a task Fuzz gathers for: its links are on it before its matching record is made
                    tid = tasks.capture(core, t["text"], gather=True)
                    with core.tx("human"):
                        for link in t.get("links") or []:
                            tasks._link_source(core, tid, t.get("link_title") or "Link", link, None)
                    ids.append(tid)
                f = _features(ctx, ids[0], ids[1])
                out.append({"key": f"seed:{c['name']}", "a": ids[0], "b": ids[1], "same": c["same"],
                            "how": "seed", "scope": "global", "why": c.get("why"), "features": f})
            return out, dupes.family(ctx)
        finally:
            core.close()
    finally:
        shutil.rmtree(home, ignore_errors=True)


# ---- scoring

def confusion(pairs, fam, th):
    tp = fp = fn = tn = 0
    for p in pairs:
        said = dupes.is_close(p["features"], fam, th)
        if said and p["same"]:
            tp += 1
        elif said:
            fp += 1
        elif p["same"]:
            fn += 1
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = (2 * precision * recall / (precision + recall)) if precision and recall else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "precision": _r(precision), "recall": _r(recall), "f1": _r(f1)}


def _r(x):
    return None if x is None else round(x, 3)


def sweep(pairs, fam, th):
    """Precision and recall at each semantic threshold, the rest held where they are."""
    rows = []
    for v in sorted(set(GRID[fam] + [th["dup_sem"]])):
        rows.append(dict(confusion(pairs, fam, dict(th, dup_sem=v)), dup_sem=v, current=v == th["dup_sem"]))
    return rows


def best(rows):
    """The threshold with the best F1; on a tie, the one that asks least (higher precision, then higher value)."""
    return max(rows, key=lambda r: (r["f1"] or 0, r["precision"] or 0, r["dup_sem"])) if rows else None


def run(core, sets="all", embedder=None, against=None, path=None):
    """Score the labelled pairs at the thresholds in force, sweep the semantic one, and record the run."""
    if sets not in evals.SETS:
        raise FuzzError(f"set is one of {', '.join(evals.SETS)}", "set")
    started = time.monotonic()
    pairs, fams = [], {}
    if sets in ("all", "global"):
        g, fams["global"] = global_set(path, clock=core.clock)
        pairs += g
    if sets in ("all", "personal"):
        p, fam = personal(core, embedder)
        pairs += p
        if fam:
            fams["personal"] = fam
    if not pairs:
        raise FuzzError("no labelled pairs: merge or keep two tasks separate, or add eval_seeds/dupes.json", "cases")
    results, meta = [], {"families": fams, "sweep": {}, "thresholds": {}}
    for scope in ("global", "personal"):
        mine = [p for p in pairs if p["scope"] == scope and p["features"] is not None]
        if not mine:
            continue
        fam = fams[scope]
        th = dupes.thresholds(core, fam) if scope == "personal" else dupes.thresholds_default(fam)
        meta["thresholds"][scope] = th
        meta["sweep"][scope] = sweep(mine, fam, th)
        meta["labels"] = meta.get("labels", 0) + (len(mine) if scope == "personal" else 0)
        for p in mine:
            ok = dupes.is_close(p["features"], fam, th) == p["same"]
            results.append({"key": p["key"], "case_id": None, "origin": p["key"], "scope": scope,
                            "kind": "same" if p["same"] else "different",
                            "fp": evals.fingerprint({"a": p["a"], "b": p["b"]} if scope == "personal" else p["key"],
                                                    {"same": p["same"]}),
                            "passes": int(ok), "runs": 1, "passed": ok, "features": p["features"],
                            **({"why": p["why"]} if p.get("why") else {})})
    base = evals.get_run(core, against) if against else evals.baseline(core, SURFACE)
    reg = evals.regressions(base, {"results": results})
    version = json.dumps({s: meta["thresholds"][s] for s in meta["thresholds"]}, sort_keys=True)
    cur = core.q("INSERT INTO eval_runs (user_id, ts, surface, skill_version, skill_copy, client, model, repeats, "
                 "lessons, results, against, gate_ok, sets, seeds_commit, seconds, meta) "
                 "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                 (core.user_id, core.now_iso(), SURFACE, version, "matcher", "replay",
                  fams.get("personal") or fams.get("global"), 1,
                  json.dumps(learning.lessons_for(core, SURFACE)), json.dumps(results),
                  base["id"] if base else None, 0 if reg else 1, sets, evals.commit(),
                  round(time.monotonic() - started, 1), json.dumps(meta)))
    learning.run(core)   # the thresholds learner reads this run
    proposed = core.all("SELECT id, example FROM lessons WHERE user_id=? AND surface=? AND status='proposed'",
                        (core.user_id, SURFACE))
    ids = [x["id"] for x in proposed
           if (json.loads(x["example"]) if isinstance(x["example"], str) else x["example"]).get("run") == cur.lastrowid]
    learning.scored(core, ids, cur.lastrowid, True)
    return evals.get_run(core, cur.lastrowid)


def summary(core, run):
    meta = json.loads(run["meta"]) if isinstance(run.get("meta"), str) else (run.get("meta") or {})
    base = evals.summary(core, run)
    out = {k: base[k] for k in ("run", "set", "passing", "against", "gate", "regressions", "seconds") if k in base}
    for k in ("changed", "fixed", "broke"):
        if k in base:
            out[k] = base[k]
    out["thresholds"] = meta.get("thresholds")
    out["wrong"] = [{"pair": r["origin"], "should_be": r["kind"],
                     "semantic": round(r["features"]["semantic"], 3), "entity": round(r["features"]["entity"], 2),
                     "words": round(r["features"]["words"], 2), "shared_link": bool(r["features"]["link"])}
                    for r in run["results"] if not r["passed"]]
    for scope, rows in (meta.get("sweep") or {}).items():
        cur = next((r for r in rows if r["current"]), None)
        b = best(rows)
        out[f"{scope}_now"] = {k: cur[k] for k in ("dup_sem", "precision", "recall", "f1")} if cur else None
        out[f"{scope}_best"] = {k: b[k] for k in ("dup_sem", "precision", "recall", "f1")} if b else None
    return out
