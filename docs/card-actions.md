# Card actions: principles

Status: **proposal, 2026-11-21.** Not yet signed off, not yet built. Part 3 checks the rules against ADHD
practice, and Part 4 lists where the current cards break them. These come from common executive-function
traits and from reading the code, not from testing. Nobody with ADHD has tried them, and nobody qualified in
ADHD has reviewed them (the same caveat as `docs/onboarding.md`). Treat them as hypotheses.

Cards should not all look the same. A "Yes / No / Not sure yet" question needs a different row from a task
you can hand off. What should stay the same is **the rules that decide which row a card gets**, so the user
never has to relearn what a button is.

## Part 1. The model

Every action on a card sits in one of three layers.

| Layer | What it is | Where it lives | Limit |
|---|---|---|---|
| **Lead** | The decision this card exists for. Fuzz's suggestion is filled in. | The big block: numbered answers, or Hand it to Fuzz. | One filled button |
| **Standing verbs** | The few moves every card shares: hand off, do it myself, later, done, let go. | The row under the lead, always in the same order. | Four visible, with the same word, key, icon and place on every card |
| **Depth** | Everything else that is still possible. | Behind a chevron, or the E link ("Tell Fuzz something"). | One level, up to four items, each with a line saying what happens |

A card's job is to pick one lead, show the standing verbs that make sense for it, and push the rest into
depth. It does not invent new buttons.

## Part 2. The rules

**1. One lead, one fill.** Each card has exactly one filled button, the move Fuzz thinks is right. On a card
with numbered answers it is answer 1. On a result Fuzz found, it is Done. Moving the fill (Do it now versus
Book time on a big task) is fine. Two fills is not.

**2. Four visible, the rest in depth.** At most four visible choices, counting numbered answers and the
standing row together. "Tell Fuzz something" is an input, not a choice, so it doesn't count. Nothing is
removed: what doesn't fit goes behind the chevron of the standing verb it is closest to.
(Existing rule, 2026-11-13.)

**3. A verb keeps its word, key, icon and place.** If Later is S, clock icon, third in the row on one card,
it is that on every card that has it. A card that needs a different meaning gets a different word and a
different key. It never reuses one. The letter keys are the standing verbs: A hand off, C work in Claude,
G I'll do it, S later, D done, K it still matters, L let it go, P park, W waiting, X not mine, E tell Fuzz.

**4. Numbers are for answers, letters are for verbs.** 1, 2, 3 mean "the nth answer in the lead block".
They never mean a standing verb. So "Not sure yet" on a choice card is also S, because it is the same
move as Later, even if it is drawn in the numbered column.

**5. Fixed order, fixed place.** The standing row is always at the bottom of the card and always reads in the
same order: *forward* (hand off, work in Claude), then *defer* (Later), then *close* (Done, Let it go). The
card above it changes, and the row does not move. After an interruption, the user's eyes go to the same
spot.

**6. Every card has a free way out.** Later, Not sure yet or Not now: always visible, always S, always
described as no penalty. A card that can only be answered "yes" is a trap. The way out is never red, never
counted, and never a dialog.

**7. Close verbs act at once and are undoable.** Done and Let it go do not ask "are you sure?". Fuzz says what
happened, and Undo is there. Anything that cannot be undone (sending) is not a button on the card at all: it
is a draft that waits for an OK (product principle 5). A numbered pick that hands the task over is the
hand-off: the card leaves, with no second Hand it to Fuzz step (existing rule, 2026-11-13).

**8. Say what happens, in the user's words, two to four words.** Start with a verb or a plain state: "Hand it
to Fuzz", "I'll do it", "Done", "Bring it back". The consequence goes in the small line under the label or in
the menu, not on the button. Vocabulary follows `docs/nav-guide.md`: the session and queue are "My work",
the buttons are "Work on…", the action is "I'll do it".

**9. Weight says importance, never alarm.** The lead is filled. Standing verbs are outlined and the same
size. A chevron shares the weight of the button it belongs to. Nothing on a card is red, and Let it go is
only filled when Fuzz is actually leaning that way (`leansGo`). Targets are at least 44 px, and the two
closing verbs are not neighbours at the same weight (see Part 4, item 8).

