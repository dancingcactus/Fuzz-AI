"""Priority evals: does a check-in's answer pick today's set and order it the way docs/energy-and-priority.md says?

No model: priority.py is rules (categories, included, rank, keys), so a case is a day's queue and an energy, replayed
through the core's own functions, and the answer is the same every run. Like the senders eval.

A case's input: {"energy": good | okay | tired | overloaded, "vips": [..]?, "cards": [card, ...]}, each card
  {"id", "kind"?: task (default) | draft | nudge | permission | <a question's kind>,
   "task"?: {deadline_level?, effort_mins?, energy?, variant_tags?, reschedules?, expires_today?} (null: no task),
   "from"?: {"name", "email"}, "nudged"?: bool, "goal"?: bool, "reply_draft"?: bool}

Checks, all of which must hold (pairwise and in/out, never a whole order, so a tie-break can't break a case):
  {"in": id}               in today's set
  {"out": id}              left out of it
  {"before": [a, b]}       a comes before b
  {"first": id}            first of all
  {"cats": [id, [cat..]]}  the card carries every one of these categories
  {"not_cats": [id, [cat..]]}  and none of these

Global only: there are no personal labels yet (a "this should have come first" on a card would be the source).
"""

import json
import time

from . import evals, learning, priority
from .db import FuzzError

SURFACE = "priority"
DAY_END = "2026-10-20T23:59:59Z"   # the cases' day: a Tuesday


class _Ctx:
    """priority.Context, from the case instead of the store."""

    def __init__(self, case):
        self.vips = list(case.get("vips") or [])
        self.goal, self.nudged, self.senders = set(), set(), {}
        self.day_end = DAY_END
        for i, c in enumerate(case["cards"]):
            if c.get("goal"):
                self.goal.add(i + 1)
            if c.get("nudged"):
                self.nudged.add(i + 1)
            if c.get("from"):
                self.senders[i + 1] = [c["from"]]


def _rows(case):
    """(card, task) per case card, as the queue holds them: task ids are positions, card ids the case's ids."""
    out = []
    for i, c in enumerate(case["cards"]):
        t = c.get("task", {})
        task = None
        if t is not None:
            task = {"id": i + 1, "deadline_level": t.get("deadline_level") or 0, "effort_mins": t.get("effort_mins"),
                    "energy": t.get("energy"), "variant_tags": list(t.get("variant_tags") or []),
                    "reschedules": t.get("reschedules") or 0, "expires_at": DAY_END if t.get("expires_today") else None}
        card = {"id": c["id"], "kind": c.get("kind", "task"), "payload": {"reply_draft": True} if c.get("reply_draft") else {}}
        out.append((card, task))
    return out


def replay(case):
    """What the check-in makes of the case's queue: {"order": [ids], "in": [ids], "cats": {id: [cats]}}."""
    level = case["energy"]
    if level not in priority.LEVELS:
        raise FuzzError(f"energy is one of {', '.join(priority.LEVELS)}", "energy")
    ctx = _Ctx(case)
    rows = [(card, task, priority.categories(card, task, ctx), (i,)) for i, (card, task) in enumerate(_rows(case))]
    keys = priority.keys(level, rows)
    order = sorted(keys, key=lambda cid: keys[cid])
    return {"order": order, "in": [cid for cid in order if keys[cid][0] == 0],
            "cats": {card["id"]: sorted(cats) for card, _, cats, _ in rows}}


def check(got, checks):
    """Each check's verdict: [(check, ok)]."""
    pos = {cid: i for i, cid in enumerate(got["order"])}
    out = []
    for c in checks:
        if "in" in c:
            ok = c["in"] in got["in"]
        elif "out" in c:
            ok = c["out"] in pos and c["out"] not in got["in"]
        elif "before" in c:
            a, b = c["before"]
            ok = a in pos and b in pos and pos[a] < pos[b]
        elif "first" in c:
            ok = bool(got["order"]) and got["order"][0] == c["first"]
        elif "cats" in c:
            cid, want = c["cats"]
            ok = set(want) <= set(got["cats"].get(cid, []))
        elif "not_cats" in c:
            cid, want = c["not_cats"]
            ok = not set(want) & set(got["cats"].get(cid, []))
        else:
            raise FuzzError(f"unknown check {c}", "checks")
        out.append((c, ok))
    return out


def run(core, sets="all", against=None, path=None):
    """Replay every priority case and record the run, gated like any other."""
    if sets not in evals.SETS:
        raise FuzzError(f"set is one of {', '.join(evals.SETS)}", "set")
    if sets == "personal":
        raise FuzzError("no personal priority labels yet: run the global set", "set")
    started = time.monotonic()
    todo = evals.global_cases(SURFACE, path=path)
    if not todo:
        raise FuzzError("no priority cases: add eval_seeds/priority.json", "cases")
    results = []
    for c in todo:
        got = replay(c["input"])
        verdicts = check(got, c["expected"]["checks"])
        ok = all(v for _, v in verdicts)
        results.append({"key": c["key"], "case_id": None, "origin": c["origin"], "scope": "global", "kind": c["kind"],
                        "fp": c["fp"], "passes": int(ok), "runs": 1, "passed": ok,
                        "replies": [{"passed": ok, "failed": [json.dumps(ch) for ch, v in verdicts if not v],
                                     "order": got["order"], "today": got["in"], "cats": got["cats"]}]})
    base = evals.get_run(core, against) if against else evals.baseline(core, SURFACE)
    rid = evals.record(core, SURFACE, results, base, skill_version="rules", skill_copy="priority", client="rules",
                       model=None, repeats=1, lessons=learning.lessons_for(core, SURFACE), sets="global",
                       seconds=round(time.monotonic() - started, 2), judge=evals.judge_version(check, replay))
    return evals.get_run(core, rid)


def summary(core, run):
    base = evals.summary(core, run)
    out = {k: base[k] for k in ("run", "set", "passing", "against", "gate", "regressions", "seconds",
                                "changed", "fixed", "broke", "attribution") if k in base}
    out["wrong"] = [{"case": r["origin"], "failed": r["replies"][0]["failed"], "order": r["replies"][0]["order"]}
                    for r in run["results"] if not r["passed"]]
    return out
