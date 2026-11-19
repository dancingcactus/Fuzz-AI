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

    def series(self, name, tids, state="inferred", origin="inferred"):
        sid = self.core.q("INSERT INTO series (user_id, kind, name, state, origin, created_at) VALUES (?,?,?,?,?,?)",
                          (self.core.user_id, "series", name, state, origin, self.core.now_iso())).lastrowid
        for t in tids:
            self.core.q("UPDATE tasks SET series_id=? WHERE id=?", (sid, t))
        return sid

    def test_a_series_fuzz_started_shows_once_by_its_name(self):
        a = tasks.capture(self.core, "Draft the pilot plan")
        b = tasks.capture(self.core, "Book the Northwind kickoff")
        self.clock.advance(hours=3)
        sid = self.series("Northwind rollout", [a, b])
        with self.core.tx("fuzz:extractor"):
            events.emit(self.core, "series.inferred", data={"series_id": sid, "tasks": [a, b]})
        with self.core.tx("system"):
            events.emit(self.core, "series.inferred", data={"series_id": sid, "from": "forming"})
        s = away.summary(self.core)
        self.assertEqual(s["counts"], {"series": 1})
        [i] = s["items"]
        self.assertEqual((i["kind"], i["series_id"], i["title"]), ("series", sid, "Northwind rollout"))
        self.assertIn("2 tasks", i["text"])

    def test_split_parts_count_but_areas_and_forming_ones_do_not(self):
        a = tasks.capture(self.core, "One")
        self.clock.advance(hours=3)
        part = self.series("Report builder launch", [a])
        forming = self.series("Maybe something", [], state="forming")
        with self.core.tx("fuzz:extractor"):
            events.emit(self.core, "series.split", data={"parts": [
                {"series_id": part, "state": "inferred", "tasks": [a]},
                {"series_id": forming, "state": "forming", "tasks": []},
                {"series_id": 999, "area": True}]})
        s = away.summary(self.core)
        self.assertEqual([(i["kind"], i["title"]) for i in s["items"]], [("series", "Report builder launch")])
        self.assertIn("1 task that", s["items"][0]["text"])

    def test_dropped_series_and_ones_you_started_are_left_out(self):
        self.clock.advance(hours=3)
        gone = self.series("Merged away", [], state="dropped")
        mine = self.series("Mine", [], origin="asked")
        for sid in (gone, mine):
            with self.core.tx("fuzz:extractor"):
                events.emit(self.core, "series.inferred", data={"series_id": sid})
        theirs = self.series("You split it", [], origin="split")
        with self.core.tx("human"):
            events.emit(self.core, "series.split", data={"parts": [{"series_id": theirs, "state": "inferred"}]})
        self.assertNotIn("series", away.summary(self.core)["counts"])

    def emit_series(self, type, data, actor="fuzz:extractor"):
        with self.core.tx(actor):
            events.emit(self.core, type, data=data)

    def test_a_series_fuzz_found_finished_shows_with_its_evidence(self):
        a = tasks.capture(self.core, "Ship the deck")
        self.clock.advance(hours=3)
        sid = self.series("Strategy deck", [a], state="wrapped")
        self.emit_series("series.inferred", {"series_id": sid})   # started and finished while you were away
        self.emit_series("series.wrapped", {"series_id": sid, "evidence": "Priya replied to the review email"},
                         actor="fuzz:executor")
        s = away.summary(self.core)
        self.assertEqual(s["counts"], {"wrapped": 1})
        [i] = s["items"]
        self.assertEqual((i["kind"], i["title"]), ("wrapped", "Strategy deck"))
        self.assertIn("Priya replied", i["text"])

    def test_a_finish_you_undid_or_reopened_is_left_out(self):
        self.clock.advance(hours=3)
        sid = self.series("Strategy deck", [], state="named")   # season 2 since
        self.emit_series("series.wrapped", {"series_id": sid, "evidence": "Done"}, actor="fuzz:executor")
        self.assertEqual(away.summary(self.core)["counts"], {})

    def test_a_split_is_one_line_and_its_parts_are_not_new_again(self):
        a, b, c = (tasks.capture(self.core, t) for t in ("Pilot plan", "Kickoff", "Hiring loop"))
        self.clock.advance(hours=3)
        p1 = self.series("Northwind rollout", [a, b])
        p2 = self.series("Hiring a staff engineer", [c])
        self.emit_series("series.split", {"parts": [{"series_id": p1, "state": "inferred"},
                                                     {"series_id": p2, "state": "forming"}]})
        self.emit_series("series.inferred", {"series_id": p2, "from": "forming"}, actor="system")
        s = away.summary(self.core)
        self.assertEqual(s["counts"], {"split": 1})
        [i] = s["items"]
        self.assertEqual(i["title"], "Northwind rollout and Hiring a staff engineer")
        self.assertIn("3 tasks were 2 separate pieces of work", i["text"])

    def test_an_existing_series_fuzz_split_names_where_it_came_from(self):
        self.clock.advance(hours=3)
        src = self.series("Q4 everything", [], state="named")
        p1, p2 = self.series("Budget", [], origin="split"), self.series("Offsite", [], origin="split")
        self.emit_series("series.split", {"from": src, "parts": [{"series_id": p1}, {"series_id": p2}]}, actor="system")
        [i] = away.summary(self.core)["items"]
        self.assertEqual((i["kind"], i["title"], i["text"]), ("split", "Q4 everything", "Fuzz split it into Budget and Offsite."))

    def test_series_sit_alongside_task_kinds(self):
        a = tasks.capture(self.core, "Send Priya the deck")
        self.clock.advance(hours=3)
        self.fuzz("task.done", a, "Fuzz marked this done.", changes={"tasks": {str(a): {"state": "done"}}})
        sid = self.series("Northwind rollout", [a])
        with self.core.tx("fuzz:extractor"):
            events.emit(self.core, "series.inferred", data={"series_id": sid})
        s = away.summary(self.core)
        self.assertEqual(list(s["counts"]), ["closed", "series"])
        self.assertEqual([i["kind"] for i in s["items"]], ["closed", "series"])


if __name__ == "__main__":
    unittest.main()
