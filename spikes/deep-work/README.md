# Spike: Deep Work, a mode for doing that's separate from triage

Triage works best in quick bursts, once or twice a day. Long tasks break that flow when you do them on the spot, and
when you Schedule or Park them, they come back cold and get put off again. This spike pulls the doing out into its own
mode that you enter whenever you have time. Triage only decides. Clearing it is a win in its own right, not a doorway
into more work.

To try it, start a static server at the repo root (`python3 -m http.server`) and open
`http://127.0.0.1:8000/spikes/deep-work/`. The page uses the app's own `css/app.css`, `css/fuzz.css`,
`js/themes.js` and `js/fuzz-svg.js`, so it works in every theme. Set **Time runs** to 60× faster to see the breaks
and takeovers without waiting. The spike pretends it's 1:10pm, and **Next meeting** in the toolbar sets the calendar
(2pm by default).

Four concepts for the clock (a shrinking wedge, a session track, ambient drift, and Fuzz as the clock) are side by
side on `clocks.html`, all driven by one session you can play or scrub.

## What goes into Deep Work

The pool holds tasks that **need you and take real time**. Fuzz decides by default. Small things stay in Triage, and
anything Fuzz can do on its own, it does. In Triage you only correct Fuzz ("this is bigger than it looks", or "this is
actually quick"). Fuzz preps the top of the pool ahead of time: it gathers the sources, slices the task into 5 to 10
minute steps and drafts a first pass.

## The flow

1. **Triage is clear.** A celebration, then one quiet line: "You've got about 50 minutes before your 2pm. Want to go
   deep on something?" Nothing else. The **Deep Work** button (D) also works any time, whether triage is clear or not.
2. **Enter Deep Work.** One screen, two questions, no task list:
   - **How long do you have?** Choices are in the terms people think in. **Until your 2pm** comes first and is
     selected when there's a meeting. After it come **A quick burst** (25 min), **A real chunk** (50) and **A long
     haul** (90), each with the minutes underneath, and **Until I stop**. A length that would run into the meeting, or
     sits within 10 minutes of "until your 2pm", is left out. Fuzz shows the plan in one line: "2 work blocks and 1
     short break, done by 1:55pm."
   - **What do you want to work on?** One box. Fuzz's default is in the placeholder ("Pick up “Outline the Q3
     planning doc”? Or type anything…"), so pressing Enter on an empty box takes it. Typing shows **one** best match
     under the box, with ↓ and ↑ for alternatives. Moods work too: "something light", "the most urgent",
     "anything". If nothing matches, it becomes a new task that Fuzz warms up on the spot.
   - The two switches (hold triage cards, hide the clock) are folded under **Options**.
3. **Work, one task at a time, until you stop.** The step comes first. "Where you left off" is one quiet line under
   it, and what Fuzz prepped is folded. Below the buttons, like the task card in the app, are the tabs you use to
   finish the task: **Ask Fuzz**, **Context**, **People**, **History** and **Sources**. One is always open (Context
   to start). Stuck offers **Show me the sources**, which opens that tab. The header says "Triage is on hold" without
   a count, and parked thoughts collapse to "2 parked for Triage ✓". Keys:
   - **Enter**: step done, with **Undo** (U) in a toast for 6 seconds
   - **S**: stuck
   - **B**: break now (asks first; the button doesn't)
   - **T**: park a stray thought
   - **Q**: Ask Fuzz
   - **Esc**: done for now, which has **Back to work** (Esc again), so the reflex key undoes itself
4. **Between tasks.** Finishing gets a win beat (a ✓, and the steps it took), then Fuzz offers one next thing that fits
   the time left. Enter goes, O opens the same "what do you want to work on" box, and Esc stops. When your time is
   up, Enter means **Stop here** instead. U still undoes the last step if it wasn't really done. Switching away when
   you're stuck keeps your place and offers something lighter.
5. **Time is visible and coarse: a session dial.** The whole session is a pie, eaten up to the hand. Work is orange
   and breaks are green, so you see the next break coming and how big it is. It moves in 5-minute steps and says
   "Break in ~10 min · ~35 min left in the session", or "Break after this step" when a break is waiting. With no end
   time it fills up instead: one lap is an hour, the next break waits ahead as a dashed slice, and each finished
   hour adds a ring outside. The dial is drawn from what actually happened plus the plan ahead, so snoozes and extra
   time show up on it. Hiding the clock is an opt-out, and breaks still happen. (`clocks.html` has the other
   concepts it was chosen from.)
6. **Breaks are scheduled, and every time interruption takes over the screen.**
   - The rhythm is 25 minutes on and 5 off, with a 15-minute break after three. A break waits for the end of a step,
     up to 5 minutes.
   - Break due:
     - **Take the break** (Enter) shows "About 4 minutes" and a small green wedge, not ticking seconds, with a
       suggestion (water, stretch). The rest of your work stays folded away.
     - **Five more minutes** works once. Then the break comes whatever step you're on.
     - On the second ask, the option becomes **Skip this one**.
   - **The break screen shows where you'll pick up**: the step, Fuzz's help for it, and the task. **I'm back** (Enter)
     goes straight back to work. When the timer runs out, the same screen switches to "Break's over" in place.
   - **Time's up:**
     - *On a roll, keep going* comes first, because hyperfocus is allowed. After two extensions the highlighted
       option flips to *Wrap up in 5*.
     - Near a meeting it becomes *Keep going until 1:55*, and *break then more* goes away.
   - **The meeting is a hard stop.** Five minutes before it, a takeover says "Your 2pm is in 5 minutes" without waiting
     for the end of a step: **Stop here**, or **I'm skipping the meeting**. It applies to "Until I stop" too.
   - **Body check.** It only appears if 90 minutes pass without a real break.
   - Every takeover ignores keys for a second, so a stray keystroke can't answer for you.
   - **Urgent cards** that can't wait for Triage use the same takeover, in the danger color. **Pause and handle it** is
     a detour, not an exit. Deep Work shows as paused, Fuzz offers to draft the reply, and **Back to Deep Work**
     returns you to the same step, with the same time and the same break schedule.
   - **Pop out** (Chrome only) puts a small always-on-top window with the dial in it, so you can see time while you
     work in another app. It turns green on a break, accent-colored for break due or time's up, and red for urgent.
     It also has a button for taking the break or coming back from one.
7. **Done for now.** The summary leads with what did happen ("1 task finished, 4 steps done") and leaves out zeros. If
   nothing happened, it says "You showed up and opened it. That counts." Fuzz fills in "where you left off" for the
   open task (you can edit it). **Back to work** (Esc) returns you to where you were. Parked thoughts, held cards and
   drafts go to Triage.

## When a task isn't getting done, it goes back to Triage

Deep Work never decides what to do about a struggling task. Triage does. Fuzz sends the task back with a proposal, so
the decision takes one keypress. The cards describe the pattern without counting ("This keeps getting stuck at the
same step", "This one hasn't been getting picked"). Each has **Decide later**, and nothing blocks clearing Triage:
undecided cards wait for your next triage.

| Signal | Rule in the spike | The Triage card |
|---|---|---|
| **Stalled** | Stuck twice in a session, switched away, or two sessions in a row with no step done | Fuzz's split: what goes to deep work, what Fuzz does, and what's small enough for Triage. Split it, keep it, drop it, or decide later. |
| **Not getting picked** | Offered four times and never picked | A smaller first step (here: Fuzz drafts, you mark up), hand it off, drop it, "still mine", or decide later. |

Start the Q3 outline and leave without doing a step to see a stalled card. The rubric starts at three passes. It comes
back once Fuzz offers it again, as its pick in the box or as the next task, and you choose something else.

## What's not here

- Nothing is saved. The tasks, steps and Fuzz's prep are invented.
- Ask Fuzz matches keywords against canned answers. In the app it would be the executor searching the task's sources
  (and your connectors) live.
- No real prep work, and no real pool. In the app, Fuzz would judge size and "needs you" during extraction, and the
  executor would prep the top few in the background.
- The calendar is one pretend meeting. In the app it would be your real calendar.
- No notifications or sound yet, and the tab title and favicon don't show the dial. Pop out is the only signal that
  reaches you in another app, and it's Chrome only.
- The urgent card is a button in the toolbar. In the app, Fuzz would decide what's urgent enough to break through.
- Triage is a stand-in list, not the real queue.

The open questions are listed at the bottom of the page.
