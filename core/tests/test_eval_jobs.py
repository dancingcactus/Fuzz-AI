"""Eval runs started from the Evals page: started, tracked, stopped, and the run each one made."""

import json
import os
import threading
import urllib.request

from helpers import CoreCase

from fuzz import eval_jobs, http_api
from fuzz.db import FuzzError


class Jobs(CoreCase):
    def fake(self, pid=None):
        self.spawned = []

        def spawn(argv, env, log):
            self.spawned.append((argv, env))
            return pid or os.getpid()   # a process that's alive for the length of the test
        return spawn

    def record_run(self, surface="extract"):
        return self.core.q("INSERT INTO eval_runs (user_id, ts, surface, repeats, lessons, results, gate_ok) "
                           "VALUES (1, ?, ?, 1, '[]', '[]', 0)", (self.core.now_iso(), surface)).lastrowid

    def test_start_runs_the_right_command_in_the_background(self):
        j = eval_jobs.start(self.core, "dupes", "personal", spawn=self.fake())
        argv, env = self.spawned[0]
        self.assertEqual(argv[-6:], ["eval", "dupes", "--set", "personal", "--job", str(j["id"])])
        self.assertEqual((env["FUZZ_HOME"], env["FUZZ_USER"]), (self.home, "1"))
        self.assertEqual(j["status"], "running")

    def test_one_at_a_time_per_eval(self):
        eval_jobs.start(self.core, "extract", spawn=self.fake())
        with self.assertRaises(FuzzError) as e:
            eval_jobs.start(self.core, "extract", spawn=self.fake())
        self.assertEqual(e.exception.status, 409)
        eval_jobs.start(self.core, "dupes", spawn=self.fake())   # another eval can run alongside

    def test_a_finished_job_points_to_the_run_it_made(self):
        j = eval_jobs.start(self.core, "extract", spawn=self.fake())
        self.record_run("extract")   # an older run doesn't count
        eval_jobs.began(self.core, j["id"])
        rid = self.record_run("extract")
        eval_jobs.finished(self.core, j["id"])
        got = eval_jobs.get(self.core, j["id"])
        self.assertEqual((got["status"], got["run_id"], got["gate_ok"]), ("done", rid, 0))

    def test_a_job_that_made_no_run_failed_with_why(self):
        j = eval_jobs.start(self.core, "draft", spawn=self.fake())
        eval_jobs.began(self.core, j["id"])
        eval_jobs.finished(self.core, j["id"], "FuzzError: no draft cases")
        got = eval_jobs.get(self.core, j["id"])
        self.assertEqual((got["status"], got["error"]), ("failed", "FuzzError: no draft cases"))

    def test_a_process_that_vanished_is_marked_stopped(self):
        j = eval_jobs.start(self.core, "executor", spawn=self.fake(pid=999999))
        [got] = eval_jobs.listing(self.core)
        self.assertEqual((got["id"], got["status"]), (j["id"], "failed"))
        self.assertIn("stopped before it finished", got["error"])

    def test_bad_requests(self):
        with self.assertRaises(FuzzError):
            eval_jobs.start(self.core, "everything", spawn=self.fake())
        with self.assertRaises(FuzzError):
            eval_jobs.start(self.core, "extract", "some", spawn=self.fake())

    def test_the_cli_records_the_end_of_a_job(self):
        from fuzz import cli
        from unittest import mock
        j = eval_jobs.start(self.core, "dupes", "global", spawn=self.fake())
        with mock.patch("builtins.print"):
            cli.main(["--home", self.home, "eval", "dupes", "--set", "global", "--job", str(j["id"])])
        got = eval_jobs.get(self.core, j["id"])
        self.assertEqual(got["status"], "done")
        self.assertIsNotNone(got["run_id"])

    def test_over_http(self):
        srv = http_api.make_server(self.home, port=0, clock=self.clock, ticker=False)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        token = http_api.ensure_token(self.home, 1)
        from unittest import mock

        def req(method, path, body=None):
            r = urllib.request.Request(f"http://127.0.0.1:{srv.server_address[1]}{path}", method=method,
                                       data=json.dumps(body).encode() if body is not None else None)
            r.add_header("Authorization", f"Bearer {token}")
            try:
                with urllib.request.urlopen(r, timeout=10) as resp:
                    return resp.status, json.loads(resp.read())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read())
        with mock.patch.object(eval_jobs.subprocess, "Popen") as popen:
            popen.return_value.pid = os.getpid()
            status, job = req("POST", "/evals/run", {"surface": "dupes"})
            self.assertEqual((status, job["status"]), (200, "running"))
            self.assertEqual(req("POST", "/evals/run", {"surface": "dupes"})[0], 409)
        status, body = req("GET", "/evals")
        self.assertEqual(body["jobs"][0]["id"], job["id"])
        with mock.patch.object(eval_jobs.os, "killpg") as kill:
            status, got = req("POST", f"/evals/jobs/{job['id']}/stop", {})
        self.assertEqual(got["status"], "stopped")
        kill.assert_called_once()
