"""Runs: one row per AI run, so every event it writes knows its client, model and prompt_version."""

import json
import os
from datetime import timedelta

from . import events
from .db import FuzzError, parse_iso

REAP_GRACE_MINUTES = 5    # a run this new is left alone, whatever its pid says
ORPHAN_HOURS = 24         # a run from before pids were recorded is closed after this long


def start(core, role, client, model=None, prompt_version=None, trigger="manual", detail=None):
    """detail gets the pid of the process that owns the run, so reap() can tell a dead run from a long one."""
    detail = dict(detail or {}, pid=os.getpid())
    with core.tx("system"):
        rid = core.q("INSERT INTO runs (user_id, role, client, model, prompt_version, trigger, started_at, detail) "
                     "VALUES (?,?,?,?,?,?,?,?)", (core.user_id, role, client, model, prompt_version, trigger,
                                                  core.now_iso(), json.dumps(detail))).lastrowid
        events.emit(core, "run.started",
                    data={"run_id": rid, "role": role, "client": client, "model": model, "trigger": trigger})
    return rid


def get(core, run_id):
    r = core.one("SELECT * FROM runs WHERE id=? AND user_id=?", (int(run_id), core.user_id))
    if r is None:
        raise FuzzError(f"No run {run_id}", "run_id", 404)
    return r


def attach(core, run_id):
    """Stamp everything this Core writes with the run."""
    r = get(core, run_id)
    core.run = {"id": r["id"], "client": r["client"], "model": r["model"], "prompt_version": r["prompt_version"]}
    return core.run


def finish(core, run_id, outcome, detail=None):
    """detail replaces what start() recorded (the caller passes on what it wants kept)."""
    touched = sorted({r["task_id"] for r in core.all(
        "SELECT DISTINCT task_id FROM events WHERE run_id=? AND task_id IS NOT NULL", (run_id,))})
    d = dict(detail or {}, tasks=touched)
    with core.tx("system"):
        core.q("UPDATE runs SET finished_at=?, outcome=?, detail=? WHERE id=?",
               (core.now_iso(), outcome, json.dumps(d), run_id))
        events.emit(core, "run.finished", data={"run_id": run_id, "outcome": outcome, "tasks": touched})
    return d


def alive(pid):
    """Whether a process with this pid is running on this machine."""
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except (PermissionError, OverflowError, ValueError):
        return True   # it exists but isn't ours, or the pid is junk: leave it to ORPHAN_HOURS
    return True


def reap(core, alive=alive):
    """Close runs whose process died without finishing them (killed, a crash, a restart): their `finally` never
    ran, so they'd look like they were still going forever. Called from the clock. Returns the ids closed."""
    now, closed = core.now(), []
    for r in core.all("SELECT id, started_at, detail FROM runs WHERE user_id=? AND finished_at IS NULL",
                      (core.user_id,)):
        age = now - parse_iso(r["started_at"])
        if age < timedelta(minutes=REAP_GRACE_MINUTES):
            continue
        detail = r["detail"] or {}
        pid = detail.get("pid")
        if (alive(pid) if pid else age < timedelta(hours=ORPHAN_HOURS)):
            continue
        finish(core, r["id"], "abandoned", dict(detail, abandoned="its process ended before it finished"
                                                 if pid else f"no word for {ORPHAN_HOURS} hours"))
        closed.append(r["id"])
    return closed


def last(core, role=None, client=None):
    sql, args = "SELECT * FROM runs WHERE user_id=?", [core.user_id]
    if role:
        sql += " AND role=?"
        args.append(role)
    if client:
        sql += " AND client=?"
        args.append(client)
    return core.one(sql + " ORDER BY id DESC LIMIT 1", args)
