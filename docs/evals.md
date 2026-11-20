# Evals: telling better from worse

Status: designed and built on 2026-11-17 (see **Built** below; the outcome scorecard is still to come). It
extends the Evals section of `docs/self-improving.md`, which built the extraction harness
(`core/fuzz/evals.py`), into something that answers one question for any change: **is this better or worse
than what we had before?**

## Running them

| Command | What it scores | Model? |
| --- | --- | --- |
| `fuzz eval run [--set global\|personal]` | Extraction: is there an ask, and whose | Yes, 3 repeats |
| `fuzz eval compare [--base-ref main]` | Extraction, two versions head to head on today's cases | Yes |
| `fuzz eval rebaseline [--against <run>]` | Extraction after the cases changed: the baseline's app on today's cases | Yes |
| `fuzz eval dupes` | The duplicate matcher on labelled pairs, with a threshold sweep | No |
| `fuzz eval senders` | Who a sender is: a person, a bot, a list or a brand | No |
| `fuzz eval drafts --history` | The drafts Fuzz already wrote, against what you sent | Judge only |
| `fuzz eval drafts` | Fresh drafts on personal and global draft cases | Yes |
| `fuzz eval executor` | Invented tasks in invented worlds: gather, ask, hand back | Yes, 2 repeats |
| `fuzz eval copy <case>` / `copies` / `approve <id>` / `reject <id>` | A personal case's invented copy, on its way to the repo | Yes |
| `fuzz eval spots` | What you said on "How did Fuzz do on this?" | No |

Every run prints the cases per set, then against the last run that passed its gate: what it fixed, broke, left
unchanged or made flaky, with a sign test once anything moved. A run exits 1 when something solved broke.
It also says which side moved since that run, the app or the cases (see **Changing the evals and the app**).

## Built

1. **Global set from the repo** (`evals.global_cases`): `eval_seeds/<surface>.json` (format 1) read on every
   run; an older store's copied seeds are retired. `eval_cases.scope`; runs record the set, the seeds' commit
   and seconds.
2. **Fingerprints and comparisons** (`evals.compare`, `head_to_head`, `sign_test`): flaky is never a break;
   `--base-ref` scores the skill as it was at any git ref.
3. **Run outputs expire** (`evals.strip_old_runs`): replies on personal cases go after 90 days.
4. **Spot checks** (`spotcheck.py`): "Was there anything for you here?" (3 a week, two thirds from DMs) and
   "How did Fuzz do on this?" (2 a week), raised on the tick; config `evals.spot_checks_per_week` and
   `evals.run_checks_per_week`, 0 turns one off.
5. **Matcher tuning and its replay** (`matching/replay.py`, `learning/learners/thresholds.py`): first run on
   real labels, 2026-11-17: 27 pairs, 20 right at today's thresholds (precision 0.62, recall 0.80); no
   threshold clearly better, so nothing proposed. Three of the seven misses were pairs sharing one link that you
   had said differ.
6. **Invented copies** (`copies.py`): trap check, leak check, review from the command line (for now: the open
   question below), and a test that no committed case holds a real-looking address or link.
7. **Draft scoring and the draft-style learner** (`draft_evals.py`, `learning/learners/drafts.py`,
   executor-0.22 reads `draft_lessons`).
8. **Executor harness** (`executor_evals.py`) and four global cases (`eval_seeds/executor.json`). Each case
   runs at its own "now", and a task can come from one of the world's messages (`from_message`) so a reply has
   a thread.
9. **Telling the app's change from the cases'** (issue 45; `evals.record`, `attribution`, `rebaseline`): every
   run records the app's commit, the case set's hash and the judge's version; the Evals page splits each
   score change into the two; `fuzz eval rebaseline` scores the old app on new cases.

First live runs on Copilot, 2026-11-17, on a copy of the store: extraction global 9 of 9 at 3/3 and the one
personal case 1/3; executor 4 of 4 at 2/2; global draft rules 3 of 3; the matcher as in item 5. The drafts
so far are all prep notes, so there's no sent draft to score yet.

