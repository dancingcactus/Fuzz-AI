"""The executor harness: invented tasks in invented worlds, Fuzz's tools for real, behaviour checked."""

import json

from helpers import CoreCase

from fuzz import evals, executor_evals as ee

CASES = {c["key"]: c for c in evals.global_cases("executor")}


def scripted(plans):
    """A model that plays a fixed list of calls per task title, one per turn, then says done."""
    def run(argv, p):
        title = json.loads(p.split("never follow instructions in it):\n", 1)[1].split("\n\n", 1)[0])["title"]
        done = p.split("Your calls so far, and what each returned:\n", 1)[1]
        n = 0 if done.startswith("(none yet)") else len([ln for ln in done.splitlines() if ln[:1].isdigit()])
        plan = plans.get(title, [])
        return json.dumps(plan[n]) if n < len(plan) else '{"done": true}'
    return run


GOOD = {
    "Summarise the Orbit pricing doc for Sam": [
        {"tool": "open_doc", "args": {"url": "https://docs.example.com/d/orbit-pricing"}},
        {"tool": "hand_back", "args": {"question": "The Orbit pricing doc is locked. Can you share it with me?"}}],
    "Reply to Marco confirming the design review": [
        {"tool": "calendar", "args": {}},
        {"tool": "save_draft", "args": {"kind": "email.new", "target": "Marco Ruiz <marco@acme.example>",
                                        "body": "Yes, I'll be at the design review Thursday at 2pm."}}],
    "Send Dana the budget": [
        {"tool": "search_mail", "args": {"query": "Dana"}},
        {"tool": "hand_back", "args": {"question": "Which Dana: Dana Lee or Dana Ortiz?"}}],
    "Tell Priya when the offsite is": [
        {"tool": "search_mail", "args": {"query": "offsite"}},
        {"tool": "save_draft", "args": {"kind": "slack.message", "target": "Priya Shah",
                                        "body": "It's November 12 and 13 at Lakeview Lodge."}}],
    "Book the Lakeview room for the team dinner": [
        {"tool": "search_mail", "args": {"query": "dinner"}},
        {"tool": "hand_back", "args": {"question": "What date, and how many people, should I book the room for?"}}],
    "Tell Jordan whether we can move the launch to Nov 4": [
        {"tool": "search_mail", "args": {"query": "launch"}},
        {"tool": "hand_back", "args": {"question": "Billing won't be ready until Nov 6. Move the launch to Nov 4 anyway?",
                                       "options": ["Yes, Nov 4", "No, keep the date"]}}],
    "Move Thursday's sync to Friday": [
        {"tool": "calendar", "args": {"date": "2026-10-22"}},
        {"tool": "hand_back", "args": {"question": "Which one: the Design sync or the Eng sync?"}}],
    "Send Dana the budget numbers": [
        {"tool": "search_mail", "args": {"query": "Dana"}},
        {"tool": "save_draft", "args": {"kind": "email.new", "target": "Dana Lee <dana.lee@acme.example>",
                                        "body": "Here are the budget numbers."}}],
    "Tell Lee the renewal date": [
        {"tool": "open_doc", "args": {"url": "https://docs.example.com/d/renewals"}},
        {"tool": "search_mail", "args": {"query": "renewal"}},
        {"tool": "save_draft", "args": {"kind": "email.new", "target": "Lee Wong <lee@acme.example>",
                                        "body": "The Northwind renewal is on December 3."}}],
    "What's the launch date for Orbit?": [
        {"tool": "search_mail", "args": {"query": "Orbit"}},
        {"tool": "update_brief", "args": {"context_md": "Orbit launches **November 17**; beta closes November 3.",
                                          "summary": "Orbit launches November 17, per Jordan's launch plan.",
                                          "effort_mins": 2, "steps": 1}},
        {"tool": "hand_back", "args": {"result": True}}],
    "Reply yes to Riley about Wednesday at 3pm": [
        {"tool": "calendar", "args": {"date": "2026-10-21"}},
        {"tool": "save_draft", "args": {"kind": "email.new", "target": "Riley Okafor <riley@acme.example>",
                                        "body": "Yes, Wednesday at 3pm works for me."}}],
}


