# Book it, then work it: time that Fuzz finds, and a habit that adapts

Status: **built 2026-11-23** on branch `worktree-book-then-work` (see "What was built, and what was not" at the end). Decided in conversation on 2026-11-22; rulings marked **Ruled**, the rest are my defaults.
Nothing here has been tried with someone who has ADHD, and the ADHD reasoning is from general knowledge, not citations,
so treat it as hypotheses (same caveat as `docs/card-actions.md` Part 3 and `docs/onboarding.md`).

## The problem

On the Guide, the things in My work are too big for the time you actually have. Three causes:

- The Guide judges "Fits" against the gap to your next meeting (`setChoice` in `js/view-deepwork.js`), not your real time,
  so on an open afternoon everything fits.
- Where you left off goes first even when it's big, and `suggestion()` takes `tasks[0]`.
- "I'll do it" drops a task into the queue with no time. Nothing connects a big task to a moment to do it, so the queue
  only grows.

## The model

**Every task that is yours has a time, or it is postponed. There is no queue of "yours, someday".**

- **Triage decides.** A task that is yours and takes real time gets **Book time** (Fuzz's slot pre-picked, one tap, Undo) or
  **Later** (postpone). **Ruled:** "I'll do it" goes away.
- **A booked block starts the work.** The calendar link opens the Guide with the task picked and the time set. The task is
  prepped 30 minutes before (already built).
- **Triage time is its own slot, at a consistent time, to build a habit.** **Ruled.**
- **Work time is found by Fuzz,** in the hours you say are your best, then adapted from what happens. **Ruled** (ask
  first, then learn).
- **Starting cold is for spare time.** With no booking, the Guide offers something that fits the minutes you have.

## Time Fuzz finds

### 1. Ask once, early

A setup card, in Fuzz's voice, arrives after some real work (setup cards never open the app): **"When do you usually
get things done?"** Answers: Mornings, After lunch, Late afternoon, It varies. Skip is in the row. It is asking for a
starting guess, not a setting; the card says so ("I'll watch what works and adjust").

### 2. Fuzz proposes the blocks

- Two or three work blocks a week, about 90 minutes each, never over 120 (`BLOCK_MAX`). **Ruled.**
- Placement uses what exists: your Focus time events first, then free time inside your good hours, then other free time
  (`booking.ranked` gains one tier).
- One card for the week ("Tue 9:30–11, Thu 9:30–11. Put these on your calendar?"), through the usual approval gate, with
  Always allow for your own calendar.
- A block with no task carries `#/work?until=HH:MM`, which the Guide already reads: "This is your work time. Where do you
  want to start?" A block booked for a task keeps `#/work/<id>?until=`.

### 3. Two weeks stay scheduled, and one week is added each week

**Ruled.** Fuzz keeps the next two weeks of Focus time and Triage time on your calendar, and once a week it adds the week that has just come into view.

- **One card a week,** short, through the same approval gate: "Here's Focus time for the week after next. Put it on your calendar?" With Always allow for your own calendar, it just happens and Fuzz says so once.
- **The learning applies to the new week only.** What's already on your calendar stays where it is; a change of pattern shows up as the next proposal, never as events moving under you.
- **Keeping the window full** also covers misses and moves: a block that went by, or was moved by you, doesn't leave a hole, since the next top-up fills to two weeks again.
- **Triage time** is a recurring event where the calendar tool can do it, so it needs no weekly top-up. Where it can't, it follows the same two-week window.
- **With the ICS fallback,** a weekly top-up means a weekly download, which is easy to ignore. Open (see below): a two-week file first, then a "Add next week" card.

### 4. Triage time is a habit slot

- About 30 minutes, the same time on working days, a recurring event. Link: `#/triage?until=HH:MM`.
- **Consistent beats optimal.** Fuzz picks one time and keeps it. It does not shuffle it to fit the calendar; if a day is
  blocked it skips that day and says so once, and the slot stays where it was.
- Default for placement (not ruled): a time outside your best hours, so Triage doesn't spend the good time.
- Moving it is the user's call, or Fuzz's after sustained misses (below), and it asks first.
- **Ruled:** when the calendar tool can't make the slot (no tool, or it can't do recurrence), Fuzz generates an **ICS file to download**.
  Recurring Triage time is one ICS with a weekday recurrence rule. Work blocks use the same fallback, one event each. This replaces
  today's "Add it to your calendar yourself; it's booked in Fuzz" (`tasks.book`); the onboarding already has a browser-side ICS maker
  to reuse (`js/onboarding.js`).

## Learning: kept, and productive

Fuzz scores each block and each part of the day, per weekday where there's enough data.