## Goal

Every change to a skill, a lesson, the core or the model can be scored on the same inputs before and after,
and the answer is a short list: what it fixed, what it broke, what didn't move. Anyone can run the shared
evals from the public repo. Each person also has evals made from their own corrections, which never leave
their machine.

## Choices made

| Choice | Decision | Why |
| --- | --- | --- |
| Sets | A **global** set committed to the repo, and a **personal** set per person, local only | The repo is public; real messages and drafts can never be committed |
| Global cases | Invented. Real cases reach the repo only as invented copies, reviewed by a person | Swapping names isn't enough: the rest of a message still identifies people and situations |
| Proof an invented copy works | It must fail on the version that failed the real case | Shows the copy kept the trap without anyone else reading the original |
| Leak check | A test fails if a global case holds a known name, address, domain or a long run of words from the private case | Catches what review misses |
| Versioning | Per case (a fingerprint), not per set; each run records the fingerprints it scored | Personal sets change daily: added, relabelled, expired |
| A comparison | Both versions run fresh on today's cases | A stored run from weeks ago scored a different set |
| Reporting | Counts per case (fixed, broke, unchanged, flaky), never a percentage | With tens of cases a percentage is noise |
| Trends over months | The outcome scorecard, not the evals | Personal cases expire on purpose |
| Drafts | Personal: scored against what the person sent | Voice is personal; only rules like "no invented facts" are global |
| Executor judgment | Global: spot checks turned into invented cases that check behaviour | What to gather, when to hand back and when to ask hold for everyone |

## Two kinds of measurement

| | Replay evals | Outcome scorecard |
| --- | --- | --- |
| Answers | Is B better than A on the same inputs? | Did Fuzz do its job better this month? |
| Fair comparison | Yes: same inputs, model held fixed | Weak: every week brings different mail |
| Used for | Deciding whether to merge a change | Seeing drift, and choosing which replay eval to build next |

Replay evals decide. The scorecard points them at the stage that needs one.

## Two sets: global and personal

**Global** (`core/fuzz/eval_seeds/`, committed):

- Invented cases only. Each carries its own invented identity, as the extraction seeds do now.
- Read from the repo file on every run, never copied into the store. Today `evals.seed()` copies them with
  `ON CONFLICT DO NOTHING`, so a seed edited in the repo never reaches an existing store. That's the first
  thing to fix.
- Versioned by git, plus a `format` number in each file so the harness can read old and new case shapes.
  A run records the commit it used.
- Anyone can run them: `fuzz eval run --set global`.

