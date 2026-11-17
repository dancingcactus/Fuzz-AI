"""Matcher tuning: a better threshold for "Same as…?" cards, from your merge and Keep separate answers.

Reads the newest replay run (`fuzz eval dupes`, matching/replay.py), which scored your labelled pairs across a
sweep of the semantic threshold. When there are enough labels and another threshold is clearly better (F1 up
by MARGIN, precision no more than SLACK lower), it proposes that one. It changes what you're asked, so it waits
for your yes in Settings (rule 4); once you say yes, dupes.likely reads it.

The threshold in force stays wanted while it's in force, so a later run that agrees with it doesn't retire it.
SQL only: the replay itself is a command, never part of the tick.
"""

import json

from . import Learner

LEARNER = Learner(name="thresholds", surface="dupes", prefix="dupes:")
MIN_LABELS = 20   # fewer labelled pairs than this and a threshold is noise
MARGIN = 0.05     # how much better F1 must be to propose a change
SLACK = 0.05      # how much precision may drop for it


def _latest(core):
    r = core.one("SELECT id, meta FROM eval_runs WHERE user_id=? AND surface='dupes' AND meta IS NOT NULL "
                 "ORDER BY id DESC LIMIT 1", (core.user_id,))
    if not r:
        return None, {}
    return r["id"], json.loads(r["meta"]) if isinstance(r["meta"], str) else r["meta"]


def _in_force(core):
    """Active threshold lessons, by family: the newest wins, as dupes.tuned reads them."""
    out = {}
    for r in core.all("SELECT key, example, rule FROM lessons WHERE user_id=? AND surface='dupes' AND status='active' "
                      "ORDER BY id", (core.user_id,)):
        ex = json.loads(r["example"]) if isinstance(r["example"], str) else r["example"]
        out[ex.get("family")] = {"key": r["key"], "example": ex, "rule": r["rule"]}
    return out


def _pct(x):
    return "?" if x is None else f"{round(x * 100)}%"


def learn(core):
    from ...matching import replay
    out = []
    held = _in_force(core)
    for fam, x in held.items():   # keep what you said yes to
        out.append({"key": x["key"], "kind": "rule", "rule": x["rule"], "example": x["example"],
                    "status": "active", "how": "confirmed"})
    run_id, meta = _latest(core)
    rows = (meta.get("sweep") or {}).get("personal")
    fam = (meta.get("families") or {}).get("personal")
    if not rows or not fam or (meta.get("labels") or 0) < MIN_LABELS:
        return out
    cur = next((r for r in rows if r["current"]), None)
    b = replay.best(rows)
    if not cur or not b or b["dup_sem"] == cur["dup_sem"]:
        return out
    if (b["f1"] or 0) < (cur["f1"] or 0) + MARGIN or (b["precision"] or 0) < (cur["precision"] or 0) - SLACK:
        return out
    key = f"dupes:dup_sem:{fam}:{b['dup_sem']}"
    if any(o["key"] == key for o in out):
        return out
    asks = "less often" if b["dup_sem"] > cur["dup_sem"] else "more often"
    rule = (f"Ask “Same as…?” {asks}: at {b['dup_sem']} similarity instead of {cur['dup_sem']}. On your "
            f"{meta['labels']} answers it would catch {_pct(b['recall'])} of real duplicates (now "
            f"{_pct(cur['recall'])}) and be right {_pct(b['precision'])} of the time it asks (now "
            f"{_pct(cur['precision'])}).")
    out.append({"key": key, "kind": "rule", "rule": rule, "status": "proposed", "how": "inferred",
                "example": {"param": "dup_sem", "family": fam, "value": b["dup_sem"], "from": cur["dup_sem"],
                            "run": run_id, "precision": b["precision"], "recall": b["recall"],
                            "now": {"precision": cur["precision"], "recall": cur["recall"]}}})
    return out
