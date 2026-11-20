"""Draft evals and the draft-style learner: how close drafts are to what was sent (docs/evals.md, "Drafts")."""

import json

from helpers import CoreCase

from fuzz import answers, draft_evals, drafts, evals, learning, scheduler, tasks, tools

WROTE = ("Hi Priya,\n\n**Update:** The Q3 vendor numbers are attached. I'll have the rest by Friday.\n\n"
         "Thanks,\nJustin")
SENT = "Q3 vendor numbers attached. Two vendors still owe invoices."


class Base(CoreCase):
    def draft(self, body=WROTE, title="Reply to Priya"):
        tid = tasks.capture(self.core, title)
        tasks.assign(self.core, tid)
        t, why = scheduler.claim_next(self.core, tid)
        self.assertEqual((t or {}).get("id"), tid, why)
        did = drafts.save_draft(self.core, tid, "slack.message", "Priya Shah", body)
        return tid, did, self.card_for(tid, "draft")

    def edit_and_approve(self, sent=SENT, **kw):
        tid, did, card = self.draft(**kw)
        answers.answer(self.core, card["id"], "edit", sent)
        answers.answer(self.core, card["id"], "approve")
        return tid, did


class History(Base):
    def test_what_fuzz_wrote_and_what_you_sent(self):
        _, did = self.edit_and_approve()
        tid2, did2, card2 = self.draft(title="Reply to Sam")
        answers.answer(self.core, card2["id"], "approve")
        got = {h["draft_id"]: h for h in draft_evals.history(self.core)}
        self.assertEqual((got[did]["wrote"], got[did]["sent"], got[did]["edited"]), (WROTE, SENT, True))
        self.assertEqual((got[did2]["wrote"], got[did2]["sent"], got[did2]["edited"]), (WROTE, WROTE, False))

    def test_a_sent_back_draft_has_no_reference_but_keeps_your_note(self):
        _, did, card = self.draft()
        answers.answer(self.core, card["id"], "send_back", "Too formal, and don't promise Friday")
        [h] = draft_evals.history(self.core)
        self.assertIsNone(h["sent"])
        self.assertIn("promise Friday", h["note"])

    def test_a_prep_note_is_not_a_sent_message(self):
        tid = tasks.capture(self.core, "Prep the offsite update")
        tasks.assign(self.core, tid)
        scheduler.claim_next(self.core, tid)
        tools.update_brief(self.core, tid, due="2026-10-25")
        drafts.save_draft(self.core, tid, "note", None, "Venue: TBD. Budget: TBD.", final=False)
        card = self.card_for(tid, "draft")
        answers.answer(self.core, card["id"], "edit", "Can you look the venue up first?")
        answers.answer(self.core, card["id"], "approve")
        self.assertEqual(draft_evals.history(self.core), [])

    def test_how_much_changed_and_its_form(self):
        self.assertEqual(draft_evals.changed(SENT, SENT), 0.0)
        self.assertGreater(draft_evals.changed(WROTE, SENT), 0.5)
        f = draft_evals.form(WROTE, SENT)
        self.assertTrue(f["greeting_dropped"] and f["signoff_dropped"] and f["markup_dropped"])
        self.assertGreater(f["length"], 1.5)

    def test_point_by_point_reads_the_judges_reply(self):
        got = draft_evals.judge_points('Sure: {"points": ["a"], "missed": ["two vendors owe invoices"], '
                                       '"added": ["rest by Friday"]}')
        self.assertEqual((got["missed"], got["added"]), (["two vendors owe invoices"], ["rest by Friday"]))
        self.assertFalse(draft_evals._passed(got), "an added promise fails a draft")
        self.assertIn("error", draft_evals.judge_points("no idea"))

    def test_history_scores_only_need_the_model_to_judge_edited_drafts(self):
        self.edit_and_approve()
        _, _, card = self.draft(title="Reply to Sam")
        answers.answer(self.core, card["id"], "approve")
        calls = []

        def judge(argv, p):
            calls.append(p)
            return json.dumps({"points": ["x"], "missed": [], "added": ["rest by Friday"]})
        got = draft_evals.score_history(self.core, runner=judge)
        self.assertEqual(len(calls), 1, "a draft approved as written needs no judging")
        self.assertEqual((got["drafts"], got["edited"], got["approved_as_written"], got["added_points"]), (2, 1, 1, 1))

    def test_each_approved_draft_becomes_a_personal_case_once(self):
        self.edit_and_approve()
        self.assertEqual(draft_evals.collect(self.core), 1)
        self.assertEqual(draft_evals.collect(self.core), 0)
        [c] = evals.cases(self.core, "draft")
        self.assertEqual((c["input"]["draft"], c["expected"]["reference"]), (WROTE, SENT))
        self.assertIsNotNone(c["expires_at"], "what you sent is kept 90 days, like any real case")

    def test_the_tick_collects_them(self):
        self.edit_and_approve()
        self.assertEqual(scheduler.tick(self.core)["draft_cases"], 1)

    def test_a_run_writes_fresh_drafts_and_scores_them(self):
        self.edit_and_approve()
        draft_evals.collect(self.core)

        def model(argv, p):
            if p.startswith("You are Fuzz's executor"):
                return "Numbers attached; two vendors still owe invoices." if "Priya" in p else "A fine draft."
            if p.startswith("Check a draft"):
                return json.dumps({"broken": []})
            return json.dumps({"points": ["x"], "missed": [], "added": []})
        run = draft_evals.run(self.core, runner=model)
        self.assertEqual({r["scope"] for r in run["results"]}, {"global", "personal"})
        self.assertTrue(all(r["passed"] for r in run["results"]))
        personal = next(r for r in run["results"] if r["scope"] == "personal")
        self.assertLess(personal["replies"][0]["changed"], 1.0)

    def test_a_draft_that_breaks_a_global_rule_fails(self):
        def model(argv, p):
            if p.startswith("Check a draft"):
                return json.dumps({"broken": ["It doesn't promise a date"]})
            return "I'll send it all by Friday."
        run = draft_evals.run(self.core, sets="global", runner=model)
        self.assertFalse(any(r["passed"] for r in run["results"]))

    def test_the_drafting_rules_come_from_the_executor_skill(self):
        text, version, copy = draft_evals.skill_text()
        rules = draft_evals.drafting_rules(text)
        self.assertIn("Write drafts to be sent", rules)
        self.assertIn("save_draft", rules)
        self.assertTrue(version.startswith("executor-"))


