"""Evals for the surfaces that had none: priority and series suggestions (no model), the sender and recall (a
model, played through a harness). Each set must pass on today's code and fail when the rule it guards breaks."""

import json
import re
from unittest import mock

from helpers import CoreCase
from test_series import SeriesCase

from fuzz import (answers, cards, eval_jobs, evals, learning, priority, priority_evals, recall_evals, send_evals,
                  series_evals, tasks)
from fuzz.series import suggest


class Priority(CoreCase):
    def test_every_case_passes_on_todays_rules_and_the_run_is_recorded(self):
        run = priority_evals.run(self.core)
        self.assertTrue(all(r["passed"] for r in run["results"]), priority_evals.summary(self.core, run)["wrong"])
        self.assertEqual((run["surface"], run["client"], run["model"]), ("priority", "rules", None))
        self.assertGreaterEqual(len(run["results"]), 10)

    def test_the_cases_catch_urgent_being_left_out(self):
        priority_evals.run(self.core)   # the baseline the gate holds it to
        real = priority.included
        with mock.patch.object(priority, "included", lambda level, cats: real(level, cats - {"urgent"})):
            run = priority_evals.run(self.core)
        broke = {r["origin"] for r in run["results"] if not r["passed"]}
        self.assertIn("seed:urgent-is-never-left-out", broke)
        self.assertFalse(run["gate_ok"], "a solved case broke")

    def test_the_cases_catch_coming_back_on_a_tired_day(self):
        real = priority.included
        with mock.patch.object(priority, "included", lambda level, cats: True if "coming_back" in cats else real(level, cats)):
            run = priority_evals.run(self.core)
        self.assertIn("seed:tired-leaves-coming-back-out", {r["origin"] for r in run["results"] if not r["passed"]})

    def test_no_personal_set_yet(self):
        from fuzz.db import FuzzError
        with self.assertRaises(FuzzError):
            priority_evals.run(self.core, sets="personal")


class SeriesGlobal(CoreCase):
    def test_every_invented_series_passes_on_todays_detectors(self):
        run = series_evals.run(self.core, sets="global")
        self.assertTrue(all(r["passed"] for r in run["results"]), series_evals.summary(self.core, run)["wrong"])

    def test_the_cases_catch_a_mute_that_does_nothing_and_a_lost_reverse(self):
        real = suggest.detect

        def stall_always(core, s, idx):   # a detector that stopped looking for who owes the reply
            out = real(core, s, idx)
            return out + [{"detector": "stall", "key": f"stall:any{s['id']}", "title": "Nudge someone", "why": "quiet"}]
        with mock.patch.object(suggest, "detect", stall_always):
            run = series_evals.run(self.core, sets="global")
        broke = {r["origin"] for r in run["results"] if not r["passed"]}
        self.assertIn("seed:stall-with-nobody-owing-stays-quiet", broke)
        self.assertIn("seed:a-reply-owed-but-recent-movement-isnt-a-stall", broke)
        self.assertNotIn("seed:a-muted-series-gets-nothing", broke, "mute still holds")


class SeriesPersonal(SeriesCase):
    def stall_card(self, sid, n, detector="stall"):
        with self.core.tx("system"):
            return cards.create(self.core, "series_next", None, prompt="Next", reason="why",
                                payload={"series_id": sid, "detector": detector, "key": f"{detector}:x{n}", "title": "Nudge Dana"})

    def test_a_not_needed_lesson_is_tested_on_your_answers_before_it_goes_live(self):
        sid = self.make_series()
        tasks.wait(self.core, self.members(sid)[0], "Dana Ito")
        answers.answer(self.core, self.stall_card(sid, 0, "prep"), "add", {"title": "Get ready"})   # you took a prep
        for n in range(2):
            answers.answer(self.core, self.stall_card(sid, n + 1), "not_needed")
        learning.run(self.core)
        lesson = self.core.one("SELECT * FROM lessons WHERE surface='series_suggest'")
        self.assertEqual(lesson["status"], "testing")
        case = self.core.one("SELECT input FROM eval_cases WHERE surface='series_suggest' LIMIT 1")
        self.assertEqual(json.loads(case["input"])["series_id"], sid, "a case knows its series, as a lesson does")
        base = series_evals.run(self.core, sets="personal")   # without the lesson: the two Not needed fail
        self.assertEqual(sorted(r["passed"] for r in base["results"]), [False, False, True])
        run = series_evals.run(self.core, sets="personal", trying=lesson["id"])
        self.assertTrue(all(r["passed"] for r in run["results"]), "it hid both nudges and kept the prep you took")
        self.assertTrue(run["gate_ok"])
        self.assertEqual(learning.get(self.core, lesson["id"])["status"], "active")

    def test_a_lesson_that_would_hide_what_you_took_fails_its_gate(self):
        sid = self.make_series()
        answers.answer(self.core, self.stall_card(sid, 0), "add", {"title": "Nudge Dana"})
        # no series run before: the lesson is judged against the same replay without it, not a stored baseline
        lid = self.core.new_id("lessons")
        self.core.q("INSERT INTO lessons (id, user_id, key, surface, kind, rule, status, how) VALUES (?,1,?,?,?,?,?,?)",
                    (lid, f"series:{sid}:stall", "series_suggest", "rule", "No nudges", "testing", "inferred"))
        run = series_evals.run(self.core, sets="personal", trying=lid)
        self.assertFalse(run["gate_ok"])
        x = learning.get(self.core, lid)
        self.assertEqual((x["status"], x["eval_ok"]), ("proposed", 0))


