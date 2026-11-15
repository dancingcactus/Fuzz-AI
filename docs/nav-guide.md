# The Guide: one starting place, and the nav around it

Decided on 2026-11-14, over six rounds in the spike at `spikes/nav-modes/` (open it with a static server at the repo
root and go to `/spikes/nav-modes/`; it opens on option **E**, the one we chose). This document is the hand-off for
building it into the app. It covers what we decided, how it should behave, where it fits in the code, what we tried and
dropped, and what's still open.

## The model in one paragraph

**Triage** keeps things moving: one card at a time, quick decisions, and Fuzz does the rest. When a task is yours and
takes real time, you say **I'll do it**, and it goes into **My work** (core state `deepwork`) while Fuzz gets it ready.
**Deep Work** is only the session where you do that work. The **Guide** is the one place you start from: it asks
"Where do you want to start?" and lists Triage, everything in My work, and Something else. **Lineup** and
**Artifacts** are places you look things up, and they live in a menu.

## What's already in the app

Commit `21df88e` (on branch `worktree-nav-spike`) already did the wording for the queue:

- The triage card's G action is **I'll do it** (button, menus, key guide, the "This is a big one" choice).
- Fuzz replies "Got it, it's yours. It's in your work, and I'll have it ready when you sit down to it." The offer adds
  "It won't come back to Triage, and Fuzz gets it ready for when you start." Undo reads "You'll do it: '…'".
- The queue is called **My work** in Lineup (its section, rows marked Ready or Started), on the Deep Work page, in the
  nav dot's label, in task status ("In My work, ready when you start"), in task logs, in check-in lines, in the demo
  data, and in the core's log lines (`core/fuzz/tasks.py`, `core/fuzz/checkins.py`).
- "Deep Work" stays wherever it means the session ("Done for now in Deep Work", "You started this in Deep Work").

Everything below is still to do.

## The header

```
[Fuzz logo] Fuzz  ( Guide )                                [+ New task] [Undo] [Fuzz's head]
```

- **Remove the nav links** (Triage, Deep Work, Lineup, Artifacts) and the Settings gear.
- **The Fuzz logo opens the Guide.** It's the way home, the way people expect a logo to work.
- **Next to the wordmark, a label says where you are.** It is the only nav element. Clicking it is the way back: to
  your session if one is running, otherwise to the Guide.

| Where you are | Label |
|---|---|
| The Guide | **Guide** (current page) |
| Triage | **Triage** · Back to the Guide |
| Triage, from a calendar link | **Triage** · Until 1:30pm · Back to the Guide |
| A Deep Work session | (clock ring) **Deep Work** · Write the onboarding plan… · 14 min |
| A session, on a break / paused | **Deep Work** · On a break / **Deep Work** · Paused |
| Wrapping up a session | **Deep Work** · Wrapping up |
| Lineup, Artifacts | **Lineup** · Back to the Guide (same for Artifacts) |

  The task title is cut to about five words with "…". The label must stay one line, and on a phone it sits on its own
  row under the logo and buttons (see the spike at Width: Phone).

