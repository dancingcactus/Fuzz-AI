# Series list mocks (2026-11-19)

Four directions for the Series page, plus today's page re-created for comparison. Made-up demo data
(extended from `DEMO_SERIES` in `js/store.js`). Open `index.html` in a browser; the tabs switch mocks,
and `#rows`, `#episodes`, `#sentence`, `#by-part`, `#now` link to each one.

The problem: the page is a full-width card grid while Lineup is a centered row list, and with your
real data most cards are just a name, counts and a "Work on …" button. Nothing says what a series is.

- **A · Rows**: Lineup's row list, a one-line "what it is", your part, last moved. Work on moves to the sheet.
- **B · Episodes** (picked 2026-11-19): rows plus one dot per task (done / up next / to do) and Last / Next lines.
  Past 20 tasks, the done ones fold into one box with their count in fives ([35] for 37), then the leftover dots; open
  tasks past 9 show as "+N more". Each card has an Edit button and lights up on hover; the card, its
  name or Edit opens the series page (below). Work on it goes to Triage.
- **C · In a sentence**: Fuzz describes each series in a sentence, with one "Next in …" action.
- **D · By your part**: grouped Driving / Helping / Keeping up / Not sure yet, with icon status.

All of them put a small Fuzz explanation of a series at the top (dismissable) and fold
Fuzz is watching and Wrapped, like Lineup's folds.

Data need common to every direction: a one-line `about` per series that is always filled. The
`goal` fact is usually missing on real series, so Fuzz should write the line from member tasks
when it has no goal, marked "Fuzz's guess" (see Acme security review in the mocks).

## The series page (B · Series page, `#page-1`)

Clicking a series in B opens its own page in place, following the artifact viewer (`artifact.html`), not a
dialog. Top bar: a "‹ Series" back pill, the name with a short status line, Work on it, and ⋯ for the rarer
moves (Rename, Quiet the suggestions, Split it into parts, It's wrapped up, Not a series, It's ongoing).
One centered column:

- the list card opened up: the about line with an edit pencil, the strip, Last
- Next in …
- What Fuzz knows: each fact Fuzz has is a row you click to fix in place, with its source under it. Your
  fixes say "you · just now". The gaps sit underneath as dashed chips ("Fuzz doesn't know yet: + Goal
  + Your part …"); each opens a form shaped for that fact: Your part is three choices that save on a click,
  Goal and Done when offer Fuzz's ideas to fill the field, For / Owner / Blocked on offer the series' people.
  Every form has one line on how Fuzz uses the fact. "+ Something else" adds Owner, Blocked on, Rhythm
  or Not part of it. A guessed about line gets a "Looks right" button.
- Tasks: Open / Done, with Add a task
- How Fuzz spots it: chips you remove, and a field to add one
- Deliverables, Decided and People

`#page-0` … `#page-5` open each demo series; `#page-3` (Acme) shows a sparse one.
