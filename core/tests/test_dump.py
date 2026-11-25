"""Dump mode (docs/dump-mode.md): the split proposes, nothing is made until it's kept, one Undo takes it all back,
the raw dump is kept and linked, and in Focus time the items go straight in."""

import json
from unittest import mock

from helpers import CoreCase
from test_http import Server

from fuzz import actions, cards, dump, events, tasks
from fuzz.db import FuzzError
from fuzz.roles import scripted

TEXT = """Send the budget numbers to the finance lead
call the dentist
note: the vendor seems slow lately
someday learn to bake bread
already paid the parking ticket
"""

ITEMS = [{"group": "task", "text": "Send the budget numbers to the finance lead"},
         {"group": "task", "text": "Call the dentist"},
         {"group": "note", "text": "The vendor seems slow lately"},
         {"group": "later", "text": "Learn to bake bread"},
         {"group": "done", "text": "Paid the parking ticket"}]


def titles(core):
    return [t["title"] for t in tasks.list_tasks(core, None) if t["state"] != "letgo"]   # Undo lets a captured task go


class Dump(CoreCase):
    def split(self, deep_work=False, items=ITEMS):
        did = dump.start(self.core, TEXT, deep_work=deep_work)
        return did, dump.submit(self.core, did, items, "I've got all of it.")

    def test_a_dump_is_kept_and_the_split_creates_nothing(self):
        did, out = self.split()
        self.assertEqual((out["state"], out["items"]), ("ready", 5))
        self.assertEqual(titles(self.core), [])
        v = dump.view(self.core, did)
        self.assertEqual((v["state"], v["text"], v["say"]), ("ready", TEXT.strip(), "I've got all of it."))
        self.assertEqual([(i["group"], i["keep"]) for i in v["items"]],
                         [("task", True), ("task", True), ("note", True), ("later", True), ("done", False)])

    def test_keeping_it_makes_tasks_notes_stay_with_the_dump_and_later_is_parked(self):
        did, _ = self.split()
        out = dump.commit(self.core, did)
        self.assertEqual(len(out["task_ids"]), 3)   # two tasks and one later; the note and the done item only stay
        states = {self.task(t)["title"]: self.task(t)["state"] for t in out["task_ids"]}
        self.assertEqual(states, {"Send the budget numbers to the finance lead": "triage", "Call the dentist": "triage",
                                  "Learn to bake bread": "parked"})
        v = dump.view(self.core, did)
        self.assertEqual((v["state"], len(v["task_ids"])), ("committed", 3))
        self.assertEqual(dump.for_task(self.core, out["task_ids"][0])["dump_id"], did)
        self.assertEqual(events.check_replay(self.core), [])

    def test_unticked_items_make_nothing_and_a_dump_may_make_no_tasks(self):
        did, _ = self.split()
        out = dump.commit(self.core, did, accept=[3])   # only the note
        self.assertEqual(out["task_ids"], [])
        self.assertEqual(titles(self.core), [])
        self.assertEqual(dump.view(self.core, did)["state"], "committed")

    def test_one_undo_takes_the_whole_dump_back(self):
        did, _ = self.split()
        dump.commit(self.core, did)
        self.assertEqual(len(titles(self.core)), 3)
        actions.undo(self.core)
        self.assertEqual(titles(self.core), [])
        v = dump.view(self.core, did)
        self.assertEqual(v["state"], "undone")
        self.assertEqual(v["task_ids"], [])
        self.assertEqual(v["text"], TEXT.strip(), "the raw dump is still kept")
        self.assertEqual(self.core.one("SELECT COUNT(*) n FROM dump_items")["n"], 0)

    def test_an_undone_dump_can_be_kept_again(self):
        did, _ = self.split()
        dump.commit(self.core, did)
        actions.undo(self.core)
        self.assertEqual(len(dump.commit(self.core, did)["task_ids"]), 3)

    def test_changing_the_split_runs_it_again_with_your_words_and_its_last_list(self):
        did, _ = self.split()
        dump.revise(self.core, did, "Make the dentist a note")
        self.assertEqual(dump.view(self.core, did)["state"], "splitting")
        d = dump.get_for_splitter(self.core, did)
        self.assertEqual(d["instruction"], "Make the dentist a note")
        self.assertEqual(len(d["previous"]), 5)
        self.assertEqual(d["text"], TEXT.strip())
        dump.submit(self.core, did, [dict(i, group="note") if "dentist" in i["text"] else i for i in ITEMS])
        self.assertEqual([i["group"] for i in dump.view(self.core, did)["items"]][1], "note")

    def test_focus_time_commits_at_once_with_no_review_into_the_session(self):
        did, out = self.split(deep_work=True)
        self.assertEqual(out["state"], "committed")
        made = {self.task(t)["title"]: self.task(t)["state"] for t in dump.view(self.core, did)["task_ids"]}
        self.assertEqual(set(made.values()), {"deepwork"})   # the later one goes in too: no review to park it from
        self.assertEqual(len(made), 3)
        actions.undo(self.core)   # one Undo takes the whole dump back there too
        self.assertEqual(titles(self.core), [])

    def test_a_dump_must_not_become_a_pile_of_cards(self):
        did = dump.start(self.core, TEXT)
        with self.assertRaisesRegex(FuzzError, "At most 40"):
            dump.submit(self.core, did, [{"group": "task", "text": f"Thing {n}"} for n in range(41)])
        self.assertEqual(dump.view(self.core, did)["state"], "splitting")

    def test_bad_input_is_refused(self):
        with self.assertRaises(FuzzError):
            dump.start(self.core, "   ")
        did = dump.start(self.core, TEXT)
        for bad in ("nope", [{"group": "urgent", "text": "x"}], [{"group": "task", "text": ""}], [5]):
            with self.assertRaises(FuzzError):
                dump.submit(self.core, did, bad)
        with self.assertRaises(FuzzError):
            dump.commit(self.core, did)   # nothing to keep yet

    def test_a_split_that_never_comes_is_shown_as_failed_and_can_be_kept_as_one_task(self):
        did = dump.start(self.core, TEXT)
        self.clock.advance(minutes=dump.STALE_MINUTES + 1)
        v = dump.view(self.core, did)
        self.assertEqual(v["state"], "failed")
        self.assertTrue(v["error"])
        out = dump.as_one_task(self.core, did)
        self.assertEqual(len(out["task_ids"]), 1)
        self.assertIn("call the dentist", self.task(out["task_ids"][0])["ask"])

    def test_deleting_a_dump_removes_its_text_but_keeps_the_tasks(self):
        did, _ = self.split()
        tid = dump.commit(self.core, did)["task_ids"][0]
        dump.discard(self.core, did)
        self.assertEqual(self.core.one("SELECT COUNT(*) n FROM dumps")["n"], 0)
        self.assertIsNone(dump.for_task(self.core, tid))
        self.assertEqual(self.task(tid)["state"], "triage")
        with self.assertRaises(FuzzError):
            dump.view(self.core, did)

    def test_another_user_cannot_see_it(self):
        did, _ = self.split()
        with self.assertRaises(FuzzError):
            dump.view(self.make_core(2), did)

    def test_the_scripted_splitter_reads_lines_by_their_lead_word(self):
        groups = [(i["group"], i["text"]) for i in scripted.split_lines("- call the dentist\n\n2) later: paint the fence\n"
                                                                         "Note: she prefers mornings\nalready sent it")]
        self.assertEqual(groups, [("task", "call the dentist"), ("later", "later: paint the fence"),
                                  ("note", "Note: she prefers mornings"), ("done", "already sent it")])

    def test_a_scripted_split_run_goes_through_the_real_tools(self):
        did = dump.start(self.core, TEXT)
        out = scripted.run_split(self.core, (str(did), ""))
        self.assertEqual(out["state"], "ready")
        self.assertEqual(len(dump.view(self.core, did)["items"]), 5)


