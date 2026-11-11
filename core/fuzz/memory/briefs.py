"""The Knowledge/ files: the people map, the glossary and the decision log.

The core writes them from the tables, with no model, into Knowledge/ in the output folder (or knowledge/ in
Fuzz's home when there's none), and keeps them in memory_files so they show under Artifacts. A file is rewritten
only when its content changes, so it doesn't jump to the top of Artifacts every minute. Writing a file
doesn't count as showing you its facts.

Meeting briefs used to live here too; they were taken out until there's a better model for them. Files a
store wrote for them (kind 'brief') are left alone on disk and no longer listed.
"""

import hashlib
import os
import re

from .. import outputs
from ..matching import entities
from . import facts, knowledge

LABEL = {"confirmed": "", "authoritative": "", "reported": "", "inferred": " *(Fuzz's guess)*",
         "stale": " *(may be out of date)*"}
CLOSED = ("done", "letgo", "merged")


def _cfg(core):
    return core.config.get("memory") or {}


def folder(core):
    out = outputs.folder(core)
    return os.path.join(out, "Knowledge") if out else os.path.join(core.home, "knowledge")


def _safe(s):
    return re.sub(r"[^\w\- .&()]+", "", s or "").strip()[:80] or "Meeting"


def _write(core, kind, title, rel, body, meeting_key=None, starts_at=None):
    """Write the file only when its content changed. Returns the memory_files id."""
    path = os.path.join(folder(core), rel)
    digest = hashlib.sha256(body.encode()).hexdigest()
    row = core.one("SELECT * FROM memory_files WHERE user_id=? AND path=?", (core.user_id, path))
    if row and row["digest"] == digest and os.path.isfile(path):
        return row["id"]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(body)
    os.replace(tmp, path)
    if row:
        core.q("UPDATE memory_files SET digest=?, updated_at=?, title=?, starts_at=? WHERE id=?",
               (digest, core.now_iso(), title, starts_at, row["id"]))
        return row["id"]
    return core.q("INSERT INTO memory_files (user_id, kind, title, path, meeting_key, starts_at, digest, updated_at) "
                  "VALUES (?,?,?,?,?,?,?,?)", (core.user_id, kind, title, path, meeting_key, starts_at, digest,
                                               core.now_iso())).lastrowid


def files(core):
    return [f for f in core.all("SELECT * FROM memory_files WHERE user_id=? AND kind!='brief' ORDER BY updated_at DESC",
                                (core.user_id,))
            if os.path.isfile(f["path"])]


def get_file(core, fid):
    f = core.one("SELECT * FROM memory_files WHERE id=? AND user_id=? AND kind!='brief'", (fid, core.user_id))
    return f if f and os.path.isfile(f["path"]) else None


# ---------------------------------------------------------------- shared pieces

def _name(core, eid):
    e = facts.entity(core, eid)
    return entities.display_name(core.conn, e) if e else "someone"


def _fact_line(f):
    return f"{f['value']}{LABEL.get(f['trust']['level'], '')}{' *(disputed)*' if f.get('disputed') else ''}"


def person_summary(core, eid, now=None):
    """{name, facts: {attr: [judged facts]}, open: [...], last: ts}: what Fuzz knows about a person."""
    by = {}
    for f in facts.for_entity(core, eid, now):
        if f["state"] == "winner":
            by.setdefault(f["attr"], []).append(f)
    return {"entity_id": eid, "name": _name(core, eid), "facts": by, "open": open_items(core, eid),
            "last": last_seen(core, eid)}


def last_seen(core, eid):
    ids = facts.closure(core, eid)
    r = core.one(f"SELECT MAX(ts) ts FROM sightings WHERE user_id=? AND entity_id IN ({','.join('?' * len(ids))})",
                 (core.user_id, *ids))
    return (r or {}).get("ts")


def open_items(core, eid):
    """Open tasks the person is in: theirs to you (they asked, you're waiting on them) and yours to them."""
    ids = facts.closure(core, eid)
    marks = ",".join("?" * len(ids))
    rows = core.all(f"SELECT DISTINCT t.id, t.title, t.state, t.waiting_on FROM mentions m JOIN candidates c ON c.id=m.candidate_id "
                    f"JOIN sources s ON s.candidate_id=c.id AND s.user_id=c.user_id JOIN tasks t ON t.id=s.task_id "
                    f"WHERE m.entity_id IN ({marks}) AND t.user_id=? AND t.state NOT IN ('done','letgo','merged') "
                    f"ORDER BY t.id DESC LIMIT 8", (*ids, core.user_id))
    name = _name(core, eid).lower()
    out = []
    for t in rows:
        theirs = (t["waiting_on"] or "").strip().lower() in (name, name.split(" ")[0]) and t["state"] == "waiting"
        out.append({"task_id": t["id"], "title": t["title"], "state": t["state"],
                    "who_owes": "they owe you" if theirs else "you owe them"})
    return out


def _person_block(core, p, heading="###"):
    lines = [f"{heading} {p['name']}"]
    order = ("role", "team", "company", "manager", "projects", "owns", "cares_about", "prefers", "how_met", "works_hours")
    for attr in order:
        fs = p["facts"].get(attr)
        if fs:
            lines.append(f"- **{attr.replace('_', ' ').capitalize()}:** " + "; ".join(_fact_line(f) for f in fs))
    for o in p["open"]:
        lines.append(f"- Open ({o['who_owes']}): {o['title']}")
    if len(lines) == 1:
        lines.append("- Fuzz doesn't know much about them yet.")
    return "\n".join(lines)