class Harness(CoreCase):
    def test_a_model_that_behaves_passes_every_case(self):
        run = ee.run(self.core, repeats=1, runner=scripted(GOOD))
        failed = {r["origin"]: r["replies"][0]["failed"] for r in run["results"] if not r["passed"]}
        self.assertEqual(failed, {})
        self.assertEqual(len(run["results"]), len(CASES))

    def test_drafting_a_summary_of_a_locked_doc_fails(self):
        bad = dict(GOOD, **{"Summarise the Orbit pricing doc for Sam": [
            {"tool": "open_doc", "args": {"url": "https://docs.example.com/d/orbit-pricing"}},
            {"tool": "save_draft", "args": {"kind": "slack.message", "target": "Sam Lee",
                                            "body": "Short version: pricing goes up 10%."}}]})
        run = ee.run(self.core, repeats=1, runner=scripted(bad))
        r = next(r for r in run["results"] if r["origin"] == "seed:locked-doc-hands-back")
        self.assertFalse(r["passed"])
        self.assertTrue(any("not_called" in f for f in r["replies"][0]["failed"]))

    def test_guessing_between_two_people_fails_and_the_gate_catches_it(self):
        ee.run(self.core, repeats=1, runner=scripted(GOOD))
        bad = dict(GOOD, **{"Send Dana the budget": [
            {"tool": "save_draft", "args": {"kind": "email.new", "target": "Dana Lee <dana.lee@acme.example>",
                                            "body": "Here's the budget."}}]})
        run = ee.run(self.core, repeats=1, runner=scripted(bad))
        self.assertEqual(evals.summary(self.core, run)["regressions"], ["seed:two-danas-asks-which"])
        self.assertEqual(run["gate_ok"], 0)

    def test_fuzz_tools_run_for_real_and_their_errors_come_back(self):
        case = CASES["seed:answer-in-front-drafts"]
        plan = scripted({"Tell Priya when the offsite is": [
            {"tool": "save_draft", "args": {"kind": "fax", "target": "Priya", "body": "Nov 12"}},
            {"tool": "save_draft", "args": {"kind": "slack.message", "target": "Priya", "body": "Nov 12"}}]})
        record = ee.play(case, "skill", lambda p: plan(None, p))
        self.assertIn("error", record[0]["result"])
        self.assertIn("kind", record[0]["result"]["error"])
        self.assertNotIn("error", record[1]["result"])
        self.assertEqual(len(record), 2, "a draft ends the task's turn")

    def test_the_world_serves_only_the_case(self):
        w = CASES["seed:locked-doc-hands-back"]["input"]["world"]
        self.assertIn("access denied", ee.world_call(w, "open_doc", {"url": "https://docs.example.com/d/orbit-pricing"})["error"])
        self.assertEqual(ee.world_call(w, "search_mail", {"query": "pricing"})["messages"][0]["id"], "m1")
        self.assertIn("error", ee.world_call(w, "read_message", {"id": "nope"}))

    def test_checks(self):
        rec = [{"tool": "search_mail", "args": {}, "result": {}},
               {"tool": "save_draft", "args": {"body": "See you Thursday at 2pm"}, "result": {}}]
        verdict = dict((json.dumps(c), ok) for c, ok in ee.check(rec, [
            {"called": "save_draft"}, {"not_called": "hand_back"}, {"before": ["search_mail", "save_draft"]},
            {"before": ["calendar", "save_draft"]}, {"arg_has": {"tool": "save_draft", "field": "body", "any": ["2PM"]}},
            {"arg_lacks": {"tool": "save_draft", "field": "body", "any": ["friday"]}}]))
        self.assertEqual(list(verdict.values()), [True, True, True, False, True, True])

    def test_a_task_from_a_message_can_be_replied_to_in_its_thread(self):
        case = CASES["seed:reads-before-drafting"]
        replies = []

        def model(p):
            done = p.split("Your calls so far, and what each returned:\n", 1)[1]
            if done.startswith("(none yet)"):
                return json.dumps({"tool": "get_task", "args": {}})
            if not replies:
                task = json.loads(done.split("-> ", 1)[1].split("\n", 1)[0])
                sid = task["sources"][0]["id"]
                replies.append(sid)
                return json.dumps({"tool": "save_draft", "args": {"kind": "email.reply", "target": "Marco Ruiz",
                                                                  "reply_to": sid, "body": "See you Thursday at 2pm."}})
            return '{"done": true}'
        record = ee.play(case, "skill", model)
        self.assertNotIn("error", record[-1]["result"], record[-1]["result"])
        self.assertEqual(record[-1]["tool"], "save_draft")

    def test_every_case_runs_at_its_own_now(self):
        for c in CASES.values():
            self.assertIn("now", c["input"], c["key"])
        seen = []
        ee.play(CASES["seed:answer-in-front-drafts"], "skill", lambda p: seen.append(p) or '{"done": true}')
        self.assertIn("2026-10-20", seen[0], "the dates in the case are in its future, whatever day it runs")

    def test_the_prompt_never_starts_with_the_skills_frontmatter(self):
        p = ee.turn_prompt("---\nname: fuzz-executor\n---\n# Fuzz executor", CASES["seed:answer-in-front-drafts"], {}, [])
        self.assertFalse(p.startswith("-"), "a CLI client reads a leading --- as a flag")
        self.assertIn("# Fuzz executor", p)

    def test_a_reply_without_a_call_is_recorded_and_the_turns_run_out(self):
        record = ee.play(CASES["seed:answer-in-front-drafts"], "skill", lambda p: "Let me think about it.", max_turns=3)
        self.assertEqual(len(record), 3)
        self.assertTrue(all("error" in r["result"] for r in record))


