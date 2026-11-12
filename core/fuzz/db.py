"""The store: one SQLite file, owned by the core and written only through it.

Three zones, as in the matching spike:
  log        events (the source of truth), runs, decisions, feedback
  projection tasks, groups, cards, drafts, grants, user_state: rebuilt by replaying events
  derived    signals, candidates, entities, sources and the rest of the matcher's tables

Every row carries user_id, even with one user. Core.user_id is the one place that says who
the current user is; every query filters on it.
"""

import json
import os
import sqlite3
import sys
import threading
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config as config_mod

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT,
  created_at TEXT NOT NULL
);

-- log
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,             -- human | fuzz:extractor | fuzz:executor | system
  type TEXT NOT NULL,
  task_id INTEGER,
  payload TEXT NOT NULL,           -- {"data", "log", "changes", "prior"}
  caused_by INTEGER,               -- first event of the same command
  run_id INTEGER,
  model TEXT,
  prompt_version TEXT
);
CREATE INDEX IF NOT EXISTS events_user ON events (user_id, id);
CREATE INDEX IF NOT EXISTS events_task ON events (task_id, id);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,              -- executor | extractor
  client TEXT,                     -- claude-code | copilot | scripted | chat
  model TEXT,
  prompt_version TEXT,
  trigger TEXT,                    -- manual | launchd | ui | chat
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT,                    -- ok | error | nothing_to_do
  detail TEXT NOT NULL DEFAULT '{}'
);

