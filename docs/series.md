# Series: the bigger things you're working on

Status: designed, not built. Worked out in conversation on 2026-11-18, with a UI mockup and two detection
spikes run against a copy of real data (`spikes/series-page/`). This doc holds the requirements decided so
far, what the spikes taught us, and what comes next. Where the mockup and this doc differ, this doc wins.

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
  Decided, People, How Fuzz spots it (editable).
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

## Next

Recommendations accepted on 2026-11-18, not built yet:

1. Offer **forming series to the judge as join targets**, so pieces can merge back.
2. **Re-check a forming series that stalls** (no growth in a week) with the judge: merge, wait or drop.
3. Tell the judge to **prefer `wait` over `split`** when the parts would be under the rules.
4. Rerun the replay and compare with the batch result; then build it into the core behind the matcher.

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
