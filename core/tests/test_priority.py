"""What a check-in decides: categories, today's set for your energy, its order, holding the rest and
momentum (docs/energy-and-priority.md, issue #9)."""

import json
import unittest

from helpers import CoreCase

from fuzz import actions, cards, checkins, priority, scheduler, tasks, tools

N = [0]


def ask(core, text, sender="Sam Ortiz", email=None, nudge=False, **cand):
    """An ask extracted from an email from sender, with the estimates the extractor gave it."""
    N[0] += 1
    frm = {"name": sender, **({"email": email} if email else {})}
    sig = {"source": "email", "source_id": f"p{N[0]}", "anchor": f"email:p{N[0]}", "ts": "2026-10-20T08:00:00Z",
           "from": frm, "quote": text, "candidates": [dict({"ask": text, "owner": "me"}, **cand)]}
    if nudge:
        sig["nudge"] = True
    tools.submit_signals(core, [sig])
    return core.one("SELECT id FROM tasks WHERE ask=? ORDER BY id DESC", (text,))["id"]


class Priority(CoreCase):
    def order(self):
        return [c["task_id"] for c in self.open_cards()]

    def cats(self, tid):
        return next(c["categories"] for c, t in cards.queue(self.core) if c["task_id"] == tid)

    def vips(self, manager="", people=()):
        def put(cfg):
            cfg["vips"] = {"manager": manager, "people": list(people)}
        self.core.update_config(put)

    def handed_back(self, text="Handed back one"):
        tid = tasks.capture(self.core, text)
        tasks.assign(self.core, tid)
        scheduler.claim_next(self.core)
        tools.hand_back(self.core, tid, question="Which venue?", options=["A", "B"])
        return tid

    # ---- categories
    def test_categories(self):
        self.vips(manager="priya@acme.example")
        boss = ask(self.core, "Send Priya the deck", sender="Priya Shah", email="priya@acme.example")
        chased = ask(self.core, "Answer Rob about the badge order", sender="Rob", nudge=True)
        quick = ask(self.core, "Forward the invoice", effort_mins=3, energy="low")
        deep = ask(self.core, "Write the Q3 plan", effort_mins=90)
        urgent = tasks.capture(self.core, "Confirm headcount", due="2026-10-20T15:00:00Z")
        back = self.handed_back()
        scheduler.tick(self.core)
        self.assertEqual(self.cats(boss), ["vip"])
        self.assertEqual(self.cats(chased), ["waiting"])
        self.assertEqual(self.cats(quick), ["low", "quick"])
        self.assertEqual(self.cats(deep), ["deep"])
        self.assertIn("urgent", self.cats(urgent))
        self.assertIn("returned", self.cats(back))
        self.assertEqual(self.cats(tasks.capture(self.core, "No estimate")), [], "15 minutes, normal energy: Rest")

    def test_a_chase_on_the_thread_makes_it_waiting(self):
        """The real shape: a later message on the same thread, chasing, with no new ask in it."""
        tid = ask(self.core, "Send Rob the badge numbers", sender="Rob Hale")
        anchor = self.core.one("SELECT g.anchor FROM sources s JOIN signals g ON g.key=s.signal_key "
                               "WHERE s.task_id=? AND s.role='origin'", (tid,))["anchor"]
        self.assertEqual(self.cats(tid), [])
        tools.submit_signals(self.core, [{"source": "email", "source_id": "chase-1", "anchor": anchor,
                                          "ts": "2026-10-20T10:00:00Z", "from": {"name": "Rob Hale"},
                                          "quote": "Any update on the badge numbers?", "nudge": True,
                                          "candidates": []}])
        self.assertEqual(self.cats(tid), ["waiting"])

    def test_goal_and_expiring_today(self):
        goal = tasks.capture(self.core, "Ship the onboarding guide")
        moot = tasks.capture(self.core, "Join the vendor call")
        self.core.q("UPDATE tasks SET expires_at=? WHERE id=?", ("2026-10-20T16:00:00Z", moot))
        from fuzz import focus
        orig = focus.focus_ids
        focus.focus_ids = lambda core: {goal}
        self.addCleanup(setattr, focus, "focus_ids", orig)
        self.assertEqual(self.cats(goal), ["goal"])
        self.assertEqual(self.cats(moot), ["urgent"])

    def test_a_one_word_vip_matches_a_first_name(self):
        self.vips(people=["Priya"])
        tid = ask(self.core, "Review the launch notes", sender="Priya Shah")
        self.assertEqual(self.cats(tid), ["vip"])
        self.vips(people=["Pri"])
        self.assertEqual(self.cats(tid), [])

    def test_no_check_in_today_keeps_the_usual_order(self):
        a = tasks.capture(self.core, "First")
        b = ask(self.core, "Quick one", effort_mins=2)
        checkins.record(self.core, "okay")
        self.assertEqual(self.order(), [b, a], "okay: quick before the rest")
        self.clock.advance(days=1)
        self.assertIsNone(priority.energy(self.core), "yesterday's answer doesn't order today")
        self.assertEqual(self.order(), [a, b])

    # ---- the order for each answer
    def test_good_and_okay_put_coming_back_early_and_late(self):
        plain = tasks.capture(self.core, "Plain")
        stale = tasks.capture(self.core, "Stale one")
        self.core.q("UPDATE tasks SET variant_tags=? WHERE id=?", (json.dumps(["stale"]), stale))
        quick = ask(self.core, "Forward the invoice to finance", effort_mins=2)
        checkins.record(self.core, "good")
        self.assertEqual(self.order(), [stale, plain, quick], "good: coming back early; quick is no reason on a good day")
        checkins.record(self.core, "okay")
        self.assertEqual(self.order(), [quick, stale, plain], "okay: quick first, coming back late, Rest last")

    def test_tired_warms_up_then_urgent_and_holds_the_rest(self):
        plain = tasks.capture(self.core, "Plain")
        stale = tasks.capture(self.core, "Stale one")
        self.core.q("UPDATE tasks SET variant_tags=? WHERE id=?", (json.dumps(["stale"]), stale))
        urgent = tasks.capture(self.core, "Confirm headcount", due="2026-10-20T15:00:00Z")
        warm = [ask(self.core, text, effort_mins=2 + i) for i, text in
                enumerate(("Forward the invoice to finance", "Accept the dentist appointment", "Rename the shared folder"))]
        back = self.handed_back()
        scheduler.tick(self.core)
        before = self.last_event_id()
        r = checkins.record(self.core, "tired")
        self.assertEqual(r["held"], 2)
        self.assertEqual(self.types_since(before), ["checkin.answered"] + ["task.scheduled"] * 2)
        self.assertEqual({self.task(plain)["state"], self.task(stale)["state"]}, {"scheduled"})
        self.assertEqual(self.order(), [warm[0], warm[1], urgent, back, warm[2]],
                         "the quickest two, then urgent, then what Fuzz handed back")
        actions.undo(self.core)
        self.assertEqual({self.task(plain)["state"], self.task(stale)["state"]}, {"triage"}, "one Undo")
        self.assertIsNone(priority.energy(self.core))

    def test_due_within_the_hour_goes_ahead_of_the_warm_up(self):
        quick = ask(self.core, "Quick one", effort_mins=2)
        now = tasks.capture(self.core, "Join the call", due="2026-10-20T09:30:00Z")
        scheduler.tick(self.core)
        checkins.record(self.core, "tired")
        self.assertEqual(self.order(), [now, quick])

    def test_overloaded_keeps_urgent_and_quick_vip_or_returned(self):
        self.vips(manager="Priya Shah")
        boss_quick = ask(self.core, "Say yes to Priya", sender="Priya Shah", effort_mins=2)
        boss_long = ask(self.core, "Draft Priya's plan", sender="Priya Shah", effort_mins=60)
        quick = ask(self.core, "Forward the invoice", effort_mins=1)
        slow_urgent = tasks.capture(self.core, "Fix the report", due="2026-10-20T15:00:00Z")
        quick_urgent = ask(self.core, "Approve the PO", effort_mins=3, due="2026-10-20T15:00:00Z")
        scheduler.tick(self.core)
        r = checkins.record(self.core, "overloaded")
        self.assertEqual(r["held"], 2)
        self.assertEqual({self.task(boss_long)["state"], self.task(quick)["state"]}, {"scheduled"})
        self.assertEqual(self.order(), [boss_quick, quick_urgent, slow_urgent],
                         "warm-up, then urgent, quickest first")

    def test_held_cards_come_back_as_ordinary_cards(self):
        tid = tasks.capture(self.core, "Plain")
        checkins.record(self.core, "tired")
        self.assertIn(priority.HOLD_TAG, self.task(tid)["variant_tags"])
        self.clock.advance(days=1, hours=1)
        scheduler.tick(self.core)
        self.assertEqual(self.task(tid)["state"], "triage")
        self.assertNotIn("coming_back", self.cats(tid), "held by a check-in, not put off by you")
        tasks.park(self.core, tid, card=self.card_for(tid, "task"))
        self.assertNotIn(priority.HOLD_TAG, self.task(tid)["variant_tags"] or [])

    def test_a_card_asking_its_own_question_stays(self):
        back = self.handed_back()
        self.assertIn("returned", self.cats(back))
        checkins.record(self.core, "overloaded")   # not quick, so not in today's set…
        self.assertEqual(self.task(back)["state"], "triage", "…but moving it would lose Fuzz's question")
        self.assertEqual(self.task(back)["question"], "Which venue?")

    # ---- momentum
    def test_a_few_more_is_a_few_not_the_whole_pile(self):
        gentle = [ask(self.core, text, effort_mins=20, energy="low") for text in (
            "Tidy the shared drive", "File the expense receipts", "Archive the old sprint boards",
            "Update the team wiki page", "Sort the design feedback", "Clean up the calendar invites",
            "Label the research notes", "Rename the project folders", "Prune the old Slack channels",
            "Retag the support macros")]
        self.assertEqual(checkins.record(self.core, "overloaded")["held"], 10)
        self.assertEqual(checkins.more(self.core)["back"], priority.STRETCH["tired"])
        self.assertEqual(len(self.order()), 3)
        self.assertEqual(checkins.more(self.core)["back"], priority.STRETCH["okay"])
        self.assertEqual(len(self.order()), 7)
        self.assertEqual(sum(self.task(t)["state"] == "scheduled" for t in gentle), 3, "the rest stay held")

    def test_a_few_more_moves_up_one_level_and_brings_some_back(self):
        quick = ask(self.core, "Quick one", effort_mins=2)
        plain = tasks.capture(self.core, "Plain")
        low = ask(self.core, "Tidy the folder", effort_mins=20, energy="low")
        mine = tasks.capture(self.core, "Scheduled by you")
        tasks.schedule(self.core, mine, {"type": "day_part", "day": "tomorrow", "part": "morning"}, offered_only=False)
        checkins.record(self.core, "overloaded")
        self.assertEqual(self.order(), [], "nothing urgent, nothing quick from a VIP")
        r = checkins.more(self.core)
        self.assertEqual((r["energy"], r["back"]), ("tired", 2))
        self.assertEqual(sorted(self.order()), sorted([quick, low]))
        self.assertNotIn("coming_back", self.cats(quick))
        r = checkins.more(self.core)
        self.assertEqual((r["energy"], r["back"]), ("okay", 1))
        self.assertIn(plain, self.order())
        self.assertEqual(self.task(mine)["state"], "scheduled", "never one you scheduled yourself")
        actions.undo(self.core)
        self.assertEqual(priority.energy(self.core), "tired")
        self.assertEqual(self.task(plain)["state"], "scheduled")


if __name__ == "__main__":
    unittest.main()
