# Card actions: principles

> **2026-11-23: I'll do it (G) and Do it now are retired** (`docs/book-then-work.md`). There is no queue: a task that needs time
> is booked or postponed, and a small one you do yourself is done, then marked Done. Rows below that name them are history.
> The big-task card leads with Book time, and a task that waited in the old queue (`ask_book`) does too. "My work" is
> now Focus time. The working card is retired too: booked time that has started leads with Start Focus time, and a block's end keeps
> its own card.

Status: **proposal, 2026-11-21, built on every Triage card** (Part 6) and checked by `tests/ui/card-actions.test.mjs`.
Still to do, and not mine to do: the author's sign-off on the rules not marked as theirs, the author's approval of
the new icons and of Keep going on N, and a review of Part 3 by someone qualified in ADHD. Rules 3, 9, 12, 14 and 15 and the Let it go and icon calls are the author's
(2026-11-21). The rest is not yet signed off. Part 3 checks the rules against ADHD
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
| **Standing verbs** | The few moves every card shares: hand off, do it myself, later, done, let go. | The row under the lead, always in the same order. | Four visible, with the same word, key and place on every card |
| **Depth** | Everything else that is still possible. | Behind a chevron, or the E link ("Tell Fuzz something"). | One level, up to four items, each with a line saying what happens |

A card's job is to pick one lead, show the standing verbs that make sense for it, and push the rest into
depth. It does not invent new buttons.

## Part 2. The rules

**1. One lead, one fill.** Each card has exactly one filled button, the move Fuzz thinks is right. On a card
with numbered answers it is answer 1. On a result Fuzz found, it is Done. Moving the fill (Do it now versus
Book time on a big task) is fine. Two fills is not.

**2. Four visible, the rest in depth.** At most four visible choices: the lead and up to three sub-actions
(rule 12). Numbered answers count. "Tell Fuzz something" is an input, not a choice, so it doesn't count. Nothing is
removed: what doesn't fit goes behind the chevron of the standing verb it is closest to.
(Existing rule, 2026-11-13.)

**3. A verb keeps its word, key and place.** If Later is S, third in the row on one card,
it is that on every card that has it. A card that needs a different meaning gets a different word and a
different key. It never reuses one. The letter keys are the standing verbs: A hand off, C work in Claude,
H help me start, S later, D done, K it still matters, N keep going, L let it go, P park, W waiting, X not mine, E tell Fuzz.
**Only the lead carries an icon.** The main button wears the icon of its verb (arrow for Hand it to Fuzz,
check for Done), because it is the one thing every card asks the user to recognise at a glance. Sub-actions and
menu items are words and a key hint only, which keeps the row quiet. A verb keeps the same icon whenever it
is the lead, so Done is a check on every card where it leads. A lead that is a numbered answer wears its number
instead: it is an answer, not a verb. A verb that moves into a chevron keeps its key, so L still works when Let
it go sits in Done's menu.

**4. Numbers are for answers, letters are for verbs.** 1, 2, 3 mean "the nth answer in the lead block".
They never mean a standing verb. So "Not sure yet" on a choice card is also S, because it is the same
move as Later, even if it is drawn in the numbered column.

**5. Fixed order, fixed place.** The standing row is always at the bottom of the card and always reads in the
same order, the order of the themes in rule 15: **who does it**, then **when**, then **clear it from my
plate**. That is the order of the questions the user asks themselves: who will do this, when, and if not, can
it go. The card above the row changes, and the row does not move. After an interruption, the user's eyes go to
the same spot. It is a default: when a card's lead is itself one of those moves (Done leading on a result),
the remaining themes keep their relative order, and no sub-action jumps ahead of another.

**6. Every card has a free way out.** Later, Not sure yet or Not now: always S, always
described as no penalty. Later is a visible button, or the first item behind the chevron of the time split button when Book time is its face (an ordinary task card). A card that can only be answered "yes" is a trap. The way out is never red, never
counted, and never a dialog.

**7. Close verbs act at once and are undoable.** Done and Let it go do not ask "are you sure?". Fuzz says what
happened, and Undo is there. Anything that cannot be undone (sending) is not a button on the card at all: it
is a draft that waits for an OK (product principle 5). A numbered pick that hands the task over is the
hand-off: the card leaves, with no second Hand it to Fuzz step (existing rule, 2026-11-13).

