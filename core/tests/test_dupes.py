"""Catching duplicates: a task you capture, two asks in one run, and a ticket or document two tasks share."""

import unittest

from helpers import CoreCase
from test_http import Server

from fuzz import actions, answers, cards, events, scheduler, tasks, tools
from fuzz.matching import dupes, entities

TICKET = "https://jira.example.com/browse/PROJ-1234"
GUIDE = "https://wiki.example.com/spaces/TEAM/pages/1000000002/Testing-Setup-Guide"
WIKI = {"name": "Team Wiki", "email": "wiki@example.com"}


def slack(n, ask, links=(), who=None):
    return {"source": "slack", "source_id": f"C1:{n}", "anchor": f"slack:C1:{n}", "ts": f"2026-10-20T08:0{n}:00Z",
            "from": who or {"name": "Sanjeev P", "slack_id": "U0SANJ"}, "quote": ask, "links": list(links),
            "candidates": [{"ask": ask, "owner": "me", "links": list(links)}]}


def email(n, asks, links=(), conv=None):
    return {"source": "email", "source_id": f"m{n}", "anchor": f"email:{conv or 'T' + str(n)}",
            "ts": f"2026-10-20T08:{n:02d}:00Z", "from": WIKI, "title": "Goal Service design", "quote": asks[0],
            "links": list(links), "candidates": [{"ask": a, "owner": "me"} for a in asks]}


