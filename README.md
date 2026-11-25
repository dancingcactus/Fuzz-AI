# Fuzz

Fuzz is a small robot who takes things off your plate. Tell him what's on your mind and he looks into it, drafts the
reply, finds the time, and brings you one decision at a time. Nothing goes out without your yes, and everything has Undo.

<!-- TODO: a screenshot or short clip of Triage goes here. -->

## Try it

**Look around first.** A demo with made-up data: nothing to install and nothing is sent.
<!-- TODO: link to the hosted demo here. Until then, see "Run the demo" in docs/reference.md. -->

**Use it for real.** On a Mac, paste this in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/dancingcactus/Fuzz-AI/main/install.sh | sh
```

That's the last time you'll need Terminal. Fuzz installs, opens in your browser, and takes it from there. You'll need
Claude Code or GitHub Copilot on your Mac. If you don't have one yet, Fuzz tells you where to get it, or lets you try
the demo first.

## Your first ten minutes

1. **Fuzz says hello,** and tells you what he will and won't do.
2. **He asks when you work,** then puts a short Triage meeting on your calendar. Triage is where you decide things, at
   the same time every day, so you never have to decide when.
3. **You get everything out of your head.** Type it or say it, in any order. You don't have to sort anything.
4. **While he works through it,** he asks a couple of quick questions so he can get to know you.
5. **He brings it back as cards,** one decision at a time: hand it to Fuzz, book time for it, or let it go.

After that, Fuzz offers to look through your email and chat, one source at a time, so you don't have to remember what
people asked you. You can close the page at any step, and he picks up where you left off.

## How Fuzz helps you get things done

Over the first weeks Fuzz sets up a few habits for you, one at a time, each when it's useful. Nothing is a lesson, and
you can ignore any of it.

- **Decide at a fixed time.** Triage sits on your calendar at the same time each day, so you never decide when.
- **Get it out of your head.** Dump anything you're carrying. Fuzz sorts it, so you can stop holding it.
- **Book it, don't queue it.** A task that needs your time gets a moment on your calendar, so it doesn't sit in a pile.
- **Start small.** A big task gets a five-minute first step.
- **Give big work a home.** Fuzz keeps related tasks together, finds what's next, and says when it's done.
- **Let it go.** Letting something go is a real answer.

## What Fuzz will and won't do

- He reads only what you allow, one source at a time, in plain words.
- He drafts, but nothing goes out without your yes.
- Everything has Undo.
- Missing a session loses nothing.
- Fuzz keeps your queue and notes on your Mac. The thinking is done by the app you pick, so what you give Fuzz goes
  where that app sends it.

## For developers

- [`docs/reference.md`](docs/reference.md): the screens, cards, themes, what's simulated in the demo, and the layout of the code.
- [`core/`](core/README.md): the store, the scheduler, the HTTP API and the installer for Claude Code and Copilot.
- [`docs/onboarding.md`](docs/onboarding.md): the first run as built, its principles, and what's proposed next ([the flow](docs/onboarding-flow.md), [Dump mode](docs/dump-mode.md), [the slow reveal](docs/slow-reveal.md), [pointing](docs/pointing.md)). [`docs/fuzz-tone.md`](docs/fuzz-tone.md): how Fuzz writes.
- [`docs/principles.md`](docs/principles.md): the design principles, and where each shows in the app. [`PRODUCT.md`](PRODUCT.md): who it's for.