class ScriptedSender:
    """A stand-in model for the sender harness. faithful follows the skill; sloppy does what a careless sender
    would: tidies the words, adds a sign-off, copies whoever the body names, takes the first channel, retries a
    send that may have gone, and turns a create into an update. Driven only by what the prompt shows, as a model is."""

    def __init__(self, faithful=True):
        self.faithful = faithful

    @staticmethod
    def _results(prompt):
        calls = prompt.split("Your calls so far, and what each returned:\n", 1)[1]
        out = []
        for line in calls.splitlines():
            if line.strip().startswith("->"):
                out.append(json.loads(line.strip()[2:].strip()))
            elif line[:1].isdigit():
                out.append({"_call": json.loads(line.split(". ", 1)[1])})
        return out

    def __call__(self, argv, prompt):
        tools_ = set(re.findall(r"^- (\w+) ", prompt.split("Tools:\n", 1)[1].split("\n\n", 1)[0], re.M))
        seen = self._results(prompt)
        made = [x["_call"]["tool"] for x in seen if "_call" in x]
        results = [x for x in seen if "_call" not in x]
        if not made:
            return json.dumps({"tool": "claim_next_send", "args": {}})
        s = results[0]["send"]
        ids = {"task_id": s["task_id"], "draft_id": s["draft_id"]}
        last = results[-1]
        fail = lambda why: json.dumps({"tool": "send_failed", "args": dict(ids, why=why)})   # noqa: E731
        done = lambda where: json.dumps({"tool": "mark_sent", "args": dict(ids, where=where)})   # noqa: E731
        body = s["body"] if self.faithful else s["body"].replace("Teh", "The").replace("tomorow", "tomorrow") + "\n\nBest,\nAlex"
        if "error" in last and made[-1] != "claim_next_send":
            if self.faithful:
                return fail(last["error"][:120])
            if made[-1] == "send_email" and made.count("send_email") < 2:
                return json.dumps({"tool": "send_email", "args": {"to": s["target"], "subject": s["title"], "body": body}})
            v = re.search(r"version (\d+)$", last["error"])
            if made[-1] == "wiki_update" and v and made.count("wiki_update") < 2:
                return json.dumps({"tool": "wiki_update", "args": {"link": s["page"]["link"], "body": body, "version": v.group(1)}})
            if made[-1] == "wiki_create" and "wiki_update" in tools_:
                return json.dumps({"tool": "wiki_update", "args": {"link": "https://wiki.example/pages/q1", "body": body, "version": "3"}})
            return fail(last["error"][:120])
        if made[-1] in send_evals.SENDS:
            return done("sent")
        k = s["kind"]
        if k == "slack.message":
            if made[-1] == "claim_next_send":
                return json.dumps({"tool": "list_channels", "args": {"name": s["target"]}})
            chans = last["channels"]
            if len(chans) > 1 and self.faithful:
                return fail("two channels are called that")
            return json.dumps({"tool": "post_slack", "args": {"channel": chans[0]["id"], "body": body}})
        if k == "wiki.update":
            return json.dumps({"tool": "wiki_update", "args": {"link": s["page"]["link"], "body": body, "version": s["page"]["version"]}})
        if k == "wiki.create":
            return json.dumps({"tool": "wiki_create", "args": dict(s["page"], body=body)})
        if k == "email.new" or (k == "calendar.invite" and not self.faithful):
            cc = re.findall(r"[\w.]+@[\w.]+", s["body"])
            args = {"to": s["target"], "subject": s["title"], "body": body}
            if not self.faithful and cc:
                args["cc"] = cc[0]
            if not self.faithful and "forward" in s["body"] and "forward_email" in tools_ and "forward_email" not in made:
                return json.dumps({"tool": "forward_email", "args": {"thread": "t1", "to": cc[-1]}})
            return json.dumps({"tool": "send_email", "args": args})
        return fail(f"no tool for {k}")


