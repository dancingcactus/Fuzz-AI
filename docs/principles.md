# How the principles show up in the app

The numbered design principles, and where each one shows in the app. Product principles are in [`PRODUCT.md`](../PRODUCT.md); onboarding has its own in [`onboarding.md`](onboarding.md). Back to the [README](../README.md).

| # | Principle | In the app |
| --- | --- | --- |
| 1 | Execution partner | **Hand it to Fuzz** is the primary action. Fuzz keeps working at inbox zero and the empty queue lists what he is doing |
| 2 | Non-linear work | A handback is a normal card that goes to the end of the queue, not an error |
| 3 | Show the work | Every task has a "Done so far" log (research, action, guidance, status, sent, blocked), and every click in the app writes to it |
| 4 | Thin records | Tasks hold a reference list (Sources) and the extracted ask, never the full message |
| 5 | Shared entity service | Entity checks (person, term) and merge/keep-separate matching cards |
| 6 | Humans approve what can't be undone | A finished draft joins the triage queue as a **Needs your OK** card that says who it goes to and how, lets you edit it or **Ask Fuzz to change it**, and sends only on **Approve and send** (never from a single key); then Fuzz sends it with its own connected tools, shown as **Sending** in Lineup. Concurrency starts at five (the sixth task shows "Next up"). Every change has **Undo** (an Undo button in the header with a list of recent actions), and each one undoes on its own, the way the core's Undo works. Once something else has changed the same task (Fuzz started on it, it was sent, you moved it again), that change stays in the list, dimmed, with the reason it can't be undone |
| 8 | Capture costs nothing | New task is one field, one key (N), no categories. |
| 9 | Lower the cost of starting | "Smallest first step, two minutes" on each task card |
| 10 | Time is human | Schedule offers three likely times ("when I'm back at my desk", "later today", "before it's due"), plus an **Exact time** tile (X), with "before the planning review" and next week behind **More times**. Age is a three-segment cue, not a date |
| 11 | No shame spirals | No red overdue counts (past-due says "past its time"), a progress bar that only grows (cleared cards become ticks that fold into a counted block, new cards only add segments, and it counts what's cleared, not what's left), stale cards ask rather than pile up, Parked never nags |
| 12 | Easy re-entry | The Guide's "Where do you want to start?" when you arrive, a "Where you left off" recap on returning cards, a session recap when the queue is empty, and **Park a stray thought** without leaving the card |
| 13 | One thing at a time | One card that leads with the question to decide (or, with nothing to choose between, the task itself), then what Fuzz found (one line), then numbered answers or Fuzz's plan as plain text (E changes it) and actions. Where it came from, people and sources fold under Details. On a phone the actions sit in thumb reach, in two short rows (Assign and Done, then Work in Claude and Schedule). Each new card opens at its question, scrolling back up if you had read down the last one, and while Fuzz's perch is scrolled out of view his lines also appear in a small bubble under the header. A stale card asks whether it still matters before showing any other actions |
| 14 | Work alongside | Fuzz works visibly in the background, with a light status line now and then (never nagging) |
| 15 | Ambient beats initiated | Fuzz tells you when a draft is ready or something is handed back, from the perch or a small Fuzz on other pages. Fuzz also checks in on how you are, often at first and then less often |
| 16 | Match the task to the moment | Your check-in answer reorders the queue: Tired brings gentle cards first, Overloaded brings quick ones first |
| 17, 18 | Emotional connection, warm and quirky | Fuzz, the palettes, and a Calm mode that keeps the fades and drops the flashes |

Principles 7 (simplest thing that works) is about the build, so it shows up as the shape of this repo.
