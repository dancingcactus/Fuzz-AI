# Evals: telling better from worse

Status: design, worked out in conversation on 2026-11-17. Nothing here is built yet. It extends the Evals
section of `docs/self-improving.md`, which built the extraction harness (`core/fuzz/evals.py`), and is the
plan for growing it into something that answers one question for any change: **is this better or worse
than what we had before?**

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
   copy, lessons, client, model, and now the global set's commit.
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

1. **Global set from the repo.** Read global cases from `eval_seeds/` on every run; add `scope`; report the
   two sets apart.
2. **Fingerprints.** Per case, recorded by each run; comparisons on shared fingerprints; fresh
   head-to-head runs; fixed, broke, unchanged and flaky counts in the summary.
3. **Run outputs expire** with their personal cases.
4. **Invented copies:** the must-fail check, the leak check, and a review card before commit.
5. **Spot-check cards** for missed asks and for executor runs, collecting labels now.
6. **Duplicate-matching replay.**
7. **Outcome scorecard.**
8. **Draft scoring** (personal), once there are enough sent drafts to score.
9. **Executor harness** with fake tools, then the first global executor cases.

## Open questions

- Does `doctor` hold a skill update that breaks a personal case, or install it and warn?
- How many spot-check cards a week before they feel like a chore? Two or three is the starting guess.
- Leak check thresholds: how long a shared run of words counts as copied.
- Whether a case's invented copy, once committed, retires the personal case early or both keep running.
- Where invented copies are reviewed: a card in Fuzz, or a pull request.
