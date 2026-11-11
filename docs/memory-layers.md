# Entities and knowledge: design and build plan

The plan for the Entities and Knowledge PRD: the memory around Fuzz's tasks that answers "who is this, what
is that, why did we decide this" in seconds, without Justin filing anything. It extends the core in
[`fuzz-core-design.md`](fuzz-core-design.md) and follows on from its build order (steps 18 to 25).

## Scope

In:

- **Entities**: person, company, tool or system, and concept or term, each with facts that carry provenance
  and trust.
- **Knowledge**: meeting notes, thread digests, reference summaries and learnings.
- **The decision log**, including reversals.
- **Retrieval** through Claude (an MCP role) and the app (an ask box), with citations and trust labels.
- **Onboarding mode**: a people map, a glossary and a brief before each meeting.

Out for now:

- **Workstreams.** They come later with their own PRD. Knowledge and decisions link to entities, tasks
  and groups only. The links table has a `kind` column, so a workstream can be added later without a
  migration.
- Priorities, time management, rituals and the wins log.

## Choices made

| Choice | Decision | Why |
| --- | --- | --- |
| Company | The existing `org` entity, keyed by email domain, gains facts like any other entity | Already created on ingest |
| Where trust lives | Worked out when read, from stored facts, the clock and exposure. Never stored as a column | Decay depends on today's date, so a stored value would go stale |
| Event sourcing | `facts`, `knowledge` and `decision_log` join `events.TABLES`, so they replay and Undo works. `entities`, `aliases` and `identifiers` stay derived, as they are today | Confirmations and corrections have to undo and survive `fuzz rebuild --check` |
| Table name | `decision_log`. The matcher's `decisions` table keeps its name | Avoids renaming a table that is in use |
| Briefs, people map and glossary | Markdown files in the output folder under `Knowledge/`. About 5 minutes before a meeting, Fuzz gives a link to its brief | Your answer. Keeps to "no new destinations": they show under Artifacts |
| Ask Claude | Both: a read-only `fuzz-recall` MCP role and skill for Claude Code and Copilot, and an ask box in the app that runs the same tools headless | Your answer |
| "Docs Justin opens" | Limited to docs that are linked or sent in an approved source | Opening a doc isn't something Fuzz can observe |
| Authoritative sources | The org directory (title, team, manager), and the owner's own words | Your sources: org directory, email and calendar, Slack or Teams, meeting transcripts and wiki |

## What exists today

- `entities` (person, org, document, ticket, term), `identifiers`, `aliases` and `entity_links`, all written
  by `matching/entities.py` on ingest. People are resolved by email, then Slack ID, then a unique alias.
- `entities.definition` is a single text column, with no provenance.
- `entity_person` and `entity_term` cards have answer handlers (`answers.py`) and UI, but **nothing raises
  them**. Writing the code that raises them is part of step 19.
- `people.for_task` works out who is involved in a task when it's read. It becomes the starting point for
  "recent interactions".
- Meetings reach the extractor only as action-item rows. There is no summary, decision or attendee list for
  the meeting as a whole.
- The executor reports the calendar into `user_state['calendar']` (`booking.calendar`). Brief timing reads
  it from there.
- There is no digest and no ask surface.

## Data model