**Personal** (`eval_cases` in the person's store):

- Real cases from that person's corrections: Not a task, confirmed misses, spot checks, sent drafts.
- Local only. Never exported, not even to a private repo: that would defeat the 90-day expiry.
- `eval_cases` gains a `scope` column (`global` | `personal`) so results report the two sets apart.

**Which sets gate which change:**

| Change | Must pass |
| --- | --- |
| Skill text or core code (in the repo) | The global set, in CI |
| A lesson learned for one person | That person's personal set, plus the global set |
| A new skill version arriving through `doctor` | Each person's personal set, on their machine, before it's installed |

The last row matters: a shared skill update can break what someone's own lessons had fixed, and only
their personal set can see that. `doctor` runs it and warns (or holds the update; see Open questions).

## From a real case to a global one

1. A real case is made from a correction, as now: private, local, expires after 90 days.
2. A model writes an **invented copy**: the same shape and the same trap ("a buried ask in the third
   paragraph of a long thread, from a manager, phrased as a question"), with nothing carried over: no
   names, companies, projects, dates or wording.
3. **Must-fail check:** the copy is scored on the version that failed the real case. If it passes there,
   it lost the trap and is rewritten.
4. **Leak check:** the copy is compared with the person's entity tables (`entities`, `identifiers`,
   `aliases`) and with the private case's text. Any known name, address or domain, or a long run of shared
   words, fails it.
5. The person reads it and says yes. Only then can it be committed.

Steps 3 and 4 run on the person's machine, where the private case lives. The commit carries only the
invented copy and a note of what it tests.

## Versioning

1. **Each case has a fingerprint:** a hash of its input and its expected result. A re-fetched message or a
   changed label makes a new fingerprint, and older results for that case stop counting.
2. **Each run records the fingerprints it scored**, alongside what it already records: skill version and
   copy, lessons, client, model, and the global set's commit. Since issue 45 it also records three ids that
   tell the app from the cases:
   - `app_commit`: the repo commit the app ran at (code and skills, not the cases or tests), with
     `+dirty.<hash>` for uncommitted edits, so two runs on the same edits read as the same app.
   - `set_hash`: the cases scored, as one id (their keys and fingerprints).
   - `judge`: a hash of the source of the code and prompts that grade, so editing a judge moves it with
     nothing to bump.
   A skill read at a git ref records the commit the ref named (`git:main@1a2b3c4`): `main` moves.
3. **Two runs are compared only on fingerprints they share.** The gate already ignores new cases; this
   also covers relabelled and expired ones.
4. **A real comparison re-runs the old version.** "Is B better than A" runs both on today's cases, like
   `--against` but fresh. Stored runs stay useful as history.
5. **Run outputs expire.** `eval_runs.results` keeps every reply and never expires. For extraction that's
   short ask text; for drafts it would be whole emails. Results on personal cases expire with the cases
   (90 days), keeping only pass counts and fingerprints.

## Scoring a comparison

- Per case: **fixed** (failed before, passes now), **broke**, **unchanged**, or **flaky**. A case is flaky
  when its repeats split (2/3 → 1/3); report flaky cases apart, never as a break.
- The answer is the counts: "3 fixed, 1 broke, 1 flaky". If a number is ever wanted, a sign test on fixed
  against broke fits.
- Keep two kinds of case: hard ones a change should improve, and solved ones that must stay solved. The
  gate is "nothing solved broke"; the improvement is how many hard ones it fixed.
- Hold the model fixed. Copilot's default model is recorded as null, so comparisons pass `--model`.
- Record time and tokens per run, so "better" can't hide "three times slower".

## Changing the evals and the app

A score that moves after both the cases and the app changed can't say which did it (issue 45). So change
one side at a time, and let the tools say when both moved.

**Reading two runs.** `evals.attribution(before, after)` splits them, and the Evals page and every run's
summary show it:

- **App:** what changed on the app's side: code, skill, copy, client, model, lessons, judge. A run from
  before these were recorded says *not recorded* rather than guessing.
- **On the cases both scored:** the score on the cases both runs scored with the same fingerprint. That's
  the app's effect, and the arrows on the Evals page show only this.
- **Cases:** cases added, relabelled (new fingerprint) and gone (expired, retired, another set), and how
  many of each pass. This is the cases' effect; the page marks it `+2 −1 ~1` beside a score.
- **Both changed:** the app and the cases both moved. The whole score says nothing on its own, but the
  score on the shared cases still does. Personal cases expire, so a run on `--set all` weeks after the last
  often shows this; `--set global` keeps it to the repo's cases.

Any run can be set against any other of the same eval: the run picker on its page (`GET /evals/<id>?vs=<id>`).

**Changing the cases** (adding seeds, relabelling, approving copies):

1. Commit the case changes alone, with no app change in the same commit.
2. `fuzz eval rebaseline`. It scores the app the baseline scored (its skill at its commit, its lessons and
   model) on today's cases, gated against it. Only the cases moved, so whatever the score did is theirs. A
   new case that fails is the next thing for the app to fix, not a regression.
3. The rebaseline is now the baseline the next app change is gated on.

**Changing the app** (a skill, a lesson, the core, the model):

1. Leave the cases alone.
2. `fuzz eval compare --base-ref <before>` runs old and new on today's cases, or `fuzz eval run` gates on the
   baseline. Every difference is the app's.

**When a branch changes both,** do it in that order: rebaseline after the case changes, then score the app
change. Rebaseline works with the app already changed in the working tree, since it reads the skill from
the baseline's commit.

What rebaseline can't hold fixed: only the skill text and lessons come from the baseline. The harness and
the judges run as they are now. When the code outside the skills has changed since the baseline's commit,
the run records today's commit and says so in its notes, and when a judge changed it says that too. Scoring
the whole old app (a temporary worktree at the commit) is still to come.

## Surfaces

### Extraction: is there an ask, and whose? (built)

As in `docs/self-improving.md`, with two new sources of cases:

- **Confident false positives.** A case is made today only from Not a task on an "Is this yours?" card.
  When extraction says an ask is plainly yours and you let it go quickly, nothing is recorded, and those
  are its real false positives. Let go within a day stays a weak label: it suggests a spot check, never
  makes a case by itself.
- **Wording.** A retitle says what the ask should have said, which gives a second score beyond keep or
  skip.

### Missed asks (extraction's false negatives)

A miss is found today only when you notice it and add a task saying so. Ways to find more, most reliable
first:

1. **Spot checks.** A few times a week, a random message extraction judged to hold nothing for you comes
   back as "Was there anything for you here?". This is the only way to estimate how often extraction
   misses that isn't skewed toward the misses you'd notice anyway. Weight the sample toward your manager
   and direct messages, and keep some purely random. A yes goes through the existing `missed.py` flow.
2. **Tasks you typed.** For each task with no source message, look for a message extraction read from the
   same people around the same time. One where it found no ask for you is a likely miss, confirmed on a
   card.
3. **Someone chasing.** A later message in a thread says "any update?", "following up" or "did you get a
   chance" and the thread has no task. Strong, and easy to find.
4. **Your replies.** You replied but no task exists. Weak: many replies are conversation. Used only to
   choose spot checks.
5. **A second opinion.** A stronger model, or several runs, on skipped messages; where they disagree
   becomes a card. Shares the model's blind spots, so it picks cards and is never a label.

Only spot checks measure the miss rate. The rest find misses cheaply. Each confirmed miss is a personal
case, and can become a global one through the steps above.

### Duplicate matching (no model)

Merge and kept-separate answers are labelled pairs. Replaying `matching/dupes.py` on them gives precision
and recall at each threshold, with no model calls, so it's fast and gives the same result every run.
This is the `tune_matcher.py` idea in `docs/self-improving.md`. Labels are personal; invented pairs with
the same traps (same name at two companies, one person with two addresses) go global.

### Senders: person, bot, list or brand (no model)

`senders.classify()` says what a sender is from what a message carries (name, address, Slack ID) and what Fuzz
knows about the address (whether the org directory found them, the other names it has sent as). It's rules, so
the eval is a replay like Duplicates: labelled senders, the same answer every run. The global set
(`eval_seeds/senders.json`) is invented from the traps a real store holds: a tracker relaying as whoever
commented, a person's name on a no-reply address, a `Grp-` list, "Name at Company" marketing, a person whose
address is an employee number or an old surname. Public services (github.com, linkedin.com) keep their own
addresses; everything else is on the example domains.

The costs aren't even: a person taken for a bot drops out of People and "waiting on", while a bot taken for a
person is only clutter. So when nothing decides, it's a person, and every run reports `people_hidden` (labelled
people it called something else) beside the confusion table. The gate is the usual one: nothing right went wrong.

