# Series list mocks (2026-11-19)

Four directions for the Series page, plus today's page re-created for comparison. Made-up demo data
(extended from `DEMO_SERIES` in `js/store.js`). Open `index.html` in a browser; the tabs switch mocks,
and `#rows`, `#episodes`, `#sentence`, `#by-part`, `#now` link to each one.

The problem: the page is a full-width card grid while Lineup is a centered row list, and with your
real data most cards are just a name, counts and a "Work on …" button. Nothing says what a series is.

- **A · Rows**: Lineup's row list, a one-line "what it is", your part, last moved. Work on moves to the sheet.
- **B · Episodes**: rows plus one dot per task (done / up next / to do) and Last / Next lines.
- **C · In a sentence**: Fuzz describes each series in a sentence, with one "Next in …" action.
- **D · By your part**: grouped Driving / Helping / Keeping up / Not sure yet, with icon status.

All of them put a small Fuzz explanation of a series at the top (dismissable) and fold
Fuzz is watching and Wrapped, like Lineup's folds.

Data need common to every direction: a one-line `about` per series that is always filled. The
`goal` fact is usually missing on real series, so Fuzz should write the line from member tasks
when it has no goal, marked "Fuzz's guess" (see Acme security review in the mocks).
