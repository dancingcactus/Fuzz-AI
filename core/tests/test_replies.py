"""The JSON object in a model's reply, however it's wrapped."""

import unittest

import helpers  # noqa: F401  (puts the core on the path)

from fuzz import replies


class JsonObject(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(replies.json_object('{"a": 1}'), {"a": 1})

    def test_in_prose_and_a_fence(self):
        self.assertEqual(replies.json_object('Sure!\n```json\n{"a": {"b": [1, 2]}}\n```\nHope that helps.'),
                         {"a": {"b": [1, 2]}})

    def test_a_stray_brace_in_the_prose(self):
        """The greedy {.*} match took 'use {name} ... }' and failed; the object after it is found."""
        self.assertEqual(replies.json_object('I filled in {name}. {"tool": "save", "args": {}}'),
                         {"tool": "save", "args": {}})

    def test_two_objects_take_the_first_or_the_wanted_one(self):
        text = 'Thinking: {"plan": "x"} Answer: {"candidates": []}'
        self.assertEqual(replies.json_object(text), {"plan": "x"})
        self.assertEqual(replies.json_object(text, want=lambda o: "candidates" in o), {"candidates": []})

    def test_braces_inside_strings(self):
        self.assertEqual(replies.json_object('{"text": "a } and a {"}'), {"text": "a } and a {"})

    def test_none_when_there_is_none(self):
        for text in (None, "", "no json here", "{broken", "[1, 2]", '{"a": 1'):
            self.assertIsNone(replies.json_object(text), text)

    def test_objects_lists_each_top_level_one(self):
        self.assertEqual(list(replies.objects('{"a": {"b": 1}} x {"c": 2}')), [{"a": {"b": 1}}, {"c": 2}])


if __name__ == "__main__":
    unittest.main()