| Signal | Where it comes from | Reads as |
|---|---|---|
| **Kept** | You opened the session or the link inside the block (`booking.tick` already checks for a human event in the block) | The slot works |
| **Missed** | The block went by (`missed_block`, existing) | The slot may not |
| **Productive** | Minutes worked, steps done, finished vs wrapped up, Keep going used (from the session recap and the log) | The time suits the work |
| **Cut short** | Left in under a few minutes, or wrapped for a meeting | Neutral. Not a miss. |

Adapting, kept slow on purpose:

- A part of the day with several kept and productive blocks ranks higher next time. One with several misses ranks lower.
- **A change is proposed, never silent,** and only on a sustained pattern: "Mornings have been hard to get to. Want to try
  after lunch?" A single miss changes nothing. Nobody is told how many they missed.
- Triage time works differently: **a missed Triage time does not move it,** because the habit is the point. After a run of
  misses Fuzz asks whether the time is wrong, once.
- The learning is a hypothesis about when you work best, and it can be wrong. People misjudge their own best time, so the
  first answer is a guess the data can overrule.

## The Guide, once there is no queue

**Ruled (2026-11-22):** the Guide depends on the moment.

| Where you are | What happens |
|---|---|
| **In a Triage block** (you opened `#/triage?until=…`, or the slot is now) | Triage starts. No Guide. |
| **In a work block** (`#/work/<id>?until=…` or `#/work?until=…`) | The work starts. For a block booked for a task, that task's session begins. For an open work block, it begins on what fits best (see below). No Guide, no Start button. |
| **Neither** (a cold start, for spare time) | The Guide, with three doors. |

**The three doors**, in one list, one picked, in this order:

1. **Triage**: "Quick decisions, I do the rest". Disabled when Triage is clear.
2. **Something else**: work on something that's already a task. **Ruled:** it opens a search interface, a box you can type in with Fuzz's suggested
   tasks listed under it, so you can scan or search. Picking one asks "How long do you have?" with the right chip already picked (the default is your real free
   time, not 50 minutes). **When a task finishes, Fuzz recommends the next one** and offers Something else (the same search) instead. The same loop runs
   inside a work block, so you never come back to a bare Guide in the middle of working. (Read as: a search over your existing tasks, filtering as you type.)
3. **New task**: the typed field, "Tell me what you want to work on". It makes a task and starts on it.

Fuzz's line above the list says which door it suggests and why, and that row carries the **Fuzz suggests** tag (as now). The three doors
are the same every time, so the Guide is the same shape every time (re-entry after an interruption).

What changes from today's Guide:

- The old "My work" group, with a row per task, goes. Its job moves behind **Something else**.
- "Something else" used to be the typed field. That is now **New task**, which matches the header's **+ New task** button.
- "More from My work (N)" goes. The list behind Something else is short and ordered by what fits, so there's nothing to hide.

**What "fits" means** (this fixes the original problem). Behind Something else, in order:

1. A task booked for later today or this week that fits the time you have. Starting it early works, and the hold comes off the calendar
   (`calendar_remove`, already built).
2. A big task in Triage, as a first piece ("a first step, ~25 min"), not the whole of it.
3. Small tasks that fit, quickest first.

Nothing is ever listed as "Fits" against a meeting gap that's hours long: the time chips decide the budget, and the default chip is what's
free before your next block or meeting.

**An open work block with nothing booked for it.** The block starts the work on the best fit from the list above, with Fuzz saying what
it picked and one tap to pick another. Nothing fits: it says so and offers Triage or New task, never an empty screen.

**Safeguards for starting by itself** (a link now starts the work instead of stopping one tap away from Start):

- Only inside the block. A link opened after the block ended goes to the Guide, with "That time has gone by."
- A running session is never ended by a link (as today).
- A way out is always visible: the label's "Back to the Guide", and the wrap-up already offers Back in my work (retired with the queue: it becomes Book time or Later).

## What "I'll do it" leaving changes

This is the larger consequence. Nothing below is built, and some of it needs your ruling.

| Piece | Today | After |
|---|---|---|
| Triage card | Hand it to Fuzz, I'll do it (G), Do it now, Book time, Later | Hand it to Fuzz, **Book time** leads for a task that's yours and big, Later. G is retired. |
| My work | A queue (core state `deepwork`) shown in Lineup and the Guide | No queue. The Guide's group becomes **Booked** (blocks that are now, or soon) plus "fits your time" for a cold start. |
| Starting cold | Pick from the queue | Pick a task from Triage or a booked one that fits the minutes you have (the Guide already starts a task in `triage` or `scheduled`). |
| Do it now | The working card in Triage | **Ruled: retired** (nav-guide Q7 answered). A small task you'll do yourself: do it, then press Done. Nothing needs to open. The working card, its Pause and Keep going, and the `doing` tag go with it. |
| A missed block | Back in Triage, "Find another time?", two misses lead with Help me start | Unchanged. This is the postpone path. |
| Existing My work tasks | Sitting in the queue | One-off migration: each gets a card offering a time or Later. Nothing is dropped. |

