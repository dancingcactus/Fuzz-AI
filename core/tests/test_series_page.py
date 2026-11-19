"""The Series page and a series' own page (docs/series.md, "Built"): the line that says what it is, what moved
last, its people with how they're in it, the files Fuzz wrote for its tasks, and the facts you confirm or remove
(with Undo)."""

import os
import tempfile

from test_http import Server
from test_series import SeriesCase

from fuzz import outputs
from fuzz.memory import facts
from fuzz.series import record, views


class About(SeriesCase):
    def test_without_a_goal_the_line_comes_from_its_tasks_and_is_a_guess(self):
        sid = self.make_series()
        s = views.summary(self.core, record.get(self.core, sid))
        self.assertEqual((s["about_how"], s["about_guess"], s["about_fact_id"]), ("tasks", True, None))
        self.assertTrue(s["about"].startswith("From 4 tasks"), s["about"])
        self.assertIn("like “", s["about"])
        self.assertIn(s["last"]["id"], self.members(sid))
        self.assertTrue(s["last"]["title"] and s["last"]["at"])

    def test_a_goal_fuzz_noticed_is_a_guess_until_you_say_so(self):
        sid = self.make_series()
        eid = record.get(self.core, sid)["entity_id"]
        fid, _ = facts.add(self.core, eid, "goal", "Get Northwind onto always-on testing", source_ref="a")
        s = views.summary(self.core, record.get(self.core, sid))
        self.assertEqual((s["about"], s["about_how"], s["about_guess"], s["about_fact_id"]),
                         ("Get Northwind onto always-on testing", "goal", True, fid))
        facts.confirm(self.core, fid)
        s = views.summary(self.core, record.get(self.core, sid))
        self.assertEqual((s["about_guess"], s["about_fact_id"]), (False, None))

    def test_a_goal_you_wrote_is_not_a_guess(self):
        sid = self.make_series()
        facts.edit(self.core, record.get(self.core, sid)["entity_id"], "goal", "Northwind on always-on testing")
        s = views.summary(self.core, record.get(self.core, sid))
        self.assertEqual((s["about"], s["about_guess"]), ("Northwind on always-on testing", False))


class Sheet(SeriesCase):
    def test_people_come_with_how_many_tasks_and_how_they_are_in_it(self):
        sid = self.make_series()
        sh = views.sheet(self.core, sid)
        self.assertTrue(sh["people"])
        for p in sh["people"]:
            self.assertEqual(set(p), {"name", "tasks", "how"})
        counts = [p["tasks"] for p in sh["people"]]
        self.assertEqual(counts, sorted(counts, reverse=True), "the most involved first")

    def test_the_files_fuzz_wrote_for_its_tasks(self):
        sid = self.make_series()
        self.assertEqual(views.sheet(self.core, sid)["artifacts"], [])
        with tempfile.TemporaryDirectory() as d:
            self.core.update_config(lambda c: c.__setitem__("output", {"folder": d}))
            tid = self.members(sid)[0]
            path = outputs.save_markdown(self.core, tid, "Pilot plan - Result.md", "# Pilot plan\n")
            self.assertTrue(path and os.path.exists(path))
            arts = views.sheet(self.core, sid)["artifacts"]
            self.assertEqual([(a["name"], a["kind"], a["task"]["id"]) for a in arts], [("Pilot plan - Result.md", "markdown", tid)])
            self.assertEqual(outputs.for_tasks(self.core, []), [])


class Api(Server, SeriesCase):
    def test_looks_right_confirms_the_goal_and_the_x_removes_a_fact_with_undo(self):
        sid = self.make_series()
        eid = record.get(self.core, sid)["entity_id"]
        fid, _ = facts.add(self.core, eid, "goal", "Get Northwind onto always-on testing", source_ref="a")
        status, sh = self.req("POST", f"/series/{sid}/facts", {"fact_id": fid, "confirm": True})
        self.assertEqual((status, sh["about_guess"]), (200, False))
        sfid, _ = facts.add(self.core, eid, "status", "Waiting on legal", source_ref="b")
        status, sh = self.req("POST", f"/series/{sid}/facts", {"fact_id": sfid})
        self.assertEqual(status, 200)
        self.assertNotIn("status", [k["attr"] for k in sh["knows"]])
        group = [u for u in self.req("GET", "/undo")[1]["recent"] if u["by"] == "human"][0]["group"]
        self.assertEqual(self.req("POST", "/undo", {"group": group})[0], 200)
        self.assertIn("status", [k["attr"] for k in self.req("GET", f"/series/{sid}")[1]["knows"]])

    def test_a_fact_from_another_series_is_refused(self):
        from fuzz.series import ask
        sid = self.make_series()
        other = ask.start(self.core, "Hiring a staff engineer", None, "Hiring")["series_id"]
        fid = facts.edit(self.core, record.get(self.core, other)["entity_id"], "goal", "Fill the staff engineer role")
        self.assertEqual(self.req("POST", f"/series/{sid}/facts", {"fact_id": fid})[0], 400)
        self.assertEqual(self.req("POST", f"/series/{sid}/facts", {"fact_id": fid, "confirm": True})[0], 400)
        self.assertEqual(self.req("POST", f"/series/{sid}/facts", {"fact_id": 999999})[0], 404)
        self.assertIn("goal", [k["attr"] for k in self.req("GET", f"/series/{other}")[1]["knows"]])
