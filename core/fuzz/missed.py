"""Fuzz missed this: an ask that reached you but never became a task. You add a task saying so, in your own
words ("Find Dana's email about the venue contract, you missed it"); the executor finds the message; you
confirm it on one card, "Is it this one?"; the task becomes that ask, and the message a keep case for the
evals (docs/self-improving.md). `fuzz capture --missed` tags one up front, for testing.

The message's text goes straight into eval_cases, never into an event, a card, a note or the brief: the log
is permanent and the text is kept for 90 days. The card carries a short quote, as a signal does.

Every confirmed find is a keep case, whatever extraction did with the message: the label is yours, and it's
true. Why it was missed is a note, worked out by matching the find to the signals Fuzz stored: extraction
never saw it, judged it FYI, unclear or someone else's, or did make it yours (then the task already exists).
"""

import jsonschema

from . import cards, evals, events, signals, tasks
from .db import FuzzError

TRIES = 2   # finds you can turn down with "Not that one" before Fuzz keeps the task as you wrote it
SOURCES = ("email", "slack", "meeting")
REASONS = {
    "never_seen": "extraction never read it",
    "judged_fyi": "extraction read it and saw no ask",
    "judged_unclear": "extraction couldn't tell whose it was",
    "judged_someone_else": "extraction thought it was someone else's",
    "found_yours": "extraction had it as yours",
}
SOURCE_LABEL = {"email": "an email", "slack": "Slack", "meeting": "a meeting summary"}
CARD_OPTIONS = ["yes", "not_quite", "skip"]
NOTE = "You said Fuzz missed this. It's finding the message it came from."


def _feedback(core, task_id, note):
    return core.q("INSERT INTO feedback (user_id, ts, kind, a, note) VALUES (?,?,?,?,?)",
                  (core.user_id, core.now_iso(), "missed", task_id, note)).lastrowid


def tries(core, task_id):
    """How many finds this task has had."""
    return core.one("SELECT COUNT(*) n FROM feedback WHERE user_id=? AND kind='missed' AND a=? AND note NOT LIKE "
                    "'not_found%'", (core.user_id, task_id))["n"]


def match(core, found):
    """The stored signal for the message the executor found, by its id or its link. Two runs of a model name
    a message their own way, so either is enough. None when extraction never stored it."""
    row = core.one("SELECT key FROM signals WHERE user_id=? AND source=? AND (source_id=? OR (link IS NOT NULL AND "
                   "link=?)) ORDER BY ts DESC LIMIT 1",
                   (core.user_id, found["source"], found["source_id"], found.get("link") or ""))
    return row["key"] if row else None


def reason(core, key):
    """Why extraction missed it, and the task it made of it when it had it as yours."""
    if key is None:
        return "never_seen", None
    owners = [c["owner"] for c in core.all("SELECT owner FROM candidates WHERE user_id=? AND signal_key=? "
                                           "AND kind='ask'", (core.user_id, key))]
    if any((o or "me") == "me" for o in owners):
        t = core.one("SELECT t.id, t.title, t.state FROM sources so JOIN tasks t ON t.id=so.task_id "
                     "WHERE so.user_id=? AND so.signal_key=? AND so.role='origin' ORDER BY so.id LIMIT 1",
                     (core.user_id, key))
        return "found_yours", t
    if "unclear" in owners:
        return "judged_unclear", None
    if owners:
        return "judged_someone_else", None
    return "judged_fyi", None


NEEDED = {"source_id": "an email's Message-ID, a Slack message's channel:ts, a meeting's file#row",
          "text": "the message exactly as written, without quoted replies or a signature",
          "quote": "the line that asks, under 300 characters: the card shows it",
          "ask": "the ask for the person, as a short imperative"}


def _check(found):
    """The executor's find is model output: checked like a signal before any of it is kept or shown."""
    if not isinstance(found, dict):
        raise FuzzError("found is {source, source_id, link, ts, from, title, quote, text, ask}", "found")
    if found.get("source") not in SOURCES:
        raise FuzzError(f"found.source is one of {', '.join(SOURCES)}", "found.source")
    for k, what in NEEDED.items():
        if not isinstance(found.get(k), str) or not found[k].strip():
            raise FuzzError(f"found.{k} is needed: {what}", f"found.{k}")
    if found.get("link") and not tasks.LINK_RE.match(found["link"]):
        raise FuzzError("found.link is the message's full http(s) address, or leave it out", "found.link")
    for k, schema in (("from", signals.PERSON), ("people", {"type": "array", "items": signals.PERSON})):
        if found.get(k) is not None:
            try:
                jsonschema.validate(found[k], schema)
            except jsonschema.ValidationError as e:
                raise FuzzError(f"found.{k}: {e.message}", f"found.{k}")
    for k in ("title", "channel", "ts"):
        if found.get(k) is not None and not isinstance(found[k], str):
            raise FuzzError(f"found.{k} is text", f"found.{k}")


def drop_finds(core, task_id, why):
    """The messages found for this task that you didn't say yes to: their cases go, with their text."""
    for f in core.all("SELECT id FROM feedback WHERE user_id=? AND kind='missed' AND a=?", (core.user_id, task_id)):
        c = core.one("SELECT status FROM eval_cases WHERE user_id=? AND origin=?", (core.user_id, f"feedback:{f['id']}"))
        if c and c["status"] == "unconfirmed":
            evals.retire(core, f"feedback:{f['id']}", why)


