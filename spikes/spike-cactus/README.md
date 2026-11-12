# Spike: Spike the cactus

Fuzz gets a friend: Spike, a cactus who dances. This spike settles what he looks like and explores how he moves.
He's meant to end up on a personal site, so he's built to stand on his own, without the app. **Potted is the chosen
look.**

Start a static server at the repo root (`python3 -m http.server`) and open
`http://127.0.0.1:8000/spikes/spike-cactus/` for the four looks, or `.../spike-cactus/studio.html` for the studio. The
page chrome uses the app's `css/app.css`, `css/fuzz.css`, `js/themes.js` and `js/fuzz-svg.js`, so Fuzz can stand next
to him. Spike himself needs only `spike.css` and `spike.js`.

## The studio (`studio.html`)

Every move for Potted, one at a time, to watch closely and tune.

- **18 moves**, all CSS keyframes in `spike.css`:
  - Dances (loops, one bar of four beats): Dance, Groove (the pot shuffles while the plant leans the other way from
    the rim), Shimmy, Disco (the classic point) and Bop (nods along from the rim).
  - Gestures (once): Wave, Hop, Bloom, Ta-da and Peekaboo (ducks into the pot, peeks over the rim, pops out).
  - Elbows: Hands on hips, Shrug, Think, Flex (once) and Clap (loop). These need the elbow.
  - Idles (loops): Idle, Look around and Sleepy.
- **Elbows** (Potted only): each arm is an upper arm that turns at the shoulder and a forearm that turns at the
  elbow, drawn as one tube. Dance, Groove, Wave, Hop and Ta-da also get forearm follow-through: the forearms trail
  the upper arms, set by the Follow-through slider (`--sp-drag`). The **Elbows** switch locks the forearms straight,
  so you can compare any move with and without them.
- **Transport**, as in the Fuzz studio: play and pause, replay, step a frame, a scrubber with beat marks for the
  dances, and speeds from 10% to 150%. Repeat one-shots is on by default. Turn it off and a one-shot goes back to
  the last loop.
- **Keys**: Space plays and pauses, ← and → step a frame, R replays, ↑ and ↓ move through the list. They stand down
  while a slider, select or text field has focus.
- **Tuning**: one to four sliders a move (amounts and lengths), plus tempo, Calm, eyes and mouth overrides, and a
  light, dark or card stage. Changes apply live, playing or paused. They stay in this browser (`localStorage`), and
  **Copy changes** gives the CSS to paste over the defaults at the top of `spike.css`.
- **Real sizes**: the same move plays beside Fuzz on the Triage perch, and at 64 and 32 px.

## The four looks (`index.html`)

- **Four looks on one rig** (`spike.js`): Saguaro (tall, two bent arms at different heights, dance shoes), Barrel
  (round, nub arms), Potted (a slim saguaro in a terracotta pot) and Paddle (prickly pear with paddle arms). Each look
  draws into the same named groups, so every move plays on all four at once. The page offers six of the moves.
- **Family resemblance with Fuzz**: the same face (tall rounded eyes with a glint, rosy cheeks, small smile, happy arcs
  when he's dancing), Fuzz's terracotta for the shoes and pot, and Fuzz's glow yellow at the heart of the flower.
- **Beside Fuzz, small sizes and a personal-site mock**, to judge each look where it would live.

## How the rig works

```
.sp-shadow
.sp-hop        translate               jumps, side steps, the pot shuffle
  .sp-sway     rotate at the ground    leaning, the pot wobble
    .sp-squash scale at the ground     breathing, bounce, landing
      shoes
      [clip]                           Potted only: hides what sinks below the soil
        .sp-sink   translate           into the pot and back out
          .sp-plant  rotate at the waist (the pot rim, or above the shoes)
            .sp-arm-l / .sp-arm-r      rotate at the shoulder
              .sp-fore-l / .sp-fore-r  rotate at the elbow (Potted only)
            .sp-face, .sp-flower, .sp-sparkle
      pot                              Potted only, drawn after the plant
```

- **One animation per group.** Two animations on one element's `transform` replace each other rather than add up.
- **Pivots** are in viewBox px, set per look as `--sp-ground`, `--sp-waist`, `--sp-shl` and `--sp-shr`.
- **The pot is separate from the plant**, so the plant can move from the rim on its own (Disco and Bop), lean
  against the pot's shuffle (Groove), or sink into it (Peekaboo).
- **Every amount is a custom property** with a default at the top of `spike.css` (`--sp-lean`, `--sp-hop-h`, and
  so on). The studio's sliders just set them.
- **Every loop's layers are one bar long**, so Calm and `prefers-reduced-motion` play each layer once and he stops in
  one piece: at rest, except Sleepy, which holds its doze.
- **Tube arms are drawn twice**, the outline under the body and the fill over it, so the shoulder has no seam.
  Potted's forearm outline is drawn over the body but under the upper arm's fill, so a hand on the hip or chin keeps
  its edge and the elbow has no seam. The elbow poses' angles were solved from where the hand should land.
- **Arm-tip spines ride on the arms** (on every look), so they no longer float in place while the arms move.
- **The only id** is Potted's clip path, numbered per Spike, so any number of Spikes can share a page with Fuzz.

```js
el.innerHTML = Spike.svg('potted', { anim: 'groove' });  // or { size: 32, square: true } for an icon
Spike.play(svg, 'peek');                                  // a one-shot, then back to the loop he was in
Spike.play(svg, 'hop', { onEnd: fn });                    // or call fn; svg also fires 'spike:end'
```

A one-shot ends when all of its animations have finished, not on a timer, so it stays right when a length is tuned,
the speed changes or it's paused.

## First impressions

- **Elbows help a lot.** Hands on hips, Think and Clap don't exist without them: with Elbows off they turn into a
  dip of the arms. Flex and Shrug read at a glance, and a little follow-through makes Dance, Hop and Ta-da look
  looser and more alive. The arms are short, so poses that bring a hand to the face (Think) are close to the limit;
  a deeper curl puts the hands over the cheeks, which is why Flex stays shallow.

- **Potted won.** It sits best next to Fuzz, since the pot matches his TV case. Splitting the plant from the pot
  answers the earlier worry that a dancing pot is less fun than feet: the plant grooves from the rim, and Peekaboo
  only works because there's a pot to hide in.
- **Saguaro reads most as a cactus at every size**, and Barrel is the cutest but dances worst. Paddle is the most
  distinctive, but its paddles start to look like ears at 32 px and below.
- **At 16 px** the face is gone in every look, and the flower is what makes him Spike. A dedicated favicon (silhouette
  and flower, no face, no spines) would beat scaling him down.

## Not done in the spike

- Peekaboo is Potted only: the other looks have nothing to hide in, so neither page offers it for them.
- No sound, and the tempo doesn't follow any music.
- No reaction to the pointer beyond click-to-wave, click-to-bloom and click-to-replay in the studio.
- Tuning covers amounts and lengths, not keyframe timing or easing. Those still mean editing `spike.css`.
- No name or wordmark for the domain, and no favicon file.