**10. Hand-off first.** Fuzz does the work (principle 1). So where it applies, Hand it to Fuzz leads the
standing row, and the verbs that mean "I'll carry this" (Work in Claude, I'll do it) follow it.

**11. The answer is a result, not a spinner.** A press moves to the next card in the same beat, and Fuzz says
in one line what he did. A card is never left in a half-pressed state.

### What the rules give each card kind

| Card kind | Lead (the fill) | Standing verbs shown | Depth |
|---|---|---|---|
| Ordinary task | Hand it to Fuzz ▾ | Work in Claude · Later ▾ · Done ▾ | I'll do it (under hand off); Book time (under Later); Do it now, After the others, Park, Waiting, Not mine (under Done) |
| Choice or entity question | Answer 1 | Answers 2 and 3, with Not sure yet as the way out | Something else (E) |
| Fuzz's answers (a handback) | Answer 1 | Later ▾ · Done | Tell Fuzz (E), Other ways ▾ |
| Check-in (comes back) | The one answer Fuzz suggests | It still matters · Later ▾ · Let it go | Book, Park, Not mine |
| Result Fuzz found | Done | Send Fuzz further · Ask me later | Other ways ▾ |
| Working card | Done | Pause · Later | Hand to Fuzz, Work in Claude, Book the rest |
| Big task | The suggested way to take it | Two more of the five | The other two, behind Later's chevron |

## Part 3. Checking the rules against ADHD practice

How strong the evidence is, so none of this is oversold. I wrote these from general knowledge of the ADHD
and executive-function literature and clinical guidance. I did not look up sources for this draft, so the
named ideas are accurate but none of them are cited. Before anything ships, the person qualified in ADHD
reviews it (the plan in `docs/fuzz-tone.md`).

| ADHD challenge | What helps | Rules that carry it | Verdict |
|---|---|---|---|
| **Starting.** The hard part is the first move, and a blank decision is a wall. | Pre-chosen next step; the lowest-effort first action. | 1, 10 | Strong. The fill is the start button, and Fuzz does the doing. |
| **Too many options.** Choice overload hits harder under fatigue. | Fewer visible choices; a clear recommendation. | 1, 2 | Strong, as long as 2 is really kept (see Part 4). |
| **Working memory.** Holding what a button does, or where it is, costs effort. | Consistency; recognition over recall; stable layout. | 3, 5, 8 | Strong. This is where today's cards are weakest. |
| **Re-entry after interruption.** The user loses their place and the thread. | Same place, same shape, state shown on the card. | 5, 11 | Strong for layout. The card also needs to show *where you were* (outside this doc). |
| **Shame and emotional load.** Piles of undone things feel like accusations. | Neutral colour and wording; no counts; no penalty. | 6, 9 | Strong. Emotional dysregulation is well documented in ADHD. Rejection sensitivity is a popular label rather than a diagnosis, so use it as a design cue, not a claim. |
| **Impulsivity and mis-taps.** A quick press lands on the wrong button. | Undo instead of confirm dialogs; targets spaced apart. | 7, 9 | Reasonable. Undo beats a "Sure?" dialog, which people click through. |
| **Delay aversion and time blindness.** Waiting without feedback loses attention. | Immediate, visible response; time in human terms. | 11 (and the existing time wording) | Reasonable. |
| **Keyboard shortcuts.** Fast for those who learn them, but they depend on memory. | Visible hints on the button; never required. | 3, 4 | Mixed. Shortcuts help the repeat user and burden the new one, so the hint must always be on the button. |

Two cautions beyond the table.

- **Fewer choices can also mean hidden choices.** Putting things behind a chevron works against "out of sight,
  out of mind" for the rare moves. That is fine for Park or Not mine. It is not fine for the free way out
  (rule 6), which is why that one is never in depth.
- **"Fuzz does the work" has a downside.** If Hand it to Fuzz is always the fill, some tasks the user should own
  may drift to avoidance. The check-in card and "Not mine" are the counterweights. Worth asking in a real trial.

## Part 4. Where the current cards break the rules

Found by reading `js/view-triage.js`, as it is on main.

| # | Where | Break | Rule | Suggested fix |
|---|---|---|---|---|
| 1 | Big task card (`bigRow`) | Five choices in a lead block, then the four standing buttons: nine visible. | 2 | Lead shows the suggested one and one alternative. The rest go behind Later's chevron. The standing row stays. |
| 2 | Working card | Six visible: Done, Keep going, Pause, Hand to Fuzz ▾, Work in Claude, Book time. It is the card for focus, so it should be the calmest. | 2, 5 | Done leads. Keep Pause and Keep going when it applies. Move the rest into one chevron. |
| 3 | Working card | "Hand to Fuzz" where every other card says "Hand it to Fuzz". | 3, 8 | Use "Hand it to Fuzz". |
| 4 | Stale check-in | Two answers plus It still matters, Later and Let it go: five. | 2 | Move "Just the first step" behind Hand it to Fuzz as a menu item, or fold It still matters into Later's chevron. Needs your call. |
| 5 | Choice and entity cards | "Not sure yet" is key 3, or 4 when there is a third answer, so the free way out moves. Every task card uses S. | 3, 4, 6 | Bind S too, and show it as the hint. |
| 6 | Icons | Hand it to Fuzz (arrow), Later (clock) and Done (check) have icons. Work in Claude has none, and the check-in row and answers have none. | 3 | Pick one rule: icons on the standing verbs only, everywhere, or none. |
| 7 | Result card | Done leads and "Ask me later" replaces Later. Same move, different word. | 3 | Keep one word, "Later". |
| 8 | Check-in card (screenshot 1) | "Keep it parked" and "Let it go" sit next to each other at equal weight in the same row: close, similar, and the second is a close verb. | 9 | Put Let it go in the chevron of Later, or leave a gap. Undo makes this low risk. Needs your call. |
| 9 | Check-in card | "Check again later" is S on a waiting card, and Later is S elsewhere. | 3 | It is the same family and the same key, so allowed. Keep the label, and note it here. |
| 10 | Layout | "Tell Fuzz something" sits above the row on the check-in card and inside the box on the "I'll do this" card. | 5 | One place for E: the link goes directly under the lead on every card. |

Screenshot 2 (the "I'll do this" card) is the closest to the target. It has one fill, a stable row, chevrons
on the verbs that have cousins, and four visible. Screenshot 3 (Yes / No / Not sure yet) is right on the
budget and the fill, but breaks rule 4. Screenshot 1 (the parked check-in) follows rules 1 and 6, and
breaks rules 2 and 9 a little.

## Part 5. Decisions for you

1. **Stale check-in (item 4).** Which gives way, "Just the first step" or "It still matters"?
2. **Let it go (item 8).** Keep it in the row, or move it into a chevron on that card?
3. **Icons (item 6).** On the standing verbs only, or none?
4. **Do you want a test?** Rule 1 (one fill), rule 2 (four visible) and rule 3 (a key means one verb) can be
   checked by a UI test that renders each card kind and counts. That would stop this drifting again.

## How to use this

When adding or changing a card's actions, start at Part 1: name the lead, then pick standing verbs from the
rule 3 list, then push the rest into depth. If a new action does not fit a layer, that is a sign it is a new
card kind, not a new button.
