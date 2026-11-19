"""Series (docs/series.md): detection as things come in (attach, seed, the judge's items and verdicts, forming
series, areas), the record (link, unlink, name, drop, anchors, wrap, seasons) with Undo and replay, also
touches, facts, starting one yourself, the cards, suggestions, and the HTTP surface."""

import json

from helpers import CoreCase

from fuzz import actions, answers, cards, events, focus, tasks, tools
from fuzz.db import FuzzError
from fuzz.series import detect, record, settings
from fuzz.series import index as index_mod


def sig(n, ask, topics=(), day=0, thread=None, who="Priya Shah", source="email", channel=None):
    s = {"source": source, "source_id": f"m{n}", "anchor": thread or f"email:T{n}",
         "ts": f"2026-10-{20 + day:02d}T08:{n % 60:02d}:00Z",
         "from": {"name": who, "email": f"{who.split()[0].lower()}@example.com"}, "quote": ask,
         "candidates": [{"ask": ask, "owner": "me", "topics": list(topics)}]}
    if source == "slack":
        s.update(source_id=f"{channel or 'C123'}:{n}.000", anchor=thread or f"slack:{channel or 'C123'}:{n}.000",
                 **{"from": {"name": who, "slack_id": f"U{n}"}})
    return s


NW = ["Send Northwind the pilot plan", "Book the Northwind kickoff room", "Draft the Northwind SOW",
      "Answer Northwind legal's questions", "Share the Northwind test results", "Fix the Northwind login bug"]


class SeriesCase(CoreCase):
    def submit(self, signals):
        out = tools.submit_signals(self.core, signals)
        self.judge_asks_new()
        return out

    def judge_asks_new(self):
        page = tools.get_pending_judgments(self.core)
        vs = [{"candidate_id": i["candidate_id"], "task_id": None, "verdict": "new", "confidence": 0.9} for i in page["items"]]
        if vs:
            tools.submit_verdicts(self.core, vs)

    def northwind(self, n=4, start=0):
        """n asks about the Northwind pilot, from separate threads, over separate days."""
        self.submit([sig(start + i + 1, NW[start + i], topics=["Northwind pilot"], day=start + i) for i in range(n)])

    def items(self):
        return tools.get_pending_judgments(self.core)["series_items"]

    def series(self):
        return self.core.all("SELECT * FROM series WHERE user_id=? ORDER BY id", (self.core.user_id,))

    def members(self, sid):
        return sorted(t["id"] for t in self.core.all("SELECT id FROM tasks WHERE series_id=?", (sid,)))

    def make_series(self, name="Northwind pilot", n=4):
        self.northwind(n)
        it = self.items()[0]
        tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "new", "name": name, "bounded": True,
                                           "why": "a pilot ends when it goes live"}])
        return self.series()[-1]["id"]


class Settings(SeriesCase):
    def test_the_rules_are_tunable_in_config(self):
        self.assertEqual(settings.get(self.core)["min_tasks"], 4)
        self.core.update_config(lambda c: c.update(series={"min_tasks": 6, "weights": {"topic": 5.0}}))
        s = settings.get(self.core)
        self.assertEqual((s["min_tasks"], s["weights"]["topic"], s["weights"]["ticket"]), (6, 5.0, 3.0))


