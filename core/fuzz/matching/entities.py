"""A minimal in-process entity service: resolve() and the lookups the matcher needs.

Moved from the matching spike. Every function takes the Core and scopes by its user.

Resolution order (doc, "How resolution works"): an exact identifier decides
first, then a unique alias, else a provisional entity. The AI-judge step for
ambiguous aliases is left out of the spike: an ambiguous name stays provisional.
"""

import re
from urllib.parse import parse_qs, urlparse

from . import who

TICKET_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d+)\b")
GDOC_RE = re.compile(r"/d/([A-Za-z0-9_-]{10,})")


def normalize_url(url):
    """Stable identifier for a shared doc or ticket link."""
    p = urlparse(url.strip())
    host = (p.hostname or "").lower()
    m = GDOC_RE.search(p.path)
    if m:
        return "gdoc:" + m.group(1)
    m = re.search(r"/browse/([A-Z][A-Z0-9]+-\d+)", p.path)
    if m:
        return "ticket:" + m.group(1)
    page = parse_qs(p.query).get("pageId")   # a wiki page by id: the address alone is the same for every page
    if page:
        return f"{host}{p.path.rstrip('/')}?pageId={page[0]}"
    return host + p.path.rstrip("/")


def tickets_in(*texts):
    found = []
    for t in texts:
        for k in TICKET_RE.findall(t or ""):
            if k not in found:
                found.append(k)
    return found


def _by_identifier(core, typ, value):
    row = core.conn.execute("SELECT entity_id FROM identifiers WHERE user_id=? AND type=? AND value=?",
                            (core.user_id, typ, value)).fetchone()
    return _follow(core, row["entity_id"]) if row else None


def _follow(core, eid):
    while True:
        row = core.conn.execute("SELECT redirect_to FROM entities WHERE id=?", (eid,)).fetchone()
        if row is None or row["redirect_to"] is None:
            return eid
        eid = row["redirect_to"]


def _new_entity(core, typ, name, provisional):
    cur = core.conn.execute("INSERT INTO entities (user_id, type, name, provisional) VALUES (?,?,?,?)",
                            (core.user_id, typ, name, 1 if provisional else 0))
    eid = cur.lastrowid
    if name:
        core.conn.execute("INSERT OR IGNORE INTO aliases VALUES (?,?)", (eid, name.lower()))
    return eid


def display_name(conn, row):
    """An entity's name, or its longest alias when it was first seen with no name (a bare email address)."""
    if row["name"]:
        return row["name"]
    a = conn.execute("SELECT alias FROM aliases WHERE entity_id=? ORDER BY length(alias) DESC LIMIT 1", (row["id"],)).fetchone()
    return (a["alias"].title() if row["type"] == "person" else a["alias"]) if a else "someone"


def _add_identifier(core, typ, value, eid):
    core.conn.execute("INSERT OR IGNORE INTO identifiers VALUES (?,?,?,?)", (core.user_id, typ, value, eid))


def _is_me(person, me):
    if (person.get("email") or "").lower() in [e.lower() for e in me.get("emails", [])]:
        return True
    if person.get("slack_id") and person["slack_id"] in me.get("slack_ids", []):
        return True
    if not person.get("email") and not person.get("slack_id"):
        return (person.get("name") or "").lower() in [n.lower() for n in me.get("names", [])]
    return False


def sent_by_me(person, me):
    """Whether a message's sender is the person. Looser than _is_me on names alone, since Slack gives the
    full name ("Justin Grover") where me.names may hold only "Justin". An email or Slack ID decides."""
    if person.get("email") or person.get("slack_id"):
        return _is_me(person, me)
    name = (person.get("name") or "").strip().lower()
    names = [n.lower() for n in me.get("names", [])]
    return bool(name) and (name in names or name.split()[0] in names)


def same_person(a, b):
    """Whether two senders are the same person. An email or Slack ID both carry decides; otherwise the names,
    with a first name matching a full one ("Jacob" and "Jacob Tedders"), as sent_by_me allows."""
    for key in ("email", "slack_id"):
        if a.get(key) and b.get(key):
            return a[key].lower() == b[key].lower()
    x, y = ((p.get("name") or "").strip().lower() for p in (a, b))
    if not x or not y:
        return False
    return x == y or (" " not in x and x == y.split()[0]) or (" " not in y and y == x.split()[0])


