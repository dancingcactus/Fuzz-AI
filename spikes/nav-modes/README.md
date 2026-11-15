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

## Toolbar

- **Waiting in Triage, Can't wait, Deep Work pool** change the dots and Fuzz's suggestion in D.
- **In a Deep Work session** shows the session behaviour shared by all four. Leave the session and a clock chip in
  the bar takes you back. Triage then shows only what can't wait, and its dot counts only those.
- **Width** draws the frame at phone width (390px).
