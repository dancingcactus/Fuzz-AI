"""Slow routes don't hold up the rest of the API, and an unexpected failure is a 500 the page can read."""

import contextlib
import io
import threading
import time
import unittest
from unittest import mock

from test_http import Server

from fuzz import doctor, http_api, tasks


class Slow(Server):
    def test_a_slow_engine_check_doesnt_block_the_queue(self):
        started, release = threading.Event(), threading.Event()

        def slow_status(core, refresh=False, check_start=True):
            started.set()
            release.wait(5)
            return {"engine": {}, "roles": {}, "clients": []}

        with mock.patch.object(doctor, "status", slow_status):
            got = {}
            t = threading.Thread(target=lambda: got.update(engine=self.req("GET", "/engine")))
            t.start()
            self.assertTrue(started.wait(5))
            t0 = time.monotonic()
            status, _ = self.req("GET", "/cards")
            self.assertEqual(status, 200)
            self.assertLess(time.monotonic() - t0, 2, "answered while the engine check was still going")
            release.set()
            t.join(5)
        self.assertEqual(got["engine"][0], 200)

    def test_every_unlocked_route_exists(self):
        app = http_api.App(self.home)
        names = {h.__name__ for _, _, h, locked in app.routes() if not locked}
        self.assertEqual(names, set(http_api.UNLOCKED))

    def test_an_unlocked_route_works_on_its_own_connection(self):
        """GET /setup answers from a connection of its own, beside a write on the shared one."""
        self.assertEqual(self.req("POST", "/tasks", {"text": "Write the plan"})[0], 201)
        status, out = self.req("GET", "/setup?check=0")
        self.assertEqual(status, 200)
        self.assertIn("tools", out)


class Errors(Server):
    def test_an_unexpected_error_is_a_500_with_a_reason(self):
        with mock.patch.object(tasks, "list_tasks", side_effect=RuntimeError("disk on fire")), \
                contextlib.redirect_stderr(io.StringIO()) as err:
            status, out = self.req("GET", "/tasks")
        self.assertEqual(status, 500)
        self.assertTrue(out["internal"])
        self.assertIn("disk on fire", out["error"])
        self.assertIn("RuntimeError", err.getvalue(), "the traceback is in the server's log")
        self.assertEqual(self.req("GET", "/cards")[0], 200, "and the server keeps going")

    def test_a_bad_value_is_still_a_400(self):
        status, out = self.req("POST", "/tasks/abc/done")
        self.assertIn(status, (404, 405))
        status, out = self.req("PUT", "/engine", {})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
