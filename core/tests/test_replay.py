"""The duplicate matcher's replay eval and the thresholds learner (docs/evals.md, "Duplicate matching")."""

import json

from helpers import CoreCase

from fuzz import evals, learning, tasks
from fuzz.matching import dupes, matcher, replay


def sweep_meta(labels, rows, fam="hash"):
    return {"families": {"personal": fam}, "labels": labels, "thresholds": {}, "sweep": {"personal": rows}}


def row(v, p, r, current=False):
    f1 = 2 * p * r / (p + r) if p and r else 0
    return {"dup_sem": v, "precision": p, "recall": r, "f1": round(f1, 3), "current": current}


class Replay(CoreCase):
    def feedback(self, kind, a, b):
        self.core.q("INSERT INTO feedback (user_id, ts, kind, a, b) VALUES (1, ?, ?, ?, ?)",
                    (self.core.now_iso(), kind, a, b))

    def test_the_newest_answer_on_a_pair_wins(self):
        self.feedback("merge", 1, 2)
        self.feedback("split", 2, 1)   # the merge was wrong
        self.feedback("keep", 3, 4)
        got = {(x["a"], x["b"]): x["same"] for x in replay.labels(self.core)}
        self.assertEqual(got, {(2, 1): False, (3, 4): False})

    def test_the_global_pairs_score_the_same_every_run(self):
        a = replay.run(self.core, sets="global")
        b = replay.run(self.core, sets="global")
        self.assertEqual(len(a["results"]), len(replay.global_pairs()))
        self.assertEqual([r["passed"] for r in a["results"]], [r["passed"] for r in b["results"]])
        self.assertEqual(evals.compare(a, b)["unchanged"], b["results"])
        same_ticket = next(r for r in a["results"] if r["key"] == "seed:same-ticket-two-channels")
        self.assertTrue(same_ticket["passed"], "a shared ticket key is a duplicate")

    def test_your_pairs_are_scored_on_a_copy_and_your_store_is_left_alone(self):
        a = tasks.capture(self.core, "Send Priya the Q3 vendor numbers")
        b = tasks.capture(self.core, "Send the Q3 vendor numbers to Priya")
        c = tasks.capture(self.core, "Book the offsite venue")
        matcher.merge(self.core, a, b)
        matcher.keep_separate(self.core, b, c)
        before = {t: self.core.one(f"SELECT COUNT(*) n FROM {t}")["n"]
                  for t in ("tasks", "sources", "candidates", "signals", "events", "merges")}
        run = replay.run(self.core, sets="personal")
        after = {t: self.core.one(f"SELECT COUNT(*) n FROM {t}")["n"] for t in before}
        self.assertEqual(before, after)
        got = {r["kind"]: r for r in run["results"]}
        self.assertEqual(set(got), {"same", "different"})
        self.assertTrue(got["same"]["passed"], "judged as the two tasks were before the merge moved anything")
        self.assertNotIn("names", got["same"]["features"], "what two tasks share by name stays in your store")

    def test_a_sweep_counts_precision_and_recall(self):
        pairs = [{"same": True, "features": {"link": [], "entity": 0, "semantic": s, "words": 0, "people_only": True}}
                 for s in (0.9, 0.8)] + \
                [{"same": False, "features": {"link": [], "entity": 0, "semantic": s, "words": 0, "people_only": True}}
                 for s in (0.78, 0.5)]
        th = dupes.thresholds_default("hash")
        rows = {r["dup_sem"]: r for r in replay.sweep(pairs, "hash", th)}
        self.assertEqual((rows[0.75]["precision"], rows[0.75]["recall"]), (0.667, 1.0))
        self.assertEqual((rows[0.8]["precision"], rows[0.8]["recall"]), (1.0, 1.0))
        self.assertEqual(replay.best(list(rows.values()))["dup_sem"], 0.8)


class Thresholds(CoreCase):
    def record(self, meta):
        self.core.q("INSERT INTO eval_runs (user_id, ts, surface, repeats, lessons, results, gate_ok, meta) "
                    "VALUES (1, ?, 'dupes', 1, '[]', '[]', 1, ?)", (self.core.now_iso(), json.dumps(meta)))

    def lessons(self):
        return self.core.all("SELECT * FROM lessons WHERE surface='dupes' AND status!='retired'")

    def test_too_few_labels_propose_nothing(self):
        self.record(sweep_meta(5, [row(0.75, 0.5, 1.0, True), row(0.9, 1.0, 1.0)]))
        learning.run(self.core)
        self.assertEqual(self.lessons(), [])

    def test_a_clearly_better_threshold_is_proposed_and_waits_for_your_yes(self):
        self.record(sweep_meta(30, [row(0.75, 0.5, 1.0, True), row(0.9, 1.0, 1.0)]))
        learning.run(self.core)
        [x] = self.lessons()
        self.assertEqual((x["status"], x["how"], x["kind"]), ("proposed", "inferred", "rule"))
        self.assertIn("less often", x["rule"])
        self.assertEqual(dupes.thresholds(self.core, "hash")["dup_sem"], dupes.DUP_SEM["hash"], "not until you say yes")
        learning.use(self.core, x["id"])
        self.assertEqual(dupes.thresholds(self.core, "hash")["dup_sem"], 0.9)
        # a later run that agrees with it keeps it
        self.record(sweep_meta(30, [row(0.9, 1.0, 1.0, True), row(0.75, 0.5, 1.0)]))
        learning.run(self.core)
        self.assertEqual(dupes.thresholds(self.core, "hash")["dup_sem"], 0.9)

    def test_a_small_gain_or_a_precision_drop_is_not_proposed(self):
        self.record(sweep_meta(30, [row(0.75, 0.8, 0.8, True), row(0.8, 0.82, 0.8)]))
        learning.run(self.core)
        self.assertEqual(self.lessons(), [])
        self.record(sweep_meta(30, [row(0.75, 0.9, 0.5, True), row(0.6, 0.7, 1.0)]))
        learning.run(self.core)
        self.assertEqual(self.lessons(), [], "it would ask far more often and be wrong more")

    def test_a_tuned_threshold_changes_what_gets_asked(self):
        f = {"link": [], "entity": 0, "semantic": 0.8, "words": 0, "people_only": True}
        self.assertTrue(dupes.is_close(f, "hash", dupes.thresholds(self.core, "hash")))
        self.record(sweep_meta(30, [row(0.75, 0.5, 1.0, True), row(0.9, 1.0, 1.0)]))
        learning.run(self.core)
        learning.use(self.core, self.lessons()[0]["id"])
        self.assertFalse(dupes.is_close(f, "hash", dupes.thresholds(self.core, "hash")))
