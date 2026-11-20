"""The anchor index: what each task carries that can tie it to a series, and how much each anchor is worth.

Worked out from the store each time it's needed (cheap at the size of one person's work), so it always
matches the signals that have arrived. A task's anchors come from the signals that made or updated it:
the candidate's topics, the Slack channel, a meeting's title, and the tickets, documents, terms, tools,
companies and people it mentions. You and bots never count, and neither do your regular team
(matching's PERSON_REGULAR): they're on everything.

Weight is rarity (log N/n) times the anchor kind's worth; an anchor on fewer than 2 tasks, or on a big
share of them, counts for nothing. A series' anchors are the ones at least 2 of its tasks carry, plus the
ones you added, minus the ones you removed.
"""

import json
import math
import re
from datetime import timedelta

from .. import states
from ..db import iso
from . import settings as settings_mod

LIVE_SERIES = ("forming", "inferred", "named", "dormant")
# anchor rows that are off but that you didn't remove: an exclusion (or one you took back), an add you undid
NOT_REMOVALS = ("exclude", "unexcluded", "undone")
# The local part of an address that is a mailing list, not a person: northwind-all@, dl-pricing@, eng-team@
LIST_RE = re.compile(r"^(all|dl|list|team|everyone|announce|staff)[-._]|[-._](all|dl|list|lists|team|everyone|announce|group|staff)@|"
                     r"^[^@]*(-list|-group|-dl)@")


def norm(s):
    """Words, lowercased, simple plurals folded: "Experiment Plans" and "experiment plan" are one topic."""
    w = re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split()
    return " ".join(x[:-1] if len(x) > 3 and x.endswith("s") and not x.endswith("ss") else x for x in w)


def kind_of(key):
    return key.split(":", 1)[0]


