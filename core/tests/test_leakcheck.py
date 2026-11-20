"""The repo leak check: commits, tests and PR bodies hold nothing from your store (fuzz/leakcheck.py).

Every name here is invented. An address that has to look real is put together at run time, so this file passes
the check it tests."""

import io
import json
import os
import subprocess
import sys
import tempfile
from contextlib import redirect_stderr
from unittest import mock

from helpers import CoreCase

from fuzz import config, leakcheck

REAL_DOMAIN = "quillford" + ".com"           # stands in for an employer's domain
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class Leakcheck(CoreCase):
    def setUp(self):
        super().setUp()
        cfg = config.load(self.home)
        cfg["me"]["names"] = ["Tamsin Okafor-Reyes"]
        config.save(self.home, cfg)
        q = self.core.q
        q("INSERT INTO entities (user_id, type, name) VALUES (1, 'person', 'Marisol Vantongeren')")
        eid = self.core.one("SELECT id FROM entities WHERE name='Marisol Vantongeren'")["id"]
        q("INSERT INTO identifiers VALUES (1, 'email', ?, ?)", (f"marisol@{REAL_DOMAIN}", eid))
        for typ, name in (("person", "Knowledge Center"), ("person", "Change Management"), ("person", "The Wrap"),
                          ("person", "Odile Green"), ("org", "Brackwater Holdings"), ("term", "ZQX7"),
                          ("term", "MCP"), ("term", "1:1"), ("org", "github.com")):
            q("INSERT INTO entities (user_id, type, name) VALUES (1, ?, ?)", (typ, name))

    def found(self, text):
        terms, _ = leakcheck.load_terms(self.home)
        return " | ".join(what for _, what in leakcheck.scan([("x", text)], terms))

    def test_names_addresses_domains_codes_and_you_are_caught(self):
        got = self.found(f"Ping Marisol Vantongeren (marisol@{REAL_DOMAIN}) about ZQX7 at Brackwater Holdings; "
                         f"cc Tamsin Okafor-Reyes, see {REAL_DOMAIN}/wiki")
        for what in ("marisol vantongeren", REAL_DOMAIN, "zqx7", "an org from your store: brackwater holdings",
                     "a you from your store: tamsin okafor-reyes"):
            self.assertIn(what, got)
        self.assertIn("a surname from your store: vantongeren", self.found("as Ms Vantongeren said"))

    def test_a_full_name_is_caught_even_when_its_surname_is_an_everyday_word(self):
        self.assertIn("odile green", self.found("Ask Odile Green"))
        self.assertEqual(self.found("the green button"), "")

    def test_everyday_words_public_domains_and_codebase_terms_are_not(self):
        text = ("The knowledge center wraps change management; the wrap is in place. MCP 1:1 on github.com, "
                "from noreply@github.com and dana@acme.example.")
        self.assertEqual(self.found(text), "")

    def test_any_real_looking_address_is_caught_without_a_store(self):
        empty = tempfile.mkdtemp()
        terms, note = leakcheck.load_terms(empty)
        self.assertIn("no store", note)
        addr = "sam@" + "northbeam.io"
        got = leakcheck.scan([("x", f"write to {addr} or sam@acme.example")], terms)
        self.assertEqual([w for _, w in got], [f"an address off the example domains: {addr}"])

    def test_your_private_terms_and_allow_list_live_in_the_store_folder(self):
        with open(os.path.join(self.home, leakcheck.TERMS_FILE), "w") as f:
            f.write("# my employer\nHollowpine\n")
        self.assertIn("hollowpine", self.found("Hollowpine's offsite"))
        with open(os.path.join(self.home, leakcheck.ALLOW_FILE), "w") as f:
            f.write("Vantongeren\nMarisol Vantongeren\n")
        self.assertEqual(self.found("Marisol Vantongeren"), "")

    def test_the_store_is_opened_read_only(self):
        db = os.path.join(self.home, "fuzz.db")
        before = os.path.getmtime(db), os.path.getsize(db)
        store = leakcheck.ReadOnlyStore(self.home)
        with self.assertRaises(Exception):
            store.conn.execute("INSERT INTO entities (user_id, type, name) VALUES (1, 'person', 'X Y')")
        store.close()
        leakcheck.load_terms(self.home)
        self.assertEqual((os.path.getmtime(db), os.path.getsize(db)), before)


