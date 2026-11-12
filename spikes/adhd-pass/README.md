# Spike: ADHD pass

Mockups for the findings of an ADHD-focused review of the demo. Static, with no store and no core. Start a static server at
the repo root (`python3 -m http.server`) and open `http://127.0.0.1:8000/spikes/adhd-pass/`. It uses the app's own
`css/app.css`, `css/fuzz.css`, `js/themes.js` and `js/fuzz-svg.js`, so it works in every theme.

| Screen | Finding | The change |
| --- | --- | --- |
| Arrival | Arriving starts with a question (#7) | A "While you were away" recap, then Fuzz's pick with a reason. Enter takes it, O picks something else |
| Task card | An ordinary task with nothing to choose between (#2, #3, #4) | The headline is the task and **Hand it to Fuzz** (A) is the main button. Fuzz's plan is plain text under "I'll do this", and E makes it editable (⌘ Enter hands it over, Esc keeps your changes) |
| Question card | The headline question can't be answered on the card (#3) | The answers are numbered buttons. Each one is also the instruction, so one key decides it and hands it over |
| Question card | Key chips type letters into a focused box (#2) | No card starts in a text box. Choosing "Something else" fades the chips, says you're typing, and ⌘ Enter hands it over |
| Question card | Too much to read on one card (#4) | Source, question, what Fuzz found, answers and three other moves. Everything else folds under Details (I) |
| Question card | A returning draft leaves the card on screen dead (#1) | "A draft comes back now" shows the fix: the draft waits as a quiet line above and comes next |
| Draft card | Recap blocks stack up, and the first step no longer applies (#4) | One line about what Fuzz did |
| Handed back | The either/or sits apart from the main actions (#3, #4) | The card leads with Fuzz's question. Its answers, including "I'll sort it myself", are numbered choices. Fuzz apologises once, in his bubble |
| Coming back | Stale, keeps coming back, and Deep Work's stalled and not-picked cards each had their own keys (#6) | One layout for all four. Fuzz's ways forward are numbered, and It still matters (K), Later (S) and Let it go (L) are the same row on every card. H is retired |
| Check-back | G and U only exist here, and U is also Undo in Deep Work (#6) | They become choices 1 and 2. The nudge opens on the card and still needs a click to send |
| Entity checks | A focused note box swallows 1 to 3, and a borrowed deadline pill (#1, #2) | No deadline, a time estimate instead. The note is a link (E), and a term's guess is plain text that E changes |
| Lineup, header | Counts of what's left (#5) | No "15 · To decide" tile and no empty progress slots. Triage gets one neutral row naming what's first |
| Keys | Letters with two meanings (#6) | One letter, one meaning. Time pickers use numbers for every option |
| New task | The document panel sits above the field (#9) | The field comes first and has focus. Adding a document is a small link |

The bug in #1 also needs the fix in the code: the card on screen stays at the front of the queue until you act on it
(`js/store.js` `sortQueue`), and the deadline pill is painted from the card on screen, not the front of the queue
(`js/view-triage.js` tick timer).

**Tell Fuzz (E) on every card.** Every card has a way to give Fuzz instructions, whatever you choose. E opens a note
box (on the task card it edits the plan, on a draft it asks for a change, on a term it edits Fuzz's guess). Esc keeps
the note and brings the keys back, and the next answer or action takes it along: "16, and copy Ines", "Check again
later, she's out until Monday". Where a card has "Something else", ⌘ Enter hands the note over by itself.

**Drop a file.** Drag a file over the page and the place it can go becomes a dashed drop zone: the box on New task,
or the Tell Fuzz spot on the card in front of you (task, question, draft, handed back, coming back, check-back and
entity cards). Dropping opens that card's box, as E would, and adds the file as a chip you can remove. It goes along
with whatever you pick next, and Fuzz says so ("1 file goes with it"). A drop anywhere else does nothing, and Fuzz points
at the box. "Add a document" on New task opens the file picker. Only file names are kept, as in the demo.

**Split buttons stay.** The arrow buttons are the path for whatever doesn't fit the main moves, so every card keeps
them: Book time behind Later, and Clear it another way (Do it now, After the others,
Park it, Waiting on someone, Not mine) behind I did it, as in the app. On a draft, Mark done (you send it yourself)
stays behind Approve and send. The newer cards have Clear it another way behind their Later. B, P, W and X work
without opening the menu.

**No Find out mode.** Find out… (Q) is gone. What you hand over decides it: a question ("who's still a maybe?",
"check whether the team still uses the old prefix") gets looked up, and the card comes back to you with the answer.
Anything else, Fuzz does. He says which the moment you hand it over ("That's a question, so I'll find out and bring
this card back to you"), and Undo is there if he read it wrong. This works on the task card's plan, the question card's
Something else, and the Something else on handed-back and coming-back cards.
