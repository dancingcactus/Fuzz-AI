# Architecture review (2026-11-12)

A review of `core/` and `js/` for consistency and maintainability. `spikes/` is out of scope.
Each item says whether it was **verified** (traced in the code) or **inferred**, and is ticked when done.

What's already sound: every change to a projected table goes through `events.emit` (no writes
around it), replay is checkable (`fuzz rebuild --check`), top-level imports form a clean graph, and
the core has about 600 tests.

## 1. The interfaces wire their own side effects (verified)

The core README says HTTP, MCP and the CLI "can't drift apart", but they have:

- Three tables of task verbs: `http_api.task_action` (11 verbs), `cli.cmd_task_action` (8) and
  `answers._task_answer` (card options, with different names: `drop`, `someone_else`).
- Only `http_api.answer` knows the onboarding kickoff routing, the `allow_once` to `always_allow`
  rewrite on kickoff cards, and which answers start the executor (`schedule`, `wait`,
  `keep_waiting`, `nudge`, `find_out`, a collected group). `fuzz answer` skips all of it.
- "Start a run now" is decided in seven places in `http_api.py`, plus `mcp_server.py` and
  `onboarding.py`.

**Fix.** Domain calls report what should start (`follow-ups`); one dispatcher runs them; every
interface calls the same entry point.

- [x] 1a. Kickoff routing and the `allow_once` rewrite moved out of `http_api.answer` into `actions.answer_card`
- [x] 1b. Commands return follow-ups (`actions.py`); `followups.run` starts them for HTTP, the CLI and MCP
- [x] 1c. One task-verb table (`actions.TASK_VERBS`) behind `POST /tasks/{id}/<verb>` and `fuzz task`
- [ ] 1d. The UI still starts runs itself after Assign, Hand to Fuzz, Nudge and Unclear (`kick` in
  `js/live.js`, through `POST /engine/run`). Moving those into `actions` means changing `live.js` in the
  same release, or the executor starts twice; the running `fuzz serve` needs a restart first.
- [ ] 1e. Card answers and task verbs name the same moves differently (`drop`/`letgo`,
  `someone_else`/`theirs`). Both are public (the UI sends them), so aligning them is item 4's job. The
  task card's answers are now a table (`answers.TASK_ANSWERS`, 3c) beside `actions.TASK_VERBS`.

Done in 1a–1c (`core/fuzz/actions.py`, `core/fuzz/followups.py`, `core/tests/test_actions.py`):

