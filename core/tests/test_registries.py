"""The registries that replace parallel tables: card kinds (cards.CARD_KINDS) with their answers, and the
projected tables (events.TABLES). Each test fails when one side gains an entry the other lacks."""

import unittest

from fuzz import answers, cards, events, scheduler, tasks
from fuzz.db import FuzzError

from helpers import CoreCase


def offerable_task_options():
    """Every option a task card can show: the variants' lists, the ordinary list, and the extras."""
    out = set(cards.TASK_OPTIONS) | {"keep", "quick", "add_to_reply"}
    for _, opts in cards.TASK_VARIANTS:
        out |= set(opts)
    return out


class CardKinds(unittest.TestCase):
    def test_every_kind_has_a_handler_and_every_handler_a_kind(self):
        self.assertEqual(set(answers.HANDLERS), set(cards.CARD_KINDS))

    def test_every_task_option_has_an_answer(self):
        self.assertEqual(set(answers.TASK_ANSWERS), offerable_task_options())

    def test_a_safe_answer_only_on_a_kind_you_can_put_off(self):
        for name, k in cards.CARD_KINDS.items():
            if k.safe is not None:
                self.assertTrue(k.postpones, name)
                self.assertIn(k.safe, k.options, name)

    def test_the_suggested_answer_is_one_of_its_options(self):
        for name, k in cards.CARD_KINDS.items():
            if k.suggested and name != "task":
                self.assertIn(k.suggested, k.options, name)

    def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(FuzzError):
            cards.kind_spec("horoscope")


class Tables(CoreCase):
    def test_every_table_has_a_changes_helper(self):
        ch = events.Changes()
        for name in ("task", "group", "card", "draft", "grant", "deliverable", "fact", "knowledge", "lesson",
                     "decision", "mlink"):
            getattr(ch, name)(1, x=1)
        ch.state("k", 1)
        self.assertEqual(set(ch.to_json()), set(events.TABLES))

    def test_every_table_and_its_undo_fields_are_in_the_schema(self):
        for table, spec in events.TABLES.items():
            cols = {r["name"] for r in self.core.conn.execute(f"PRAGMA table_info({table})")}
            self.assertTrue(cols, f"{table} isn't in the schema")
            self.assertIn(spec.key, cols, table)
            self.assertLessEqual(set(spec.decisive) | set(spec.absent), cols, table)


class Schema(unittest.TestCase):
    def test_the_schema_alone_has_every_column_a_migration_adds(self):
        import sqlite3
        from fuzz import db
        conn = sqlite3.connect(":memory:")
        conn.executescript(db.SCHEMA)
        for table, cols in db.MIGRATIONS.items():
            have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
            self.assertFalse({n for n, _ in cols} - have, f"{table}: add these to SCHEMA, not only MIGRATIONS")


class TaskAnswers(CoreCase):
    def handed_back(self):
        tid = tasks.capture(self.core, "Pick the venue")
        tasks.assign(self.core, tid)
        scheduler.claim_next(self.core, tid)
        scheduler.hand_back(self.core, tid, "Which venue?", options=["The hall", "The park"])
        return tid, self.card_for(tid, "task")

    def test_a_quick_answer_goes_on_with_it(self):
        tid, card = self.handed_back()
        answers.answer(self.core, card["id"], "quick", "The park")
        self.assertEqual(self.task(tid)["state"], "queued")

    def test_text_that_isnt_a_quick_answer_is_refused_with_the_field(self):
        tid, card = self.handed_back()
        with self.assertRaises(FuzzError) as e:   # was an AttributeError (a str has no .get)
            answers.answer(self.core, card["id"], "quick", "The moon")
        self.assertEqual(e.exception.field, "value")

    def test_your_own_answer_needs_custom(self):
        tid, card = self.handed_back()
        answers.answer(self.core, card["id"], "quick", {"text": "The library", "custom": True})
        self.assertEqual(self.task(tid)["state"], "queued")
