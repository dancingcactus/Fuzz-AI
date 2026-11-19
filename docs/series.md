# Series: the bigger things you're working on

Status: first version built (2026-11-18), on branch `worktree-series-page-mockup`. Worked out in
conversation the same day, with a UI mockup and two detection spikes run against a copy of real data
(`spikes/series-page/`). This doc holds the requirements, what the spikes taught us, how the build meets
them ("Built"), and what comes next. Where the mockup and this doc differ, this doc wins.

## Goal

Some work is bigger than a task or a deliverable: a customer engagement, a spec, a launch, a transition.
Fuzz should notice these on its own, keep their work together, and use them to **suggest new tasks**
("Next in Northwind: send the recap"). You never have to define one, but you can ask Fuzz to start one,
and you can correct anything it got wrong.

The design doc for memory (`docs/memory-layers.md`) left "workstreams" for later. This is that, renamed.

## Vocabulary

- **Series** is the word, in copy and in code (`series` table, `series_id`). It sits next to Lineup in
  Fuzz's TV-flavoured naming. "Channel" was rejected (Slack channels, and email/Slack/meetings as
  channels); "Storyline" was the runner-up.
- A series' icon is a **clipboard** (with two list lines), wherever one shows: the Fuzz menu, the New task
  + menu and the series picker. Not a TV: that reads as Fuzz himself.
- Repeating calendar events are **recurring meetings**, never "series".
- On a task the noun stays out of sight: **"Part of Northwind"**, like "From …" and "For …".
- An ongoing area of responsibility (the product you own, a customer account in general, your team, a
  standing duty) is an **area**. Areas are not series (see "Implied end") and are internal: the word never
  appears in the UI.

## Where a series sits

| | Group | Deliverable | Series |
| --- | --- | --- | --- |
| Is | Tasks from one origin | One outcome with a done-when | A body of work with several parts, over weeks |
| Made by | The core, from the signal | Fuzz suggests, you confirm | Fuzz infers it; you can start one |
| Ends | Its tasks close | Its done-when is true | It has an implied end; done-when if known; dormant when quiet |

A deliverable belongs to at most one series; a series holds many. A task has at most one **primary**
series and may **also touch** others (see "Primary and also touches").

## Requirements

### 1. No setup required

- Fuzz infers series from your work as it arrives. Nothing asks you to create one first.
- An inferred series is used quietly (ranking, suggestions) before you ever see it. You meet it when Fuzz
  has something to say about it.

### 2. The record

A series is an **entity** (`type = 'series'`), so it gets aliases, identifiers and facts with trust for
free, plus a small projected `series` row for its lifecycle, so Undo and replay work.

- Lifecycle: `forming` → `inferred` → `named` (you accepted or renamed it) → `dormant` / `wrapped` /
  `dropped`. `origin` is `inferred` or `asked`. A `muted` switch stops suggestions without dropping it.
- Events: `series.formed`, `.inferred`, `.named`, `.linked`, `.unlinked`, `.merged`, `.split`,
  `.area_marked`, `.dormant`, `.wrapped`. Candidates are derived, not events.
- `memory_links.kind = 'series'` where the memory doc reserved "workstream".

### 3. Anchors: how Fuzz spots it

Anchors are the series entity's identifiers: topics and terms, ticket keys and projects, Slack channels,
docs and folders, recurring meetings, email lists, and words you add. They join new work to a series
without AI.

- An anchor counts only when at least 2 of the series' tasks carry it.
- **Documents support a series but never start one** (see Learned).
- You can **correct, remove (with Undo) and add** anchors on the series sheet. A removed anchor isn't
  suggested again. Before saving, Fuzz shows what the change would have caught.

### 4. Facts the AI captures

Allowlisted, each with `how`, `authority`, `said_by` and `source_ref`, trust worked out when read:

| Attr | Example | Half-life |
| --- | --- | --- |
| `goal` | Get Northwind onto always-on testing | 90 days |
| `your_role` | drive / contribute / follow | 60 days |
| `owner` | a person, when it isn't you | 60 days |
| `for` | a customer or team | 120 days |
| `status` | Waiting on Northwind legal's review | 7 days |
| `blocked_on` | a person or thing, with since when | 7 days |
| `next_milestone` | Pilot go-live, Jan 15 | until the date |
| `cadence` | Weekly sync Tuesdays · status note Fridays | 30 days, refreshed while seen |
| `scope_out` | Northwind's billing migration | set by you |
| `done_when` | NW-342 is accepted and Northwind confirms in writing | 180 days |