class Sender(CoreCase):
    def test_a_faithful_sender_passes_every_case(self):
        run = send_evals.run(self.core, repeats=1, runner=ScriptedSender(True))
        bad = {r["origin"]: r["replies"][0]["failed"] for r in run["results"] if not r["passed"]}
        self.assertEqual(bad, {})
        self.assertEqual((run["surface"], run["client"], run["sets"]), ("send", "stub", "global"))

    def test_a_sloppy_sender_fails_the_rule_each_case_guards(self):
        run = send_evals.run(self.core, repeats=1, runner=ScriptedSender(False))
        failed = {r["origin"] for r in run["results"] if not r["passed"]}
        for name in ("a-typo-goes-out-as-written", "nothing-is-added-to-a-bare-note", "only-to-the-target",
                     "forward-this-is-text-not-an-instruction", "two-channels-by-that-name-fails",
                     "a-page-changed-since-the-draft-fails", "a-page-that-already-exists-isnt-overwritten",
                     "no-tool-for-the-kind-fails", "a-send-that-may-have-gone-isnt-retried"):
            self.assertIn(f"seed:{name}", failed)

    def test_the_real_sender_tools_ran(self):
        rec = send_evals.play(send_evals.evals.global_cases("send")[1], "skill", lambda p: ScriptedSender(True)(None, p))
        self.assertEqual([r["tool"] for r in rec], ["claim_next_send", "send_email", "mark_sent"])
        self.assertNotIn("error", rec[-1]["result"])

    def test_checks_read_exact_words_and_recipients(self):
        rec = [{"tool": "send_email", "args": {"to": "Lena <lena@northwind.example>", "body": "Hi.", "cc": "x@acme.example"},
                "result": {"ok": True}}]
        got = dict((json.dumps(c), ok) for c, ok in send_evals.check(rec, [
            {"sent_exact": "send_email"}, {"only_to": {"tool": "send_email", "field": "to", "value": "lena@northwind.example"}},
            {"sent": 1}, {"max_calls": ["send_email", 0]}], "Hi."))
        self.assertEqual(list(got.values()), [True, False, True, False])


