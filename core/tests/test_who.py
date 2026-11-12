"""Who a first name means (matching/who.py): never a person from a first name alone; the message's context settles
it, or it waits on the name's holder and a "Which Nick?" card asks."""

from helpers import CoreCase

from fuzz import actions, answers, cards, events, tools
from fuzz.memory import mcards

RICCI = {"name": "Nick Ricci", "email": "nick.ricci@acme.example"}
MORENO = {"name": "Nick Moreno", "email": "nick.moreno@acme.example"}
AMAR = {"name": "Amar Patel", "email": "amar@acme.example"}
SANJAY = {"name": "Sanjay Rao", "email": "sanjay@acme.example"}


def msg(sid, ts="2026-10-20T08:00:00Z", source="email", **kw):
    s = {"source": source, "source_id": sid, "version": "1", "ts": ts, "candidates": []}
    s.update(kw)
    return s


class Who(CoreCase):
    def submit(self, *msgs):
        tools.submit_signals(self.core, list(msgs))

    def person_of(self, key):
        """Who the first name on a message went to: the entity its mention points at, by name."""
        rows = self.core.all("SELECT e.name, e.provisional FROM sightings s JOIN entities e ON e.id=s.entity_id "
                             "WHERE s.signal_key=? AND s.role='on' ORDER BY e.id", (key,))
        return [(r["name"], bool(r["provisional"])) for r in rows]

    def which_cards(self):
        mcards.raise_cards(self.core)
        return [c for c, _ in cards.queue(self.core) if c["kind"] == "entity_person"]

    def test_a_lone_match_with_no_history_is_asked_not_guessed(self):
        self.submit(msg("m1", **{"from": RICCI}))
        self.submit(msg("s1", source="slack", source_id="C1:1", anchor="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        self.assertEqual(self.person_of("slack:C1:1:1"), [("Nick", True)], "held, not Nick Ricci")
        [card] = self.which_cards()
        self.assertEqual(card["prompt"], "Is “Nick” Nick Ricci?")
        self.assertEqual(card["payload"]["name"], "Nick")

    def test_on_the_same_thread_it_is_them(self):
        self.submit(msg("m1", anchor="t1", **{"from": RICCI}, people=[AMAR]))
        self.submit(msg("m2", anchor="t1", ts="2026-10-20T09:00:00Z", **{"from": AMAR}, people=[{"name": "Nick"}]))
        self.assertEqual(self.person_of("email:m2:1"), [("Nick Ricci", False)])

    def test_the_people_they_are_usually_with_settle_it(self):
        for i in range(3):   # Nick Ricci and Sanjay keep turning up together on small threads
            self.submit(msg(f"h{i}", anchor=f"t{i}", **{"from": RICCI}, people=[SANJAY]))
        self.submit(msg("m9", anchor="new", ts="2026-10-21T08:00:00Z", **{"from": AMAR}, people=[SANJAY, {"name": "Nick"}]))
        self.assertEqual(sorted(n for n, _ in self.person_of("email:m9:1")), ["Nick Ricci", "Sanjay Rao"])

    def test_a_big_announcement_says_nothing(self):
        crowd = [{"name": f"Person {i}", "email": f"p{i}@acme.example"} for i in range(20)]
        for i in range(3):
            self.submit(msg(f"h{i}", anchor=f"t{i}", **{"from": RICCI}, people=[SANJAY] + crowd))
        self.submit(msg("m9", anchor="new", **{"from": AMAR}, people=[SANJAY, {"name": "Nick"}]))
        self.assertIn(("Nick", True), self.person_of("email:m9:1"))

    def test_two_nicks_and_one_holder(self):
        self.submit(msg("m1", **{"from": RICCI}), msg("m2", **{"from": MORENO}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]),
                    msg("s2", source="slack", source_id="C2:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        self.assertEqual(self.core.one("SELECT COUNT(*) n FROM entities WHERE name='Nick'")["n"], 1,
                         "every unsettled Nick waits in one place")
        [card] = self.which_cards()
        self.assertEqual(card["prompt"], "Which Nick is this?")
        self.assertEqual(len(card["payload"]["candidates"]), 2)

    def test_picking_one_merges_into_that_one_and_undo_splits(self):
        self.submit(msg("m1", **{"from": RICCI}), msg("m2", **{"from": MORENO}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        [card] = self.which_cards()
        holder, pick = card["payload"]["entity_b"], card["payload"]["candidates"][1]
        answers.answer(self.core, card["id"], "same", pick)
        self.assertEqual(self.core.one("SELECT redirect_to FROM entities WHERE id=?", (holder,))["redirect_to"], pick)
        actions.undo(self.core)
        self.assertIsNone(self.core.one("SELECT redirect_to FROM entities WHERE id=?", (holder,))["redirect_to"])
        self.assertEqual(events.check_replay(self.core), [])

    def test_naming_someone_else_makes_them_a_person_the_next_nick_can_be(self):
        self.submit(msg("m1", **{"from": RICCI}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        [card] = self.which_cards()
        holder = card["payload"]["entity_b"]
        answers.answer(self.core, card["id"], "different", "Nick Garza")
        self.assertEqual(self.core.one("SELECT name FROM entities WHERE id=?", (holder,))["name"], "Nick Garza")
        self.clock.advance(days=1)
        self.submit(msg("s2", source="slack", source_id="C2:1", ts="2026-10-22T08:00:00Z", **{"from": AMAR},
                        people=[{"name": "Nick"}]))
        [card2] = self.which_cards()
        self.assertEqual(set(card2["payload"]["candidates"]), {holder, self.core.one(
            "SELECT entity_id FROM identifiers WHERE value='nick.ricci@acme.example'")["entity_id"]})

    def test_undo_takes_the_name_back(self):
        self.submit(msg("m1", **{"from": RICCI}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        [card] = self.which_cards()
        holder = card["payload"]["entity_b"]
        answers.answer(self.core, card["id"], "different", "Nick Garza")
        actions.undo(self.core)
        self.assertEqual(self.core.one("SELECT name FROM entities WHERE id=?", (holder,))["name"], "Nick")
        self.assertIsNone(self.core.one("SELECT 1 FROM aliases WHERE entity_id=? AND alias='nick garza'", (holder,)))
        self.assertEqual(self.core.all("SELECT * FROM entity_links"), [])

    def test_a_first_name_alone_is_refused_as_their_name(self):
        self.submit(msg("m1", **{"from": RICCI}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        [card] = self.which_cards()
        with self.assertRaises(Exception):
            answers.answer(self.core, card["id"], "different", "Garza")

    def test_a_signature_is_what_they_go_by(self):
        self.submit(msg("m1", **{"from": dict(name="Robert Lane", email="rob@acme.example", signed_as="Rob")}))
        rob = self.core.one("SELECT entity_id FROM identifiers WHERE value='rob@acme.example'")["entity_id"]
        self.submit(msg("m2", anchor="x", **{"from": dict(name="Robert Lane", email="rob@acme.example")},
                        people=[{"name": "Rob"}]))
        self.assertEqual([n for n, _ in self.person_of("email:m2:1")], ["Robert Lane"])
        self.assertIsNotNone(self.core.one("SELECT 1 FROM aliases WHERE entity_id=? AND alias='rob'", (rob,)))

    def test_settling_the_old_ones(self):
        from fuzz.matching import entities, who
        me = self.core.config["me"]
        for i in range(3):
            self.submit(msg(f"h{i}", anchor=f"t{i}", **{"from": RICCI}, people=[SANJAY]))
        # made the old way: a name-only "Nick", twice over, on a message with Sanjay
        a = entities._new_entity(self.core, "person", "Nick", True)
        b = entities._new_entity(self.core, "person", "Nick", True)
        self.submit(msg("m9", anchor="new", **{"from": AMAR}, people=[SANJAY]))
        self.core.q("INSERT INTO sightings VALUES (?,?,?,?,?)", (self.core.user_id, b, "email:m9:1", "on", None))
        plan = who.settle(self.core)
        self.assertEqual([(p["from"], p["to"]) for p in plan], [(b, "Nick"), (a, "Nick Ricci")])
        self.assertIsNone(self.core.one("SELECT redirect_to FROM entities WHERE id=?", (a,))["redirect_to"], "a plan only")
        who.settle(self.core, apply=True)
        ricci = entities.lookup_person(self.core, RICCI)
        self.assertEqual([entities._follow(self.core, x) for x in (a, b)], [ricci, ricci])
        actions.undo(self.core)
        self.assertIsNone(self.core.one("SELECT redirect_to FROM entities WHERE id=?", (a,))["redirect_to"])
        self.assertEqual(events.check_replay(self.core), [])

    def test_a_card_from_before_asks_the_new_way(self):
        self.submit(msg("m1", **{"from": RICCI}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        [card] = self.which_cards()
        ricci, holder = card["payload"]["entity_a"], card["payload"]["entity_b"]
        old = {"key": card["payload"]["key"], "entity_a": ricci, "entity_b": holder, "profiles": []}
        self.core.q("UPDATE cards SET payload=? WHERE id=?", (__import__("json").dumps(old), card["id"]))
        view = cards.view(self.core, cards.get(self.core, card["id"]))
        self.assertEqual((view["payload"]["candidates"], view["payload"]["name"]), ([ricci], "Nick"))
        self.assertEqual([p["name"] for p in view["payload"]["profiles"]], ["Nick", "Nick Ricci"])
        answers.answer(self.core, card["id"], "different", "Nick Garza")
        self.assertEqual(self.core.one("SELECT name FROM entities WHERE id=?", (holder,))["name"], "Nick Garza")
        actions.undo(self.core)
        self.assertEqual(self.core.one("SELECT name FROM entities WHERE id=?", (holder,))["name"], "Nick")

    def test_not_sure_records_nothing(self):
        self.submit(msg("m1", **{"from": RICCI}), msg("m2", **{"from": MORENO}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        [card] = self.which_cards()
        answers.answer(self.core, card["id"], "not_sure")   # postponed, like any card
        self.assertEqual(self.core.all("SELECT * FROM entity_links"), [], "nobody said they're different")
        self.assertEqual(cards.get(self.core, card["id"])["postponed"], 1)

    def test_a_notification_sender_is_never_offered(self):
        bot = "wiki@acme.example"
        self.submit(msg("w1", **{"from": {"name": "Adobe Wiki", "email": bot}}),
                    msg("w2", **{"from": {"name": "Nick Ricci via Adobe Wiki", "email": bot}}))
        self.submit(msg("m1", **{"from": RICCI}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        [card] = self.which_cards()
        self.assertEqual(card["prompt"], "Is “Nick” Nick Ricci?")

    def test_no_lean_without_a_link(self):
        self.submit(msg("m1", **{"from": RICCI}))
        self.submit(msg("s1", source="slack", source_id="C1:1", **{"from": AMAR}, people=[{"name": "Nick"}]))
        [card] = self.which_cards()
        self.assertIsNone(cards.view(self.core, cards.get(self.core, card["id"]))["suggested"])
