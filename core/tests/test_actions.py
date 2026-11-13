"""actions and followups: one command path for HTTP, the CLI and MCP, so they start the same work."""

import contextlib
import io
import json
from unittest import mock

import asyncio

from mcp import Client

from fuzz import actions, cards, cli, events, followups, mcp_server, onboarding, tasks
from fuzz.db import FuzzError

from helpers import CoreCase
from test_http import Server


class Base(CoreCase):
    def setUp(self):
        super().setUp()
        cfg = self.core.config
        cfg["engine"] = {"client": "claude-code", "model": None}
        self.core.save_config(cfg)
        run = mock.patch("fuzz.engine.run_now")
        self.run_now = run.start()
        self.addCleanup(run.stop)

    def triage_task(self, text="Send Priya the budget"):
        tid = tasks.capture(self.core, text)
        return tid, self.card_for(tid, "task")

    def kickoff_perms(self):
        """The kickoff, assigned and listed: its permission cards are open."""
        tid = onboarding.kickoff(self.core)["kickoff_task"]
        out, follow = actions.answer_card(self.core, self.card_for(tid, "task")["id"], "assign")
        from fuzz import connectors
        connectors._save(self.core, {"claude-code": {"tools": [
            {"allow": "mcp__claude_ai_Gmail__search", "server": "Gmail", "kind": "lookup", "suggested": True,
             "does": "Search your email."}], "servers": [{"name": "Gmail"}], "discovered_at": "2026-10-20T09:00:00Z"}})
        onboarding.after_discovery(self.core, tid)
        return tid, [c for c in cards.open_cards(self.core, tid) if c["kind"] == "permission"]

    def cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            cli.main(["--home", self.home, *argv])
        return json.loads(buf.getvalue())


class AnswerCard(Base):
    def test_assigning_the_kickoff_asks_for_discovery_not_the_executor(self):
        tid = onboarding.kickoff(self.core)["kickoff_task"]
        out, follow = actions.answer_card(self.core, self.card_for(tid, "task")["id"], "assign")
        self.assertEqual(out, {"task_id": tid, "state": "queued", "kickoff": True})
        self.assertEqual(follow, [{"kind": "discover", "task_id": tid, "client": "claude-code"}])

    def test_allow_once_on_a_kickoff_card_turns_reading_on_and_finishes_it(self):
        tid, (gmail,) = self.kickoff_perms()
        actions.answer_card(self.core, gmail["id"], "allow_once")
        self.assertEqual(self.core.config["read"]["tools"]["claude-code"], ["mcp__claude_ai_Gmail__search"])
        self.assertEqual(tasks.get(self.core, tid)["state"], "done")

    def test_wait_asks_for_a_gather(self):
        tid, card = self.triage_task()
        out, follow = actions.answer_card(self.core, card["id"], "wait", "Priya")
        self.assertEqual(follow, [{"kind": "gather"}])

    def test_find_out_asks_for_a_run_on_that_task(self):
        tid, card = self.triage_task()
        out, follow = actions.answer_card(self.core, card["id"], "find_out", "Which budget?")
        self.assertEqual(follow, [{"kind": "find_out", "task_id": tid}])

    def test_done_starts_nothing(self):
        tid, card = self.triage_task()
        self.assertEqual(actions.answer_card(self.core, card["id"], "done")[1], [])


class TaskAction(Base):
    def test_every_verb_is_known_and_others_are_refused(self):
        tid, _ = self.triage_task()
        with self.assertRaises(FuzzError) as e:
            actions.task_action(self.core, tid, "explode")
        self.assertEqual(e.exception.field, "action")

    def test_find_out_asks_for_a_run_on_that_task(self):
        tid, _ = self.triage_task()
        out, follow = actions.task_action(self.core, tid, "find_out", {"question": "Which budget?"})
        self.assertEqual(out["task_id"], tid)
        self.assertEqual(follow, [{"kind": "find_out", "task_id": tid}])

    def test_a_note_goes_in_the_notes_and_the_log(self):
        tid, _ = self.triage_task()
        with self.assertRaises(FuzzError):
            actions.task_action(self.core, tid, "note", {"text": "  "})
        out, follow = actions.task_action(self.core, tid, "note", {"text": "She's out until Monday"})
        self.assertEqual((out["state"], follow), ("triage", []), "a note changes nothing else")
        self.assertIn("You said: She's out until Monday", tasks.get(self.core, tid)["notes"])
        self.assertEqual(events.task_log(self.core, tid)[0]["text"], "You said: She's out until Monday")
        actions.task_action(self.core, tid, "park")
        self.assertEqual(tasks.get(self.core, tid)["state"], "parked", "the choice after it goes ahead as usual")

    def test_reopen_checks_where(self):
        tid, _ = self.triage_task()
        actions.task_action(self.core, tid, "done")
        with self.assertRaises(FuzzError):
            actions.task_action(self.core, tid, "reopen", {"where": "sideways"})
        out, _ = actions.task_action(self.core, tid, "reopen", {"where": "back"})
        self.assertEqual(out["state"], "triage")
        self.assertIn("returning", tasks.get(self.core, tid)["variant_tags"])

    def test_assigning_the_kickoff_in_triage_is_the_kickoff(self):
        tid = onboarding.kickoff(self.core)["kickoff_task"]
        out, follow = actions.task_action(self.core, tid, "assign")
        self.assertTrue(out["kickoff"])
        self.assertEqual(follow[0]["kind"], "discover")


