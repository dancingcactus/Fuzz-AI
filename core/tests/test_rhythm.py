"""Focus time and Triage time (docs/book-then-work.md): the one question, two weeks kept scheduled and a week added each
week, a Triage slot at a consistent time, the calendar tool or an ICS download, and learning from what was kept."""

import json
import unittest
from datetime import timedelta

from helpers import CoreCase
from test_http import Server

from fuzz import answers, away, booking, cards, config, drafts, events, onboarding, rhythm, scheduler, tasks, tools
from fuzz.db import FuzzError, parse_iso

def open_cards(core):
    return [cards.get(core, r["id"]) for r in core.all("SELECT id FROM cards WHERE user_id=? AND status='open' ORDER BY id", (core.user_id,))]


# The test clock starts Tue 2026-10-20 09:00 UTC (and tz is UTC). Free time: every weekday 9:00-17:00 for three weeks.
def free_week():
    out = []
    for d in range(20, 40):   # Oct 20 .. Nov 8
        month, day = (10, d) if d <= 31 else (11, d - 31)
        out.append({"start": f"2026-{month:02d}-{day:02d}T09:00:00Z", "end": f"2026-{month:02d}-{day:02d}T17:00:00Z"})
    return out


class Rhythm(CoreCase):
    def setUp(self):
        super().setUp()
        cfg = config.load(self.home)
        cfg["engine"] = {"client": "claude-code", "model": None}
        cfg["extract"] = {"hours": [9, 17], "weekends": False}
        config.save(self.home, cfg)
        self.core = self.make_core()
        self.finish_onboarding()

    def finish_onboarding(self):
        st = onboarding.load(self.core)
        st["done"] = True
        onboarding.save(self.core, st)

    def with_calendar_tool(self):
        cfg = config.load(self.home)
        cfg["send"]["tools"]["claude-code"] = ["mcp__gcal__create_event"]
        config.save(self.home, cfg)
        self.core = self.make_core()

    def read_calendar(self, slots=None):
        tools.report_calendar(self.core, slots or free_week(), [])

    def answer_best(self, option="morning"):
        card = next(c for c in open_cards(self.core) if c["kind"] == "rhythm_best")
        answers.answer(self.core, card["id"], option)

    def plan_card(self):
        return next((c for c in open_cards(self.core) if c["kind"] == "rhythm_plan"), None)

    # ---- the question
    def test_the_question_waits_for_the_first_calendar_read_and_comes_once_before_a_plan(self):
        rhythm.tick(self.core)
        self.assertFalse([c for c in open_cards(self.core) if c["kind"] == "rhythm_best"], "no calendar read yet")
        self.read_calendar()
        rhythm.tick(self.core)
        qs = [c for c in open_cards(self.core) if c["kind"] == "rhythm_best"]
        self.assertEqual(len(qs), 1)
        rhythm.tick(self.core)
        self.assertEqual(len([c for c in open_cards(self.core) if c["kind"] == "rhythm_best"]), 1, "not asked twice")
        self.assertIsNone(self.plan_card(), "nothing is proposed before you answer")

    def test_not_now_comes_back_once_a_week_later_and_never_a_third_time(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("not_now")
        self.clock.advance(days=3)
        rhythm.tick(self.core)
        self.assertFalse([c for c in open_cards(self.core) if c["kind"] == "rhythm_best"])
        self.clock.advance(days=5)
        rhythm.tick(self.core)
        self.assertTrue([c for c in open_cards(self.core) if c["kind"] == "rhythm_best"])
        self.answer_best("not_now")
        self.clock.advance(days=30)
        rhythm.tick(self.core)
        self.assertFalse([c for c in open_cards(self.core) if c["kind"] == "rhythm_best"])

    # ---- the plan: two weeks, three blocks a week, a consistent Triage slot
    def test_two_weeks_of_focus_time_and_a_triage_slot_at_one_time_each_working_day(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        card = self.plan_card()
        self.assertIsNotNone(card)
        slots = card["payload"]["slots"]
        focus = [s for s in slots if s["kind"] == "focus"]
        triage = [s for s in slots if s["kind"] == "triage"]
        self.assertEqual(len(focus), 6, "three blocks a week for two weeks")
        for s in focus:
            a, b = parse_iso(s["start"]), parse_iso(s["end"])
            self.assertEqual((b - a).total_seconds() / 60, 90)
            self.assertTrue(9 <= a.hour and b.hour + b.minute / 60 <= 12, "inside mornings")
            self.assertLess(a.weekday(), 5)
        self.assertEqual(len({parse_iso(s["start"]).date() for s in focus}), 6, "on different days")
        self.assertEqual(len(triage), 10, "every working day in the two weeks, today's too while its time is still ahead")
        self.assertEqual(len({parse_iso(s["start"]).strftime("%H:%M") for s in triage}), 1, "the same time every day")
        for s in triage:
            self.assertEqual((parse_iso(s["end"]) - parse_iso(s["start"])).total_seconds() / 60, 30)
        t = parse_iso(triage[0]["start"])
        self.assertFalse(9 <= t.hour < 12, "outside your best hours")
        for s in focus:   # the link carries the block's start too, so one opened early doesn't start it
            self.assertIn("#/work?until=" + parse_iso(s["end"]).strftime("%H:%M") + "&from=" + parse_iso(s["start"]).strftime("%H:%M"), s["link"])
        for s in triage:
            self.assertIn("#/triage?until=", s["link"])
        # nothing overlaps
        spans = sorted((parse_iso(s["start"]), parse_iso(s["end"])) for s in slots)
        for (a1, b1), (a2, b2) in zip(spans, spans[1:]):
            self.assertLessEqual(b1, a2)

    def test_the_triage_time_is_chosen_once_and_kept(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("afternoon")
        first = rhythm.load(self.core)["triage"]
        self.assertTrue(first)
        # a busier calendar later never moves it
        self.clock.advance(days=8)
        self.read_calendar([{"start": "2026-10-28T09:00:00Z", "end": "2026-10-28T10:00:00Z"}] + free_week()[10:])
        rhythm.tick(self.core)
        self.assertEqual(rhythm.load(self.core)["triage"], first)

    def test_a_day_with_no_room_for_triage_is_skipped_not_moved(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        at = rhythm.load(self.core)["triage"]["at"]
        hh = int(at[:2])
        # Wednesday 21st has a meeting over the Triage time; every other day is free
        slots = [s for s in free_week() if not s["start"].startswith("2026-10-21")]
        slots.append({"start": "2026-10-21T09:00:00Z", "end": f"2026-10-21T{hh:02d}:{at[3:]}:00Z"} if hh > 9 else
                     {"start": "2026-10-21T13:00:00Z", "end": "2026-10-21T17:00:00Z"})
        self.read_calendar(slots)
        st = rhythm.load(self.core)
        new = rhythm.plan(self.core, dict(st, slots=[]), self.clock())
        triage = [s for s in new["slots"] if s["kind"] == "triage"]
        self.assertIn("2026-10-21", new["skipped"])
        self.assertEqual({parse_iso(s["start"]).strftime("%H:%M") for s in triage}, {at}, "the same time on the other days")

    def test_focus_time_uses_your_own_focus_slot_first(self):
        slots = free_week() + [{"start": "2026-10-22T10:00:00Z", "end": "2026-10-22T12:00:00Z", "title": "Focus time"}]
        self.read_calendar(slots)
        rhythm.tick(self.core)
        self.answer_best("morning")
        focus = [s for s in self.plan_card()["payload"]["slots"] if s["kind"] == "focus"]
        self.assertIn("2026-10-22T10:00:00Z", [s["start"] for s in focus])

    def test_weekends_and_hours_follow_your_working_hours(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("varies")
        for s in self.plan_card()["payload"]["slots"]:
            a = parse_iso(s["start"])
            self.assertLess(a.weekday(), 5)
            self.assertTrue(9 <= a.hour < 17)

    # ---- approving
    def test_with_a_calendar_tool_approving_makes_one_hold_per_slot_on_a_task_nobody_sees(self):
        self.with_calendar_tool()
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        card = self.plan_card()
        self.assertEqual(card["payload"]["via"], "calendar")
        n = len(card["payload"]["slots"])
        answers.answer(self.core, card["id"], "approve")
        holds = self.core.all("SELECT * FROM drafts WHERE kind='calendar_hold' AND status='approved'")
        self.assertEqual(len(holds), n)
        holder = {h["task_id"] for h in holds}
        self.assertEqual(len(holder), 1)
        hid = holder.pop()
        # the sender can claim them one by one
        t, d = scheduler.claim_next_send(self.core)
        self.assertEqual(t["id"], hid)
        self.assertEqual(d["kind"], "calendar_hold")
        self.assertIn("#/", d["body"])
        # and nothing shows it: no list, no queue, no away summary, no matcher candidate, no deliverable, no focus
        self.assertNotIn(hid, [x["id"] for x in tasks.list_tasks(self.core)])
        self.assertNotIn(hid, [t2["id"] for _c, t2 in cards.queue(self.core) if t2])
        self.assertEqual(self.core.one("SELECT COUNT(*) n FROM cards WHERE task_id=?", (hid,))["n"], 0)
        self.assertEqual(events.check_replay(self.core), [])

    def test_without_a_calendar_tool_approving_leaves_the_slots_to_download(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        card = self.plan_card()
        self.assertEqual(card["payload"]["via"], "file")
        answers.answer(self.core, card["id"], "approve")
        self.assertEqual(self.core.all("SELECT * FROM drafts WHERE kind='calendar_hold'"), [])
        self.assertTrue(rhythm.view(self.core)["upcoming"])
        self.assertTrue(all(s["status"] == "ics" for s in rhythm.view(self.core)["upcoming"]))

    def test_skip_drops_the_slots_and_nothing_is_added_to_your_calendar(self):
        self.with_calendar_tool()
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        answers.answer(self.core, self.plan_card()["id"], "skip")
        self.assertEqual(self.core.all("SELECT * FROM drafts WHERE kind='calendar_hold'"), [])
        self.assertEqual(rhythm.view(self.core)["upcoming"], [])

    def test_always_allow_makes_the_next_weeks_happen_without_a_card(self):
        self.with_calendar_tool()
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        answers.answer(self.core, self.plan_card()["id"], "always_allow")
        self.assertTrue(drafts.has_grant(self.core, "calendar", "own"))
        self.clock.advance(days=8)
        self.read_calendar(free_week()[10:] + [{"start": "2026-11-09T09:00:00Z", "end": "2026-11-09T17:00:00Z"}])
        r = rhythm.tick(self.core)
        self.assertIsNone(self.plan_card(), "no card when you always allow it")
        self.assertTrue(r["proposed"] and r["proposed"]["applied"] > 0)

    # ---- two weeks stay scheduled, one week added each week
    def test_nothing_new_is_proposed_until_a_week_has_passed_and_never_moves_what_is_there(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        answers.answer(self.core, self.plan_card()["id"], "approve")
        before = [(s["id"], s["start"]) for s in rhythm.load(self.core)["slots"]]
        for _ in range(3):
            self.clock.advance(hours=12)
            rhythm.tick(self.core)
        self.assertIsNone(self.plan_card(), "the week is not up")
        self.clock.advance(days=7)
        self.read_calendar(free_week()[10:] + [{"start": f"2026-11-{d:02d}T09:00:00Z", "end": f"2026-11-{d:02d}T17:00:00Z"} for d in range(9, 20)])
        rhythm.tick(self.core)
        card = self.plan_card()
        self.assertIsNotNone(card, "a week later, the week that came into view")
        kept = {s["id"]: s["start"] for s in rhythm.load(self.core)["slots"]}
        for sid, start in before:
            if sid in kept:
                self.assertEqual(kept[sid], start, "what was already scheduled never moves")
        self.assertTrue(all(parse_iso(s["start"]) > self.clock() for s in card["payload"]["slots"]))

    def test_it_is_safe_to_tick_every_minute_while_a_card_waits(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        n = len([c for c in open_cards(self.core) if c["kind"] == "rhythm_plan"])
        for _ in range(10):
            self.clock.advance(minutes=1)
            rhythm.tick(self.core)
        self.assertEqual(len([c for c in open_cards(self.core) if c["kind"] == "rhythm_plan"]), n)

    # ---- learning
    def settle(self, slot, kept, minutes=0, finished=False):
        """Run the clock to inside a block, act as you would (or not), and past its end."""
        self.clock.t = parse_iso(slot["start"]) + timedelta(minutes=5)
        if kept:
            tid = tasks.capture(self.core, f"Work {slot['id']}")
            tasks.deep_work(self.core, tid)
            if minutes:
                rhythm.outcome(self.core, minutes, finished)
        self.clock.t = parse_iso(slot["end"]) + timedelta(minutes=1)
        rhythm.evaluate(self.core)

    def approved_slots(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        answers.answer(self.core, self.plan_card()["id"], "approve")
        return [s for s in rhythm.load(self.core)["slots"] if s["kind"] == "focus"]

    def test_a_block_is_kept_when_you_started_work_in_it_and_missed_when_you_did_not(self):
        s = self.approved_slots()
        self.settle(s[0], kept=True, minutes=40, finished=True)
        self.settle(s[1], kept=False)
        got = {x["id"]: x for x in rhythm.load(self.core)["slots"]}
        self.assertEqual(got[s[0]["id"]]["status"], "kept")
        self.assertEqual((got[s[0]["id"]]["minutes"], got[s[0]["id"]]["finished"]), (40, True))
        self.assertEqual(got[s[1]["id"]]["status"], "missed")

    def test_a_missed_block_makes_no_noise_and_changes_nothing_by_itself(self):
        s = self.approved_slots()
        before = rhythm.load(self.core)["best"]
        self.settle(s[0], kept=False)
        self.assertEqual(rhythm.load(self.core)["best"], before)
        self.assertEqual(rhythm.effective_best(self.core), "morning", "one miss changes nothing")

    def test_a_sustained_pattern_moves_the_aim_and_the_card_says_so(self):
        st = rhythm.load(self.core)
        st["best"] = "morning"
        base = parse_iso("2026-10-12T09:00:00Z")
        slots = []
        for i in range(4):   # four mornings, all missed
            slots.append({"id": f"focus-m{i}", "kind": "focus", "start": (base + timedelta(days=i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "end": (base + timedelta(days=i, hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "missed",
                          "bucket": "morning", "title": "Focus time", "link": "x"})
        for i in range(3):   # three afternoons, mostly kept
            slots.append({"id": f"focus-a{i}", "kind": "focus", "start": (base + timedelta(days=i, hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                          "end": (base + timedelta(days=i, hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ"), "status": "kept",
                          "bucket": "afternoon", "title": "Focus time", "link": "x", "minutes": 50})
        st["slots"] = slots
        self.assertEqual(rhythm.effective_best(self.core, st), "afternoon")
        self.assertIn("Mornings have been hard to get to", rhythm._why(self.core, st))
        self.assertNotIn("missed", rhythm._why(self.core, st).lower().replace("hard to get to", ""), "no counts, no blame")

    def test_the_triage_slot_is_a_habit_so_misses_never_move_it(self):
        s = self.approved_slots()
        at = rhythm.load(self.core)["triage"]["at"]
        triage = [x for x in rhythm.load(self.core)["slots"] if x["kind"] == "triage"]
        for t in triage[:4]:
            self.settle(t, kept=False)
        self.assertEqual(rhythm.load(self.core)["triage"]["at"], at)


    # ---- what the second look found
    def test_skip_holds_until_next_week_and_never_proposes_a_skipped_slot_again(self):
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        skipped = {x["id"] for x in self.plan_card()["payload"]["slots"]}
        answers.answer(self.core, self.plan_card()["id"], "skip")
        for _ in range(5):
            self.clock.advance(minutes=1)
            rhythm.tick(self.core)
        self.assertIsNone(self.plan_card(), "no new card a minute after Skip, and none the minute after that")
        ids = [x["id"] for x in rhythm.load(self.core)["slots"]]
        self.assertEqual(len(ids), len(set(ids)), "no duplicate slots")
        self.clock.advance(days=7)
        self.read_calendar(free_week()[10:] + [{"start": f"2026-11-{d:02d}T09:00:00Z", "end": f"2026-11-{d:02d}T17:00:00Z"} for d in range(9, 20)])
        rhythm.tick(self.core)
        card = self.plan_card()
        self.assertIsNotNone(card, "a week later it asks again")
        self.assertFalse(skipped & {x["id"] for x in card["payload"]["slots"]}, "what you skipped isn't offered again")

    def test_a_grant_you_already_have_never_skips_the_first_plan(self):
        self.with_calendar_tool()
        self.core.q("INSERT INTO grants (id, user_id, scope, resource, kind) VALUES (?,?,?,?,?)", (self.core.new_id("grants"), self.core.user_id, "calendar", "own", "always"))
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        self.assertIsNotNone(self.plan_card(), "the first plan asks, whatever Book time's grant says")
        self.assertEqual(self.core.all("SELECT * FROM drafts WHERE kind='calendar_hold'"), [])

    def test_an_automatic_top_up_leaves_one_line_to_say_so(self):
        self.with_calendar_tool()
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        answers.answer(self.core, self.plan_card()["id"], "always_allow")
        self.clock.advance(days=8)
        self.read_calendar(free_week()[10:] + [{"start": f"2026-11-{d:02d}T09:00:00Z", "end": f"2026-11-{d:02d}T17:00:00Z"} for d in range(9, 20)])
        rhythm.tick(self.core)
        notice = rhythm.view(self.core)["notice"]
        self.assertTrue(notice and "to your calendar" in notice["text"])

    def test_resuming_a_task_you_left_mid_session_counts_even_with_no_event_and_a_late_wrap_up(self):
        s = self.approved_slots()
        slot = s[0]
        # in the block nothing was started (a left-off task was resumed: no assigned event); the block ends and is settled
        self.clock.t = parse_iso(slot["end"]) + timedelta(minutes=1)
        rhythm.evaluate(self.core)
        self.assertEqual({x["id"]: x for x in rhythm.load(self.core)["slots"]}[slot["id"]]["status"], "missed")
        # the wrap-up arrives a few minutes later, inside the tail
        self.clock.t = parse_iso(slot["end"]) + timedelta(minutes=10)
        rhythm.outcome(self.core, 35, False)
        self.assertEqual({x["id"]: x for x in rhythm.load(self.core)["slots"]}[slot["id"]]["status"], "kept", "a late outcome turns a wrong miss into kept")

    def test_minutes_reported_before_the_block_ends_make_it_kept(self):
        s = self.approved_slots()
        self.clock.t = parse_iso(s[1]["start"]) + timedelta(minutes=20)
        rhythm.outcome(self.core, 20, False)
        self.clock.t = parse_iso(s[1]["end"]) + timedelta(minutes=1)
        rhythm.evaluate(self.core)
        self.assertEqual({x["id"]: x for x in rhythm.load(self.core)["slots"]}[s[1]["id"]]["status"], "kept")

    def test_no_calendar_read_still_gets_the_question_a_few_days_after_the_onboarding(self):
        st = onboarding.load(self.core)
        st["finished_at"] = self.clock().isoformat()
        onboarding.save(self.core, st)
        rhythm.tick(self.core)
        self.assertFalse([c for c in open_cards(self.core) if c["kind"] == "rhythm_best"])
        self.clock.advance(days=4)
        rhythm.tick(self.core)
        self.assertTrue([c for c in open_cards(self.core) if c["kind"] == "rhythm_best"])
        self.answer_best("afternoon")
        self.assertIsNotNone(self.plan_card(), "planned in your working hours")

    def test_the_holder_is_not_in_the_away_summary_after_its_holds_are_sent(self):
        self.with_calendar_tool()
        self.read_calendar()
        rhythm.tick(self.core)
        self.answer_best("morning")
        answers.answer(self.core, self.plan_card()["id"], "approve")
        while True:
            t, d = scheduler.claim_next_send(self.core)
            if t is None:
                break
            drafts.mark_sent(self.core, t["id"], d["id"], "Google Calendar", link="evt-" + str(d["id"]))
        summary = json.dumps(away.summary(self.core))
        self.assertNotIn("Calendar holds from Fuzz", summary)

    # ---- replay
    def test_the_state_replays_from_the_log(self):
        self.approved_slots()
        self.assertEqual(events.check_replay(self.core), [])


class Hidden(CoreCase):
    """The holder task owns the holds and shows nowhere (docs/book-then-work.md)."""

    def test_it_is_merged_away_so_every_list_skips_it(self):
        cfg = config.load(self.home)
        cfg["engine"] = {"client": "claude-code", "model": None}
        cfg["send"]["tools"]["claude-code"] = ["mcp__gcal__create_event"]
        cfg["extract"] = {"hours": [9, 17], "weekends": False}
        config.save(self.home, cfg)
        core = self.make_core()
        st = onboarding.load(core)
        st["done"] = True
        onboarding.save(core, st)
        tools.report_calendar(core, free_week(), [])
        rhythm.tick(core)
        card = next(c for c in open_cards(core) if c["kind"] == "rhythm_best")
        answers.answer(core, card["id"], "morning")
        plan = next(c for c in open_cards(core) if c["kind"] == "rhythm_plan")
        answers.answer(core, plan["id"], "approve")
        hid = core.one("SELECT id FROM tasks WHERE variant_tags LIKE '%rhythm_holder%'")["id"]
        self.assertEqual(tasks.get(core, hid)["state"], "merged")
        self.assertNotIn(hid, [t["id"] for t in tasks.list_tasks(core)])
        self.assertNotIn(hid, [t["id"] for t in tasks.list_tasks(core, "triage,queued,working,review,scheduled,waiting,parked,deepwork,done,letgo")])
        self.assertEqual(core.one("SELECT COUNT(*) n FROM cards WHERE task_id=?", (hid,))["n"], 0)


class Api(Server):
    def test_the_answer_and_what_is_coming_up(self):
        status, got = self.req("GET", "/rhythm")
        self.assertEqual((status, got["best"], got["upcoming"]), (200, None, []))
        status, got = self.req("PUT", "/rhythm", {"best": "afternoon"})
        self.assertEqual((status, got["best"]), (200, "afternoon"))
        self.assertEqual(self.req("PUT", "/rhythm", {"best": "dawn"})[0], 400)

    def test_seen_is_fine_with_nothing_to_say(self):
        self.assertEqual(self.req("POST", "/rhythm/seen", {}), (200, {"ok": True}))

    def test_a_session_outcome_with_no_block_is_fine(self):
        status, got = self.req("POST", "/rhythm/outcome", {"minutes": 25, "finished": True})
        self.assertEqual((status, got), (200, {"slot": None}))
        self.assertEqual(self.req("POST", "/rhythm/outcome", {"minutes": "lots"})[0], 400)


class Migration(CoreCase):
    def test_what_was_waiting_in_a_queue_comes_back_asking_for_a_time(self):
        a = tasks.capture(self.core, "Write the Q4 readout")
        b = tasks.capture(self.core, "Draft the hiring plan")
        tasks.deep_work(self.core, a)
        tasks.deep_work(self.core, b)
        tasks.deep_work(self.core, b, left_off="Outline done")
        c = tasks.capture(self.core, "Typed in a session", deep_work=True)
        self.assertEqual(tasks.migrate_queue(self.core), 3)
        for tid in (a, b, c):
            t = tasks.get(self.core, tid)
            self.assertEqual(t["state"], "triage")
            self.assertIn("ask_book", t["variant_tags"])
            card = next(x for x in cards.open_cards(self.core, tid) if x["kind"] == "task")
            self.assertEqual(card["suggested"], "book", "the card leads with Book time")
        self.assertIn("Outline done", tasks.get(self.core, b)["notes"], "your place is kept")
        self.assertEqual(tasks.migrate_queue(self.core), 0, "once")
        self.assertEqual(events.check_replay(self.core), [])


if __name__ == "__main__":
    unittest.main()
