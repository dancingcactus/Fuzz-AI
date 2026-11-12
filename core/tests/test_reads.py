"""GET /cards asks the same things for every card; one request answers each once (core.reading)."""

import json

from fuzz import booking, cards, events, tasks
from helpers import CoreCase


class Reads(CoreCase):
    def statements(self, n):
        while len(cards.queue(self.core)) < n:
            tasks.capture(self.core, f"Task {len(cards.queue(self.core))}")
        seen = []
        self.core.conn.set_trace_callback(seen.append)
        try:
            with self.core.reading():
                [cards.view(self.core, c, t) for c, t in cards.queue(self.core)]
        finally:
            self.core.conn.set_trace_callback(None)
        return len(seen)

    def test_the_queue_takes_as_many_queries_for_thirty_cards_as_for_three(self):
        few = self.statements(3)   # first: the queue only grows
        self.assertEqual(len(cards.queue(self.core)), 3)
        self.assertEqual(self.statements(30), few)

    def report(self, slots):
        with self.core.tx("fuzz:executor"):
            ch = events.Changes()
            ch.state("calendar", json.dumps({"slots": slots, "holds": [], "at": self.core.now_iso()}))
            events.emit(self.core, "calendar.reported", changes=ch)

    def test_a_write_inside_a_request_is_seen_after_it(self):
        self.report([])
        with self.core.reading():
            self.assertEqual(booking.calendar(self.core)["slots"], [])
            self.report([{"start": "2026-10-21T09:00:00Z", "end": "2026-10-21T10:00:00Z"}])
            self.assertEqual(len(booking.calendar(self.core)["slots"]), 1)

    def test_outside_a_request_nothing_is_kept(self):
        self.report([])
        calls = []
        self.assertEqual(self.core.memo("k", lambda: calls.append(1) or len(calls)), 1)
        self.assertEqual(self.core.memo("k", lambda: calls.append(1) or len(calls)), 2)

    def test_callers_get_their_own_calendar(self):
        self.report([])
        with self.core.reading():
            booking.calendar(self.core)["slots"].append("changed")
            self.assertEqual(booking.calendar(self.core)["slots"], [])