class Index:
    def __init__(self, core, as_of=None):
        """as_of: an ISO time; tasks made and signals sent after it don't exist yet (a replay of history)."""
        self.core = core
        self.as_of = as_of
        self.cfg = settings_mod.get(core)
        self.feats = {}       # task -> {key: label}
        self.index = {}       # key -> {task}
        self.origins = {}     # task -> {origin}
        self.dates = {}       # task -> {YYYY-MM-DD}
        self.last = {}        # task -> latest signal or change time
        self.tasks = {t["id"]: t for t in core.all("SELECT * FROM tasks WHERE user_id=? AND state!='merged'", (core.user_id,))
                      if not as_of or (t.get("created_at") or "") <= as_of}
        self.series = {s["id"]: s for s in core.all("SELECT * FROM series WHERE user_id=? AND state!='dropped'", (core.user_id,))}
        self.rows = {}        # series -> [anchor rows]
        for a in core.all("SELECT * FROM series_anchors WHERE user_id=? ORDER BY id", (core.user_id,)):
            self.rows.setdefault(a["series_id"], []).append(a)
        self.members = {}
        for tid, t in self.tasks.items():
            if t.get("series_id") in self.series:
                self.members.setdefault(t["series_id"], set()).add(tid)
        self.labels = {}
        self._build()
        self.area_keys = set()
        for sid, s in self.series.items():
            if s["kind"] == "area":
                self.area_keys |= {a["key"] for a in self.rows.get(sid, []) if not a["removed"]}

    # ---------------------------------------------------------------- building
    def _people_to_skip(self):
        core = self.core
        me = core.config.get("me", {})
        skip = set()
        emails = [e.lower() for e in me.get("emails", [])]
        slack = me.get("slack_ids", [])
        for r in core.all("SELECT entity_id, type, value FROM identifiers WHERE user_id=?", (core.user_id,)):
            if (r["type"] == "email" and r["value"].lower() in emails) or (r["type"] == "slack" and r["value"] in slack):
                skip.add(r["entity_id"])
        names = {n.lower() for n in me.get("names", [])}
        from ..matching import matcher
        since = iso(core.now() - timedelta(days=matcher.REGULAR_WINDOW_DAYS))
        for e in core.all("SELECT id, name FROM entities WHERE user_id=? AND type='person'", (core.user_id,)):
            n = (e["name"] or "").lower()
            if n in names or "[bot]" in n or n.endswith(" bot"):
                skip.add(e["id"])
        for r in core.all(
                "SELECT m.entity_id, COUNT(DISTINCT s.task_id) n FROM sources s JOIN mentions m ON m.candidate_id=s.candidate_id "
                "JOIN entities e ON e.id=m.entity_id JOIN tasks t ON t.id=s.task_id "
                "WHERE s.user_id=? AND s.withdrawn=0 AND e.type='person' AND t.created_at >= ? "
                "GROUP BY m.entity_id HAVING n >= ?", (core.user_id, since, matcher.PERSON_REGULAR)):
            skip.add(r["entity_id"])
        return skip

    def _add(self, tid, key, label):
        self.feats.setdefault(tid, {})[key] = label
        self.index.setdefault(key, set()).add(tid)
        self.labels.setdefault(key, label)

    def _build(self):
        core = self.core
        skip = self._people_to_skip()
        ents = {e["id"]: e for e in core.all("SELECT id, type, name, redirect_to FROM entities WHERE user_id=?", (core.user_id,))}

        def follow(eid):
            seen = 0
            while eid in ents and ents[eid]["redirect_to"] and seen < 20:
                eid, seen = ents[eid]["redirect_to"], seen + 1
            return eid

        for tid, t in self.tasks.items():
            self.origins[tid] = {f"group:{t['group_id']}"} if t.get("group_id") else set()
            day = (t.get("created_at") or "")[:10]
            self.dates[tid] = {day} if day else set()
            self.last[tid] = t.get("state_changed_at") or t.get("created_at") or ""
        rows = core.all(
            "SELECT s.task_id, s.candidate_id cid, c.payload, g.source, g.source_id, g.anchor, g.ts, g.payload spayload "
            "FROM sources s JOIN candidates c ON c.id=s.candidate_id "
            "LEFT JOIN signals g ON g.key=c.signal_key AND g.user_id=c.user_id "
            "WHERE s.user_id=? AND s.role IN ('origin','update','context') AND s.withdrawn=0", (core.user_id,))
        typed_lists = {a["key"] for rows_ in self.rows.values() for a in rows_ if a["key"].startswith("list:") and a["how"] == "added"}
        senders = set()   # an address that sends mail is a person, never a list
        for g in core.all("SELECT json_extract(payload,'$.from.email') e FROM signals WHERE user_id=? AND source='email'", (core.user_id,)):
            if g["e"]:
                senders.add(g["e"].strip().lower())
        mentions = {}
        for m in core.all("SELECT m.candidate_id, m.entity_id FROM mentions m JOIN candidates c ON c.id=m.candidate_id "
                          "WHERE c.user_id=? AND m.strength!='provisional'", (core.user_id,)):
            mentions.setdefault(m["candidate_id"], []).append(m["entity_id"])
        for r in rows:
            tid = r["task_id"]
            if tid not in self.tasks:
                continue
            ts = r["ts"] or ""
            if self.as_of and ts > self.as_of:
                continue
            if ts:
                self.dates[tid].add(ts[:10])
                self.last[tid] = max(self.last[tid], ts)
            self.origins[tid].add(r["anchor"] or f"task:{tid}")
            p = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"] or "{}")
            for tp in p.get("topics") or []:
                if norm(tp):
                    self._add(tid, "topic:" + norm(tp), f"topic “{tp}”")
            if r["source"] == "slack" and r["source_id"]:
                ch = r["source_id"].split(":")[0]
                if ch.startswith("D"):
                    self._add(tid, "dm:" + ch, "a Slack DM")
                else:
                    self._add(tid, "chan:" + ch, f"Slack channel {ch}")
            sp = r["spayload"] if isinstance(r["spayload"], dict) else json.loads(r["spayload"] or "{}")
            if r["source"] in ("meeting", "calendar"):
                title = ((sp.get("from") or {}).get("name") or sp.get("title") or "")
                if norm(title):
                    self._add(tid, "meet:" + norm(title), f"meeting “{title}”")
            if r["source"] == "email":   # an email list it went to: an address shaped like a list that never writes
                for p in sp.get("people") or []:
                    e = (p.get("email") or "").strip().lower()
                    if e and ((LIST_RE.search(e) and e not in senders) or "list:" + e in typed_lists):
                        self._add(tid, "list:" + e, f"email list {e}")
            for eid in mentions.get(r["cid"], []):
                eid = follow(eid)
                e = ents.get(eid)
                if not e or eid in skip:
                    continue
                typ, name = e["type"], e["name"] or ""
                if typ == "ticket":
                    self._add(tid, f"ticket:{eid}", f"ticket {name}")
                    proj = name.split("-")[0] if "-" in name else ""
                    if proj:
                        self._add(tid, "proj:" + proj, f"{proj} tickets")
                elif typ in ("document", "term", "tool", "org", "person"):
                    self._add(tid, f"{typ}:{eid}", f"{typ} {name}" if typ in ("document", "person") else name)
        # words you added to a series: any task whose title or ask says them
        words = {a["key"] for rows_ in self.rows.values() for a in rows_ if a["key"].startswith("word:") and not a["removed"]}
        for key in words:
            w = f" {key[5:]} "
            for tid, t in self.tasks.items():
                if w in f" {norm(t['title'])} {norm(t.get('ask') or '')} ":
                    self._add(tid, key, f"the words “{key[5:]}”")

    # ---------------------------------------------------------------- weights and scores
    @property
    def n(self):
        return max(len(self.tasks), self.cfg["n_floor"])

    def weight(self, key, added=False):
        n = len(self.index.get(key, ()))
        if n < (1 if added else 2) or n > max(self.cfg["broad_floor"], self.cfg["broad"] * len(self.tasks)):
            return 0.0
        return self.cfg["weights"].get(kind_of(key), 1.0) * math.log(self.n / n)

    def yours(self, sid):
        s = self.series.get(sid) or {}
        return s.get("origin") == "asked" or bool(s.get("named_at"))

    def anchors(self, sid):
        """{key: label}: what at least 2 of its tasks carry, plus yours, minus the ones you removed."""
        s = self.series.get(sid)
        if s is None:
            return {}
        rows = self.rows.get(sid, [])
        # removed by you; an exclusion you took back (or undid) or an add you undid isn't a removal, and a live
        # exclusion is never an anchor
        removed = {a["key"] for a in rows if a["removed"] and a["how"] not in NOT_REMOVALS}
        removed |= set(self.excluded(sid))
        if s["kind"] == "area":
            return {a["key"]: a["label"] or self.labels.get(a["key"], a["key"]) for a in rows if not a["removed"]}
        counts = {}
        for t in self.members.get(sid, ()):
            for k in self.feats.get(t, {}):
                counts[k] = counts.get(k, 0) + 1
        # a key is its anchor only where it's concentrated: at least anchor_share of the tasks carrying it are in
        # the series. Otherwise every task that joins brings broad keys along, and the series snowballs.
        # (Tasks another series already holds don't count against it.)
        share = self.cfg["anchor_share"]
        open_to = lambda k: sum(1 for t in self.index.get(k, ()) if self.tasks[t].get("series_id") in (None, sid))
        out = {k: self.labels.get(k, k) for k, c in counts.items() if c >= 2 and self.weight(k) > 0 and k not in removed
               and c >= share * open_to(k)}
        for a in rows:
            if a["how"] == "added" and not a["removed"]:
                out[a["key"]] = a["label"] or self.labels.get(a["key"], a["key"])
        return out

    def added(self, sid):
        return {a["key"] for a in self.rows.get(sid, []) if a["how"] == "added" and not a["removed"]}

    def excluded(self, sid):
        """{key: label}: what keeps work out of it ("Keeps work out" on its page). New work carrying one doesn't join."""
        return {a["key"]: a["label"] or self.labels.get(a["key"], a["key"])
                for a in self.rows.get(sid, []) if a["how"] == "exclude" and not a["removed"]}

    def score(self, tid, sid, anchors=None):
        anchors = self.anchors(sid) if anchors is None else anchors
        mine = self.added(sid)
        feats = self.feats.get(tid, {})
        if any(k in feats for k in self.excluded(sid)):   # you said work like this isn't part of it
            return 0.0
        total, strong = 0.0, False
        for k in feats:
            if k in anchors:
                w = self.weight(k, added=k in mine)
                if k in self.area_keys and not self.yours(sid):
                    w *= self.cfg["area_weight"]
                elif kind_of(k) not in ("person", "dm") and w > 0:
                    strong = True
                total += w
        # people and an area's anchors only add to a match: alone they'd pull in the area's whole work
        return total if strong else 0.0

    def scores(self, tid, sids=None):
        """[(score, sid)] best first, for the series (not areas) given or every one."""
        sids = [s for s in (self.series if sids is None else sids) if self.series[s]["kind"] == "series"]
        out = [(self.score(tid, s), s) for s in sids]
        return sorted([x for x in out if x[0] > 0], reverse=True)

    def also_touches(self, tid):
        """The series other than its primary whose anchors it matches at the attach score. Worked out when read."""
        primary = (self.tasks.get(tid) or {}).get("series_id")
        live = [s for s, r in self.series.items() if r["kind"] == "series" and r["state"] in LIVE_SERIES + ("wrapped",) and s != primary]
        return [s for sc, s in self.scores(tid, live) if sc >= self.cfg["attach_score"]]

    def touching(self, sid):
        """Tasks in another series (or none) that also touch this one."""
        anchors = self.anchors(sid)
        out = []
        for tid, t in self.tasks.items():
            if t.get("series_id") == sid or not (set(self.feats.get(tid, {})) & set(anchors)):
                continue
            if self.score(tid, sid, anchors) >= self.cfg["attach_score"]:
                out.append(tid)
        return out

    # ---------------------------------------------------------------- the rules
    def rules(self, tids):
        """What a set of tasks lacks to be a series: [] when it passes."""
        tids = list(tids)
        orig = set().union(*(self.origins.get(t, set()) for t in tids)) if tids else set()
        days = set().union(*(self.dates.get(t, set()) for t in tids)) if tids else set()
        fails = []
        if len(tids) < self.cfg["min_tasks"]:
            fails.append(f"{len(tids)} of {self.cfg['min_tasks']} tasks")
        if len(orig) < self.cfg["min_origins"]:
            fails.append(f"{len(orig)} of {self.cfg['min_origins']} origins")
        if len(days) < self.cfg["min_days"]:
            fails.append(f"{len(days)} of {self.cfg['min_days']} active days")
        return fails

    def live_tasks(self, sid):
        return [t for t in self.members.get(sid, ()) if self.tasks[t]["state"] in states.LIVE]

    def last_moved(self, sid):
        return max((self.last.get(t) or "" for t in self.members.get(sid, ())), default="")


def get(core):
    """One index per reading() (a request), rebuilt after any write."""
    return core.memo(("series_index",), lambda: Index(core))
