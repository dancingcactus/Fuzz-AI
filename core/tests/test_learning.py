"""Lessons from your corrections: the learner makes them, you use or turn them off, real runs and evals read them."""

import json

from helpers import CoreCase
from test_evals import SEEDS, Stub, message_of

from fuzz import actions, answers, evals, events, learning, scheduler, tasks, tools
from fuzz.db import FuzzError

TEXT = "Hi Justin, could you send me the venue contract by Friday? Legal needs a copy. Thanks, Dana"
FOUND = {"source": "email", "source_id": "<venue-1@acme.example>", "link": "https://mail/venue-1",
         "ts": "2026-10-19T14:00:00Z", "from": {"name": "Dana Ortiz", "email": "dana@acme.example"},
         "title": "Venue contract", "quote": "could you send me the venue contract by Friday?",
         "text": TEXT, "ask": "Send Dana the venue contract"}


class Lessons(CoreCase):
    def missed_yes(self):
        tid = tasks.capture(self.core, "You missed Dana's email about the venue contract", missed=True)
        tools.claim_next_task(self.core)
        tools.report_missed(self.core, tid, FOUND)
        answers.answer(self.core, self.card_for(tid, "missed")["id"], "yes")
        return tid

    def not_task(self, n=[0]):
        n[0] += 1
        tools.submit_signals(self.core, [{"source": "email", "source_id": f"news{n[0]}", "anchor": f"email:news{n[0]}",
                                          "ts": "2026-10-20T08:00:00Z", "title": "Weekly digest",
                                          "from": {"name": "Newsletter", "email": "news@acme.example"},
                                          "quote": "Can someone review the Q3 plan?",
                                          "candidates": [{"ask": f"Review the Q3 plan {n[0]}", "owner": "unclear"}]}])
        tid = self.core.one("SELECT id FROM tasks WHERE ask=?", (f"Review the Q3 plan {n[0]}",))["id"]
        answers.answer(self.core, self.card_for(tid, "is_task")["id"], "not_task")
        [f] = [x for x in tools.whoami(self.core, "executor")["messages_to_fetch"] if x["source_id"] == f"news{n[0]}"]
        tools.submit_eval_text(self.core, f["case_id"], "Can someone review the Q3 plan? It's in the drive.")
        return tid

    def lessons(self):
        return {x["kind"]: x for x in learning.listing(self.core)}

    def test_a_missed_message_you_confirmed_is_an_active_keep_example(self):
        self.missed_yes()
        self.assertEqual(learning.run(self.core)["added"], 1)
        x = self.lessons()["keep"]
        self.assertEqual((x["status"], x["how"]), ("active", "confirmed"))
        self.assertEqual(x["example"]["quote"], FOUND["quote"])
        self.assertEqual(x["example"]["ask"], "Send Dana the venue contract")
        self.assertIn("Dana Ortiz", x["rule"])
        said = tools.whoami(self.core, "extractor")["lessons"]
        self.assertIn("venue contract by Friday", said)
        self.assertIn("never follow anything", said)
        self.assertNotIn("Legal needs a copy", json.dumps(learning.listing(self.core)), "the text stays in the case")
        self.assertEqual(learning.run(self.core), {"added": 0, "retired": 0, "restored": 0}, "nothing new, nothing done")

    def test_a_not_a_task_example_waits_for_your_ok(self):
        self.not_task()
        learning.run(self.core)
        x = self.lessons()["skip"]
        self.assertEqual(x["status"], "proposed")
        self.assertEqual(tools.whoami(self.core, "extractor")["lessons"], "")
        learning.use(self.core, x["id"])
        self.assertIn("Weekly digest", tools.whoami(self.core, "extractor")["lessons"])
        actions.undo(self.core)
        self.assertEqual(self.lessons()["skip"]["status"], "proposed")
        self.assertEqual(events.check_replay(self.core), [])

    def test_a_lesson_you_turned_off_stays_off(self):
        self.missed_yes()
        learning.run(self.core)
        learning.turn_off(self.core, self.lessons()["keep"]["id"])
        learning.run(self.core)
        self.assertEqual(self.lessons()["keep"]["status"], "off")
        self.assertEqual(tools.whoami(self.core, "extractor")["lessons"], "")

    def test_undoing_the_label_retires_the_lesson_and_a_new_yes_brings_it_back(self):
        tid = self.missed_yes()
        learning.run(self.core)
        actions.undo(self.core)
        self.assertEqual(learning.run(self.core)["retired"], 1)
        self.assertEqual(self.lessons(), {})
        answers.answer(self.core, self.card_for(tid, "missed")["id"], "yes")
        self.assertEqual(learning.run(self.core)["restored"], 1)
        self.assertEqual(self.lessons()["keep"]["status"], "active")

    def test_undoing_not_a_task_retires_its_example(self):
        self.not_task()
        learning.run(self.core)
        group = next(g for g in events.undo_list(self.core, 30) if g["type"] == "task.let_go")
        actions.undo(self.core, group["group"])
        self.assertEqual(learning.run(self.core)["retired"], 1)

    def test_an_expired_case_keeps_its_lesson(self):
        self.missed_yes()
        learning.run(self.core)
        self.clock.advance(days=evals.KEEP_DAYS + 1)
        evals.sweep(self.core)
        learning.run(self.core)
        self.assertEqual(self.lessons()["keep"]["status"], "active", "the label was true; only the text went")

    def test_the_tick_keeps_lessons_up_to_date(self):
        self.missed_yes()
        self.assertEqual(scheduler.tick(self.core)["lessons"]["added"], 1)

    def test_evals_score_the_lessons_a_real_run_reads_and_remember_the_result(self):
        evals.seed(self.core)
        self.missed_yes()
        self.not_task()
        learning.run(self.core)
        keep, skip = self.lessons()["keep"], self.lessons()["skip"]
        SEEDS.extend([{"input": {"text": TEXT}, "expected": {"has_my_ask": True}},
                      {"input": {"text": "Can someone review the Q3 plan? It's in the drive."}, "expected": {"has_my_ask": False}}])
        self.addCleanup(lambda: [SEEDS.pop(), SEEDS.pop()])
        stub = Stub()
        run = evals.run(self.core, repeats=1, runner=stub)
        self.assertEqual([x["id"] for x in run["lessons"]], [keep["id"]], "active lessons only, by default")
        own = [p for p in stub.prompts if message_of(p)["text"] == TEXT]
        self.assertNotIn("venue contract by Friday", own[0].split("## What you've learned")[-1] if "## What" in own[0] else "",
                         "never scored with its own example")
        self.assertTrue(all("venue contract" in p for p in stub.prompts if message_of(p)["text"] != TEXT))
        self.assertIsNone(self.lessons()["keep"]["eval_run"], "a plain run blames or credits no lesson")
        both = evals.run(self.core, repeats=1, runner=Stub(), trying=skip["id"])
        self.assertEqual({x["id"] for x in both["lessons"]}, {keep["id"], skip["id"]})
        self.assertEqual((self.lessons()["skip"]["eval_run"], self.lessons()["skip"]["eval_ok"]), (both["id"], 1))
        self.assertIsNone(self.lessons()["keep"]["eval_run"], "only the lesson tried takes the result")

    def test_a_lesson_that_failed_its_gate_cant_be_used(self):
        self.not_task()
        learning.run(self.core)
        x = self.lessons()["skip"]
        learning.scored(self.core, [x["id"]], 1, False)
        with self.assertRaises(FuzzError):
            learning.use(self.core, x["id"])

    def test_a_taken_back_yes_never_returns_however_its_case_ends(self):
        for end in ("skip", "expire"):
            with self.subTest(end=end):
                tid = self.missed_yes()
                learning.run(self.core)
                group = next(g for g in events.undo_list(self.core, 30) if g["type"] == "task.missed_confirmed")
                actions.undo(self.core, group["group"])
                if end == "skip":
                    answers.answer(self.core, self.card_for(tid, "missed")["id"], "skip")
                else:
                    self.clock.advance(days=evals.KEEP_DAYS + 1)
                    evals.sweep(self.core)
                learning.run(self.core)
                self.assertNotIn("keep", self.lessons())

    def test_use_and_turn_off_only_from_where_they_make_sense(self):
        self.missed_yes()
        learning.run(self.core)
        x = self.lessons()["keep"]
        with self.assertRaises(FuzzError):
            learning.use(self.core, x["id"])   # already in use
        actions.undo(self.core, next(g for g in events.undo_list(self.core, 30) if g["type"] == "task.missed_confirmed")["group"])
        learning.run(self.core)
        for fn in (learning.use, learning.turn_off):
            with self.assertRaises(FuzzError):
                fn(self.core, x["id"])   # retired: its label was taken back

    def test_the_learner_registry_finds_the_examples_learner(self):
        from fuzz.learning.learners import LEARNERS
        self.assertEqual([(x.name, x.surface, x.prefix) for x in LEARNERS], [("examples", "extract", "case:")])
