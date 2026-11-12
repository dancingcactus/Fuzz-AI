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

- [ ] 2a. Undo hooks: `events.UNDO_HOOKS[type] = fn`, registered by `matching`, `memory.facts`, `evals`, `engine`
- [ ] 2b. A test that fails when a new upward import appears (baseline the current ones, ratchet down)
- [ ] 2c. Break `cards` → domain calls (card views take what they need, or hooks)

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

- [ ] 4a. Serve the vocabulary (states, card kinds, options, tags) from the core, generated into `js/vocab.js` like `demo-memory.js`
- [ ] 4b. Use the core's names in the UI; shrink `STATE` and `toItem`
- [ ] 4c. (Longer) run the demo on a scripted core instead of `store.js`

## 5. Smaller consistency items (verified)

- [ ] 5a. Schema in one place: seven `tasks` columns exist only in `db.MIGRATIONS` (fresh stores still get them)
- [ ] 5b. `Core.config` reads `config.json` on every access (about 60 reads); read it once per command
- [ ] 5c. One `app.background(fn)` for the three ad hoc daemon threads in `http_api.py` (lock, errors, notify)
- [ ] 5d. `events._current` doesn't filter by `user_id`, which `db.py` says every query does
- [ ] 5e. Split `js/view-triage.js` (2,146 lines) by card family
- [ ] 5f. A test calls the real `claude` CLI (`focus AI pass skipped: Command 'claude' timed out after 45 seconds`); stub it

## Order

1, then 3's registries (they make 2 and 4 easier), then 2's undo hooks and import test, then 4.
