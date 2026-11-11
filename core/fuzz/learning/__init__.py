"""Lessons: what Fuzz learned from your corrections, as data a role reads before it acts (docs/self-improving.md).

There's no lessons store yet. This module holds the one thing the real runs and the evals must share: how a
set of lessons is narrowed to a message and written into a prompt. An eval that rendered lessons its own way
would score a prompt nobody runs.

A lesson is a dict: {"rule": "one plain sentence", "scope": {...} (optional; none is global),
"feedback_ids": [ids of the corrections it came from]}. Scope keys: "from" (an email: messages that person
sent) and "person" (an email: messages they're on at all, cc included).
"""


def _emails(msg):
    people = [msg.get("from") or {}] + list(msg.get("people") or [])
    return {(p.get("email") or "").lower() for p in people if p.get("email")}


def applies(lesson, msg, leave_out=None):
    """Whether a lesson belongs in the prompt for this message. leave_out: a feedback id whose own lessons stay
    out, so an eval case is never scored with the lesson it taught (leave-one-out)."""
    if leave_out is not None and leave_out in (lesson.get("feedback_ids") or []):
        return False
    scope = lesson.get("scope") or {}
    sender = (scope.get("from") or "").lower()
    if sender and sender != ((msg.get("from") or {}).get("email") or "").lower():
        return False
    person = (scope.get("person") or "").lower()
    return not person or person in _emails(msg)


def for_message(lessons, msg, leave_out=None):
    return [x for x in lessons or [] if applies(x, msg, leave_out)]


def render(lessons):
    """The lessons as a prompt section, or "" when there are none."""
    if not lessons:
        return ""
    lines = "\n".join(f"- {x['rule']}" for x in lessons)
    return f"## What you've learned from this person's corrections\n\n{lines}\n"
