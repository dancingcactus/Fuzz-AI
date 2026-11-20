"""Series evals: does Fuzz suggest the next steps in a series that it should, and only those? (docs/series.md,
"Suggesting new tasks"; docs/evals.md)

No model: suggestions are rules (series/suggest.py), so both sets replay and give the same answer every run.

Personal: every answer on a "Next in …" card is a case (series/ask.py): Add it or I'll do it is wanted, Not
needed isn't. A case passes when, with the lessons given, the suggestion would be shown (wanted) or hidden (not
needed). Lessons from Not needed (learning/learners/series.py) hide a kind of suggestion in one series, so this
is how one is tested before it goes live: it may fix Not needed cases, and must never hide one you took.

Global: an invented series in a store of its own, at the case's own "now", run through suggest.run itself (the
detectors, your part, mute, the weekly limits and quiet lessons). A case's input:
  {"now", "series": {"name", "role"?: drive|contribute|follow, "muted"?, "met"? (default true),
                     "next_milestone"?, "done_when"?},
   "tasks": [{"title", "days_ago", "state"?: waiting|done, "waiting_on"?, "deliverable"?: index}],
   "deliverables"?: [{"title", "due_in_days", "tier"?}], "decisions"?: [{"what", "days_ago"}],
   "quiet"?: [detector]}
Checks, all of which must hold:
  {"suggests": detector}      a "Next in …" card of this kind came out
  {"not_suggests": detector}  none did
  {"count": n}                this many came out
  {"title_has": [words]}      some card's title holds one of these
"""

import json
import shutil
import tempfile
import time
from datetime import timedelta

from . import config as config_mod, evals, learning
from .db import Core, FuzzError, iso, parse_iso

SURFACE = "series_suggest"


# ---- personal: your answers, replayed through the lessons

def _series_id(core, inp):
    """The series a case's card was in: recorded since cards carried it, else found by its name."""
    if inp.get("series_id"):
        return inp["series_id"]
    r = core.one("SELECT id FROM series WHERE user_id=? AND name=? ORDER BY id DESC LIMIT 1", (core.user_id, inp.get("series")))
    return r["id"] if r else None


def shown(core, inp, lessons):
    """Would this suggestion be shown with these lessons? A quiet lesson for its series and kind hides it."""
    sid = _series_id(core, inp)
    quiet = {x.get("key") or "" for x in lessons}
    return not (sid and f"series:{sid}:{inp.get('detector')}" in quiet)


def _lesson_rows(core, lessons):
    """The lessons as rows with their keys (a run records id, kind, rule; the key says series and kind)."""
    ids = [x["id"] for x in lessons if x.get("id")]
    if not ids:
        return []
    return core.all(f"SELECT id, key, kind, rule, case_id, example FROM lessons WHERE user_id=? AND id IN ({','.join('?' * len(ids))})",
                    (core.user_id, *ids))


# ---- global: an invented series, in a store of its own

class _Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