-- projection
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  assignee TEXT,                   -- human | fuzz | session
  title TEXT NOT NULL,
  ask TEXT,
  owner TEXT,                      -- me | unclear | <name>, from extraction
  due TEXT,
  order_key REAL,
  notes TEXT,                      -- "where I left off", for the next stateless run
  context_md TEXT,                 -- Markdown brief the AI writes for the human
  summary TEXT,                    -- a sentence or two on what the AI did or found, shown above the brief
  question TEXT,                   -- the one question the AI is asking the human now
  quick_answers TEXT,              -- json list, from a handback
  variant_tags TEXT,               -- json list: time_sensitive, stale, returning, handed_back, reopened, woke, needs_permission, unconfirmed, review, put_off
  reason TEXT,                     -- why it is back: "Priya asked for the deck again on Slack"
  effort_mins INTEGER,
  energy TEXT,                     -- low | normal | high
  deadline_level INTEGER NOT NULL DEFAULT 0,
  steps_used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TEXT,
  schedule_anchor TEXT,            -- json anchor
  schedule_fire_at TEXT,
  schedule_hints TEXT,             -- json list of AI-suggested anchors
  waiting_on TEXT,
  merged_into INTEGER,
  parent_id INTEGER,
  group_id INTEGER,                -- the tasks that came from the same place (groups.py)
  reviewed_at TEXT,                -- the last time a parked review asked about it (review.py)
  reviews INTEGER,                 -- how many times you kept it parked when asked
  reschedules INTEGER,             -- how many times you gave it a new time from triage since it last asked (put_off)
  next_step TEXT,                  -- where a working session left off: the next thing to do (sessions.py)
  session_id TEXT,                 -- the Claude or Copilot conversation it's open in, to resume
  session_launch TEXT,             -- the latest window opened on it; only that one closing brings it back
  session_at TEXT,                 -- the last word from a working session, for the quiet check
  expires_at TEXT,                 -- the ask is moot after this (a meeting to join); untouched, it's let go then
  step_count INTEGER,              -- about how many steps it takes (the extractor's estimate)
  gaps TEXT,                       -- json list: what the brief couldn't find; finding out comes first on its card
  find_out TEXT,                   -- what you asked Fuzz to find out (Find out…); the task stays yours
  pushes INTEGER,                  -- how many times its card went to the end of the queue; twice asks what's in the way
  missed_blocks INTEGER,           -- booked blocks for it that went by unused, since it last asked
  deliverable_id INTEGER,          -- the deliverable it serves (deliverables.py)
  maybe_deliverable_id INTEGER,    -- a deliverable it might serve, waiting on a part_of card
  title_history TEXT,              -- json list
  created_at TEXT,
  state_changed_at TEXT,
  updated_at TEXT,
  updated_event_id INTEGER
);
CREATE INDEX IF NOT EXISTS tasks_user_state ON tasks (user_id, state);
CREATE INDEX IF NOT EXISTS tasks_user_closed ON tasks (user_id, state, state_changed_at);
CREATE TABLE IF NOT EXISTS deliverables (   -- a named outcome served by tasks from any channel (see Deliverables)
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  done_when TEXT NOT NULL,         -- evidence Fuzz can check with its tools
  checked_by TEXT NOT NULL,        -- fuzz | you
  for_name TEXT,                   -- who it's for: a customer or a team
  due TEXT,
  tier TEXT NOT NULL,              -- active (this week's) | background
  state TEXT NOT NULL,             -- open | done | dropped
  evidence TEXT,                   -- what Fuzz saw when it closed it
  check_due INTEGER,               -- 1: Fuzz checks the done-when on its next run
  reviewed_at TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  origin TEXT,                     -- email:<conversation> | meeting:<file stem> | slack:<channel>:<first ts> | fuzz:task<id>
  link TEXT,                       -- back to the email, the meeting notes or the first Slack message
  state TEXT NOT NULL,             -- open | wrapped (you said so); finished when no task in it is open
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  task_id INTEGER,
  other_id INTEGER,
  prompt TEXT,
  reason TEXT,
  options TEXT,                    -- json list; task cards work theirs out from the task's variant
  suggested TEXT,
  schedule_options TEXT,           -- json list of {anchor, label, fire_at, source}
  payload TEXT,                    -- json: draft_id, scope/resource, entity ids...
  status TEXT NOT NULL,            -- open | answered | expired | withdrawn
  postponed INTEGER NOT NULL DEFAULT 0,
  order_key REAL,
  answer TEXT,                     -- json {option, value}
  created_at TEXT,
  created_event_id INTEGER,
  answered_event_id INTEGER
);
CREATE INDEX IF NOT EXISTS cards_user_status ON cards (user_id, status);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- email.reply | slack.message | calendar.invite | nudge.* | note
  target TEXT,
  body TEXT,
  status TEXT NOT NULL,            -- pending | approved | sent | sent_back | withdrawn
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT,
  final INTEGER,                   -- 0: a note that prepares a later step; approving it doesn't close the task
  attachments TEXT,                -- json list of file names in the task's output folder, for the sender
  reply_to INTEGER,                -- the source whose thread a reply or nudge goes in
  covers TEXT,                     -- json list: the other tasks in the group one reply answers
  meta TEXT                        -- json: a calendar hold's {start, end, event_id}
);
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  scope TEXT NOT NULL,             -- source | connector
  resource TEXT NOT NULL,
  kind TEXT NOT NULL,              -- once | always | revoked
  task_id INTEGER,
  created_event_id INTEGER
);
CREATE TABLE IF NOT EXISTS user_state (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,               -- moment, cleared_since_checkin, next_checkin_at, held_until...
  value TEXT,
  PRIMARY KEY (user_id, key)
);

