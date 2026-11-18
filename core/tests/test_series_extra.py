"""Series, the rest of docs/series.md: email lists as anchors, anchors as the series entity's identifiers, the usual
next step mined from its history, Not needed feeding lessons and eval cases, series weighing the queue, and New
task's + → Person, Source and Artifact."""

import json

from test_http import Server
from test_series import SeriesCase, sig

from fuzz import answers, cards, learning, tasks, tools
from fuzz.db import FuzzError
from fuzz.series import ask, record, suggest
from fuzz.series import index as index_mod


class Lists(SeriesCase):
    def test_an_address_shaped_like_a_list_that_never_writes_is_an_anchor(self):
        sigs = []
        for i in range(4):
            s = sig(i + 1, f"Northwind step {i}", day=i, who=["Ann Bee", "Cal Dee", "Eve Fox", "Gil Hay"][i])
            s["people"] = [{"name": "Northwind all", "email": "northwind-all@example.com"}, {"name": "Ann Bee", "email": "ann@example.com"}]
            sigs.append(s)
        self.submit(sigs)
        idx = index_mod.Index(self.core)
        self.assertIn("list:northwind-all@example.com", idx.index)
        self.assertNotIn("list:ann@example.com", idx.index)   # ann writes mail: a person

    def test_you_can_add_an_email_list(self):
        sid = self.make_series()
        record.edit_anchors(self.core, sid, add=["northwind-pilot@example.com"])
        self.assertIn("list:northwind-pilot@example.com", index_mod.Index(self.core).anchors(sid))


class Identifiers(SeriesCase):
    def test_anchors_are_the_series_entitys_identifiers(self):
        sid = self.make_series()
        s = record.get(self.core, sid)
        rows = self.core.all("SELECT value FROM identifiers WHERE type='anchor' AND entity_id=?", (s["entity_id"],))
        keys = {r["value"].rsplit("#s", 1)[0] for r in rows}
        self.assertEqual(keys, set(index_mod.Index(self.core).anchors(sid)))
        k = next(iter(keys))
        self.assertEqual(record.series_for_anchor(self.core, k), [sid])
        record.edit_anchors(self.core, sid, remove=[k])
        self.assertEqual(record.series_for_anchor(self.core, k), [])


class UsualNext(SeriesCase):
    def test_a_step_on_a_rhythm_that_isnt_started_is_suggested(self):
        sid = self.make_series()
        for week in range(3):
            tid = tasks.capture(self.core, f"Send Priya the Northwind status note, Oct {20 + 7 * week}")
            record.link(self.core, tid, sid)
            tasks.done(self.core, tid)
            self.clock.advance(days=7)
        found = suggest.detect(self.core, record.get(self.core, sid), index_mod.Index(self.core))
        usual = [x for x in found if x["detector"] == "usual_next"]
        self.assertEqual(len(usual), 1)
        self.assertIn("every week", usual[0]["why"])
        self.assertEqual(suggest.gist("Send Priya the status note, Nov 14"), suggest.gist("Send Priya the status note Nov 21"))


class NotNeeded(SeriesCase):
    def stall_card(self, sid, n):
        t = self.core.one("SELECT id FROM tasks WHERE series_id=? AND state='waiting'", (sid,))
        with self.core.tx("system"):
            return cards.create(self.core, "series_next", None, prompt="Next", reason="why",
                                payload={"series_id": sid, "detector": "stall", "key": f"stall:x{n}", "title": "Nudge Dana"})

    def test_two_not_needed_become_a_lesson_and_each_outcome_an_eval_case(self):
        sid = self.make_series()
        tasks.wait(self.core, self.members(sid)[0], "Dana Ito")
        for n in range(2):
            answers.answer(self.core, self.stall_card(sid, n), "not_needed")
        learning.run(self.core)
        lesson = self.core.one("SELECT * FROM lessons WHERE surface='series_suggest'")
        self.assertEqual((lesson["status"], lesson["key"]), ("active", f"series:{sid}:stall"))
        cases = self.core.all("SELECT kind FROM eval_cases WHERE surface='series_suggest'")
        self.assertEqual([c["kind"] for c in cases], ["not_needed", "not_needed"])
        self.clock.advance(days=12)
        self.assertEqual(suggest.run(self.core), 0, "no more nudges in this series")


class Ranking(SeriesCase):
    def test_a_task_in_a_moving_series_comes_first_among_equals(self):
        lone = tasks.capture(self.core, "Water the plants")
        sid = self.make_series()
        mine = self.members(sid)[-1]
        order = [c["task_id"] for c, _ in cards.queue(self.core) if c["task_id"] in (lone, mine)]
        self.assertEqual(order, [mine, lone])
        record.mute(self.core, sid)
        order = [c["task_id"] for c, _ in cards.queue(self.core) if c["task_id"] in (lone, mine)]
        self.assertEqual(order, [lone, mine])


class Refs(SeriesCase):
    def test_person_source_and_artifact_join_the_task(self):
        tid = tasks.capture(self.core, "Q1 pricing change")
        other = tasks.capture(self.core, "Write the pricing memo")
        art = self.core.q("INSERT INTO sources (user_id, task_id, role, title, path) VALUES (1,?,?,?,?)",
                          (other, "output", "pricing-memo.md", "/tmp/pricing-memo.md")).lastrowid
        n = tasks.add_refs(self.core, tid, people=[{"name": "Alex Kim", "email": "alex@example.com", "role": "for"}],
                           links=["https://example.slack.com/archives/C1/p123"], artifacts=[art])
        self.assertEqual(n, 3)
        roles = {r["role"] for r in self.core.all("SELECT role FROM sources WHERE task_id=?", (tid,))}
        self.assertLessEqual({"artifact", "link", "person"}, roles)
        from fuzz import people
        self.assertIn("Alex Kim", [p["name"] for p in people.for_task(self.core, self.task(tid))])
        with self.assertRaises(FuzzError):
            tasks.add_refs(self.core, tid, links=["not a link"])
        with self.assertRaises(FuzzError):
            tasks.add_refs(self.core, tid, people=[{"name": "X", "role": "sideways"}])


class RefsApi(Server, SeriesCase):
    def test_refs_and_people_search(self):
        self.northwind(2)
        status, out = self.req("GET", "/people?q=priya")
        self.assertEqual((status, [p["name"] for p in out["people"]]), (200, ["Priya Shah"]))
        tid = self.req("POST", "/tasks", {"text": "Northwind recap"})[1]["task_id"]
        status, t = self.req("POST", f"/tasks/{tid}/refs", {"people": [{"name": "Priya Shah", "role": "about"}],
                                                          "links": ["https://wiki.example.com/northwind"]})
        self.assertEqual((status, t["added"]), (200, 2))
