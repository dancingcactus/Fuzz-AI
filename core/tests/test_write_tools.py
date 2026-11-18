"""Write tools: wiki pages created, edited and commented on, and Slack posts, only as drafts you approve.

You choose the tools in setup (send.tools). The executor may draft a wiki.* kind only when one of those
tools can apply it; the sender gets the page and makes exactly the approved change.
"""

import json
from unittest import mock

from helpers import CoreCase

from fuzz import adapters, answers, cards, connectors, events, people, scheduler, tasks, tools
from fuzz.db import FuzzError

SERVERS = [{"name": "wiki", "status": "enabled"}, {"name": "slack", "status": "enabled"}]
LISTED = [
    {"tool": "wiki-wiki_get_content", "server": "wiki", "does": "Reads a wiki page.", "kind": "lookup"},
    {"tool": "wiki-wiki_create_page", "server": "wiki", "does": "Creates a wiki page.", "kind": "change"},
    {"tool": "wiki-wiki_update_content", "server": "wiki", "does": "Updates wiki content.", "kind": "change"},
    {"tool": "wiki-wiki_add_comment", "server": "wiki", "does": "Adds a comment to a wiki page.", "kind": "send"},
    {"tool": "wiki-wiki_delete_page", "server": "wiki", "does": "Deletes a wiki page.", "kind": "change"},
    {"tool": "wiki-execute_mcp_tool", "server": "wiki", "does": "Runs another tool.", "kind": "change"},
    {"tool": "slack-slack_send_message", "server": "slack", "does": "Posts a message.", "kind": "change"},
    {"tool": "slack-jira_edit_comment", "server": "slack", "does": "Edits a Jira comment.", "kind": "change"},
]
PAGE = {"link": "https://wiki.example/pages/42", "version": "7", "change": "Adds the Q1 dates to Timeline"}


class WriteTools(CoreCase):
    def setUp(self):
        super().setUp()
        self.core.update_config(lambda cfg: cfg.setdefault("engine", {}).update(client="copilot"))

    def discover(self):
        with mock.patch.object(adapters.get("copilot"), "list_servers", return_value=SERVERS):
            return connectors.discover(self.core, "copilot", runner=lambda argv: json.dumps(LISTED))

    def tools_by_name(self):
        return {t["allow"]: t for t in connectors.view(self.core, "copilot")["tools"]}

    def claimed(self, text="Add the Q1 dates to the offsite wiki page"):
        tid = tasks.capture(self.core, text)
        tasks.assign(self.core, tid)
        t, why = scheduler.claim_next(self.core, tid)
        self.assertEqual((t or {}).get("id"), tid, why)
        return tid

    def allow(self, *names):
        connectors.choose(self.core, "copilot", send=list(names))


class Choosing(WriteTools):
    def test_change_tools_say_what_they_can_do_and_what_they_risk(self):
        self.discover()
        t = self.tools_by_name()
        self.assertEqual(t["wiki(wiki_create_page)"]["wiki"], "wiki.create")
        self.assertEqual(t["wiki(wiki_update_content)"]["wiki"], "wiki.update")
        self.assertEqual(t["wiki(wiki_add_comment)"]["wiki"], "wiki.comment")
        self.assertIsNone(t["wiki(wiki_get_content)"]["wiki"], "a lookup changes nothing")
        self.assertEqual(t["wiki(wiki_delete_page)"]["risk"], "deletes")
        self.assertIsNone(t["wiki(wiki_delete_page)"]["wiki"], "a deleter never applies a draft")
        self.assertEqual(t["wiki(execute_mcp_tool)"]["risk"], "runs")
        self.assertIsNone(t["wiki(wiki_create_page)"]["risk"])
        self.assertIsNone(t["slack(jira_edit_comment)"]["wiki"], "a Jira comment isn't a wiki one")

    def test_a_send_word_in_the_middle_still_sends(self):
        self.discover()
        self.assertEqual(self.tools_by_name()["slack(slack_send_message)"]["kind"], "send",
                         "the run said change, but slack_send_message posts a message")

    def test_the_executor_hears_only_the_wiki_kinds_it_can_get_out(self):
        self.discover()
        self.assertEqual(tools.whoami(self.core, "executor")["wiki_drafts"], [])
        self.allow("wiki(wiki_update_content)", "wiki(wiki_add_comment)")
        self.assertEqual(tools.whoami(self.core, "executor")["wiki_drafts"], ["wiki.comment", "wiki.update"])
        self.allow("wiki")
        self.assertEqual(tools.whoami(self.core, "executor")["wiki_drafts"],
                         ["wiki.comment", "wiki.create", "wiki.update"], "a whole server covers its tools")

    def test_an_undiscovered_tool_counts_by_its_name(self):
        self.allow("Notion(create_database)")
        self.assertEqual(tools.whoami(self.core, "executor")["wiki_drafts"], [])
        self.allow("Confluence(create_page)")
        self.assertEqual(tools.whoami(self.core, "executor")["wiki_drafts"], ["wiki.create"])


