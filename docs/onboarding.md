# Onboarding: requirements

Status: the current flow is built, in `js/onboarding.js`, `core/fuzz/onboarding.py`, `install.sh` and
`docs/fuzz-tone.md`. Nobody with ADHD has tried it yet, and the tip wording hasn't been tried with real users.

A new flow (Triage time first, then Dump mode) is proposed under [Proposed changes](#proposed-changes); everything else
in this document describes what's built today, until that flow replaces it.

## Goal

A new user goes from nothing to working a real card, in the browser, in one short sitting. On the way
Fuzz introduces himself, sets up what he needs, and teaches practices for getting things done.

This replaces the old four-step guided setup (`js/setup.js`, now removed) as the first-run experience.
Changing anything later happens on the Settings page (`#/settings`, see "As built").

## Proposed changes

The first sitting and what follows are being redesigned. Each is a hypothesis, kept in its own document:

- [`onboarding-flow.md`](onboarding-flow.md): the proposed first sitting, from the paste to the hand-over, in 11 steps.
- [`dump-mode.md`](dump-mode.md): the New task box as a place to get everything out of your head.
- [`slow-reveal.md`](slow-reveal.md): the practices Fuzz teaches after the first sitting, one at a time.
- [`pointing.md`](pointing.md): how Fuzz points at the control the user needs next, and says why.
- [What needs building](#what-needs-building-the-proposed-flow) lists the work across all four.

## What Fuzz teaches

### First tips

These three are the only tips in the onboarding itself:

1. **Fuzz keeps one queue and brings what matters to the front.** When they sit down, the Guide asks
   where to start. (This used to ask for a recurring daily slot on the calendar; since the Guide, the
   only calendar ask is the one check-in on the first task, after its card.)
2. **Don't be afraid to ask Fuzz to change things, or to send a task back to him as often as you
   like.** On a draft, Tell Fuzz (E) asks for a change. On other cards, Tell Fuzz (E) opens the card's box. Fuzz repeats
   this on their first draft.
3. **Missing a session loses nothing.** Nothing is lost, and stopping at 20 minutes with cards left is
   fine. This one matters most, because it stops the appointment becoming one more thing to fail at.

### Later tips

Each is said once, when it first becomes relevant, by Fuzz, in a line or two:

| Tip | When Fuzz says it |
| --- | --- |
| Hold Option + Space to dictate | On the first New task screen |
| Press T to park a stray thought | On the first card |
| What you do in Fuzz can be undone | After their first action |
| Say how you're doing, and the queue changes to match | At the first check-in |
| Letting something go is a real outcome | On the first stale card |
| Schedule in human terms, like "when I'm back at my desk" | The first time they open Schedule |
| Work in Claude when you want to do it together | When a task comes back handed over |
| Press ? for all the keys | Once they've worked a few cards |

### How to word them

- Fuzz is opinionated. He says how he works, as a fact, and doesn't cite evidence or name a condition.
- Say what he did and why it's useful, not what technique it is.
- No medical advice, and no assumption of a diagnosis. `PRODUCT.md` also includes people with heavy
  executive-function load.

## Settings

| Setting | When | How |
| --- | --- | --- |
| Name | Form | Typed |
| App (Claude or Copilot) | Form | Pick one; the installed one is highlighted |
| Working hours | Fuzz's first question, a card in Triage | Your usual hours, every day, no fixed hours, or a picker |
| Lookup source | First setup card | The first connector, in plain words |
| Output folder | Setup card | One-tap yes to `~/Documents/Fuzz`, because it's a real permission |
| Colour theme | Step 7, in the wait (today: a light card a few days in) | One tap with a live preview |
| Send tools | When the first draft is approved | Never pre-ticked |
| Other emails, Slack ID | When a connector shows an address Fuzz doesn't know | Never asked up front |
| Calm mode, high contrast, appearance, code font | Not asked | Stay in Settings |
| Model, stale days, parked reviews, back-at-desk, Ollama | Not asked | Keep the defaults |

Settings stays reachable throughout, so the onboarding can't be a locked dialog. Someone who needs high
contrast must be able to get to it during the intro. Systems set to reduce motion already turn Calm mode
on.

### Setup cards

Everything after the form arrives as a card in the queue:

- There is only ever one setup card at a time, and it comes after real work.
- The order is lookup source, then output folder, then colour theme. (In the proposed flow the theme is asked at step 7,
  and only comes back here if skipped.)
- "Not now" means it. The card goes away quietly and comes back at most once. It never builds up.
- Answering one counts as progress. Ignoring one never counts against them.
- The lookup source card leaves the browser, because connectors sign in through Claude or Copilot. It
  needs onboarding principle 5 most: instructions that stay visible, and a way back.

## Onboarding principles

These add to the Product Principles in `PRODUCT.md` and the numbered principles in `docs/principles.md`, and
don't replace them. When this doc says "principle N", it means these; the app-wide ones are named "app principle N".
The closest pairs: onboarding 11 (talk about the strategy, not the person) and app principle 11 (no shame spirals), and
the Safe idea in [the arc](onboarding-flow.md#the-arc) and app principle 6 (humans approve what can't be undone, and every change has Undo).

1. **Show value before asking for effort.** Interest is the fuel, and first-session novelty burns off
   fast. *Test:* before the user hands over anything of their own, Fuzz has shown he takes work off their plate
   (step 5, his own task, with a calendar event to show for it). The first real thing they give him is theirs: their
   words through New (step 6), or what the extractor finds (step 10). It is never something Fuzz made up for them.
2. **Ask only what Fuzz can't work out.** A blank field means recalling or fetching something, and
   leaving the app to do that can end the session. *Test:* no step needs a trip to another app to look
   something up.
3. **One decision per screen, with a safe default.** Decisions drain people quickly. Send tools are
   the exception and stay unticked. *Test:* a tired user can accept everything and end up safe and
   working.
4. **Leaving is a normal way through.** Interruptions are guaranteed, and coming back is one of the
   hardest parts. *Test:* close it mid-sentence, come back tomorrow, and everything is still there.
5. **Don't lose them at the hand-offs.** Waits and window switches are where working memory fails.
   Say what's happening and what to do next, keep it visible, and bring them back. *Test:* someone who
   wanders off during a wait can tell where they are at a glance.
6. **No setup debt.** No percentages, "finish setup" badges or reminders, and no streaks or lesson
   counts. A missing piece comes up once, in context, when it would pay off. *Test:* a user who skips
   everything never sees a sign of it, except an offer at a useful moment.
7. **Earn trust in plain words.** Say what Fuzz will see, what he can't do, and that nothing sends
   without a yes. Describe abilities, such as "Read your email", not tool IDs. *Test:* a non-developer
   can repeat what they agreed to.
8. **End on a start.** Starting is the core difficulty, so finishing leads straight into doing
   something. *Test:* the last screen is their first real card.
9. **One paste, then the browser.** Every terminal step is a place to stall. *Test:* the user never
   returns to the terminal, copies a token or opens a log file.
10. **Teach by doing, one idea at a time.** A strategy tried on your own real task can stick. Each
    tip is one sentence from Fuzz, attached to what's happening then, and the sentence says how it helps. There's
    no folded-away "why".
    *Test:* removing every tip wouldn't add a step, and skipping them costs nothing.
11. **Talk about the strategy, not the person.** Advice can sound like "you've been doing it wrong",
    and shame is what Fuzz exists to avoid. *Test:* each line reads fine to someone who is tired,
    undiagnosed or already knows all this.
12. **Fuzz introduces himself by working.** A tour spends the user's early interest and proves
    nothing. The intro is always calm, with no flashes or gags, and the normal lively default starts
    after it. *Test:* someone can skip every word and still know Fuzz takes work off their plate, because step 5
    shows it.
13. **Settings arrive as cards, when they'd pay off.** A settings tour means decisions with no
    experience to base them on. *Test:* each question either changes something on screen or tells the
    user what Fuzz may now do.

Everything comes from Fuzz, in his tone, and Calm mode is respected, as `PRODUCT.md` already requires.

These principles come from common ADHD traits and the code, not from testing. There are no real users
yet, so treat them as hypotheses until someone with ADHD tries the flow.

## What needs building (the proposed flow)

| Need | Today | Work |
| --- | --- | --- |
| Fuzz's Triage time task | Nothing; the 20-minute check-in is the nearest | A first task Fuzz owns, explained as Triage time, ending in a recurring event or a repeating calendar file |
| Calendar check branch | The kickoff task asks per source | A calendar-only check, shown only when access is missing |
| Dump mode | **Built** (`docs/dump-mode.md`, "As built"): the switch, the quiet "Sort them out?" offer, the splitter and Sort it out (a best guess, no review), with the original stored. In the built flow a dump counts as the first capture | The proposed step 6 itself: Fuzz asking for three things, and handling a dump with no tasks in the wait |
| Get-to-know-you cards (step 7) | Setup cards carry output folder and colour theme only | Two question cards (what gets in your way; how Fuzz should write), the theme card moved earlier, and a way to keep unanswered ones from delaying step 8 |
| "What you can do with a task" (step 7) | The tour covers the Guide, not the action row | One card in Fuzz's words, drawn from the action row in `docs/card-actions.md` |
| Tour after the dump | The tour follows the first card | Move the step, and handle a dump with no tasks |
| Pointers that say why | `spotlight()` and `pointerHTML()` in `js/onboarding.js` ring New and the Triage label, with a one-word pill | A target given by element and a caption (title, sentence, Fuzz face, bubble tail) instead of two hard-coded targets; see [Pointing at things](pointing.md) |
| Tips without the fold | Each of the three first tips has "Why this helps" folded away | Drop the fold. Each tip is one line from Fuzz that says how it helps |
| Later and Book time offered by Fuzz's judgment | Offered on the card, always | A rule for when a card suits each, and a pointer the first time |
| First dump cards chosen to fit what's taught | The first card is the one the user captured | A rule for ordering the first cards, so Assign or Tell Fuzz is the natural move and Later or Book time isn't shown yet |

## Order of work

The current flow is built: the tone guide, the one-paste bootstrap, the form with install and repair, the intro and
tips, the first card, the calendar file, setup cards and later tips. Next, in this order:

1. Try the current flow with someone who has ADHD.
2. Build the proposed flow from the table above.

## As built

- **The order.** Fuzz introduces himself first, asks two questions (name and app), says how he helps,
  asks his first question on a card in Triage (working hours), and only then asks for a task, pointing at the New task
  button (the floating one on a phone). The app's header appears with the Triage question; until then it,
  Settings included, is hidden, so the first screens are only Fuzz. This trades away the "Settings stays
  reachable" rule above for the intro and the questions. A system set to reduce motion still gets Calm
  mode, but high contrast can't be switched on until the header appears.
- **Where it lives.** The flow is a page, `#/welcome` (`js/onboarding.js`). Progress is kept by the core in `onboarding-u<user>.json` (`GET/PUT /onboarding`), not as
  events, so Undo never reverses a step. People with tasks already, or the old guided setup finished, skip
  it.
- **The form** highlights the app it finds and sets Fuzz up in it when picked, or when you go on with the
  default. Install and repair go through `POST /engine/clients/{client}/install|repair`, then the page
  waits for the server's `boot` id in `GET /health` to change (or a few quiet seconds where nothing
  restarts), checks the client and picks it with `PUT /engine`. A client that isn't there gets a link to
  get it, "I've installed it" to look again, and Try the demo, which runs the same intro on demo data.
- **Working hours are Fuzz's first question**, right after how he helps. The header fades in on Triage,
  where a question card waits ("When do you work?", introduced as "This is Triage… here's an easy one to
  start"), so the first card anyone works is an easy one. One key answers it: your usual hours on
  weekdays, every day, no fixed hours, or Different hours for a picker. Esc keeps the usual hours for now.
  N stays off until it's answered.
- **Then the new task.** Answering (or skipping) brings Fuzz's ask for one real task, with the New task
  button ringed and pointed at.
- **How Fuzz helps, guilt-free** is its own step, right after the name and app, still with the header
  hidden. The three first tips are told as what Fuzz does: one queue he helps you prioritize, so a
  short stretch is enough and the Guide asks where to start; he collects each task's context and resources in
  one place; he keeps things up to date while you're away (and doesn't keep score). Each has "Why this helps"
  folded away, and Got it (Enter) moves on. (The proposed flow drops the fold: each tip is one line that says how it
  helps. See the build table.)
- **Fuzz is there in full** on each onboarding page: the jointed body, greeting once and then resting.
  He waves on the intro, leans in for the questions, hops (then rests caring) on how he helps, clacks
  his claw on "All set", works through papers during the wait, and does a ta-da (jazz hands if it's
  already done) when the task lands. Calm and reduced motion keep just the resting pose.
- **The wait** teaches the next habit: keep an eye on Triage, where Fuzz brings tasks he has looked into
  and any questions he has. The Triage tab is ringed and pointed at. Going there early is fine: Fuzz is
  shown reading up on the task, and when it lands the lesson is on its card.
- **The first card** is picked to the front of Triage and carries the lesson above its question. Acting on
  it moves on to the check-in (or straight to the tour when it's done or let go).
- **The check-in** (step `checkin`, on `#/welcome`) offers Book time's times for 20 minutes
  (`GET /onboarding/checkin`: your calendar's free time once the executor has read it, else the next
  working-hour starts) as a row of choices. With a calendar tool in `send.tools`, Put it on my calendar
  (`POST /onboarding/checkin`) makes an approved `calendar_hold` draft for the sender, since pressing the
  button was the yes; there's no hold card. Without one, Add to my calendar downloads a one-off `.ics`.
  Either way it's only the time: the task isn't booked or moved, so Fuzz keeps working on it. The event is
  "Check in with Fuzz: <task>", and links to Triage (or to the task on the Guide when it's yours to start).
- **The tour** (step `tour`) runs on the Guide: a bubble beside each part in turn, the part ringed, Next
  (Enter) and Skip the tour. Leaving the Guide hides it; coming back picks it up again. Got it on the last
  one ends the onboarding: the Undo tip, and one line saying the next card is a task for Fuzz.
- **Fuzz's own task, "Let me find your asks",** is the last card (`POST /onboarding/kickoff`, made once,
  tagged `kickoff`). Assigning it doesn't start the executor (the tag keeps it off the executor's list):
  Fuzz asks the app what it can reach (the guided setup's discovery run), then asks one permission card
  per source, "Can I read Gmail?", reading only, Yes or Not this one. Yes turns on that source's lookup
  tools; send tools are never asked about here. When every card is answered the task is done, its log
  says what was allowed, and the first read starts (Run now). Nothing found, or the listing failing,
  hands the task back with what to do. It replaces the lookup setup card. Check-ins wait until it's done.
- **The intro is calm**: Calm mode is on from the form to the first card, whatever the setting.
- **Setup cards** (output folder, then colour theme; lookup only for anyone without the kickoff task) are
  drawn by Triage, like check-ins, with the core keeping the answers. One shows per
  visit, after a card is cleared, never on the visit the onboarding ended. Not now always works (Escape),
  and a second Not now retires the card. The lookup card asks the app what it can reach (the guided setup's
  discovery run) and offers only its suggested ways to read, in the tools' own plain words.
- **Later tips** are said by Fuzz, once each, a moment after the card they belong to arrives, and only if
  you're still on it.

- **Settings** (`#/settings`, `js/view-settings.js`, the gear in the header; there are no quick settings;
  Escape or Back returns to the page it was opened from, and in a text box Escape only leaves the box)
  replaces the four-step wizard with one page of sections, each saved on its own: About you (names,
  emails, Slack IDs); App (status, set up, repair, switch, check again); Working hours (the same choices
  as Fuzz's question); What Fuzz can read, send and change (one row per source in plain words, with Reading,
  Sending and Changing switches, List again, and each tool by name under Details, with its token cost); Where Fuzz
  saves files; Look and feel (theme, appearance, contrast, code font, Calm mode, applied at once and kept
  in this browser); Your queue (Refresh now, or Reset demo data in the demo, and Switch account); and Show me
  around again. In the demo the page has only Look and feel, Demo and the tour.

Not built yet:

- **Send tools when the first draft is approved.** Approving still works as before; the sender hands a
  draft back when no send tools are allowed. The guided setup in Settings picks them.
- **Identity from a connector.** Other emails and Slack IDs are no longer asked up front, but nothing reads
  them from a connector yet, so they still come from Settings › About you or `fuzz me add`.
- **Trying it with someone who has ADHD.** No one has tried the flow, and the tip wording hasn't been tried with real users.

### The first read

The first read uses Run now. Scheduled reading stops outside working hours, so someone setting up on a Saturday
would otherwise see nothing until Monday.

### When the app isn't ready

Fuzz can only use a client that passes its check, and install has to finish before the first task. So
choosing an app has three outcomes:

- **Ready:** Fuzz carries on.
- **Installed but has a problem:** Fuzz repairs it, or says what to do.
- **Neither yet:** Fuzz gives a link to get one and offers Demo data, so the user isn't stuck.

### Interruptions

Closing the page at any step keeps everything. Coming back resumes at the same step. Anyone can skip
the intro, and people who have already set up never see it. Settings has **Show me around again**, for
the intro and the tips.
