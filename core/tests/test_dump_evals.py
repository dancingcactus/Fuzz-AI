"""The dump eval (docs/evals.md, "Dump"): a good splitter passes every case, a sloppy one fails what each guards."""

import json
import os
import pathlib
import re

from helpers import CoreCase

from fuzz import dump, dump_evals, eval_jobs, evals


class ScriptedSplitter:
    """A stand-in model that plays the splitter through its tools. Good: keeps what's said, merges the steps of one
    thing, and speaks calmly. Sloppy: a card for every line, whatever it says, and a shouting count."""

    def __init__(self, good=True):
        self.good = good

    def __call__(self, model, prompt):
        did = int(re.search(r"dump_id is (\d+)", prompt).group(1))
        seen = prompt.split("Your calls so far")[1]
        if "get_dump" not in seen:
            return json.dumps({"tool": "get_dump", "args": {"dump_id": did}})
        got = json.loads(re.search(r"get_dump.*?\n   -> (\{.*\})", seen, re.S).group(1).split("\n")[0])
        lines = [x.strip() for x in got["text"].splitlines() if x.strip()]
        if got.get("instruction"):   # change what was asked, keep the rest
            items = got["previous"]
            for i in items:
                if "dentist" in i["text"].lower() and "note" in got["instruction"].lower():
                    i["group"] = "note"
            return self.submit(did, items, "Changed.")
        if not self.good:
            return self.submit(did, [{"group": "task", "text": x} for x in lines], "You should do all 19 of these!")
        items, seen_keys, merged = [], {}, []
        for x in lines:
            group = ("done" if re.search(r"already|not mine", x, re.I) else
                     "later" if re.search(r"someday|when things calm|when it gets warm", x, re.I) else
                     "note" if re.search(r"worr|feel|seems|prefers|jams|think|remember|tired|behind", x, re.I) else "task")
            items.append({"group": group, "text": x})
        for i in items:   # the lines about one thing are one card
            key = next((w for w in ("offsite", "budget", "lease", "trip") if w in i["text"].lower()), None)
            if key and i["group"] == "task":
                if key in seen_keys:
                    seen_keys[key]["text"] += "; " + i["text"]
                    continue
                seen_keys[key] = i
            merged.append(i)
        return self.submit(did, merged, "I've got all of it.")

    @staticmethod
    def submit(did, items, say):
        return json.dumps({"tool": "submit_split", "args": {"dump_id": did, "items": items, "say": say}})


class DumpEvals(CoreCase):
    def test_a_good_splitter_passes_every_case(self):
        run = dump_evals.run(self.core, repeats=1, runner=ScriptedSplitter(True))
        bad = {r["origin"]: r["replies"][0]["failed"] for r in run["results"] if not r["passed"]}
        self.assertEqual(bad, {})
        self.assertGreaterEqual(len(run["results"]), 8)

    def test_a_sloppy_splitter_fails_what_each_case_guards(self):
        run = dump_evals.run(self.core, repeats=1, runner=ScriptedSplitter(False))
        failed = {r["origin"].replace("seed:", "") for r in run["results"] if not r["passed"]}
        for name in ("a-messy-dump-gives-few-tasks", "a-dump-of-worry-may-make-no-tasks", "a-thing-already-done-is-done",
                     "someday-things-go-to-later", "a-small-dump-stays-small"):
            self.assertIn(name, failed)

    def test_a_split_that_never_comes_fails_every_check_on_it(self):
        rec = [{"tool": "get_dump", "args": {}, "result": {}}]
        self.assertTrue(all(not ok for _, ok in dump_evals.check(rec, [{"cards_between": [0, 3]}, {"mentions": ["x"]}, {"calm": True}])))

    def test_calm_is_no_count_no_shout_no_should(self):
        for say, ok in (("I've got all of it.", True), ("That's 12 things!", False), ("You should start with the budget", False),
                        ("It's overdue", False)):
            rec = [{"tool": "split", "args": {"items": [], "say": say}, "result": {}}]
            self.assertEqual(dump_evals.check(rec, [{"calm": True}])[0][1], ok, say)

    def test_the_seeds_are_invented(self):
        text = (pathlib.Path(dump.__file__).parent / "eval_seeds" / "dump.json").read_text()
        self.assertNotRegex(text, r"@(?!acme\.example)[\w.-]+\.\w+")
        self.assertNotIn("http", text)

    def test_the_eval_is_on_the_evals_page_and_the_cli(self):
        self.assertEqual(evals.KINDS["dump"], ("behaviour",))
        spawned = []

        def spawn(argv, env, log):
            spawned.append(argv)
            return os.getpid()
        eval_jobs.start(self.core, "dump", spawn=spawn, model="m-1")
        self.assertIn("dump", spawned[0])
        self.assertIn("--model", spawned[0])
