# Self-improving Fuzz: design and build plan

How Fuzz learns from the corrections Justin already makes, without new chores and without drifting. Every
correction is already an event or a `feedback` row. This plan turns them into **lessons** (data Fuzz reads
before it acts) and **eval cases** (a golden set that every change to a skill or a lesson is scored on).

## Choices made

| Choice | Decision | Why |
| --- | --- | --- |
| What learning changes | Lessons and config first. Skill text changes only through the weekly retro, with a yes | Lessons are data: visible, undoable, scoped |
| When learners run | In a batch (a launchd role), not on every event | Simpler, replayable, matches the other roles |
| Evals | Collected from day one, before any learner ships | A learner without evals can't be told from drift |
| Eval input | The full message, re-fetched only when a correction is recorded (option a) | A signal's `quote` is extraction's own summary; scoring on it flatters extraction. Tasks keep thin records |
| Where eval cases live | An `eval_cases` table outside the event log, like `feedback` | Snapshots expire; `rebuild()` must never depend on them |
| Lessons Fuzz infers | Wording lessons go live after agreeing evidence; anything that changes what gets sent or dropped waits for a yes | Rule 4: an inferred fact never drives an action |

## Shape: signals, learners, surfaces

Three separate pieces, so each grows on its own.

1. **Signals**: events, `feedback` rows and eval cases. A new signal is a new event type, feedback kind or
   case origin.
2. **Learners**: one module each in `core/fuzz/learning/learners/`, found by a registry. Each names its
   surface and a key prefix, and `learn(core)` returns the lessons it wants now; `learning.run` adds,
   retires and restores to match. Learners read, never write.

   ```python
   LEARNER = Learner(name="examples", surface="extract", prefix="case:")
   ```

3. **Surfaces**: where lessons are read. `learning.lessons_for(core, surface)` and `learning.render` build
   the text, for a real run and for the evals alike. A new surface is one call where a prompt is built.

