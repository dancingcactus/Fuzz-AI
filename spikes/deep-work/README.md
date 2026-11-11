# Spike: Deep Work, a mode for doing that's separate from triage

Triage works best in quick bursts. Long tasks break that flow when you do them on the spot, and when you
Schedule or Park them, they come back cold and get put off again. This spike pulls the doing out into its own
mode. Triage only decides, and when it's clear, Fuzz hands you a task it has already warmed up.

To try it, start a static server at the repo root (`python3 -m http.server`) and open
`http://127.0.0.1:8000/spikes/deep-work/`. The page uses the app's own `css/app.css`, `css/fuzz.css`,
`js/themes.js` and `js/fuzz-svg.js`, so it works in every theme. Set **Time runs** to 60× faster to see
the check-ins and breaks without waiting.

## The flow

1. **Handoff.** When triage is clear, Fuzz offers the top of **Up next** (three tasks at most), each one already
   prepped. Press Enter to start, 1 to 3 to pick another, or N for "Not today" (no guilt attached).
2. **Warm-up.** Fuzz shows what it gathered (a summary, the sources), the first step as a 5 to 10 minute action, and
   where you left off if you've been here before. You choose a rough length (just the first step, 10, 25 or 50
   minutes, or until it's done; 25 is pre-selected), plus two switches: *hold new triage cards* and *hide the
   clock*.
3. **Focus.** One step on screen. The rest is folded away, and the dots only fill up. Fuzz shows its help for
   the current step. The clock reads "About 12 min in", never seconds. Keys:
   - **Enter**: step done
   - **S**: stuck
   - **B**: break
   - **T**: park a stray thought
   - **Esc**: done for now

   Under the step is a row of tabs, all folded by default:
   - **Ask Fuzz** (**Q**): ask about the task. Fuzz looks through the sources and answers with where it found
     the answer. When the answer isn't in the sources, Fuzz offers to draft the question to the person who'd
     know, and the draft waits in Triage for your OK. Each task has suggested questions to try.
   - **People**: who is involved, what each person did and what they said.
   - **Sources**: the messages, docs and calendar entries behind the task, with the line that matters from each.
   - **Context**: Fuzz's brief, a paragraph on the situation.
   - **History**: everything that has happened to the task, newest first. It includes this session's steps,
     questions and first passes.
4. **Stuck.** You get four ways out:
   - Make the step smaller (it splits in two).
   - Let Fuzz take a first pass, so you check its work rather than start from blank.
   - Skip the step to the end.
   - Switch to something lighter (your place is kept).
5. **Check-in.** When the block runs out, Fuzz asks how it's going. "On a roll, keep going" is always first,
   because hyperfocus is allowed. The other answers are wrap up in 5, take a break, or done for now. With
   "Until it's done", the only check is at 90 minutes, as a body check (water, stretch).
6. **Done for now.** Fuzz fills in "where you left off" (you can change it). The task goes back to the top of
   Up next with that note, so the next warm-up opens on it. Your parked thoughts and the cards Fuzz held go to
   Triage.

## What's not here

- Nothing is saved. The tasks, steps and Fuzz's prep are invented.
- Ask Fuzz matches keywords against canned answers. In the app it would be the executor searching the task's
  sources (and your connectors) live.
- No real prep work. In the app, prepping is the executor's job: when a task goes to Up next, it gathers the
  sources, slices the task into small steps and drafts a first pass.
- The urgent-card break-through only exists as the line "I'll let anything urgent through".
- No new Triage action yet. The natural one is "Up next", replacing Schedule or Park for big tasks, with Fuzz
  suggesting it when it estimates more than a few minutes of work.

The open questions are listed at the bottom of the page.