class Followups(Base):
    def test_slow_work_goes_to_the_background_runner(self):
        ran = []
        with mock.patch("fuzz.followups.discover") as discover:
            followups.run(self.core, [{"kind": "discover", "task_id": 7, "client": "copilot"}], background=ran.append)
            discover.assert_not_called()
            ran[0]()
            discover.assert_called_once_with(self.core, 7, "copilot")

    def test_a_session_handoff_never_fails_the_command(self):
        self.run_now.side_effect = OSError("no fuzz on PATH")
        self.assertFalse(followups.start_task(self.core, 3))

    def test_no_engine_starts_nothing(self):
        cfg = self.core.config
        cfg["engine"] = {"client": None, "model": None}
        self.core.save_config(cfg)
        tid, _ = self.triage_task()
        followups.run(self.core, [{"kind": "find_out", "task_id": tid}, {"kind": "executor_task", "task_id": tid}])
        self.run_now.assert_not_called()

    def test_unknown_kinds_are_a_bug(self):
        with self.assertRaises(ValueError):
            followups.run(self.core, [{"kind": "teleport"}])


class CliParity(Base):
    """`fuzz answer` and `fuzz task` used to skip what the UI's answers start; now they share it."""

    def test_fuzz_answer_applies_the_kickoff_rules(self):
        tid, (gmail,) = self.kickoff_perms()
        self.cli("answer", str(gmail["id"]), "allow_once")
        self.assertEqual(self.core.config["read"]["tools"]["claude-code"], ["mcp__claude_ai_Gmail__search"])
        self.assertEqual(tasks.get(self.core, tid)["state"], "done")

    def test_fuzz_task_find_out_starts_the_executor_on_it(self):
        tid, _ = self.triage_task()
        out = self.cli("task", str(tid), "find_out", "--value", "Which budget?")
        self.assertEqual(out["task_id"], tid)
        self.run_now.assert_called_once()
        self.assertEqual(self.run_now.call_args.args[1:], ("executor", tid))

    def test_fuzz_task_takes_a_json_body(self):
        tid, _ = self.triage_task()
        self.cli("task", str(tid), "wait", "--value", '{"on": "Priya"}')
        self.assertEqual(tasks.get(self.core, tid)["waiting_on"], "Priya")

    def test_fuzz_task_text_stays_text(self):
        tid, _ = self.triage_task()
        self.cli("task", str(tid), "wait", "--value", "2026")
        self.assertEqual(tasks.get(self.core, tid)["waiting_on"], "2026")

    def test_fuzz_capture_starts_the_gather_when_gathering_is_on(self):
        cfg = self.core.config
        cfg["gather"] = dict(cfg.get("gather") or {}, enabled=True)
        self.core.save_config(cfg)
        out = self.cli("capture", "Prepare", "for", "my", "1:1")
        self.assertEqual(tasks.get(self.core, out["task_id"])["state"], "queued")
        self.assertEqual(self.run_now.call_args.args[1:], ("executor",))


class HttpFollowups(Server):
    """The routes hand their follow-ups to the same runner."""

    def setUp(self):
        super().setUp()
        cfg = self.core.config
        cfg["engine"] = {"client": "claude-code", "model": None}
        self.core.save_config(cfg)

    def test_find_out_on_a_card_starts_the_executor_on_that_task(self):
        tid = tasks.capture(self.core, "Send Priya the budget")
        card = self.card_for(tid, "task")
        with mock.patch("fuzz.engine.run_now") as run:
            status, _ = self.req("POST", f"/cards/{card['id']}/answer", {"option": "find_out", "value": "Which budget?"})
        self.assertEqual(status, 200)
        self.assertEqual(run.call_args.args[1:], ("executor", tid))

    def test_every_verb_has_a_route(self):
        tid = tasks.capture(self.core, "Send Priya the budget")
        with mock.patch("fuzz.engine.run_now"):
            self.assertEqual(self.req("POST", f"/tasks/{tid}/back")[0], 200)
            self.assertEqual(self.req("POST", f"/tasks/{tid}/explode")[0], 404)


class SessionHandoff(Base):
    def test_end_session_handing_it_to_fuzz_starts_the_executor(self):
        tid = tasks.capture(self.core, "Book the room")
        tasks.session(self.core, tid)
        srv = mcp_server.build(self.core, "session", tid)

        async def end():
            async with Client(srv) as c:
                return await c.call_tool("end_session", {"outcome": "fuzz", "summary": "Looked at rooms.",
                                                         "next_step": "Book room 4"})
        self.assertFalse(asyncio.run(end()).is_error)
        self.assertEqual(self.run_now.call_args.args[1:], ("executor", tid))