class Drafting(WriteTools):
    def setUp(self):
        super().setUp()
        self.discover()
        self.allow("wiki(wiki_create_page)", "wiki(wiki_update_content)", "wiki(wiki_add_comment)")

    def test_no_wiki_tool_no_wiki_draft(self):
        self.allow()
        tid = self.claimed()
        with self.assertRaises(FuzzError) as e:
            tools.save_draft(self.core, tid, "wiki.update", "Offsite plan", "Whole page", page=PAGE)
        self.assertEqual(e.exception.field, "kind")
        self.assertEqual(self.task(tid)["state"], "working", "refused before anything moved")

    def test_each_kind_needs_its_page(self):
        tid = self.claimed()
        for kind, page in (("wiki.create", {"title": "Q1 plan"}), ("wiki.update", {"link": PAGE["link"]}),
                           ("wiki.comment", None), ("wiki.update", dict(PAGE, colour="blue"))):
            with self.assertRaises(FuzzError, msg=f"{kind} {page}") as e:
                tools.save_draft(self.core, tid, kind, "Offsite plan", "Body", page=page)
            self.assertEqual(e.exception.field, "page")
        with self.assertRaises(FuzzError):
            tools.save_draft(self.core, tid, "slack.message", "#offsite", "Hi", page=PAGE)

    def test_an_edit_goes_out_with_its_page_once_approved(self):
        tid = self.claimed()
        tools.save_draft(self.core, tid, "wiki.update", "Offsite plan", "The whole page, with Q1 dates", page=PAGE)
        card = self.card_for(tid, "draft")
        self.assertEqual(cards.view(self.core, card)["draft"]["meta"]["page"], PAGE, "the card can show what changes")
        answers.answer(self.core, card["id"], "approve")
        self.assertEqual(self.task(tid)["state"], "sending")
        got = tools.claim_next_send(self.core)["send"]
        self.assertEqual((got["kind"], got["page"], got["body"]),
                         ("wiki.update", PAGE, "The whole page, with Q1 dates"))
        tools.mark_sent(self.core, tid, got["draft_id"], "Wiki, Offsite plan", PAGE["link"])
        self.assertEqual(self.task(tid)["state"], "done")
        self.assertEqual(events.task_log(self.core, tid)[0]["text"],
                         "Changed Offsite plan (Wiki, Offsite plan) after you approved it.")

    def test_a_new_page_is_logged_by_its_title(self):
        tid = self.claimed("Write up the offsite plan on the wiki")
        tools.save_draft(self.core, tid, "wiki.create", "Team space", "# Offsite plan",
                         page={"title": "Offsite plan", "parent": "Team space"})
        answers.answer(self.core, self.card_for(tid, "draft")["id"], "approve")
        got = tools.claim_next_send(self.core)["send"]
        self.assertEqual(got["page"], {"title": "Offsite plan", "parent": "Team space"})
        tools.mark_sent(self.core, tid, got["draft_id"], "Wiki, Team space")
        self.assertEqual(events.task_log(self.core, tid)[0]["text"],
                         "Created the page “Offsite plan” (Wiki, Team space) after you approved it.")

    def test_a_page_is_not_a_person(self):
        tid = self.claimed()
        tools.save_draft(self.core, tid, "wiki.comment", "Offsite plan", "Dates added.", page={"link": PAGE["link"]})
        answers.answer(self.core, self.card_for(tid, "draft")["id"], "approve")
        got = tools.claim_next_send(self.core)["send"]
        tools.mark_sent(self.core, tid, got["draft_id"], "Wiki comment")
        self.assertFalse([p for p in people.for_task(self.core, self.task(tid)) if p.get("name") == "Offsite plan"])