class Dupes(CoreCase):
    def send(self, *sigs, verdict="new"):
        tools.submit_signals(self.core, list(sigs))
        items = tools.get_pending_judgments(self.core)["items"]
        if items:
            tools.submit_verdicts(self.core, [{"candidate_id": i["candidate_id"], "verdict": verdict, "confidence": 0.6}
                                              for i in items])

    def tid(self, words):
        rows = [t for t in tasks.list_tasks(self.core) if words.lower() in t["title"].lower()]
        self.assertEqual(len(rows), 1, [t["title"] for t in tasks.list_tasks(self.core)])
        return rows[0]["id"]

    def kinds(self, tid):
        return [c["kind"] for c in cards.open_cards(self.core, tid)]

    # ---- a task you capture
    def test_a_captured_task_and_the_same_ask_from_slack_share_a_ticket(self):
        self.send(slack(1, "Find the thread explaining how to test the plugin", [TICKET, GUIDE]))
        old = self.tid("thread explaining")
        new = tasks.capture(self.core, "Set up the plugin from PROJ-1234")
        self.assertEqual(self.kinds(new), ["duplicate"])   # the question first; the routing card waits
        c = self.card_for(new, "duplicate")
        self.assertEqual(c["other_id"], old)
        self.assertIn("PROJ-1234", c["reason"])
        answers.answer(self.core, c["id"], "keep_separate")
        self.assertEqual(self.kinds(new), ["task"])
        self.assertIsNone(dupes.check_captured(self.core, new))   # you said they differ: not asked again

    def test_merging_it_moves_the_capture_into_the_older_task(self):
        self.send(slack(1, "Find the thread explaining how to test the plugin", [TICKET]))
        old = self.tid("thread explaining")
        new = tasks.capture(self.core, "Check PROJ-1234 test setup")
        answers.answer(self.core, self.card_for(new, "duplicate")["id"], "merge")
        self.assertEqual((self.task(new)["state"], self.task(new)["merged_into"]), ("merged", old))
        actions.undo(self.core)
        self.assertEqual(self.task(new)["state"], "triage")

    def test_with_gathering_it_is_matched_once_fuzz_has_looked(self):
        self.send(slack(1, "Find the thread explaining how to test the plugin", [GUIDE]))
        old = self.tid("thread explaining")
        new = tasks.capture(self.core, "Find setup instructions for testing the plugin", gather=True)
        self.assertEqual(self.kinds(new), [])   # with Fuzz, nothing to ask yet
        tasks.add_link(self.core, new, None, GUIDE)   # what Fuzz found
        scheduler.finish_gathering(self.core, new, actor="system")
        self.assertEqual(self.card_for(new, "duplicate")["other_id"], old)

    def test_a_result_found_while_gathering_is_matched_too(self):
        self.send(slack(1, "Find the thread explaining how to test the plugin", [GUIDE]))
        new = tasks.capture(self.core, "Summarize the plugin test setup", gather=True)
        tasks.add_link(self.core, new, None, GUIDE)
        tasks.update_brief(self.core, new, context_md="The guide says…", effort_mins=20, steps=2)
        scheduler.finish_gathering(self.core, new, actor="system", result=True)
        self.assertEqual(self.kinds(new), ["duplicate"])
        answers.answer(self.core, self.card_for(new)["id"], "keep_separate")
        self.assertEqual(self.card_for(new, "task")["suggested"], "done")   # still the result, asking if it's done

    def test_an_unrelated_capture_is_left_alone(self):
        self.send(slack(1, "Find the thread explaining how to test the plugin", [TICKET]))
        new = tasks.capture(self.core, "Book the dentist")
        self.assertEqual(self.kinds(new), ["task"])

    def test_a_link_on_many_tasks_doesnt_count(self):
        home = "https://wiki.example.com/spaces/TEAM/overview"
        for n, ask in enumerate(["Order lunch", "Print badges", "Call the venue", "Send the agenda"], 1):
            self.send(slack(n, ask, [home]))
        new = tasks.capture(self.core, "Plan the retro")
        tasks.add_link(self.core, new, None, home, actor="human")
        self.assertIsNone(dupes.check_captured(self.core, new))
        self.assertEqual(self.kinds(new), ["task"])

    def test_a_later_signal_can_find_a_captured_task(self):
        new = tasks.capture(self.core, "Review the rollout plan in PROJ-1234")
        out = tools.submit_signals(self.core, [slack(1, "Can you look at PROJ-1234 before Thursday?", [TICKET])])
        merged = out["outcomes"].get("merged")
        pending = tools.get_pending_judgments(self.core)["items"]
        self.assertTrue(merged or any(s["task_id"] == new for p in pending for s in p["shortlist"]), out)

    def test_fuzz_capturing_a_task_is_not_checked(self):
        self.send(slack(1, "Find the thread explaining how to test the plugin", [TICKET]))
        new = tasks.capture(self.core, "Check PROJ-1234", actor="fuzz:onboarding")
        self.assertNotIn("duplicate", self.kinds(new))

    # ---- two asks in one run
    def _pend(self):
        """An open task from the same sender, so the asks below go to the judge instead of straight to new."""
        self.send(email(1, ["Decide which goals the Target activities track"]))

    def test_two_asks_in_one_run_about_the_same_page(self):
        self._pend()
        page = "https://wiki.example.com/pages/viewpage.action?pageId=1000000003"
        # different words about the same page (the same words from the same sender are a repeat, folded in)
        tools.submit_signals(self.core, [email(2, ["Confirm whether activities may link to one goal or many goals"], [page]),
                                         email(3, ["Check what the page says about activity goal limits"], [page])])
        items = tools.get_pending_judgments(self.core)["items"]
        self.assertEqual(len(items), 2)
        tools.submit_verdicts(self.core, [{"candidate_id": i["candidate_id"], "verdict": "new", "confidence": 0.6}
                                          for i in items])
        rows = [t for t in tasks.list_tasks(self.core) if "goal" in t["title"] and "Target" not in t["title"]]
        first, second = sorted(t["id"] for t in rows)
        self.assertEqual(self.card_for(second, "duplicate")["other_id"], first)
        self.assertIn("same run", self.card_for(second, "duplicate")["reason"])
        self.assertNotIn("duplicate", self.kinds(first))

    def test_asks_from_the_same_message_never_match(self):
        self._pend()
        tools.submit_signals(self.core, [email(2, ["Confirm the goals for activities", "Confirm the goals for activities too"],
                                               [GUIDE])])
        items = tools.get_pending_judgments(self.core)["items"]
        tools.submit_verdicts(self.core, [{"candidate_id": i["candidate_id"], "verdict": "new", "confidence": 0.6}
                                          for i in items])
        for t in tasks.list_tasks(self.core):
            self.assertNotIn("duplicate", self.kinds(t["id"]))

    def test_a_wiki_page_by_id_is_its_own_document(self):
        a = entities.normalize_url("https://wiki.example.com/pages/viewpage.action?pageId=1")
        b = entities.normalize_url("https://wiki.example.com/pages/viewpage.action?pageId=2")
        self.assertNotEqual(a, b)
        self.assertIsNone(dupes.ident("https://wiki.example.com/"))   # a site's home says nothing


TRAINING = "Complete available Salesforce and Braze learning modules"
ACADEMY = {"name": "Sales Accelerator", "email": "notifications@academy.example.com"}


def sent(n, ask, who=ACADEMY):
    """One email from who, its own thread."""
    return {"source": "email", "source_id": f"s{n}", "anchor": f"email:S{n}", "ts": f"2026-11-05T19:{n:02d}:00Z",
            "from": who, "title": "Reminder", "quote": ask, "links": [], "candidates": [{"ask": ask, "owner": "me"}]}


