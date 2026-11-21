"""Drafts in your voice: your own messages as examples, picked by who they're to (voice.py, docs/voice.md).
Every person and message here is invented."""

from helpers import CoreCase

from fuzz import answers, config, drafts, scheduler, tasks, tools, voice
from fuzz.db import FuzzError

PRIYA = {"name": "Priya Shah", "email": "priya@acme.example"}
SAM = {"name": "Sam Okafor", "email": "sam@acme.example"}
VENDOR = {"name": "Lee Park", "email": "lee@northwind.example"}


def mail(i, to, text, ts="2026-10-1{}T10:00:00Z", **kw):
    return dict({"source": "email", "source_id": f"m{i}", "ts": ts.format(i % 10), "text": text, "to": to}, **kw)


class Cleaning(CoreCase):
    def test_only_your_words_are_kept(self):
        text = ("Sounds good, ship it.\n\nOn Tue, Oct 20, 2026 at 9:00 AM Priya Shah <priya@acme.example> wrote:\n"
                "> Can we ship the vendor list today?\n> It's ready.")
        self.assertEqual(voice.clean(text), "Sounds good, ship it.")
        self.assertEqual(voice.clean("Yep, on it.\n--\nRobin | Product\n555-0100"), "Yep, on it.")
        self.assertEqual(voice.clean("See below.\n\n---------- Forwarded message ---------\nFrom: x"), "See below.")
        self.assertEqual(voice.clean("Done.\n\nSent from my iPhone"), "Done.")
        self.assertEqual(voice.clean("Agreed.\n> quoted\nThanks"), "Agreed.\nThanks")

    def test_outlook_quote_header_cuts(self):
        text = "Will do.\n\nFrom: Priya Shah <priya@acme.example>\nSent: Tuesday, October 20, 2026\nTo: Robin Vale"
        self.assertEqual(voice.clean(text), "Will do.")


class Taking(CoreCase):
    def test_samples_are_checked_by_field(self):
        with self.assertRaises(FuzzError) as e:
            voice.submit(self.core, [{"source": "fax", "source_id": "1", "ts": "2026-10-10T10:00:00Z", "text": "hi"}])
        self.assertEqual(e.exception.field, "samples[0].source")
        with self.assertRaises(FuzzError):
            voice.submit(self.core, [dict(mail(1, [PRIYA], "Fine by me"), cc=[])])

    def test_you_are_left_out_of_who_it_went_to_and_short_ones_are_skipped(self):
        me = {"email": self.core.config["me"]["emails"][0]}
        got = voice.submit(self.core, [mail(1, [PRIYA, me], "Sounds good, ship it."), mail(2, [PRIYA], "ok")])
        self.assertEqual((got["saved"], got["too_short"]), (1, 1))
        [s] = voice.samples(self.core)
        self.assertEqual(s["to"], [PRIYA])

    def test_the_same_message_twice_is_one_sample(self):
        voice.submit(self.core, [mail(1, [PRIYA], "Sounds good, ship it.")])
        voice.submit(self.core, [mail(1, [PRIYA], "Sounds good, ship it.")])
        self.assertEqual(voice.count(self.core), 1)

    def test_turned_off_stores_nothing_and_shows_nothing(self):
        cfg = config.load(self.home)
        cfg["voice"] = {"enabled": False}
        config.save(self.home, cfg)
        core = self.make_core()
        self.assertTrue(voice.submit(core, [mail(1, [PRIYA], "Sounds good, ship it.")]).get("off"))
        self.assertEqual(voice.count(core), 0)
        self.assertEqual(tools.voice_examples(core, "Priya Shah <priya@acme.example>", "email.reply")["examples"], [])
        self.assertIsNone(voice.wanted(core))

    def test_forget_deletes_them(self):
        voice.submit(self.core, [mail(1, [PRIYA], "Sounds good, ship it.")])
        self.assertEqual(voice.forget(self.core), 1)
        self.assertEqual(voice.count(self.core), 0)