def build(case):
    """A fresh store holding the case's series as it stands at its "now". Returns (home, core, series id, clock)."""
    from . import deliverables, tasks
    from .memory import facts, knowledge
    from .series import record
    w = case["input"]
    now = parse_iso(w["now"])
    oldest = max([t.get("days_ago", 0) for t in w.get("tasks", [])] + [d.get("days_ago", 0) for d in w.get("decisions", [])] + [0])
    clock = _Clock(now - timedelta(days=oldest + 1))
    home = tempfile.mkdtemp(prefix="fuzz-series-eval-")
    cfg = config_mod.load(home)
    cfg.update(me={"names": ["Alex Chen"], "emails": ["alex@acme.example"]}, embedder="hash", tz="UTC",
               evals={"spot_checks_per_week": 0, "run_checks_per_week": 0, "test_lessons": False})
    config_mod.save(home, cfg)
    core = Core(home, 1, clock=clock)
    try:
        ids = []
        for t in sorted(w.get("tasks", []), key=lambda t: -t.get("days_ago", 0)):
            clock.t = now - timedelta(days=t.get("days_ago", 0))
            tid = tasks.capture(core, t["title"])
            if t.get("state") == "waiting":
                tasks.wait(core, tid, t.get("waiting_on"))
            elif t.get("state") == "done":
                tasks.done(core, tid)
            ids.append((t, tid))
        clock.t = now - timedelta(days=oldest)
        s = w["series"]
        with core.tx("human"):
            from . import events
            ch = events.Changes()
            sid = record.make(core, ch, s["name"], state="named", origin="asked", task_ids=[tid for _, tid in ids])
            events.emit(core, "series.named", changes=ch, data={"series_id": sid})
        if not s.get("met", True):
            core.q("UPDATE series SET met=0 WHERE id=?", (sid,))
        eid = record.get(core, sid)["entity_id"]
        if s.get("role"):
            record.set_role(core, sid, s["role"])
        for attr in ("next_milestone", "done_when"):
            if s.get(attr):
                facts.edit(core, eid, attr, s[attr])
        for i, d in enumerate(w.get("deliverables", [])):
            members = [tid for t, tid in ids if t.get("deliverable") == i]
            deliverables.create(core, d["title"], d.get("done_when") or f"{d['title']} is out", task_ids=members,
                                due=iso(now + timedelta(days=d["due_in_days"])), tier=d.get("tier", "active"))
        for d in w.get("decisions", []):
            clock.t = now - timedelta(days=d["days_ago"])
            did, _ = knowledge.add_decision(core, d["what"], decided_at=core.now_iso(), how="stated",
                                            links=[("series", "series", sid)])
            knowledge.record_decision(core, did)
        if s.get("muted"):
            record.mute(core, sid)
        for det in w.get("quiet", []):   # a lesson from Not needed, live
            lid = core.new_id("lessons")
            core.q("INSERT INTO lessons (id, user_id, key, surface, kind, rule, status, how, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                   (lid, 1, f"series:{sid}:{det}", SURFACE, "rule", f"No {det} in {s['name']}", "active", "inferred", core.now_iso()))
        clock.t = now
        return home, core, sid, clock
    except Exception:
        core.close()
        shutil.rmtree(home, ignore_errors=True)
        raise


def play(case):
    """The cards suggest.run raises for the case's series: [{detector, title}]."""
    from .series import suggest
    home, core, sid, _ = build(case)
    try:
        suggest.run(core)
        return [{"detector": (c.get("payload") or {}).get("detector"), "title": (c.get("payload") or {}).get("title")}
                for c in core.all("SELECT * FROM cards WHERE user_id=1 AND kind='series_next' ORDER BY id")]
    finally:
        core.close()
        shutil.rmtree(home, ignore_errors=True)


def check(got, checks):
    kinds = [g["detector"] for g in got]
    out = []
    for c in checks:
        if "suggests" in c:
            ok = c["suggests"] in kinds
        elif "not_suggests" in c:
            ok = c["not_suggests"] not in kinds
        elif "count" in c:
            ok = len(got) == c["count"]
        elif "title_has" in c:
            ok = any(w.lower() in (g["title"] or "").lower() for g in got for w in c["title_has"])
        else:
            raise FuzzError(f"unknown check {c}", "checks")
        out.append((c, ok))
    return out


# ---- a run

def run(core, sets="all", lessons=None, against=None, trying=None, path=None):
    """Score the personal outcomes with the lessons (the active ones, plus the one tried) and play the global
    series. Recorded and gated like any run; a lesson tried takes the result."""
    if sets not in evals.SETS:
        raise FuzzError(f"set is one of {', '.join(evals.SETS)}", "set")
    evals.sweep(core)
    started = time.monotonic()
    if lessons is None:
        rows = core.all("SELECT id, key, kind, rule, case_id, example FROM lessons WHERE user_id=? AND surface=? AND status='active'",
                        (core.user_id, SURFACE))
        if trying is not None:
            t = learning.get(core, trying)
            if not t or t["surface"] != SURFACE:
                raise FuzzError(f"no {SURFACE} lesson {trying}", "lesson")
            rows = [x for x in rows if x["id"] != trying] + [{k: t[k] for k in ("id", "key", "kind", "rule", "case_id", "example")}]
        lessons = rows
    else:
        lessons = _lesson_rows(core, lessons) or lessons
    results = []
    if sets in ("all", "personal"):
        for c in evals.cases(core, SURFACE):
            if c["kind"] not in ("wanted", "not_needed"):
                continue
            got = shown(core, c["input"], lessons)
            ok = got == bool(c["expected"].get("wanted"))
            results.append({"key": f"case:{c['id']}", "case_id": c["id"], "origin": c["origin"], "scope": "personal",
                            "kind": c["kind"], "fp": c["fp"], "passes": int(ok), "runs": 1, "passed": ok,
                            "replies": [{"passed": ok, "shown": got}]})
    if sets in ("all", "global"):
        for c in evals.global_cases(SURFACE, path=path):
            got = play(c)
            verdicts = check(got, c["expected"]["checks"])
            ok = all(v for _, v in verdicts)
            results.append({"key": c["key"], "case_id": None, "origin": c["origin"], "scope": "global", "kind": c["kind"],
                            "fp": c["fp"], "passes": int(ok), "runs": 1, "passed": ok,
                            "replies": [{"passed": ok, "failed": [json.dumps(ch) for ch, v in verdicts if not v],
                                         "suggested": got}]})
    if not results:
        raise FuzzError("no series cases: answer a few “Next in …” cards, or add eval_seeds/series_suggest.json", "cases")
    base = evals.get_run(core, against) if against else evals.baseline(core, SURFACE)
    rid = evals.record(core, SURFACE, results, base, skill_version="rules", skill_copy="series", client="rules",
                       model=None, repeats=1, lessons=[{k: x.get(k) for k in ("id", "kind", "rule", "key")} for x in lessons],
                       sets=sets, seconds=round(time.monotonic() - started, 2), judge=evals.judge_version(check, shown))
    out = evals.get_run(core, rid)
    if trying is not None:
        learning.scored(core, [trying], rid, bool(out["gate_ok"]))
    return out


def summary(core, run):
    base = evals.summary(core, run)
    out = {k: base[k] for k in ("run", "set", "passing", "against", "gate", "regressions", "seconds",
                                "changed", "fixed", "broke", "attribution") if k in base}
    out["wrong"] = [{"case": r["origin"], **{k: v for k, v in r["replies"][0].items() if k != "passed"}}
                    for r in run["results"] if not r["passed"]]
    return out
