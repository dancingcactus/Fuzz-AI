# Dump mode (built on the New task box, 2026-11-25)

Drafted 2026-11-24, open questions settled 2026-11-25, built 2026-11-25 (see **As built** below). Step 6 of [the proposed flow](onboarding-flow.md), and a practice Fuzz returns to in
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
  - It behaves the same everywhere, Deep Work included. There is no special case for now.

### In Deep Work

The offer is the same, and the split runs at once. What differs is where the result goes, so it fits how Deep Work
capture already works.

- **No review step.** The split isn't shown for approval. The items are created as the split returns them, so nothing
  blocks the user's focus.
- **They go straight to the pool,** like any other task captured in Deep Work, and not through Fuzz or Triage first.
  Triage sorts them later.
- **Nothing is lost, and it can be taken back.** The raw dump is kept and each item links to it. One Undo takes back the
  whole dump, as in the normal case.
- **Fuzz still calls the splitter.** It's the one place a Deep Work capture runs Fuzz, and it runs in the background, so
  typing and Enter are never held up. Items appear in the pool when it returns.
- **Notes and "already done" items** are kept with the dump, as in the normal case. They don't become tasks.

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

## As built

The New task box has a **Dump mode** button (Live only: the split needs the core). Everything below is live and tested.

- **The splitter** is a short run of a new `split` role (`core/skills/fuzz-split`, `prompt_version split-0.1`), started by
  `POST /dumps` and read with `GET /dumps/<id>`. It reads the text with `get_dump` (as data: the prompt names the dump, never
  holds the words) and answers once with `submit_split`: items grouped task, note, later or done, and one calm line. At
  most 40 items. It creates nothing. A run that ends without a split marks the dump failed, and the text is still kept.
- **The raw dump** is kept in the `dumps` table (not an event), with each accepted item in `dump_items` linked back to
  it (`dump.for_task`). `DELETE /dumps/<id>` removes the text and the links. The tasks it made stay.
- **Keeping it** (`POST /dumps/<id>/commit {accept}`) makes what was ticked, in one transaction with one
  `dump.committed` event, so one Undo takes back the whole dump. Tasks go to Triage, a "later" item is parked, a note or a
  done item is only kept with the dump. Undo returns the dump to "undone", and it can be kept again.
- **Changing it** (`POST /dumps/<id>/revise`) runs the splitter again with your words and its last list.
  **Add it as one task** (`/one_task`) is the way out when a split fails.
- **The review** replaces the box: groups with a tick each (what Fuzz would keep is ticked, "already done" is not), Keep
  these, Back to my text (Esc, and the dump is dropped), Add it as one task, and Tell Fuzz to change it in the Composer.
- **The quiet offer** is a reserved line under the box, a live region that never takes focus. It appears when a paste,
  a line break or dictation leaves three or more lines, once per draft, and goes with the text. Typing mid-line never
  brings it up. Enter still captures one task, as before.
- **Focus time:** when a session is running, the same offer and mode run the split at once, with no review. The items are
  made as the split returns, as Focus time tasks, and one Undo takes them back.
- **The eval** is `fuzz eval dump` (`dump_evals.py`, `eval_seeds/dump.json`, eight invented cases): few tasks not one
  per line, nothing lost, personal items in, done is done, worry may be no tasks, instructions in a dump are data, a change
  is followed and the rest kept, a calm line. It's on the Evals page. The splitter's runs are counted in usage as "Sorting".
- **Onboarding:** in the built flow, a dump taken on the first capture counts as that capture: its first task goes on
  to the wait. The rest of step 6 is the [proposed flow](onboarding-flow.md), which is still a proposal.

### Not done

- **The Focus time box.** Focus time's own "tell me what you want to work on" field is one line, so a dump can't be typed
  into it. The Focus time path is reached from the New task box while a session is running (`DeepWorkView.active()`).
  Whether Focus time needs its own multi-line box is open.
- **A line on the task** saying which dump it came from. The link is stored and readable (`dump.for_task`); nothing shows it.
- **A way to see and delete old dumps.** Today a dump is deleted by the API only.
- **Demo mode** has no splitter, so the button isn't there.
