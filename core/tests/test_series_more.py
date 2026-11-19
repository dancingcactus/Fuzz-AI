"""Series, continued (docs/series.md): facts, starting one yourself, the cards, suggestions, Focus, the page and
sheet, and the HTTP surface. Detection and the record are in test_series.py."""

from test_http import Server
from test_series import SeriesCase, sig

from fuzz import actions, answers, cards, focus, tasks, tools
from fuzz.db import FuzzError
from fuzz.series import ask, record, suggest, views
from fuzz.series import index as index_mod


class Facts(SeriesCase):
    def test_series_facts_are_allowlisted_and_status_is_only_rewritten_on_a_real_change(self):
        from fuzz.memory import facts
        sid = self.make_series()
        eid = record.get(self.core, sid)["entity_id"]
        with self.assertRaises(FuzzError):
            facts.add(self.core, eid, "favourite_food", "Pizza")
        with self.assertRaises(FuzzError):   # a state, not an activity
            facts.add(self.core, eid, "done_when", "Work on the pilot")
        f1, made = facts.add(self.core, eid, "status", "Waiting on Northwind legal's review", source_ref="a")
        self.assertTrue(made)
        f2, made = facts.add(self.core, eid, "status", "Waiting on Northwind legal's review.", source_ref="b")
        self.assertEqual((f2, made), (f1, False))
        _, made = facts.add(self.core, eid, "status", "Legal signed off; scheduling go-live", source_ref="c")
        self.assertTrue(made)

    def test_the_extractor_names_a_series_by_its_lookup_id(self):
        sid = self.make_series()
        look = tools.get_lookups(self.core)["series"]
        self.assertEqual([s["id"] for s in look], [sid])
        s = sig(50, "Thanks!", day=5)
        s["candidates"] = []
        s["facts"] = [{"about": {"type": "series", "id": sid}, "attr": "next_milestone", "value": "Pilot go-live, Jan 15"}]
        tools.submit_signals(self.core, [s])
        self.assertEqual(tools.get_lookups(self.core)["series"][0]["next_milestone"], "Pilot go-live, Jan 15")

    def test_status_ages_in_a_week(self):
        from fuzz.memory import trust
        self.assertEqual(trust.half_life(self.core, "status", "series"), 7)
        self.assertEqual(trust.half_life(self.core, "owner", "series"), 60)
        self.assertEqual(trust.half_life(self.core, "owner", "org"), 120)


class StartingOne(SeriesCase):
    def test_start_gathers_tasks_and_waits_for_your_ok(self):
        from fuzz.memory import facts
        self.northwind(4)
        out = ask.start(self.core, "Northwind pilot")
        s = record.get(self.core, out["series_id"])
        self.assertEqual((s["origin"], s["state"], s["met"]), ("asked", "inferred", 1))
        card = cards.get(self.core, out["card_id"])
        self.assertEqual(card["kind"], "series_new")
        self.assertEqual(len(card["payload"]["tasks"]), 4)
        self.assertEqual(views.page(self.core)["counts"]["new"], 1)   # under New until you say it looks right
        kept = card["payload"]["tasks"][:3]
        answers.answer(self.core, card["id"], "looks_right", {"tasks": kept, "role": "drive",
                                                              "done_when": "The pilot is live and Northwind signed off"})
        s = record.get(self.core, out["series_id"])
        self.assertEqual(s["state"], "named")
        self.assertEqual(self.members(s["id"]), sorted(kept))
        w = facts.winners(self.core, s["entity_id"])
        self.assertEqual((w["your_role"], w["done_when"]), ("drive", "The pilot is live and Northwind signed off"))
        self.assertEqual(views.page(self.core)["counts"], {"new": 0, "going": 1, "quiet": 0, "watching": 0, "wrapped": 0})
        actions.undo(self.core)
        self.assertEqual(len(self.members(s["id"])), 4)

    def test_not_a_series_drops_it(self):
        self.northwind(4)
        out = ask.start(self.core, "Northwind pilot")
        answers.answer(self.core, out["card_id"], "not_series")
        self.assertEqual(record.get(self.core, out["series_id"])["state"], "dropped")

    def test_your_series_wins_over_an_area(self):
        self.northwind(4)
        it = self.items()[0]
        tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "area", "name": "Northwind account"}])
        out = ask.start(self.core, "Northwind pilot")
        self.assertEqual(len(self.members(out["series_id"])), 4)
        self.northwind(1, start=4)
        self.assertEqual(len(self.members(out["series_id"])), 5)


class Cards(SeriesCase):
    def test_role_card_once_and_skipping_means_helping(self):
        sid = self.make_series()
        c = ask.role_card(self.core, record.get(self.core, sid))
        self.assertIsNotNone(c)
        self.assertIsNone(ask.role_card(self.core, record.get(self.core, sid)))
        self.assertEqual(suggest.role(self.core, record.get(self.core, sid)), "contribute")
        answers.answer(self.core, c, "drive")
        self.assertEqual(suggest.role(self.core, record.get(self.core, sid)), "drive")
        self.assertEqual(record.get(self.core, sid)["met"], 1)