class NotFuzzsOwn(CoreCase):
    """A draft you approved as written is Fuzz's writing: when it comes back from your sent folder it's left out."""

    def approve(self, body, edit=None, kind="email.reply", target="Priya Shah <priya@acme.example>"):
        tid = tasks.capture(self.core, f"Reply {body[:10]}")
        tasks.assign(self.core, tid)
        scheduler.claim_next(self.core, tid)
        tools.add_source(self.core, tid, "Thread", "https://mail.example/thread")
        srcs = self.core.all("SELECT id FROM sources WHERE task_id=?", (tid,))
        drafts.save_draft(self.core, tid, kind, target, body, reply_to=srcs[0]["id"] if kind == "email.reply" else None)
        card = self.card_for(tid, "draft")
        if edit:
            answers.answer(self.core, card["id"], "edit", edit)
        answers.answer(self.core, card["id"], "approve")
        return tid

    def test_a_draft_sent_as_written_comes_back_and_is_left_out(self):
        self.approve("The vendor list is in the shared folder now, with the two late invoices flagged.")
        got = voice.submit(self.core, [mail(1, [PRIYA], "The vendor list is in the shared folder now, with the two "
                                                         "late invoices flagged.\n\nOn Tue Priya wrote:\n> where is it?")])
        self.assertEqual((got["saved"], got["fuzz_wrote"]), (0, 1))

    def test_an_edited_draft_counts_once_with_what_fuzz_wrote_beside_it(self):
        self.approve("Hi Priya, I hope you're well. The vendor list is now available in the shared folder.",
                     edit="vendor list's in the shared folder, two invoices still late")
        got = voice.submit(self.core, [mail(1, [PRIYA], "vendor list's in the shared folder, two invoices still late")])
        self.assertEqual(got["fuzz_wrote"], 1, "the sent copy of an edited draft comes in from the drafts side")
        [s] = voice.samples(self.core)
        self.assertEqual(s["origin"][:6], "draft:")
        self.assertIn("I hope you're well", s["fuzz_wrote"])
        self.assertEqual(s["to"][0]["email"], "priya@acme.example")


class Choosing(CoreCase):
    def setUp(self):
        super().setUp()
        voice.submit(self.core, [
            mail(1, [PRIYA], "yep, ship it. I'll tell finance."),
            mail(2, [PRIYA], "vendor list looks right to me, go ahead"),
            mail(3, [SAM], "Sam, can you take the offsite budget? I'm out Friday."),
            mail(4, [VENDOR], "Hi Lee,\n\nThanks for the quote. We'll confirm the order by Monday.\n\nBest,\nJ"),
            mail(5, [PRIYA, SAM], "Both of you: the review moved to Thursday."),
            {"source": "slack", "source_id": "C1:1", "ts": "2026-10-15T10:00:00Z", "text": "lgtm, merging now",
             "to": [], "place": "release-train"},
            {"source": "slack", "source_id": "D1:1", "ts": "2026-10-16T10:00:00Z",
             "text": "can you look at the deck before 3?", "to": [{"name": "Sam Okafor", "slack_id": "USAM"}]},
        ])

    def test_the_same_person_comes_first(self):
        got = tools.voice_examples(self.core, "Priya Shah <priya@acme.example>", "email.reply", "vendor list")
        texts = [e["text"] for e in got["examples"]]
        self.assertEqual(texts[0], "vendor list looks right to me, go ahead", "topic orders within the same person")
        self.assertIn("yep, ship it. I'll tell finance.", texts[:2])
        self.assertEqual(got["examples"][0]["why"], "Their message to the same person")

    def test_then_the_same_audience_never_the_other_side(self):
        got = tools.voice_examples(self.core, "Alex Rivera <alex@acme.example>", "email.new")
        texts = [e["text"] for e in got["examples"]]
        self.assertNotIn("Hi Lee", " ".join(texts), "an outside message isn't an example for an inside one")
        self.assertNotIn("Both of you", " ".join(texts), "a group email isn't an example for one person")
        self.assertTrue(texts)
        self.assertIn("inside the company", got["examples"][0]["why"])

    def test_outside_the_company_gets_the_outside_messages(self):
        got = tools.voice_examples(self.core, "Dana Quillfeather <dana@contoso.example>", "email.new")
        self.assertEqual([e["text"][:7] for e in got["examples"]], ["Hi Lee,"])

    def test_slack_never_mixes_with_email_and_a_channel_matches_by_name(self):
        got = tools.voice_examples(self.core, "Slack #release-train", "slack.message")
        self.assertEqual([e["text"] for e in got["examples"]], ["lgtm, merging now"])
        self.assertEqual(got["examples"][0]["why"], "Their message in the same channel")
        got = tools.voice_examples(self.core, "Sam Okafor", "slack.message")
        self.assertEqual(got["examples"][0]["text"], "can you look at the deck before 3?")

    def test_before_and_leave_out_keep_an_eval_from_seeing_its_answer(self):
        got = voice.examples(self.core, "Priya Shah <priya@acme.example>", "email.reply",
                             before="2026-10-12T00:00:00Z", leave_out=["yep, ship it. I'll tell finance."])
        self.assertEqual(got["examples"], [])
        self.assertIn("note", got)

    def test_no_samples_says_so(self):
        voice.forget(self.core)
        got = tools.voice_examples(self.core, "Priya Shah", "email.reply")
        self.assertEqual(got["examples"], [])
        self.assertIn("write plainly", got["note"])

    def test_to_is_required(self):
        with self.assertRaises(FuzzError):
            tools.voice_examples(self.core, "  ")