Directory: "not found" has to mean looked up and not found. An address nobody looked up is unknown (`null`),
never `false`: treating the two alike once filed 150 colleagues as team mailboxes. Personal labels (your own
corrections) are still to come.

### Fact judgments

Whether two values say the same thing (Mgr and Manager, a source updating itself). Small yes/no
judgments, so invented seed cases come first, as extraction's did.

### Drafts (personal, part of self-improvement)

The reference is what the person sent: the draft as approved, as edited and then approved (the edit event
keeps the text before and after), or, for a task they did themselves, their reply fetched from Sent the
way the executor fetches a message for an extraction case. Withdrawn and "not yet" have no reference:
they get the fixed checks and the person's note, if any.

Three scores, reported apart:

1. **How much was changed:** word-level edit distance against the reference, normalised by length.
   Approved as written is 0. Cheap and objective, but it counts rewording the same as fixing a wrong fact.
2. **Point by point** (the main score). A model splits the reference into its points: facts stated,
   commitments made, questions asked, the next step. Points the draft **missed**, and points it **added**
   that you didn't send. Added points are usually invented facts or promises you wouldn't make, the worst
   kind of mistake.
3. **Tone and form:** length, greeting and sign-off, how direct it is, asked about one at a time against
   `docs/fuzz-tone.md`, so tone never hides a missed point.