class Suggestions(SeriesCase):
    def stalled(self):
        sid = self.make_series()
        t = self.members(sid)[0]
        tasks.wait(self.core, t, "Dana Ito")
        self.clock.advance(days=12)
        return sid, t

    def test_a_stall_with_a_reply_owed_suggests_a_nudge_after_the_role_card(self):
        sid, t = self.stalled()
        self.assertEqual(suggest.run(self.core), 1)
        kinds = [c["kind"] for c in self.open_cards() if c["kind"].startswith("series")]
        self.assertEqual(kinds.count("series_role"), 1)
        nxt = [c for c in self.open_cards() if c["kind"] == "series_next"][0]
        self.assertIn("Dana Ito", nxt["prompt"])
        self.assertEqual(suggest.run(self.core), 0)   # never the same one twice
        answers.answer(self.core, nxt["id"], "add")
        added = [x for x in self.core.all("SELECT * FROM tasks WHERE series_id=?", (sid,)) if "Nudge" in x["title"]]
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0]["state"], "triage")

    def test_ill_do_it_goes_to_my_work(self):
        sid, t = self.stalled()
        suggest.run(self.core)
        nxt = [c for c in self.open_cards() if c["kind"] == "series_next"][0]
        out = answers.answer(self.core, nxt["id"], "mine")
        added = [x for x in self.core.all("SELECT * FROM tasks WHERE series_id=?", (sid,)) if "Nudge" in x["title"]]
        self.assertEqual(added[0]["state"], "deepwork")

    def test_not_needed_is_remembered(self):
        self.stalled()
        suggest.run(self.core)
        nxt = [c for c in self.open_cards() if c["kind"] == "series_next"][0]
        answers.answer(self.core, nxt["id"], "not_needed")
        self.assertEqual(suggest.run(self.core), 0)

    def test_muted_series_get_no_suggestions(self):
        sid, _ = self.stalled()
        record.mute(self.core, sid)
        self.assertEqual(suggest.run(self.core), 0)

    def test_keeping_up_only_gets_what_lands_on_you(self):
        sid = self.make_series()
        ask.role_card(self.core, record.get(self.core, sid))
        record.set_role(self.core, sid, "follow")
        self.assertEqual(suggest.AUDIENCE["follow_through"], ("drive",))
        self.assertIn("follow", suggest.AUDIENCE["stall"])

    def test_a_decision_with_no_follow_through(self):
        from fuzz.memory import knowledge
        sid = self.make_series()
        key = self.core.one("SELECT signal_key FROM sources WHERE task_id=? AND signal_key IS NOT NULL",
                            (self.members(sid)[0],))["signal_key"]
        pid = self.core.one("SELECT id FROM entities WHERE type='person' AND name='Priya Shah'")["id"]
        did, _ = knowledge.add_decision(self.core, "Go with the two-week pilot", decided_at=self.core.now_iso(), source_ref=key,
                                        how="stated", decided_by=pid, said_by=pid, confidence=0.95)
        self.assertEqual(self.core.one("SELECT status FROM decision_log WHERE id=?", (did,))["status"], "recorded")
        self.clock.advance(days=2)
        found = suggest.detect(self.core, record.get(self.core, sid), index_mod.Index(self.core))
        self.assertEqual([x["detector"] for x in found], ["follow_through"])
        self.assertIn("go with the two-week pilot", found[0]["why"])

    def test_milestones_parse_and_prep_comes_close_to_one(self):
        from fuzz.memory import facts
        self.assertEqual(suggest.milestone_date(self.core, "Pilot go-live, 2026-10-30").day, 30)
        self.assertEqual(suggest.milestone_date(self.core, "Go-live Jan 15").year, 2027)
        sid = self.make_series()
        facts.edit(self.core, record.get(self.core, sid)["entity_id"], "next_milestone", "Pilot go-live, 2026-11-01")
        self.clock.advance(days=10)
        found = suggest.detect(self.core, record.get(self.core, sid), index_mod.Index(self.core))
        self.assertIn("prep", [x["detector"] for x in found])


class FocusAndViews(SeriesCase):
    def test_a_series_name_focuses_its_tasks(self):
        sid = self.make_series()
        hits = focus.match(self.core, "the northwind pilot")["tasks"]
        self.assertTrue({h["task_id"] for h in hits} >= set(self.members(sid)))

    def test_page_sections_and_the_sheet(self):
        sid = self.make_series()
        page = views.page(self.core)
        self.assertEqual(page["sections"]["watching"][0]["id"], sid)
        record.name(self.core, sid)
        sh = views.sheet(self.core, sid)
        self.assertEqual(sh["section"], "going")
        self.assertEqual(len(sh["open_tasks"]), 4)
        self.assertTrue(sh["anchors"])

    def test_areas_and_forming_series_never_show(self):
        self.northwind(4)
        it = self.items()[0]
        tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "area", "name": "Northwind account"}])
        self.assertEqual(sum(views.page(self.core)["counts"].values()), 0)