```sql
-- one row per claim about an entity; superseded rows stay
CREATE TABLE facts (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
  entity_id INTEGER NOT NULL,
  attr TEXT NOT NULL,           -- from the allowlist below
  value TEXT NOT NULL,
  how TEXT NOT NULL,            -- stated | extracted | inferred | edited
  authority TEXT NOT NULL,      -- owner | official | other | none   (who said it, relative to the fact)
  said_by INTEGER,              -- person entity, when known
  source_kind TEXT,             -- email | slack | meeting | doc | directory | you
  source_ref TEXT,              -- signal key, URL or directory id: a link back, never a copy
  source_ts TEXT, captured_at TEXT NOT NULL,
  status TEXT NOT NULL,         -- live | rejected | undone (superseded and disputed are worked out when read)
  confirmed_at TEXT             -- you confirmed or edited it
);
CREATE TABLE fact_views (       -- when a fact was shown to you (brief, answer, sheet); for rule 6, not events
  user_id INTEGER, fact_id INTEGER, shown_at TEXT, surface TEXT);

CREATE TABLE knowledge (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,           -- meeting | thread | reference | learning
  title TEXT, summary_md TEXT,  -- a summary and open questions; never the full text
  source_ref TEXT, link TEXT, source_ts TEXT, captured_at TEXT,
  how TEXT, authority TEXT, status TEXT   -- live | superseded | rejected
);
CREATE TABLE decision_log (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
  what TEXT NOT NULL, why TEXT, alternatives TEXT,   -- json list
  decided_by INTEGER, decided_at TEXT,
  source_ref TEXT, link TEXT,
  how TEXT, authority TEXT,
  status TEXT NOT NULL,         -- proposed | recorded | rejected | reversed
  reverses INTEGER              -- the earlier decision this one overturns
);
CREATE TABLE memory_links (     -- knowledge or decision ↔ entity, task or group (later: workstream)
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,   -- an id, so apply() can upsert it and Undo can remove it
  item_type TEXT, item_id INTEGER, kind TEXT, target_type TEXT, target_id INTEGER, removed INTEGER DEFAULT 0);
CREATE TABLE memory_files (     -- files in Knowledge/, which belong to no task
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,           -- people | glossary | decisions | brief
  title TEXT, path TEXT NOT NULL, meeting_key TEXT, starts_at TEXT, updated_at TEXT);
```

Entity types gain `tool` alongside `term`. A term's aliases hold its acronyms.

**Moving existing definitions.** A one-time migration emits an `entity.fact_added` event for each existing
`entities.definition`, with `how = edited`. Writing the rows directly wouldn't work: `rebuild` replays only
events, so it would delete them. After the migration the column stops being written.

**Merges.** Facts follow `redirect_to`. When "Pat" is merged into "Patricia Lee", Pat's facts move to
Patricia's entity in the same command, and conflict resolution runs over the combined set. Undoing the
merge splits them back.

### Privacy allowlist

Person facts are limited to these attributes, checked at write time (in the JSON schema and again in the
core):

`role`, `team`, `company`, `manager`, `projects`, `owns`, `cares_about` (about work only), `how_met`,
`works_hours`, `prefers` (how they like to work: channel, format, timing).

Anything else is rejected with an error the extractor sees, and the rejection is counted in the run's
detail. Interactions aren't facts: "last talked, what about, what's open" is worked out when read, from
signals, tasks and drafts, the way `people.for_task` does today. Companies, tools and terms have their own
short allowlists (`relationship`, `contacts`, `owner`, `what_it_is`, `definition`, `used_for`).

## Trust

`trust(fact, now)` returns `{level, score, stale, disputed, why}`. It's a pure function, so it can be tested
with a fixed clock.

1. **Base level.**
   - `edited` or `confirmed_at` set: **Confirmed**.
   - `stated` or `extracted` with `authority` `owner` or `official`: **Authoritative**.
   - `stated` or `extracted` from anyone else: **Reported**.
   - `inferred`: **Inferred**.
   - Decision records follow the same rule (rule 7).
2. **Age.** The score halves every `half_life` days for the attribute: role, team and manager 120; projects
   and owns 45; cares_about and prefers 90; definition 365; relationship 180. Below the base level's band,
   the fact is **Stale**. Confirmed facts age too, at half the rate. The numbers live in config
   (`memory.half_life`), not in code.
3. **Exposure (rule 6).** A fact shown on 3 separate days without a correction moves up one level, as far
   as Reported. Confirming it in triage sets it to Confirmed. Exposure changes how the fact is labelled.
   It never changes `how`.