class Detection(SeriesCase):
    def test_a_cluster_that_passes_the_rules_becomes_a_judge_item(self):
        self.northwind(4)
        items = self.items()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["kind"], "series_candidate")
        self.assertEqual(len(items[0]["tasks"]), 4)
        self.assertIn("new", items[0]["actions"])

    def test_too_few_tasks_or_days_is_no_item(self):
        self.northwind(3)
        self.assertEqual(self.items(), [])

    def test_one_afternoon_is_not_a_series(self):
        self.submit([sig(i + 1, NW[i], topics=["Northwind pilot"], day=0) for i in range(5)])
        self.assertEqual(self.items(), [])

    def test_new_makes_a_series_and_later_work_attaches_without_ai(self):
        sid = self.make_series()
        s = record.get(self.core, sid)
        self.assertEqual((s["state"], s["origin"], s["name"]), ("inferred", "inferred", "Northwind pilot"))
        self.assertEqual(len(self.members(sid)), 4)
        self.northwind(1, start=4)
        self.assertEqual(len(self.members(sid)), 5)
        self.assertEqual(self.items(), [])
        self.assertEqual(events.check_replay(self.core), [])

    def test_the_judge_may_only_use_ids_it_was_given(self):
        self.northwind(4)
        it = self.items()[0]
        with self.assertRaises(FuzzError) as e:
            tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "join", "series_id": 99}])
        self.assertEqual(e.exception.field, "verdicts[0].series_id")
        with self.assertRaises(FuzzError) as e:
            tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "split",
                                               "parts": [{"name": "X", "tasks": [999]}]}])
        self.assertEqual(e.exception.field, "verdicts[0].parts[0].tasks")
        self.assertEqual(len(self.items()), 1)

    def test_wait_asks_again_only_once_it_has_grown(self):
        self.northwind(4)
        it = self.items()[0]
        tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "wait"}])
        self.northwind(1, start=4)
        self.assertEqual(self.items(), [])
        self.submit([sig(20, "Plan the Northwind retro", topics=["Northwind pilot"], day=6)])
        self.assertEqual(len(self.items()), 1)

    def test_area_takes_no_tasks_and_its_anchors_stop_seeding(self):
        self.northwind(4)
        it = self.items()[0]
        tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "area", "name": "Northwind account",
                                           "why": "the account is ongoing"}])
        area = self.series()[-1]
        self.assertEqual((area["kind"], area["state"]), ("area", "area"))
        self.assertEqual(self.members(area["id"]), [])
        self.northwind(1, start=4)
        self.assertEqual(self.items(), [])

    def test_an_area_gets_a_second_look_once_its_cluster_doubles(self):
        self.northwind(4)
        it = self.items()[0]
        tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "area", "name": "Northwind account"}])
        self.northwind(2, start=4)   # 6 free tasks: not yet 8
        self.assertEqual(self.items(), [])
        self.submit([sig(30, "Send the Northwind invoice", topics=["Northwind pilot"], day=7, who="Dana Ito"),
                     sig(31, "Review Northwind's renewal terms", topics=["Northwind pilot"], day=8, who="Sam Lee")])
        items = self.items()
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["inside_area"][0]["name"], "Northwind account")

    def test_split_keeps_a_small_part_as_forming_which_grows_into_a_series(self):
        self.northwind(4)
        it = self.items()[0]
        ids = [t["id"] for t in it["tasks"]]
        tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "split", "parts": [
            {"name": "Northwind pilot", "bounded": True, "tasks": ids[:2]},
            {"name": "Northwind SOW", "bounded": True, "tasks": ids[2:]}]}])
        states = sorted(s["state"] for s in self.series())
        self.assertEqual(states, ["forming", "forming"])
        # forming series collect matching tasks without AI and become series once they pass the rules
        self.northwind(2, start=4)
        self.assertIn("inferred", [s["state"] for s in self.series()])

    def test_forming_series_are_join_targets_and_a_stalled_one_is_rechecked(self):
        self.northwind(4)
        it = self.items()[0]
        ids = [t["id"] for t in it["tasks"]]
        tools.submit_verdicts(self.core, [{"series_item": it["series_item"], "action": "split", "parts": [
            {"name": "Northwind pilot", "bounded": True, "tasks": ids[:2]}]}])
        self.clock.advance(days=8)
        self.submit([sig(40, "Unrelated thing", topics=["Lunch"], day=9)])
        stall = [i for i in self.items() if i["kind"] == "series_stall"]
        self.assertEqual(len(stall), 1)
        self.assertEqual(stall[0]["actions"], ["merge", "wait", "drop"])
        tools.submit_verdicts(self.core, [{"series_item": stall[0]["series_item"], "action": "drop"}])
        self.assertEqual(self.series()[0]["state"], "dropped")

    def test_near_tie_is_also_touches_not_a_question(self):
        sid = self.make_series()
        idx = index_mod.Index(self.core)
        t = self.members(sid)[0]
        self.assertEqual(idx.also_touches(t), [])
        self.assertTrue(idx.scores(t))


