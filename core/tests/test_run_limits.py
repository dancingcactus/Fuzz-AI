"""A client run that hangs is stopped at its limit, and a run whose process died is closed by the clock."""

import os
import subprocess
import sys
import threading
import time
import unittest

from helpers import CoreCase

from fuzz import actions, config, followups, runner, runs


class Watch(unittest.TestCase):
    def _proc(self):
        return subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)

    def test_a_run_past_its_limit_is_stopped(self):
        p, stopped = self._proc(), threading.Event()
        t0 = time.monotonic()
        runner.watch(p, 0.2, stopped, poll=0.05, grace=2)
        self.assertTrue(stopped.is_set())
        self.assertIsNotNone(p.poll(), "the process is gone")
        self.assertLess(time.monotonic() - t0, 5)

    def test_one_that_ignores_sigterm_gets_sigkill(self):
        p = subprocess.Popen([sys.executable, "-c",
                              "import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('ready', flush=True); time.sleep(60)"],
                             start_new_session=True, stdout=subprocess.PIPE, text=True)
        self.addCleanup(p.stdout.close)
        p.stdout.readline()   # the handler is in place
        stopped = threading.Event()
        runner.watch(p, 0, stopped, poll=0.05, grace=0.3)
        self.assertEqual(p.wait(timeout=5), -9)

    def test_a_run_inside_its_limit_is_left_alone(self):
        p = subprocess.Popen([sys.executable, "-c", "pass"], start_new_session=True)
        stopped = threading.Event()
        runner.watch(p, 30, stopped, poll=0.05)
        self.assertFalse(stopped.is_set())
        self.assertEqual(p.wait(), 0)

    def test_the_clock_is_time_awake(self):
        """The limit counts the clock it's given (monotonic: a Mac asleep doesn't count), not the wall clock."""
        p, stopped, now = self._proc(), threading.Event(), [0.0]
        try:
            def clock():
                now[0] += 1
                return now[0]
            runner.watch(p, 200, stopped, clock=clock, poll=0.001)   # 200 ticks of a clock that isn't the wall's
            self.assertTrue(stopped.is_set())
        finally:
            p.kill()


class Limits(CoreCase):
    def test_each_role_has_a_limit(self):
        for role in ("executor", "extractor", "sender", "ask"):
            self.assertGreater(config.run_minutes(self.core.config, role), 0)
        self.core.update_config(lambda c: c["budget"]["run_minutes"].update(executor=5))
        self.assertEqual(config.run_minutes(self.core.config, "executor"), 5)

    def test_an_executor_counts_as_running_until_its_limit(self):
        runs.start(self.core, "executor", "scripted")
        self.clock.advance(minutes=config.run_minutes(self.core.config, "executor") - 1)
        self.assertTrue(followups.executor_running(self.core))
        self.clock.advance(minutes=2)
        self.assertFalse(followups.executor_running(self.core))


class Reap(CoreCase):
    def test_a_run_records_its_pid(self):
        rid = runs.start(self.core, "executor", "scripted", detail={"task": 3})
        self.assertEqual(runs.get(self.core, rid)["detail"], {"task": 3, "pid": os.getpid()})

    def test_a_run_whose_process_died_is_closed(self):
        rid = runs.start(self.core, "extractor", "copilot")
        self.clock.advance(minutes=runs.REAP_GRACE_MINUTES + 1)
        self.assertEqual(runs.reap(self.core, alive=lambda pid: False), [rid])
        r = runs.get(self.core, rid)
        self.assertEqual(r["outcome"], "abandoned")
        self.assertIsNotNone(r["finished_at"])
        self.assertEqual(r["detail"]["pid"], os.getpid())
        self.assertEqual(runs.reap(self.core, alive=lambda pid: False), [], "closed once")

    def test_a_live_run_is_left_however_long(self):
        rid = runs.start(self.core, "ask", "chat")
        self.clock.advance(days=3)
        self.assertEqual(runs.reap(self.core, alive=lambda pid: True), [])
        self.assertIsNone(runs.get(self.core, rid)["finished_at"])

    def test_a_new_run_is_left_whatever_its_pid(self):
        runs.start(self.core, "executor", "scripted")
        self.assertEqual(runs.reap(self.core, alive=lambda pid: False), [])

    def test_a_run_without_a_pid_is_closed_after_a_day(self):
        rid = runs.start(self.core, "extractor", "copilot")
        with self.core.tx("system"):
            self.core.q("UPDATE runs SET detail='{}' WHERE id=?", (rid,))
        self.clock.advance(hours=runs.ORPHAN_HOURS - 1)
        self.assertEqual(runs.reap(self.core), [])
        self.clock.advance(hours=2)
        self.assertEqual(runs.reap(self.core), [rid])

    def test_the_clock_reaps(self):
        rid = runs.start(self.core, "executor", "scripted")
        with self.core.tx("system"):
            self.core.q("UPDATE runs SET detail=? WHERE id=?", ('{"pid": 999999999}', rid))
        self.clock.advance(minutes=runs.REAP_GRACE_MINUTES + 1)
        self.assertEqual(actions.tick(self.core)["runs_reaped"], [rid])


if __name__ == "__main__":
    unittest.main()
