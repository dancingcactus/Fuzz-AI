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
