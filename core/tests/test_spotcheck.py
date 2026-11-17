"""Spot checks: Fuzz checking a few of its own skipped messages and executor runs a week (docs/evals.md)."""

import json

from helpers import CoreCase

from fuzz import actions, answers, cards, evals, events, scheduler, spotcheck, tasks, tools
from fuzz.db import FuzzError


class On(CoreCase):
    def setUp(self):
        super().setUp()
        self.core.update_config(lambda c: c.pop("evals", None))   # the defaults: a few a week


class SpotMessage(On):
    def message(self, n, asks=(), owner="unclear", channel="C1", source="slack"):
        tools.submit_signals(self.core, [{
            "source": source, "source_id": f"m{n}", "anchor": f"{source}:{channel}:m{n}", "ts": "2026-10-19T08:00:00Z",
            "title": f"Update {n}", "link": f"https://chat.example/m{n}",
            "from": {"name": "Sam Lee", "email": "sam@acme.example"},
            "quote": f"Message {n}", "candidates": [{"ask": a, "owner": owner} for a in asks]}])
        return self.core.one("SELECT key FROM signals WHERE source_id=?", (f"m{n}",))["key"]

    def open_card(self, kind="spot_message"):
        return self.core.one("SELECT * FROM cards WHERE kind=? AND status='open'", (kind,))

    def test_only_messages_with_nothing_for_you_are_picked(self):
        self.message(1, asks=["Send the deck"], owner="me")
        fyi = self.message(2)
        self.assertEqual([r["key"] for r in spotcheck.skipped(self.core)], [fyi])

    def test_direct_messages_are_picked_more_often(self):
        me = self.core.config["me"]
        self.assertTrue(spotcheck._direct({}, me, "slack:D0ABC:123.4"))
        self.assertFalse(spotcheck._direct({}, me, "slack:C0ABC:123.4"))
        self.assertTrue(spotcheck._direct({"source": "email", "people": [{"email": "justin@acme.example"}]}, me))
        self.assertFalse(spotcheck._direct({"source": "email", "people": [{"email": "team@acme.example"}]}, me))

    def test_one_open_at_a_time_and_a_few_a_week(self):
        for n in range(6):
            self.message(n)
        self.assertIsNotNone(spotcheck.raise_message(self.core))
        self.assertIsNone(spotcheck.raise_message(self.core), "one open at a time")
        made = 1
        for _ in range(5):
            c = self.open_card()
            if c:
                answers.answer(self.core, c["id"], "nothing")
            if spotcheck.raise_message(self.core):
                made += 1
        self.assertEqual(made, spotcheck.PER_WEEK["spot_message"])
        self.clock.advance(days=8)
        self.assertIsNotNone(spotcheck.raise_message(self.core), "next week, more")

    def test_zero_a_week_turns_it_off(self):
        self.message(1)
        self.core.update_config(lambda c: c.update(evals={"spot_checks_per_week": 0}))
        self.assertIsNone(spotcheck.raise_message(self.core))

    def test_the_tick_raises_them(self):
        self.message(1)
        self.assertEqual(scheduler.tick(self.core)["spot_checks"], 1)
        self.assertIsNotNone(self.open_card())

    def test_nothing_makes_a_solved_skip_case_that_waits_for_its_text(self):
        key = self.message(1)
        cid = spotcheck.raise_message(self.core)
        answers.answer(self.core, cid, "nothing")
        [c] = evals.cases(self.core, "extract", status="pending")
        self.assertEqual((c["kind"], c["signal_key"], c["expected"]), ("skip", key, {"has_my_ask": False, "strict": True}))
        self.assertTrue(c["origin"].startswith("spot:"), "a case extraction got right teaches no lesson")
        self.assertIn(c["id"], [x["case_id"] for x in evals.to_fetch(self.core)])

    def test_there_was_something_makes_a_keep_case_and_a_task(self):
        self.message(1)
        cid = spotcheck.raise_message(self.core)
        answers.answer(self.core, cid, "had_ask", "Send Sam the budget")
        [c] = evals.cases(self.core, "extract", status="pending")
        self.assertEqual((c["kind"], c["expected"]["ask"]), ("keep", "Send Sam the budget"))
        self.assertTrue(c["origin"].startswith("feedback:"))
        t = self.core.one("SELECT * FROM tasks WHERE title='Send Sam the budget'")
        self.assertIsNotNone(t)
        self.assertTrue(self.core.one("SELECT 1 FROM sources WHERE task_id=? AND link='https://chat.example/m1'", (t["id"],)))

    def test_undo_takes_the_label_back(self):
        self.message(1)
        cid = spotcheck.raise_message(self.core)
        answers.answer(self.core, cid, "had_ask", "Send Sam the budget")
        actions.undo(self.core)
        self.assertEqual(evals.cases(self.core, "extract", status="pending"), [])
        self.assertEqual(self.core.one("SELECT withdrawn FROM eval_cases")["withdrawn"], 1)
        self.assertNotIn(self.core.one("SELECT state FROM tasks WHERE title='Send Sam the budget'")["state"],
                         ("triage", "queued", "ready"), "the task it made is gone from your list")
        self.assertEqual(cards.get(self.core, cid)["status"], "open")

    def test_a_checked_message_isnt_picked_again(self):
        self.message(1)
        answers.answer(self.core, spotcheck.raise_message(self.core), "nothing")
        self.assertEqual(spotcheck.skipped(self.core), [])


class SpotRun(On):
    def worked_task(self):
        tid = tasks.capture(self.core, "Find the venue contract")
        with self.core.tx("fuzz:executor"):
            ch = events.Changes()
            events.emit(self.core, "task.step", task_id=tid, changes=ch, log=("research", "Searched mail for the contract."))
            events.emit(self.core, "task.handed_back", task_id=tid, changes=events.Changes())
        return tid

    def test_a_task_the_executor_handed_back_gets_a_card(self):
        tid = self.worked_task()
        cid = spotcheck.raise_run(self.core)
        p = cards.get(self.core, cid)["payload"]
        self.assertEqual((p["task_id"], p["did"]), (tid, "handed it back to you"))
        self.assertIn("Searched mail for the contract.", p["steps"])
        self.assertIsNone(spotcheck.raise_run(self.core), "one open at a time")

    def test_what_was_off_is_a_label_for_the_executor_evals(self):
        tid = self.worked_task()
        cid = spotcheck.raise_run(self.core)
        with self.assertRaises(FuzzError):
            answers.answer(self.core, cid, "off", {"what": []})
        answers.answer(self.core, cid, "off", {"what": ["gave_up"], "note": "The contract was in Drive"})
        [label] = spotcheck.run_labels(self.core)
        self.assertEqual((label["task_id"], label["verdict"], label["off"]), (tid, "off", ["Handed back too early"]))
        self.assertEqual(label["note"], "The contract was in Drive")

    def test_undo_drops_the_label(self):
        self.worked_task()
        answers.answer(self.core, spotcheck.raise_run(self.core), "right")
        actions.undo(self.core)
        self.assertEqual(spotcheck.run_labels(self.core), [])

    def test_a_task_is_checked_once(self):
        self.worked_task()
        answers.answer(self.core, spotcheck.raise_run(self.core), "right")
        self.assertEqual(spotcheck.worked(self.core), [])