Things this has to get right:

- **No slot, no dead end.** If the calendar has nothing before the due date, Book time says so, and the card offers Later
  and Hand it to Fuzz. Booking is never the only way out.
- **A small task shouldn't need a booking.** "Book time" is for big tasks (45 minutes or 5 steps, `booking.is_big`); small
  ones keep Done, Hand it to Fuzz, Later. **Ruled:** a small task you do yourself has no special action. You do it, then press Done.
- **Booking is a commitment made while tired.** It stays one tap with Fuzz's slot picked and Undo, and Later is equally
  easy, so choosing it isn't a failure.

## Park and Let go: dead ends you choose

The point of "no queue" is not that nothing may stop. It is that **a stop is a decision, not a place a task drifts into.** Every task ends up
in exactly one of these, and each is a deliberate answer:

| It is… | Because you chose… | What happens next |
|---|---|---|
| **Booked** | Book time | It comes back as Focus time, at the time you picked |
| **Later** | A time to look again | It returns to Triage then |
| **Parked** | "Not now, and I'm not committing to a date" | It stays out of the way, and Fuzz checks in on it every so often (the parked check-in: Bring it back, Keep it parked, Let it go) |
| **Waiting on someone** | The ball is theirs | It returns when they answer, or Fuzz checks again |
| **Not mine** | It was never yours | It leaves, and Fuzz may learn who it belongs to |
| **Let go** | "I'm not going to do this, and that's fine" | It closes. The record stays, and Undo is there |
| **Done** | It's finished | It closes |

Why this matters:

- **Park and Let go are the honest exits.** Without them, "I'll do it" with no time became a place to hide a decision. Now
  postponing is Later, shelving is Park, and releasing is Let go, so nothing sits half-decided.
- **They are not failures.** Neutral words, no counts, and the same weight as booking. Letting go is allowed to be the right call, and Fuzz never says "you
  gave up on". The check-in on a parked task asks if it still matters; it doesn't scold.
- **A dead end you chose is different from one you fell into.** A task that is parked has a reason and a check-in. A task that was in a queue had neither.
- **The counterweights stay.** A task postponed again and again becomes the keeps-coming-back card, which asks what's in the way, so Later can't turn
  into quiet avoidance. Parking has the same check-in cadence, so it can't either.
- **A rule for the build:** no state without an exit and no action without an Undo. A task must always be one tap from a decision, and never stuck.

## Against the ADHD principles

| Challenge | What helps | Verdict |
|---|---|---|
| **Starting** | When and how are decided earlier, when you're calm; the block arrives with a prepped first step | Strong |
| **Queues that grow into shame** | No "yours, someday" pile: a task has a time or is postponed, and postponing is neutral | Strong in principle. Risk: a booking that feels like a promise. Wording and Later's weight matter. |
| **Habit** | A consistent Triage time at a fixed hour, the habit-forming part | Reasonable. Consistency matters more than the exact time. |
| **Time blindness, planning fallacy** | The block sets the real time; blocks cap at 120 minutes | Reasonable |
| **Self-knowledge** | Ask first, then adjust from what's kept and productive | Reasonable. The guess is revised by evidence. |
| **Avoidance** | A missed block returns to Triage with the existing neutral card, and repeated misses lead with Help me start | Reasonable. The risk is booking as polite deferral, which the miss counter catches. |
| **Dead ends** | Park and Let go are conscious, neutral choices with a check-in, so a stop is a decision and not a pile | Strong in principle. Risk: Park as a way to avoid, which the check-in cadence catches. |
| **Calendar clutter, surveillance** | Everything on the calendar goes through the approval gate; the learning is shown as a question, not a verdict | Reasonable. Say plainly what is tracked. |
| **Triage stays short** | Booking is one tap | Reasonable. The ~15-minute rule still holds. |

## Decisions still open

1. **Does the early ask come with the first calendar read, or after a few cards?** I'd say after the first calendar read, so
   Fuzz can show real slots in the same card.
