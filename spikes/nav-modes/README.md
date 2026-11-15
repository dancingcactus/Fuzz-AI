# Spike: nav, modes and places

Today's nav puts four things side by side as equals: Triage · Deep Work · Lineup · Artifacts. Two of them are
**modes**, how you're working right now (Triage keeps things moving, Deep Work does the work). The other two are
**places**, which you visit to look something up (who has the ball, what Fuzz made). This spike tries four ways to
make that difference visible in the nav.

To try it, start a static server at the repo root (`python3 -m http.server`) and open
`http://127.0.0.1:8000/spikes/nav-modes/`. The page uses the app's `css/app.css`, `css/fuzz.css` and `js/themes.js`,
so every theme works. The page bodies are the same in all four options; only the way you get around changes.

## The options

- **A. A switch and a menu.** Triage | Deep Work is a toggle. Lineup and Artifacts move into a ≡ menu (L, F).
- **B. Each mode brings its own place.** The toggle, plus one link that changes with the mode: Lineup beside
  Triage, Artifacts beside Deep Work. Files also open from the task itself (the chip on the card).
- **C. One Library.** Triage · Deep Work · Library, and Library holds Tasks and Files.
- **D. One home, Fuzz suggests the mode.** **Now** reads the moment and suggests Keep things moving or Do my work.
  Once you pick, a small switch on the page lets you change your mind.

## Round 2

- **The places live under the settings button.** In A (and D by default) the settings button becomes the menu for
  Lineup, Artifacts, Settings and Keys and help. **Menu button** in the toolbar tries three faces for it: **You** (a
  person: "your stuff and your settings"), **the Fuzz logo** (the brand opens the menu and frees a button), and
  **Everything** (a grid).
- **No numbers.** Triage's count is a dot in every option. In a session it lights up only for what can't wait.
- **A way in and every way out of Deep Work.** One flow, shared by all four options. In D, Now becomes the session
  while it runs.
  - **In:** Now's "Do my work", "Go deep on something" when Triage is clear, or "Go deep on this" on a task in Lineup.
    All of these land on one screen: how long (Until 2pm first), then Fuzz's one pick, with the others a tap away.
  - **Paused, not out:** Something urgent pauses the clock and shows only that card. Walked away shows "Welcome back"
    with the next step. A break offers Back to it or Stop here.
  - **Out:** Stop for now, Finished the task (offers the next one if there's time), Time's up, or Meeting in 5. All of
    these land on one wrap-up: what you did, where you left off (pre-filled by Fuzz), then what happens to the task.
    Then Now recaps the session, and its suggestion depends on how the session ended.
  - Use the **During a session** buttons in the toolbar to trigger each event.

## Round 3

- **The menu is a small round icon button on the right**, where Settings was and in the same style, with no label.
  **Menu button** tries three icons: Person, Grid and Dots. The Fuzz-logo version is gone.
- **D has no mode toggle.** A switch on the page read as toggling the current task. Clicking **Now** always opens the
  start screen, which asks **"What do you want to work on?"** Triage is one of the answers, next to the Deep Work tasks,
  and Fuzz pre-picks one. **Start screen** in the toolbar switches between two layouts:
  - **One list:** Triage, then the tasks, as one choice. Picking a task adds "How long do you have?". One Start button.
  - **Two sides:** Keep things moving (a preview of what's waiting, Start Triage) beside Do my work (which task, how
    long, Start). Fuzz's suggested side is outlined.
- "Go deep on something" (Triage clear) and "Go deep on this" (Lineup) open the same start screen with that task already
  picked. Once you're in Triage, Now or "Pick something else" brings the start screen back.

## Round 4

- **"Where do you want to start?"** is the start screen's question. Under **Do my work** there's a box to type anything
  else. If what you type sounds like a task that's already ready, Fuzz offers it ("Use that"). If it's new, it becomes a
  task when you start.
- **Triage gets things ready; it doesn't move things to "Deep Work".** The queue Triage fills is **Ready for you**
  (**Queue name** tries Ready to work, Your work and Up next). The triage card's button is now the queue name, and
  **Deep Work** is only the name of the session.
- **Deep links, for calendar invites.** Sample invites under the frame (in D) open these:
  - `#/triage?until=13:30`: straight into Triage, with an end time.
  - `#/work?until=15:00`: the start screen, set to the calendar block, nothing picked.
  - `#/work/pricing?until=14:45`: the start screen with that task picked and the time set. One tap: Start.
  - `#/work?what=Draft%20the%20launch%20email&until=15:30`: something typed when the time was booked.

  A link lands one tap from Start; it doesn't start the session on its own. A link never ends a session that's running.
- **More menu icons:** Person, Grid, Dots, Dots upright, Lines, Fuzz's head (a line-drawn TV with its two antennas),
  Stack, Compass, Tray and Sliders.

## Round 5

- **Fuzz's head is the menu icon** (the default; the others are still in the toolbar).
- **Something else is a choice like the others.** Picking it asks, in Fuzz's words, "Tell me what you want to work
  on", right in the row: the title itself becomes the field. Start waits until you've said something, then matches it to a ready task or makes a new one.
- **The queue's name says it's yours, and the action says where it goes.** "Ready for you" didn't say whether it meant
  Fuzz or you, or that it goes in your work queue. Now there's a name and a triage-card action, in pairs (**Queue name**
  in the toolbar): My work / Add to my work, My queue / Add to my queue, My work queue / Add to my work queue, On my plate
  / Put it on my plate, My list / Add to my list. When you add something, Fuzz says whose it is and what it will do:
  "Added to your work. It's yours to do, not mine. Before you get to it, I'll pull in … so it's ready when you start."

## Toolbar

- **Waiting in Triage, Can't wait, Deep Work pool** change the dots and Fuzz's suggestion in D.
- **In a Deep Work session** shows the session behaviour shared by all four. Leave the session and a clock chip in
  the bar takes you back. Triage then shows only what can't wait, and its dot counts only those.
- **Width** draws the frame at phone width (390px).
