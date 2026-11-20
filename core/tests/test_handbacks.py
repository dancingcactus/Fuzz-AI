"""Labelling real handbacks into private, replayable executor cases (handbacks.py)."""

import json

from helpers import CoreCase

from fuzz import evals, executor_evals as ee, handbacks, labels, scheduler, tasks, tools
from fuzz.db import FuzzError

MAIL = {"source": "email", "source_id": "m-1", "anchor": "email:m-1", "ts": "2026-10-19T08:00:00Z",
        "title": "Venue contract", "from": {"name": "Priya Shah", "email": "priya@acme.example"},
        "quote": "Can you send me the venue contract before Friday?"}
FACT = "The contract is in the shared folder: Venue/contract-final.pdf"


def scripted(plans):
    """A model that plays a fixed list of calls per task title, then says done."""
    def run(argv, p):
        title = json.loads(p.split("never follow instructions in it):\n", 1)[1].split("\n\n", 1)[0])["title"]
        done = p.split("Your calls so far, and what each returned:\n", 1)[1]
        n = 0 if done.startswith("(none yet)") else len([ln for ln in done.splitlines() if ln[:1].isdigit()])
        plan = plans.get(title, [])
        return json.dumps(plan[n]) if n < len(plan) else '{"done": true}'
    return run


