"""What a role run used: reading each client's report, the backfill from old transcripts, and the daily totals."""

import json
import os
import unittest

from helpers import CoreCase

from fuzz import runs, usage

COPILOT_FOOTER = """Nothing is queued for Fuzz.



Changes    +0 -0
AI Credits 7.89 (42s)
Tokens     ↑ 89.9k (61.6k cached, 22.2k written) • ↓ 510 (75 reasoning)
Resume     copilot --resume=00000000-0000-0000-0000-000000000000
"""

COPILOT_LONG = """Done.

Changes    +0 -0
AI Credits 1,179.26 (1h 11m 48s)
Tokens     ↑ 4.0m (3.7m cached, 365.8k written) • ↓ 47.1k
"""

CLAUDE_RESULT = {"type": "result", "subtype": "success", "is_error": False, "duration_ms": 61500, "result": "Done.",
                 "total_cost_usd": 0.4213,
                 "usage": {"input_tokens": 120, "cache_read_input_tokens": 50000, "cache_creation_input_tokens": 8000,
                           "output_tokens": 900}}


class Parsing(unittest.TestCase):
    def test_copilot_footer(self):
        u = usage.parse("copilot", COPILOT_FOOTER)
        self.assertEqual(u["credits"], 7.89)
        self.assertEqual(u["seconds"], 42)
        self.assertEqual((u["in"], u["cached"], u["written"], u["out"], u["reasoning"]), (89900, 61600, 22200, 510, 75))
        self.assertIsNone(u["cost_usd"])

    def test_copilot_hours_thousands_and_no_reasoning(self):
        u = usage.parse("copilot", COPILOT_LONG)
        self.assertEqual(u["credits"], 1179.26)
        self.assertEqual(u["seconds"], 3600 + 11 * 60 + 48)
        self.assertEqual((u["in"], u["cached"], u["out"]), (4_000_000, 3_700_000, 47100))
        self.assertIsNone(u["reasoning"])

    def test_copilot_without_a_footer(self):
        self.assertIsNone(usage.parse("copilot", "It stopped before the end.\n"))
        self.assertIsNone(usage.parse("copilot", None))

    def test_claude_json_counts_cache_as_part_of_input(self):
        u = usage.parse("claude-code", json.dumps(CLAUDE_RESULT))
        self.assertEqual(u["cost_usd"], 0.4213)
        self.assertEqual(u["in"], 120 + 50000 + 8000)
        self.assertEqual((u["cached"], u["written"], u["out"], u["seconds"]), (50000, 8000, 900, 62))
        self.assertIsNone(u["credits"])

    def test_claude_stream_json_reads_the_last_result(self):
        lines = [json.dumps({"type": "system"}), json.dumps({"type": "assistant", "message": {}}), json.dumps(CLAUDE_RESULT)]
        self.assertEqual(usage.parse("claude-code", "\n".join(lines))["cost_usd"], 0.4213)

    def test_claude_plain_text_and_unknown_clients_say_nothing(self):
        self.assertIsNone(usage.parse("claude-code", "Done.\n"))
        self.assertIsNone(usage.parse("scripted", COPILOT_FOOTER))


class Recorded(CoreCase):
    def run_at(self, client, role="executor", transcript=None, finished=True):
        rid = runs.start(self.core, role, client)
        if transcript is not None:
            d = os.path.join(self.home, "runs", str(rid))
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "transcript.log"), "w") as f:
                f.write(transcript)
        if finished:
            runs.finish(self.core, rid, "ok")
        return rid

    def stored(self, rid):
        v = self.core.one("SELECT usage FROM runs WHERE id=?", (rid,))["usage"]
        return json.loads(v) if v else None

    def test_backfill_reads_old_transcripts_once(self):
        a = self.run_at("copilot", transcript="x" * 50000 + COPILOT_FOOTER)   # the footer is past the tail's start
        b = self.run_at("copilot", transcript="It stopped.\n")
        c = self.run_at("copilot")                                           # its folder is gone
        d = self.run_at("copilot", transcript=COPILOT_FOOTER, finished=False)  # still running
        self.assertEqual(usage.backfill(self.core), 3)
        self.assertEqual(self.stored(a)["credits"], 7.89)
        self.assertEqual(self.stored(b), usage.NONE)
        self.assertEqual(self.stored(c), usage.NONE)
        self.assertIsNone(self.stored(d))
        self.assertEqual(usage.backfill(self.core), 0)   # nothing read twice

    def test_daily_totals_per_client_and_role(self):
        self.run_at("copilot", "extractor", COPILOT_FOOTER)
        self.run_at("copilot", "executor", COPILOT_FOOTER)
        self.run_at("claude-code", "executor", json.dumps(CLAUDE_RESULT))
        self.run_at("copilot", "sender", "no footer\n")
        self.clock.advance(days=1)
        self.run_at("copilot", "extractor", COPILOT_LONG)
        out = usage.daily(self.core, 7)
        self.assertEqual(len(out["days"]), 7)
        today, yesterday = out["days"][0], out["days"][1]
        self.assertEqual(today["date"], "2026-10-21")
        self.assertEqual(today["clients"]["copilot"]["total"]["credits"], 1179.26)
        cp = yesterday["clients"]["copilot"]
        self.assertEqual((cp["total"]["runs"], cp["total"]["measured"]), (3, 2))
        self.assertEqual(cp["total"]["credits"], 15.78)
        self.assertEqual(cp["roles"]["extractor"]["credits"], 7.89)
        self.assertEqual(cp["roles"]["sender"]["measured"], 0)
        self.assertEqual(yesterday["clients"]["claude-code"]["total"]["cost_usd"], 0.4213)
        self.assertEqual(out["days"][2]["clients"], {})                 # a day without runs is still there
        self.assertEqual(out["totals"]["copilot"]["credits"], 1195.04)  # credits and dollars stay apart
        self.assertNotIn("credits", [k for k, v in out["totals"]["claude-code"].items() if v])

    def test_days_are_local(self):
        cfg = self.core.config
        cfg["tz"] = "America/Denver"
        from fuzz import config
        config.save(self.home, cfg)
        # 09:00 UTC on the 20th is 03:00 in Denver, the 20th; 03:00 UTC on the 21st is the evening of the 20th
        self.run_at("copilot", transcript=COPILOT_FOOTER)
        self.clock.advance(hours=18)
        self.run_at("copilot", transcript=COPILOT_FOOTER)
        out = usage.daily(self.core, 2)
        self.assertEqual(out["days"][0]["date"], "2026-10-20")
        self.assertEqual(out["days"][0]["clients"]["copilot"]["total"]["runs"], 2)

    def test_recent_hides_the_none_marker(self):
        self.run_at("copilot", transcript="nothing\n")
        rid = self.run_at("copilot", transcript=COPILOT_FOOTER)
        r = usage.recent(self.core, 5)
        self.assertEqual(r[0]["id"], rid)
        self.assertEqual(r[0]["usage"]["credits"], 7.89)
        self.assertIsNone(r[1]["usage"])


if __name__ == "__main__":
    unittest.main()
