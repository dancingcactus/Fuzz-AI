# Energy and priority: what a check-in decides

Status: built (all four pieces; see "As built" at the end). Started from issue 9 (Progress Bar Updates);
worked out in conversation on 2026-11-13. The category names below are internal: what the UI says follows `docs/fuzz-tone.md`
(no "overdue", no counts of what's left).

## Goal

A check-in asks how your energy is, then Fuzz decides how much more triage today holds and in what
order. The progress bar shows the next stretch of that as boxes; when the boxes run out, the next
check-in comes.

## Categories

Tags, not tiers: a card can carry several. Each is a yes/no test on data the core has.

| Category | Picked out by |
| --- | --- |
| **Urgent** | Due today or past due (`deadline_level` ≥ 1), or `expires_at` today |
| **VIP** | The origin source's sender is on your VIP list. Your manager (the `manager` fact) is on it by default; you add a few more in Settings |
| **Fuzz returned** | Fuzz worked on it and handed it back: a finished brief, a draft to approve, a question only you can answer |
| **Waiting** | Someone is waiting on you: a reply owed, or `waiting_on` names a person |
| **This week's goal** | Linked to an active deliverable (`tier = active`), or in your focus |
| **Quick** | `effort_mins` ≤ 5 |
| **Low energy** | `energy = low` |
| **Deep work** | `energy = high` or `effort_mins` ≥ 30 |
| **Coming back** | Put off, stale or returning (`put_off`, `stale`, `returning`, `reschedules`) |
| **Rest** | None of the above |

Estimates: the extractor estimates `effort_mins` and `energy` for every new task; the executor's brief
refines them. A task with no estimate counts as 15 minutes, normal energy.

## What each answer selects

| Answer | Today's set | Order |
| --- | --- | --- |
| **Good** | Everything | Urgent → VIP → Fuzz returned → Waiting → Coming back → This week's goal → Rest |
| **Okay** | Everything | Urgent → VIP → Fuzz returned → Quick → Waiting → This week's goal → Coming back → Rest |
| **Tired** | Urgent, VIP, Fuzz returned, Waiting, Quick, Low energy | Warm-up (Quick and Low energy) → Urgent → VIP → Fuzz returned → Waiting |
| **Overloaded** | Urgent, and Quick cards that are VIP or Fuzz returned | Break offer, then warm-up (the quickest one or two) → Urgent, quickest first |

Rules for every answer:

- **Urgent is never left out**, and a card due within the hour goes ahead of the warm-up.
- **Coming back depends on energy.** They are the hardest cards for an ADHD brain, so they come early
  on a good day, late on an okay day, and not at all when tired or overloaded (unless Urgent).
- **Tired and overloaded:** what's left out moves to tomorrow morning in one command, so one Undo puts
  it all back (as Hold the rest does now, `checkins.record`).
- **Ties** keep today's order: the working card, group runs back to back, focus, then `order_key`.
- **Deep work:** open. There's no deep-work queue yet; until there is, Deep work cards sort as Rest.

## Check-ins and the bar

- **Check-ins count cards, not time.** The next check-in comes when the boxes run out. Work mode (one
  long card) stays on time.
- **The stretch** is the next 3–5 cards of today's set on Good or Okay, 2–3 on Tired or Overloaded.
  Before the first check-in it's 2, as now. Built (piece 1) as fixed sizes: Good 5, Okay 4, Tired 3,
  Overloaded 2; Skip keeps the last stretch (4 if there wasn't one).
- **While a check-in waits** (something due, a group partway through), the card in front shows as one box.
- **Fewer cards than the stretch:** show only what's left.
- **The bar:** the cleared ticks and the bank stay as they are; the open side is the stretch. After a
  check-in, the next stretch slides in.

## Momentum

Energy can rise as you clear cards.

- When you clear a Tired or Overloaded stretch quickly (near or under the estimates, no skips), the next
  check-in opens with **"That went quickly. Want a few more?"** Both answers celebrate:
  - **"Sure, just a few more"** moves you up one level (Overloaded → Tired → Okay) and brings cards back
    from tomorrow.
  - **"Nah, I've done the important stuff"** ends the session warmly; nothing is moved.
- **One level per check-in at most**, so a burst of quick wins doesn't bring back the whole pile.
- Several skips or Laters in a row bring an early check-in that offers to scale down.
- Signal: clearing speed and skips, from `screen_times`.

## Order of work

1. **Issue 9:** count-based check-ins, the stretch as boxes, sliding in after a check-in. Uses today's
   urgent and focus order.
2. **Priority:** categories, VIP list in Settings, energy rules in `cards.queue`, Coming back by energy.
3. **Estimates at extraction:** `effort_mins` and `energy` in the signal format and the extract skill.
4. **Momentum:** the "Want a few more?" check-in and moving up a level.

## As built

Code: `core/fuzz/priority.py` (categories, today's set, the order) used by `cards.queue` and
`checkins.record` / `checkins.more`; `js/priority.js` is the same rules for the demo, and live cards bring
their `categories` from the core. Check-ins and momentum live in `js/view-triage.js`; the VIP list is
**Settings → Who comes first** (`GET`/`PUT /vips`); "a few more" is `POST /checkin/more`.

Where the build settled something the design left open, or differs from it:

- **Your energy** is your last answer *today* (`user_state` `energy`, with the date). Before your first
  check-in of the day the queue keeps its usual order (urgent, then focus).
- **VIP:** there is no `manager` fact about you (facts about the person themself aren't kept), so the
  manager is its own field in Settings, with up to ten more. A sender matches by email, Slack ID or full
  name; a one-word entry matches a first name.
- **Waiting:** `waiting_on` means *you* are waiting on *them*, so it isn't used. Waiting is a signal with
  `"nudge": true` on the task (someone chasing it) or a late ask that can join a reply already drafted.
  The signal schema now accepts `nudge`, which the extract skill already asked for.
- **Fuzz returned:** a handback, a result or a Find out answer, a draft or nudge to approve, or a
  permission request.
- **Warm-up:** the quickest two in today's set (Quick or Low energy when tired, Quick when overloaded).
  "Due within the hour" is deadline level 3 (within an hour, or past its time).
- **Okay:** a Coming back card sorts at Coming back even when it is also VIP or Fuzz returned (late on an
  okay day); on other answers a card sorts by its best category.
- **Held by a check-in:** what tired or overloaded leaves out is scheduled for tomorrow morning with the
  tag `checkin_hold`, so it comes back as an ordinary card, not as Coming back, and never counts toward
  "This keeps coming back". The tag goes when the card next leaves triage.
- **Cards that stay:** a card asking its own question (a handback, a result, "Still want this?", "Did they
  get back to you?", a booked block, "What's in the way?") would lose it if it moved, so a check-in never
  holds one; outside today's set it sorts last instead.
- **Overloaded** no longer asks "Hold the rest?": the break offer comes first (Take 5 or Keep going) and
  the rest waits for tomorrow either way, with one Undo. `hold_rest` stays in the API.
- **Momentum:** a stretch is "quick" when it had no Later or End of the list and its time on screen was
  under the cards' estimates (15 minutes each with none). It's asked at the next check-in, or as soon as
  today's set runs out with held cards waiting. "Sure, just a few more" brings back only cards a check-in
  held, never ones you scheduled yourself, and only as many as the new level's stretch (the ones it would
  put first); the rest stay held. The next stretch is the new level's. "Nah, I've done the
  important stuff" shows a rest screen with **Show me one more**.
- **Scaling down:** three Laters or End of the list in a row bring the check-in early: "Not feeling these?
  I can make it lighter." Make it lighter is one level down (and holds what that leaves out); it isn't
  offered once you're on Overloaded.
- Each card's screen time now records how it left (`how`: later, end, done, parked…).
- The parked review's daily share (`review.energy_today`) reads the same energy, so Undo and "a few more"
  count there too.
- **Not built:** the deep-work queue (Deep work still sorts as Rest).
