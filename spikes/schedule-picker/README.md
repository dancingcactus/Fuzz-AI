# Spike: picking an exact time for Schedule for later

Today "More times → Pick an exact time" shows a bare `datetime-local` field (`js/view-triage.js`, the `exact` block).
This spike tries three replacements built around a clock-face time picker, so we can pick one before touching the app.

Open `spikes/schedule-picker/index.html` from a static server at the repo root
(`python3 -m http.server` then `http://127.0.0.1:8000/spikes/schedule-picker/`). It uses the app's own
`css/app.css`, `css/fuzz.css` and `js/themes.js`, so the theme and mode switchers show it in every palette.

## The defaults (shared by all three, in `picker.js`)

- **Today:** an hour from now, rounded up to the next 5 minutes (3:12 PM gives 4:15 PM).
- **Any later day:** 8:00 AM.
- After you set a time yourself, changing the day keeps your time. "Back to the default" brings the default back.
- Late at night, an hour from now can run past midnight; then Today lands on tomorrow, at 12-something AM.
- Times that have already passed can't be scheduled; the button turns off and the line under the clock says so.

"Pretend it's" in the toolbar fakes the current time, so you can try the defaults at any hour.

## The three designs

- **A. Two-step dialog.** The closest to the Material reference. A dialog with the month first, then the clock:
  big HH : MM fields, AM/PM, and a dial. Picking an hour moves on to the minutes. The keyboard button swaps the dial
  for typed hours and minutes.
- **B. Side by side.** No dialog: calendar and clock together inside the schedule panel, with a line that always says
  when it comes back. Stacks below 720px.
- **C. Compact.** Chips for the next seven days plus "Other day" for the month. A two-ring clock (hours inside,
  minutes outside, both live, no mode switch), a time box that takes "3", "330p" or "15:30", and quick times
  (8 AM, Noon, 1 PM, 5 PM).

## What's not here

Nothing is saved; Schedule just shows what it would have sent. Wiring the chosen design into `view-triage.js`
means swapping the `exact` block and feeding `Sched.exact()` the picked date, as `exact-go` does today.