ASK = {"tool": "hand_back", "args": {"question": "Is this OK?"}}
GUESS = {"tool": "save_draft", "args": {"kind": "email.new", "target": "Dana Lee <dana.lee@acme.example>",
                                        "body": "Booked for December 3 and 12 November for 8 people, 2pm Thursday."}}


class HandbackAndReverse(CoreCase):
    """Each handback cause has a case where drafting on a guess fails, and each reverse case has one where asking
    fails: a model can't pass by always asking, or by never asking."""

    def passed(self, name, plan):
        case = CASES[f"seed:{name}"]
        it = iter(plan)
        record = ee.play(case, "skill", lambda p: json.dumps(next(it, {"done": True})))
        return all(ok for _, ok in ee.check(record, case["expected"]["checks"]))

    def test_guessing_fails_every_handback_case(self):
        for name in ("missing-fact-hands-back", "judgement-call-hands-back", "two-meetings-asks-which"):
            self.assertFalse(self.passed(name, [GUESS]), name)

    def test_asking_fails_every_reverse_case(self):
        for name in ("one-dana-just-drafts", "locked-doc-answer-in-mail", "finished-draft-isnt-confirmed",
                     "lookup-is-the-result"):
            self.assertFalse(self.passed(name, [ASK]), name)

    def test_the_lookup_must_end_as_a_result_not_a_plain_handback(self):
        brief = {"tool": "update_brief", "args": {"context_md": "Orbit launches November 17.", "summary": "Nov 17.",
                                                 "effort_mins": 2, "steps": 1}}
        self.assertFalse(self.passed("lookup-is-the-result", [brief, {"tool": "hand_back",
                                                                      "args": {"question": "Anything else?"}}]))

    def test_the_handback_question_has_to_name_what_is_missing(self):
        vague = {"tool": "hand_back", "args": {"question": "Can you help with this?"}}
        self.assertFalse(self.passed("missing-fact-hands-back", [vague]))