class SameAskAgain(CoreCase):
    """The same ask in one run more than once: a reminder sent five times, or the same thing from several people."""

    def setUp(self):
        super().setUp()
        # an older, different training task: every ask below is judged against it together, with shortlists
        # frozen before any of them made a task, as a real run's batch is
        tools.submit_signals(self.core, [sent(0, "Complete the Salesforce security awareness training modules",
                                              {"name": "IT Security", "email": "security@example.com"})])

    def run_of(self, *sigs):
        tools.submit_signals(self.core, list(sigs))
        items = tools.get_pending_judgments(self.core)["items"]
        if items:
            tools.submit_verdicts(self.core, [{"candidate_id": i["candidate_id"], "verdict": "new", "confidence": 0.99}
                                              for i in items])
        return sorted(t["id"] for t in tasks.list_tasks(self.core) if t["title"] == TRAINING)

    def dup_cards(self):
        return [c for c in self.core.all("SELECT * FROM cards WHERE user_id=? AND kind='duplicate' AND status='open'",
                                         (self.core.user_id,))]

    def three_from_people(self):
        """The same ask from three different people: the first is a task, the other two one card about it."""
        people = [{"name": n, "email": f"{n.lower()}@example.com"} for n in ("Dana", "Omar", "Tess")]
        return self.run_of(*[sent(i + 1, TRAINING, who) for i, who in enumerate(people)])

    # ---- 1. the same ask from the same sender is folded in
    def test_a_reminder_sent_five_times_is_one_task(self):
        ids = self.run_of(*[sent(i, TRAINING) for i in range(1, 6)])
        self.assertEqual(len(ids), 1)
        self.assertEqual(self.dup_cards(), [])
        srcs = self.core.all("SELECT role FROM sources WHERE task_id=? AND role IN ('origin', 'update')", (ids[0],))
        self.assertEqual(sorted(r["role"] for r in srcs), ["origin"] + ["update"] * 4)
        outs = [r["outcome"] for r in self.core.all("SELECT outcome FROM decisions ORDER BY id")]
        self.assertEqual(outs.count("merged"), 4)

    def test_the_same_ask_from_different_people_is_still_asked_about(self):
        ids = self.three_from_people()
        self.assertEqual(len(ids), 3)
        self.assertEqual(len(self.dup_cards()), 1)

    def test_a_different_ask_from_the_same_sender_is_still_asked_about(self):
        self.run_of(sent(1, TRAINING), sent(2, "Complete the available Salesforce modules before Friday's review"))
        outs = [r["outcome"] for r in self.core.all("SELECT outcome FROM decisions ORDER BY id")][1:]
        self.assertNotIn("merged", outs)
        self.assertEqual(len([t for t in tasks.list_tasks(self.core) if t["state"] == "triage"]), 3)

    # ---- 2. one card per task they may be the same as
    def test_possible_duplicates_of_one_task_share_one_card(self):
        first, second, third = self.three_from_people()
        c = self.card_for(second, "duplicate")
        self.assertEqual(c["other_id"], first)
        self.assertEqual(cards.open_cards(self.core, third), [])
        self.assertTrue(cards.covered(self.core, tasks.get(self.core, third)))
        v = cards.view(self.core, c)
        self.assertEqual([d["id"] for d in v["dupes"]], [second, third])
        self.assertIn("these 2", v["prompt"])

    def test_merge_on_the_shared_card_merges_them_all(self):
        first, second, third = self.three_from_people()
        answers.answer(self.core, self.card_for(second, "duplicate")["id"], "merge")
        for tid in (second, third):
            self.assertEqual(tasks.get(self.core, tid)["merged_into"], first)
        self.assertEqual(self.dup_cards(), [])

    def test_keep_separate_on_the_shared_card_keeps_them_all(self):
        first, second, third = self.three_from_people()
        answers.answer(self.core, self.card_for(second, "duplicate")["id"], "keep_separate")
        for tid in (second, third):
            self.assertEqual(tasks.get(self.core, tid)["state"], "triage")
            self.card_for(tid, "task")   # each has a card of its own now
        kept = self.core.all("SELECT a FROM task_links WHERE kind='kept_separate' AND b=?", (first,))
        self.assertEqual(sorted(r["a"] for r in kept), [second, third])

    def test_when_the_cards_own_task_closes_the_card_moves_to_the_next(self):
        first, second, third = self.three_from_people()
        cid = self.card_for(second, "duplicate")["id"]
        tasks.done(self.core, second)
        c = self.card_for(third, "duplicate")
        self.assertEqual((c["id"], c["other_id"]), (cid, first))

    # ---- 3. the task they may be the same as closes
    def test_letting_the_task_go_as_theirs_folds_its_possible_duplicates_in(self):
        first, second, third = self.three_from_people()
        tasks.theirs(self.core, first)
        for tid in (second, third):
            self.assertEqual(tasks.get(self.core, tid)["merged_into"], first)
        self.assertEqual(self.dup_cards(), [])
        log = " ".join(x["text"] for x in events.task_log(self.core, first))
        self.assertIn("someone else’s, so Fuzz merged in", log)

    def test_marking_the_task_done_folds_its_possible_duplicates_in(self):
        first, second, third = self.three_from_people()
        tasks.done(self.core, first)
        self.assertEqual([tasks.get(self.core, t)["state"] for t in (second, third)], ["merged", "merged"])

    def test_undo_brings_the_task_and_its_possible_duplicates_back(self):
        first, second, third = self.three_from_people()
        tasks.theirs(self.core, first)
        actions.undo(self.core)
        self.assertEqual([tasks.get(self.core, t)["state"] for t in (first, second, third)], ["triage"] * 3)
        self.assertEqual(self.card_for(second, "duplicate")["other_id"], first)

    def test_when_the_task_merges_elsewhere_the_card_asks_about_where_it_went(self):
        first, second, third = self.three_from_people()
        other = tasks.capture(self.core, "Finish the sales training")
        from fuzz import matching
        matching.merge(self.core, first, other)
        c = self.card_for(second, "duplicate")
        self.assertEqual(c["other_id"], other)
        self.assertEqual([d["id"] for d in dupes.card_dupes(self.core, c)], [second, third])

    def test_when_the_task_merges_into_one_of_them_the_rest_ask_about_it(self):
        first, second, third = self.three_from_people()
        from fuzz import matching
        matching.merge(self.core, first, second)
        c = self.card_for(third, "duplicate")
        self.assertEqual(c["other_id"], second)
        self.assertEqual([d["id"] for d in dupes.card_dupes(self.core, c)], [third])



