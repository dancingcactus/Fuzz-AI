"""Labelling messages by hand for the personal evals (labels.py)."""

import json
import threading
import urllib.error
import urllib.request
from datetime import timedelta

from helpers import CoreCase

from fuzz import evals, http_api, labels
from fuzz.db import FuzzError


class Seed(CoreCase):
    def signal(self, key, owner=None, ask="Send the pricing sheet", days=1, source="email"):
        ts = (self.clock() - timedelta(days=days)).isoformat()
        p = {"source": source, "title": f"Thread {key}", "from": {"name": "Priya Shah", "email": "priya@acme.example"},
             "quote": "can you send it over?"}
        self.core.q("INSERT INTO signals (user_id, key, source, source_id, version, ts, quote, payload) "
                    "VALUES (1, ?, ?, ?, 'v1', ?, ?, ?)", (key, source, key, ts, p["quote"], json.dumps(p)))
        if owner:
            self.core.q("INSERT INTO candidates (user_id, signal_key, idx, kind, ask, owner, payload) "
                        "VALUES (1, ?, 0, 'ask', ?, ?, '{}')", (key, ask, owner))


class Labels(Seed):
    def test_the_queue_puts_what_extraction_was_unsure_of_first(self):
        self.signal("a", owner="me")
        self.signal("b")                      # no ask
        self.signal("c", owner="unclear")
        self.signal("d", owner="Sam Lee")
        self.assertEqual([x["key"] for x in labels.queue(self.core)], ["c", "d", "b", "a"])
        self.assertEqual([x["key"] for x in labels.queue(self.core, saw="none")], ["b"])

    def test_old_messages_and_ones_with_a_case_are_left_out(self):
        self.signal("old", days=45)
        self.signal("done")
        labels.label(self.core, "done", "nothing")
        self.assertEqual(labels.queue(self.core), [])

    def test_mine_is_a_keep_case_with_the_ask_in_your_words_or_extractions(self):
        self.signal("a", owner="me", ask="Send the pricing sheet")
        c = labels.label(self.core, "a", "mine")
        self.assertEqual((c["kind"], c["ask"], c["status"], c["by_hand"]),
                         ("keep", "Send the pricing sheet", "pending", True))
        self.signal("b")
        self.assertEqual(labels.label(self.core, "b", "mine", ask="  Call Priya  ")["ask"], "Call Priya")

    def test_others_isnt_strict_and_nothing_is(self):
        self.signal("a", owner="Sam Lee")
        self.signal("b")
        got = {}
        for k, which in (("a", "others"), ("b", "nothing")):
            cid = labels.label(self.core, k, which)["id"]
            got[which] = json.loads(self.core.one("SELECT expected FROM eval_cases WHERE id=?", (cid,))["expected"])
        self.assertEqual(got["others"], {"has_my_ask": False})
        self.assertEqual(got["nothing"], {"has_my_ask": False, "strict": True})

    def test_a_label_expires_and_waits_for_its_text_but_teaches_no_lesson(self):
        self.signal("a")
        cid = labels.label(self.core, "a", "mine")["id"]
        row = self.core.one("SELECT origin, status FROM eval_cases WHERE id=?", (cid,))
        self.assertTrue(row["origin"].startswith("label:"))      # the examples learner reads feedback: only
        self.assertEqual(row["status"], "pending")
        self.assertEqual([c["case_id"] for c in evals.to_fetch(self.core)], [cid])
        evals.submit_text(self.core, cid, text="Hi, could you send it over?")
        self.assertIsNotNone(self.core.one("SELECT expires_at FROM eval_cases WHERE id=?", (cid,))["expires_at"])

    def test_a_new_label_retires_the_old_and_makes_a_new_fingerprint(self):
        self.signal("a")
        first = labels.label(self.core, "a", "nothing")["id"]
        second = labels.label(self.core, "a", "mine")["id"]
        self.assertNotEqual(first, second)
        self.assertEqual(self.core.one("SELECT status FROM eval_cases WHERE id=?", (first,))["status"], "retired")
        self.assertEqual([c["id"] for c in labels.mine(self.core)], [second])

    def test_taking_a_label_back_retires_it_and_the_message_returns_to_the_queue(self):
        self.signal("a")
        cid = labels.label(self.core, "a", "nothing")["id"]
        labels.remove(self.core, cid)
        self.assertEqual(labels.mine(self.core), [])
        self.assertEqual([x["key"] for x in labels.queue(self.core)], ["a"])

    def test_bad_input(self):
        self.signal("a")
        for args in (("a", "maybe"), ("gone", "mine")):
            with self.assertRaises(FuzzError):
                labels.label(self.core, *args)


class LabelsApi(Seed):
    """Over HTTP: reads are GET, writes POST."""

    def setUp(self):
        super().setUp()
        self.srv = http_api.make_server(self.home, port=0, clock=self.clock, ticker=False)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.server_close)
        self.addCleanup(self.srv.shutdown)
        self.token = http_api.ensure_token(self.home, 1)

    def req(self, method, path, body=None):
        r = urllib.request.Request(f"http://127.0.0.1:{self.srv.server_address[1]}{path}", method=method,
                                   data=json.dumps(body).encode() if body is not None else None)
        r.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_label_list_and_take_back(self):
        self.signal("a", owner="unclear")
        code, got = self.req("GET", "/evals/labels?saw=unclear")
        self.assertEqual((code, [x["key"] for x in got["queue"]], got["cases"]), (200, ["a"], []))
        code, made = self.req("POST", "/evals/labels", {"signal_key": "a", "label": "others"})
        self.assertEqual((code, made["label"]), (201, "others"))
        self.assertEqual(self.req("GET", "/evals/labels")[1]["queue"], [])
        self.assertEqual(self.req("POST", f"/evals/labels/{made['id']}/remove", {})[1]["status"], "retired")
        self.assertEqual(self.req("POST", "/evals/labels", {"signal_key": "a", "label": "maybe"})[0], 400)