4. **Conflict (rules 1 and 2).** Two live facts with the same entity and attr, and values that differ:
   - The higher level wins. With equal levels, the more recent source wins, then the newer id, so the
     order is total and the winner never flips between reads.
   - The loser is shown as superseded. That's worked out when read: its row stays `live`.
   - When the top two are at the same level (both Authoritative or both Reported, neither stale or
     confirmed) and their sources are within 30 days of each other, it's a **real conflict**. Both stay live, both show as **Disputed**, and a `fact_conflict` card asks which is right.
5. **Rule 4: inferred facts never drive an action on their own.** The rule is keyed on `how = inferred`,
   not on the trust level. An uncorrected guess that exposure has raised to Reported still counts as
   inferred until you confirm or edit it. Enforced in the core, not in a prompt:
   - A decision whose only source is inferred stays `proposed` until you answer its card.
   - When a draft's recipient was resolved through an inferred fact ("Priya owns billing"), the draft card
     says so ("Fuzz guessed Priya is the one to ask") and the suggested answer becomes Edit, not Approve.
     `save_draft` records the fact ids it relied on.

## Extraction and filling in

The extractor's signal schema (`signals.py`) gains optional fields, and `fuzz-extract` moves to
`extract-0.15`:

- **`facts`**: `[{about, attr, value, how, said_by}]`, where `about` is a person, org, tool or term
  reference resolved like `people`.
