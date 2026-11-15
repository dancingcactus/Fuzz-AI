"""One question for Fuzz (I can't decide: lay out the options). The task stays yours, Fuzz answers into the brief
as a step, and the card comes back next, right after the card in front, never in place of it. Find out… was its own
answer until 2026-11-15; it's gone, and its mechanism is what I can't decide runs on."""

import unittest

from helpers import CoreCase
from test_http import Server

from fuzz import answers, cards, scheduler, tasks, tools
from fuzz.db import FuzzError


class FindOut(CoreCase):
    def front(self):
        return [t["title"] for _, t in cards.queue(self.core)]

    def setup_queue(self):
        ids = [tasks.capture(self.core, x) for x in ("Plan the offsite", "Reply to Marcus", "Order lunch")]
        return ids

    def test_the_answer_comes_back_next_without_changing_the_card_in_front(self):
        plan, marcus, lunch = self.setup_queue()
        answers.answer(self.core, self.card_for(marcus)["id"], "decide")
        t = self.task(marcus)
        self.assertEqual((t["state"], t["find_out"]), ("queued", tasks.DECIDE))
        self.assertIn("finding_out", t["variant_tags"])
        self.assertEqual(self.front(), ["Plan the offsite", "Order lunch"])   # the card steps aside
        got = tools.claim_next_task(self.core)["task"]
        self.assertEqual((got["id"], got["finding_out"], got["may_finish"]), (marcus, tasks.DECIDE, False))
        tools.log_step(self.core, marcus, "research", "Read Marcus's thread")
        tools.update_brief(self.core, marcus, context_md="**Options**: staging or prod. I'd pick staging.", summary="Staging.",
                           effort_mins=30, steps=3)
        tools.finish_gathering(self.core, marcus, result=True)   # a lookup never finishes the task
        t = self.task(marcus)
        self.assertEqual((t["state"], t["title"]), ("triage", "Reply to Marcus"))
        self.assertIn("found_out", t["variant_tags"])
        self.assertNotIn("result", t["variant_tags"])
        ev = self.core.one("SELECT payload FROM events WHERE task_id=? AND type='task.gathered' ORDER BY id DESC LIMIT 1", (marcus,))
        self.assertEqual(ev["payload"]["log"]["text"], "Fuzz laid out the options. It's back for you.")
        self.assertEqual(self.front(), ["Plan the offsite", "Reply to Marcus", "Order lunch"])   # next, after the front
        answers.answer(self.core, self.card_for(plan)["id"], "done")
        self.assertEqual(self.front()[0], "Reply to Marcus")

    def test_a_question_is_never_retitled(self):
        _, marcus, _ = self.setup_queue()
        tasks.find_out(self.core, marcus, "Where are the test accounts?")
        tools.claim_next_task(self.core)
        with self.assertRaises(FuzzError) as e:
            tools.update_brief(self.core, marcus, title="Find the test accounts")
        self.assertEqual(e.exception.status, 409)
        self.assertEqual(self.task(marcus)["title"], "Reply to Marcus")

    def test_it_needs_a_question(self):
        _, marcus, _ = self.setup_queue()
        with self.assertRaises(FuzzError):
            tasks.find_out(self.core, marcus, "  ")

    def test_find_out_is_no_longer_an_answer(self):
        _, marcus, _ = self.setup_queue()
        c = self.card_for(marcus)
        self.assertNotIn("find_out", cards.options(c, self.task(marcus)))
        with self.assertRaises(FuzzError):
            answers.answer(self.core, c["id"], "find_out", "Which budget?")
        self.assertEqual(self.task(marcus)["state"], "triage")

    def test_gaps_in_the_brief_show_on_the_card_and_change_no_suggestion(self):
        for title, mins, steps, want in (("Test the plugin", 60, 4, "book"), ("Check the test plan", 15, 2, "assign")):
            tid = tasks.capture(self.core, title, gather=True)
            tools.claim_next_task(self.core, tid)
            tools.update_brief(self.core, tid, context_md="## Setup", effort_mins=mins, steps=steps, gaps=["the test accounts"])
            tools.finish_gathering(self.core, tid)
            c = self.card_for(tid, "task")
            self.assertEqual(c["suggested"], want, title)   # big: Book time leads; small: Hand it to Fuzz
            self.assertEqual(cards.view(self.core, c)["task"]["gaps"], ["the test accounts"])

    def test_if_fuzz_doesnt_get_to_it_the_card_still_comes_back_next(self):
        plan, marcus, _ = self.setup_queue()
        tasks.find_out(self.core, marcus, "Where are the test accounts?")
        self.clock.advance(minutes=5)
        scheduler.tick(self.core)
        self.assertEqual(self.task(marcus)["state"], "queued")
        self.clock.advance(minutes=6)
        scheduler.tick(self.core)
        self.assertEqual(self.front()[:2], ["Plan the offsite", "Reply to Marcus"])

    def test_sending_it_to_the_end_drops_next(self):
        plan, marcus, _ = self.setup_queue()
        tasks.find_out(self.core, marcus, "Where are the test accounts?")
        tools.claim_next_task(self.core)
        tools.finish_gathering(self.core, marcus)
        tasks.to_back(self.core, marcus)
        self.assertEqual(self.front()[-1], "Reply to Marcus")


class Api(Server):
    def test_the_find_out_verb_is_gone(self):
        tid = tasks.capture(self.core, "Reply to Marcus")
        status, _ = self.req("POST", f"/tasks/{tid}/find_out", {"question": "What did he ask for?"})
        self.assertNotEqual(status, 200)
        self.assertEqual(self.req("GET", f"/tasks/{tid}")[1]["state"], "triage")


if __name__ == "__main__":
    unittest.main()
