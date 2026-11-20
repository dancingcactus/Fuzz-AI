"""The run every played eval shares (executor, send, recall): each case played `repeats` times through a model,
checked, passed on a majority, then recorded and gated like any eval run.

A surface brings what's its own: how a case is played (its store, its tools, the turn prompt), how a record is
checked, and what of a reply is kept for reading a failure.
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor

from . import evals
from .db import FuzzError


def run_played(core, surface, role, skill, play, check, keep, judge, repeats=2, runner=None, client=None,
               model=None, against=None, ref=None, path=None, workers=4):
    """surface: the eval surface (its cases are eval_seeds/<surface>.json). role: whose engine plays it.
    skill: the SKILL.md's name. play(case, skill_text, call) -> record, a list of {tool, args, result}.
    check(case, record) -> [(check, ok)]. keep(record) -> what a reply keeps beside passed/failed/calls.
    judge: the functions whose code decides a pass (evals.judge_version), so a change to them is a new judge.
    runner(prompt) stands in for a model in tests, one call at a time."""
    client, model, adapter = evals.engine(core, role, client, model, runner)
    text, version, copy = evals.skill_at(skill, ref)
    todo = evals.global_cases(surface, path=path)
    if not todo:
        raise FuzzError(f"no {surface} cases in eval_seeds/{surface}.json", "cases")

    def call(p):
        return evals._call_model(core, adapter, model, runner, 1, [p])[0]

    started = time.monotonic()
    jobs = [c for c in todo for _ in range(repeats)]
    with ThreadPoolExecutor(max_workers=1 if runner else workers) as pool:
        records = list(pool.map(lambda c: play(c, text, call), jobs))
    results = {}
    for c, rec in zip(jobs, records):
        verdicts = check(c, rec)
        ok = all(v for _, v in verdicts)
        r = results.setdefault(c["key"], {"key": c["key"], "case_id": None, "origin": c["origin"], "scope": "global",
                                          "kind": c["kind"], "fp": c["fp"], "passes": 0, "runs": 0, "replies": []})
        r["runs"] += 1
        r["passes"] += ok
        r["replies"].append({"passed": ok, "failed": [json.dumps(ch) for ch, v in verdicts if not v],
                             "calls": [x["tool"] for x in rec], **keep(rec)})
    for r in results.values():
        r["passed"] = r["passes"] * 2 > r["runs"]
    base = evals.get_run(core, against) if against else evals.baseline(core, surface)
    rid = evals.record(core, surface, list(results.values()), base, skill_version=version, skill_copy=copy,
                       client=client if runner is None else "stub", model=model, repeats=repeats, lessons=[],
                       sets="global", seconds=round(time.monotonic() - started, 1), judge=evals.judge_version(*judge))
    return evals.get_run(core, rid)