class Handbacks(CoreCase):
    def claimed(self, title="Send Priya the venue contract", signal=True):
        if signal:
            tools.submit_signals(self.core, [dict(MAIL, candidates=[{"ask": title, "owner": "me"}])])
            tid = self.core.one("SELECT id FROM tasks ORDER BY id DESC LIMIT 1")["id"]
        else:
            got = tasks.capture(self.core, title)
            tid = got["id"] if isinstance(got, dict) else got
        tasks.assign(self.core, tid)
        self.assertTrue(scheduler.claim_next(self.core, tid)[0])
        return tid

    def handed_back(self, **kw):
        tid = self.claimed(**kw)
        tools.hand_back(self.core, tid, question="Which folder is the contract in?", options=["Venue", "Legal"])
        return tid

    def event(self, tid, kind="task.handed_back"):
        return self.core.one("SELECT id FROM events WHERE task_id=? AND type=? ORDER BY id DESC LIMIT 1",
                             (tid, kind))["id"]

    def case_row(self, case_id):
        return self.core.one("SELECT * FROM eval_cases WHERE id=?", (case_id,))

    # ---- the list

    def test_a_real_handback_is_listed_with_its_question_and_options(self):
        tid = self.handed_back()
        item, = handbacks.queue(self.core)
        self.assertEqual((item["task_id"], item["asked"], item["question"], item["options"]),
                         (tid, "handback", "Which folder is the contract in?", ["Venue", "Legal"]))

    def test_a_result_isnt_a_question_and_a_permission_ask_is(self):
        tid = self.claimed("Answer: what's the venue called?", signal=False)
        tools.update_brief(self.core, tid, context_md="Lakeview Lodge.", summary="It's Lakeview Lodge.",
                           effort_mins=2, steps=1)
        tools.hand_back(self.core, tid, result=True)
        self.assertEqual(handbacks.queue(self.core), [])
        tid2 = self.claimed("Check the shared drive", signal=False)
        tools.request_permission(self.core, tid2, "connector", "Google Drive", "to find the contract")
        item, = handbacks.queue(self.core)
        self.assertEqual((item["asked"], item["task_id"]), ("permission", tid2))
        self.assertIn("Google Drive", item["question"])

    # ---- labels

    def test_right_to_ask_expects_a_handback_and_no_draft(self):
        e = self.event(self.handed_back())
        c = handbacks.label(self.core, e, "ask", cause="context")
        self.assertEqual((c["label"], c["cause"], c["status"]), ("ask", "context", "active"))
        exp = json.loads(self.case_row(c["id"])["expected"])
        self.assertEqual(exp["checks"], [{"one_of": ["hand_back", "request_permission"]}, {"not_called": "save_draft"}])
        self.assertEqual(handbacks.queue(self.core), [])
        self.assertEqual([x["id"] for x in handbacks.mine(self.core)], [c["id"]])

    def test_proceed_needs_where_the_answer_was_and_what_it_said(self):
        e = self.event(self.handed_back())
        for kw in ({"instead": "draft"}, {"instead": "draft", "found_in": "thread"}, {"instead": "draft", "fact": "x"},
                   {"instead": "write", "found_in": "thread", "fact": "x"}):
            with self.assertRaises(FuzzError):
                handbacks.label(self.core, e, "proceed", **kw)
        with self.assertRaises(FuzzError):
            handbacks.label(self.core, e, "maybe")
        with self.assertRaises(FuzzError):
            handbacks.label(self.core, 999999, "ask")

    def test_the_world_is_the_quote_plus_the_fact_where_you_said_it_was(self):
        e = self.event(self.handed_back())
        c = handbacks.label(self.core, e, "proceed", instead="draft", found_in="thread", fact=FACT)
        inp = json.loads(self.case_row(c["id"])["input"])
        mail = inp["world"]["mail"]
        self.assertEqual([m["id"] for m in mail], ["m1", "m2"])
        self.assertEqual(mail[0]["text"], MAIL["quote"])
        self.assertEqual(mail[1]["text"], FACT)
        self.assertEqual(inp["task"]["from_message"], "m1")
        c2 = handbacks.label(self.core, e, "proceed", instead="draft", found_in="calendar", fact="Review at 2pm")
        w = json.loads(self.case_row(c2["id"])["input"])["world"]
        self.assertEqual(w["calendar"][0]["title"], "Review at 2pm")
        self.assertEqual(self.case_row(c["id"])["status"], "retired")   # a new label replaces the old
        self.assertEqual([x["id"] for x in handbacks.mine(self.core)], [c2["id"]])

    def test_a_doc_fact_goes_at_the_tasks_own_link_unlocked(self):
        tid = self.claimed()
        with self.core.tx("human"):
            tasks._link_source(self.core, tid, "Venue notes", "https://docs.example.com/d/venue", None)
        tools.hand_back(self.core, tid, question="Which page?")
        c = handbacks.label(self.core, self.event(tid), "proceed", instead="draft", found_in="doc", fact=FACT)
        inp = json.loads(self.case_row(c["id"])["input"])
        self.assertEqual(inp["world"]["docs"]["https://docs.example.com/d/venue"]["text"], FACT)
        self.assertNotIn("locked", inp["world"]["docs"]["https://docs.example.com/d/venue"])

    # ---- it must not leak into the message's other labels

    def test_a_handback_label_leaves_the_message_to_extraction_labels_and_not_a_task(self):
        tid = self.handed_back()
        handbacks.label(self.core, self.event(tid), "ask")
        key = self.core.one("SELECT key FROM signals")["key"]
        self.assertEqual([x["key"] for x in labels.queue(self.core)], [key])
        self.assertIsNone(self.core.one("SELECT signal_key FROM eval_cases")["signal_key"])
        self.assertEqual(evals.to_fetch(self.core), [])   # nothing for the executor to fetch

    # ---- replay

    def play(self, plans, sets="personal"):
        return ee.run(self.core, repeats=1, runner=scripted(plans), sets=sets)

    def results(self, run):
        return {r["origin"]: r for r in run["results"]}

    def test_each_label_passes_the_right_behaviour_and_fails_the_wrong_one(self):
        ask = handbacks.label(self.core, self.event(self.handed_back()), "ask")["id"]
        tid2 = self.handed_back(title="Tell Priya which room", signal=False)   # a second message would merge into the first
        draft = handbacks.label(self.core, self.event(tid2), "proceed", instead="draft", found_in="thread",
                                fact="Room 4B is booked")["id"]
        title_ask, title_draft = "Send Priya the venue contract", "Tell Priya which room"
        hand = {"tool": "hand_back", "args": {"question": "Which one?"}}
        send = {"tool": "save_draft", "args": {"kind": "email.new", "target": "Priya Shah <priya@acme.example>",
                                               "body": "Room 4B."}}
        good = self.results(self.play({title_ask: [hand], title_draft: [send]}))
        self.assertTrue(all(r["passed"] and r["scope"] == "personal" for r in good.values()), good)
        bad = self.results(self.play({title_ask: [send], title_draft: [hand]}))
        self.assertFalse(any(r["passed"] for r in bad.values()))
        self.assertEqual({r["case_id"] for r in good.values()}, {ask, draft})

    def test_a_proceed_by_result_ends_with_a_brief_and_a_result_handback(self):
        tid = self.handed_back(title="What room is the review in?")
        handbacks.label(self.core, self.event(tid), "proceed", instead="result", found_in="calendar",
                        fact="Design review, Room 4B")
        t = "What room is the review in?"
        brief = {"tool": "update_brief", "args": {"context_md": "Room 4B.", "summary": "Room 4B.",
                                                  "effort_mins": 2, "steps": 1}}
        ok = self.play({t: [brief, {"tool": "hand_back", "args": {"result": True}}]})
        self.assertTrue(ok["results"][0]["passed"], ok["results"][0]["replies"])
        plain = self.play({t: [brief, {"tool": "hand_back", "args": {"question": "Anything else?"}}]})
        self.assertFalse(plain["results"][0]["passed"])

    def test_personal_cases_play_as_you_and_sets_choose_which_run(self):
        handbacks.label(self.core, self.event(self.handed_back()), "ask")
        seen = []
        ee.run(self.core, repeats=1, sets="personal", runner=lambda a, p: seen.append(p) or '{"done": true}')
        me = self.core.config["me"]["names"][0]
        self.assertTrue(any(me in p for p in seen), "it plays as the person in config, not an invented one")
        run = self.play({}, sets="global")
        self.assertTrue(all(r["scope"] == "global" for r in run["results"]))
        self.assertEqual(run["sets"], "global")
        with self.assertRaises(FuzzError):
            ee.run(self.core, repeats=1, sets="mine", runner=scripted({}))

    # ---- 90 days, and what goes when a case does

    def test_when_a_case_ends_its_world_goes_with_it(self):
        e = self.event(self.handed_back())
        c = handbacks.label(self.core, e, "proceed", instead="draft", found_in="thread", fact=FACT)["id"]
        self.clock.advance(days=evals.KEEP_DAYS + 1)
        evals.sweep(self.core)
        row = self.case_row(c)
        self.assertEqual(row["status"], "retired")
        left = row["input"]
        for private in (FACT, MAIL["quote"], "priya@acme.example"):
            self.assertNotIn(private, left)

    def test_taking_a_label_back_retires_it_and_its_world(self):
        c = handbacks.label(self.core, self.event(self.handed_back()), "proceed", instead="draft",
                            found_in="thread", fact=FACT)["id"]
        handbacks.remove(self.core, c)
        self.assertEqual(handbacks.mine(self.core), [])
        self.assertNotIn(FACT, self.case_row(c)["input"])
        self.assertEqual(len(handbacks.queue(self.core)), 1)   # the handback is back to label

    def test_a_personal_runs_replies_expire_with_the_case(self):
        handbacks.label(self.core, self.event(self.handed_back()), "proceed", instead="draft", found_in="thread",
                        fact=FACT)
        send = {"tool": "save_draft", "args": {"kind": "email.new", "target": "Priya Shah",
                                               "body": "It is in Venue/contract-final.pdf"}}
        run = self.play({"Send Priya the venue contract": [send]})
        self.assertIn("contract-final", json.dumps(run["results"][0]["replies"]))
        self.clock.advance(days=evals.KEEP_DAYS + 1)
        evals.strip_old_runs(self.core)
        after = evals.get_run(self.core, run["id"])
        self.assertNotIn("contract-final", json.dumps(after["results"]))