A lesson is an example (keep or skip: a message's outline and short quote) or a one-sentence rule, with
`status` (proposed, active, off, retired), `how` (inferred, confirmed), the `case_id` it came from, and the
last eval run that tried it. It changes only through `lesson.*` events, so Undo and `rebuild()` cover it.

The "What I've learned" section groups lessons by kind and knows nothing about any one learner.

## Evals

### Cases

`eval_cases`: `id`, `surface`, `kind` (`keep` | `skip`), `input` (the message as the extractor saw it:
sender, people, channel or title, and its `text`, re-fetched and capped near 4 KB), `expected`
(`{has_my_ask, ask?}`), `origin` (`seed:<name>` or `feedback:<id>`, one case each), `status` (`pending` |
`active` | `retired`), `fetched_at`, `expires_at` (90 days for real cases; seeds don't expire), `note`.

- **Skip**: Not a task. Undoing that answer retires the case.
- **Keep**: every missed task you confirm. The label is yours and true whatever extraction did; why it was
  missed (never read, judged FYI, unclear or someone else's, or had as yours) is a note, from matching the
  find to the stored signals by `source_id` or link. Matching never decides whether a case exists: two
  model runs name a message their own way, and a missed match would silently lose the example.
- **Not cases**: a task let go within 24 hours (weak label).
- A case is `pending` until the executor re-fetches the full message, and only `active` cases are scored.

Why extraction missed something is read from the signals table, not guessed: no signal means never seen;
a signal with no `me` candidate means judged FYI; one owned by someone else means judged someone else's.

### Scoring

- `fuzz eval run` runs only the judgment step (extract skill step 4) through the client's plain call
  (`adapter.discovery_command`, as `focus.py` uses).
- Rules come from the live `SKILL.md`; lessons come from the same render function the real run uses.
- Each run records the skill version, which copy (repo or installed), the lesson set, client and model.
- Each case runs 3 times and passes on a majority. Results are shown per case.
- The gate: no case that passed in the baseline fails now. The baseline is the last run that passed its own
  gate (or `--against <run>`), never just the run before, so two bad runs in a row both fail. Each run
  records what it was gated against; `fuzz eval run` exits 1 when the gate fails.
- An ask counts as the person's the way the matcher reads it: `owner` `me` or none. `unclear` doesn't.
- Copilot's default model is recorded as null; pass `--model` when comparing runs across model changes.
- Leave-one-out: a case is never scored with its own lesson, keyed on the case id (a never-read miss has
  no signal key).

### Proving it on the simple example

- Nine invented seed cases in `core/fuzz/eval_seeds/extract.json` (`fuzz eval seed`): clear asks, FYIs,
  someone else's asks, "can someone…" to a big list, a buried ask, a meeting action item, the person's own
  invite and their own commitment. Each carries its own invented identity.
- A stubbed test of the plumbing: collection, leave-one-out, retiring on Undo, recorded runs.
- A test that the harness can fail: a bad lesson ("everything from Priya is FYI") must turn a pass into a
  fail.
- One live baseline run on the seed cases before any lesson exists.

## Build order

1. **Eval harness on seed cases** (built): `eval_cases` and `eval_runs`, the seeds, `fuzz eval
   seed|cases|run|show` (`core/fuzz/evals.py`), lesson scoping and rendering (`core/fuzz/learning/`), and
   `core/tests/test_evals.py`. `fuzz eval run --lessons file.json` scores a lesson set before the store exists.
   Baseline on 2026-11-11, extract-0.16 on Copilot: 9 of 9 at 3/3. With the bad lesson: the Priya DM fell to
   0/3 and was reported as a regression; the other eight held.
2. **Skip cases from Not a task** (built): answering Not a task on an "Is this yours?" card makes the
   message a pending skip case (`evals.from_not_task`), one per message, and none when another ask from it
   is still yours or you typed the task. The executor gets it in `whoami`'s `messages_to_fetch` and sends
   the text with `submit_eval_text` (executor-0.20), or `cant_fetch`, which retires the case. A case
   waiting more than a day starts an executor run by itself, at most once a day; after 3 offers without
   its text, or once Fuzz has no record of the message, it's retired. Undo retires it. Retiring or expiring
   a case drops its text.
   - A message counts as holding an ask of yours when extraction made a `me` candidate from it, whatever
     became of that task; such a message makes no case.
   - These cases are strict: an `unclear` ask fails them, because "Is this yours?" is what you corrected.
     The seeds aren't: "can someone…" may stay unclear.
3. **Missed tasks** (built): there's no new control. You add an ordinary task saying Fuzz missed an ask
   ("Find Dana's email about the venue contract, you missed it"); the executor (executor-0.21) recognises
   it, searches, and calls `report_missed` with the message, or `not_found`. The text goes straight into
   an `unconfirmed` case, never into an event, card or brief; the card carries a short quote. "Is it this
   one?" (`missed.py`): That's the one makes the case active, retitles the task to the ask, links the
   message, retires any Not a task case on the same message, and lets the task go if Fuzz already had the
   ask as yours. Not that one sends Fuzz to look again with what you said, up to two finds. Keep it as I
   wrote it ends the search. Undo of a yes puts the case back on the card. `fuzz capture --missed` tags
   one up front, for testing.
4. **Lessons** (built): a `lessons` table that changes only through events (`lesson.added`, `.retired`,
   `.restored`, `.used`, `.turned_off`, `.scored`), so Undo and replay cover it. Learners live in
   `core/fuzz/learning/learners/`, one file each, found by a registry; `learning.run` reconciles what they
   want with the table on every tick (SQL only) and with `fuzz learn`. A lesson you turned off never comes
   back; one whose label was taken back is retired, and restored if the label returns.
   - The first learner, `examples`, makes one lesson per labelled message, not per-sender counts: a
     confirmed miss is a keep example, active at once; a Not a task message is a skip example, proposed
     until you say Use it. An example is the message's outline and short quote, never its text.
   - The extract surface: the extractor's `whoami` carries `lessons`, rendered by `learning.render` as
     quoted data, and the extract skill (extract-0.18) says how to use them inside step 4, so the evals
     score that text too. Evals give every case every active lesson but its own (`--with-proposed` adds the
     proposed ones), as a real run does, and each scored lesson remembers its last run and gate result.
     A lesson whose run failed its gate can't be used.
   - Settings has "What I've learned": Asks I missed and What isn't a task, each with Use it or Turn off.
   - Live on Copilot (2026-11-11, extract-0.18): a Priya-only bad lesson given to every message failed only
     her DM. An all-staff IT reminder marked Not a task failed 0/3 without lessons and passed 3/3 with one
     IT example, with no other case worse.

## Later

Each is a learner, a surface or a role on the shape above. Each should add its own eval cases.

### Learners

- **Draft edits.** Compare the draft with what was sent. Wording becomes a style lesson (global or per
  person); a wrong fact becomes a memory correction. Active after 2–3 agreeing edits. Surface: `draft`
  (the executor's draft prompt). Eval: the context and the sent version.
- **Matcher tuning.** Duplicate answers, merges, splits and kept-separate entities, stored with the
  matcher's score at the time. `core/scripts/tune_matcher.py` sweeps the thresholds in
  `matching/dupes.py` for precision and recall. Manual first; a proposal card past about 50 labels.
- **Handback causes.** The executor tags each handback `access`, `context`, `judgement` or `ambiguous`.
  Access: ask for the grant at claim. Context: a candidate memory question. Judgement: this kind stays
  Justin's and stops being pre-filled as Assign.
- **Suggestion acceptance.** Per card type, how often the pre-filled option is taken over 30 days. Below
  30% with one dominant override, switch the pre-fill and say so once. A lesson can be marked "don't learn
  this".
- **Time and energy.** Booked blocks against what happened, estimates against time to done, check-in
  answers against what got finished. A multiplier per task kind for Book time, and queue order by what
  gets done on which energy. Never shown as a score.
- **Memory questions that pay off.** Rank the two daily questions by how many recent mistakes their
  answers would have prevented (context handbacks, rejected facts, entity checks).
- **Source trust.** Correction rate per `said_by` and `source_kind`; `authority_for` drops a source one
  level past a minimum count.
- **Not-a-task priors per source.** A running rate of real tasks per sender or channel. Low-rate sources
  arrive as a lighter "Looks like FYI, keep it?" card, never silently dropped. A confirmed miss corrects
  the rate.
- **Coverage.** A miss extraction never saw suggests a channel or folder to add to extraction.

### Roles and pages

- **Weekly retro.** A launchd role reads the week's lessons, rejections and handbacks and proposes one or
  two skill or config changes as cards in Fuzz's voice, with the diff behind "Show me" and the eval
  result on the card. Approval bumps the skill version; `doctor` updates installed copies. It may propose
  only changes that pass the gate.
- **"What I've learned".** Grouped as How I write, What I skip, Who to trust, When you work best. Each
  lesson shows its evidence and can be edited, turned off or deleted. New lessons are mentioned once from
  the Triage perch, never as a toast.

### Guardrails

- No shame: never "you corrected me 14 times". Fuzz owns its misses.
- Lessons and skill text are versioned together, so `doctor` doesn't fight learned lessons.
- Learning never drops anything silently; it changes how strongly something arrives.
