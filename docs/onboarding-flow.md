# Onboarding: the proposed flow

Proposed, not built. This is part of [onboarding](onboarding.md); the flow that exists today is under
[As built](onboarding.md#as-built). Related: [Dump mode](dump-mode.md), [the slow reveal](slow-reveal.md), [pointing at things](pointing.md).


Drafted 2026-11-24 in conversation; open to iteration. It replaces the current flow (described under
[As built](onboarding.md#as-built)) once it's settled. Everything here is a hypothesis, like the principles.

## The arc

The sitting teaches four ideas, in this order:

1. **Safe.** Nothing goes out without a yes, anything you do inside Fuzz can be undone, and missing a session loses nothing.
   Undo doesn't reach things that have left Fuzz, like a sent message, which is why nothing goes out without a yes
   (app principle 6 in `docs/principles.md`).
2. **Decide in one place.** Triage is where decisions happen, at a fixed time.
3. **Get it out of your head.** The dump.
4. **Let Fuzz carry it.** He works while you're away, and finds asks you'd otherwise have to remember.

Steps 1 to 4 set up Safe: the promise (2) and the tips (3) say it, and working hours (4) is an easy first win that costs nothing to get wrong. Step 5 is Decide, 6 to 8 are Get it out, and 9 to 11 are Let Fuzz carry it.

## Rules for the order

1. **Each step leaves the user with something done.** A calendar event once Triage time is booked, cards after the dump.
2. **Ask for access when it buys something on screen.** Calendar pays off at step 5. Email and IM don't until step 10.
3. **Optional things branch off and never block.** No calendar means a calendar file, not a dead end.
4. **Teach the action when the card needs it.** Step 5 teaches Assign on Fuzz's own task and shows Undo in use. Later and Book time
   are offered in the slow reveal, the first time Fuzz thinks a card suits one. Until then the first cards are chosen so
   that only the actions already taught make sense.
5. **Stakes go up slowly.** A calendar event, then the user's own words, then reading their mail.

## The steps

| # | Step | Goal (what we achieve) | Practice (what they learn) |
| --- | --- | --- | --- |
| 1 | **One paste, then the short form** (name, app) | No stall points, and Fuzz is running | None. Onboarding principle 9: one paste, then the browser |
| 2 | **Fuzz introduces himself**, with the trust promise | They can repeat what they agreed to | None. Fuzz works for you. Nothing goes out without a yes, and what you do inside Fuzz can be undone |
| 3 | **The three guilt-free tips** | Lower the stakes before asking for anything | One queue, not a pile. Ask Fuzz to change things or hand a task back. Missing a session loses nothing |
| 4 | **Working hours**, as the first Triage card | An easy first win, and Fuzz can place a time | Your time has edges, and Fuzz adapts to yours |
| 5 | **Fuzz's task: schedule 30 minutes of Triage time** | A recurring event on their calendar, and the first trust moment | Decide at a fixed time and place; consistent beats optimal. The first action: Assign. Undo is shown in use |
| 5a | *Branch:* **calendar check**, only when there's no calendar access | Calendar works, or the calendar file | None. Access comes when it buys something |
| 6 | **The New task page, with Dump mode** | The user's own content in Fuzz's hands | Get it out of your head. Don't sort while you dump. A small dump counts |
| 7 | **The wait: Fuzz gets to know you, then what you can do with a task** | Don't lose them at the hand-off, and Fuzz learns what he can't read from a source | Check Triage instead of holding it in mind. Fuzz works while you're away. Every card is one choice. Hand it to Fuzz, or tell him anything about it |
| 8 | **The first dump cards** | Their first real decisions | Decide small, one card at a time. Later and Book time come in the slow reveal, when Fuzz thinks a card suits one |
| 9 | **The Guide, one part at a time** | They know where to start tomorrow | Start from the Guide, not from the pile |
| 10 | **Sources: email, then IM** (Fuzz's "Let me find your asks" task) | Fuzz finds asks they'd have to remember | Don't be the memory. Each source is answered on its own |
| 11 | **Hand-over** | End on a start, with no setup debt | None. Setup cards and later tips take over |

## Notes on each step

- **Step 3 comes before step 5 on purpose.** "Missing a session loses nothing" is what keeps the first booked
  appointment from being one more thing to fail at.
- **Step 4 stays before booking Triage time,** because Fuzz needs working hours to pick a time.
- **Step 5 replaces "type one real task" and the 20-minute check-in.** Triage time is Fuzz's own task, so Assign has
  something to teach, and it becomes the triage habit slot in `docs/book-then-work.md`, which the user knows as Triage time: a recurring event, linking
  to `#/triage?until=HH:MM`. Without a calendar tool it's one calendar file with a weekday repeat (`js/ics.js`).
  Fuzz explains what Triage time is for: this is where decisions happen, so you don't have to hold them in your head.
- **Placing Triage time** with nothing learned yet uses working hours: one time later in the working day, not at its start (that's the likeliest place for their best hours), then kept
  fixed. Moving it is the user's call.
- **Step 5a** asks for calendar only. It's skipped when access already exists, and falling back to the calendar file
  means a user who says no still finishes the step.
- **Step 6** is the first time the user hands Fuzz their own words. [Dump mode](dump-mode.md) is a toggle on the New task page (N), so
  there's no new screen. Fuzz asks for three things, not everything, with "add more any time". Nothing is committed
  until the user has seen Fuzz's split.
- **Step 7 is two parts, both in Triage, while Fuzz works on the dump.** The Triage tab is ringed, as built.
  - **Part 1, a few cards that help Fuzz get to know you.** Two or three, one tap each, in this order. Each is skippable
    (Esc), and answering counts as progress while skipping never counts against anyone. They are the setup-card kind:
    "Not now" comes back at most once, and nothing builds up. If the dump lands first, the unanswered ones wait and
    come back later as setup cards, so they never delay step 8.
    - **What usually gets in your way?** Starting, remembering, too many things at once, or being interrupted. Fuzz
      can't read this from any source. It sets which practices he offers first in the slow reveal (see its open
      question on who gets first offer).
    - **How do you like me to write?** Short and to the point, or a bit fuller; and plain or warm. It's a starting guess
      for drafts that Voice and style refines later (`docs/voice.md`).
    - **Pick a look** (colour theme, with the live preview). It's the one with an effect on screen, so it's a small
      reward in the wait. It moves here from "a light card a few days in".
  - **Part 2, what you can do with a task.** One short card from Fuzz, once the questions are done or skipped, and
    before the dump lands. It says that **every card is one choice, and you can hand it to Fuzz**, and that **Tell
    Fuzz (E) lets you say anything about a card**. This is the action row (the standing row in `docs/card-actions.md`). Step 5 already taught Assign, so this teaches nothing by drilling:
    step 8 is where it's used. **Later and Book time are not named here.** The first dump cards are chosen so only
    Assign and Tell Fuzz make sense, and Fuzz offers Later and Book time in the slow reveal, the first time he thinks a
    card suits one (see [Pointing at things](pointing.md)). The card says what you can do; the pointer on the
    row says why it helps (rule 9), so neither repeats the other.
  - **Left out on purpose:** the "When do you usually get things done?" card, which stays in the slow reveal, after some
    real work; and any question that needs a source, like other email addresses or Slack IDs.
- **Step 8 controls which cards come first.** Fuzz puts forward cards where Assign or Tell Fuzz is the natural move, so
  the user isn't shown Later or Book time before they've been offered. This needs a rule for ordering the first
  cards, which is a build item.
- **Step 8** may produce few cards, or none. If the dump has nothing to act on, Fuzz says what he did with it ("nothing
  needed doing, I've kept it") and goes on to step 9. Fuzz's Triage time task is still in Triage, so nobody ends on a blank screen.
- **Step 9 moves the tour here** from after the first card, so it has something to point at.
- **Step 10 is the existing kickoff task,** so it needs no new mechanism. Email and IM are asked here, one permission
  card per source, reading only, after the dump has shown what Fuzz can carry.
- **Output folder stays a setup card. Colour theme moves to step 7** (part 1). A "Pick a look" card that's skipped comes
  back once as a setup card, like the other get-to-know-you cards. The "when do you get things done" card from
  `docs/book-then-work.md` is the first thing in the slow reveal, not the first sitting.

## Open questions

1. **Step 7's wait** needs a real executor run for the dump. How long is it, and is two or three cards the right number?
   If the dump is back in seconds, part 1 is skipped and part 2 moves into step 8, on the first card.
2. **Where does the first Triage time go** when working hours are "no fixed hours"?
