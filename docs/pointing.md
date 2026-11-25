# Pointing at things (proposed, not built)


Drafted 2026-11-25. Fuzz points at the control the user needs next, and says why it's worth using and what it saves them.
Today a ring and a one-word pill exist for two targets (New, and the Triage label); see [As built](onboarding.md#as-built). This document says what
is ringed and what the pointer says, for the first sitting and the slow reveal. Nothing here changes how the flow works.

## Rules

1. **Point only at what the user does next.** The ring means "touch this".
2. **One ring at a time.** The pointer has a short title and one or two sentences, under about 120 characters in all.
3. **The pointer says why and what it gives you,** in terms of what's gone: a decision, something to remember or carry.
   It follows [Saying how it helps](slow-reveal.md#saying-how-it-helps). It is not a name for the control.
4. **It comes from Fuzz.**
   - A small Fuzz face (the existing sprites) beside the title, in the mood of the moment.
   - A speech-bubble shape, with the tail toward the target.
   - First person: "me", "I'll". The title can be too.
   - No "Tip:" or "Fuzz says:" label. A label makes it read as the system talking about him.
   - Drop the face when the pointer would sit over his own card, so it doesn't crowd.
5. **The ring clears when the user acts,** or when the card changes. It never waits for a "got it".
6. **A missing target means no ring,** never a broken step. On a phone, New is the floating button.
7. **Nothing pulses** in calm mode or under reduced motion, as built, and nothing nags (`docs/nav-guide.md`).
8. **Never ring something that sends or deletes.** Assign is fine; Send is not.
9. **The step's card and the pointer don't repeat each other.** The card says what's happening; the pointer says why this
   control helps.

Wording is draft, for a pass against `docs/fuzz-tone.md`. Each line has to be true when it's said, so the behaviour it
promises has to exist first.

## Pointers in the first sitting

| Step | Highlight | Title | Pointer says |
| --- | --- | --- | --- |
| 1 to 4 | Nothing. These are the terminal and Fuzz's own cards. | | |
| 5 | **Assign** on the Triage-time card | **Hand it to me** | … and it's off your list. I'll do it, and if I have questions I'll ask. |
| 5 | **Undo**, once it lands | **Changed your mind?** | One tap puts it back. |
| 6 | **New** (the floating button on a phone) | **Anything on your mind** | Type it and it's out of your head, and I'll keep track of it. |
| 6 | The **Dump mode** toggle | **Got a lot?** | Put it all in one box. I'll sort it, so you don't have to sort while you write. |
| 7 | The **Triage** label | **Decisions wait here** | You don't have to hold them in your head. |
| 7 part 2 | The action row on the first card | **One choice per card** | Hand it to me and it's off your mind. If something's different, tell me and I'll update the card. |
| 8 | **Tell Fuzz** (E) | **Tell me anything** | Who it's really for, or what's changed. I'll update the card. (Open: stays in step 8, or moves to the slow reveal.) |
| 9 | Each part of the Guide, one at a time | **Start here tomorrow** | I've put the most important thing first, so you don't have to work out where to begin. |
| 10 | The permission card's **Allow** | Nothing; the card is already the focus | |
| 11 | Nothing | | |

The New and Triage rows exist as built, with one-word labels. They would change to these.

## Pointers in the slow reveal

Most practices need no ring: Fuzz acts and says one line from [Saying how it helps](slow-reveal.md#saying-how-it-helps). A ring is for when the
user has to find a control.

| Practice | Highlight | Title | Pointer says |
| --- | --- | --- | --- |
| Not now is an answer | **Later** on a card Fuzz thinks isn't ready | **Not now is an answer** | I'll bring it back, so you don't have to remember it. |
| Book it, don't queue it | **Book time** on a card Fuzz thinks needs a block | **Give it a moment** | It goes on your calendar, so it stops sitting in a pile. |
| Park a stray thought | The park control (T) | **Something pulled you away?** | Park it here. It's safe, and you keep your place. |
| Get it out of your head | The **Dump** toggle | **Anything still on your mind?** | Put it here and I'll sort it, so you can stop holding it. |
| Give big work a home | The series row, then **Next in …** | **These belong together** | I've kept them in one place. You focus on the work, not the planning. |
| Look back weekly | The look-back entry | **Here's your week** | What got done and what carried over is written down, so you can stop keeping score. |
| The rest (fixed time, good hours, start small, and so on) | Nothing | | The line from Fuzz does the work. |

**Later and Book time are offered on Fuzz's judgment of the card,** not on a count or a day. See open question 9 under
the slow reveal.

## Open questions for pointing

1. **Does a pointer ever need no title?** The title-and-sentence shape is the default; a very short one may be a sentence only.
2. **Step 8:** does Tell Fuzz stay in the first sitting, or move to the slow reveal with Later and Book time?
3. **Does a pointer need a dimmed backdrop** anywhere? Step 7's action row and the Guide parts are the likeliest. Otherwise ring and bubble are enough.
4. **Do all first-use pointers in the slow reveal stay,** or only the first of a kind? Every first use may read as a drill (onboarding principle 10).
5. **The selectors are unconfirmed.** Only New (`.nav-cta`, `#fab`) and the Triage label (`#where`) are known to exist as
   stable targets. Assign, Undo, the Dump toggle, the action row, Book time, Later, park and the Guide parts each need
   checking before it's built.
