"""config.json is shared by fuzz serve, the CLI and launchd's role runs: a change can't drop another's."""

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from fuzz import config

CORE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class ConfigWrites(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        config.save(self.home, config.load(self.home))

    def test_an_update_waits_for_the_one_in_progress_and_keeps_its_change(self):
        started = threading.Event()

        def slow(cfg):   # holds the lock while the other writer tries
            started.set()
            time.sleep(0.3)
            cfg["budget"] = dict(cfg["budget"], max_working=7)

        t = threading.Thread(target=config.update, args=(self.home, slow))
        t.start()
        started.wait()
        config.update(self.home, lambda cfg: cfg.update(tz="Europe/Oslo"))
        t.join()
        cfg = config.load(self.home)
        self.assertEqual((cfg["budget"]["max_working"], cfg["tz"]), (7, "Europe/Oslo"))

    def test_another_process_waits_too(self):
        script = ("import sys; sys.path.insert(0, sys.argv[2]); from fuzz import config; "
                  "config.update(sys.argv[1], lambda c: c.update(tz='Asia/Tokyo'))")
        started = threading.Event()

        def slow(cfg):
            started.set()
            time.sleep(0.5)
            cfg["embedder"] = "hash"

        t = threading.Thread(target=config.update, args=(self.home, slow))
        t.start()
        started.wait()
        p = subprocess.run([sys.executable, "-c", script, self.home, CORE], capture_output=True, text=True, timeout=30)
        t.join()
        self.assertEqual(p.returncode, 0, p.stderr)
        cfg = config.load(self.home)
        self.assertEqual((cfg["embedder"], cfg["tz"]), ("hash", "Asia/Tokyo"))

    def test_many_writers_at_once_all_land_and_leave_no_temp_files(self):
        def bump(i):
            config.update(self.home, lambda cfg: cfg.setdefault("seen", []).append(i))
        threads = [threading.Thread(target=bump, args=(i,)) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(config.load(self.home)["seen"]), list(range(20)))
        self.assertEqual([f for f in os.listdir(self.home) if f.endswith(".tmp")], [])
        with open(os.path.join(self.home, "config.json")) as f:
            json.load(f)   # whole, never half-written

    def test_update_returns_what_fn_returns(self):
        self.assertEqual(config.update(self.home, lambda cfg: cfg["budget"]["max_working"]),
                         config.load(self.home)["budget"]["max_working"])