- `status` is rewritten **only on a real change** (the extractor's same-or-different judgment), never on
  every run.
- `your_role` gets a card the first time Fuzz names a series ("I'm driving it · I'm helping · Just keeping
  up · Not a series ▾"). Skipping it means helping. Start with that one card and see how it goes.
- `done_when` is captured **only when one is available**: you say it, someone with authority states it, or
  a deliverable is clearly the finish line. Never invented. Same rubric and checking as a deliverable's
  done-when (`docs/fuzz-core-design.md`, Deliverables). When true, the series wraps with Undo and the
  evidence line. New work on a wrapped series asks "Start season 2?".
- Not captured: copies of message text, opinions about people, a stored priority.

### 5. Implied end

A series must have an **implied end**: it could be finished, wrapped or handed off, even if nobody knows
when. That is weaker than a done-when, which stays optional. The judge decides it; anything without one
is an area.

### 5a. Areas: kept, never shown

Areas are a real internal concept (an entity with its anchors and the judge's reason), but they never
appear in the UI. They earn their keep in five ways:

1. **A memory of "no".** Their anchors stop proposing new series, so the judge isn't asked the same
   question every run (the replay showed what that costs).
2. **Context for the judge.** Candidates arrive with "this sits inside an area: …", so a bounded effort
   inside your product reads as a series and the product itself doesn't.
3. **Weighting.** An area's anchors count for less when scoring, the way regular people do in matching.
4. **Memory.** "What you own" helps recall, briefs and the extractor understand your work.
5. **Somewhere to put orphans.** Tasks in no series can be grouped by area for Fuzz's own reasoning.

Rules that keep a hidden decision from going wrong silently:

- An area **never takes tasks**. It only stops its own anchors from seeding; a task in an area can still
  join a series through its other anchors, and a series can form inside an area.
- **You always win.** Starting a series yourself, or keeping one from "Fuzz is watching", overrides an
  area that covers its anchors, and the judge sees that correction next time.
- **Areas get a second look.** When a cluster inside an area keeps growing (say it doubles since it was
  ruled an area), it goes back to the judge, who can split out a series.
- Areas are visible in the memory inspector, for debugging, not in the app.

### 5b. Primary and also touches

- A task's **primary** series is event-sourced and sticky. Only the primary counts: open/done counts, the
  "Part of …" line, wrapping, and suggestion rate limits.
- A task **also touches** any other series whose anchors it matches above the attach threshold. This is
  **worked out when read**: not stored, no events, no judge calls, so it corrects itself as anchors change.
- Also touches is used for: detector evidence (stall, follow-through, done-when at risk), Focus ("Work on
  …" brings it in), merging forming pieces, cross-series hints ("This unblocks Northwind too"), and a quiet line
  on the sheet ("Also touches this: 3 tasks from …").
- A near tie between two series no longer needs the judge: the higher score is primary, the other is
  also touches. Swapping them is the correction.
- Why: a third of real tasks (79 of 271) fit more than one candidate; forcing one choice fragmented a
  real series and left detectors blind to work filed elsewhere.

### 6. Detection, as things come in

Detection runs per ingest run, not as a batch. It mirrors matching: cheap stages first, a judgment only
when unsure. Each run:

1. **Attach (no AI).** A task not in a series is scored against each series' anchors (rarity-weighted). A
   clear winner links it; a near tie (second best within 60%) becomes a judge item.
2. **Seed (no AI).** An anchor index updates as signals arrive. Topics, terms, tickets and channels on 3 or
   more free tasks propose a candidate; heavily overlapping candidates merge. A candidate that passes the
   rules becomes a judge item, shown with the existing series nearest to it.
3. **Judge (AI, one call per run, only when there are items).** For a candidate: `new` (name, implied
   end), `join` an offered series, `split` into named parts, `area`, or `wait`. For a near tie: `attach`
   to an offered series, or none. It may only use ids and task numbers it was given; anything else is
   refused.

**Rules for a series:** at least 4 tasks, from at least 2 origins, active on at least 3 different days.
These numbers are starting points, not settled values. Keep them, and the other detection thresholds (the
60% near-tie margin, the 3-task seed), as named settings in one place so they're easy to adjust as the
system gets tuned, rather than spread through the code as literals.

**Stability:** membership is sticky. The judge only ever sees new candidates and ambiguous tasks, never the
whole set again. A series you named or approved is never changed without you.

**Forming series:** a split part too small to stand is kept as `forming`, with its name. It collects
matching tasks without AI and becomes a series by itself once it passes the rules. Its parent cluster
isn't asked about again until it grows.

**Where it runs:** after matching in `submit_signals` (attach and seed), with judge items handed to the
extractor through the same pending-judgment path the matcher uses. Feature weights reuse the matcher's
ideas: rarity, and people too regular to count (`PERSON_REGULAR`).

### 7. Starting one yourself

There is no separate "Start a series" dialog. **New task** gets a **+** (like Triage's composer +):
Series, Person, Source, Artifact, Upload a file.

- Series → find one ("Your series"), pick one Fuzz is already watching, or **Start a new series from
  this**. Your note becomes the seed; Fuzz gathers the tasks, people and anchors that go with it.
- The new series then waits for your OK in two places: a **Triage card** (your part, tasks with
  checkboxes and one unsure task explained, anchors as removable chips, done-when, people;
  **Looks right · Adjust on its sheet · Not a series ▾**) and the **New** section of the Series page.

### 8. Surfaces

- **Series page** in the Fuzz-head menu, directly under Lineup ("What you're in the middle of").
  Sections: New · Going · Gone quiet · Fuzz is watching (inferred, not met yet: Keep it / Not a series) ·
  Wrapped. Each card: name, your role, status with its source, done-when, next milestone, one "Next in …"
  suggestion, counts, people, **Work on …**.
- **Series sheet:** Next in … (suggestions), What Fuzz knows (facts with trust labels, editable), Open work
  with **Add a task to …** (goes to Triage already in the series; or move one you have), Deliverables,
  Decided, People, How Fuzz spots it (editable). Its actions are one split button like every other dialog's:
  **Work on … ▾** (or **Rename ▾** with nothing open), the rest behind the arrow, and Keep it beside it while
  Fuzz is only watching.
- **Split it into parts** (in that menu): when one series is really several (one evaluation across three
  customers), name each part and pick where each task goes; a task whose title says a part's name goes there by
  itself. Each part becomes a named series (origin `split`) with your part copied over, and a name of three
  words or fewer becomes a word anchor so new work that says it lands there. Tasks put in no part stay; if none
  stay, the original is dropped. One `series.split` event (data `from`, `parts`, `kept`), so one Undo.
  `record.split`, `POST /series/<id>/split {parts: [{name, task_ids}]}`.
- **Work on …** sets Focus to the series.

### 9. Suggesting new tasks

The point of all this. Detectors over a series' timeline (tasks, decisions, knowledge, calendar, people):

- **Decision with no follow-through:** a decision about it was logged, but no task or sent message acts on it.
- **Prep:** an event tied to it is coming and there's no prep task.
- **Stall:** active, nothing moved in N days, someone owes you a reply → a nudge.
- **Usual next step:** mined from its own history (needs evals first).
- **Deliverable or done-when at risk:** a date is near and the evidence isn't there → the missing step.

A suggestion is a card with its reason ("No one has followed up on Tuesday's decision to …"):
**Add it · I'll do it · Not needed**. Rate-limited per series per week, hottest series first (active
deliverable, current focus, recent activity). "Not needed" feeds `lessons`; outcomes become eval cases.
`your_role` gates them: driving gets next steps, helping only your parts, keeping up only asks that land on you.

## Learned from the spikes (2026-11-18)

Both spikes ran read-only on a `sqlite .backup` of the live store: 271 tasks over about three weeks.

### Batch pass (`detect.py`)

- **Linking tasks pairwise chains everything.** Joining any two tasks that share enough features made one
  cluster of 186 tasks, held together by shared wiki pages and tickets. Clusters must start from anchors.
- **Hub documents fake a series.** One weekly status page pulled 17 unrelated tasks together. Status and
  program pages link to everything, hence "documents support, never start".
- **"At least 14 days" was wrong.** Real work comes in bursts: a 10-task spec happened in 7 days.
  "Active on 3 or more days" keeps those and still stops a single afternoon's flurry.
- **Names fragment one body of work.** The same spec came back as "Experimentation Plan" and "Experiment
  Plans"; one product came back as four series. Folding plurals isn't enough; it takes a judgment.
- **Your whole job looks like a series.** The product you own passed every count. An implied end is the
  test that removes it.
- **Overlap is common.** 79 of 271 tasks fit more than one candidate.
- **Bots look like people.** `[bot]` accounts are excluded.

### Adding the judge

One tools-free call through the configured client (as Focus's AI pass does), over 42 candidates:
merges were right (spec ×2, goals ×3, triage tooling ×2), names were plain and specific, and the implied-
end test removed exactly the areas: the product itself, retention, weekly reporting, scheduling, a product
area, routine repo maintenance. It used no unknown ids and skipped none. 20 candidates became 15 series.

It also **dropped a mixed cluster** whose parts were real (a product validation effort mixed with two
customer engagements). That's why the judge can split.

### Streaming replay (`stream.py`)

Day-by-day replay, one judge call per day with items:

- **First version:** the judge re-split the same clusters every day (one 10 times, another 8; 46 of 55
  verdicts were splits), because small parts weren't remembered. An area absorbed 22 tasks, including real
  roadmap and goals work. → Forming series; areas don't take tasks.
- **Fixed version:** 12 series, 14 model calls over 21 days, 36 judge items, 24 tasks attached and 5 series
  formed without AI. The mixed cluster split cleanly into its two real series. Most of the batch series
  appeared, on plausible days.
- **Still wrong:** an early split on thin evidence fragmented a 13-task customer engagement into small
  forming pieces that can't merge back, and the same happened to two others. The judge never chose
  `wait`.

## Built

Code is in `core/fuzz/series/`, one module per job:

| Module | What it does |
| --- | --- |
| `settings.py` | Every number above (the rules, the 60% near tie, the 3-task seed, weights, suggestion limits), with defaults. Tune them in `config.json` under `"series"`, e.g. `{"series": {"min_tasks": 5}}` |
| `index.py` | The anchor index, worked out from the store when needed: each task's anchors, rarity weights, scores, also touches, the rules |
| `record.py` | The record and its lifecycle: make, link/unlink, name, drop (or ongoing → area), mute, anchors (add, remove, restore, preview), wrap, season 2, merge, dormant/wake, the done-when check |
| `detect.py` | Detection as things come in: attach, forming → series, seed, an area's second look, forming series that stall; the judge's items and verdicts |
| `ask.py` | Starting one yourself (gather from a note) and the four cards: `series_new`, `series_role`, `series_next`, `series_season` |
| `suggest.py` | The detectors (follow-through, prep, stall, at risk), rate limits, role gating, the clock's share |
| `views.py` | What the Series page, the sheet, a task's "Part of …" line and the "Part of…" picker show |

How it's wired:

- `submit_signals` runs detection after matching, and `submit_verdicts` runs it again after the asks it
  judged became tasks.
- Judge items reach the extractor as `series_items` on every `get_pending_judgments` page. Verdicts come
  back in the same `submit_verdicts` list (`{series_item, action, …}`), and an id the item didn't give is
  refused with the field to fix. The extractor skill says how to judge them, including "prefer `wait` over
  `split`".
- The executor sees `series_to_check` in `whoami` and answers with `report_series_done`.
- The clock's share (dormant, wake, suggestions) runs from `actions.tick`, so the domain modules never
  import `series` (`tests/test_layers.py`).
- The UI pieces:
  - `js/view-series.js`: the page and the sheet.
  - `js/app.js`: the menu entry and `#/series`.
  - `js/view-triage.js`: the four cards, and the "Part of …" line on task cards.
  - `js/view-tasks.js`: the Lineup line, plus task detail's "Part of …", also touches and the picker.
  - `js/view-capture.js`: New task’s +: Series, Person, Source, Artifact, Upload a file.
- Tests: `core/tests/test_series.py`, `test_series_more.py`, `test_series_extra.py`, `tests/ui/series.test.mjs`.
- Replay: `core/fuzz/series/replay.py`, on a copy of the store.

How the build meets the parts above that needed a decision:

- **Anchors** are the series entity's identifiers (`identifiers`, type `anchor`, value `<key>#s<series>`,
  since one anchor can belong to several series). The source of truth behind them is a projected
  `series_anchors` table (the seed keys, the ones you added, the ones you removed), because `identifiers` is
  derived and anchors need Undo and replay; the identifiers are rewritten from it after every change and
  detection run. A series' anchors are worked out when read: what at least 2 of its tasks carry **and** where
  the key is concentrated (at least `anchor_share`, 50%, of the free tasks carrying it are in the series),
  plus yours, minus the ones you removed. Attach also needs one matching anchor that isn't an area's, a person
  or a DM.
- **Judge items** live in `series_items` (derived, like `fact_judgments`), and "wait" memory in `series_waits`.
- **Recurring meetings** are anchored by a meeting's title (`meet:`). **Email lists** are a recipient address
  shaped like a list (`northwind-all@`, `dl-…@`, `…-team@`) that never sends mail, or one you type; like
  documents, they support a series but never start one.
- **Not needed** feeds lessons (`learning/learners/series.py`): twice in a row for one kind of suggestion in a
  series, and Fuzz stops suggesting that kind there (shown in Settings, where you can turn it off). Every
  outcome is also an eval case (`eval_cases`, surface `series_suggest`).
- **Usual next step** is mined from the series' history: a step it repeats (the same title once dates are
  dropped) at least 3 times, about the same days apart, due again with nothing open for it.
- **Ranking:** among cards otherwise level, a task in a series that moved this week (not muted, quiet or
  wrapped) comes first. Work on … and a focus phrase naming a series put its tasks, and the ones that also
  touch it, in Focus.
- **Cross-series hints:** a task card says "Helps Northwind too" when its task also touches another series,
  and the stall detector counts a reply owed on a task filed elsewhere that touches it.
- **New task's +:** Series, Person (someone Fuzz knows or a name you type, for them or about them), Source (a
  link to an email, a thread, notes or a page), Artifact (something Fuzz made) and Upload a file. The picks
  become the task's sources (`POST /tasks/{id}/refs`), and a person shows in its People.
- **Tasks the judge leaves out of a split** don't attach to its parts afterwards (a `series_left_out`
  feedback row). Without that, the very next run put them straight back.
- **Grouping orphans by area** for Fuzz's own reasoning isn't used by anything yet: areas exist with their
  anchors, ready for it.
- The trust labels use the placeholders: Confirmed, From the owner, Reported, Fuzz noticed, Out of date.

### Replay on real data (2026-11-18)

`python -m fuzz.series.replay <copy>` replays detection day by day on a copy of the store, through the core's
own code, with the configured client as judge (cached next to the copy). Run on a copy of the live store (274
tasks, 18 days), against the spike's batch pass (15 series after its judge):

- **First run:** 7 series, 6 areas, 3 waits, nothing refused, 11 judge calls. One series snowballed to 94
  tasks: every task that attached brought its broad keys (the product's name) along as new anchors. →
  `anchor_share`, and attach needs a strong anchor.
- **After the fix:** 8 series of 5-15 tasks (73 of 274 tasks in one), 8 areas, 15 judge runs over 22 items
  (7 new, 8 area, 5 wait, 1 split, 1 merge), nothing refused, 21 tasks attached without AI. The customer
  engagement the streaming spike fragmented into forming pieces formed whole (15 tasks), and the judge chose
  `wait` five times. The batch pass's spec, prototype, evaluation and goals series all appear. Fewer tasks are
  in a series than in the batch pass: the rest sit in areas or in no cluster, which is the safer side to err on.

## Rolling it out

Every requirement above is built, tested (core and UI suites) and replayed on a copy of real data. What's left
are steps for whoever runs it, in order:

1. **Merge** the branch. Until then the live core (main) doesn't know series items, so don't install the new
   skill text early: an extractor reading it would send verdicts main refuses.
2. **Update the installed skills** (`fuzz doctor` offers it; installed skills are copies of `core/skills/`):
   the extractor judges series items and sends series facts, the executor checks series' done-whens.
3. **Look at the replay's series** (`python -m fuzz.series.replay <copy>`) before detection runs on the live
   queue, and tune `{"series": {...}}` in config.json from what looks wrong. `{"series": {"detect": false}}`
   turns detection off, `{"series": {"suggest": false}}` suggestions.
4. Once suggestion outcomes have piled up, score the detectors on the `series_suggest` eval cases.

## Open questions

- **Recurring meetings** couldn't be tested: the store has no meeting signals yet, and most Slack is DMs.
- **Gone quiet** can't be tested with three weeks of history.
- **Undecided UI copy:** the trust labels (Reported, From the owner, Fuzz noticed, Confirmed) and the
  Artifacts and Settings sublines in the menu are placeholders.

## Files

- Mockup: `spikes/series-page/project/` (a Design canvas; the published copy is private to its owner at
  https://claude.ai/artifact/JZZ2tvcTNVdMifeK1ynzDn).
- Batch detection: `spikes/series-page/detect.py <copy of fuzz.db> 6 0.10 [--judge]`
- Streaming replay: `spikes/series-page/stream.py <copy of fuzz.db> [--no-judge]` (judge answers cached
  next to the db copy).
- Run both with `~/.local/share/uv/tools/fuzz-core/bin/python -I`, on a copy made with
  `sqlite3 fuzz.db ".backup <copy>"`. Their reports name real customers and people: keep them out of git.
