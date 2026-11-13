"""`fuzz serve`: the HTTP API for UIs, the event stream, and the demo UI's static files.

Listens on 127.0.0.1 only. API calls need `Authorization: Bearer <token>` (or ?token= for
EventSource, which can't set headers); tokens.json in the store folder maps each token to a user.
Static files need no token: they are the UI.
"""

import json
import mimetypes
import os
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from . import actions, cards, config, drafts, engine, events, followups, groups, matching, people, scheduler, sessions, states, tasks
from .db import Core, FuzzError

UI_ROOT = Path(__file__).resolve().parents[2]  # the repo root: index.html, js/, css/, assets/
STATIC_DIRS = ("js", "css", "assets")
STATIC_PAGES = ("index.html", "artifact.html")
# A file Fuzz wrote that a browser would run as a page: served sandboxed, so its scripts get no origin
ACTIVE_TYPES = {"text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml"}
SSE_HEARTBEAT = 15
TICK_SECONDS = 60


def tokens_path(home):
    return os.path.join(home, "tokens.json")


def load_tokens(home):
    p = tokens_path(home)
    if not os.path.exists(p):
        return {}
    with open(p) as f:
        return json.load(f)


def ensure_token(home, user_id=1):
    """The token for a user, creating it the first time. The file is readable only by you."""
    toks = load_tokens(home)
    for t, uid in toks.items():
        if uid == user_id:
            return t
    t = secrets.token_urlsafe(24)
    toks[t] = user_id
    os.makedirs(home, exist_ok=True)
    with open(tokens_path(home), "w") as f:
        json.dump(toks, f, indent=2)
    os.chmod(tokens_path(home), 0o600)
    return t


def task_view(core, t, full=False):
    out = cards.task_summary(t)
    out["log_head"] = (events.task_log(core, t["id"], 1) or [None])[0]
    if t.get("deliverable_id"):   # its "For …" line
        d = core.one("SELECT id, title, tier, state FROM deliverables WHERE id=?", (t["deliverable_id"],))
        out["deliverable"] = d
    if t["state"] in ("review", "sending"):   # answered in one reply with another task of its group
        d = drafts.covering(core, t["id"])
        if d:
            out["covered_by"] = d["task_id"]
    if full:
        out["log"] = events.task_log(core, t["id"])
        # newest first, each with its own time: the message's, or else when the run that found it started
        out["sources"] = tasks.one_per_message(core.all(
                                  "SELECT s.id, s.role, s.title, s.withdrawn, COALESCE(s.link, g.link) link, g.quote, "
                                  "COALESCE(g.ts, r.started_at) ts, g.source || ':' || g.source_id msg, s.path IS NOT NULL has_file FROM sources s "
                                  "LEFT JOIN signals g ON g.key=s.signal_key AND g.user_id=s.user_id "
                                  "LEFT JOIN runs r ON r.id=s.added_run AND r.user_id=s.user_id "
                                  "WHERE s.task_id=? AND s.user_id=? AND COALESCE(s.signal_key, '') NOT LIKE 'capture:%' "
                                  "ORDER BY ts IS NULL, ts DESC, s.id DESC", (t["id"], core.user_id)))
        out["people"] = people.for_task(core, t)
        out["cards"] = [cards.view(core, c, t) for c in cards.open_cards(core, t["id"])]
        from . import files
        out["files"] = files.listing(core, t["id"])
        out["drafts"] = core.all("SELECT * FROM drafts WHERE task_id=? AND user_id=? ORDER BY id DESC",
                                 (t["id"], core.user_id))
        out["steps_used"], out["attempts"] = t["steps_used"], t["attempts"]
        out["merged_into"], out["parent_id"] = t["merged_into"], t["parent_id"]
    return out