- **`terms`**: `[{term, aliases, best_guess, used_as}]`, for any acronym or internal name not already known
  (`whoami` returns the known terms, so it doesn't send them again).
- **`decisions`**: `[{what, why, alternatives, decided_by, confidence}]`. Only for clear decision language
  ("we're going with", "agreed to drop").
- **`meeting`**: one per meeting summary: `{title, attendees, summary, open_questions, decisions}`. Its
  action items stay rows, as today.

New extractor tools:

| Tool | Does |
| --- | --- |
| `get_lookups` | Provisional people, orgs and tools with thin records, plus threads that have settled (no new message for `memory.settle_days` = 2 days, at least 5 messages) and links still waiting to be summarised. Capped per run |
| `submit_facts` | Facts from the org directory or a search, with `source_kind = directory` for the directory |
| `submit_knowledge` | Thread digests, reference summaries and learnings, each with its link |

So "fill from context" is the extractor's second pass in the same run. It looks people up in the directory
connector and reads the settled threads and linked docs with Glean or Confluence. Justin writes nothing.

## Cards

All of these are question-family cards, each with a suggested answer, a way out and Undo.

| Kind | Raised when | Answers |
| --- | --- | --- |
| `entity_person` (exists) | A provisional, name-only person matches one known person's first name or alias ("Pat" and "Patricia Lee"), and the pair isn't in `entity_links` | Same person · Different people · Not sure yet |
| `entity_term` (exists) | A new term's best guess is low confidence, or the term looks odd | Save definition `{text}` · Same as… · Not sure yet |
| `decision` (new) | A detected decision below the confidence bar, or with an inferred source | It was a decision `{edits}` · Not a decision · Not sure yet |
| `fact_conflict` (new) | A real conflict (above) | Use this one · Use that one · Neither `{value}` |

**Card flood guard.** A new job brings hundreds of names and terms. Memory cards are capped at
`memory.daily_cards` (2 a day, onboarding or not). They're never put ahead of time-sensitive cards, and
are kept lowest stakes first. Anything over the cap stays Inferred and visible, and rides on exposure
instead of a card. High-confidence decisions from the decision-maker's own words are recorded without a card
and show in the next brief and answer.

## Briefs, people map and glossary

These go in the output folder, under `Knowledge/`, and show under Artifacts as kind `markdown`:

- `Knowledge/People.md`: grouped by team, with role, how you met, what they care about and what's open
  between you. Inferred and stale facts are labelled.
- `Knowledge/Glossary.md`: alphabetical, with aliases. Best guesses are marked "Fuzz's guess".
- `Knowledge/Decisions.md`: newest first, with reversals linked.
- `Knowledge/Briefs/<date> <meeting>.md`: who's attending, what Fuzz knows about each person (with trust),
  open items with them, terms likely to come up, and earlier decisions and notes from the same series.

The **core** writes these files from the tables. No model is needed, so they're cheap to rewrite whenever
something changes. A brief is written when the calendar shows a meeting in the next 24 hours, and again
just before it.

**Listing them under Artifacts.** Today `/artifacts` lists `sources` rows with `role = 'output'` joined to
their task, and `sources.task_id` is `NOT NULL`. A file under `Knowledge/` has no task, so these files are
kept in `memory_files` instead:

- `GET /artifacts` merges `memory_files` into its list, with "Knowledge" where the task would be.
- `GET /artifacts/k<id>` serves a knowledge file to `artifact.html`.

When `output.folder` is `-`, the files go in `<FUZZ_HOME>/knowledge/` and are listed the same way.

**The link at meeting time.** The ticker that `fuzz serve` already runs emits `brief.due` 5 minutes before
the meeting starts (`memory.brief_lead_mins`). Its payload is the `/artifacts/k<id>` link. The UI's live
event stream has Fuzz say "Staff sync in 5. Here's who's coming" with that link, which opens the brief in
`artifact.html`. This isn't a card: there's no decision. When no Fuzz tab is open, a desktop notification is
the fallback (see Open questions).

**Fresh times.** Fuzz knows only the calendar the executor last reported, and `booking.refresh_hours` is 12.
So when a meeting starts within 2 hours and that report is more than an hour old, the core marks the
calendar as due for a re-read (`get_lookups`' `meetings.read_now`), and the extractor's next hourly run reads
it again with `report_meetings`. The executor only reports the calendar while it holds a task, so on a quiet
day it would never refresh it. A meeting moved after the last
read keeps its old brief time until then. The tests use that same rule.

In onboarding mode (the first 60 days after `memory.onboarding_from`), every meeting gets a brief. After
that, only meetings with someone new, or with an open item or decision on the agenda, get one.

## Retrieval

**`fuzz-recall` MCP role** (`fuzz mcp --role recall`). The installer installs it into Claude Code and
Copilot like the other roles, along with a `fuzz-recall` skill.

| Tool | Returns |
| --- | --- |
| `who_is(name)` | The entity, its live facts with trust, recent interactions, and open commitments both ways |
| `what_is(term)` | The definition, aliases, and where it came up |
| `why(question)` | Matching decisions and knowledge, ranked with the existing vectors |
| `search_memory(query)` | Across entities, facts, knowledge and decisions |
| `meeting_brief(meeting)` | That meeting's brief, written on demand |
| `correct(fact_id or entity, attr, value)` | The one write: an `edited` fact as `human`, since this is Justin in his own session. It can be undone |

Every result carries `sources` (link, who, when) and a `trust` label. The skill tells Claude to cite them,
and to say "Fuzz's guess" for Inferred and "Disputed" where it applies. Every call writes `fact_views`. The
executor gets `who_is`, `what_is`, `why` and `search_memory` too (read-only, and its lookups don't count as
showing you a fact). `get_task` also carries `memory`: the task's people and the known terms in its words, each
fact with its `fact_id` and trust label, ready for `relied_on`.

**In the app.** `POST /ask {question}` starts a headless run of the `ask` role: the recall tools **except
`correct`**, since nobody is present in a headless run to vouch for an edit, plus `answer_ask`. The answer
streams back through the event stream. The ask box lives in the small Fuzz on every page, so there's no new
tab. `GET /entities/{id}` backs a person or term sheet that opens from a name on a card or in task detail.
It has Edit, which writes a fact with `how = edited`.

## The inspector (debugging)

A read-only view of everything the memory layers hold and **why**, for building and debugging them. It's a
developer tool, not part of the product, the way the Fuzz mood lab is.

**Where.** A hidden route, `#/inspect`, that shows only when the app is opened with `?lab` in live mode
(`http://127.0.0.1:8765/?lab&token=…#/inspect`). It's not in the nav. It uses the same token, theme and
code font as the rest of the app, and opens sources and `Knowledge/` files in `artifact.html`. A matching
CLI, `fuzz inspect`, prints the same JSON from the same library functions, for the terminal and for tests.

**What it shows.**

| Panel | Contents |
| --- | --- |
| **Entities** | A searchable list, with filters by type and state: provisional, has stale facts, disputed, merged, thin (few facts), no definition. Counts per type at the top |
| **Entity detail** | Name, type, provisional, the `redirect_to` chain both ways, aliases, identifiers and `entity_links` (kept separate from…). Every fact, **including superseded and rejected ones**, with its source link, who said it, `how`, `authority`, and the trust breakdown (see below). Then the candidates and tasks that mention it (with the strength: id, alias or provisional), the cards raised about it and their answers, its `fact_views`, and the events that touched it, newest first |
| **Trust breakdown** | What `trust()` returns as `why`: "base Reported (extracted, other) · aged 0.62 (role, 74 of 120 days) · +1 exposure (3 days) · disputed by fact 41". A **time slider** (`?at=`) works out trust at another date without writing anything, so decay and staleness can be seen |
| **Knowledge and decisions** | Each item with its summary, link, `how` and `authority`, status, its `memory_links`, and for decisions the `reverses` chain |
| **Runs** | Per extractor run: what it submitted (facts, terms, decisions, meeting summaries), what the core accepted, and what it refused, with the reason (outside the privacy allowlist, schema error, unresolved `about`). The cards it raised, and the ones **held back by the daily cap** |
| **Why not?** | Pick two entities and ask why no "same person?" card was raised: already kept separate, names don't match by prefix, a merge already in place, or the cap was reached. Pick a fact to see why it lost a conflict |
| **Briefs** | Upcoming meetings from the last calendar report, when each `brief.due` will fire, whether the calendar is due for a re-read, and the brief's file |

Every panel has **Copy as JSON**, so a bad case can be pasted into a bug report or saved as a test fixture.

**HTTP.** These endpoints are all read-only, behind the usual bearer token:

```
GET /inspect/entities?type=&q=&state=        GET /inspect/entities/{id}?at=
GET /inspect/facts/{id}?at=                  GET /inspect/why_not?a=&b=
GET /inspect/knowledge   GET /inspect/decisions   GET /inspect/runs/{id}   GET /inspect/briefs
```

The CLI has `fuzz inspect entity <id|name> [--at DATE]`, `fuzz inspect fact <id>`,
`fuzz inspect run <id>` and `fuzz inspect why-not <a> <b>`.

**What it needs from the rest of the plan.**

- `trust()` returns the `why` breakdown, not only the level.
- A run's `detail` keeps its refused items and the reasons, and the cards held back by the cap.
- Each later step adds its panel as part of being done.

The first version works on the tables that already exist (entities, aliases, identifiers, mentions,
`entity_links` and entity cards). That makes it useful right away for the matcher as it is.

## Build order

Each step ends with:

- its tests green;
- `fuzz rebuild --check` clean;
- the scripted loop working offline;
- what it adds visible in the inspector.

18. **The inspector, then facts and trust.** First the inspector (`#/inspect` behind `?lab`, the
    `/inspect` endpoints and `fuzz inspect`) over today's entity tables. Then the `facts` table in `TABLES`, `entity.fact_added`, `fact_superseded`,
    `fact_confirmed` and `fact_edited` events, the allowlist, `trust()`, automatic conflict resolution,
    facts that follow a merge, and the event-based move of `definition`.
19. **Entity cards for real.** The code that raises `entity_person` and `entity_term` cards, the daily cap,
    the `tool` type, and exposure from `fact_views`.
20. **Extraction.** Schema fields and `extract-0.15`, `facts`, `terms`, the `meeting` summary, scripted
    fixtures, then `get_lookups` and `submit_facts` for the directory.
21. **Briefs and onboarding mode.** `memory_files` and its place under Artifacts, the `Knowledge/` writer
    (`People.md`, `Glossary.md`, briefs), brief timing and `brief.due`, the calendar re-read, Fuzz's line and
    link in the UI, and onboarding thresholds.
22. **Retrieval.** The `fuzz-recall` role, its tools, skill and installer entries, `doctor` checks, then
    `/ask` (without `correct`), `/entities/{id}` and the person and term sheet.
23. **Knowledge.** The `knowledge` table, meeting notes from `meeting`, settled-thread digests, reference
    summaries and learnings through `submit_knowledge`, and `memory_links`.
24. **Decision log.** Detection, the `decision` card, auto-recording rules, reversal links, and
    `Decisions.md`.
25. **Conflicts and rule 4.** `fact_conflict` cards, recording which facts a draft relied on, the "Fuzz
    guessed" line, and the suggested answer switching to Edit.

Onboarding comes before retrieval because onboarding mode lasts only 60 days, and the people map, glossary
and briefs need only steps 18 to 20. This order depends on the start date (open question 1). Step 22 adds
"who is this, what's that" through Claude. Steps 23 and 24 add "why did we decide that".

## Testing

New tests sit next to the existing ones in `core/tests/`. Run them with uv's Python, not the system one.
UI checks go against the live server at `127.0.0.1`.

**Unit and contract**

- **Trust, with a fixed clock**: each `how` and `authority` combination gives the right level; each
  attribute goes stale at its half-life; confirmed facts age at half the rate; exposure on 3 separate days
  raises the level once, and 3 views in one day don't.
- **Conflicts**: the higher level wins; equal levels go to the more recent; the loser is `superseded`, not
  deleted; two Reported facts within 30 days raise one `fact_conflict` card, and answering it supersedes the
  other fact; Undo restores both as live.
- **Privacy**: a person fact with an attribute outside the allowlist (`health`, `family`, `home_address`) is
  refused at the MCP schema and at the core, and nothing is written. Whether a free-text `cares_about` is
  about work can't be judged by the core. That check is in the extraction-quality eval.
- **Merges**: merging Pat into Patricia Lee moves Pat's facts, resolves conflicts over the combined set, and
  one Undo splits them back.
- **Recall writes**: the headless `/ask` run has no `correct` tool.
- **Inspector**:
  - Every `/inspect` endpoint, including with `?at=`, leaves the event count and every table unchanged.
  - Each one is scoped to the user.
  - `fuzz inspect` and HTTP return the same JSON.
  - A drift guard: every memory table (`facts`, `knowledge`, `decision_log`, `memory_links`,
    `memory_files`, `fact_views`) has to show up in some inspector response for a fixture that fills it.
    A new table can't be left out without failing.
  - `why_not` gives the right reason for each case it covers.
  - A run's refused items list each privacy rejection from the privacy test.
- **Card table**: every new kind and answer writes exactly the events listed, and Undo puts the tables
  back.
- **Card cap**: 40 new terms in one run raise at most `daily_cards` cards. None goes ahead of a
  time-sensitive card. The rest stay Inferred.
- **Rule 4**: an inferred-only decision stays `proposed`; a draft whose recipient came from an inferred fact
  has Edit as its suggested answer and the "Fuzz guessed" line.
- **Reversals**: a later decision on the same subject links `reverses`, the earlier one becomes `reversed`,
  and both show in `why`.
- **Replay**: `rebuild --check` is clean after a fixture run that touches every new table.
- **Isolation**: two users' facts, knowledge and decisions never cross, in recall tools or over HTTP.
- **Role scoping**: recall sees only its own tools. Its only write is `correct`. The `ask` role has no
  `correct`. The executor gets `who_is`, `what_is`, `why` and `search_memory`, never `correct`, and its lookups
  write no `fact_views`. Installer tests cover the new role for both clients, against a stubbed home and
  launchd (per the installer-leak note).
- **Brief timing**: with a fake calendar, `brief.due` fires once, 5 minutes before the start. A moved or
  cancelled meeting, once the calendar is reported again, moves or stops it. A calendar report more than an
  hour old with a meeting inside 2 hours marks it due for a re-read. The brief appears in `GET /artifacts`
  with no task and opens at `/artifacts/k<id>`, including with `output.folder` set to `-`. It lists the
  attendees and their open items.

**End-to-end, scripted.** A "first week at the new job" fixture set: about 30 signals across email, Slack,
meetings and a directory dump, with a Pat and Patricia Lee pair, a role change, two conflicting launch
dates, three acronyms, one clear decision, one implied decision and one reversal. The checks:

- After `fuzz run extractor --scripted`, the expected entities, facts, cards and files exist.
- After answering the cards, `People.md`, `Glossary.md` and `Decisions.md` match golden files.

**Answer quality, with a real model.** A golden list of about 20 questions over the fixture store ("who is
Priya and what did I promise her?", "why did we pick vendor B?", "what does ORN mean?"). A test asks each one
through the recall skill and checks:

- The answer names the right entity or decision.
- It cites at least one source.
- It labels Inferred and Disputed facts.

The results are recorded with `model` and `prompt_version`, so two configs can be compared, as in the
design doc's model comparison. This doesn't run in the default test pass.

**Extraction quality**: precision and recall for decisions and terms on a labelled set of real-looking
meeting summaries, tracked per `prompt_version`. The set includes non-work details about colleagues
(weekend plans, health), which must never come out as facts. A drop blocks a prompt change.

**Live UI**: a brief's link appears 5 minutes before a fixture meeting and opens in `artifact.html`; the
person sheet's Edit writes a Confirmed fact; the ask box answers with sources.

## As built (2026-11-10)

Steps 18 to 25 are built on the `memory-layers` branch. These are the places the build differs from, or adds to,
the design above:

- **Code:** `core/fuzz/memory/` (`trust`, `facts`, `mcards`, `knowledge`, `extract`, `briefs`, `recall`,
  `inspect`), `core/skills/fuzz-recall/`, `js/memory.js` (ask box and inspector). Tests:
  `core/tests/test_memory.py`, with the first-week fixture in `core/tests/fixtures/memory_week1.json`.
- **Derived tables**, kept out of replay: `sightings` (where each entity came up, for "last talked" and "where it
  came up"), `memory_refusals` (what the core refused, and why), `fact_views` and `memory_files`.
- **Meetings for briefs** come from the extractor's `report_meetings`, not the executor's calendar report, which
  has free time only and no attendees.
- **Only terms the extractor flags** (`terms`) get "What is this?" cards and a glossary entry. The matcher's
  `topics` ("vendor list") are not jargon.
- **The `entity_term` card's "Same as…"** answer isn't offered in the UI yet: it needs an entity picker.
- **Memory cards** run after each extractor submission and at most every 15 minutes from the tick.
  `memory.cards: false` turns them off.
- **Defaults for the open questions below:**
  - Onboarding mode starts when the store was created; set `memory.onboarding_from` to the start date.
  - When no Fuzz tab is open at brief time, there's no notification yet.
  - There's no retention limit yet.
- **Not built yet:**
  - The real-model evals: the 20-question recall check and the extraction precision and recall set. Until they
    exist, keeping non-work details out of free-text `cares_about` rests on the skill prompt alone.
  - A person or term sheet for ordinary use. Edit exists only in the `?lab` inspector; `GET /entities/{id}` is
    ready for a sheet.
  - The ask box in the small Fuzz on every page. It's on Artifacts and in the inspector for now.
  - Golden files. The People, Glossary and Decisions files are checked line by line instead.
- **Commands:**
  - `fuzz memory write|cards|due` runs those passes by hand.
  - `fuzz inspect …` is the inspector in the terminal.
  - `fuzz run ask --ask-id … --question …` is the ask box's run.

## Open questions

1. **Start date.** When does the new job start? It sets `memory.onboarding_from`, and whether steps 18 to 21
   need to land before it.
2. **When no Fuzz tab is open at brief time**: a macOS notification with the link, nothing, or something
   else?
3. **The employer's data rules**: is a local summary of meetings and threads allowed, and for how long? This
   sets a retention setting for `knowledge` and `facts` that come from source systems.
4. **Teams or Slack, and the transcript format**: which tools reach them at the new job? The skill's
   connector notes depend on it.