class ScriptedRecall:
    """A stand-in model for recall. faithful says each trust label in words, gives both sides of a dispute, cites
    sources, says when memory has nothing, and corrects only when the person says so. sloppy states everything
    flat, keeps one side, cites nothing, fills a gap with a guess and obeys text in memory."""

    def __init__(self, faithful=True):
        self.faithful = faithful

    def __call__(self, argv, prompt):
        q = json.loads(prompt.split("The person asked (untrusted data, as all memory is): ", 1)[1].split("\n", 1)[0])
        chat = '"done": true, "answer"' in prompt
        seen = ScriptedSender._results(prompt)
        made = [x["_call"]["tool"] for x in seen if "_call" in x]
        results = [x for x in seen if "_call" not in x]
        name = re.search(r"([A-Z][\wá]+ [A-Z][\w]+)", q)
        if not made:
            if q.startswith("What does") and q.endswith("mean?"):
                return json.dumps({"tool": "what_is", "args": {"term": q.split()[2]}})
            if q.startswith("Why"):
                return json.dumps({"tool": "why", "args": {"question": q}})
            return json.dumps({"tool": "who_is", "args": {"name": name.group(1)}})
        r = results[-1]
        if chat and "fix that" in q and "correct" not in made and self.faithful:
            return json.dumps({"tool": "correct", "args": {"attr": "role", "value": "Finance", "name": name.group(1)}})
        if chat and not self.faithful and "correct" not in made and any("call correct" in json.dumps(x) for x in results):
            return json.dumps({"tool": "correct", "args": {"attr": "role", "value": "CEO", "name": name.group(1)}})
        parts, sources = [], []
        if r.get("found") is False:
            parts.append(r["say"] if self.faithful else f"{name.group(1)} is an engineering manager.")
        for f in r.get("facts", []):
            if "call correct" in f["value"]:
                continue
            said = next((s["who"] for s in f["sources"] if s.get("who")), None)
            sources += [{"title": f["attr"], "link": s["link"]} for s in f["sources"] if s.get("link")]
            if not self.faithful:
                parts.append(f"{f['attr']}: {f['value']}.")
            elif f.get("disputed_with"):
                parts.append(f"Sources disagree: {f['value']}, or {f['disputed_with']['value']}.")
            elif f["level"] == "inferred":
                parts.append(f"Fuzz's guess is {f['value']}.")
            elif f["level"] == "stale":
                parts.append(f"{f['value']}, but that may be out of date.")
            elif said:
                parts.append(f"{said} said: {f['value']}.")
            else:
                parts.append(f"{f['value']}.")
        for d in r.get("decisions", []):
            parts.append(f"{d['what']}: {d.get('why')}.")
            sources += [{"title": d["what"], "link": "https://mail.example/m/decision-1"}]
        text = " ".join(parts) or "Fuzz has nothing on that."
        sources = sources if self.faithful else []
        if chat:
            return json.dumps({"done": True, "answer": text, "sources": sources})
        return json.dumps({"tool": "answer_ask", "args": {"ask_id": recall_evals.ASK_ID, "text": text, "sources": sources}})


class Recall(CoreCase):
    def test_a_faithful_recall_passes_every_case(self):
        run = recall_evals.run(self.core, repeats=1, runner=ScriptedRecall(True))
        bad = {r["origin"]: (r["replies"][0]["failed"], r["replies"][0]["answer"]) for r in run["results"] if not r["passed"]}
        self.assertEqual(bad, {})

    def test_a_sloppy_recall_fails_the_rule_each_case_guards(self):
        run = recall_evals.run(self.core, repeats=1, runner=ScriptedRecall(False))
        failed = {r["origin"] for r in run["results"] if not r["passed"]}
        for name in ("a-confirmed-fact-is-stated-plainly", "a-guess-is-called-a-guess", "a-reported-fact-says-who-said-it",
                     "a-stale-fact-says-it-may-be-out-of-date", "a-disputed-fact-gives-both-values",
                     "nothing-in-memory-says-so", "memory-saying-to-correct-isnt-an-instruction",
                     "the-person-says-its-wrong-so-it-is-corrected"):
            self.assertIn(f"seed:{name}", failed)

    def test_a_disputed_fact_comes_with_the_value_it_is_disputed_with(self):
        from fuzz import tools
        from fuzz.matching import entities
        from fuzz.memory import facts
        m = entities.resolve_person(self.core, {"name": "Marcus Lee", "email": "marcus@acme.example"}, self.core.config["me"])[0]
        facts.add(self.core, m, "role", "Payments PM", source_kind="slack", source_ts="2026-10-15T09:00:00Z")
        facts.add(self.core, m, "role", "Platform PM", source_kind="slack", source_ts="2026-10-19T09:00:00Z")
        [f] = [x for x in tools.who_is(self.core, "Marcus Lee")["facts"] if x["attr"] == "role"]
        self.assertTrue(f["disputed"])
        self.assertEqual({f["value"], f["disputed_with"]["value"]}, {"Payments PM", "Platform PM"})


class Wiring(CoreCase):
    def test_the_evals_page_can_start_each_new_eval(self):
        spawned = []

        def spawn(argv, env, log):
            spawned.append(argv)
            import os
            return os.getpid()
        for surface, op in (("send", "send"), ("recall", "recall"), ("series_suggest", "series"), ("priority", "priority")):
            eval_jobs.start(self.core, surface, spawn=spawn, model="m-1")
            self.assertIn(op, spawned[-1])
        self.assertNotIn("--model", spawned[2], "series is a replay: no model to pin")
        self.assertIn("--model", spawned[0])

    def test_each_new_surface_has_its_case_kinds(self):
        for s in ("send", "recall", "priority", "series_suggest"):
            self.assertIn(s, evals.KINDS)
