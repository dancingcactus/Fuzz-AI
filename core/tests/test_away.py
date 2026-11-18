"""While you were away: the Guide's summary of what Fuzz did on its own."""

import unittest

from helpers import CoreCase

from fuzz import away, events, tasks


class Away(CoreCase):
    def fuzz(self, type, tid, text, actor="fuzz:extractor", changes=None):
        with self.core.tx(actor):
            events.emit(self.core, type, task_id=tid, changes=changes, log=("status", text))

    def test_at_least_two_hours_back_when_you_were_just_here(self):
        tasks.capture(self.core, "Something I typed")   # you, just now
        self.clock.advance(minutes=10)
        s = away.summary(self.core)
        self.assertEqual(s["since"], "2026-10-20T07:10:00Z")
        self.assertEqual(s["last_here"], "2026-10-20T09:00:00Z")

    def test_back_to_the_last_thing_you_did_when_longer(self):
        tasks.capture(self.core, "Something I typed")
        self.clock.advance(hours=14)
        self.assertEqual(away.summary(self.core)["since"], "2026-10-20T09:00:00Z")

    def test_what_fuzz_did_counts_what_you_did_does_not(self):
        a = tasks.capture(self.core, "Send Priya the deck")
        b = tasks.capture(self.core, "Get the SOW back")
        c = tasks.capture(self.core, "Look at the budget")
        self.clock.advance(hours=3)
        self.fuzz("task.done", a, "You answered in Email: “Sent it”. Fuzz marked this done.",
                  changes={"tasks": {str(a): {"state": "done"}}})
        self.fuzz("task.waiting", b, "Fuzz moved this to waiting on Dana.",
                  changes={"tasks": {str(b): {"state": "waiting", "waiting_on": "Dana"}}})
        self.fuzz("task.reply_in", b, "Dana replied", changes={"tasks": {str(b): {"effort_mins": 10}}})
        self.fuzz("task.reply_in", c, "Someone said thanks")   # read, changed nothing
        with self.core.tx("human"):
            events.emit(self.core, "task.done", task_id=c, changes={"tasks": {str(c): {"state": "done"}}})
        s = away.summary(self.core)
        self.assertEqual(s["counts"], {"closed": 1, "waiting": 1, "updated": 1})
        self.assertEqual([(i["kind"], i["task_id"]) for i in s["items"]], [("closed", a), ("waiting", b)])
        self.assertIn("Sent it", s["items"][0]["text"])

    def test_a_close_you_undid_is_left_out(self):
        a = tasks.capture(self.core, "Send Priya the deck")
        self.clock.advance(hours=3)
        self.fuzz("task.done", a, "Fuzz marked this done.", changes={"tasks": {str(a): {"state": "done"}}})
        with self.core.tx("human"):
            events.emit(self.core, "task.reopened", task_id=a, changes={"tasks": {str(a): {"state": "triage"}}})
        self.clock.advance(minutes=5)
        self.assertNotIn("closed", away.summary(self.core)["counts"])


if __name__ == "__main__":
    unittest.main()
