# Spike: Fuzz tucked into the card

Can Fuzz get bigger by standing half inside the card? His head and his line stay above the card's top edge, his body
stands in the card's top-left corner, and the card's text wraps around him.

Start a static server at the repo root (`python3 -m http.server 8433 --bind 127.0.0.1`) and open
`http://127.0.0.1:8433/spikes/fuzz-tuck/`. The page uses the app's own `css/fuzz.css`, `css/fuzz-rig.css`,
`css/app.css`, `js/themes.js` and the real rig (`js/fuzz-rig.js` with anime.js), so Fuzz, his reactions, the card
and the themes are what the app ships. Nothing talks to the core.

## How it works

- **One scale, one line.** Fuzz's width sets the scale (`s = width / 200`, the rig's viewBox). The **card edge** is the
  rig y where the card's top crosses him: about 120 is his neck, so the head is above and the body is inside.
- **The perch** is as tall as the part of Fuzz above the card edge. Fuzz is absolutely positioned in it and hangs down
  over the card. His line sits to the right of his head and never drops onto the card.
- **The hole** is the card's first child: a left float as big as the part of Fuzz below the edge, with a
  `shape-outside: polygon(…)` traced from the rig itself. `trace()` reads the bounding box of every drawn part (with the
  pose's transforms) and keeps the right-most edge per 2-unit row, plus an 8 px gap.
- **The card becomes a block box** in tuck mode, because floats don't work inside the flex column it uses today. The
  card's `gap` becomes margins. `.plan` and `.card-details` get `display: flow-root` so their fill and rule don't slide
  under him.
- **Clicks go through.** His SVG box and the float's box are rectangles over the text, so both get `pointer-events:
  none`, and his drawn parts turn it back on (boop still works).

## Controls

Layout (Today / Bigger, not tucked / Tucked in), wrap shape (his outline / a box, follows his pose, show the shape),
Fuzz's size, where the card edge crosses him, sideways nudge, four cards (task, question, coming back, draft), Next card
(replays the card's entrance), width presets down to 320, an automatic tuck-off below a card width, any reaction, theme
and mode. Under the frame, a table measures where the card, the headline and the main button land in all three
layouts for the current card and width.

## Findings

**It pays for itself, and then some.** Bigger and tucked beats today's smaller Fuzz standing on the card:

| Card at 720 px, Fuzz 220 px tucked at the neck | Headline | Main button | Whole area |
| --- | --- | --- | --- |
| Bigger, standing on the card (vs today's 160 px) | +67 px | +67 px | +66 px |
| Bigger, tucked in (vs today) | −42 px | −74 px (task) / −48 px (coming back) | −113 px / −73 px |

At 390 px (phone) on the question card, tucked is still 42 px higher for the headline and 23 px for the first answer.

- **His outline and a box come out almost the same at rest.** Standing idle, his arms hang beside his torso and his
  legs are under it, so the traced shape is close to a rectangle about 100 px wide. The outline only matters once a
  pose moves a limb. A plain rectangle (`shape-outside: none`) is a fine first version.
- **Only lines of text wrap.** The headline and paragraphs flow around him. The eyebrow (flex), Fuzz's finding,
  the answers and the action rows (grid) can't wrap; they shrink to a rectangle beside him or sit below him. With the
  card edge at his neck, his feet end around the second line of the headline, so the answers and buttons run full
  width on every card tried.
- **Seated reactions break.** Sit & doze and Power off drop his torso onto GROUND (they were made for sitting on the
  card's edge), so his head lands on the card and his legs cover the first paragraph. In the tucked layout they need
  their own pose, or they should stand.
- **Reaching poses mostly land in the gap.** Point reaches over the eyebrow and stops just short of the first tag.
  Cheer and Jog (stride loop) stay inside his own space. None of the standing reactions tried (idle, point, cheer,
  jog) covered words. Jazz hands and the other one-shot reactions weren't checked frame by frame.
- **Follows his pose works but is busy.** Re-tracing 5 times a second moves the text out of the way of a seated or
  reaching Fuzz, but the headline re-flows while he animates. If it is kept, re-trace only when a reaction comes to rest.
- **Phone.** At 390 the headline next to him goes ragged ("Which day / should the / design review move to?"), the
  eyebrow wraps to two lines, and his line clamps at two lines in a narrower bubble, so longer lines get cut. Nothing
  broke mid-word on the cards tried. Tuck off below about 440 px of card (the checkbox) is the safe default, or tuck
  with a smaller Fuzz there.
- **Card swaps.** The card animates in while Fuzz stays put in the perch, so Next card reads as the card arriving
  under him. The app's `take` reaction (he catches the card) would need its catch point checked against the new spot.

## If we take it to the app

- `js/view-triage.js`: add the hole as the card's first child on every render; Fuzz's sizes and the card edge become
  theme-independent constants.
- `css/fuzz.css` / `css/app.css`: the tuck rules from `tuck.css` (the second half), behind a class on `.stage`.
- `js/fuzz-rig.js`: a tucked variant of the seated reactions, and `FuzzRig.catchAt` for the new position.
- Deep Work (`css/deepwork.css`) sizes `.pwrap` on its own and would keep today's layout unless it gets the same change.