**8. Say what happens, in the user's words, two to four words.** Start with a verb or a plain state: "Hand it
to Fuzz", "I'll do it", "Done", "Bring it back". The consequence goes in the small line under the label or in
the menu, not on the button. Vocabulary follows `docs/nav-guide.md`: the session is "Focus time",
the buttons are "Work on…", and there is no "I'll do it" (a task is booked or postponed).

**9. Weight says importance, never alarm.** The lead is filled. Standing verbs are outlined and the same
size. A chevron shares the weight of the button it belongs to. Nothing on a card is red, and Let it go is
only filled when Fuzz is actually leaning that way (`leansGo`). Targets are at least 44 px. Let it go lives
in Done's chevron (rule 15) on cards that come back to ask, so the user does not meet it by accident. (The hope is
that those cards appear less and less, as Fuzz learns what to let go of itself.)

**10. Hand-off first.** Fuzz does the work (principle 1). So where it applies, Hand it to Fuzz leads the
standing row, and the verbs that mean "I'll carry this" (Work in Claude, I'll do it) follow it.

**11. The answer is a result, not a spinner.** A press moves to the next card in the same beat, and Fuzz says
in one line what he did. A card is never left in a half-pressed state.

**12. The lead is full width, with up to three sub-actions on the row below.** The lead spans the card and is
the only filled button. Directly under it is one row of at most three sub-actions, equal in width, outlined,
each with its chevron where it has depth. That is the whole action area: one big target, then three. It
matches the screenshots of the "I'll do this" card and the Yes / No / Not sure yet card, and it is rule 2
made visible. A card never has a second row of sub-actions, a second lead, or two filled buttons side by
side. When a choice card has more than one answer, answer 1 is the lead and the others share the row below.

**13. Whatever the user wrote for Fuzz (E) goes with every action.** If there is text in the "Tell Fuzz
something" box when any button is pressed, lead, sub-action or menu item, that text is sent along with the
action, as the instruction for a hand-off or as a note on the task for the rest (Later, Done, Park, Let it
go). Nothing typed is ever dropped, and no action asks the user to send the note first. The card shows that
a note is attached, so the user can see it will travel. Only the way out of the box itself (Escape, or
clearing it) discards the text.

**14. When Fuzz suspects a task is being avoided, the lead changes, not the layout.** Signals are a task
rescheduled again and again, a long time in the queue, or a hand-off bounced back. The card then leads with
the move that makes starting cheapest, picked by the likely cause: a big task or an unknown cause leads with Help me
start, a decision leads with Fuzz's pick, and a draft the user doesn't want to write leads with Fuzz drafting
it. The card says so in **one short, neutral line** above the
lead, such as "This one keeps moving. Want a smaller first step?" Then it stays out of the way.
- Rules 3, 6 and 12 hold: same keys, the free way out still there, a full-width lead with at most three
  sub-actions. Rule 2's budget holds too, so nothing is added to the card, only swapped.
- The line never accuses and never counts. No "you've put this off 4 times", nothing red, no streak (product
  principle 2). It asks, or offers.
- The line appears once per change of lead, not on every visit. Choosing Later again is allowed and is never
  met with a nag or a sterner line.
- The change is visible, never silent. Someone coming back after an interruption should be able to see why
  the lead is not what it was.

**15. A menu holds one theme.** Everything behind a chevron is the same kind of move as the button it hangs
from, so the user can guess what is inside before opening it. There are three themes:
- **Who does it** (Hand it to Fuzz ▾): Help me start (H) and Work in Claude (C). (I'll do it and Do it now are retired.)
- **When** (Book time ▾ on a task card, Later ▾ elsewhere): Later, After the others, Check again later, It still matters. Where Book time is offered it is the face and Later is the first item behind the chevron.
- **Clear it from my plate** (Done ▾): Park it, Waiting on someone, Not mine, Let it go.

The order is the same on every card (rule 5): who does it, when, clear it from my plate.

An item lives in exactly one place. Work in Claude is a "who does it" move, but when there is room it is a
plain button in the first sub-action slot instead of a menu item, because it is the one real alternative to
handing off and has its own key. It is never in both. When there is no room, it goes back into the lead's menu.
A menu has at most four items, most common first, and its label names the
theme in a few words ("Clear it another way", "Book time instead"). If a new item does not fit a theme, it
belongs in a different menu, or it is a new card kind. If a menu needs "Other" or "More" in its name, it is a
grab bag, and it gets split. Keys stay on the verb, so P, W, X and L work from inside the menu.

### What the rules give each card kind

Each row is the full-width lead, then at most three sub-actions (rule 12).

| Card kind | Lead (full width, filled) | Sub-actions (one row, up to 3) | Depth |
|---|---|---|---|
| Ordinary task | Hand it to Fuzz ▾ | Work in Claude · Book time ▾ · Done ▾ | Who does it: Help me start. When: Later, After the others. Clear it: Park it, Waiting on someone, Not mine |
| Choice or entity question | Answer 1 | The other answers; Not sure yet is always one of them | Something else (E) |
| Fuzz's answers (a handback) | Answer 1 | Other answers · Later ▾ · Done ▾ | Tell Fuzz (E), Other ways |
| Parked check-in | Bring it back | Keep it parked · Later ▾ · Done ▾ | When: Book time. Clear it: Let it go (L), Not mine |
| Stale check-in | Hand it to Fuzz | Help me start · Later ▾ · Done ▾ | When: It still matters (K), Book time. Clear it: Let it go (L), Park it, Not mine |
| Result Fuzz found | Done | Send Fuzz further · Later | Other ways |
| Working card | Done | Hand it to Fuzz ▾ · Pause (Keep going takes its place at the end of a block) · Later ▾ | Who does it: I’ll do it, Work in Claude. When: Book the rest |
| Big task | The suggested way to take it ▾ | The one alternative · Later ▾ · Done ▾ | Who does it and how: the other ways to take it, in the lead's chevron. Later keeps only the When items |

## Part 3. Checking the rules against ADHD practice

How strong the evidence is, so none of this is oversold. I wrote these from general knowledge of the ADHD
and executive-function literature and clinical guidance. I did not look up sources for this draft, so the
named ideas are accurate but none of them are cited. Before anything ships, the person qualified in ADHD
reviews it (the plan in `docs/fuzz-tone.md`).

| ADHD challenge | What helps | Rules that carry it | Verdict |
|---|---|---|---|
| **Starting.** The hard part is the first move, and a blank decision is a wall. | Pre-chosen next step; the lowest-effort first action. | 1, 10, 12 | Strong. The fill is the start button, the biggest target on the card, and Fuzz does the doing. |
| **Too many options.** Choice overload hits harder under fatigue. | Fewer visible choices; a clear recommendation. | 1, 2 | Strong, as long as 2 is really kept (see Part 4). |
| **Working memory.** Holding what a button does, or where it is, costs effort. A thought typed and then lost is a cost too. | Consistency; recognition over recall; stable layout; capture without a second step. | 3, 5, 8, 13, 15 | Strong. This is where today's cards are weakest. |
| **Re-entry after interruption.** The user loses their place and the thread. | Same place, same shape, state shown on the card. | 5, 11 | Strong for layout. The card also needs to show *where you were* (outside this doc). |
| **Shame and emotional load.** Piles of undone things feel like accusations. | Neutral colour and wording; no counts; no penalty. | 6, 9 | Strong. Emotional dysregulation is well documented in ADHD. Rejection sensitivity is a popular label rather than a diagnosis, so use it as a design cue, not a claim. |
| **Impulsivity and mis-taps.** A quick press lands on the wrong button. | Undo instead of confirm dialogs; targets spaced apart. | 7, 9 | Reasonable. Undo beats a "Sure?" dialog, which people click through. |
| **Delay aversion and time blindness.** Waiting without feedback loses attention. | Immediate, visible response; time in human terms. | 11 (and the existing time wording) | Reasonable. |
| **Keyboard shortcuts.** Fast for those who learn them, but they depend on memory. | Visible hints on the button; never required. | 3, 4 | Mixed. Shortcuts help the repeat user and burden the new one, so the hint must always be on the button. |

Avoidance is on the table too, as one more row:

| ADHD challenge | What helps | Rules that carry it | Verdict |
|---|---|---|---|
| **Avoidance.** A task keeps getting pushed, usually because the first step is unclear, the task is big, or it carries emotional weight. It is rarely laziness. | Shrink the start; take over the decision; name the barrier without blame. | 14, 2, 6 | Reasonable. The risks are that the change feels like surveillance or shame, and that a shifting layout breaks muscle memory. Rule 14 swaps the lead only, in neutral words, which limits both. |

Two cautions beyond the table.

- **Fewer choices can also mean hidden choices.** Putting things behind a chevron works against "out of sight,
  out of mind" for the rare moves. That is fine for Park or Not mine. It is not fine for the free way out
  (rule 6), which is why that one is never in depth.
- **"Fuzz does the work" has a downside.** If Hand it to Fuzz is always the fill, some tasks the user should own
  may drift to avoidance. The check-in card and "Not mine" are the counterweights. Worth asking in a real trial.

## Part 4. Where the current cards break the rules

Found by reading `js/view-triage.js`, as it was on main. The last line of each row says what is built now.

| # | Where | Break | Rule | Suggested fix |
|---|---|---|---|---|
| 1 | Big task card (`bigRow`) | Five choices in a lead block, then the four standing buttons: nine visible. | 2 | Lead shows the suggested one and one alternative. The rest go behind the lead's chevron, which holds the take-it-on ways. The standing row stays. **Status:** **Built.** The big task card is the suggested way, one alternative, Later ▾ and Done ▾: four visible. |
| 2 | Working card | Six visible: Done, Keep going, Pause, Hand to Fuzz ▾, Work in Claude, Book time. It is the card for focus, so it should be the calmest. | 2, 5 | Done leads. Keep Pause and Keep going when it applies. Move the rest into one chevron. **Status:** **Built.** Done leads; Hand it to Fuzz ▾ (I’ll do it, Work in Claude), Pause (Keep going at the end of a block) and Later ▾ (Book the rest) share the row, in the order of rule 5. |
| 3 | Working card | "Hand to Fuzz" where every other card says "Hand it to Fuzz". | 3, 8 | Use "Hand it to Fuzz". **Status:** **Built.** |
| 4 | Stale check-in | Two answers plus It still matters, Later and Let it go: five. | 2, 12 | Let it go moves into Done's chevron (items 8 and 14), and It still matters moves into Later's. That leaves the lead plus Help me start, Later and Done. **Status:** **Built.** Hand it to Fuzz leads; Help me start, Later ▾ (It still matters, Book time) and Done ▾ (Park it, Not mine, Let it go) share the row. |
| 5 | Choice and entity cards | "Not sure yet" is key 3, or 4 when there is a third answer, so the free way out moves. Every task card uses S. | 3, 4, 6 | Bind S too, and show it as the hint. **Status:** **Built.** Not sure yet is S and sits in the row. The numbers 3 and 4 no longer mean it. |
| 6 | Icons | Hand it to Fuzz (arrow), Later (clock) and Done (check) have icons. Work in Claude, It still matters, Let it go, Pause and the menu items have none. | 3 | Decided: only the lead has an icon. Later and Done lose theirs (the clock and the check) when they are sub-actions. Every verb that can lead needs one icon: Hand it to Fuzz and Done have theirs, and Help me start, Bring it back, Book time, Do it now, Let it go and Pause (on the working card) need one. **Status:** **Built.** Only the lead wears one. Every verb that can lead has an icon in `js/card-actions.js` (`ICON`); the new ones are first drawings in the stroke style of the arrow and the check, easy to swap. |
| 7 | Result card | Done leads and "Ask me later" replaces Later. Same move, different word. | 3 | Keep one word, "Later". **Status:** **Built.** The result card says Later. |
| 8 | Check-in card (screenshot 1) | "Keep it parked" and "Let it go" sit next to each other at equal weight in the same row, and the lead is not full width. | 9, 12 | Decided: Let it go moves into a chevron, key L kept (Done's, under rule 15). Bring it back becomes the full-width lead, with Keep it parked, Later ▾ and Done ▾ on the row below. **Status:** **Built.** The parked check-in leads with Bring it back; Let it go is in Done’s menu, and leads only when `leansGo`. |
| 9 | Check-in card | "Check again later" is S on a waiting card, and Later is S elsewhere. | 3 | It is the same family and the same key, so allowed. Keep the label, and note it here. **Status:** Unchanged, as decided. |
| 10 | Layout | "Tell Fuzz something" sits above the row on the check-in card and inside the box on the "I'll do this" card. | 5 | One place for E: the link goes directly under the lead on every card. **Status:** **Built.** On every card with a lead the link sits right under the actions. The ordinary card’s “I’ll do this” block above the lead is Fuzz’s plan, not the link, and stays there by design. |
| 11 | Every card with a lead | The lead and the sub-actions are the same width, or the lead is a numbered tile in a list, or the answers are stacked. | 12 | One full-width lead, then one row of up to three. Build it once as a shared card-actions component so no card lays out its own. **Status:** **Built.** `js/card-actions.js`: the task, answer, result, big, join, working, review (a draft waiting for your OK), check-in, entity, deliverable, part-of, hold, series proposal, setup and what’s-in-the-way cards describe what they offer as data and the component lays it out. No card builds its own action row now. A setup card that is only waiting (“Asking Claude what it can reach…”) has nothing to decide, so its one button, Not now, is a quiet lead (outlined, not filled). On the hours question, Skip for now is in the row and No fixed hours sits behind Other hours. |
| 12 | Every action | Most actions already read the box (Done, Work in Claude, Later, Park, Let it go, and the check-in answers call `pendingNote`), but I haven't checked every one. Pause, Keep it parked, Check again later, Nudge them and the other menu items are unconfirmed. | 13 | Press every action with text in the box and fix any that drops it. A UI test (Part 5) would keep it so. **Status:** **Built and tested.** `tests/ui/card-actions.test.mjs` types a note and presses park, after the others, not mine, I’ll do it, Help me start, let it go, It still matters, keep, keep parked, bring it back, check again later, they got back, nudge, hand it to Fuzz, Pause and Waiting on someone, and finds the note on the task. The entity cards dropped it before; answering one now tells the note to the card. The review card has no Tell Fuzz box (its draft is the text, and Ask Fuzz to change it is how you say more), so the rule does not apply there. |
| 13 | Avoidance | The keeps-coming-back card already leads with Help me start and words it neutrally, and the "what’s in the way" sheet exists. But the lead swap only happens on that one card kind, the sheet is a separate stacked list of four tiles outside the rule 12 shape, and no card shows the one neutral line. I have not checked what an ordinary task does after several reschedules. | 14, 12 | Make the swap general: pick the lead by likely cause, add the one-line prompt above it, and fold the sheet into the lead and a row of three. **Status:** **Built.** Three signals the app already carries change the lead, each under a neutral line: a task that keeps getting a new time (`putOff`) becomes the keeps-coming-back card, leading with Help me start; a card sent to the end of the list once (`afterOthers`) leads with Help me start under “This one has waited its turn. Want a smaller first step?”, said once per card and never counted; and a card sent there twice (`inTheWay`) opens the “What’s in the way?” sheet, whose causes each pick the lead Fuzz would use. All keep rules 3, 6 and 12. |
| 14 | Menus | Done ▾ holds Do it now (who does it) and After the others (when), alongside Park it, Waiting and Not mine (clear it). On the stale and putoff cards Later ▾ holds Park it and Not mine. The big-task card puts take-it-on ways under Later. The working card's More ▾ is a grab bag. | 15 | Move each item to the menu of its theme (Part 2, rule 15). Rename or split any menu whose label needs "Other" or "More". **Status:** **Built** for the task, answer, result, big, join, working and check-in cards. One exception by design: a card with three or more answers puts the rest behind its second answer’s chevron, an “answers” menu, the one menu that is not a theme. |
| 15 | Naming | "Just the first step" (`firststep`, in the big-task row, the stale answers and `live.js`) is a noun phrase among verbs, and does the same job as "Help me start" on the keeps-coming-back card (`unclear`): both work out what it needs and a two-minute first step. | 3, 8 | Decided: one action, **Help me start**, replacing both. It is a "who does it" move, lives in the Hand it to Fuzz menu, and is the lead on the keeps-coming-back card. Both `firststep` and `unclear` become one handler. It takes H, the key "Help me start" had before it was retired, which means updating the test that asserts H is gone. **Status:** **Built.** `helpstart` (H) replaces `firststep` and `unclear`; the retired-key test no longer lists H. `Store.firstStep` is left in the store, unused. |

Screenshot 2 (the "I'll do this" card) is the closest to the target: a full-width fill, then one row of
three, with chevrons on the verbs that have cousins. Screenshot 3 (Yes / No / Not sure yet) already has
the rule 12 shape, but breaks rule 4. Screenshot 1 (the parked check-in) follows rules 1 and 6, and breaks
rules 9 and 12.

## Part 5. Decisions

Settled by the author, 2026-11-21:

- **Let it go** moves into a chevron on the cards that come back to ask. The aim is for those cards to
  appear less and less over time. Rule 15 refines which chevron: it is a clear-it move, so it sits with Park it
  and Not mine in Done's menu, not in Later's. That is my proposal, so say if you want it kept under Later.
- **Menus** (rule 15): a chevron holds one theme, so Done and Park it share a menu.
- **Icons** go on the lead only (the full-width main button). Sub-actions and menu items have none.
- **Layout** is rule 12: a full-width lead, then up to three sub-actions on the next row.
- **Avoidance** (rule 14): the options change when a task seems to be avoided, and the card says so in one
  short, neutral line.

Defaults I chose while building, applied and tested. Change any of them if you disagree; each is one line to
change:

1. **Icons.** Every verb that can lead has one, drawn in the stroke style of the arrow and the check (`ICON` in
   `js/card-actions.js`).
2. **Keep going is N,** so K means only It still matters.
3. **The review, deliverable, hold and part-of cards follow every rule.** They are tested with the rest: one
   fill, at most three in the row, icons only on the lead, a key meaning one verb, and a free way out on S (Not
   sure yet on a question, Skip on a hold, Not now on a draft).
4. **Avoidance** (rule 14, audit 13): built, on the card’s own signals (`putOff`, `afterOthers`, `inTheWay`).
   Which of those the core sets, and after how many reschedules, is the core’s setting, not the card’s.

## Part 6. How it is built

`js/card-actions.js` (loaded before `view-triage.js`) holds two things.

- **`VERBS`**, the one place a verb's word, key, icon, theme and menu line are written. Rule 3 is therefore
  structural: a card cannot give Later a different key.
- **`CardActions.render(spec)`**, which lays out the area. A card describes what it offers as data:

```js
CardActions.render({
  lead: { verb: 'assign', menu: { theme: 'who', items: ['deepwork', 'donow'] } },
  row:  [ 'claude',
          { verb: 'schedule', menu: { theme: 'when', items: ['book', 'afterothers'] } },
          { verb: 'done',     menu: { theme: 'clear', items: ['park', 'waiting', 'theirs'] } } ]
});
```

A slot is a verb id, `{ verb, label?, menu? }`, or `{ answer: { n, label, small, quick | act } }` for a numbered
answer. Only the lead gets an icon, or its number. `render()` records anything that breaks a rule in
`CardActions.violations` (two fills, more than three sub-actions or four visible, a key that means two verbs,
a menu of more than four items or of a mixed theme) and warns on the console. The layout is one block of CSS,
`.card-actions`, replacing the per-card grid areas.

`render()` also checks rule 5: no sub-action may come before one of an earlier theme. `tests/ui/card-actions.test.mjs` renders nineteen card kinds, and the setup cards, (the working, join, big, result, answer, entity, review, check-in and what’s-in-the-way cards, among others) and checks rules 1, 2/12, 3, 5, 6, 13 and 15 on each.

## How to use this

When adding or changing a card's actions, start at Part 1: name the lead, then pick standing verbs from the
rule 3 list, then push the rest into depth. If a new action does not fit a layer, that is a sign it is a new
card kind, not a new button.
