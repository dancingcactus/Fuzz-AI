"""The voice comparison: each draft case written with and without your messages as examples (draft_evals,
docs/voice.md). Every person and message here is invented."""

import json

from helpers import CoreCase

from fuzz import answers, draft_evals, drafts, scheduler, tasks, voice, voice_evals

SENT = "numbers are in the folder, two vendors still owe invoices"


class Compare(CoreCase):
    def setUp(self):
        super().setUp()
        voice.submit(self.core, [
            {"source": "slack", "source_id": f"D1:{i}", "ts": f"2026-10-1{i}T10:00:00Z",
             "text": f"week {i} looks fine, shipping it", "to": [{"name": "Priya Shah", "slack_id": "UPRIYA"}]}
            for i in range(5)])
        self.clock.advance(days=1)
        tid = tasks.capture(self.core, "Reply to Priya")
        tasks.assign(self.core, tid)
        scheduler.claim_next(self.core, tid)
        drafts.save_draft(self.core, tid, "slack.message", "Priya Shah", "Hi Priya, I hope you're well. The numbers...")
        card = self.card_for(tid, "draft")
        answers.answer(self.core, card["id"], "edit", SENT)
        answers.answer(self.core, card["id"], "approve")
        draft_evals.collect(self.core)
        self.prompts = []

    def model(self, argv, p):
        self.prompts.append(p)
        if p.startswith("You are Fuzz's executor"):
            return "week's numbers are in, two vendors still owe" if "week 4 looks fine" in p else "Hi Priya, all set."
        if p.startswith("Below are messages"):   # blind: take the lower-case one for theirs
            a = p.split("\nA:\n", 1)[1].split("\n\nB:\n")[0]
            return json.dumps({"person": "A" if json.loads(a)[:1].islower() else "B"})
        return json.dumps({"points": ["x"], "missed": [], "added": []})

    def test_with_examples_reads_like_them_and_never_sees_its_answer(self):
        got = voice_evals.voice_compare(self.core, runner=self.model)
        self.assertEqual((got["cases"], got["with_examples"]), (1, 1))
        self.assertEqual(got["arms"]["without"]["picked_share"], 0.0)
        self.assertEqual(got["arms"]["with"]["picked_share"], 0.5, "lower case like theirs: the judge can't tell")
        drafting = [p for p in self.prompts if p.startswith("You are Fuzz's executor")]
        self.assertEqual(len(drafting), 2)
        self.assertNotIn("week 0 looks fine", drafting[0], "the without arm has no examples")
        with_arm = drafting[1].split("It returned")[1].split("The task and what you found")[0]
        self.assertNotIn(SENT, with_arm, "a case never sees what you sent for it")
        self.assertIn("week 4 looks fine", with_arm)
        self.assertEqual(sum(p.startswith("Below are messages") for p in self.prompts), 4, "both orders, both arms")

    def test_examples_written_after_the_draft_are_left_out(self):
        self.clock.advance(days=2)
        voice.submit(self.core, [{"source": "slack", "source_id": "D1:late", "ts": "2026-10-25T10:00:00Z",
                                  "text": "later message, after the draft", "to": [{"name": "Priya Shah"}]}])
        voice_evals.voice_compare(self.core, runner=self.model)
        self.assertFalse(any("later message" in p for p in self.prompts))