class WhatsScanned(CoreCase):
    def test_only_the_lines_a_diff_adds_with_their_line_numbers(self):
        diff = ("diff --git a/t.py b/t.py\n--- a/t.py\n+++ b/t.py\n@@ -1,2 +1,3 @@\n keep\n-gone Marisol\n"
                "+new one\n+another\n diff --git a/x.png b/x.png\n+++ b/x.png\n@@ -0,0 +1 @@\n+binary\n"
                "--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed\n")
        self.assertEqual(leakcheck.added_lines(diff), [("t.py:2", "new one"), ("t.py:3", "another")])

    def test_a_commit_message_without_gits_comments_or_verbose_diff(self):
        msg = "Fix it\n\nBody\n# Please enter the commit message\n# ------------------------ >8 ------------------------\n+diff"
        self.assertEqual(leakcheck.message_lines(msg), [("commit message:1", "Fix it"), ("commit message:3", "Body")])

    def test_the_claude_hook_checks_gh_publishing_only(self):
        self.assertEqual(leakcheck.claude_hook({"tool_input": {"command": "git status"}}), [])
        body = os.path.join(self.home, "body.md")
        with open(body, "w") as f:
            f.write("Fixes the dupes for Marisol\n")
        cmd = f'gh pr create --title "Dedupe" --body-file {body}'
        items = leakcheck.claude_hook({"tool_input": {"command": cmd}, "cwd": self.home})
        self.assertIn("Fixes the dupes for Marisol", [t for _, t in items])
        self.assertTrue(leakcheck.claude_hook({"tool_input": {"command": "gh issue comment 3 --body hi"}}))

    def test_the_claude_hook_exits_2_with_the_reason(self):
        self.core.q("INSERT INTO entities (user_id, type, name) VALUES (1, 'person', 'Marisol Vantongeren')")
        payload = json.dumps({"tool_input": {"command": 'gh pr edit 4 --body "thanks Marisol Vantongeren"'}})
        err = io.StringIO()
        with mock.patch.object(sys, "stdin", io.StringIO(payload)), redirect_stderr(err):
            self.assertEqual(leakcheck.main(["--claude-hook", "--home", self.home]), 2)
        self.assertIn("marisol vantongeren", err.getvalue())
        with mock.patch.object(sys, "stdin", io.StringIO(json.dumps({"tool_input": {"command": "ls"}}))):
            self.assertEqual(leakcheck.main(["--claude-hook", "--home", self.home]), 0)


class GitHooks(CoreCase):
    """The hooks themselves, in a scratch repo, against a scratch store."""

    def setUp(self):
        super().setUp()
        self.core.q("INSERT INTO entities (user_id, type, name) VALUES (1, 'person', 'Marisol Vantongeren')")
        self.repo = tempfile.mkdtemp()
        self.env = dict(os.environ, FUZZ_HOME=self.home, GIT_AUTHOR_NAME="T", GIT_AUTHOR_EMAIL="t@example.com",
                        GIT_COMMITTER_NAME="T", GIT_COMMITTER_EMAIL="t@example.com")
        self.git("init", "-q")
        self.git("config", "core.hooksPath", os.path.join(ROOT, ".githooks"))

    def git(self, *args, check=True):
        return subprocess.run(["git", *args], cwd=self.repo, env=self.env, capture_output=True, text=True,
                              check=check)

    def commit(self, text, msg="Add notes"):
        with open(os.path.join(self.repo, "notes.txt"), "a") as f:
            f.write(text + "\n")
        self.git("add", "notes.txt")
        return self.git("commit", "-q", "-m", msg, check=False)

    def test_pre_commit_blocks_a_name_from_the_store(self):
        r = self.commit("ask Marisol Vantongeren")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("marisol vantongeren", r.stderr)

    def test_commit_msg_blocks_a_name_in_the_message(self):
        r = self.commit("an invented line", msg="Fix the dupes Marisol Vantongeren saw")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("commit message", r.stderr)

    def test_a_clean_commit_goes_through(self):
        self.assertEqual(self.commit("ask Priya on the team").returncode, 0, self.commit("x").stderr)

    def test_pre_push_checks_commits_made_with_no_verify(self):
        self.git("init", "-q", "--bare", "remote.git")
        remote = os.path.join(self.repo, "remote.git")
        self.git("remote", "add", "origin", remote)
        self.assertEqual(self.commit("clean").returncode, 0)
        with open(os.path.join(self.repo, "notes.txt"), "a") as f:
            f.write("Marisol Vantongeren\n")
        self.git("add", "notes.txt")
        self.git("commit", "-q", "--no-verify", "-m", "sneaky")
        r = self.git("push", "-q", "origin", "HEAD:refs/heads/main", check=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("marisol vantongeren", r.stderr)