def resolve_person(core, person, me, ctx=None):
    """Return (entity_id, strength) or None for the user themself.

    A first name alone never makes a person (who.py): its message's context (ctx, a who.Context) settles who
    it is, or it waits on the name's holder, a name-only entity a "Which Nick?" card asks about."""
    if _is_me(person, me):
        return None
    email = (person.get("email") or "").lower() or None
    slack = person.get("slack_id") or None
    name = (person.get("name") or "").strip() or None
    eid = None
    if email:
        eid = _by_identifier(core, "email", email)
    if eid is None and slack:
        eid = _by_identifier(core, "slack", slack)
    if eid is not None or email or slack:
        if eid is None:
            # A strong identifier we have not seen. Join an existing person when the full name
            # (two or more words) is unique, e.g. Priya Shah by email, then by Slack ID. A first
            # name alone only joins a provisional, name-only entity.
            full = name if name and len(name.split()) > 1 else None
            eid = (_unique_alias(core, "person", full) or (full and _the_known_one(core, full))
                   or _unique_alias(core, "person", name, provisional_only=True)
                   or _new_entity(core, "person", name, False))
            core.conn.execute("UPDATE entities SET provisional=0 WHERE id=?", (eid,))
        if email:
            _add_identifier(core, "email", email, eid)
            domain = email.split("@")[-1]
            org = _by_identifier(core, "domain", domain) or _new_entity(core, "org", domain, False)
            _add_identifier(core, "domain", domain, org)
        if slack:
            _add_identifier(core, "slack", slack, eid)
        if name:
            # first seen by email alone, the person had no name until now
            core.conn.execute("UPDATE entities SET name=? WHERE id=? AND name IS NULL", (name, eid))
            core.conn.execute("INSERT OR IGNORE INTO aliases VALUES (?,?)", (eid, name.lower()))
            first = name.split()[0].lower()
            core.conn.execute("INSERT OR IGNORE INTO aliases VALUES (?,?)", (eid, first))
        signed = (person.get("signed_as") or "").strip().lower()
        if signed and len(signed.split()) == 1:   # "Thanks, Rob": what they go by
            core.conn.execute("INSERT OR IGNORE INTO aliases VALUES (?,?)", (eid, signed))
        return eid, "id"
    if not name:
        return None
    if who.first_only(person):
        eid = who.guess(core, name, ctx)
        if eid is not None:
            return eid, "alias"
        return (who.holder(core, name) or _new_entity(core, "person", name, True)), "provisional"
    eid = _unique_alias(core, "person", name) or _the_known_one(core, name)
    if eid is not None:
        prov = core.conn.execute("SELECT provisional FROM entities WHERE id=?", (eid,)).fetchone()["provisional"]
        return eid, "provisional" if prov else "alias"
    # shared by more than one, or no one yet: it waits on one name-only holder, never a new one per mention
    return (_full_holder(core, name) or _new_entity(core, "person", name, True)), "provisional"


def _holding(core, name):
    """The live people known by this name: [{id, provisional, ids}], ids being how many emails or Slack IDs they
    have. Their own name, not only an alias: a relay address (notifications@github.com, a Jira sender) collects
    the name of everyone it sends for, and isn't any of them."""
    return core.conn.execute(
        "SELECT DISTINCT e.id, e.provisional, (SELECT COUNT(*) FROM identifiers i WHERE i.entity_id=e.id) ids "
        "FROM aliases a JOIN entities e ON e.id=a.entity_id WHERE a.alias=? AND lower(trim(e.name))=a.alias "
        "AND e.type='person' AND e.redirect_to IS NULL AND e.user_id=? ORDER BY e.id",
        (name.strip().lower(), core.user_id)).fetchall()


def _different(core, a, b):
    return core.conn.execute("SELECT 1 FROM entity_links WHERE kind='different' AND ((a=? AND b=?) OR (a=? AND b=?))",
                             (a, b, b, a)).fetchone() is not None


def _the_known_one(core, name):
    """The one confirmed person a full name is shared with only name-only stand-ins for: Wren by email, and a
    Wren made from her name before her address was seen. None when two real people share it, or you said a
    stand-in is someone else."""
    rows = _holding(core, name)
    real = [r for r in rows if not r["provisional"]]
    if len(real) != 1:
        return None
    rest = [r for r in rows if r["provisional"]]
    if any(r["ids"] or _different(core, r["id"], real[0]["id"]) for r in rest):
        return None
    return real[0]["id"]


def _full_holder(core, name):
    """The name-only person already holding an unsettled full name, if there is one."""
    row = core.conn.execute(
        "SELECT e.id FROM entities e WHERE e.user_id=? AND e.type='person' AND e.provisional=1 AND e.redirect_to IS NULL "
        "AND lower(trim(e.name))=? AND NOT EXISTS (SELECT 1 FROM identifiers i WHERE i.entity_id=e.id) ORDER BY e.id LIMIT 1",
        (core.user_id, name.strip().lower())).fetchone()
    return row["id"] if row else None