- **The "something's waiting" dot sits on the label.** No numbers anywhere in the nav. The dot shows only when there's
  work you can't see from where you are:
  - On the Guide: no dot (the list shows it).
  - In Triage: no dot (you're clearing it).
  - In Lineup, Artifacts, a file, Settings: a dot if Triage has anything or My work has anything.
  - In a Deep Work session: a dot **only for something that can't wait** (time-sensitive), so it never pulls you out of
    focus for ordinary work.
  - Its accessible label: "things are waiting" or "something can't wait". This replaces today's Triage count/✓ and the
    Deep Work dot (`updateCount()` in `js/app.js`).
- **The menu is a small round icon button on the right**, the same style as today's Settings button, with **Fuzz's
  head** as the icon: a line-drawn TV with two antennas of different lengths. The spike's SVG is in
  `spikes/nav-modes/nav.js` (`FACE.fuzz`). Its menu, in order:
  1. **Lineup**: "Who has the ball", with a one-line summary
  2. **Artifacts**: "What Fuzz made", with a one-line summary
  3. a divider
  4. **Settings**: "Themes, connections, how Fuzz works"
  5. **Keys and help**

  Escape closes it, and clicking outside closes it.

## The Guide

The app opens here (today it opens on Triage). A new route, `#/guide`, also takes the empty hash.

**Fuzz's line** sits at the top, from the perch, and suggests where to start. The rules the spike uses:

1. Right after a session: a recap ("Nice: 45 minutes on 'Write the onboarding plan'. I saved where you left off."), plus
   "While you were in it: 2 new in Triage, nothing urgent."
2. If the session ended for a meeting: "Go, your 2pm is starting. Triage will be here when you're back." If time ran
   out: "Good stretch. Take a break, then a quick look at Triage."
3. Something time-sensitive is waiting: suggest Triage ("Something has a time on it. Let's clear Triage first. It's
   quick.").
4. A lot is waiting (5 or more): suggest Triage first ("…then you'll have room to go deep").
5. My work has something and you're free: suggest the top of My work ("You've got until 2pm and nothing urgent. Good
   time to go deep.").
6. Otherwise suggest Triage.

**Then one panel with one question: "Where do you want to start?"** It's a single list of radio rows, and you pick
exactly one:

- **Keep things moving**
  - **Triage**: "Quick decisions, I do the rest", with "One has a time on it." in front when that's true. It shows
    "~N min" on the right, about 1½ minutes a card. It's disabled when Triage is clear ("Nothing is waiting on you",
    "Clear").
- **My work**
  - One row per task in My work, in Fuzz's order (where you left off first, then what fits the time). Each row shows
    the title, a line under it (where you left off, or what Fuzz prepared), and "~N min".
  - **Something else**: "Not on the list? Tell me". Picking it turns the row's title into an inline text field with
    the placeholder "Tell me what you want to work on", and focus goes into it. As you type, the line under it changes:
    - It matches a My work task: "That sounds like '…', and it's ready. **Use that**".
    - Otherwise: "New. I'll make it a task and pull in anything that goes with it."
    - Text stays if you pick another row, and the row then shows your text with "Something else, in your words".
- **Fuzz's suggestion** is pre-picked and tagged **Fuzz suggests**.
- **How long do you have?** appears as soon as a My work task or Something else is picked, not for Triage. It uses
  Deep Work's existing time chips (Until <next meeting>, A quick burst, A real chunk, A long haul, Until I stop) and a
  fit line ("Fits in your time." / "Won't fit in one go. I'll stop you at a good place.").
- **The Start button names the choice**: "Start Triage", "Start: Write the onboarding plan…", or "Tell me what first"
  (disabled) when Something else is picked but empty.

**Reuse what Deep Work already has.** `js/view-deepwork.js` `vEntry()` already has the time chips (`chips()`,
`plan()`), the one box that matches My work or makes a new task (`candidates()`, `boxHTML()`, `matchHTML()`,
`Store.captureDeep()` for "A new task, started now"), and `loadUntil()` for the next meeting. The Guide is
essentially Deep Work's entry screen with Triage added as a choice and the box turned into the Something else row.
After the Guide ships, Deep Work's own entry screen shouldn't be reachable on its own.

## Getting into Deep Work, and out again

**Ways in.** All of them land on the Guide with the task already picked, so the time question and Start are one step
away:

- On the Guide: pick a task or Something else, then Start.
- Triage, when it's clear: "Go deep on something" (today it links to `#/deepwork`).
- Lineup, on a My work row: "Go deep on this" (today it's `DeepWork.start(id)`).
- A calendar link (below).

**Inside a session**, everything that's already built stays: focus, steps, between tasks, breaks (25 on, 5 off, 15
after three), takeovers. Two behaviours change:

- **Something urgent pauses the clock** and shows only that card, with "Your session is paused. The clock waits while
  you deal with this." and Back to it. Dealing with the card returns you to the session. Check the existing takeover
  kinds in `view-deepwork.js` (`take()`) before adding a new one.
- **Walking away** pauses the clock. On return: "Welcome back. You stepped away for a bit, so I paused the clock.", with
  where you were, the next step, "Pick up where I left off", and "Stop here".

**Ways out.** All of them land on one wrap-up, then the Guide:

- Stop for now (with "Actually, keep going").
- Finished the task. If there's time left, offer the next one.
- Time's up.
- Meeting in 5 minutes. The button reads "Save it and go".

The wrap-up shows what you did, "Where you left off" (pre-filled by Fuzz, editable), and what happens to the task: Back
in my work / Hand the rest to Fuzz / Book time to finish. The existing `doneForNow()` / `vWrap()` already does most of
this. Then the Guide, with the recap line.

**While a session runs:**
- The label reads "Deep Work · …", and clicking the logo or the label returns to the session.
- Starting something else means ending the session first.
- A deep link never ends a running session; it just shows the session.

## Deep links, for calendar invites

These go in the body of calendar invites so opening one skips the choice. The time in `until` is the end of the block,
as 24-hour HH:MM.

| Link | Opens |
|---|---|
| `#/triage?until=13:30` | Triage straight away. Label: "Triage · Until 1:30pm · Back to the Guide" |
| `#/work?until=15:00` | The Guide, with the time set to the calendar block ("Until 3pm · ~N min · your calendar block") and nothing picked. Fuzz: "This is your work time, until 3pm. Where do you want to start?" |
| `#/work/<taskId>?until=14:45` | The Guide with that task picked and the time set. One tap: Start. Fuzz: "Your calendar has this time for '…', until 2:45pm. Everything's ready." |
| `#/work?what=Draft%20the%20launch%20email&until=15:30` | Something else, filled in. It becomes a task when you start |

- A link lands **one tap from Start**; it does not start the session by itself.
- The router splits on `/` and takes the first segment (`js/app.js` `route()`), so add a `work` route that renders the
  Guide with these parameters. Parse the query from the hash.
- **Where links come from:** Fuzz's calendar holds already carry a link to the task (`core/fuzz/booking.py` `link()`,
  today `#tasks/<id>`, used by `hold_body()`). Make holds for tasks in My work carry `#/work/<id>?until=<block end>`.
  Keep `#tasks/<id>` working for old invites.