class StyleLearner(Base):
    def lessons(self):
        return {r["key"]: r for r in self.core.all("SELECT * FROM lessons WHERE surface='draft' AND status!='retired'")}

    def test_twice_is_proposed_three_times_is_in_use(self):
        for n in range(2):
            self.edit_and_approve(title=f"Reply {n}")
        learning.run(self.core)
        got = self.lessons()
        self.assertEqual(got["draft:no_greeting"]["status"], "proposed")
        self.edit_and_approve(title="Reply 3")
        learning.run(self.core)
        got = self.lessons()
        self.assertEqual(got["draft:no_greeting"]["status"], "testing", "the evidence agrees: now its eval decides")
        self.assertIn("3 of their last 3", got["draft:no_greeting"]["rule"])
        learning.scored(self.core, [got["draft:no_greeting"]["id"]], 1, True)
        self.assertEqual(self.lessons()["draft:no_greeting"]["status"], "active")
        self.edit_and_approve(title="Reply 4")
        learning.run(self.core)
        self.assertEqual(self.lessons()["draft:no_greeting"]["status"], "active", "new counts are new wording, not a new rule")

    def test_a_style_lesson_is_tried_on_the_draft_evals(self):
        for n in range(3):
            self.edit_and_approve(title=f"Reply {n}")
        learning.run(self.core)
        x = self.lessons()["draft:no_greeting"]
        run = draft_evals.run(self.core, sets="global", runner=lambda argv, p: '{"broken": []}', trying=x["id"])
        self.assertIn(x["id"], [y["id"] for y in run["lessons"]])
        self.assertEqual((self.lessons()["draft:no_greeting"]["status"], self.lessons()["draft:no_greeting"]["eval_run"]),
                         ("active", run["id"]))

    def test_the_executor_reads_them_from_whoami(self):
        for n in range(3):
            self.edit_and_approve(title=f"Reply {n}")
        learning.run(self.core)
        learning.scored(self.core, [self.lessons()["draft:no_greeting"]["id"]], 1, True)
        w = tools.whoami(self.core, "executor")
        self.assertIn("How this person writes", w["draft_lessons"])
        self.assertIn("Leave out the greeting", w["draft_lessons"])
        self.assertNotIn("draft_lessons", tools.whoami(self.core, "extractor"))

    def test_nothing_learned_without_edits(self):
        _, _, card = self.draft()
        answers.answer(self.core, card["id"], "approve")
        learning.run(self.core)
        self.assertEqual(self.lessons(), {})
        self.assertNotIn("draft_lessons", tools.whoami(self.core, "executor"))
