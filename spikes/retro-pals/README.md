# Spike: Retro pals (boombox, rotary phone and workshop bot)

Two more old machines for Fuzz's family, to see how they look next to Fuzz and Spike. Each has two designs and a few
moves. Neither has arms, so they test how far a gimmick (speakers, tape reels, a handset, a curly cord) can carry a
character without one.

Start a static server at the repo root (`python3 -m http.server`) and open `http://127.0.0.1:8000/spikes/retro-pals/`.
The page uses the app's CSS and `js/fuzz-svg.js` for Fuzz, and `spikes/spike-cactus/` for Spike. The pals themselves
need only `pals.css` and `pals.js`.

## What's here

- **Boombox**, third round: extra wide (about 3:1, on a 220 x 150 canvas), combining the two favourites:
  - **Wide door:** black and chrome. Tweeter eyes, the tape-door mouth, two big woofers, and VU meters beside the
    eyes whose needles swing to the beat and slam over on the bass drop.
  - **Reels + door:** round reel windows for eyes (the reels are the pupils, and spin), above the tape-door mouth.
  - **Wide reel eyes:** twin decks as eyes with big reel pupils, and a seven-slider smile.
- **Boombox**, second round (kept for comparison; the first try is retired). These have real boombox proportions (wide and short, about 2:1), a chrome carry bar,
  a tuner strip with a needle, a row of piano keys on top, mesh speaker grilles with chrome rings, and a telescoping
  antenna:
  - **Classic silver:** the woofers are his eyes, with the tape deck between them and a small smile below.
  - **Tape-door mouth:** black and chrome. Two small tweeters are his eyes, and the cassette door is his mouth. It
    smiles shut and drops open to sing, showing the tape.
  - **Reel eyes:** twin cassette decks are his eyes, each with one big reel for a pupil (it spins, and spins
    backwards on Rewind). A row of EQ sliders makes his smile, and they bounce on the beat.
  - **First try:** the first round's speaker-eyes design, boxier and softer, kept for comparison. (The first round's
    Display face was dropped, as too close to Fuzz.)
  - Moves: Idle, Groove (loop), and Bass drop, Rewind and Surprise (once). The tuner needle sweeps on the beat and
    runs back on Rewind.
- **Rotary phone**, two designs:
  - **Dial face:** his face sits in the middle of the dial, ringed by the finger holes.
  - **Dial belly:** a face on the body like Spike's, with the dial below.
  - Moves: Idle, Bop and Ring (loops), and Dial, Tip hat and Hang up (once).
- **Workshop bot**, two designs: an original retro robot with a working claw, in the spirit of film robot helpers
  (a cleaning bot, a workshop arm) without copying any of them:
  - **Claw arm:** a 1950s mint-enamel appliance on casters with his face on the front, and a three-jointed arm
    (shoulder, elbow, wrist) ending in a two-finger claw.
  - **Roller:** a butter-cream bell on one ball wheel, a beacon lamp on top, and a small claw arm on each side.
  - Moves: Idle and Boogie (loops), and Wave, Fetch and Alarm (once). Fetch reaches down for a nut, grabs it and
    holds it up to show you. Its reach pose differs per design (`--f-sh`, `--f-el`, `--f-wr`), solved so the claw
    lands on the nut.
- **The family**: Fuzz, Spike (Potted), the boombox, the phone and the workshop bot at the same scale. **Party** starts everyone on
  the same beat, and the tempo slider drives all of them. Pick which design of each to show.
- **Icon sizes**: every design at 64 and 32 px, on light and dark.

## Moods (`moods.html`)

Reels + door, taken further, to see if he can be as expressive as Fuzz. 22 moods: Fuzz's 13 (idle, happy, eager,
proud, thinking, working, sleepy, sheepish, worried, bored, grateful, boop, and chill as "Off") plus surprised, sad,
crying, grumpy, dizzy, wink, smug, laughing and starstruck. Fuzz stands beside him in the same mood.

- **A mood is separate from the move.** `Pals.mood(el, 'sad')` sets a few numbers as inline custom properties
  (lids, lid tilt, lower lids, gaze, reel size, door, antenna, handle, lean, blush, reel speed) plus switches
  (`data-eye-l/-r`, `data-mouth`, `data-fx`, `data-reel`, `data-act`). The numbers are registered with
  `@property`, so a change of mood eases in. Mood poses sit on wrappers the moves never animate, so a sad boombox
  can still groove.
- **What carries it:** eyelids in the reel windows (their tilt stands in for brows), the reels (where they look,
  their size, their speed, and swaps for hearts, stars, spirals and shut-eye arcs), eight mouths on the door plus how
  far it opens, and the hardware: antenna, handle, tuner needle, a record light, a bulb on the antenna, and a loop of
  tape that spills out when he's dizzy.
- **Bigger face** (`wmixL`, the page's default): eyes up from r 11 to 14, the tuner slimmer, the door 2 px lower.
  The lids and reels read much better. **As before** (`wmix`) is one switch away.
- **Size is the limit.** At stage and card size every mood reads. At 64 px most still do, from the mouth, eye
  shapes and antenna. At 32 px only the loud ones survive (heart eyes, dizzy, surprised, off); the lids are gone.
- **Ids:** the lids are clipped to the glass, so each Reels + door boombox has one numbered clip-path id per eye.

## How they're built

The same shape as Spike: one SVG per pal, named groups (`.pl-hop` > `.pl-tilt` > `.pl-body`, then the parts), one
CSS animation per group, and pivots in viewBox px. There are no ids (except the mood eyes' clip paths), and the face is the shared one: tall rounded
eyes with a glint, rosy cheeks, smile, happy arcs, an open mouth and a flat one. The class is `.rpal`, because the
app's CSS already uses `.pal`.

## First impressions

- **Wider is better.** At 3:1 the body has room for the full layout (two big woofers, a centre console with a
  face), which is what reads as "boombox". The tape-door mouth carries most of the personality, and reel eyes
  combine well with it.
- **The proportions are what make it a boombox.** The first try was too boxy and soft. Wide and short, with chrome,
  grilles, a tuner strip and piano keys, every second-round design reads as a boombox at a glance.
- **Each new design puts the face somewhere different.** Classic silver has the biggest, most readable eyes.
  Tape-door mouth has the best mouth: singing with the door is a reaction only a boombox has. Reel eyes is the most
  mechanical and the most fun to watch, but its eyes are smaller.
- **Both phones work, for different reasons.** Dial face is the more original, and the most charming up close. But
  the face shrinks to a dot at 32 px. Dial belly reads better small, and its face matches Spike's.
- **The gimmicks carry it.** The bass drop, rewind and hat tip all land without arms. The handset is the phone's arm
  and hat at once.

## Not done in the spike

- The phone's cord doesn't follow the handset when it lifts (Tip hat, Hang up, Bop). The top of the cord stays at
  the cradle.
- No studio for these yet (the moods page has no sliders), and no Calm toggle on the page (reduced motion is honoured).
- The display face hides the drawn mouths, since the equalizer is its mouth, so it has no flat or open mouth.