class App:
    """Routes, shared by every request thread. One Core (and one lock) per user."""

    def __init__(self, home, clock=None):
        self.home = home
        self.clock = clock
        self._cores = {}
        self.send_kicked = {}
        self.gather_kicked = {}
        self.discovering = {}   # (user, client) -> {"state": running | error, "error"}
        self.refining = {}      # (user, focus phrase) -> True while its AI pass runs
        self.boot = f"{os.getpid()}-{int(time.time() * 1000)}"
        self._mu = threading.Lock()
        self.changed = threading.Condition()

    def core(self, user_id):
        with self._mu:
            if user_id not in self._cores:
                c = Core(self.home, user_id, clock=self.clock)
                c.on_commit(self._notify)
                self._cores[user_id] = c
            return self._cores[user_id]

    def _notify(self):
        with self.changed:
            self.changed.notify_all()

    def background(self, fn):
        """Slow work (a client run, an AI pass) off the request thread. It takes core.lock itself for what it
        writes; whatever happens, the event stream hears about it after."""
        def work():
            try:
                fn()
            except Exception as e:   # the work says its own expected failures; this is anything else
                print(f"background work failed: {e!r}")
            finally:
                self._notify()
        threading.Thread(target=work, daemon=True).start()

    def follow(self, core, follow):
        """Start what a command asked for (followups.run), slow work in the background."""
        followups.run(core, follow, self.gather_kicked, self.background)

    def user_for(self, token):
        uid = load_tokens(self.home).get(token or "")
        return int(uid) if uid else None

    # ---- routes: (method, regex) -> handler(core, match, body, query)
    def routes(self):
        R = [
            ("GET", r"/tasks", self.list_tasks),
            ("POST", r"/tasks", self.capture),
            ("GET", r"/tasks/search", self.search_tasks),
            ("GET", r"/tasks/(\d+)", self.get_task),
            ("POST", r"/tasks/(\d+)/(" + "|".join(actions.TASK_VERBS) + ")", self.task_action),
            ("GET", r"/lessons", self.list_lessons),
            ("POST", r"/lessons/(\d+)/(use|off)", self.lesson_action),
            ("GET", r"/deliverables", self.list_deliverables),
            ("POST", r"/deliverables", self.create_deliverable),
            ("GET", r"/deliverables/(\d+)", self.get_deliverable),
            ("POST", r"/deliverables/(\d+)/(tier|done|drop|rename)", self.deliverable_action),
            ("GET", r"/tasks/(\d+)/part_of", self.part_of_choices),
            ("POST", r"/tasks/(\d+)/part_of", self.part_of),
            ("GET", r"/tasks/(\d+)/same_as", self.same_as_choices),
            ("POST", r"/tasks/(\d+)/same_as", self.same_as),
            ("POST", r"/tasks/(\d+)/open", self.open_session),
            ("POST", r"/tasks/(\d+)/moments", self.add_moment),
            ("POST", r"/tasks/(\d+)/files", self.upload),
            ("DELETE", r"/tasks/(\d+)/files/(\d+)", self.remove_file),
            ("GET", r"/files/(\d+)", self.download),
            ("GET", r"/artifacts", self.list_artifacts),
            ("GET", r"/artifacts/(\d+)", self.get_artifact),
            ("GET", r"/artifacts/k(\d+)", self.get_memory_artifact),
            ("GET", r"/files/k(\d+)", self.download_memory_file),
            # memory (docs/memory-layers.md): the inspector (read-only), the person and term sheet, the ask box
            ("GET", r"/inspect", self.inspect_overview),
            ("GET", r"/inspect/entities", self.inspect_entities),
            ("GET", r"/inspect/entities/(\d+)", self.inspect_entity),
            ("GET", r"/inspect/facts/(\d+)", self.inspect_fact),
            ("GET", r"/inspect/why_not", self.inspect_why_not),
            ("GET", r"/inspect/knowledge", self.inspect_knowledge),
            ("GET", r"/inspect/decisions", self.inspect_decisions),
            ("GET", r"/inspect/runs", self.inspect_runs),
            ("GET", r"/inspect/runs/(\d+)", self.inspect_run),
            ("GET", r"/inspect/files", self.inspect_files),
            ("GET", r"/entities/(\d+)", self.entity_sheet),
            ("POST", r"/entities/(\d+)/facts", self.entity_edit),
            ("POST", r"/facts/(\d+)/(confirm|reject)", self.fact_action),
            ("POST", r"/ask", self.ask),
            ("DELETE", r"/artifacts/(\d+)", self.delete_artifact),
            ("GET", r"/setup", self.setup_get),
            ("POST", r"/setup/discover", self.setup_discover),
            ("PUT", r"/setup/tools", self.setup_tools),
            ("PUT", r"/setup/folder", self.setup_folder),
            ("POST", r"/setup/folder/choose", self.setup_choose_folder),
            ("POST", r"/setup/done", self.setup_done),
            ("GET", r"/onboarding", self.onboarding_get),
            ("PUT", r"/onboarding", self.onboarding_put),
            ("POST", r"/onboarding/setup/(lookup|folder|theme)", self.onboarding_setup),
            ("POST", r"/onboarding/kickoff", self.onboarding_kickoff),
            ("GET", r"/hours", self.hours_get),
            ("PUT", r"/hours", self.hours_put),
            ("GET", r"/deepwork", self.deepwork_get),
            ("GET", r"/slots", self.slots_get),
            ("PUT", r"/slots", self.slots_put),
            ("GET", r"/groups", self.list_groups),
            ("POST", r"/groups/(\d+)/(rename|take_out|wrap|finish_later)", self.group_action),
            ("GET", r"/cards", self.list_cards),
            ("POST", r"/cards/(\d+)/answer", self.answer),
            ("GET", r"/undo", self.undo_list),
            ("POST", r"/undo", self.undo),
            ("GET", r"/events", self.events_since),
            ("POST", r"/checkin", self.checkin),
            ("POST", r"/checkin/more", self.checkin_more),
            ("GET", r"/vips", self.vips_get),
            ("PUT", r"/vips", self.vips_put),
            ("GET", r"/focus", self.focus_get),
            ("GET", r"/focus/preview", self.focus_preview),
            ("POST", r"/focus", self.focus_set),
            ("POST", r"/screen", self.screen_time),
            ("GET", r"/screen", self.screen_times),
            ("POST", r"/signals/at_desk", self.at_desk),
            ("POST", r"/tick", self.tick),
            ("GET", r"/me", self.me_get),
            ("PUT", r"/me", self.me_put),
            ("GET", r"/engine", self.engine_get),
            ("PUT", r"/engine", self.engine_put),
            ("POST", r"/engine/check", self.engine_check),
            ("POST", r"/engine/run", self.engine_run),
            ("POST", r"/engine/clients/([\w-]+)/(install|update|repair|uninstall)", self.engine_action),
        ]
        return [(m, re.compile("^" + p + "$"), h) for m, p, h in R]

    def list_tasks(self, core, m, body, q):
        """Done and let-go tasks from the last two weeks only, unless ?all=1. Older ones come from /tasks/search."""
        days = None if q.get("all") == "1" else tasks.FINISHED_WINDOW_DAYS
        return {"tasks": [task_view(core, t) for t in tasks.list_tasks(core, q.get("state"), closed_days=days)],
                "max_working": scheduler.budget(core)["max_working"],
                "finished_window_days": tasks.FINISHED_WINDOW_DAYS,
                "finished_older": 0 if days is None else tasks.finished_older(core),
                "work_in": sessions.label(core)}

    def search_tasks(self, core, m, body, q):
        return {"tasks": [task_view(core, t) for t in tasks.search_finished(core, q.get("q"), q.get("limit") or 50)]}

    def capture(self, core, m, body, q):
        missed = bool(body.get("missed"))   # Fuzz missed this: it looks for the message whatever gathering is set to
        tid, gather, follow = actions.capture(core, body.get("text"), body.get("docs"), due=body.get("due"),
                                              missed=missed, uploading=bool(body.get("uploading")),
                                              deep_work=bool(body.get("deep_work")))   # typed in Deep Work
        self.follow(core, follow)
        return {"task_id": tid, "gathering": gather}, 201

    def get_task(self, core, m, body, q):
        return task_view(core, tasks.require(core, int(m.group(1))), full=True)

    def task_action(self, core, m, body, q):
        out, follow = actions.task_action(core, int(m.group(1)), m.group(2), body)
        self.follow(core, follow)
        return out

    def open_session(self, core, m, body, q):
        """Work in Claude (or Copilot, when that's the engine): a Terminal session started on the task."""
        return sessions.open_session(core, int(m.group(1)))

    def upload(self, core, m, body, q):
        """The raw file is the body: POST /tasks/14/files?name=budget.pdf with its Content-Type."""
        from . import files
        f = files.attach(core, int(m.group(1)), q.get("name"), body["_raw"], body.get("_type"))
        self.follow(core, actions.GATHER)
        return {"source_id": f["id"], "name": f["title"], "mime": f["mime"], "size": f["size"]}, 201

    def remove_file(self, core, m, body, q):
        from . import files
        files.detach(core, int(m.group(1)), int(m.group(2)))
        return {"removed": int(m.group(2))}

    def download(self, core, m, body, q):
        """An attachment or a file Fuzz saved in your output folder: GET /files/<source id>?token=…"""
        s = core.one("SELECT * FROM sources WHERE id=? AND user_id=? AND role IN ('attachment','output') "
                     "AND path IS NOT NULL AND withdrawn=0", (int(m.group(1)), core.user_id))
        if s is None or not os.path.isfile(s["path"]):
            raise FuzzError(f"No file {m.group(1)}", "source_id", 404)
        return {"_file": s["path"], "_name": os.path.basename(s["path"]), "_type": s["mime"]}

    def list_artifacts(self, core, m, body, q):
        """What Fuzz wrote in your output folder, for the Artifacts tab, with the Knowledge/ files (no task; their
        source_id is k<id>). folder is null when there's none."""
        from . import outputs
        from .memory import briefs
        arts = outputs.artifacts(core) + [_memory_view(f) for f in briefs.files(core)]
        return {"folder": outputs.folder(core), "artifacts": sorted(arts, key=lambda a: a["updated_at"], reverse=True)}

    def get_memory_artifact(self, core, m, body, q):
        from .memory import briefs
        f = briefs.get_file(core, int(m.group(1)))
        if f is None:
            raise FuzzError(f"No file k{m.group(1)}", "source_id", 404)
        return _memory_view(f)

    def download_memory_file(self, core, m, body, q):
        from .memory import briefs
        f = briefs.get_file(core, int(m.group(1)))
        if f is None:
            raise FuzzError(f"No file k{m.group(1)}", "source_id", 404)
        return {"_file": f["path"], "_name": os.path.basename(f["path"]), "_type": "text/markdown"}

    # ---- memory: the inspector is read-only (no events, no fact_views, no files)
    def inspect_overview(self, core, m, body, q):
        from .memory import inspect
        return inspect.overview(core)

    def inspect_entities(self, core, m, body, q):
        from .memory import inspect
        return inspect.entities_list(core, q.get("type") or None, q.get("q") or None, q.get("state") or None, q.get("at") or None)

    def inspect_entity(self, core, m, body, q):
        from .memory import inspect
        return inspect.entity_detail(core, int(m.group(1)), q.get("at") or None)

    def inspect_fact(self, core, m, body, q):
        from .memory import inspect
        return inspect.fact_detail(core, int(m.group(1)), q.get("at") or None)

    def inspect_why_not(self, core, m, body, q):
        from .memory import inspect
        try:
            a, b = int(q.get("a")), int(q.get("b"))
        except (TypeError, ValueError):
            raise FuzzError("a and b are entity ids", "a")
        return inspect.why_not(core, a, b)

    def inspect_knowledge(self, core, m, body, q):
        from .memory import inspect
        return inspect.knowledge_list(core)

    def inspect_decisions(self, core, m, body, q):
        from .memory import inspect
        return inspect.decisions_list(core)

    def inspect_runs(self, core, m, body, q):
        from .memory import inspect
        return inspect.runs_list(core)

    def inspect_run(self, core, m, body, q):
        from .memory import inspect
        return inspect.run_detail(core, int(m.group(1)))

    def inspect_files(self, core, m, body, q):
        from .memory import inspect
        return inspect.files_state(core)

    def entity_sheet(self, core, m, body, q):
        """A person or term sheet: what Fuzz knows, with sources and trust. Opening it counts as seeing its facts."""
        from .memory import facts, recall
        e = facts.require_entity(core, int(m.group(1)))
        return recall._entity_answer(core, facts.follow(core, e["id"]), surface="sheet")

    def entity_edit(self, core, m, body, q):
        """Edit on the sheet: you say what it is, a confirmed fact that Undo can take back."""
        from .memory import facts
        fid = facts.edit(core, facts.follow(core, int(m.group(1))), body.get("attr"), body.get("value"))
        return {"fact_id": fid}, 201

    def fact_action(self, core, m, body, q):
        from .memory import facts
        (facts.confirm if m.group(2) == "confirm" else facts.reject)(core, int(m.group(1)))
        return {"fact_id": int(m.group(1)), "done": m.group(2)}

    def ask(self, core, m, body, q):
        """The ask box: a headless run of the read-only ask role answers, as memory.answered on the event stream."""
        from .memory import recall
        question = (body.get("question") or "").strip()
        if not question:
            raise FuzzError("question is what you want to know", "question")
        if len(question) > 500:
            raise FuzzError("question is at most 500 characters", "question")
        if not config.role_engine(core.config, "ask")[0]:
            raise FuzzError("Fuzz needs Claude Code or Copilot to answer. Set one up in Settings › Engine.", "engine", 409)
        ask_id = recall.new_ask_id()
        engine.run_now(core, "ask", ask=(ask_id, question))
        return {"ask_id": ask_id}, 202

    def get_artifact(self, core, m, body, q):
        """One file's name, type and task, for the viewer (artifact.html). The bytes come from /files/<id>."""
        from . import outputs
        a = outputs.artifact(core, int(m.group(1)))
        if a is None:
            raise FuzzError(f"No file {m.group(1)}", "source_id", 404)
        return a

    def delete_artifact(self, core, m, body, q):
        """Delete a file Fuzz wrote. It moves to your Trash rather than being erased."""
        from . import outputs
        outputs.delete(core, int(m.group(1)))
        return {"deleted": int(m.group(1))}

    # ---- setup: who you are, the tools Fuzz can use, the output folder
    def setup_get(self, core, m, body, q):
        from . import setup
        out = setup.state(core, check=q.get("check") != "0")
        for t in out["tools"]:
            t["discovery"] = self.discovering.get((core.user_id, t["client"]))
        return out

    def setup_discover(self, core, m, body, q):
        """Starts one run of the client that lists its tools; poll GET /setup for the result."""
        from . import adapters
        client = body.get("client")
        adapters.get(client)
        key = (core.user_id, client)
        if (self.discovering.get(key) or {}).get("state") == "running":
            return {"started": False, "state": "running"}, 202
        self.discovering[key] = {"state": "running", "error": None, "started_at": time.time()}

        def work():
            from . import connectors
            try:
                connectors.discover(core, client, body.get("model"))
                self.discovering.pop(key, None)
            except Exception as e:   # shown on the setup screen
                self.discovering[key] = {"state": "error", "error": str(e)}
        self.background(work)
        return {"started": True, "state": "running"}, 202

    def setup_tools(self, core, m, body, q):
        """{client, read?, send?}: the tools Fuzz may use, as the setup screen lists them (their allow names)."""
        from . import connectors
        return connectors.choose(core, body.get("client"), body.get("read"), body.get("send"))

    def setup_folder(self, core, m, body, q):
        from . import setup
        return setup.set_folder(core, body.get("folder"))

    def setup_choose_folder(self, core, m, body, q):
        """Opens the Mac's folder chooser and waits for you: {start?} -> {path} (null if you cancelled).
        Runs without the store's lock, so the rest of the API keeps answering meanwhile."""
        from . import setup
        return {"path": setup.choose_folder(body.get("start"))}

    def setup_done(self, core, m, body, q):
        from . import setup
        return setup.finish(core, body.get("done", True))

    # ---- the onboarding: where you are in it, your working hours, the setup cards after it
    def onboarding_get(self, core, m, body, q):
        from . import onboarding
        return onboarding.view(core)

    def onboarding_put(self, core, m, body, q):
        from . import onboarding
        return onboarding.update(core, body)

    def onboarding_setup(self, core, m, body, q):
        """{answer: yes | not_now} on the setup card named in the path."""
        from . import onboarding
        return onboarding.answer_setup(core, m.group(1), body.get("answer"))

    def onboarding_kickoff(self, core, m, body, q):
        """The end of the onboarding: Fuzz's own task, "Let me find your asks", in Triage. Made once."""
        from . import onboarding
        return onboarding.kickoff(core), 201

    def hours_get(self, core, m, body, q):
        from . import onboarding
        return onboarding.hours(core)

    def hours_put(self, core, m, body, q):
        """{hours: [from, until] | null, weekends}: when Fuzz reads for new asks. null is no fixed hours."""
        from . import onboarding
        return onboarding.set_hours(core, body)

    def add_moment(self, core, m, body, q):
        """A described date you know yourself: {label, at, key?, cancelled?}."""
        from . import timeres
        tid = int(m.group(1))
        if not isinstance(body.get("label"), str):
            raise FuzzError("label is required, like “Before the leadership meeting”", "label")
        anchor = {"type": "moment", "label": body["label"], "at": timeres.local_iso(core, body.get("at")),
                  "key": body.get("key") or timeres.moment_key(body["label"]), "cancelled": bool(body.get("cancelled"))}
        label = scheduler.suggest_schedule(core, tid, anchor, body.get("reason"), actor="human")
        return {"task_id": tid, "label": label, "key": anchor["key"]}, 201

    # ---- lessons: what Fuzz learned from your corrections (learning/)
    def list_lessons(self, core, m, body, q):
        from . import learning
        return {"lessons": learning.listing(core)}

    def lesson_action(self, core, m, body, q):
        from . import learning
        lid, what = int(m.group(1)), m.group(2)
        (learning.use if what == "use" else learning.turn_off)(core, lid)
        return {"lesson": learning.get(core, lid)}

    # ---- deliverables: named outcomes served by tasks from any channel
    def list_deliverables(self, core, m, body, q):
        from . import deliverables
        rows = core.all("SELECT * FROM deliverables WHERE user_id=? ORDER BY state='open' DESC, tier='active' DESC, id",
                        (core.user_id,)) if q.get("all") == "1" else deliverables.open_ones(core)
        return {"deliverables": [deliverables.view(core, d) for d in rows],
                "active_max": deliverables._cfg(core)["active_max"]}

    def get_deliverable(self, core, m, body, q):
        from . import deliverables
        return deliverables.view(core, deliverables.require(core, int(m.group(1))))

    def create_deliverable(self, core, m, body, q):
        from . import deliverables
        ids = body.get("task_ids") or []
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            raise FuzzError("task_ids is a list of task ids", "task_ids")
        did = deliverables.create(core, body.get("title"), body.get("done_when"), ids, body.get("checked_by") or "fuzz",
                                  body.get("for"), body.get("due"), body.get("tier") or "background")
        return deliverables.view(core, deliverables.get(core, did)), 201

    def deliverable_action(self, core, m, body, q):
        from . import deliverables
        did, act = int(m.group(1)), m.group(2)
        d = deliverables.require(core, did)
        if act == "tier":   # swap an active one from its sheet, any day
            deliverables.set_tier(core, did, body.get("tier"))
        elif act == "done":
            deliverables._close(core, d, "done", (body.get("evidence") or "You said it's done.").strip()[:300], "human")
        elif act == "drop":
            deliverables._close(core, d, "dropped", None, "human")
        else:
            title = (body.get("title") or d["title"]).strip()[:deliverables.TITLE_MAX]
            done_when = deliverables.check_done_when(body.get("done_when") or d["done_when"])
            with core.tx("human"):
                ch = events.Changes()
                ch.deliverable(did, title=title, done_when=done_when, checked_by=body.get("checked_by") or d["checked_by"])
                events.emit(core, "deliverable.renamed", changes=ch, data={"deliverable_id": did, "from": d["title"], "to": title})
        return deliverables.view(core, deliverables.get(core, did))

    def part_of_choices(self, core, m, body, q):
        from . import deliverables
        return {"choices": deliverables.choices(core, int(m.group(1)))}

    def part_of(self, core, m, body, q):
        """{deliverable_id}: "Part of…" from task detail; null takes it out again."""
        from . import deliverables
        tid = int(m.group(1))
        if body.get("deliverable_id") is None:
            deliverables.unlink(core, tid)
        elif isinstance(body["deliverable_id"], int):
            deliverables.link(core, tid, body["deliverable_id"])
        else:
            raise FuzzError("deliverable_id is the deliverable this task is part of, or null", "deliverable_id")
        return task_view(core, tasks.require(core, tid))

    def same_as_choices(self, core, m, body, q):
        """The open tasks this one is most likely the same as, for "Same as…" in task detail."""
        from .matching import dupes
        return {"choices": dupes.same_as_choices(core, int(m.group(1)))}

    def same_as(self, core, m, body, q):
        """{other_id}: this task is the same as that one, so it merges into it. Undo splits it back out."""
        if not isinstance(body.get("other_id"), int):
            raise FuzzError("other_id is the task this one is the same as", "other_id")
        from .matching import dupes
        tid = int(m.group(1))
        if tasks.require(core, tid)["state"] not in states.LIVE:
            raise FuzzError("Only an open task can be merged", "task_id", 409)
        dup = next((c for c in cards.open_cards(core, tid) if c["kind"] == "duplicate" and c["other_id"] == body["other_id"]),
                   None)
        if dup and len(dupes.card_dupes(core, dup)) > 1:   # it asks about others too: it stays, on the next one
            dup = None
        mid = matching.merge(core, tid, body["other_id"], card=dup)
        return {"task_id": tid, "into": tasks.live(core, tid)["id"], "merge_id": mid}

    def list_groups(self, core, m, body, q):
        return {"groups": groups.list_groups(core, None if q.get("all") == "1" else tasks.finished_cutoff(core))}

    def group_action(self, core, m, body, q):
        gid, act = int(m.group(1)), m.group(2)
        if act == "rename":
            groups.rename(core, gid, body.get("title"))
        elif act == "take_out":
            if not isinstance(body.get("task_id"), int):
                raise FuzzError("task_id is the task to take out", "task_id")
            groups.take_out(core, gid, body["task_id"])
        elif act == "finish_later":   # you stopped partway: Fuzz goes ahead with the answers it has
            line = groups.finish_later(core, gid)
            self.follow(core, [{"kind": "group_run"}])
            return dict(groups.view(core, groups.require(core, gid)), collected=line)
        else:
            groups.wrap(core, gid)
        return groups.view(core, groups.require(core, gid))

    def list_cards(self, core, m, body, q):
        """group_run: the group you're working through, so the UI can show its band (see groups.run)."""
        from . import focus, priority
        front = int(q["front"]) if (q.get("front") or "").isdigit() else None   # the card on screen stays first
        with core.reading():
            cur = groups.run(core)
            return {"cards": [cards.view(core, c, t) for c, t in cards.queue(core, front)],
                    "moment": cards.moment(core), "energy": priority.energy(core),
                    "focus": focus.current(core), "focus_chips": focus.chips(core),
                    "group_run": {"group_id": cur["group_id"], "tasks": cur["tasks"]} if cur else None,
                    "work": core.config.get("work")}

    def answer(self, core, m, body, q):
        if "option" not in body:
            raise FuzzError("option is required", "option")
        out, follow = actions.answer_card(core, int(m.group(1)), body["option"], body.get("value"))
        self.follow(core, follow)
        return out

    def undo_list(self, core, m, body, q):
        return {"recent": events.undo_list(core)}

    def undo(self, core, m, body, q):
        return actions.undo(core, body.get("group"))

    def events_since(self, core, m, body, q):
        return {"events": events.since(core, int(q.get("after") or 0), min(int(q.get("limit") or 200), 1000))}

    def checkin(self, core, m, body, q):
        """The UI asked how you're doing: {answer, follow_up?}. It decides when to ask; the core keeps the answer."""
        from . import checkins
        return checkins.record(core, body.get("answer"), body.get("follow_up")), 201

    def checkin_more(self, core, m, body, q):
        """"Sure, just a few more": one level up, and some of what a check-in held comes back."""
        from . import checkins
        return checkins.more(core), 201

    def vips_get(self, core, m, body, q):
        """Your manager and a few more people whose asks come first (docs/energy-and-priority.md)."""
        v = core.config.get("vips") or {}
        return {"manager": v.get("manager") or "", "people": list(v.get("people") or [])}

    def vips_put(self, core, m, body, q):
        """{manager?, people?}: a name, email or Slack ID each; what's given replaces what is there."""
        manager, people = body.get("manager"), body.get("people")
        if manager is not None and not isinstance(manager, str):
            raise FuzzError("manager is a name, email or Slack ID", "manager")
        if people is not None and (not isinstance(people, list) or not all(isinstance(p, str) for p in people)):
            raise FuzzError("people is a list of names, emails or Slack IDs", "people")
        if people is not None and len([p for p in people if p.strip()]) > 10:
            raise FuzzError("Keep it to a few people: ten at most", "people")

        def put(cfg):
            v = cfg.setdefault("vips", {})
            if manager is not None:
                v["manager"] = manager.strip()
            if people is not None:
                v["people"] = [p.strip() for p in people if p.strip()]
        core.update_config(put)
        return self.vips_get(core, m, body, q)

    # ---- Focus: what you're working on this session
    def focus_get(self, core, m, body, q):
        """The session's focus, and the chips the session question offers."""
        from . import focus
        return {"focus": focus.current(core), "chips": focus.chips(core)}

    def focus_preview(self, core, m, body, q):
        """What a phrase would match right now (the instant pass), before you confirm. It also starts the AI
        pass in the background, so it's often done by the time you press Enter."""
        from . import focus
        text = (q.get("q") or "").strip()
        out = focus.match(core, text)
        if text and not out["quick"]:
            self.refine_soon(core, text)
        return out

    def focus_set(self, core, m, body, q):
        """{text, task_ids?} or {skip: true}. The queue reorders at once; the AI pass refines it later."""
        from . import focus
        cur = focus.set_focus(core, body.get("text"), body.get("task_ids"), skip=bool(body.get("skip")))
        if cur and cur.get("text") and not cur.get("quick"):
            self.refine_soon(core, cur["text"])
        return {"focus": cur}

    def refine_soon(self, core, text):
        """One AI pass per phrase at a time, off the request thread."""
        from . import focus
        key = (core.user_id, focus.norm(text))
        if self.refining.get(key) or not config.role_engine(core.config, "executor")[0]:
            return False
        self.refining[key] = True

        def work():
            try:
                focus.ai_pass(core, text, lock=core.lock)
            finally:
                self.refining.pop(key, None)
        self.background(work)
        return True

    def screen_time(self, core, m, body, q):
        """The UI says how long a card was on screen and how long you were away meanwhile: {card_id?, task_id?,
        mode: sort|work, shown_at, left_at?, away_s?, how?}. Kept for tuning the stuck thresholds; not an event."""
        if not isinstance(body.get("shown_at"), str):
            raise FuzzError("shown_at is when the card came on screen (ISO time)", "shown_at")
        if body.get("mode") not in (None, "sort", "work"):
            raise FuzzError("mode is sort or work", "mode")
        rid = core.q("INSERT INTO screen_times (user_id, card_id, task_id, mode, shown_at, left_at, away_s, how) "
                     "VALUES (?,?,?,?,?,?,?,?)", (core.user_id, body.get("card_id"), body.get("task_id"), body.get("mode"),
                                                  body["shown_at"], body.get("left_at"), int(body.get("away_s") or 0),
                                                  (body.get("how") or "")[:40] or None)).lastrowid
        return {"id": rid}, 201

    def screen_times(self, core, m, body, q):
        return {"times": core.all("SELECT card_id, task_id, mode, shown_at, left_at, away_s, how FROM screen_times "
                                  "WHERE user_id=? ORDER BY id DESC LIMIT ?", (core.user_id, min(int(q.get("limit") or 200), 2000)))}

    def at_desk(self, core, m, body, q):
        return {"came_back": scheduler.wake(core)}

    def tick(self, core, m, body, q):
        return scheduler.tick(core)

    def deepwork_get(self, core, m, body, q):
        """For starting a Deep Work session: when your free time ends (the next meeting), or null."""
        from . import booking
        return {"free_until": booking.free_until(core)}

    def slots_get(self, core, m, body, q):
        return {"slots": scheduler.budget(core)["max_working"], "max": scheduler.MAX_SLOTS}

    def slots_put(self, core, m, body, q):
        """{slots}: how many tasks Fuzz may work on at once, 1 to scheduler.MAX_SLOTS."""
        scheduler.set_slots(core, body.get("slots"))
        return self.slots_get(core, m, body, q)

    def me_get(self, core, m, body, q):
        return {k: core.config["me"].get(k, []) for k in config.ME_KEYS}

    def me_put(self, core, m, body, q):
        """{names?, emails?, slack_ids?}: each list given replaces what is there."""
        for k, v in body.items():
            if k not in config.ME_KEYS or not isinstance(v, list):
                raise FuzzError("Send names, emails and slack_ids, each a list", k)
        if not body.get("emails", True):
            raise FuzzError("Keep at least one email address", "emails")
        core.update_config(lambda cfg: config.update_me(cfg, replace=body))
        return self.me_get(core, m, body, q)

    def engine_get(self, core, m, body, q):
        """?start=0 skips starting each client's MCP servers: quick, for the onboarding's app choice."""
        return engine.get(core, check_start=q.get("start") != "0")

    def engine_check(self, core, m, body, q):
        return engine.get(core, refresh=True)

    def engine_put(self, core, m, body, q):
        if not body.get("client"):
            raise FuzzError("client is required", "client")
        return {"engine": engine.select(core, body["client"], body.get("model"))}

    def engine_run(self, core, m, body, q):
        role = body.get("role", "executor")
        if role not in ("executor", "extractor", "sender"):
            raise FuzzError("role must be executor, extractor or sender", "role")
        return engine.run_now(core, role, body.get("task_id"), bool(body.get("scripted"))), 202

    def engine_action(self, core, m, body, q):
        return engine.action(core, m.group(1), m.group(2), body.get("roles"), bool(body.get("link")))


