"""The splitter as a run: counted in usage like any role, and a run that ends without a split leaves the dump safe."""

from unittest import mock

from helpers import CoreCase

from fuzz import config, dump, runner, usage

TEXT = "send the budget numbers\ncall the dentist\nsomeday learn to bake bread"


class SplitRuns(CoreCase):
    def setUp(self):
        super().setUp()
        cfg = self.core.config
        cfg["engine"] = {"client": "claude-code", "model": None}
        self.core.save_config(cfg)

    def test_the_split_runs_on_the_engine_with_its_own_time_limit(self):
        self.assertEqual(config.role_engine(self.core.config, "split")[0], "claude-code")
        self.assertEqual(config.run_minutes(self.core.config, "split"), 5)

    def test_a_split_run_is_counted_in_usage_under_its_own_role(self):
        did = dump.start(self.core, TEXT)

        def fake(core, adapter, role, rid, model, task_id, verbose, say, ask=None):
            usage.record(core, rid, {"input_tokens": 100, "output_tokens": 20, "cost_usd": 0.01})
            dump.submit(core, int(ask[0]), [{"group": "task", "text": "Send the budget numbers"}])
            return "ok", {}
        with mock.patch("fuzz.runner._headless", fake):
            out = runner.run_role(self.core, "split", ask=(str(did), ""))
        self.assertEqual(out["outcome"], "ok")
        v = dump.view(self.core, did)
        self.assertEqual((v["state"], len(v["task_ids"])), ("committed", 1), "the split is made at once")
        self.assertEqual(v["text"], TEXT, "and the original is kept")
        today = usage.daily(self.core, days=1)["days"][0]["clients"]["claude-code"]
        self.assertEqual(today["roles"]["split"]["runs"], 1)
        self.assertEqual(today["roles"]["split"]["measured"], 1)

    def test_a_run_that_ends_without_a_split_marks_the_dump_failed_and_keeps_the_words(self):
        did = dump.start(self.core, TEXT)
        with mock.patch("fuzz.runner._headless", lambda *a, **k: ("error", {"error": "the client stopped"})):
            runner.run_role(self.core, "split", ask=(str(did), ""))
        v = dump.view(self.core, did)
        self.assertEqual(v["state"], "failed")
        self.assertEqual(v["text"], TEXT)

    def test_a_split_run_needs_its_dump(self):
        from fuzz.db import FuzzError
        with self.assertRaises(FuzzError):
            runner.run_role(self.core, "split")

    def test_the_headless_command_names_the_dump_and_never_the_text(self):
        from fuzz import adapters
        did = dump.start(self.core, "the secret plan about Priya\nand more\nand more")
        for name in ("claude-code", "copilot"):
            a = adapters.get(name)
            argv = a.headless_command("split", "/tmp/x.json", ask=(str(did), ""))
            joined = " ".join(argv)
            self.assertIn(f"dump_id: {did}", joined)
            self.assertNotIn("secret plan", joined, "the dump is read with get_dump, as data, not put in the prompt")
