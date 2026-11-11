"""Deep Work: a task that needs you and takes real time leaves Triage for the Deep Work pool, and waits there for
a session you start when you have the time."""

from helpers import CoreCase
from test_http import Server

from fuzz import answers, cards, events, states, tasks
from fuzz.db import FuzzError


class DeepWork(CoreCase):
    def setUp(self):
        super().setUp()
        self.tid = tasks.capture(self.core, "Outline the Q3 planning doc")

    def test_the_task_card_offers_it(self):
        self.assertIn("deep_work", cards.options(self.card_for(self.tid, "task"), self.task(self.tid)))

    def test_answering_moves_it_to_the_pool_and_clears_the_card(self):
        answers.answer(self.core, self.card_for(self.tid, "task")["id"], "deep_work")
        t = self.task(self.tid)
        self.assertEqual((t["state"], t["assignee"]), ("deepwork", "human"))
        self.assertEqual(cards.open_cards(self.core, self.tid), [])
        self.assertEqual(events.check_replay(self.core), [])

    def test_ways_out_of_the_pool(self):
        for to, act in (("done", lambda: tasks.done(self.core, self.tid)),
                        ("triage", lambda: tasks.bring_back(self.core, self.tid, "front", "Stuck in Deep Work.",
                                                            "task.reopened")),
                        ("parked", lambda: tasks.park(self.core, self.tid)),
                        ("letgo", lambda: tasks.let_go(self.core, self.tid))):
            tid = tasks.capture(self.core, f"Long task for {to}")
            self.tid = tid
            tasks.deep_work(self.core, tid)
            act()
            self.assertEqual(self.task(tid)["state"], to)
        self.assertEqual(events.check_replay(self.core), [])

    def test_back_in_triage_gets_its_card_again(self):
        tasks.deep_work(self.core, self.tid)
        tasks.bring_back(self.core, self.tid, "front", "Stuck in Deep Work.", "task.reopened")
        self.assertEqual(self.card_for(self.tid, "task")["kind"], "task")

    def test_done_for_now_keeps_where_you_left_off(self):
        tasks.deep_work(self.core, self.tid)
        tasks.deep_work(self.core, self.tid, left_off="Drafted the intro; numbers next")
        t = self.task(self.tid)
        self.assertEqual(t["state"], "deepwork")
        self.assertIn("Where I left off: Drafted the intro; numbers next", t["notes"])
        self.assertEqual(events.check_replay(self.core), [])

    def test_captured_straight_into_deep_work_skips_gathering(self):
        """Typed in a Deep Work session: you're about to work on it, so it doesn't wait for Fuzz to gather first,
        even when gathering is on."""
        tid = tasks.capture(self.core, "Sketch the pricing experiment plan", gather=True, deep_work=True)
        t = self.task(tid)
        self.assertEqual(t["state"], "deepwork")
        self.assertNotIn("gather", t["variant_tags"] or [])
        self.assertEqual(cards.open_cards(self.core, tid), [])
        self.assertEqual(events.check_replay(self.core), [])

    def test_its_deliverable_closing_brings_it_up_to_keep_or_let_go(self):
        from fuzz import deliverables
        did = deliverables.create(self.core, "The report builder launch", "REP-118 is Done and in the release notes")
        deliverables.link(self.core, self.tid, did)
        tasks.deep_work(self.core, self.tid)
        deliverables._close(self.core, deliverables.get(self.core, did), "dropped", None, "human")
        t = self.task(self.tid)
        self.assertEqual(t["state"], "triage")
        self.assertIn("Keep this on its own, or let it go?", t["reason"])

    def test_waiting_on_someone_can_take_it_from_the_pool(self):
        from fuzz.matching import matcher
        self.assertIn("deepwork", matcher.HANDS_OFF)   # yours but idle, like parked: a hand-off moves it to waiting
        tasks.deep_work(self.core, self.tid)
        tasks.wait(self.core, self.tid, on="Priya")
        self.assertEqual(self.task(self.tid)["state"], "waiting")

    def test_fuzz_cant_put_its_own_work_there(self):
        tasks.assign(self.core, self.tid)
        self.assertEqual(self.task(self.tid)["state"], "queued")
        self.assertNotIn("deepwork", states.MOVES["working"])
        with self.assertRaises(FuzzError):
            states.check("working", "deepwork")


class DeepWorkApi(Server):
    def test_the_action_and_the_list(self):
        tid = tasks.capture(self.core, "Write the onboarding guide")
        status, r = self.req("POST", f"/tasks/{tid}/deep_work", {})
        self.assertEqual((status, r["state"]), (200, "deepwork"))
        listed = self.req("GET", "/tasks?state=deepwork")[1]["tasks"]
        self.assertEqual([t["id"] for t in listed], [tid])
        status, r = self.req("POST", f"/tasks/{tid}/deep_work", {"left_off": "Section 2 next"})
        self.assertEqual((status, r["state"]), (200, "deepwork"))
        self.assertEqual(self.req("POST", f"/tasks/{tid}/done", {})[1]["state"], "done")

    def test_capture_into_deep_work_with_gathering_on(self):
        from unittest import mock
        cfg = self.core.config
        cfg["engine"]["client"] = "claude"   # gathering is on once there's an engine
        self.core.save_config(cfg)
        with mock.patch("fuzz.engine.run_now") as run:
            status, r = self.req("POST", "/tasks", {"text": "Sketch the pricing experiment plan", "deep_work": True})
            self.assertEqual((status, r["gathering"]), (201, False))
            self.assertEqual(self.req("GET", f"/tasks/{r['task_id']}")[1]["state"], "deepwork")
            run.assert_not_called()

    def test_free_until_is_the_end_of_the_free_time_you_are_in(self):
        from fuzz import booking
        self.assertEqual(self.req("GET", "/deepwork")[1], {"free_until": None})   # no calendar yet
        # the clock starts at 9:00 UTC: free 8:30 to 10:00, then a meeting, then free 11:00 to 12:00
        booking.report(self.core, [{"start": "2026-10-20T08:30:00Z", "end": "2026-10-20T10:00:00Z"},
                                   {"start": "2026-10-20T11:00:00Z", "end": "2026-10-20T12:00:00Z"}])
        until = self.req("GET", "/deepwork")[1]["free_until"]
        self.assertTrue(until.startswith("2026-10-20T10:00"), until)
        self.clock.advance(hours=1, minutes=30)   # 10:30, in the meeting
        self.assertIsNone(self.req("GET", "/deepwork")[1]["free_until"])