class Targets(CoreCase):
    def test_what_a_draft_target_says(self):
        self.assertEqual(voice.parse_target("Alex Rivera <alex@acme.example>", "email.reply"),
                         ("email", [{"email": "alex@acme.example", "name": "Alex Rivera"}], None))
        self.assertEqual(voice.parse_target("Slack #offsite-planning", "slack.message"), ("slack", [], "offsite-planning"))
        self.assertEqual(voice.parse_target("Priya Shah and Sam Okafor", "slack.message"),
                         ("slack", [{"name": "Priya Shah"}, {"name": "Sam Okafor"}], None))
        self.assertEqual(voice.parse_target("Slack DM with Sam Okafor", "slack.message")[1], [{"name": "Sam Okafor"}])


class Style(CoreCase):
    def test_counted_lines_once_there_are_enough(self):
        voice.submit(self.core, [mail(i, [PRIYA], f"Hi Priya,\n\nnumbers for week {i} are in.\n\nThanks")
                                 for i in range(4)])
        aud = voice.audience(self.core, "email", [PRIYA])
        self.assertEqual(voice.style(self.core, aud), [], "four messages aren't enough to say how you write")
        voice.submit(self.core, [mail(9, [SAM], "Hi Sam,\n\nthe deck is ready for you.\n\nThanks")])
        lines = voice.style(self.core, aud)
        self.assertIn("from 5 of their messages", lines[0])
        self.assertIn("greeting in 5 of 5, most often “Hi”", " ".join(lines))
        self.assertIn("sign off in 5 of 5, most often “Thanks”", " ".join(lines))
        self.assertIn("Plain sentences", " ".join(lines))
        self.assertNotIn("lower case", " ".join(lines), "a message that opens with Hi doesn't start in lower case")

    def test_overview_for_settings(self):
        voice.submit(self.core, [mail(i, [PRIYA], f"ok, week {i} looks fine") for i in range(6)])
        got = voice.overview(self.core)
        self.assertEqual((got["enabled"], got["messages"]), (True, 6))
        self.assertEqual(got["profiles"][0]["audience"], "To one person inside the company, by email")
        self.assertIn("never open with a greeting", " ".join(got["profiles"][0]["lines"]))
        self.assertIn("Usually about", got["profiles"][0]["lines"][0])


class Backfill(CoreCase):
    def test_asks_once_a_day_until_there_are_enough_or_no_more(self):
        w = tools.whoami(self.core, "extractor")["writing_samples_wanted"]
        self.assertEqual(w["count"], voice.WANT)
        self.assertNotIn("writing_samples_wanted", tools.whoami(self.core, "extractor"), "once a day")
        self.assertNotIn("writing_samples_wanted", tools.whoami(self.core, "executor"))
        self.clock.advance(days=1, minutes=1)
        voice.submit(self.core, [mail(1, [PRIYA], "Sounds good, ship it.")], no_more=True)
        self.assertNotIn("writing_samples_wanted", tools.whoami(self.core, "extractor"), "you have no older messages")

    def test_stops_asking_at_enough(self):
        voice.submit(self.core, [mail(i, [PRIYA], f"week {i} looks fine", ts="2026-09-{:02d}T10:00:00Z".replace(
            "{:02d}", f"{(i % 28) + 1:02d}")) | {"source_id": f"x{i}"} for i in range(voice.WANT)])
        self.assertIsNone(voice.wanted(self.core))


class Untouched(CoreCase):
    def test_replay_leaves_samples_alone(self):
        from fuzz import events
        voice.submit(self.core, [mail(1, [PRIYA], "Sounds good, ship it.")])
        self.assertEqual(events.check_replay(self.core), [])
        self.assertEqual(voice.count(self.core), 1)
