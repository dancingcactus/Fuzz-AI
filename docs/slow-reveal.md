# The slow reveal (proposed, not built)


Drafted 2026-11-24. The first sitting ends at step 11. After that Fuzz keeps teaching, slowly, one practice at a time,
inside the moment where it applies. The practices come first and the features are the tools that serve them. This
extends [Later tips](onboarding.md#later-tips), which are one-line, one-time lines, into practices that Fuzz sets up for the user.

## How it works

- **One new idea a day, at most,** delivered in context. Onboarding principles 6 and 10 are the guard: no lesson counts, no
  streaks, and removing every practice wouldn't add a step.
- **Triggered by behaviour, not the calendar.** "Day 3" means nothing. "You've opened Triage at four different times this
  week" does.
- **Do it, then say how it helps you, in one line.** Fuzz sets the thing up (proposes a Focus block, puts the Triage
  slot on the calendar), then says what he did and how it helps the user, in plain words. See
  [Saying how it helps](#saying-how-it-helps). He doesn't name a technique, ask the user to agree to a concept first,
  or say "you should". There's no folded "why" for these: a line most people wouldn't open isn't worth the extra UI.
- **Fuzz is opinionated, not a coach.** He says how he works, as a fact about himself. He doesn't cite evidence, name a
  condition, or say "helps a lot of people". People find out it works by using it. These are practices for getting things done.
- **Offers retire quietly.** "Not now" comes back at most once, like setup cards. Ignoring one never counts against anyone.
- **Graduation.** A practice stops being offered once the user does it without a prompt.
- **Visible only if asked.** An opt-in "What else can Fuzz do?" page (Settings or the menu) can list the practices, as a
  reference and never a checklist. It carries no badges, counts or progress.
- **Wording.** Each line follows `docs/fuzz-tone.md`, and reads fine to someone who is tired or already knows all this.

## The practices

Each practice is a habit, and Fuzz's capability is what makes it nearly free. The benefit is what the user gets, in
the terms of what's gone (a decision, something to carry), and it's the source for Fuzz's line in
[Saying how it helps](#saying-how-it-helps). Rows are of three kinds:

- **Pair:** a practice and the capability that serves it. Most rows.
- **Practice only:** no feature is needed, just a line from Fuzz at the right moment.
- **Capability only:** serves the work, not a habit, so nothing is framed as a practice.

| Practice (the habit) | Capability (what Fuzz does) | Benefit (how it helps you) | Kind | Trigger |
| --- | --- | --- | --- | --- |
| **Decide at a fixed time** | The recurring Triage time on the calendar (step 5), kept in one place | You never decide when to deal with new things | Pair | A few days of opening Triage at scattered times |
| **Book it, don't queue it** | Book time, with a pre-picked slot, one tap. See `docs/book-then-work.md` | A task has a moment, so it stops sitting in a pile | Pair | Fuzz thinks a card suits a block of time, the first time (his judgment of the card, not a count) |
| **Not now is an answer** | Later, as a real outcome: Fuzz brings it back | You don't have to remember it, and it isn't a failure | Pair | Fuzz thinks a card isn't ready, such as one waiting on someone else, the first time |
| **Find your good hours** | The "When do you usually get things done?" card, then proposed Focus blocks | Your best hours go to the work that needs them | Pair | After some real work |
| **Start small** | Help me start: a five-minute first step | Starting costs five minutes, not a whole task | Pair | A task sits untouched for several days |
| **Park a stray thought** (T) | The park shortcut | You keep your place and don't carry the thought | Pair | The first time they leave a card to chase something |
| **Get it out of your head** | Dump mode, returned to from step 6 | You stop holding it all, and nothing is lost | Pair | The queue is empty, or Triage time starts |
| **Work alongside someone** | Focus time with Fuzz present: a session he's part of, not just a calendar block | It's easier to stay with the work | Pair | The first Focus block |
| **Put a clear end on it** | Short sessions and a wrap-up that says what got done | You know where it stops, so starting is easier | Pair | A session runs long, or the first short triage |
| **Warm up and wind down** | A line at the start of a block and a wrap-up after it | Picking it up later costs nothing | Pair | The first booked block |
| **See how long things take** | A recap of time worked, in the session wrap-up and look-back | You plan around how long things really take | Pair | After a few booked blocks |
| **Let it go** | Let it go, as a real outcome | Room for what matters | Pair | The first stale card |
| **Say how you're doing** | The queue changes to match | Today asks for what you've got | Pair | The first check-in |
| **Look back weekly** | A short recap of what got done, and what carried over | You stop keeping score in your head | Pair | After about two weeks |
| **Work in Claude together** | The hand-off, with the task handed over | Everything it needs is in one place, so you can just start | Capability only | A task comes back handed over |
| **Voice and style** | Drafts that sound like the user. See `docs/voice.md` | You edit less | Capability only | About five approved drafts |
| **Give big work a home** | Series: Fuzz finds a workstream, keeps its tasks together, suggests the next one and says when it's done | Less context switching, and you focus on the work, not the planning | Pair | The first "Is this the series?" card, then the first "Next in …" suggestion, then the first wrap |

Some of these already exist as one-time tips in [Later tips](onboarding.md#later-tips). Each practice would replace its tip, so a
line isn't said twice. The work-alongside, warm-up and time rows depend on the session and wrap-up in
`js/view-deepwork.js`, so check their triggers against what exists.

## Saying how it helps

Ruled 2026-11-24: one line, in the line itself. Not a "why", and not folded away.

- **Shape:** what Fuzz did, then how it helps the user. One or two sentences, in the order *did, then helps*. The exception is a practice where the user acts first
  (Get it out of your head): there the line asks, then says how it helps.
- **About the user's day,** not the technique. "You'll never have to decide when" works. "Consistency builds habits" is a coach.
- **Each line says what's gone,** where it can: a decision they don't have to make, something they don't have to carry
  or remember. That's the strongest form of "how it helps".
- **No counts, no scores, no "you should".** Skipping the offer costs nothing.

Draft lines, for iteration. Each has to be true when it's said, so the capability has to exist first.

| Practice | Fuzz says |
| --- | --- |
| Decide at a fixed time | "I've put Triage on your calendar at 3, every working day. You'll never have to decide when to deal with new things; it's already set." |
| Book it, don't queue it | "Booked: Thursday, 10 to 11. It's on your calendar now, so it won't sit in a pile waiting for a moment that never comes." |
| Not now is an answer | "Later it is. I'll bring it back, so you don't have to remember it." |
| Find your good hours | "Tell me when you think best and I'll put your focus time there. Your best hours go to the work that needs them." |
| Start small | "I've cut this to a five-minute first step: open the doc and write the heading. That's all you have to face right now, not the whole task." |
| Park a stray thought | "Parked. It's safe here, so you can get back to what you were doing without carrying it." |
| Get it out of your head | "Anything on your mind? Dump it here and I'll sort it, so you can stop holding it." |
| Work alongside someone | "I'm here while you work on this. Having me in the session makes it easier to stay with it." |
| Put a clear end on it | "Twenty minutes, then I'll call time and tell you what got done. You know where it stops, so starting is easier." |
| Warm up and wind down | "Here's where you left off. When you finish, I'll note where you stopped, so picking it up later costs nothing." |
| See how long things take | "That took 25 minutes. I'll plan around that, so you don't have to guess how long things take." |
| Let it go | "Let go. It's off your plate, and you've got room for what matters." |
| Say how you're doing | "Thanks. I'll lighten your queue to match, so today asks for what you've got." |
| Look back weekly | "Here's what got done this week, and what carried over. It's written down, so you can stop keeping it in your head." |
| Work in Claude together | "This one's for the two of us in Claude. I've put everything it needs in one place, so you can just start." |
| Voice and style | "I've got a feel for how you write. Drafts will sound like you, so you edit less." |
| Give big work a home: the first series card | "I've kept these together, so you can stay on one thing instead of hopping between them." |
| Give big work a home: the first "Next in …" | "I try to find what's next so you can focus on work, not planning." |
| Give big work a home: the first wrap | "That's all the [series] items for now. Let me know if there are more." |

## What it must not become

1. **A curriculum.** Every practice is an offer attached to a real moment. If it could be a lesson list, it's wrong.
2. **Advice about the person.** Each line is about the strategy, never "you've been doing it wrong" (onboarding principle 11).
3. **A debt.** Nothing is owed. A user who ignores every offer should see no sign of it (onboarding principle 6).
4. **Too many at once.** If testing shows overload, cut the number per week before cutting the practices.

## Open questions for the slow reveal

1. **How does a day-2 return feel?** A quiet "here's where you left off", a Fuzz line waiting in Triage, or a calendar
   nudge. Notifications are the riskiest for shame.
2. **Is "What else can Fuzz do?" worth having,** or does any list turn into a checklist?
3. **Should Triage time open with a two-minute dump** once the habit exists, so the habit is dump, then triage?
4. **Does a missed Triage or Focus block get its own line,** saying the practice still holds, as in "Looks like 3 got away
   from you. That's fine. Same time tomorrow?" It would use the existing `missed_block` signal.
5. **Series teaches one practice at three moments** (above). The role card ("I'm driving it, I'm helping, just keeping up")
   carries a fourth message, that not everything needs you to lead, without a line from Fuzz. The Episodes page shows done
   dots and a folded count; nothing teaches it, since a count sits close to onboarding principle 6. Is that right?
6. **Who gets first offer when two are due the same day?** Proposed: the one nearest to what they're doing now.
7. **What does a week away do?** A recovery path that doesn't scold ("welcome back, nothing is lost") and doesn't restart
   the practices.
8. **How does the first send work?** Send tools are never pre-ticked, so the first send is a trust moment. It may need its
   own gentle card, not a Settings row.
9. **What makes Fuzz think a card suits Later or Book time?** Both are offered on his judgment of the card, not a count
   or a day. A first rule: Later when a card waits on someone else or has no near date, Book time when it's a task that
   needs a block. They may both fit on the same day, which the one-idea-a-day limit then has to arbitrate (see question 6).