- `fuzz answer` applies the kickoff rules and starts the runs the server starts for an answer (gather,
  find out, group run, the kickoff's discovery). The runs the browser starts itself (1d) still don't.
- `fuzz capture` and `fuzz attach` start the gather the way the routes do.
- `fuzz task` takes every HTTP verb (it gained `theirs`, `back` and `find_out`), and `wait`, `schedule` and
  `reopen` now behave as over HTTP: the gathering plan, instructions, the `returning` tag, `--value front|back`.
  `--value` is the verb's text, an anchor for `schedule`, or a JSON object of the request body.
- The task route's verbs come from `actions.TASK_VERBS`, so a new verb can't 404.
- Left as they are: `POST /engine/run` and the ask box call `engine.run_now` directly (they are the request
  to start a run), and `onboarding._complete` starts the first extractor read itself.

## 2. 34 core modules form one import cycle (verified)

The cycle is made entirely of function-local imports (240 of them, 61 in `http_api.py`); with
top-level imports only there is none. Low layers call up: `cards` into `tasks`, `drafts`, `focus`,
`booking`, `memory`; `tasks` into `booking`, `sessions`, `missed`, `files`; `events.undo` into
`matching`, `memory.facts`, `evals`, `engine`. Dropping only the `events` edges shrinks it to 26.

Layers to aim for: `db`/`config` → `events`/`states` → domain (`tasks`, `cards`, `drafts`, `groups`…)
→ orchestration (`answers`, `scheduler`) → interfaces (`http_api`, `mcp_server`, `cli`).

- [x] 2a. Undo's side effects are `actions.UNDO_HOOKS` (merge side tables, entity tables, eval cases, the
  missed message's link, the engine choice), passed to `events.undo`, which now requires them: a caller
  can't undo without them by mistake. `actions.undo` is the command (`POST /undo`, `fuzz undo`, the tests).
  The hooks aren't registered on import, since one whose module wasn't loaded would silently not run.
  `events` now imports only `db`; the cycle went from 34 modules to 26 plus 2, as `events`, `connectors`,
  `evals`, `installer`, `learning` and `runs` dropped out.
- [x] 2b. `core/tests/test_layers.py`: the foundation (`config`, `db`, `states`, `events`) imports nothing
  above it, nothing below imports the top (`actions`, `followups`, the interfaces), and no module joins an
  import cycle (`CYCLE_BASELINE`, which must be trimmed when one leaves). Checked by planting an upward
  import in `db.py`: two failures, naming it.
- [ ] 2c. **Deferred** (2026-11-12, in favour of item 4). The 28 modules still in cycles are one tightly knit domain layer. Simulated
  cuts: moving the card view and queue out of `cards` changes nothing (28); `cards` importing nothing above
  it takes out only `cards` (27); the biggest single lever, `tasks` importing nothing, leaves 20. Shrinking
  it means a redesign (say, `cards.sync` driven by events rather than called from every command), not a
  cleanup. Recommended: accept the domain cycle, guarded by 2b, and spend the effort on item 4.

## 3. Adding a card kind or a projected table means editing many places in step (verified)

- A card kind: `FAMILY`, `OPTIONS`, `SUGGESTED`, `PROMPTS` (`cards.py`), `SAFE`, `HANDLERS`
  (`answers.py`), and the JS mappings. Each handler parses `value` (dict or string) by hand.
- A projected table: `TABLES`, a `Changes` helper, `DECISIVE`, `_absent` (`events.py`), and `db.py`.

- [x] 3a. `cards.CARD_KINDS`: one `CardKind` per kind (family, prompt, options, suggested, safe answer,
  scheduled), replacing `FAMILY`, `OPTIONS`, `SUGGESTED`, `PROMPTS`, `SCHEDULED` and `answers.SAFE`. A task
  card's options come from one ordered table, `cards.TASK_VARIANTS`. What answers do stays in
  `answers.HANDLERS` (a higher layer), and a test checks it covers exactly the registered kinds.
- [x] 3b. `events.TABLES`: one `Table` per projected table (key, decisive fields, what a missing row
  becomes), replacing `DECISIVE` and `_absent`. Tests check each has a `Changes` helper and schema columns.
- [x] 3c. `answers._dict`, `_field` and `_text` read an answer's `value`; the task card's ~30-option `if`
  chain is the table `answers.TASK_ANSWERS`, with a test that every option a task card can offer has an
  entry. One fix: text that isn't one of a handback's quick answers raised `AttributeError` (a 400 saying
  "'str' object has no attribute 'get'"); it's now the intended error on `value`.

Checked by dumping every old table, `task_options()` for each variant and `options()` for each kind before
the change and comparing after: identical. `booking`'s two option lists moved into `cards`, but `cards`
still imports `booking` in `view()`, so the import cycle is unchanged (item 2).

## 4. The frontend implements the domain a second time (verified)

`js/store.js` is a full demo state machine (its own states, a simulated `tick`); `js/live.js` wraps
about 40 of its methods to mirror each one to the core and translates names (`STATE`, `toItem`,
about 20 `tags.indexOf` checks). Several Store methods mean one core action (`done`/`markDone`,
`letGo`/`drop`, `approve`/`accept`/`nudgeSent`, `reopen`/`bringBack`/`replied`), and the kickoff
rule lives here too (`KICKOFF_ASK`). One action is spelled five ways: state `letgo`, option `drop`,
function `let_go`, event `task.let_go`, JS `letGo`. Only `schedule.js` has UI tests.

- [x] 4a. `js/vocab.js`, generated by `core/scripts/make_vocab.py`: task states, card kinds with their answers,
  every task-card answer and variant list, task verbs, memory card kinds. `core/tests/test_vocab.py` fails
  when it's out of date and checks `index.html` loads it before `live.js`. It describes the checkout, not
  the server a page talks to, so what gates an answer at run time is still each card's own `options`.
  Variant tags aren't in it: the core has no full list (`cards.TRIAGE_TAGS` is only the triage ones, and
  `toItem` also reads `gather`, `kickoff`, `woke`, `theirs`).
- [x] 4b-i. The contract: `tests/ui/vocab.test.mjs` (Node built-ins, `node --test vocab.test.mjs`) checks every
  option and fallback verb `live.js` sends through `decide()`, and every button in its `QUESTION` and
  `KICKOFF_ASK` tables, is one the core accepts for that card. All requests to the core go through
  `live.js`. Checked by planting a bad option, verb and button: each test failed, naming it. `live.js`'s
  copy of the memory kinds now reads the vocabulary.
