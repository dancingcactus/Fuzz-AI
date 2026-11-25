# Dump mode (proposed, not built)

Drafted 2026-11-24, open questions settled 2026-11-25. Step 6 of [the proposed flow](onboarding-flow.md), and a practice Fuzz returns to in
[the slow reveal](slow-reveal.md) ("Get it out of your head"). Everything here is a hypothesis, like the onboarding principles.

A mode of the New task box, not a new place. The user writes or dictates in one box, then presses Enter once.

- **Fuzz splits first, and commits nothing.** The text comes back as a list of candidate items, grouped as real tasks,
  things to keep as a note, things for later, and things already done or not theirs. The user can accept all, untick
  items, or tell Fuzz to change something.
- **A dump may produce few tasks, or none.** Twenty thoughts must not become twenty cards. A calm "I've got it all,
  nothing is lost" matters more than the count.
- **Items go through Fuzz before Triage,** like any captured task, so the user sees finished decisions, not raw lines.
- **No grades, word counts or streaks.** Nothing about the dump is scored.
- **Tone:** "a lot of people find it easier to think once it's out of their head", never "you should".
- **Later homes for the practice:** the empty-queue state ("Want to get things out of your head?"), the start of Triage
  time once the habit exists, and the weekly look-back.

## Explicit mode, plus a quiet offer

Dump mode is not on all the time. A one-line capture must stay one step, and the onboarding step and the slow-reveal
practice both need a named mode the user can find and be taught.

- **The toggle** on the New task box (the mode above) is how the user chooses it on purpose.
- **A quiet offer for multi-line input.** When pasted or typed text has several lines or bullets, the box shows a small
  line, "This looks like a few things. Split it?", as a suggestion and nothing more.
  - It never interrupts: no dialog, no focus change, no moving the cursor, and nothing that blocks typing or Enter.
  - It appears beside the box after the text lands, not while the user is typing a line, and it stays until they act or
    clear the box. It never grows more insistent.
  - Pressing Enter without answering it captures the text as one task, as the box does today. Ignoring it is a
    complete answer, and it isn't shown again for that text.
  - Taking it (a click, or one key) switches to Dump mode with the text kept, and shows Fuzz's split for review.
  - It's off in Deep Work, where capture goes straight to the pool and the user is protecting their focus.

## Decisions

1. **The raw dump is kept.** Keeping it lets Fuzz say "you mentioned this on Tuesday", and means nothing a user typed is
   ever lost, which the "nothing is lost" promise depends on. It's the most personal text in the system, so it follows
   the same rules as other personal text: it stays local, it's never used as an eval seed or test data as written (seeds
   are synthetic), and the public-repo rule (no real names) applies to anything derived from it. The user can delete a
   dump. Each accepted item keeps a link back to the dump it came from.
2. **Fuzz takes personal items,** like "call the dentist", and doesn't treat them as out of scope. They come through the
   split like any other item. Handling them more elegantly (their own home, separate from work) is planned, but is not
   part of this work.
3. **No rapid-fire variant.** One line per Enter isn't built. The single box is the whole feature.

## What needs building

- **A splitter:** a new role and prompt that return the four groups, and a route that returns the list without
  creating anything.
- **A commit step** that takes the accepted items and creates them in one transaction, so one Undo takes back the whole
  dump. It also stores the raw dump and links each item to it.
- **The review screen,** reusing the Composer for "tell Fuzz to change it" (`docs/card-actions.md`), and the toggle on
  the New task page (N).
- **The quiet offer,** per the rules above.
- **An eval** that a messy dump gives few tasks, not twenty, with synthetic seeds, and the splitter counted in usage
  tracking.
- **Onboarding step 6** last, once the above exists.
