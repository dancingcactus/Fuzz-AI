# Fuzz reference: screens, cards, themes and code

For developers and designers. The [README](../README.md) is the friendly front page; this is the detail behind it.
Fuzz is a no-build web app (plain HTML, CSS and JS) with a demo mode on invented data, and a live mode served by
the core in [`core/`](../core/README.md).

## Run the demo

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

Everything runs in the browser. Nothing is sent anywhere, and the data is invented. Only your theme,
appearance and calm-mode choices are saved (in `localStorage`). **Settings › Demo › Reset demo data** starts over.

**Use it for real:** see the install command in the [README](../README.md), and [`onboarding.md`](onboarding.md) for the first run. `FUZZ_REF=<branch>` installs a branch instead of `main`; run it again to update, and your data stays.

## What's in it

| Screen | Source artifact | What to try |
| --- | --- | --- |
| **Guide** | `spikes/nav-modes` (option E), `docs/nav-guide.md` | The one starting place, and where the app opens. There are no tabs: the Fuzz logo opens the Guide, and a label next to the wordmark says where you are and is the way back ("Triage · Back to the Guide"; "Deep Work · the task · 14 min" while a session runs, from anywhere). A dot on the label means work is waiting that you can't see from here (in a session, only something that can't wait). Lineup, Artifacts, Settings and Keys and help are in the round menu with Fuzz's head. Fuzz suggests where to start, then one question, **Where do you want to start?**, over one list: Triage, everything in My work, and Something else (type it right in the row). Picking a task asks how long; **↑ ↓** move, **1**–**9** pick, **Enter** starts. Calendar links land one tap from Start: `#/triage?until=13:30`, `#/work?until=15:00`, `#/work/<taskId>?until=14:45` (what Book time's hold carries) and `#/work?what=…` |
| **Triage** | Triage Queue Mockup (layout, card information architecture) + Fuzz Triage (reactions, motion) | Assign (and behind its arrow, **I'll do it** for a task that needs you and takes real time), Work in Claude, Schedule, Done (and its menu: Park it, Waiting on someone), drop, park a stray thought, undo. Keys: **A** assign, **G** Deep Work, **C** work in Claude, **D** done, **S** schedule (then **1** to **3** for a time, **M** for more times, **Esc** to go back), **P** park, **W** waiting on someone, **T** park a stray thought (**Esc** folds it away); hold **Alt/Option + Space** to dictate into the box for Fuzz (or use the mic beside it); **R** ask Fuzz to change a draft and **L** not now; **K** keep and **L** let go on a stale card. Numbers pick from the choice on screen: **1** to **3** on entity and duplicate cards, quick answers on a handback, **1** to **4** for your mood on a check-in and then its follow-up, **Esc** to skip. Press **?** (or Keys, under the card) for the full list. The next card takes input as soon as it is on screen, while Fuzz is still reacting. You arrive on the front card (or the one you picked in Lineup), with **F** to say what you're working on, and an empty queue opens with a recap of the session |
| **Lineup** | Triage Queue Mockup | One page, by who has the ball: **To decide** (how many cards wait in Triage), **Yours** (taken on, in Claude, or drafts you set aside), **With Fuzz** (his lane: what he is doing right now, step dots, slots busy, and a note when a task finishes or comes back), **My work** (what you said you'll do, which takes real time, with Pick one in the Guide; a row opens with Work on this), **With others**, **Later** (scheduled, plus any parked task that woke up), **Parked** (collapsed) and **Finished** (collapsed). Open any row for the full "done so far" log, sources, drafts and actions |
| **Deep Work** | `spikes/deep-work` | The session, started from the Guide: pick a task in My work (or Something else) and say how long (Until your next meeting, from the calendar Fuzz last read; A quick burst; A real chunk; A long haul; Until I stop). Then one task at a time: **D** finished it, **S** stuck (sources, switch, hand it to Fuzz, or back to Triage), **B** break now, **T** park a thought, **Esc** done for now. Every way out lands on one wrap-up (where you left off, then Back in my work or Hand the rest to Fuzz; "Save it and go" for a meeting), then the Guide with a recap. A session dial shows the breaks coming (25 on, 5 off, 15 after three), and every time interruption takes over the screen. `?dwspeed=60` runs the clock faster |
| **New task** | Triage Queue Mockup | Type or dictate (the browser's speech recognition: click Dictate, or hold **Alt/Option + Space** to talk and let go to stop), attach files (names only), Ctrl/Cmd+Enter. Press **N** anywhere to jump here and start typing, and **Esc** to go back to the Guide (what you typed is kept for next time). From the field, Tab goes to Capture and Shift+Tab to attaching a document |
| **Artifacts** | — | Every file Fuzz has written in its folder, newest first, with the task it's for, filtered by Documents, Slides, PDFs and Other. Each opens in a new tab (`artifact.html`) with a preview: **Markdown** (headings, lists, checklists, tables), **Word** (.docx: headings, lists, tables, links, pictures), **PDF** (the browser's own viewer), **slides** (.pptx: each slide's text, pictures, tables and fills where the file puts them, with speaker notes; ← and → move between slides), plus CSV tables, pictures, text and HTML (sandboxed, scripts off). Saved files in a task's Sources open the same way. The demo files are in `assets/samples/` |
| **Fuzz speaks** | Fuzz Triage | Everything the app tells you comes from Fuzz, never a toast: from the perch on Triage, from a small Fuzz bottom right on other pages. Screen readers hear outcomes and Fuzz's answers, not his quips |
| **Theme** | Warm Theme System | Eight themes (Terracotta, Honey, Moss, Lagoon, Indigo, Plum, Espresso, Warm gray), plus Retro (a black-and-white TV: grey colours, faint scan lines, Fuzz in black and white), Technicolor (early colour film: cream stock, carmine and teal, faint warm scan lines, a warm vignette and a little grain) and Random (one of the eight each day, the same through reloads until midnight, never the same two days running). Light / Dark / Match system, Standard or High contrast, and a code font |
| **Code preview** | Warm Theme System (code style) | When Fuzz shows his work, code appears on the card's **Code** tab and in the task detail on Lineup. Try the dashboard filter bug (TypeScript, highlighted line), the dashboard spike (diff) and the feedback summary (JSON) |

Fuzz appears three ways: the full animated robot on the Triage perch, a small themed face used as the logo,
"how are you" icons and notices, and static SVG files in `assets/` (`fuzz-mark.svg`, `fuzz-logo.svg`,
`fuzz-favicon.svg`). The robot re-tints with every palette: the cabinet takes the accent, the screen glow stays warm.

The **Fuzz mood lab** plays every mood, deadline level and reaction on demand, which is the quickest way to review
the motion. It is a design tool, not part of the product, so it only appears when you open the app with `?lab`
(for example `http://localhost:8000/?lab`), collapsed under the Triage card.

## Theme system

Colours and fonts come from the **Warm Theme System** artifact (`js/themes.js`):

- **Foundation:** warm surfaces, text and status colours (done, waiting, blocked, always with an icon) shared by every theme.
- **Themes:** each supplies only an accent, an on-accent and a link colour, for light, dark and both high-contrast variants.
- **High contrast:** works with every theme. 2px borders, underlined links, an ink edge on primary buttons, and deeper or lighter colours.
- **Type:** Nunito ExtraBold (800) for titles and headings, Nunito Sans (400 and 600) for everything else.
- **Code preview** (`js/code.js`): 13px / 20px with line numbers, an accent-marked highlighted line, diffs with + and − signs as well as a tint, sideways scrolling for long lines, and a 44px Copy button that says Copied. Syntax colours are the same in every theme. The code font (JetBrains Mono by default, or DM Mono, Source Code Pro, Fira Code, IBM Plex Mono) is chosen in Theme settings and only that font is loaded. For diffs, Copy gives the new version (context and added lines).

To give a task code, add `code: [{ lang: 'ts' | 'js' | 'json' | 'diff', base, file, code, highlight, note }]` in `js/data.js`. Backticks in notes and log lines become inline code.

## Cards in the queue

The demo queue has every card type from the mockups and the matching doc:

- **Task**: instructions pre-filled, one decision, smallest first step, due bar, tabs for Conversation, Context, Done so far and Sources.
- **Time-sensitive** (the first two cards): a rough, human time ("due in under 2 hours", "about 20 minutes", "past its time"; Fuzz's screen shows whole minutes), and Fuzz's three rush levels. After you say you're Tired or Overloaded, Fuzz mentions the deadline gently instead, with no flash.
- **Stale**: asks whether it still matters ("Quiet for 9 days. Nothing new has come up.") with Yes, keep it / Let it go.
- **Keeps coming back**: a task you've given a new time three times comes back asking "Is something in the way?", since that usually means it isn't important or the next step isn't clear. **Help me start** (H) has Fuzz work out the first step, **It still matters** (K) turns it into an ordinary card, or give it a time, park it or let it go. Any answer starts the count over. Try *Review the analytics vendor list*. The count is `reschedule.ask_after` in the core's config (0 turns it off).
- **Handed back**: sits at the end of the queue, Fuzz looks sheepish and asks a quick either/or. Each answer has its own outcome: it replaces Fuzz's suggested instructions (anything you typed stays, after it), can change the draft and who it goes to, and "I'll find it" keeps the task with you, under Yours in Lineup, instead of handing it back to Fuzz.
- **Entity check** (person and term): Same person / Different people, Save definition.
- **Possible duplicate**: Merge / Keep separate, with the reason shown.
- **Check-in**: comes back through the session, often at first and then less often (after 2 cleared cards, then after at least 2 more and 5 minutes, then 10, then 20), and never while time-sensitive cards are waiting. Good or Okay keeps the usual order, Tired brings gentle cards first (with an optional 5-minute break), Overloaded brings quick cards first (or holds the rest until tomorrow, except anything time-sensitive). When to ask is the UI's call; the answer is recorded once, with its follow-up, the way the core keeps it (`POST /checkin`). Once you answer, the other moods step aside and only one or two next steps remain. The spacing is `CI_FIRST` and `CI_GAP_MIN` in `js/view-triage.js`.

## Groups

Tasks that came from the same place form a **group**: the asks in one email thread, the action items from one meeting's notes, or a quick run of Slack messages from one person (see "Groups" in `docs/fuzz-core-design.md`). The core makes groups from where tasks came from, and you never have to. A group is only a **"From …" line**: on a Triage card (with "1 of 3 done"), on Lineup rows and in task detail. Tap it for the **group sheet**: a link back to the email or meeting, each task with its state and done-when, the latest steps from all of them, and Rename, Take out and It's wrapped up, each with Undo. Taking a task out of a two-task group leaves the other on its own. When the last task is done, Fuzz celebrates. Try *Staff sync* on the room booking card. Every task's detail also shows its **Done when** line.

Fuzz also works in the background: tasks you assign move through research and drafting on their own, finish as
**Needs your OK** cards at the back of the triage queue (counted in Lineup under To decide; one you set aside with Not now moves to Yours), and one of them (the dashboard filter bug) gets stuck and comes back to your queue.

## What is simulated

- The AI work: a timer walks assigned tasks through scripted steps (`js/store.js`, `tick`). Step length is `STEP_MS`.
- Attached files record only their names.
- "Work in Claude" moves the task to Current instead of opening anything.
- Sending goes nowhere: a few seconds after you approve, the demo marks it sent. **Ask Fuzz to change it** logs your note and brings the draft back as it was, since there is no model to rewrite it.
- Source linking and matching (the Task matching doc) is represented by the duplicate and entity cards only.
  A working spike of the matcher itself, as a GitHub Copilot skill, is in [`spikes/task-matching/`](../spikes/task-matching/README.md).

The real backend is in [`core/`](../core/README.md): the store and event log, cards, the scheduler,
the MCP server for the AI roles, the HTTP API and the installer for Claude Code and Copilot.

**Live mode.** `fuzz serve` also serves these screens, and prints a link with your token
(`http://127.0.0.1:8765/?token=…`). Open it once and the same screens run on your real queue
(`js/live.js`): every decision goes to the core, Undo is the core's, Assign starts the executor right away,
and what Fuzz does shows up as it happens through the event stream. Settings › Your queue › Switch account goes back to
the demo. The conversation tab and code previews are demo-only for now, since the core doesn't have them
yet.

**Onboarding.** The first time the core serves a browser, `js/onboarding.js` takes over (`#/welcome`):
Fuzz's introduction, a short form (name and app), how Fuzz helps you get things done guilt-free, Fuzz's
first question as a card in Triage (your working hours), then New task pointed out for one real task, and that task's card with one lesson (Assign, or what Fuzz already did). Then Fuzz's own task, "Let me find your asks": handing it over has him ask, one card per
source, what he may read, then start the first read. Setup cards (an output folder, a colour theme) arrive later, one at a time, after real work. Later
tips are each said once, when they fit. Closing the page at any step comes back to it. **Settings > Show
me around again** runs the intro and tips again, in the demo too. Fuzz's lines follow
[`docs/fuzz-tone.md`](fuzz-tone.md).

## Layout of the code

```
index.html          shell
css/fuzz.css        Fuzz, card stack, stamps, check-in (ported from the Fuzz Triage prototype)
css/app.css         everything else, driven by theme tokens
js/themes.js        the Warm Theme System: foundation, eight themes, Retro and Technicolor, Random, high contrast, code colours and fonts
js/code.js          code preview
js/data.js          demo tasks (all invented)
js/store.js         shared state, per-change undo, the background work and sending loop
js/schedule.js      the core's Schedule options, as the API sends them (the demo's stand-in)
js/fuzz-svg.js      the full robot (generated from the prototype)
js/fuzz.js          robot controller, plus the small Fuzz faces
js/view-*.js        Triage, Lineup, New task
js/onboarding.js    the first run, the later tips and the setup cards
js/view-settings.js Settings: about you, the app, working hours, what Fuzz can read, send and change, files, look
js/notify.js        Fuzz speaks: notices and Undo (no toasts)
js/progress.js      the segmented triage progress bar
js/app.js           router, header (the label, its dot, the menu with Fuzz's head), theme picker
assets/             Fuzz logo files
install.sh          the one-paste install
```

To change a theme, edit `js/themes.js`. To change what Fuzz says or does on a moment, edit the lists near
`ASSIGNS`, `DONES` and `CI_REPLY` in `js/view-triage.js`. To change the demo data, edit `js/data.js`.