def report(core, task_id, found=None, not_found=None, actor="fuzz:executor"):
    """The executor looked for the message, on a task tagged missed or one whose words asked it to. Found: it
    waits for you on "Is it this one?". Not found: the task is yours as you wrote it."""
    t = tasks.require(core, task_id)
    if not found:
        why = (not_found or "").strip() or "it searched and found nothing"
        _feedback(core, task_id, f"not_found: {why}"[:300])
        _back_to_you(core, t, actor, f"Fuzz couldn't find the message ({why}). It's here as you wrote it.")
        return {"state": "triage", "found": False}
    _check(found)
    key = match(core, found)
    why, theirs = reason(core, key)
    fid = _feedback(core, task_id, why)
    msg = {k: found[k] for k in evals.MESSAGE_FIELDS if found.get(k)}
    msg["text"] = found["text"].strip()[:evals.TEXT_MAX]
    cid = evals.add_case(core, "extract", "keep", msg, {"has_my_ask": True, "ask": found["ask"].strip()[:300]},
                         f"feedback:{fid}", status="unconfirmed", signal_key=key,
                         note=f"Fuzz missed this: {REASONS[why]}", expires_at=evals.expires(core))
    who = (found.get("from") or {}).get("name") if isinstance(found.get("from"), dict) else None
    payload = {"case_id": cid, "feedback_id": fid, "source": found["source"], "from": who,
               "title": found.get("title") or found.get("channel"), "link": found.get("link"),
               "quote": found["quote"].strip()[:300], "ask": found["ask"].strip()[:300],
               "why": why}
    if theirs and theirs["state"] not in ("done", "letgo", "merged") and theirs["id"] != task_id:
        payload["already"] = {"id": theirs["id"], "title": theirs["title"]}
    where = SOURCE_LABEL[found["source"]] + (f" from {who}" if who else "")
    with core.tx(actor):
        ch = events.Changes()
        tasks.move(core, ch, t, "triage", add_tags=("missed", "missed_found"), schedule_anchor=None, schedule_fire_at=None)
        events.emit(core, "task.missed_found", task_id=task_id, changes=ch, data={"case_id": cid, "why": why},
                    log=("status", f"Fuzz found a message that may be it, in {where}."))
        cards.create(core, "missed", task_id, payload=payload,
                     reason=f"In {where}" + (f", “{payload['title']}”" if payload["title"] else "") + ":\n"
                     f"“{payload['quote']}”" + (f"\n\nYou already have this as “{payload['already']['title']}”."
                                                if payload.get("already") else ""))
    return {"state": "triage", "found": True, "case_id": cid, "why": why}


def _back_to_you(core, t, actor, log, card=None, option=None, value=None):
    with core.tx(actor):
        ch = events.Changes()
        tasks.move(core, ch, t, "triage", card=card, remove_tags=("missed", "missed_found"),
                   schedule_anchor=None, schedule_fire_at=None)
        if card:
            cards.mark_answered(core, ch, card, option, value)
        events.emit(core, "task.missed_kept", task_id=t["id"], changes=ch, log=("status", log))
        cards.sync(core, t["id"])


def answer(core, card, t, option, value):
    """Is it this one? Yes makes the case count; Not that one sends Fuzz to look again with what you said, up
    to TRIES finds; Keep it as I wrote it ends the search."""
    p = card.get("payload") or {}
    if option == "yes":
        # the message joins the task's sources quietly, as extraction's links do (a link_added event can't be
        # undone, and would take this answer's Undo with it); Undo withdraws it
        link = None
        if p.get("link") and tasks.LINK_RE.match(p["link"]):
            sid, added = tasks._link_source(core, t["id"], p.get("title") or "The message", p["link"], None)
            link = sid if added else None
        kept = evals.confirm(core, p.get("case_id"))
        ch = events.Changes()
        cards.mark_answered(core, ch, card, option, value)
        ch.task(t["id"], variant_tags=tasks._tags(t, (), {"missed", "missed_found"}))
        events.emit(core, "task.missed_confirmed", task_id=t["id"], changes=ch,
                    data={"case_id": p.get("case_id") if kept else None, "feedback_id": p.get("feedback_id"),
                          "link_source": link},
                    log=("status", "You said that's the message. Fuzz will learn from missing it." if kept else
                         "You said that's the message. Its text wasn't kept, so Fuzz won't test itself on it."))
        if p.get("ask"):   # it was "find what you missed"; now it's the ask itself
            tasks.rename(core, t["id"], title=p["ask"], ask=p["ask"], actor="human")
        if p.get("already"):
            other = tasks.get(core, p["already"]["id"])
            if other and other["state"] not in ("done", "letgo", "merged"):
                tasks.let_go(core, t["id"], why=f"It's already in your list as “{other['title']}”.")
                return
        cards.sync(core, t["id"])
        return
    drop_finds(core, t["id"], "You said it wasn't the one." if option == "not_quite" else "You kept the task as you wrote it.")
    if option == "not_quite" and tries(core, t["id"]) < TRIES:
        hint = (value or "").strip() if isinstance(value, str) else ""
        said = f"Not that one. {hint}".strip() if hint else "Not that one."
        ch = events.Changes()
        tasks.move(core, ch, t, "queued", card=card, add_tags=("gather", "missed"), remove_tags=("missed_found",),
                   attempts=0, notes=((t.get("notes") or "") + f"\nYou said: {said}").strip())
        cards.mark_answered(core, ch, card, option, value)
        events.emit(core, "task.missed_retry", task_id=t["id"], changes=ch, log=("guidance", f"You said: {said}"))
        return
    log = ("Fuzz couldn't find it in two tries. It's here as you wrote it." if option == "not_quite"
           else "You kept it as you wrote it.")
    _back_to_you(core, t, "human", log, card=card, option=option, value=value)
