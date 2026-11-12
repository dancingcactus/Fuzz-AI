"""What a command starts once it has committed: an executor run, the sender, the kickoff's discovery.

Commands (actions.py) return follow-ups instead of starting runs themselves, and every interface hands
them to run(), so an answer starts the same work whether it came from the UI, the CLI or an AI role.
Run them after the command's transaction commits, never inside it.

A follow-up is a dict with a "kind":
  gather         start the executor if a task is waiting to be gathered (throttled)
  find_out       start the executor on task_id now, unless a run is going (it claims the task next)
  group_run      start the executor for a collected group's claim, unless a run is going
  executor_task  start the executor on task_id whatever is running (a working session handed it to Fuzz)
  discover       the onboarding kickoff: ask client what it can reach, then one permission card per source

The UI still starts some runs itself (POST /engine/run after Assign, Nudge and the like; see js/live.js).
"""

import time
from datetime import timedelta

from . import config, connectors, engine, files, onboarding, scheduler
from .db import iso

GATHER_KICK_SECONDS = 30
GATHER_RETRY_SECONDS = 180
SEND_KICK_SECONDS = 120

KINDS = ("gather", "find_out", "group_run", "executor_task", "discover")


def _engine(core, role):
    return config.role_engine(core.config, role)[0]


def gathers_waiting(core):
    return any(scheduler.gathering(t) and not files.waiting(core, t) for t in core.all(
        "SELECT * FROM tasks WHERE user_id=? AND state='queued' AND assignee='fuzz'", (core.user_id,)))


def executor_running(core):
    """A run that started within a lease and hasn't finished: it claims gather tasks first, so it gets there."""
    since = core.now() - timedelta(minutes=core.config["budget"]["lease_minutes"])
    return bool(core.one("SELECT COUNT(*) n FROM runs WHERE user_id=? AND role='executor' AND finished_at IS NULL "
                         "AND started_at > ?", (core.user_id, iso(since)))["n"])


def kick_executor(core, kicked, now=None, wait=None):
    """Start the executor as soon as you capture a task, so it can gather context before you see the card.
    Not when a run is already going, and not twice within wait seconds: the clock retries less often.
    kicked: user id -> when this user's executor was last kicked (the caller keeps it between calls)."""
    now = now or time.time()
    if not gathers_waiting(core) or not _engine(core, "executor") or executor_running(core):
        return False
    if now - kicked.get(core.user_id, 0) < (wait or GATHER_KICK_SECONDS):
        return False
    kicked[core.user_id] = now
    engine.run_now(core, "executor")
    return True


def kick_sender(core, kicked, now=None):
    """Start the sender soon after you approve a draft, instead of waiting for launchd. At most one
    start every two minutes per user; a second sender would find nothing to claim anyway."""
    now = now or time.time()
    if not scheduler.sends_waiting(core) or not _engine(core, "sender"):
        return False
    if now - kicked.get(core.user_id, 0) < SEND_KICK_SECONDS:
        return False
    kicked[core.user_id] = now
    engine.run_now(core, "sender")
    return True


def start_find_out(core, task_id):
    """Find out… starts an executor run on that task now. One already running claims it next (gathering goes
    first), so no second run is started."""
    if not _engine(core, "executor") or executor_running(core):
        return False
    engine.run_now(core, "executor", task_id)
    return True


def start_group_run(core):
    """A group was collected: start an executor run for its claim, unless one is going (it claims next)."""
    if not _engine(core, "executor") or executor_running(core):
        return False
    if not scheduler.work_waiting(core):
        return False
    engine.run_now(core, "executor")
    return True


def start_task(core, task_id):
    """A working session handed the task to Fuzz: start now rather than at the next scheduled run.
    Never fails the command that asked: it still runs on schedule."""
    try:
        if _engine(core, "executor"):
            engine.run_now(core, "executor", task_id)
            return True
    except Exception:
        pass
    return False


def discover(core, task_id, client):
    """The kickoff's one run of the client (slow), then a permission card per source. Takes the lock itself."""
    err = None
    try:
        connectors.discover(core, client)
    except Exception as e:   # said on the task, which comes back to you
        err = str(e)
    with core.lock:
        onboarding.after_discovery(core, task_id, err)


def _now(fn):
    fn()


def run(core, follow, kicked=None, background=None):
    """Start each follow-up. kicked: the executor kick throttle (see kick_executor); a fresh one when
    None. background(fn): how slow work runs; by default at once, in this thread (the CLI)."""
    kicked = {} if kicked is None else kicked
    background = background or _now
    for f in follow or ():
        kind = f["kind"]
        if kind == "gather":
            kick_executor(core, kicked)
        elif kind == "find_out":
            start_find_out(core, f["task_id"])
        elif kind == "group_run":
            start_group_run(core)
        elif kind == "executor_task":
            start_task(core, f["task_id"])
        elif kind == "discover":
            background(lambda f=f: discover(core, f["task_id"], f["client"]))
        else:
            raise ValueError(f"Unknown follow-up {kind!r}; one of {', '.join(KINDS)}")
