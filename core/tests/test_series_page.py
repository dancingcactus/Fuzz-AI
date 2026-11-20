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


class KeepsWorkOut(SeriesCase):
    """How Fuzz spots it, both ways: what brings work in and what keeps it out ("Not part of it")."""

    def test_new_work_that_says_an_excluded_word_does_not_join(self):
        from fuzz import events
        sid = self.make_series()
        record.edit_anchors(self.core, sid, exclude=["login bug"])
        sh = views.sheet(self.core, sid)
        self.assertEqual([a["label"] for a in sh["excluded_anchors"]], ["the words “login bug”"])
        self.assertNotIn("word:login bug", [a["key"] for a in sh["anchors"]], "a word that keeps work out never brings it in")
        self.northwind(2, start=4)   # "Share the Northwind test results", "Fix the Northwind login bug"
        titles = [r["title"] for r in self.core.all("SELECT title FROM tasks WHERE series_id=?", (sid,))]
        self.assertIn("Share the Northwind test results", titles)
        self.assertNotIn("Fix the Northwind login bug", titles)
        self.assertEqual(events.check_replay(self.core), [])

    def test_the_preview_says_what_it_would_keep_out_and_what_is_already_in(self):
        sid = self.make_series()
        p = record.preview_anchors(self.core, sid, exclude=["kickoff"])
        self.assertEqual([t["title"] for t in p["already_in"]], ["Book the Northwind kickoff room"])
        self.assertEqual(p["would_keep_out"], [])

    def test_taking_it_back_lets_that_work_join_again(self):
        sid = self.make_series()
        record.edit_anchors(self.core, sid, exclude=["login bug"])
        record.edit_anchors(self.core, sid, unexclude=["word:login bug"])
        sh = views.sheet(self.core, sid)
        self.assertEqual(sh["excluded_anchors"], [])
        self.assertNotIn("word:login bug", [a["key"] for a in sh["removed_anchors"]], "taking it back isn't a removal")
        self.northwind(2, start=4)
        self.assertIn("Fix the Northwind login bug",
                      [r["title"] for r in self.core.all("SELECT title FROM tasks WHERE series_id=?", (sid,))])


class ForMany(Server, SeriesCase):
    def test_for_takes_several_people_ignores_a_repeat_and_removes_one_with_undo(self):
        sid = self.make_series()
        for who in ("Acme", "Lena Fischer", "acme"):
            self.assertEqual(self.req("POST", f"/series/{sid}/facts", {"attr": "for", "value": who})[0], 200)
        sh = self.req("GET", f"/series/{sid}")[1]
        fors = [k for k in sh["knows"] if k["attr"] == "for"]
        self.assertEqual(sorted(k["value"] for k in fors), ["Acme", "Lena Fischer"])
        status, sh = self.req("POST", f"/series/{sid}/facts", {"fact_id": fors[0]["fact_id"]})
        self.assertEqual([k["value"] for k in sh["knows"] if k["attr"] == "for"], [fors[1]["value"]])
        group = [u for u in self.req("GET", "/undo")[1]["recent"] if u["by"] == "human"][0]["group"]
        self.assertEqual(self.req("POST", "/undo", {"group": group})[0], 200)
        self.assertEqual(len([k for k in self.req("GET", f"/series/{sid}")[1]["knows"] if k["attr"] == "for"]), 2)


class SeveralAtOnce(Server, SeriesCase):
    def test_several_people_in_one_save_are_one_undo(self):
        sid = self.make_series()
        status, sh = self.req("POST", f"/series/{sid}/facts", {"attr": "for", "values": ["Acme", "Lena Fischer", "acme"]})
        self.assertEqual(status, 200)
        self.assertEqual(sorted(k["value"] for k in sh["knows"] if k["attr"] == "for"), ["Acme", "Lena Fischer"])
        group = [u for u in self.req("GET", "/undo")[1]["recent"] if u["by"] == "human"][0]["group"]
        self.assertEqual(self.req("POST", "/undo", {"group": group})[0], 200)
        self.assertEqual([k for k in self.req("GET", f"/series/{sid}")[1]["knows"] if k["attr"] == "for"], [], "one Undo, all of them")

    def test_owner_and_blocked_on_take_several_on_a_series_and_people_marks_every_owner(self):
        sid = self.make_series()
        self.req("POST", f"/series/{sid}/facts", {"attr": "owner", "values": ["Ana Costa", "Ben Okafor"]})
        self.req("POST", f"/series/{sid}/facts", {"attr": "blocked_on", "values": ["Legal review", "Ben Okafor"]})
        sh = self.req("GET", f"/series/{sid}")[1]
        self.assertEqual(sorted(k["value"] for k in sh["knows"] if k["attr"] == "owner"), ["Ana Costa", "Ben Okafor"])
        self.assertEqual(len([k for k in sh["knows"] if k["attr"] == "blocked_on"]), 2)
        self.assertEqual(sorted(facts.winners(self.core, record.get(self.core, sid)["entity_id"])["owner"]), ["Ana Costa", "Ben Okafor"])

    def test_a_single_fact_refuses_a_list(self):
        sid = self.make_series()
        self.assertEqual(self.req("POST", f"/series/{sid}/facts", {"attr": "goal", "values": ["One", "Two"]})[0], 400)
        self.assertEqual(self.req("POST", f"/series/{sid}/facts", {"attr": "for", "values": []})[0], 400)

    def test_owner_stays_single_on_other_kinds_of_things(self):
        from fuzz.matching import entities
        with self.core.tx():
            eid, _ = entities.resolve_ticket(self.core, "NW-342")
        facts.add(self.core, eid, "owner", "Ana Costa", source_ref="a")
        facts.add(self.core, eid, "owner", "Ben Okafor", source_ref="b")
        self.assertIsInstance(facts.winners(self.core, eid)["owner"], str)
        self.assertTrue(facts.single("ticket", "owner"))
        self.assertFalse(facts.single("series", "owner"))


class ExcludeApi(Server, SeriesCase):
    def test_exclude_through_the_api_with_undo(self):
        sid = self.make_series()
        status, p = self.req("POST", f"/series/{sid}/preview", {"exclude": ["login bug"]})
        self.assertEqual((status, set(p) >= {"would_keep_out", "already_in"}), (200, True))
        status, sh = self.req("POST", f"/series/{sid}/anchors", {"exclude": ["login bug"]})
        self.assertEqual((status, [a["key"] for a in sh["excluded_anchors"]]), (200, ["word:login bug"]))
        group = [u for u in self.req("GET", "/undo")[1]["recent"] if u["by"] == "human"][0]["group"]
        self.assertEqual(self.req("POST", "/undo", {"group": group})[0], 200)
        self.assertEqual(self.req("GET", f"/series/{sid}")[1]["excluded_anchors"], [])
        self.assertEqual(self.req("POST", f"/series/{sid}/anchors", {"exclude": "login bug"})[0], 400)
