# Dump mode (built on the New task box, 2026-11-25)

Drafted 2026-11-24, open questions settled 2026-11-25, built 2026-11-25 and simplified the same day (see **As built**).
Step 6 of [the proposed flow](onboarding-flow.md), and a practice Fuzz returns to in
[the slow reveal](slow-reveal.md) ("Get it out of your head"). Everything here is a hypothesis, like the onboarding principles.

A mode of the New task box, not a new place. The user writes or dictates in one box, turns on **Dump mode**, and presses
**Sort it out** once.

- **Fuzz splits it and adds the tasks, as a best guess.** The text is split into real tasks, things to keep as a note,
  things for later, and things already done or not theirs. The tasks go to Triage at once, with no review. One Undo
  takes the whole dump back. A verification step (look at the split, untick, change it) is built on the server and not
  used by the page: add it when the guesses turn out to need it.
- **A dump may produce few tasks, or none.** Twenty thoughts must not become twenty cards. A calm "I've got it all,
  nothing is lost" matters more than the count.
- **No grades, word counts or streaks.** Nothing about the dump is scored.
- **Tone:** "a lot of people find it easier to think once it's out of their head", never "you should".
- **Later homes for the practice:** the empty-queue state ("Want to get things out of your head?"), the start of Triage
  time once the habit exists, and the weekly look-back.

## A switch, plus a quiet offer

Dump mode is not on all the time. A one-line capture must stay one step, and the onboarding step and the slow-reveal
practice both need a named mode the user can find and be taught.

- **The switch** under the box turns the mode on and off, and holds where it was left. While it's on, the Capture button
  reads **Sort it out**. Flipping it with the keyboard keeps focus on the switch, so Space flips it back.
- **A quiet offer for multi-line input,** to the right of the switch. When pasted or typed text has three or more lines,
  it says "Looks like a few things. Sort them out?", as a suggestion and nothing more.
  - It never interrupts: no dialog, no focus change, no moving the cursor, and nothing that blocks typing or Enter. The
    row it sits in is always there, so it takes no new space and moves nothing.
  - It appears after the text lands (a paste, a line break, dictation), not while the user is typing a line, and it
    stays until they act or clear the box. It never grows more insistent.
  - Pressing Enter without answering it captures the text as one task, as the box does today. Ignoring it is a
    complete answer, and it isn't shown again for that text.
  - Taking it turns the switch on and sorts the text.
  - It behaves the same everywhere, Focus time included.

### In Focus time

The offer and the switch are the same, and the split already runs at once, so the only difference is where the tasks go.
They are made as Focus time tasks (state `deepwork`, like anything typed in Focus time), and a "later" item is parked
rather than put in the session. One Undo still takes the dump back.

## Decisions

1. **The raw dump is kept.** Keeping it lets Fuzz say "you mentioned this on Tuesday", and means nothing a user typed is
   ever lost, which the "nothing is lost" promise depends on. It's the most personal text in the system, so it follows
   the same rules as other personal text: it stays local, it's never used as an eval seed or test data as written (seeds
   are synthetic), and the public-repo rule (no real names) applies to anything derived from it. The user can delete a
   dump through the API. Each item that came from it keeps a link back. **There is no way for the user to see the original
   text yet,** and none is needed yet.
2. **Fuzz takes personal items,** like "call the dentist", and doesn't treat them as out of scope. They come through the
   split like any other item. Handling them more elegantly (their own home, separate from work) is planned, but is not
   part of this work.
3. **No rapid-fire variant.** One line per Enter isn't built. The single box is the whole feature.
4. **No review for now.** Sort it out is a best guess that one Undo takes back. A review step can come later.

## As built

The New task box has a **Dump mode** switch (Live only: the split needs the core). Everything below is live and tested.

- **The splitter** is a short run of a new `split` role (`core/skills/fuzz-split`, `prompt_version split-0.2`), started by
  `POST /dumps` and read with `GET /dumps/<id>`. It reads the text with `get_dump` (as data: the prompt names the dump, never
  holds the words) and answers once with `submit_split`: items grouped task, note, later or done, and one calm line. At
  most 40 items. A run that ends without a split marks the dump failed, and the words go back in the box.
- **The tasks are made as the split comes back,** in one transaction with one `dump.committed` event, so one Undo takes
  the whole dump back. Tasks go to Triage, a "later" item is parked, a note or a done item is only kept with the dump.
  Undo returns the dump to "undone".
- **The original text is stored** in the `dumps` table (not an event), whatever happens to the items, and each item that
  made a task is in `dump_items`, linked back to it (`dump.for_task`). Nothing on the page shows it.
- **The page** sends the text, clears the box, says "Sorting it out. Nothing is lost.", and polls. Then it says "Sorted.
  They're waiting in Triage." (or "in your Focus time"), and reloads from the core. The sort is kept at module level, so
  the page being drawn again (it is, when the core syncs) loses neither the switch nor the result. A dump with nothing to
  do says it's all kept.
- **The verification step, not used by the page:** `POST /dumps {review: true}` makes the split wait. Then
  `POST /dumps/<id>/commit {accept}` makes what was ticked, `/revise` runs the splitter again with your words and its last
  list, and `/one_task` keeps the text as one task. Built and tested, for when it's wanted.
- **Focus time:** when a session is running (`DeepWorkView.active()`), the page asks for the Focus time version.
- **The eval** is `fuzz eval dump` (`dump_evals.py`, `eval_seeds/dump.json`, eight invented cases): few tasks not one
  per line, nothing lost, personal items in, done is done, worry may be no tasks, instructions in a dump are data, a change
  is followed and the rest kept, a calm line. It's on the Evals page, and its cases wait for review so nothing is made. The
  splitter's runs are counted in usage as "Sorting". Run on sonnet at `split-0.1`: 8 of 8. `split-0.2` (the wording that
  says the list is made at once) needs a re-run.
- **Onboarding:** in the built flow, a dump taken on the first capture counts as that capture: its first task goes on
  to the wait. The rest of step 6 is the [proposed flow](onboarding-flow.md), which is still a proposal.

**Checked end to end** (`tests/ui/dump-live.test.mjs`): a real core, the real page and the real `fuzz run split` headless
path, with only the model stood in for by a `claude` on the PATH that hands the split to the scripted run through the
real MCP tools. It covers the offer, the run, its usage record, the polling, the tasks, the stored original, one Undo, and
the Focus time path.

### Not done

- **The Focus time box.** Focus time's own "tell me what you want to work on" field is one line, so a dump can't be typed
  into it. The Focus time path is reached from the New task box while a session is running.
- **A line on the task** saying which dump it came from, and **a way to see the original text** or old dumps. The text is
  stored and the link is readable (`dump.for_task`); nothing shows either, by choice for now.
- **Demo mode** has no splitter, so the switch isn't there.
