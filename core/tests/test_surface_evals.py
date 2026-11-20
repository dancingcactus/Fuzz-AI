"""Evals for the surfaces that had none: priority and series suggestions (no model), the sender and recall (a
model, played through a harness). Each set must pass on today's code and fail when the rule it guards breaks."""

import json
from unittest import mock

from helpers import CoreCase
from test_series import SeriesCase

from fuzz import answers, cards, eval_jobs, evals, learning, priority, priority_evals, series_evals, tasks
from fuzz.series import suggest


class Priority(CoreCase):
    def test_every_case_passes_on_todays_rules_and_the_run_is_recorded(self):
        run = priority_evals.run(self.core)
        self.assertTrue(all(r["passed"] for r in run["results"]), priority_evals.summary(self.core, run)["wrong"])
        self.assertEqual((run["surface"], run["client"], run["model"]), ("priority", "rules", None))
        self.assertGreaterEqual(len(run["results"]), 10)

    def test_the_cases_catch_urgent_being_left_out(self):
        priority_evals.run(self.core)   # the baseline the gate holds it to
        real = priority.included
        with mock.patch.object(priority, "included", lambda level, cats: real(level, cats - {"urgent"})):
            run = priority_evals.run(self.core)
        broke = {r["origin"] for r in run["results"] if not r["passed"]}
        self.assertIn("seed:urgent-is-never-left-out", broke)
        self.assertFalse(run["gate_ok"], "a solved case broke")

    def test_the_cases_catch_coming_back_on_a_tired_day(self):
        real = priority.included
        with mock.patch.object(priority, "included", lambda level, cats: True if "coming_back" in cats else real(level, cats)):
            run = priority_evals.run(self.core)
        self.assertIn("seed:tired-leaves-coming-back-out", {r["origin"] for r in run["results"] if not r["passed"]})

    def test_no_personal_set_yet(self):
        from fuzz.db import FuzzError
        with self.assertRaises(FuzzError):
            priority_evals.run(self.core, sets="personal")


class SeriesGlobal(CoreCase):
    def test_every_invented_series_passes_on_todays_detectors(self):
        run = series_evals.run(self.core, sets="global")
        self.assertTrue(all(r["passed"] for r in run["results"]), series_evals.summary(self.core, run)["wrong"])

    def test_the_cases_catch_a_mute_that_does_nothing_and_a_lost_reverse(self):
        real = suggest.detect

        def stall_always(core, s, idx):   # a detector that stopped looking for who owes the reply
            out = real(core, s, idx)
            return out + [{"detector": "stall", "key": f"stall:any{s['id']}", "title": "Nudge someone", "why": "quiet"}]
        with mock.patch.object(suggest, "detect", stall_always):
            run = series_evals.run(self.core, sets="global")
        broke = {r["origin"] for r in run["results"] if not r["passed"]}
        self.assertIn("seed:stall-with-nobody-owing-stays-quiet", broke)
        self.assertIn("seed:a-reply-owed-but-recent-movement-isnt-a-stall", broke)
        self.assertNotIn("seed:a-muted-series-gets-nothing", broke, "mute still holds")


class SeriesPersonal(SeriesCase):
    def stall_card(self, sid, n, detector="stall"):
        with self.core.tx("system"):
            return cards.create(self.core, "series_next", None, prompt="Next", reason="why",
                                payload={"series_id": sid, "detector": detector, "key": f"{detector}:x{n}", "title": "Nudge Dana"})

    def test_a_not_needed_lesson_is_tested_on_your_answers_before_it_goes_live(self):
        sid = self.make_series()
        tasks.wait(self.core, self.members(sid)[0], "Dana Ito")
        answers.answer(self.core, self.stall_card(sid, 0, "prep"), "add", {"title": "Get ready"})   # you took a prep
        for n in range(2):
            answers.answer(self.core, self.stall_card(sid, n + 1), "not_needed")
        learning.run(self.core)
        lesson = self.core.one("SELECT * FROM lessons WHERE surface='series_suggest'")
        self.assertEqual(lesson["status"], "testing")
        case = self.core.one("SELECT input FROM eval_cases WHERE surface='series_suggest' LIMIT 1")
        self.assertEqual(json.loads(case["input"])["series_id"], sid, "a case knows its series, as a lesson does")
        base = series_evals.run(self.core, sets="personal")   # without the lesson: the two Not needed fail
        self.assertEqual(sorted(r["passed"] for r in base["results"]), [False, False, True])
        run = series_evals.run(self.core, sets="personal", trying=lesson["id"])
        self.assertTrue(all(r["passed"] for r in run["results"]), "it hid both nudges and kept the prep you took")
        self.assertTrue(run["gate_ok"])
        self.assertEqual(learning.get(self.core, lesson["id"])["status"], "active")

    def test_a_lesson_that_would_hide_what_you_took_fails_its_gate(self):
        sid = self.make_series()
        answers.answer(self.core, self.stall_card(sid, 0), "add", {"title": "Nudge Dana"})
        series_evals.run(self.core, sets="personal")   # the baseline: the nudge you took is shown
        lid = self.core.new_id("lessons")
        self.core.q("INSERT INTO lessons (id, user_id, key, surface, kind, rule, status, how) VALUES (?,1,?,?,?,?,?,?)",
                    (lid, f"series:{sid}:stall", "series_suggest", "rule", "No nudges", "testing", "inferred"))
        run = series_evals.run(self.core, sets="personal", trying=lid)
        self.assertFalse(run["gate_ok"])
        x = learning.get(self.core, lid)
        self.assertEqual((x["status"], x["eval_ok"]), ("proposed", 0))


class Wiring(CoreCase):
    def test_the_evals_page_can_start_each_new_eval(self):
        spawned = []

        def spawn(argv, env, log):
            spawned.append(argv)
            import os
            return os.getpid()
        for surface, op in (("send", "send"), ("recall", "recall"), ("series_suggest", "series"), ("priority", "priority")):
            eval_jobs.start(self.core, surface, spawn=spawn, model="m-1")
            self.assertIn(op, spawned[-1])
        self.assertNotIn("--model", spawned[2], "series is a replay: no model to pin")
        self.assertIn("--model", spawned[0])

    def test_each_new_surface_has_its_case_kinds(self):
        for s in ("send", "recall", "priority", "series_suggest"):
            self.assertIn(s, evals.KINDS)