2. ~~Do it now~~ **Ruled:** retired.
3. ~~Names~~ **Ruled:** the session and the blocks are **Focus time** (the Guide's doors stay Triage, Something else, New task). This reverses the
   2026-11-15 "My work" ruling. In this doc, "work block" means a Focus time block. Fuzz's blocks are titled "Focus time", so `booking.is_focus` already
   treats them as the first place to book into, and an empty one is a slot a task can be booked into. The wrap-up's "Back in my work" becomes Book time or Later.
4. **Triage time placement:** outside your best hours (my default) or right before the work block?
5. ~~Recurring events~~ **Ruled:** if the calendar tool can't do it, Fuzz offers an ICS download.
6. ~~Links that start the work by themselves (nav-guide Q3)~~ **Ruled:** inside a block, the link starts the work (see the Guide section).
   This reverses the nav-guide default of one tap from Start.
7. ~~A pick behind Something else~~ Settled in the Guide section: it asks, with the right chip picked.
8. **ICS fallback and the rolling window:** a two-week file, then an "Add next week" card, or a weekly download? Default: the first.
9. **Triage time placement:** still open (item 4).

## What was built, and what was not

Built (core `rhythm.py`, UI `js/ics.js`, the Guide, the Triage cards; tests `core/tests/test_rhythm.py`, `tests/ui/rhythm.test.mjs`, `nav.test.mjs`):

- **Triage:** I'll do it (G), Do it now and the working card are gone. A big task, and a task that waited in the old queue, lead with Book time and Fuzz's slot.
- **The Guide:** three doors; Something else is a search with suggestions (what fits first, a big task as a first piece, where you left off first among
  what fits); New task is the typed field; the time chips default to at most 90 minutes. After a task finishes, Fuzz suggests the next one and offers the
  same search.
- **Links:** inside a block, `#/work/<id>?until=` starts that task, `#/work?until=` starts on what fits best, with no tap; after the block, or with no time,
  the Guide opens and nothing starts.
- **Wrap-up:** Book time to finish, Later (tomorrow morning) or Hand the rest to Fuzz. With no slot (still loading, none free, a failed load) it falls
  back to Later instead of stalling.
- **The question and the plan:** the card "When do you usually get things done?" (after the first calendar read, once, and once more a week later after
  Not now); two weeks of Focus time (three 90-minute blocks a week, on different days, in your best hours, your own Focus time slots first) and a Triage
  time chosen once and kept; a weekly top-up that never moves what is there; one card (or none with Always allow); holds through one hidden holder task, or
  a calendar file with a repeating Triage event when no calendar tool is set up.
- **Learning:** blocks are kept or missed (a human action inside the block), minutes and finished are reported from the wrap-up, and a sustained pattern
  (three misses in the last four in a part of the day, another part doing better) aims the next week elsewhere, said on the card. The Triage time never moves.
- **Safeguards found in review:** a Skip holds until next week and a skipped slot is never offered again; the first plan always asks, even when you
  already allow your calendar (only a top-up can happen without a card, and it says so once on the Guide); minutes you worked inside a block make it kept,
  even for a task you resumed and even when the wrap-up arrives late; Something else only offers a plain task card you can start (not a draft for your OK,
  Fuzz's first task, a group run, a permission or an answer); a link carries the block's start (`&from=`), so one opened early shows the Guide and says when
  it starts; the repeating Triage event leaves out the days that had no room (EXDATE); the holder task is out of the away summary; the question is asked
  a few days after the onboarding even with no calendar read (Fuzz then plans in your working hours).
- **Migration:** what waited in the old queue comes back to Triage once, asking for a time.
- **Docs:** README, `core/README.md`, `card-actions.md`, `energy-and-priority.md`, `onboarding.md`, `nav-guide.md` (a banner).

Not built, or built differently from what this doc says:

- **The working card is retired** (the `doing` tag, Do it now, and the working card's Pause). Help me start's first step comes back as an ordinary
  result with step 1 first. Booked time that has started comes back as a plain card, first in the list, that leads with **Start Focus time** (the
  calendar link does the same); a block's end keeps its own card (Done, Keep going, Book the rest, Pause under Later) because booked blocks still end.
- **The question has four answers plus Not now** (Mornings, After lunch, Late afternoon, It varies), which the card shows as a lead, a row and a chevron.
- **Settings has a Focus time section** (when you get things done, the Triage time, what is coming up, and plainly what is tracked). The sender skill is
  unchanged: with a calendar tool, Triage time is individual events; the repeating rule is only in the calendar file.
- **Your own Focus time events** are used as the first choice of slot, but Fuzz still adds its own hold (with the link) in them; it can't edit yours.
- **What is tracked** is said plainly in three places: on the first question card, in the weekly plan's copy, and in Settings › Focus time.
- **Tasks left mid-session** when you close the app stay in the session state; they show first under Something else ("Where you left off") instead of
  becoming a queue.
- **"One tap to pick another" after an auto-start** isn't built; Stop here (Esc) and the Guide are the way out.
- **File top-ups:** each weekly calendar file would carry the Triage series again with the same id; once it exists, a top-up should leave Triage out.
- **The live core's migration** runs on the first tick after the core restarts. Test it on a copy of the live store first (engine off, port 8777).
- **Not tried with anyone.** Nobody with ADHD has used any of this, and the ADHD reasoning has not been reviewed by someone qualified.
