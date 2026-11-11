# Spike: Deep Work, a mode for doing that's separate from triage

Triage works best in quick bursts, once or twice a day. Long tasks break that flow when you do them on the spot, and
when you Schedule or Park them, they come back cold and get put off again. This spike pulls the doing out into its own
mode that you enter whenever you have time. Triage only decides. Clearing it is a win in its own right, not a doorway
into more work.

To try it, start a static server at the repo root (`python3 -m http.server`) and open
`http://127.0.0.1:8000/spikes/deep-work/`. The page uses the app's own `css/app.css`, `css/fuzz.css`,
`js/themes.js` and `js/fuzz-svg.js`, so it works in every theme. Set **Time runs** to 60× faster to see the breaks
and takeovers without waiting.

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
2. **Enter Deep Work.** One screen asks two things:
   - **How long?** 25, 50 or 90 minutes, or until I stop. Fuzz shows the plan, with the breaks built in, for example
     "50 min: 2 work blocks, 1 short break".
   - **Where to start?** Pick up where you left off comes first. Then up to three tasks Fuzz has ready, each marked
     *Fits* or *First part fits* for the time you gave. Last comes search, where you can also name something new
     ("Expense report") and Fuzz warms it up on the spot. That task has less to go on than one Fuzz prepped ahead.
3. **Work, one task at a time, until you stop.** One step on screen. The rest of the plan is folded away. The Ask
   Fuzz, People, Sources, Context and History tabs sit under the step, folded by default. Keys:
   - **Enter**: step done
   - **S**: stuck
   - **B**: break now
   - **T**: park a stray thought
   - **Q**: Ask Fuzz
   - **Esc**: done for now
4. **Between tasks.** Finishing gets a win beat (a ✓, and the steps it took), then Fuzz offers one next thing that fits
   the time left. Enter goes, O picks something else, and Esc stops. Switching away when you're stuck keeps your place
   and offers something lighter.
5. **Time is visible and coarse.** The clock reads "About 12 min in · ~38 left", with a slow bar. It says "Break
   after this step" when a break is waiting. Hiding the clock is an opt-out, and breaks still happen.
6. **Breaks are scheduled, and every time interruption takes over the screen.**
   - The rhythm is 25 minutes on and 5 off, with a 15-minute break after three. A break waits for the end of a step,
     up to 5 minutes.
   - Break due:
     - **Take the break** (Enter) runs a countdown with a suggestion (water, stretch). The rest of your work stays folded
       away.
     - **Five more minutes** works once. Then the break comes whatever step you're on.
     - On the second ask, the option becomes **Skip this one**.
   - **The break screen shows where you'll pick up**: the step, Fuzz's help for it, and the task. **I'm back** (Enter)
     goes straight back to work. When the timer runs out, the same screen switches to "Break's over" in place.
   - **Time's up:**
     - *On a roll, keep going* comes first, because hyperfocus is allowed.
     - The other options are *wrap up in 5*, *break then more*, and *done for now*.
   - **Body check.** It only appears if 90 minutes pass without a real break.
   - Every takeover ignores keys for a second, so a stray keystroke can't answer for you.
   - **Urgent cards** that can't wait for Triage use the same takeover, in the danger color.
7. **Done for now.** A summary of the session: minutes, tasks finished, steps, breaks, and parked thoughts. Fuzz fills
   in "where you left off" for the open task (you can edit it). Parked thoughts, held cards and drafts go to Triage.

## When a task isn't getting done, it goes back to Triage

Deep Work never decides what to do about a struggling task. Triage does. Fuzz sends the task back with a proposal, so
the decision takes one keypress.

| Signal | Rule in the spike | The Triage card |
|---|---|---|
| **Stalled** | Stuck twice in a session, switched away, or two sessions in a row with no step done | Fuzz's split: what goes to deep work, what Fuzz does, and what's small enough for Triage. Split it, keep it, or drop it. |
| **Passed over** | Offered four times and never picked | A smaller first step (here: Fuzz drafts, you mark up), hand it off, drop it, or "still mine". No guilt: it's information. |

Pick "Outline the Q3 planning doc" and leave without doing a step to see a stalled card. The rubric is already at
three passes, so it comes back as passed over after your first session.

## What's not here

- Nothing is saved. The tasks, steps and Fuzz's prep are invented.
- Ask Fuzz matches keywords against canned answers. In the app it would be the executor searching the task's sources
  (and your connectors) live.
- No real prep work, and no real pool. In the app, Fuzz would judge size and "needs you" during extraction, and the
  executor would prep the top few in the background.
- The urgent card is a button in the toolbar. In the app, Fuzz would decide what's urgent enough to break through.
- Triage is a stand-in list, not the real queue.

The open questions are listed at the bottom of the page.