class Record(SeriesCase):
    def test_link_unlink_and_attach_never_puts_it_back(self):
        sid = self.make_series()
        t = self.members(sid)[0]
        record.unlink(self.core, t)
        self.assertIsNone(self.task(t)["series_id"])
        self.northwind(1, start=4)
        self.assertIsNone(self.task(t)["series_id"])
        record.link(self.core, t, sid)
        self.assertEqual(self.task(t)["series_id"], sid)
        actions.undo(self.core)
        self.assertIsNone(self.task(t)["series_id"])

    def test_name_drop_and_undo(self):
        sid = self.make_series()
        record.name(self.core, sid, "The Northwind pilot")
        s = record.get(self.core, sid)
        self.assertEqual((s["state"], s["name"], s["met"]), ("named", "The Northwind pilot", 1))
        record.drop(self.core, sid)
        self.assertEqual(record.get(self.core, sid)["state"], "dropped")
        self.assertEqual(self.members(sid), [])
        actions.undo(self.core)
        self.assertEqual(record.get(self.core, sid)["state"], "named")
        self.assertEqual(len(self.members(sid)), 4)
        self.assertEqual(events.check_replay(self.core), [])

    def test_ongoing_turns_it_into_an_area(self):
        sid = self.make_series()
        record.drop(self.core, sid, why="ongoing")
        s = record.get(self.core, sid)
        self.assertEqual((s["kind"], s["state"]), ("area", "area"))
        self.assertTrue(index_mod.Index(self.core).area_keys)

    def test_anchors_add_remove_with_undo_and_preview(self):
        sid = self.make_series()
        idx = index_mod.Index(self.core)
        keys = list(idx.anchors(sid))
        self.assertTrue(keys)
        p = record.preview_anchors(self.core, sid, remove=keys)
        self.assertEqual(len(p["would_stop_matching"]), 4)
        record.edit_anchors(self.core, sid, remove=keys)
        self.assertEqual(index_mod.Index(self.core).anchors(sid), {})
        actions.undo(self.core)
        self.assertEqual(set(index_mod.Index(self.core).anchors(sid)), set(keys))
        record.edit_anchors(self.core, sid, add=["kickoff"])
        self.assertIn("word:kickoff", index_mod.Index(self.core).anchors(sid))

    def test_wrap_and_new_work_asks_for_season_2(self):
        sid = self.make_series()
        record.wrap(self.core, sid, "You said it's wrapped.")
        self.northwind(1, start=4)
        c = [c for c in self.open_cards() if c["kind"] == "series_season"]
        self.assertEqual(len(c), 1)
        answers.answer(self.core, c[0]["id"], "season2")
        s = record.get(self.core, sid)
        self.assertEqual((s["state"], s["season"]), ("inferred", 2))
        self.assertEqual(len(self.members(sid)), 5)

    def test_a_task_closing_has_fuzz_check_the_done_when(self):
        from fuzz.memory import facts
        sid = self.make_series()
        s = record.get(self.core, sid)
        facts.edit(self.core, s["entity_id"], "done_when", "NW-342 is accepted and Northwind confirms in writing")
        self.assertEqual(tools.whoami(self.core, "executor")["series_to_check"], [])
        tasks.done(self.core, self.members(sid)[0])
        self.assertEqual([x["id"] for x in tools.whoami(self.core, "executor")["series_to_check"]], [sid])
        tools.report_series_done(self.core, sid, "NW-342 accepted; Northwind confirmed by email")
        self.assertEqual(record.get(self.core, sid)["state"], "wrapped")
        actions.undo(self.core)
        self.assertEqual(record.get(self.core, sid)["state"], "inferred")

    def test_quiet_series_go_dormant_and_wake(self):
        sid = self.make_series()
        self.clock.advance(days=30)
        self.assertEqual(record.check_dormant(self.core), 1)
        self.assertEqual(record.get(self.core, sid)["state"], "dormant")
        record.link(self.core, tasks.capture(self.core, "Northwind wrap-up"), sid)
        self.assertEqual(record.get(self.core, sid)["state"], "inferred")