def _memory_view(f):
    """A Knowledge/ file as the Artifacts tab lists it: no task, so it's under Fuzz's memory."""
    try:
        size = os.path.getsize(f["path"])
    except OSError:
        size = None
    return {"source_id": f"k{f['id']}", "name": os.path.basename(f["path"]), "mime": "text/markdown", "size": size,
            "kind": "markdown", "role": "memory", "updated_at": f["updated_at"], "memory": f["kind"],
            "task": {"id": None, "title": "Fuzz’s memory", "state": None}}


def make_handler(app):
    routes = app.routes()

    class Handler(BaseHTTPRequestHandler):
        server_version = "Fuzz/0.1"

        def log_message(self, fmt, *args):
            if os.environ.get("FUZZ_HTTP_LOG"):
                super().log_message(fmt, *args)

        def _send(self, status, obj, headers=None):
            data = json.dumps(obj, default=str).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def _send_file(self, res):
            with open(res["_file"], "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", res.get("_type") or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", "inline; filename*=UTF-8''" + quote(res["_name"]))
            self.send_header("X-Content-Type-Options", "nosniff")
            if (res.get("_type") or "").split(";")[0].strip() in ACTIVE_TYPES:   # opened on its own, it can't reach your token
                self.send_header("Content-Security-Policy", "sandbox")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _token(self, q):
            h = self.headers.get("Authorization") or ""
            return h[7:].strip() if h.lower().startswith("bearer ") else q.get("token")

        def _dispatch(self, method):
            url = urlparse(self.path)
            q = {k: v[-1] for k, v in parse_qs(url.query).items()}
            path = url.path.rstrip("/") or "/"
            if method == "GET" and path == "/health":
                # boot changes when the server restarts, so a page can tell an install restarted it
                return self._send(200, {"ok": True, "boot": app.boot})
            if method == "GET" and path == "/events/stream":
                return self._stream(q)
            for m, rx, h in routes:
                mt = rx.match(path)
                if mt and m == method:
                    uid = app.user_for(self._token(q))
                    if uid is None:
                        return self._send(401, {"error": "A valid token is required", "field": "Authorization"})
                    try:
                        core = app.core(uid)
                        body = self._raw_body(core) if h == app.upload else self._body()
                        if h == app.setup_choose_folder:   # waits on you, and touches no store
                            res = h(core, mt, body, q)
                        else:
                            with core.lock:
                                res = h(core, mt, body, q)
                        status = 200
                        if isinstance(res, tuple):
                            res, status = res
                        if isinstance(res, dict) and "_file" in res:
                            return self._send_file(res)
                        return self._send(status, res)
                    except FuzzError as e:
                        return self._send(e.status, e.to_dict())
                    except (ValueError, KeyError, TypeError) as e:
                        return self._send(400, {"error": f"Bad request: {e}"})
            if method == "GET":
                return self._static(path)
            if any(rx.match(path) for _, rx, _ in routes):
                return self._send(405, {"error": f"{method} isn't allowed on {path}"})
            return self._send(404, {"error": f"No route {path}"})

        def _raw_body(self, core):
            from . import files
            n = int(self.headers.get("Content-Length") or 0)
            limit = files.limits(core)[0]
            if n > limit:
                raise FuzzError(f"The file is over {limit // (1024 * 1024)} MB", "body", 413)
            return {"_raw": self.rfile.read(n) if n else b"", "_type": self.headers.get("Content-Type")}

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            raw = self.rfile.read(n)
            try:
                body = json.loads(raw)
            except ValueError:
                raise FuzzError("The body must be JSON", "body")
            if not isinstance(body, dict):
                raise FuzzError("The body must be a JSON object", "body")
            return body

        def _static(self, path):
            rel = "index.html" if path == "/" else path.lstrip("/")
            if rel not in STATIC_PAGES and rel.split("/")[0] not in STATIC_DIRS:
                return self._send(404, {"error": f"No route {path}"})
            p = (UI_ROOT / rel).resolve()
            if UI_ROOT not in p.parents or not p.is_file():
                return self._send(404, {"error": f"No file {path}"})
            data = p.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(str(p))[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")   # the UI changes with the core; never run an old copy
            self.end_headers()
            self.wfile.write(data)

        def _stream(self, q):
            uid = app.user_for(self._token(q))
            if uid is None:
                return self._send(401, {"error": "A valid token is required", "field": "token"})
            last = int(self.headers.get("Last-Event-ID") or q.get("after") or 0)
            reader = Core(app.home, uid, clock=app.clock)   # its own connection, so it never waits on writers
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            beat = time.time()
            try:
                while True:
                    evs = events.since(reader, last, 200)
                    for e in evs:
                        self.wfile.write(f"id: {e['id']}\nevent: {e['type']}\ndata: {json.dumps(e)}\n\n".encode())
                        last = e["id"]
                    if evs:
                        self.wfile.flush()
                        continue
                    if time.time() - beat > SSE_HEARTBEAT:
                        self.wfile.write(b": still here\n\n")
                        self.wfile.flush()
                        beat = time.time()
                    with app.changed:   # woken by writes in this process; polls for other processes (MCP, CLI)
                        app.changed.wait(timeout=1.0)
                    if q.get("once"):
                        return
            except (BrokenPipeError, ConnectionResetError):
                return
            finally:
                reader.close()

        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

        def do_PUT(self):
            self._dispatch("PUT")

        def do_DELETE(self):
            self._dispatch("DELETE")

    return Handler


def kick_sender(app, core, now=None):
    """The sender soon after you approve a draft (followups.kick_sender), throttled per app."""
    return followups.kick_sender(core, app.send_kicked, now)


def kick_executor(app, core, now=None, wait=None):
    """The executor as soon as a task waits to be gathered (followups.kick_executor), throttled per app."""
    return followups.kick_executor(core, app.gather_kicked, now, wait)


def _ticker(app, stop):
    while not stop.wait(TICK_SECONDS):
        for uid in set(load_tokens(app.home).values()):
            core = app.core(int(uid))
            try:
                with core.lock:
                    scheduler.tick(core)
                    kick_sender(app, core)
                    kick_executor(app, core, wait=followups.GATHER_RETRY_SECONDS)
            except Exception as e:   # the clock must keep going
                print(f"tick failed for user {uid}: {e}")


PRESENCE_SECONDS = 30


def presence_check(app, watcher, idle):
    """One look at the idle time. Returns the number of tasks that came back."""
    if not watcher.check(idle):
        return 0
    n = 0
    for uid in set(load_tokens(app.home).values()):
        core = app.core(int(uid))
        with core.lock:
            n += scheduler.wake(core)
    return n


def _presence(app, stop):
    from . import presence
    cfg = app.core(1).config.get("presence") or {}
    if not cfg.get("enabled", True) or presence.idle_seconds() is None:
        return   # not a Mac, or the idle time can't be read: fuzz wake still works
    watcher = presence.Watcher(cfg.get("away_minutes", 15))
    while not stop.wait(PRESENCE_SECONDS):
        try:
            presence_check(app, watcher, presence.idle_seconds())
        except Exception as e:
            print(f"presence check failed: {e}")


def make_server(home, host="127.0.0.1", port=8765, clock=None, ticker=True):
    app = App(home, clock)
    ensure_token(home, 1)
    srv = ThreadingHTTPServer((host, port), make_handler(app))
    srv.daemon_threads = True
    srv.app = app
    srv.stop_ticker = threading.Event()
    if ticker:
        threading.Thread(target=_ticker, args=(app, srv.stop_ticker), daemon=True).start()
        threading.Thread(target=_presence, args=(app, srv.stop_ticker), daemon=True).start()
    return srv