-- derived (the matcher's tables, from the spike, each with user_id)
CREATE TABLE IF NOT EXISTS signals (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,               -- source:source_id:version
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  version TEXT NOT NULL,
  anchor TEXT,
  link TEXT,
  ts TEXT,
  quote TEXT,
  payload TEXT NOT NULL,
  run_id INTEGER,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,              -- person | org | document | ticket | term | tool
  name TEXT,
  provisional INTEGER NOT NULL DEFAULT 1,
  redirect_to INTEGER,
  definition TEXT
);
CREATE TABLE IF NOT EXISTS identifiers (
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,              -- email | slack | domain | url | ticket
  value TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, type, value)
);
CREATE TABLE IF NOT EXISTS aliases (
  entity_id INTEGER NOT NULL,
  alias TEXT NOT NULL,             -- lowercased
  PRIMARY KEY (entity_id, alias)
);
CREATE TABLE IF NOT EXISTS entity_links (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- different
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  signal_key TEXT NOT NULL,
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- ask | update (a signal with no new ask)
  ask TEXT,
  owner TEXT,                      -- me | unclear | <name>
  due TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',  -- new | pending | decided
  pending_item TEXT,               -- json shortlist for the judge, while pending
  UNIQUE (user_id, signal_key, idx)
);
CREATE TABLE IF NOT EXISTS mentions (
  candidate_id INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  strength TEXT NOT NULL,          -- id | alias | provisional
  PRIMARY KEY (candidate_id, entity_id)
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  candidate_id INTEGER,            -- null for an attachment you added
  signal_key TEXT,
  role TEXT NOT NULL,              -- origin | update | context | ignored | attachment | output | link
  title TEXT,
  path TEXT,                       -- an attachment's file, in files/u<user>/t<task>/, or an output's
  link TEXT,                       -- a web page the executor added as a source (add_source)
  mime TEXT,
  size INTEGER,
  added_run INTEGER,
  withdrawn INTEGER NOT NULL DEFAULT 0,
  UNIQUE (task_id, candidate_id)
);
CREATE TABLE IF NOT EXISTS task_anchors (
  anchor TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  PRIMARY KEY (anchor, task_id)
);
CREATE TABLE IF NOT EXISTS task_links (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- possible_duplicate | related | kept_separate
  confidence REAL,
  reason TEXT,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS merges (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  into_task INTEGER NOT NULL,
  from_task INTEGER NOT NULL,
  moved TEXT NOT NULL,             -- json: sources, anchors, prior state
  ts TEXT NOT NULL,
  undone INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vectors (
  owner_type TEXT NOT NULL,        -- candidate
  owner_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL,               -- float32
  PRIMARY KEY (owner_type, owner_id, model)
);
CREATE TABLE IF NOT EXISTS cursors (
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, source)
);
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  run_id INTEGER,
  candidate_id INTEGER NOT NULL,
  stage TEXT NOT NULL,             -- anchor | entity | semantic | judge | rule
  outcome TEXT NOT NULL,
  task_id INTEGER,
  other_task_id INTEGER,
  verdict TEXT,
  confidence REAL,
  reason TEXT,
  scores TEXT,
  matcher_version TEXT,
  ts TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS screen_times (   -- when each card was on screen and how long you were away; for tuning, not events
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  card_id INTEGER,
  task_id INTEGER,
  mode TEXT,                       -- sort | work
  shown_at TEXT NOT NULL,
  left_at TEXT,
  away_s INTEGER,
  how TEXT                         -- what ended it: the answer, or skipped
);
-- memory: entities' facts, knowledge and decisions (docs/memory-layers.md). facts, knowledge, decision_log and
-- memory_links are projected (replayed from events); memory_files, fact_views and memory_refusals are derived.
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  attr TEXT NOT NULL,              -- from the allowlist for the entity's type (memory/facts.py)
  value TEXT NOT NULL,
  how TEXT NOT NULL,               -- stated | extracted | inferred | edited
  authority TEXT NOT NULL,         -- owner | official | other | you
  said_by INTEGER,                 -- person entity, when known
  source_kind TEXT,                -- email | slack | meeting | calendar | doc | directory | you
  source_ref TEXT,                 -- signal key, URL or directory id: a link back, never a copy
  link TEXT,
  source_ts TEXT,
  captured_at TEXT NOT NULL,
  status TEXT NOT NULL,            -- live | rejected | undone (superseded and disputed are worked out when read)
  confirmed_at TEXT                -- you confirmed or edited it
);
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- meeting | thread | reference | learning
  title TEXT,
  summary_md TEXT,                 -- a summary and open questions, never the full text
  source_ref TEXT,
  link TEXT,
  source_ts TEXT,
  captured_at TEXT NOT NULL,
  how TEXT NOT NULL,
  authority TEXT NOT NULL,
  status TEXT NOT NULL             -- live | rejected | undone
);
CREATE TABLE IF NOT EXISTS decision_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  what TEXT NOT NULL,
  why TEXT,
  alternatives TEXT,               -- json list
  decided_by INTEGER,              -- person entity
  decided_at TEXT,
  source_ref TEXT,
  link TEXT,
  how TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence REAL,
  status TEXT NOT NULL,            -- proposed | recorded | rejected | reversed | undone
  reverses INTEGER,                -- the earlier decision this one overturns
  captured_at TEXT NOT NULL,
  confirmed_at TEXT
);
CREATE TABLE IF NOT EXISTS memory_links (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,         -- knowledge | decision
  item_id INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- about | attendee | decided_by | involves | task | group (later: workstream)
  target_type TEXT NOT NULL,       -- entity | task | group
  target_id INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS memory_files (   -- Knowledge/ files, which belong to no task
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- people | glossary | decisions (brief: from the removed meeting briefs)
  title TEXT,
  path TEXT NOT NULL,
  meeting_key TEXT,
  starts_at TEXT,
  digest TEXT,                     -- of the content, so an unchanged file isn't rewritten
  updated_at TEXT,
  UNIQUE (user_id, path)
);
CREATE TABLE IF NOT EXISTS fact_views (     -- when a fact was shown to you, for exposure (rule 6); not events
  user_id INTEGER NOT NULL,
  fact_id INTEGER NOT NULL,
  shown_at TEXT NOT NULL,
  surface TEXT                     -- brief | recall | sheet | card
);
CREATE TABLE IF NOT EXISTS sightings (     -- where an entity came up: a signal that named it; derived, for recall
  user_id INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  signal_key TEXT NOT NULL,
  role TEXT NOT NULL,              -- from | on | named | term | about
  ts TEXT,
  PRIMARY KEY (user_id, entity_id, signal_key, role)
);
CREATE TABLE IF NOT EXISTS appearances (   -- who was on which message, by email, Slack ID or full name; derived
  user_id INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  signal_key TEXT NOT NULL,
  thread TEXT,                     -- the email or Slack thread (the signal's anchor)
  place TEXT,                      -- the Slack channel or DM
  size INTEGER NOT NULL,           -- how many people were on the message
  ts TEXT,
  PRIMARY KEY (user_id, entity_id, signal_key)
);
CREATE INDEX IF NOT EXISTS appearances_by_signal ON appearances (user_id, signal_key);
CREATE INDEX IF NOT EXISTS appearances_by_thread ON appearances (user_id, thread);
CREATE TABLE IF NOT EXISTS appearance_signals (   -- the messages appearances has indexed
  user_id INTEGER NOT NULL,
  signal_key TEXT NOT NULL,
  PRIMARY KEY (user_id, signal_key)
);
CREATE TABLE IF NOT EXISTS memory_refusals ( -- what the core refused from an AI run, and why; for the inspector
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  run_id INTEGER,
  ts TEXT NOT NULL,
  item TEXT NOT NULL,              -- json
  reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,              -- merge | keep | split | detach | schedule | not_task
  a INTEGER,
  b INTEGER,
  decision_id INTEGER,
  note TEXT
);
-- evals (docs/self-improving.md): outside the event log, like feedback, so an expired snapshot never
-- touches rebuild()
CREATE TABLE IF NOT EXISTS eval_cases (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  surface TEXT NOT NULL,           -- extract
  kind TEXT NOT NULL,              -- keep | skip
  input TEXT NOT NULL,             -- the message as the extractor saw it (JSON)
  expected TEXT NOT NULL,          -- {"has_my_ask": bool, "ask"?: str} (JSON)
  origin TEXT NOT NULL,            -- seed:<name> | feedback:<id>
  signal_key TEXT,                 -- the message it came from; one case per message
  quote TEXT,                      -- the short quote a signal or a find carries: a lesson's example shows it
  withdrawn INTEGER NOT NULL DEFAULT 0,   -- its label was taken back (Undo, a newer label), not just expired
  offers INTEGER NOT NULL DEFAULT 0,   -- how many executor runs were asked for its text
  offered_at TEXT,
  status TEXT NOT NULL,            -- pending (waiting for its full text) | active | retired
  created_at TEXT NOT NULL,
  fetched_at TEXT,
  expires_at TEXT,
  note TEXT,
  UNIQUE (user_id, origin)
);
CREATE TABLE IF NOT EXISTS lessons (   -- what Fuzz learned from your corrections (learning/); projected
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,               -- the learner's stable name for it, like case:12
  surface TEXT NOT NULL,           -- where it's read: extract
  kind TEXT NOT NULL,              -- keep | skip (an example) | rule
  case_id INTEGER,                 -- the eval case it came from: never scored with it (leave-one-out)
  example TEXT,                    -- the message's outline and short quote, never its text (JSON)
  rule TEXT NOT NULL,              -- one plain sentence, for the page
  status TEXT NOT NULL,            -- proposed | active | off (you) | retired (its label was taken back)
  how TEXT NOT NULL,               -- inferred | confirmed
  created_at TEXT,
  confirmed_at TEXT,
  eval_run INTEGER,                -- the last eval run that scored it, and whether that run passed its gate
  eval_ok INTEGER
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  surface TEXT NOT NULL,
  skill_version TEXT,
  skill_copy TEXT,                 -- repo | installed
  client TEXT,
  model TEXT,
  repeats INTEGER NOT NULL,
  lessons TEXT NOT NULL,           -- the lesson set the run was given (JSON)
  results TEXT NOT NULL,           -- per case: passes, runs, outputs (JSON)
  against INTEGER,                 -- the run it was gated against: the last that passed, or --against
  gate_ok INTEGER NOT NULL         -- 1 when no case that passed there fails here
);
"""

JSON_COLS = {"quick_answers", "variant_tags", "schedule_anchor", "schedule_hints", "title_history",
             "options", "schedule_options", "payload", "answer", "detail", "attachments", "covers", "gaps", "meta", "alternatives", "example"}


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    if not s:
        return None
    if len(s) == 10:  # a bare date: end of that day, UTC
        s += "T23:59:00Z"
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def default_home():
    if os.environ.get("FUZZ_HOME"):
        return os.environ["FUZZ_HOME"]
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/Fuzz")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "fuzz")


def connect(home):
    os.makedirs(home, exist_ok=True)
    conn = sqlite3.connect(os.path.join(home, "fuzz.db"), timeout=30, isolation_level=None,
                           check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


MIGRATIONS = {"sources": [("path", "TEXT"), ("mime", "TEXT"), ("size", "INTEGER"), ("link", "TEXT")],
              "drafts": [("final", "INTEGER"), ("attachments", "TEXT"), ("reply_to", "INTEGER"), ("covers", "TEXT"),
                         ("meta", "TEXT")],
              "tasks": [("summary", "TEXT"), ("group_id", "INTEGER"), ("reviewed_at", "TEXT"), ("reviews", "INTEGER"),
                        ("reschedules", "INTEGER"), ("step_count", "INTEGER"), ("gaps", "TEXT"), ("find_out", "TEXT"),
                        ("pushes", "INTEGER"), ("missed_blocks", "INTEGER"),
                        ("deliverable_id", "INTEGER"), ("maybe_deliverable_id", "INTEGER"),
                        ("next_step", "TEXT"), ("session_id", "TEXT"), ("session_launch", "TEXT"), ("session_at", "TEXT"),
                        ("expires_at", "TEXT")],
              # the first eval tables went out without these (2026-11-11)
              "eval_cases": [("signal_key", "TEXT"), ("offers", "INTEGER NOT NULL DEFAULT 0"), ("offered_at", "TEXT"),
                             ("quote", "TEXT"), ("withdrawn", "INTEGER NOT NULL DEFAULT 0")],
              "eval_runs": [("against", "INTEGER"), ("gate_ok", "INTEGER NOT NULL DEFAULT 1")]}


def _migrate(conn):
    """Add columns that newer versions need to a store made by an older one. SCHEMA has every column too:
    MIGRATIONS only brings older stores up to it (tests/test_registries.py checks)."""
    for table, cols in MIGRATIONS.items():
        have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, typ in cols:
            if name not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {typ}")


def row_dict(row):
    """A row as a dict, with JSON columns decoded."""
    if row is None:
        return None
    d = dict(row)
    for k in JSON_COLS & d.keys():
        if isinstance(d[k], str):
            d[k] = json.loads(d[k])
    return d


class FuzzError(Exception):
    """A request the core refuses. `field` names what to fix, so a model can fix it in one try."""

    def __init__(self, message, field=None, status=400):
        super().__init__(message)
        self.field = field
        self.status = status

    def to_dict(self):
        d = {"error": str(self)}
        if self.field:
            d["field"] = self.field
        return d


class Core:
    """What every interface (HTTP, MCP, CLI) holds: the connection, the user, the clock and the run."""

    def __init__(self, home=None, user_id=None, clock=None):
        self.home = home or default_home()
        self.conn = connect(self.home)
        self.user_id = int(user_id or os.environ.get("FUZZ_USER") or 1)
        self.clock = clock
        self.run = None              # {"id", "client", "model", "prompt_version"} for AI callers
        self.renew = None            # (task_id, lease_until, mates): renew this lease (and a group claim's) on the next event about it
        self.lock = threading.RLock()
        self._depth = 0
        self._group = None
        self._actor = None
        self._next_ids = {}
        self._listeners = []
        self._memo = threading.local()   # .cache: {key: value} inside reading(), per thread
        if self.conn.execute("SELECT 1 FROM users WHERE id=?", (self.user_id,)).fetchone() is None:
            self.conn.execute("INSERT INTO users (id, name, created_at) VALUES (?,?,?)",
                              (self.user_id, None, self.now_iso()))

    # ---- time
    def now(self):
        return self.clock() if self.clock else datetime.now(timezone.utc)

    def now_iso(self):
        return iso(self.now())

    # ---- config
    @property
    def config(self):
        return config_mod.load(self.home)

    def save_config(self, cfg):
        config_mod.save(self.home, cfg)

    def update_config(self, fn):
        """fn(cfg) edits the latest config under a lock across processes; returns what fn returns."""
        return config_mod.update(self.home, fn)

    # ---- transactions: one command, one transaction, one undo group
    @contextmanager
    def tx(self, actor=None):
        with self.lock:
            outer = self._depth == 0
            if outer:
                self.conn.execute("BEGIN IMMEDIATE")
                self._group, self._next_ids = None, {}
                self._forget()   # a write: nothing read before it may be reused after
            prev_actor = self._actor
            if actor or outer:
                self._actor = actor
            self._depth += 1
            try:
                yield self
            except BaseException:
                self._depth -= 1
                self._actor = prev_actor
                if outer:
                    self.conn.execute("ROLLBACK")
                    self._group = None
                raise
            self._depth -= 1
            self._actor = prev_actor
            if outer:
                self.conn.execute("COMMIT")
                self._group = None
                self._forget()
                for fn in list(self._listeners):
                    fn()

    # ---- reads repeated within one request (GET /cards asks the same things for every card)
    @contextmanager
    def reading(self):
        """A stretch of reads (one request): memo() keeps each answer until it ends or anything is written."""
        outer = getattr(self._memo, "cache", None) is None
        if outer:
            self._memo.cache = {}
        try:
            yield self
        finally:
            if outer:
                self._memo.cache = None

    def memo(self, key, fn):
        """fn()'s value, made once per reading(); outside one, just fn(). Return values callers won't change."""
        cache = getattr(self._memo, "cache", None)
        if cache is None:
            return fn()
        if key not in cache:
            cache[key] = fn()
        return cache[key]

    def _forget(self):
        if getattr(self._memo, "cache", None) is not None:
            self._memo.cache = {}

    def on_commit(self, fn):
        self._listeners.append(fn)

    def new_id(self, table):
        """Next id for a projected table, safe within one transaction (BEGIN IMMEDIATE holds the write lock)."""
        if table not in self._next_ids:
            row = self.conn.execute(f"SELECT COALESCE(MAX(id), 0) m FROM {table}").fetchone()
            self._next_ids[table] = row["m"]
        self._next_ids[table] += 1
        return self._next_ids[table]

    def q(self, sql, args=()):
        return self.conn.execute(sql, args)

    def one(self, sql, args=()):
        return row_dict(self.conn.execute(sql, args).fetchone())

    def all(self, sql, args=()):
        return [row_dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def close(self):
        self.conn.close()


def current_user(core):
    return core.user_id
