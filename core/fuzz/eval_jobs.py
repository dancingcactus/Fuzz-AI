"""Eval runs started from the Evals page (js/view-evals.js): each is `fuzz eval <op>` in the background, the way
the page's Run button asks for it, tracked in eval_jobs so the page can say what's running and open the run when
it's done. One at a time per eval: two extraction runs at once would race to be each other's baseline.

A job's process records its own end (cli.cmd_eval with --job). One that died without saying so (the machine
slept, it was killed) is marked stopped the next time the list is read.
"""

import os
import re
import signal
import subprocess
import sys

from .db import FuzzError

OPS = {"extract": "run", "dupes": "dupes", "senders": "senders", "draft": "drafts", "executor": "executor",
       "send": "send", "recall": "recall", "dump": "dump", "series_suggest": "series", "priority": "priority"}
NO_MODEL = {"dupes", "senders", "series_suggest", "priority"}   # replays: no model to pin
MODEL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$")   # a model id as a client takes it, one argv item
PKG_PARENT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:   # a finished child we started is a zombie until reaped: reap it, then it's gone
        done, _ = os.waitpid(pid, os.WNOHANG)
        return done == 0
    except ChildProcessError:
        return True


def log_path(core, job_id):
    d = os.path.join(core.home, "eval-jobs")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{job_id}.log")


def settle(core):
    """Jobs whose process is gone without recording its end: stopped."""
    for j in core.all("SELECT id, pid FROM eval_jobs WHERE user_id=? AND status='running'", (core.user_id,)):
        if not _alive(j["pid"]):
            core.q("UPDATE eval_jobs SET status='failed', ended_at=?, error=COALESCE(error, ?) WHERE id=? "
                   "AND status='running'", (core.now_iso(), "It stopped before it finished.", j["id"]))


def start(core, surface, sets="all", spawn=None, model=None, trying=None):
    """Start one eval run in the background. spawn(argv, env, log) -> pid stands in for the process in tests.
    model: the model to run it on (else evals.model, else the role's); trying: a lesson to score (learning.gate)."""
    if surface not in OPS:
        raise FuzzError(f"surface is one of {', '.join(OPS)}", "surface")
    if sets not in ("all", "global", "personal"):
        raise FuzzError("set is all, global or personal", "set")
    model = (model or "").strip() or None
    if model and not MODEL_NAME.match(model):
        raise FuzzError("That doesn't look like a model name", "model")
    if surface in NO_MODEL:
        model = None
    settle(core)
    if core.one("SELECT id FROM eval_jobs WHERE user_id=? AND surface=? AND status='running'", (core.user_id, surface)):
        raise FuzzError("That eval is already running", "surface", 409)
    jid = core.q("INSERT INTO eval_jobs (user_id, surface, sets, status, started_at, model, lesson_id) "
                 "VALUES (?,?,?,?,?,?,?)", (core.user_id, surface, sets, "running", core.now_iso(), model, trying)).lastrowid
    argv = [sys.executable, "-m", "fuzz", "eval", OPS[surface], "--set", sets, "--job", str(jid)]
    if model:
        argv += ["--model", model]
    if trying is not None:
        argv += ["--try", str(trying)]
    env = dict(os.environ, FUZZ_HOME=core.home, FUZZ_USER=str(core.user_id),
               PYTHONPATH=PKG_PARENT + os.pathsep + os.environ.get("PYTHONPATH", ""))
    path = log_path(core, jid)
    if spawn is None:
        log = open(path, "a")
        pid = subprocess.Popen(argv, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True).pid
    else:
        pid = spawn(argv, env, path)
    core.q("UPDATE eval_jobs SET pid=? WHERE id=?", (pid, jid))
    return get(core, jid)


def stop(core, job_id):
    j = get(core, job_id)
    if not j:
        raise FuzzError(f"No eval job {job_id}", "job_id", 404)
    if j["status"] != "running":
        return j
    try:
        os.killpg(j["pid"], signal.SIGTERM)   # its own session: the model client goes too
    except (ProcessLookupError, PermissionError, TypeError):
        pass
    core.q("UPDATE eval_jobs SET status='stopped', ended_at=? WHERE id=? AND status='running'",
           (core.now_iso(), job_id))
    return get(core, job_id)


def began(core, job_id):
    """The job's own process: the newest eval run before it, so finished() can find the one it made."""
    r = core.one("SELECT COALESCE(MAX(id), 0) m FROM eval_runs WHERE user_id=?", (core.user_id,))
    core.q("UPDATE eval_jobs SET after_run=? WHERE id=? AND user_id=?", (r["m"], job_id, core.user_id))


def finished(core, job_id, error=None):
    """The job's own process, at its end: the run it recorded, or why there's none."""
    j = core.one("SELECT * FROM eval_jobs WHERE id=? AND user_id=?", (job_id, core.user_id))
    if not j:
        return
    r = core.one("SELECT id, gate_ok FROM eval_runs WHERE user_id=? AND surface=? AND id>? ORDER BY id DESC LIMIT 1",
                 (core.user_id, j["surface"], j["after_run"] or 0))
    status = "done" if r else "failed"
    core.q("UPDATE eval_jobs SET status=?, ended_at=?, run_id=?, gate_ok=?, error=? WHERE id=? AND status='running'",
           (status, core.now_iso(), r["id"] if r else None, r["gate_ok"] if r else None,
            None if r else (error or "It ended without recording a run.")[:500], job_id))


def models(core):
    """What the Run button offers: the model evals are pinned to (evals.model), the one the roles run on, and
    every model a run has used. None anywhere means the client's default, which a run records as not pinned."""
    ev = core.config.get("evals") or {}
    eng = core.config.get("engine") or {}
    seen = [r["model"] for r in core.all("SELECT model, MAX(id) m FROM eval_runs WHERE user_id=? AND model IS NOT NULL "
                                         "GROUP BY model ORDER BY m DESC", (core.user_id,))]
    return {"pinned": ev.get("model"), "engine": eng.get("model"), "client": ev.get("client") or eng.get("client"),
            "seen": seen}


def get(core, job_id):
    return core.one("SELECT * FROM eval_jobs WHERE user_id=? AND id=?", (core.user_id, job_id))


def listing(core, limit=10):
    """What's running, then the latest few that ended, newest first. A failed one carries its log's last lines."""
    settle(core)
    rows = core.all("SELECT * FROM eval_jobs WHERE user_id=? ORDER BY status='running' DESC, id DESC LIMIT ?",
                    (core.user_id, limit))
    for j in rows:
        if j["status"] == "failed":
            try:
                with open(log_path(core, j["id"])) as f:
                    j["log_tail"] = f.read()[-1500:]
            except OSError:
                j["log_tail"] = None
    return rows