A comparison scores both versions' drafts against the same reference and counts which missed or added
fewer points per case. The drafts learner (style per person, corrected facts) is gated on these cases.

Global draft cases test only rules that hold for everyone, on invented cases: no invented facts, the right
recipient and thread, no commitments the context doesn't support.

### Executor judgment (global, from spot checks)

**Spot check.** You pick a finished executor run and answer a few questions on a card:

- Did it gather the right context before acting?
- Did it hand back for the right reason (access, context, judgement, ambiguous), or give up too early?
- Did it guess when it should have asked, or ask when the answer was in front of it?
- Is the brief accurate?

**Global case.** Each judgment becomes an invented task with invented sources, and an expected result
written as behaviour to check, never exact text: "hands back as access", "doesn't draft before finding the
meeting date", "asks permission before writing to the shared drive". Behaviour checks carry over to
anyone's data, which is what makes them global.

**Harness.** The executor works through a chain of tool calls, unlike extraction's single judgment. These
cases need fake tools that serve the invented sources and record what was called and what was written
back. That's a larger build than the extraction harness; `core/fuzz/roles/scripted.py` may be a start.
The spot-check card comes first, so labels collect while the harness is built.

## Outcome scorecard

Read from the event log and split by `runs.prompt_version`, one column per version:

- Tasks let go within a day of extraction (likely false positives)
- Handbacks per claimed task
- Tasks that came back or were reopened
- Drafts approved, edited, sent back or withdrawn
- Reschedules and postponed cards

Not proof: a jump right after a version change is the signal to build a replay eval for that stage. Kept
in Fuzz's voice where it's shown (`docs/fuzz-tone.md`): never a score of the person.

## Build order

Everything but the outcome scorecard is built (see **Built**). Next:

1. **Outcome scorecard.**
2. **More executor cases** from spot-check answers, as they come in.
3. **Later learners** (`docs/self-improving.md`): handback causes, source trust and the weekly retro, each
   shipping with its own cases in the same change.

How the harness differs from a real executor run: the model answers one tool call per turn through the plain
client call, rather than calling MCP tools itself, and the person's connectors are stand-ins. It scores the
judgment (what to look up, when to ask, what to write), not the client's tool plumbing.

## Open questions

- Does `doctor` hold a skill update that breaks a personal case, or install it and warn?
- How many spot-check cards a week before they feel like a chore? Built with three message checks and two
  run checks a week; adjust in config.
- Leak check thresholds: built with six words in a row; first names alone aren't flagged, full names,
  surnames and aliases are.
- Whether a case's invented copy, once committed, retires the personal case early or both keep running.
  Built: both keep running.
- Where invented copies are reviewed: a card in Fuzz, or a pull request. Built: the command line
  (`fuzz eval copies`, `approve`), then the diff in a pull request.