class Api(Server, SeriesCase):
    def test_the_page_sheet_and_actions(self):
        sid = self.make_series()
        status, page = self.req("GET", "/series")
        self.assertEqual((status, page["counts"]["watching"]), (200, 1))
        status, sh = self.req("POST", f"/series/{sid}/keep")
        self.assertEqual((status, sh["section"]), (200, "going"))
        self.assertEqual(self.req("POST", f"/series/{sid}/role", {"role": "drive"})[1]["role"], "drive")
        status, sh = self.req("POST", f"/series/{sid}/add_task", {"text": "Send Northwind the go-live checklist"})
        self.assertEqual(len(sh["open_tasks"]), 5)
        tid = sh["open_tasks"][0]["id"]
        self.assertEqual(self.req("GET", f"/tasks/{tid}")[1]["series"]["id"], sid)
        status, f = self.req("POST", f"/series/{sid}/work_on")
        self.assertEqual(len(f["focus"]["task_ids"]), 5)
        self.assertEqual(self.req("POST", f"/series/{sid}/preview", {"add": ["checklist"]})[0], 200)
        status, sh = self.req("POST", f"/series/{sid}/anchors", {"add": ["checklist"]})
        self.assertIn("word:checklist", [a["key"] for a in sh["anchors"]])
        status, sh = self.req("POST", f"/series/{sid}/facts", {"attr": "goal", "value": "Northwind on always-on testing"})
        self.assertEqual([k["trust_label"] for k in sh["knows"] if k["attr"] == "goal"], ["Confirmed"])
        self.assertEqual(self.req("GET", f"/tasks/{tid}/series")[1]["choices"][0]["series_id"], sid)
        self.assertEqual(self.req("POST", f"/tasks/{tid}/series", {"series_id": None})[0], 200)
        self.assertEqual(self.req("POST", "/series", {"note": "Northwind pilot"})[0], 201)
        self.assertEqual(self.req("GET", "/series/999")[0], 404)


class Splitting(SeriesCase):
    def test_split_makes_named_parts_and_drops_the_original_when_nothing_stays(self):
        from fuzz.memory import facts
        sid = self.make_series(n=6)
        record.set_role(self.core, sid, "drive")
        m = self.members(sid)
        made = record.split(self.core, sid, [{"name": "OEO", "task_ids": m[:2]}, {"name": "Home Depot", "task_ids": m[2:4]},
                                             {"name": "Unipol", "task_ids": m[4:]}])
        self.assertEqual(len(made), 3)
        self.assertEqual(record.get(self.core, sid)["state"], "dropped")
        for nid, want in zip(made, (m[:2], m[2:4], m[4:])):
            s = record.get(self.core, nid)
            self.assertEqual((s["state"], s["origin"], s["met"]), ("named", "split", 1))
            self.assertEqual(self.members(nid), want)
            self.assertEqual(facts.winners(self.core, s["entity_id"])["your_role"], "drive")
            self.assertEqual(views.section(s), "going")
        sh = views.sheet(self.core, made[1])
        self.assertIn("word:home depot", [a["key"] for a in sh["anchors"]])
        actions.undo(self.core)   # one Undo puts it back together
        self.assertNotEqual(record.get(self.core, sid)["state"], "dropped")
        self.assertEqual(self.members(sid), m)

    def test_tasks_left_out_stay_and_bad_parts_are_refused(self):
        sid = self.make_series(n=5)
        m = self.members(sid)
        made = record.split(self.core, sid, [{"name": "Unipol renewal and its follow-ups", "task_ids": m[:2]}])
        self.assertNotEqual(record.get(self.core, sid)["state"], "dropped")
        self.assertEqual(self.members(sid), m[2:])
        self.assertFalse([a for a in views.sheet(self.core, made[0])["anchors"] if a["yours"]])   # a long name isn't a word to spot
        with self.assertRaises(FuzzError):   # a task in two parts
            record.split(self.core, sid, [{"name": "A", "task_ids": m[2:4]}, {"name": "B", "task_ids": m[3:]}])
        with self.assertRaises(FuzzError):   # a task that isn't in it
            record.split(self.core, sid, [{"name": "A", "task_ids": [m[0]]}])
        with self.assertRaises(FuzzError):   # one part with everything is a rename
            record.split(self.core, sid, [{"name": "A", "task_ids": m[2:]}])
        with self.assertRaises(FuzzError):
            record.split(self.core, sid, [{"name": " ", "task_ids": m[2:3]}])


class SplitApi(Server, SeriesCase):
    def test_split_over_http(self):
        sid = self.make_series(n=4)
        m = self.members(sid)
        self.assertEqual(self.req("POST", f"/series/{sid}/split", {"parts": "nope"})[0], 400)
        status, sh = self.req("POST", f"/series/{sid}/split", {"parts": [{"name": "OEO", "task_ids": m[:2]},
                                                                          {"name": "Unipol", "task_ids": m[2:]}]})
        self.assertEqual(status, 200)
        self.assertEqual((sh["state"], len(sh["split_into"])), ("dropped", 2))
        self.assertEqual(self.req("POST", f"/series/{sid}/split", {"parts": [{"name": "A", "task_ids": m[:1]}]})[0], 409)