def settle_full_names(core, apply=False):
    """The name-only people that piled up under a full name before this (a new one per mention once two shared
    it): each joins the one confirmed person by that name, or the oldest of them when there is none. One with
    an address of its own, or one you said is someone else, stays. Returns the plan; apply carries it out, each
    move an entity.merged you can undo."""
    rows = core.conn.execute(
        "SELECT e.id, e.name FROM entities e WHERE e.user_id=? AND e.type='person' AND e.provisional=1 "
        "AND e.redirect_to IS NULL AND e.name LIKE '% %' AND NOT EXISTS (SELECT 1 FROM identifiers i WHERE i.entity_id=e.id) "
        "ORDER BY e.id", (core.user_id,)).fetchall()
    by = {}
    for r in rows:
        by.setdefault(r["name"].strip().lower(), []).append(r["id"])
    plan = []
    for name, ids in sorted(by.items()):
        real = [r["id"] for r in _holding(core, name) if not r["provisional"]]
        if len(real) > 1:
            into, rest = ids[0], ids[1:]   # two real people share it: the stand-ins wait in one place
        elif real:
            into, rest = real[0], ids
        else:
            into, rest = ids[0], ids[1:]
        for b in rest:
            if not any(_different(core, b, x) for x in [into] + real):
                plan.append({"from": b, "into": into, "name": name})
    if apply:
        from .. import events
        for step in plan:
            with core.tx("human"):
                ch = events.Changes()
                for c in core.conn.execute("SELECT id FROM cards WHERE user_id=? AND kind='entity_person' AND status='open' "
                                           "AND json_extract(payload,'$.entity_b')=?", (core.user_id, step["from"])).fetchall():
                    ch.card(c["id"], status="expired", answer={"option": "same", "value": step["into"]})
                core.conn.execute("UPDATE entities SET redirect_to=? WHERE id=? AND user_id=?",
                                  (step["into"], step["from"], core.user_id))
                events.emit(core, "entity.merged", changes=ch, data={"from": step["from"], "into": step["into"],
                                                                   "settled": True})
    return plan


def lookup_person(core, person):
    """The entity a person already resolved to, in the same order as resolve_person, without writing
    anything. None when nothing matches, or a name is shared."""
    email = (person.get("email") or "").lower()
    slack = person.get("slack_id")
    name = (person.get("name") or "").strip()
    return ((email and _by_identifier(core, "email", email)) or (slack and _by_identifier(core, "slack", slack))
            or _unique_alias(core, "person", name) or None)


def _unique_alias(core, typ, name, provisional_only=False):
    if not name:
        return None
    q = ("SELECT DISTINCT e.id FROM aliases a JOIN entities e ON e.id=a.entity_id "
         "WHERE a.alias=? AND e.type=? AND e.redirect_to IS NULL AND e.user_id=?")
    if provisional_only:
        q += " AND e.provisional=1"
    rows = core.conn.execute(q, (name.lower(), typ, core.user_id)).fetchall()
    return rows[0]["id"] if len(rows) == 1 else None


def resolve_link(core, url):
    ident = normalize_url(url)
    if ident.startswith("ticket:"):
        return resolve_ticket(core, ident[7:])
    eid = _by_identifier(core, "url", ident)
    if eid is None:
        eid = _new_entity(core, "document", ident, False)
        _add_identifier(core, "url", ident, eid)
    return eid, "id"


def resolve_ticket(core, key):
    eid = _by_identifier(core, "ticket", key)
    if eid is None:
        eid = _new_entity(core, "ticket", key, False)
        _add_identifier(core, "ticket", key, eid)
    return eid, "id"


def resolve_term(core, term):
    eid = _unique_alias(core, "term", term) or _new_entity(core, "term", term, False)
    return eid, "id"


def resolve_candidate(core, cand_id, signal, cand, me, key=None):
    """resolve(mentions, context) for one candidate; writes mentions. Safe to repeat."""
    people = list(cand.get("people") or []) + list(signal.get("people") or [])
    if signal.get("from"):
        people.append(signal["from"])
    found = {}
    ctx = who.Context(core, signal, key, me)
    # the people known for sure first, so a first name on the same message has them as context
    for p in sorted(people, key=who.first_only):
        r = resolve_person(core, p, me, ctx)
        if r:
            found[r[0]] = _stronger(found.get(r[0]), r[1])
    for url in list(cand.get("links") or []) + list(signal.get("links") or []):
        eid, s = resolve_link(core, url)
        found[eid] = _stronger(found.get(eid), s)
    for key in tickets_in(cand.get("ask"), signal.get("quote")):
        eid, s = resolve_ticket(core, key)
        found[eid] = _stronger(found.get(eid), s)
    for t in cand.get("topics") or []:
        eid, s = resolve_term(core, t)
        found[eid] = _stronger(found.get(eid), s)
    for eid, s in found.items():
        core.conn.execute("INSERT OR REPLACE INTO mentions VALUES (?,?,?)", (cand_id, eid, s))
    return found


def _stronger(a, b):
    order = {"id": 3, "alias": 2, "provisional": 1, None: 0}
    return a if order[a] >= order[b] else b
