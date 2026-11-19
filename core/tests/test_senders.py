"""Who a sender is (senders.py) and its eval: a person, a bot, a list or a brand, with no model."""

import json
import tempfile

from helpers import CoreCase

from fuzz import evals, senders

ORGS = ("acme.example",)


def kind(sender, seen=None):
    return senders.classify(sender, seen, ORGS)[0]


class Classify(CoreCase):
    def test_every_global_case(self):
        rows, _ = senders.score(senders.global_cases(), ORGS)
        self.assertEqual([(r["key"], r["kind"], r["got"]) for r in rows if not r["passed"]], [])

    def test_the_global_set_covers_every_kind(self):
        got = {c["kind"] for c in senders.global_cases()}
        self.assertEqual(got, set(senders.KINDS))

    def test_when_nothing_decides_it_is_a_person(self):
        self.assertEqual(kind({"name": "Quinn Abara", "email": "qa7@vendor.example"}), "human")

    def test_unknown_is_not_not_found(self):
        s = {"name": "Wen Zhao", "email": "wzhao@acme.example"}
        self.assertEqual(kind(s, {"directory": None}), "human")
        self.assertEqual(kind({"name": "Payroll Desk", "email": "pay@acme.example"}, {"directory": False}), "brand")

    def test_the_directory_beats_an_odd_address(self):
        self.assertEqual(kind({"name": "Jun Park", "email": "all40211@acme.example"}, {"directory": True}), "human")

    def test_a_relay_is_the_names_it_carries_not_a_brands_campaigns(self):
        relay = {"name": "Ana Ruiz", "email": "share@acme.example"}
        self.assertEqual(kind(relay, {"names": ["Joe Bassett", "Lee Kwan"]}), "bot")
        self.assertEqual(kind(relay, {"names": ["Joe Bassett"]}), "human", "one other name isn't a relay")
        brand = {"name": "Skillhouse", "email": "news@email.skillhouse.example"}
        self.assertEqual(kind(brand, {"names": ["Skillhouse Certificates", "Skillhouse Executive"]}), "brand")

    def test_camel_case_is_an_app_only_without_an_address(self):
        self.assertEqual(kind({"name": "opsAgent"}), "bot")
        self.assertEqual(kind({"name": "tryNimbus", "email": "hello@trynimbus.example"}), "brand")


class Run(CoreCase):
    def test_a_run_is_recorded_and_gated(self):
        r = senders.run(self.core, sets="global")
        self.assertEqual(r["surface"], "senders")
        self.assertTrue(r["gate_ok"])
        out = senders.summary(self.core, r)
        self.assertEqual(out["wrong"], [])
        self.assertEqual(out["people_hidden"], {"global": 0})
        self.assertEqual(sum(sum(v.values()) for v in out["confusion"]["global"].values()), len(senders.global_cases()))

    def test_a_case_that_breaks_fails_the_gate(self):
        senders.run(self.core, sets="global")
        data = json.loads(senders.SEEDS.read_text())
        bad = [c for c in data["cases"] if c["name"] == "github-actions"][0]
        bad["sender"]["name"] = "Pat Doyle"     # same case, same label: the classifier now gets it wrong
        bad["sender"]["email"] = "pdoyle@acme.example"
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(data, f)
        r = senders.run(self.core, sets="global", path=f.name)
        # its input changed, so it's a new case, not a break: the gate holds
        self.assertTrue(r["gate_ok"])
        self.assertIn({"case": "seed:github-actions", "should_be": "bot", "got": "human",
                       "because": "the name matches the address"}, senders.summary(self.core, r)["wrong"])

    def test_personal_is_refused_until_there_are_labels(self):
        with self.assertRaises(Exception):
            senders.run(self.core, sets="personal")

    def test_it_shows_in_the_run_list(self):
        senders.run(self.core, sets="global")
        self.assertIn("senders", evals.run_list(self.core)["latest"])