## The words, in one place

| Thing | Words |
|---|---|
| The starting place | **Guide**; the way back is "Back to the Guide" |
| Its question | **Where do you want to start?** |
| Groups | **Keep things moving**, **My work** |
| The free-text choice | **Something else** → field "Tell me what you want to work on" |
| Triage card action for "mine, takes real time" | **I'll do it** (key G) |
| The queue | **My work** |
| The session | **Deep Work** (only the session) |
| Fuzz's pick | **Fuzz suggests** |
| Time | **How long do you have?** |
| Start | "Start Triage", "Start: <task>", "Tell me what first" |
| Fuzz after I'll do it | "Got it, it's yours. It's in your work. It won't come back to Triage. …I'll have it ready." |

House style still applies: no red counts, no numbers in the nav, nothing that pulses or nags, and Fuzz says it (from
the perch or the small Fuzz), never a toast.

## What we tried and dropped (and why)

- **Four equal tabs** (today). Two are modes (Triage, Deep Work) and two are places (Lineup, Artifacts), and the bar
  didn't show the difference.
- **A Triage | Deep Work toggle** (option A). It made the two stances clear, but on the page it felt like toggling the
  current task.
- **Each mode bringing its own place** (B: Lineup beside Triage, Artifacts beside Deep Work). Dropped: "Where did
  Artifacts go?"
- **One Library tab** for Lineup and Artifacts (C). The smallest change, but the modes still looked like places.
- **A "Now" tab with the start screen** (D). We loved the single starting place, but "Now" alone in the nav read oddly.
  That led to E: no tab, just the label.
- **Two-sides start screen** (Keep things moving beside Do my work). It was busier, and the single list made Triage
  just another thing to start on, which is the point.
- **"Start" as the place name.** It reads like a button, not a place. Home, Today, Desk, Your day, Base camp,
  Overview, Studio, Control room and Channel 1 were all tried. **Guide** fits Fuzz's broadcast theme (a TV-headed
  robot; Lineup is already TV language), and a TV guide is where you see what's on and pick.
- **The Fuzz logo as the menu.** Logos mean home, so it's the way to the Guide instead.
- **"Ready for you" as the queue's name.** It didn't say whether it meant Fuzz or you, or that it's your work queue.
  "Add to my work" said where it goes, but read like filing, not a decision. Also tried: I'll take it, Mine, Save it
  for me, My queue, My work queue, On my plate, My list.
- **Fuzz's antenna lighting up** as the waiting signal. On-brand, but subtle in Terracotta, and a pulse or glow nags.
  The plain dot on the label won.
- **Lineup's "Yours" lane is not My work.** It holds what's in your hands right now (needs your OK, with you, open in
  Claude). It stays "Yours", and My work is its own section.

## Open questions

Defaults are marked. Ask before going a different way.

1. **The "While you were away" screen.** Today Triage opens with an arrival recap when you've been away. Does the
   Guide absorb it (Fuzz's line on the Guide says what happened), or does it stay on Triage? *Default: the Guide's
   line carries a short version, and Triage's arrival screen stays as is.*
2. **Keyboard.** The spike used L and F for Lineup and Artifacts, but in the app F is "Say what we're working on" and
   L is "Let it go" on cards. *Default: no single-key shortcuts for the menu places yet. On the Guide, Enter starts and the
   arrow keys move through the list, like Deep Work's entry box today (`wireBox()`); number keys picking a row would
   match Triage's choices.*
3. **Should a calendar link start the session by itself?** *Default: no, one tap from Start.*
4. **A typed task starts with no prep.** Should Fuzz take a minute to gather first? *Default: start now, and Fuzz
   gathers in the background, as Deep Work does today.*
5. **Merge the core's `mine` and `deepwork` states?** In this model both mean "yours, waiting for you". *Default: not
   now; it's a core change of its own.*

## Building and testing it

- **Core tests:** `PYTHONPATH=core ~/.local/share/uv/tools/fuzz-core/bin/python -m unittest discover core/tests`
  (system python lacks the deps).
- **UI tests:** `cd tests/ui && node --test`. Each file binds a random port in 8790–9690, so don't run a live core
  there while testing. Tests mostly check states, not words, but the nav markup (`#navcount`, `#dwcount`, `[data-nav]`)
  and Triage's empty state will need test updates.
- **The live serve job runs the working tree of the main checkout.** UI changes show up there at once, but core
  (Python) changes need a `launchctl` restart. Test a worktree against a copy of the live data, with the engine off,
  on port 8777.
- Fuzz's background roles (executor, extractor, sender) don't depend on the nav, so this should be UI plus the
  `booking.link()` change.