class DumpHttp(Server):
    def test_start_review_commit_and_undo_over_http(self):
        core = self.srv.app.core(1)
        cfg = core.config
        cfg["engine"]["client"] = "claude-code"
        core.save_config(cfg)
        with mock.patch("fuzz.engine.run_now") as run:
            status, body = self.req("POST", "/dumps", {"text": TEXT})
        self.assertEqual(status, 202)
        self.assertEqual(run.call_args.args[1], "split")
        did = body["dump_id"]
        self.assertEqual(self.req("GET", f"/dumps/{did}")[1]["state"], "splitting")
        dump.submit(core, did, ITEMS, "Here you go.")
        self.assertEqual(self.req("GET", f"/dumps/{did}")[1]["items"][0]["text"], ITEMS[0]["text"])
        self.assertEqual(self.req("GET", "/tasks")[1]["tasks"], [])
        with mock.patch("fuzz.engine.run_now"):   # with an engine set, the new tasks wait for Fuzz to look them up
            status, out = self.req("POST", f"/dumps/{did}/commit", {"accept": [1, 2]})
        self.assertEqual((status, len(out["task_ids"])), (200, 2))
        self.assertEqual(len(self.req("GET", "/tasks")[1]["tasks"]), 2)
        self.req("POST", "/undo", {})
        self.assertEqual([t for t in self.req("GET", "/tasks")[1]["tasks"] if t["state"] != "letgo"], [])
        self.assertEqual(self.req("DELETE", f"/dumps/{did}")[1], {"deleted": did})
        self.assertEqual(self.req("GET", f"/dumps/{did}")[0], 404)

    def test_no_engine_means_no_dump_and_nothing_is_kept(self):
        status, err = self.req("POST", "/dumps", {"text": TEXT})
        self.assertEqual((status, err["field"]), (409, "engine"))
        self.assertEqual(self.srv.app.core(1).one("SELECT COUNT(*) n FROM dumps")["n"], 0)

    def test_revise_runs_the_splitter_again(self):
        core = self.srv.app.core(1)
        cfg = core.config
        cfg["engine"]["client"] = "claude-code"
        core.save_config(cfg)
        did = dump.start(core, TEXT)
        dump.submit(core, did, ITEMS)
        with mock.patch("fuzz.engine.run_now") as run:
            status, _ = self.req("POST", f"/dumps/{did}/revise", {"instruction": "Fewer tasks"})
        self.assertEqual((status, run.call_args.args[1]), (202, "split"))
        self.assertEqual(self.req("POST", f"/dumps/{did}/revise", {"instruction": ""})[0], 400)