- [x] 4b-ii. The UI uses the core's state names: `ai` is `working` and `ai-queued` is `queued` (43 lines in 8
  files), and `live.js`'s `STATE` is down to `merged` → `resolved`. Checked in the browser: the demo's
  Lineup, assigning from Triage (by click and by `Store.assign`), and live mode against a throwaway store,
  where a task the core holds as `queued` reached the UI as `queued` and showed as Next up; no console
  errors. Left alone: `source: 'ai'` in `schedule.js` (where a time suggestion came from, not a state), and
  the UI's own `resolved`, `dropped` and `mine`, which have no core state (answered question cards, the
  "with you" lane): changing those is a model change, not a rename.
- [ ] 4c. **Needs a decision; not a refactor.** Running the demo on a scripted core would remove `store.js`'s
  copy of the rules, but the demo's promise is that it runs by opening `index.html`, with no server, and the
  core is Python. The ways to do it each change that promise: the demo needs `fuzz serve` (a scripted,
  throwaway store), or the core runs in the browser (Pyodide, a large download). Until then, the contract
  test (4b-i) and shared names (4b-ii) keep the two from drifting silently.

## 5. Smaller consistency items (verified)

- [x] 5a. The seven `tasks` columns that only `db.MIGRATIONS` had are in `SCHEMA` now, with what each holds;
  `MIGRATIONS` only brings older stores up to it, and a test fails when a column is added there alone.
- [x] 5b. **No change, on measurement.** Reading `core.config` costs about 20 µs; one `GET /cards` with five cards
  reads it 30 times (0.6 ms). Callers also edit the dict they get and save it, which relies on a fresh copy
  each time, so a cache would add risk for nothing measurable.
- [x] 5c. `App.background(fn)` is the one way `http_api.py` runs slow work off the request thread: the follow-ups,
  setup's tool discovery and the focus AI pass. It prints anything unexpected and always tells the event
  stream after. The ticker and presence loops stay their own long-lived threads.
- [x] 5d. The projection reads and writes rows by `id` *and* `user_id` (`events._current`, `events.apply`), so an
  event for one user that names another's row fails loudly instead of changing it (a test checks).
- [ ] 5e. **Deferred.** Every large section of `view-triage.js` uses 8–20 of the 40-odd variables shared across the
  file and calls 6–18 functions in other sections (Wiring: 26 and 31), so a split means designing an
  explicit state object first, in a view with no tests. Do a browser smoke test of Triage first (the way
  `tests/ui/schedule.test.mjs` drives the Later panel), then split along the existing section headings.
- [x] 5f. **Not a problem; my mistake in the review.** The "Command 'claude' timed out after 45 seconds" line is
  `test_focus.py` raising `TimeoutExpired` itself to test the timeout path; no real `claude` runs and the
  module takes a second.

## 6. Found while working (added 2026-11-12)

- [x] 6a. **Config edits can no longer be lost between processes.** `config.update(home, fn)` (and
  `core.update_config(fn)`) takes an exclusive lock on `config.lock`, re-reads `config.json`, applies `fn` and
  writes it, so a change made by `fuzz serve`, the CLI or a launchd run in the meantime is kept. All 16 save
  sites use it. The installer's first-install and uninstall checks, and `set_engine`'s "prior", now happen
  under the lock, and `fuzz setup` asks its questions before taking it. `config.save` takes the same lock and
  writes through a temp file unique to the process and thread. `core/tests/test_config_writes.py` covers
  overlapping updates (two threads, and another process) and 20 writers at once; without the lock, three of
  its four tests fail. The lock is `fcntl.flock`: macOS and Linux; Windows would need another kind of lock.
- [ ] 6b. **Triage loads each card's task separately (measured).** `GET /cards` runs about three queries per card:
  the task (`SELECT * FROM tasks`), its schedule anchor, and a `user_state` value, from `cards.queue` and
  `cards.view`. With plain task cards: 5 cards 24 statements (1.8 ms), 20 cards 69 (6.7 ms), 80 cards 249
  (26 ms). Small today, but the live UI reloads `/cards` after every change and event. Fix: load the open
  cards' tasks in one query and read `user_state` once per request, then pass them in.

## Order

1, then 3's registries (they make 2 and 4 easier), then 2's undo hooks and import test, then 4. Then 6a (it can lose a setting you chose), then 6b.
