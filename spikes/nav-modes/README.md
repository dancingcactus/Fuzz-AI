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

## Toolbar

- **Waiting in Triage, Can't wait, Deep Work pool** change the dots and Fuzz's suggestion in D.
- **In a Deep Work session** shows the session behaviour shared by all four. Leave the session and a clock chip in
  the bar takes you back. Triage then shows only what can't wait, and its dot counts only those.
- **Width** draws the frame at phone width (390px).