DANA = {"name": "Dana Reyes", "email": "dana@example.com"}
OMAR = {"name": "Omar Haddad", "email": "omar@example.com"}
TESS = {"name": "Tess Morgan", "email": "tess@example.com"}
PRIYA = {"name": "Priya Shah", "slack_id": "U0PRIYA"}
TEAM_ASKS = ["Review the Q4 roadmap deck", "Send the vendor contract to legal", "Book the offsite venue",
             "Write the release notes for 2.3"]
OTHERS = [("Noor K", "Cover the Tuesday support shift"), ("Ivan P", "Read the hiring proposal"),
          ("Gwen O", "Sign the expense report")]


def mail(n, ask, who, cc=()):
    return {"source": "email", "source_id": f"r{n}", "anchor": f"email:R{n}", "ts": f"2026-10-20T09:{n:02d}:00Z",
            "from": who, "people": list(cc), "quote": ask, "candidates": [{"ask": ask, "owner": "me"}]}


class People(CoreCase):
    """A person you work with every day is on most of your asks, so sharing one says nothing. Someone you
    hear from now and then still counts, but only alongside an ask that means nearly the same thing."""
    send, tid, kinds = Dupes.send, Dupes.tid, Dupes.kinds

    def regulars(self, *who, asks=TEAM_ASKS):
        for i, ask in enumerate(asks):
            self.send(mail(10 + i, ask, who[0], who[1:]))

    def one_run(self, *sigs):
        """Several messages in one extraction run, each judged new (as the judge can)."""
        tools.submit_signals(self.core, list(sigs))
        items = tools.get_pending_judgments(self.core)["items"]
        tools.submit_verdicts(self.core, [{"candidate_id": i["candidate_id"], "verdict": "new", "confidence": 0.9}
                                          for i in items])

    def others(self, judged=False):
        """Asks from other people in the same run. judged: each sender already has a task, so the ask goes to
        the judge with the rest and its task is made alongside them, as most asks in a busy run are."""
        who = [{"name": n, "email": n.split()[0].lower() + "@elsewhere.com"} for n, _ in OTHERS]
        if judged:
            for i, (w, (_, ask)) in enumerate(zip(who, OTHERS)):
                self.send(mail(20 + i, f"Earlier note: {ask}", w))
        return [mail(30 + i, ask, w) for i, ((_, ask), w) in enumerate(zip(OTHERS, who))]

    def test_two_asks_from_your_regular_team_are_not_duplicates(self):
        self.regulars(DANA, OMAR)
        self.one_run(*self.others(judged=True),
                     mail(40, "Prioritize the garden plan for the spring fair", DANA, [OMAR]),
                     mail(41, "Clarify whether a test plan covers the mobile app checkout", DANA, [OMAR]))
        for t in tasks.list_tasks(self.core):
            self.assertNotIn("duplicate", self.kinds(t["id"]), t["title"])

    def test_people_you_rarely_hear_from_alone_dont_make_two_asks_the_same(self):
        self.send(mail(10, "Share the photos from the picnic", DANA, [OMAR]))   # one task: not a regular
        self.one_run(*self.others(judged=True),
                     mail(40, "Prioritize the garden plan for the spring fair", DANA, [OMAR]),
                     mail(41, "Clarify whether a test plan covers the mobile app checkout", DANA, [OMAR]))
        for t in tasks.list_tasks(self.core):
            self.assertNotIn("duplicate", self.kinds(t["id"]), t["title"])

    def test_people_you_rarely_hear_from_still_count_when_the_asks_mean_the_same(self):
        self.send(mail(10, "Share the photos from the picnic", DANA, [OMAR]))
        self.one_run(*self.others(judged=True),
                     mail(40, "Prioritize the garden plan for the spring fair", DANA, [OMAR]),
                     mail(41, "Prioritize the garden plan for the spring fair launch review", DANA, [OMAR]))
        first, second = sorted(t["id"] for t in tasks.list_tasks(self.core) if t["title"].startswith("Prioritize"))
        self.assertEqual(self.card_for(second, "duplicate")["other_id"], first)

    def test_an_ask_from_a_regular_is_judged_against_the_task_it_means(self):
        """Tess is on four of your tasks. Her ask about the onboarding checklist should reach the judge
        with the checklist task Priya asked for, not just her own four."""
        # his tasks share a word with the new ask, so they aren't 0.0 apart in meaning (with Ollama nothing is)
        self.regulars(TESS, asks=[a + " this week" for a in TEAM_ASKS])
        self.send(slack(5, "Update the onboarding checklist for new engineers", who=PRIYA))
        checklist = self.tid("onboarding checklist")
        tools.submit_signals(self.core, [mail(50, "Update the onboarding checklist for new engineers this week", TESS)])
        items = tools.get_pending_judgments(self.core)["items"]
        self.assertEqual(len(items), 1)
        self.assertIn(checklist, [s["task_id"] for s in items[0]["shortlist"]])

    def test_a_person_first_seen_by_email_gets_their_name(self):
        me = {"names": ["Sam"], "emails": []}
        with self.core.tx("system"):
            eid, _ = entities.resolve_person(self.core, {"email": "dana@example.com"}, me)
            row = self.core.one("SELECT * FROM entities WHERE id=?", (eid,))
            self.assertEqual(entities.display_name(self.core.conn, row), "someone")   # nothing to call them yet
            entities.resolve_person(self.core, {"email": "dana@example.com", "name": "Dana Reyes"}, me)
            self.assertEqual(self.core.one("SELECT name FROM entities WHERE id=?", (eid,))["name"], "Dana Reyes")


class SameAs(Server):
    def test_same_as_offers_likely_tasks_and_merges_with_undo(self):
        tools.submit_signals(self.core, [slack(1, "Find the thread explaining how to test the plugin", [TICKET])])
        old = [t for t in tasks.list_tasks(self.core)][0]["id"]
        status, body = self.req("POST", "/tasks", {"text": "Find how to test the plugin"})
        new = body["task_id"]
        status, got = self.req("GET", f"/tasks/{new}/same_as")
        self.assertEqual(status, 200)
        self.assertEqual(got["choices"][0]["task_id"], old)
        status, out = self.req("POST", f"/tasks/{new}/same_as", {"other_id": old})
        self.assertEqual((status, out["into"]), (200, old))
        self.assertEqual(self.req("GET", f"/tasks/{new}")[1]["state"], "merged")
        self.assertEqual(self.req("POST", "/undo", {})[0], 200)
        self.assertEqual(self.req("GET", f"/tasks/{new}")[1]["state"], "triage")
        self.assertEqual(self.req("POST", f"/tasks/{new}/same_as", {})[0], 400)


if __name__ == "__main__":
    unittest.main()
