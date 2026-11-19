"""A full name with no email or Slack ID (matching/entities.py): it goes to the one person known by that name. It
used to make a new name-only person whenever two already shared the name, so they piled up, one per mention."""

from helpers import CoreCase

from fuzz import actions, events, tools
from fuzz.matching import entities

SYDNEE = {"name": "Sydnee Ward", "email": "sydnee@acme.example"}
AMAR = {"name": "Amar Patel", "email": "amar@acme.example"}


def msg(sid, ts="2026-10-20T08:00:00Z", source="email", **kw):
    s = {"source": source, "source_id": sid, "version": "1", "ts": ts, "candidates": []}
    s.update(kw)
    return s


class FullNames(CoreCase):
    def submit(self, *msgs):
        tools.submit_signals(self.core, list(msgs))

    def sydnees(self):
        return [r["id"] for r in self.core.all("SELECT id FROM entities WHERE type='person' AND redirect_to IS NULL "
                                               "AND name='Sydnee Ward' ORDER BY id")]

    def seeded(self):
        """How it began in the live store: a name-only Sydnee first, then the real one by a bare address, named
        later. Two now hold the name."""
        self.submit(msg("m1", **{"from": AMAR}, people=[{"name": "Sydnee Ward"}]))
        self.submit(msg("m2", **{"from": {"email": SYDNEE["email"]}}))
        self.submit(msg("m3", **{"from": SYDNEE}))
        held, real = self.sydnees()
        self.assertEqual(entities.lookup_person(self.core, {"email": SYDNEE["email"]}), real)
        return held, real

    def test_the_name_goes_to_the_one_known_by_it(self):
        held, real = self.seeded()
        for i in range(4):
            self.submit(msg(f"n{i}", **{"from": AMAR}, people=[{"name": "Sydnee Ward"}]))
        self.assertEqual(self.sydnees(), [held, real], "no new Sydnee per mention")
        mentioned = {r["entity_id"] for r in self.core.all(
            "SELECT DISTINCT m.entity_id FROM mentions m JOIN candidates c ON c.id=m.candidate_id "
            "WHERE c.signal_key LIKE 'email:n%'")}
        self.assertEqual(mentioned & {held, real}, {real})
        self.assertEqual({r["entity_id"] for r in self.core.all(
            "SELECT entity_id FROM sightings WHERE signal_key LIKE 'email:n%' AND role='on'")} & {held, real}, {real})

    def test_two_real_ones_share_the_name_and_it_waits_in_one_place(self):
        self.submit(msg("m1", **{"from": SYDNEE}))
        other = entities._new_entity(self.core, "person", "Sydnee Ward", False)   # a second address joins the first,
        entities._add_identifier(self.core, "email", "sward@other.example", other)   # so make the other one by hand
        for i in range(3):
            self.submit(msg(f"n{i}", **{"from": AMAR}, people=[{"name": "Sydnee Ward"}]))
        ids = self.sydnees()
        self.assertEqual(len(ids), 3, "the two real ones and one name-only holder, not one per mention")

    def test_said_to_be_different_is_never_joined(self):
        held, real = self.seeded()
        self.core.q("INSERT INTO entity_links VALUES (?,?,?)", (real, held, "different"))
        self.submit(msg("n1", **{"from": AMAR}, people=[{"name": "Sydnee Ward"}]))
        self.assertEqual(self.sydnees(), [held, real])
        self.assertEqual(entities.settle_full_names(self.core), [])

    def test_settling_the_pile(self):
        held, real = self.seeded()
        extra = [entities._new_entity(self.core, "person", "Sydnee Ward", True) for _ in range(3)]
        lone = [entities._new_entity(self.core, "person", "Brad Ng", True) for _ in range(2)]
        plan = entities.settle_full_names(self.core)
        self.assertEqual(sorted((p["from"], p["into"]) for p in plan),
                         sorted([(x, real) for x in [held] + extra] + [(lone[1], lone[0])]))
        self.assertEqual(len(self.sydnees()), 5, "a plan only")
        entities.settle_full_names(self.core, apply=True)
        self.assertEqual(self.sydnees(), [real])
        self.assertEqual({entities._follow(self.core, x) for x in [held] + extra}, {real})
        self.assertEqual(entities.settle_full_names(self.core), [], "nothing left")
        actions.undo(self.core)
        self.assertEqual(events.check_replay(self.core), [])

    def test_a_held_one_with_an_address_is_left_alone(self):
        held, real = self.seeded()
        entities._add_identifier(self.core, "email", "other@acme.example", held)
        self.assertEqual(entities.settle_full_names(self.core), [])

    def test_a_relay_carrying_the_name_is_not_a_second_one(self):
        held, real = self.seeded()
        bot = entities._new_entity(self.core, "person", "Jira", False)   # a relay made first, as notifications@ are
        entities._add_identifier(self.core, "email", "relay@acme.example", bot)
        self.submit(msg("j2", **{"from": {"name": "Sydnee Ward", "email": "relay@acme.example"}}))
        self.submit(msg("n1", **{"from": AMAR}, people=[{"name": "Sydnee Ward"}]))
        self.assertEqual(self.sydnees(), [held, real])
        self.assertEqual([p["into"] for p in entities.settle_full_names(self.core)], [real])