# ---------------------------------------------------------------- the files

def people_md(core):
    me = core.config.get("me", {})
    people = []
    for e in core.all("SELECT * FROM entities WHERE user_id=? AND type='person' AND redirect_to IS NULL ORDER BY name", (core.user_id,)):
        nf = core.one("SELECT COUNT(*) n FROM facts WHERE user_id=? AND entity_id=? AND status='live'", (core.user_id, e["id"]))["n"]
        ns = core.one("SELECT COUNT(DISTINCT signal_key) n FROM sightings WHERE user_id=? AND entity_id=?", (core.user_id, e["id"]))["n"]
        if not nf and ns < 2:
            continue
        name = entities.display_name(core.conn, e)
        if entities._is_me({"name": name}, me):
            continue
        people.append(person_summary(core, e["id"]))
    teams = {}
    for p in people:
        team = (p["facts"].get("team") or [{}])[0].get("value") or "Team not known yet"
        teams.setdefault(team, []).append(p)
    out = ["# People", "", f"Who's who, as Fuzz has pieced it together. {len(people)} people. "
           "*Fuzz's guess* marks what nobody said outright.", ""]
    for team in sorted(teams, key=lambda t: (t == "Team not known yet", t.lower())):
        out += [f"## {team}", ""]
        for p in sorted(teams[team], key=lambda p: p["name"].lower()):
            out += [_person_block(core, p), ""]
    return "\n".join(out).rstrip() + "\n"


def glossary_md(core):
    rows = core.all("SELECT e.* FROM entities e WHERE e.user_id=? AND e.type IN ('term','tool') AND e.redirect_to IS NULL AND "
                    "(EXISTS (SELECT 1 FROM sightings s WHERE s.entity_id=e.id AND s.role='term') OR EXISTS (SELECT 1 FROM facts f "
                    "WHERE f.entity_id=e.id AND f.status='live')) ORDER BY lower(e.name)", (core.user_id,))
    out = ["# Glossary", "", "Acronyms, internal names and tools. *Fuzz's guess* marks a definition worked out from how "
           "the word was used: correct it in triage when it's off.", ""]
    n = 0
    for e in rows:
        w = [f for f in facts.for_entity(core, e["id"]) if f["state"] == "winner"]
        d = next((f for f in w if f["attr"] in ("definition", "what_it_is")), None)
        aliases = [a["alias"] for a in core.all("SELECT alias FROM aliases WHERE entity_id=? ORDER BY alias", (e["id"],))
                   if a["alias"] != (e["name"] or "").lower()]
        line = f"**{e['name']}**" + (f" ({', '.join(aliases)})" if aliases else "") + " — "
        line += _fact_line(d) if d else "*Not known yet.*"
        extra = [f"{f['attr'].replace('_', ' ')}: {_fact_line(f)}" for f in w if f["attr"] in ("stands_for", "owner", "used_for")]
        if extra:
            line += " · " + " · ".join(extra)
        out += [line, ""]
        n += 1
    if not n:
        out.append("Nothing yet.")
    return "\n".join(out).rstrip() + "\n"


def decisions_md(core):
    out = ["# Decisions", "", "Newest first. *Not confirmed* marks one Fuzz detected and you haven't confirmed yet.", ""]
    rows = core.all("SELECT * FROM decision_log WHERE user_id=? AND status IN ('recorded','proposed','reversed') "
                    "ORDER BY COALESCE(decided_at, captured_at) DESC, id DESC", (core.user_id,))
    for d in rows:
        who = _name(core, d["decided_by"]) if d["decided_by"] else None
        when = (d["decided_at"] or d["captured_at"])[:10]
        tag = " *(not confirmed)*" if d["status"] == "proposed" else " *(reversed)*" if d["status"] == "reversed" else ""
        out.append(f"## {d['what']}{tag}")
        out.append(f"{when}" + (f" · decided by {who}" if who else "") + (f" · [source]({d['link']})" if d.get("link") else ""))
        if d.get("why"):
            out.append(f"\n**Why:** {d['why']}")
        if d.get("alternatives"):
            out.append(f"\n**Also considered:** {', '.join(d['alternatives'])}")
        if d.get("reverses"):
            out.append(f"\nReverses: {knowledge.get_decision(core, d['reverses'])['what']}")
        later = knowledge.reversed_by(core, d["id"])
        if later:
            out.append(f"\nReversed by: {later[0]['what']}")
        out.append("")
    if not rows:
        out.append("Nothing yet.")
    return "\n".join(out).rstrip() + "\n"


def write_all(core):
    """(Re)write the people map, the glossary and the decisions."""
    return {"people": _write(core, "people", "People", "People.md", people_md(core)),
            "glossary": _write(core, "glossary", "Glossary", "Glossary.md", glossary_md(core)),
            "decisions": _write(core, "decisions", "Decisions", "Decisions.md", decisions_md(core))}


def tick(core):
    """From the scheduler's tick: the files rewritten every few minutes."""
    facts.ensure_migrated(core)
    last = getattr(core, "_memory_written", None)
    if last is None or (core.now() - last).total_seconds() >= 300:
        write_all(core)
        core._memory_written = core.now()
    return {}
