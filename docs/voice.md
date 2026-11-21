# Drafts in your voice

Built 2026-11-20 (`core/fuzz/voice.py`). Fuzz's drafts read like the person wrote them because, before the
executor writes a message, it is shown a few messages the person actually wrote to the same person, or to
people like them.

## Where the examples come from

- **Your own messages** (`writing_samples`, a plain local table: not events, never replayed, never shared).
  The extractor sends every email you sent and every Slack message you wrote with `submit_writing_samples`,
  only your words: the quoted thread, anything forwarded and the signature block are cut (and cut again by
  `voice.clean`). The greeting and sign-off stay, since they're part of how you write.
- **Getting started:** while Fuzz has fewer than 40, `whoami` asks the extractor once a day
  (`writing_samples_wanted: {count, before}`) to read back older sent messages. These are only samples and
  never become signals. `no_more: true` stops the asking.
- **Drafts you edited** before they went out: what you sent, with what Fuzz wrote beside it (`fuzz_wrote`), so
  the gap shows.

A draft you approved **as written** is Fuzz's writing. When it comes back from your sent folder it's left out,
by the link the sender reported or by the same words. Otherwise Fuzz would learn from itself and drift toward
its own style.

## Which examples a draft gets

`voice_examples(to, kind, about)`, an executor tool, called before an email, Slack or nudge draft:

1. **Channel first.** Email and Slack never mix.
2. **The same person** (or the same Slack channel), one-to-one only: a group email to them isn't how you write
   to them alone.
3. **The same audience:** one person or a group, inside or outside the company (by email domain against yours).
4. **Topic only orders examples within a tier.** An old message on the same topic tends to get its facts copied
   into the new one, so topic never pulls in an example by itself.

At most three, with at most one before-and-after pair. With them come **style** lines, counted with no model
from up to 50 messages to that audience once there are five: typical length, greeting, sign-off, formatting,
lower-case starts, exclamation marks, emoji. The skill (executor-0.25) says to copy the voice, never the facts.

## Settings

"How you write" shows how many messages Fuzz has and the style lines per audience. It turns the feature off
(`voice.enabled`: nothing new is stored, read or asked for) and has **Forget my messages**, which deletes
`writing_samples`. `GET /voice`, `PUT /voice {enabled}`, `POST /voice/forget`.

## Is it working?

`fuzz eval drafts --voice` (docs/evals.md, "Drafts"): each personal draft case drafted with and without the
examples, scored point by point and by a blind judge. Leave the feature on only while `added_points` doesn't
rise and `picked_share` moves toward 0.5.

## Not done

- Kinds of message (a decline, a status update) as a tier between audience and topic: it needs a model to
  label them.
- A manager or report tier: Fuzz doesn't know your manager from facts (it never records facts about you).
- Slack channel targets match by name; a sample with only a channel ID won't match a "#name" target.
