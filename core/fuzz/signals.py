"""The signal and verdict formats the extractor must send (spikes/task-matching/skill/references/signal-schema.md).

Errors name the exact field ("signals[2].candidates[0].ask"), so a model fixes them in one try.
"""

import jsonschema

from .db import FuzzError

PERSON = {"type": "object", "properties": {
    "name": {"type": "string"}, "email": {"type": "string"}, "slack_id": {"type": "string"}},
    "additionalProperties": False}

MOMENT = {   # a described date from the calendar: "Before the leadership meeting", Thu 9:00
    "type": "object",
    "required": ["label", "at"],
    "properties": {
        "key": {"type": "string", "minLength": 1, "maxLength": 60},
        "label": {"type": "string", "minLength": 1, "maxLength": 60},
        "at": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$"},
        "cancelled": {"type": "boolean"},
        "reason": {"type": "string", "maxLength": 200},
    },
    "additionalProperties": False,
}

CANDIDATE = {
    "type": "object",
    "required": ["ask"],
    "properties": {
        "ask": {"type": "string", "minLength": 1, "maxLength": 300},
        "owner": {"type": "string"},
        "due": {"type": ["string", "null"], "pattern": r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?$"},
        "people": {"type": "array", "items": PERSON},
        "links": {"type": "array", "items": {"type": "string"}},
        "topics": {"type": "array", "items": {"type": "string"}},
        "context_md": {"type": "string", "maxLength": 16384},
        "question": {"type": "string", "maxLength": 500},
        "effort_mins": {"type": "integer", "minimum": 1},
        "steps": {"type": "integer", "minimum": 1, "maximum": 50},   # how many steps the work takes
        "energy": {"enum": ["low", "normal", "high"]},
        "moments": {"type": "array", "maxItems": 2, "items": MOMENT},
        # the ask is moot after this ("can you join the meeting?" ends with the meeting): no task once it's past
        "until": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$"},
    },
    "additionalProperties": False,
}

ABOUT = {   # what a fact is about: a person (by email or Slack ID when known), a company, a tool or a term
    "type": "object", "required": ["type"],
    "properties": {"type": {"enum": ["person", "org", "tool", "term"]}, "name": {"type": "string", "maxLength": 200},
                   "email": {"type": "string"}, "slack_id": {"type": "string"}, "domain": {"type": "string"}},
    "additionalProperties": False}

FACT = {   # a working fact about an entity; attr from the allowlist for its type (the core refuses the rest)
    "type": "object", "required": ["about", "attr", "value"],
    "properties": {"about": ABOUT, "attr": {"type": "string", "maxLength": 40},
                   "value": {"type": "string", "minLength": 1, "maxLength": 500},
                   "how": {"enum": ["stated", "inferred"]}, "said_by": PERSON},
    "additionalProperties": False}

TERM = {   # an acronym or internal name, with Fuzz's best guess at what it means
    "type": "object", "required": ["term"],
    "properties": {"term": {"type": "string", "minLength": 1, "maxLength": 120}, "kind": {"enum": ["term", "tool"]},
                   "aliases": {"type": "array", "items": {"type": "string", "maxLength": 120}},
                   "best_guess": {"type": "string", "maxLength": 500}},
    "additionalProperties": False}

DECISION = {
    "type": "object", "required": ["what", "confidence"],
    "properties": {"what": {"type": "string", "minLength": 1, "maxLength": 300}, "why": {"type": "string", "maxLength": 1000},
                   "alternatives": {"type": "array", "items": {"type": "string", "maxLength": 200}},
                   "decided_by": PERSON, "said_by": PERSON, "decided_at": {"type": "string"},
                   "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                   "how": {"enum": ["stated", "inferred"]}, "reverses": {"type": "integer"}},
    "additionalProperties": False}

MEETING = {   # the meeting as a whole, on any of its signals (one knowledge item per meeting file)
    "type": "object", "required": ["summary"],
    "properties": {"title": {"type": "string", "maxLength": 200}, "attendees": {"type": "array", "items": PERSON},
                   "summary": {"type": "string", "minLength": 1, "maxLength": 4000},
                   "open_questions": {"type": "array", "items": {"type": "string", "maxLength": 300}}},
    "additionalProperties": False}

SIGNAL = {
    "type": "object",
    "required": ["source", "source_id"],
    "properties": {
        "source": {"enum": ["email", "slack", "meeting", "calendar"]},
        "source_id": {"type": "string", "minLength": 1},
        "version": {"type": ["string", "integer"]},
        "anchor": {"type": ["string", "null"]},
        "message_ids": {"type": "array", "items": {"type": "string"}},
        "link": {"type": ["string", "null"]},
        "title": {"type": "string", "maxLength": 200},
        "ts": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$"},
        "from": PERSON,
        "people": {"type": "array", "items": PERSON},
        "links": {"type": "array", "items": {"type": "string"}},
        "quote": {"type": "string", "maxLength": 600},
        "withdrawn": {"type": "boolean"},
        "answers": {"type": "boolean"},   # the person's own reply, doing what the thread asked of them
        "resolved": {"type": "boolean"},  # the one who asked, saying it's sorted: nothing more is needed
        # the next move on the thread is this person's, not the person's: they were handed it, or took it on
        "waiting_on": {"type": "string", "minLength": 1, "maxLength": 120},
        "candidates": {"type": "array", "items": CANDIDATE},
        # memory (docs/memory-layers.md)
        "facts": {"type": "array", "items": FACT},
        "terms": {"type": "array", "items": TERM},
        "decisions": {"type": "array", "items": DECISION},
        "meeting": MEETING,
    },
    "additionalProperties": False,
}

KNOWLEDGE = {
    "type": "object", "required": ["kind", "summary_md"],
    "properties": {"kind": {"enum": ["thread", "reference", "learning"]}, "title": {"type": "string", "maxLength": 200},
                   "summary_md": {"type": "string", "minLength": 1, "maxLength": 4000},
                   "source_ref": {"type": "string"}, "link": {"type": "string"}, "source_ts": {"type": "string"},
                   "about": {"type": "array", "items": ABOUT}, "decisions": {"type": "array", "items": DECISION}},
    "additionalProperties": False}

LOOKED_UP = {   # a fact from the second pass: the org directory, a wiki page, a search
    "type": "object", "required": ["about", "attr", "value"],
    "properties": {"about": ABOUT, "attr": {"type": "string", "maxLength": 40},
                   "value": {"type": "string", "minLength": 1, "maxLength": 500},
                   "how": {"enum": ["stated", "inferred"]}, "said_by": PERSON,
                   "source_kind": {"enum": ["directory", "doc", "email", "slack", "teams", "meeting", "calendar"]},
                   "source_ref": {"type": "string"}, "link": {"type": "string"}, "source_ts": {"type": "string"}},
    "additionalProperties": False}

VERDICT = {
    "type": "object",
    "required": ["candidate_id", "verdict", "confidence"],
    "properties": {
        "candidate_id": {"type": "integer"},
        "task_id": {"type": ["integer", "null"]},
        "verdict": {"enum": ["same", "related", "new"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "new_ask": {"type": "boolean"},
        "new_title": {"type": ["string", "null"]},
        "deliverable_id": {"type": ["integer", "null"]},   # part of this deliverable (from the item's deliverables)
        "reason": {"type": "string"},
    },
    "additionalProperties": False,
}


def _path(prefix, err):
    out = prefix
    for p in err.absolute_path:
        out += f"[{p}]" if isinstance(p, int) else f".{p}"
    return out


def _check(items, schema, name, limit):
    if not isinstance(items, list):
        raise FuzzError(f"{name} must be a JSON array", name)
    if len(items) > limit:
        raise FuzzError(f"Send at most {limit} {name} per call", name)
    v = jsonschema.Draft202012Validator(schema)
    for i, item in enumerate(items):
        errs = sorted(v.iter_errors(item), key=lambda e: list(e.absolute_path))
        if errs:
            e = errs[0]
            field = _path(f"{name}[{i}]", e)
            msg = e.message
            if e.validator == "additionalProperties":
                msg = f"unknown field: {msg.split(chr(39))[1] if chr(39) in msg else msg}"
            raise FuzzError(f"{field}: {msg}", field)


def check_signals(signals):
    _check(signals, SIGNAL, "signals", 200)
    for i, s in enumerate(signals):
        if s.get("withdrawn") and s.get("candidates"):
            raise FuzzError(f"signals[{i}]: a withdrawn signal has no candidates", f"signals[{i}].candidates")
        if s.get("answers") and s.get("candidates"):
            raise FuzzError(f"signals[{i}]: a reply that answers the thread has no candidates; send a new ask "
                            "in it as its own signal", f"signals[{i}].answers")
        if s.get("resolved") and s.get("candidates"):
            raise FuzzError(f"signals[{i}]: a message saying the ask is sorted has no candidates; send a new ask "
                            "in it as its own signal", f"signals[{i}].resolved")
        if s.get("waiting_on") and (s.get("answers") or s.get("resolved") or s.get("withdrawn")):
            raise FuzzError(f"signals[{i}]: a message that settles or withdraws the ask leaves no one to wait on",
                            f"signals[{i}].waiting_on")


def check_verdicts(verdicts):
    _check(verdicts, VERDICT, "verdicts", 200)
    for i, v in enumerate(verdicts):
        if v["verdict"] != "new" and v.get("task_id") is None:
            raise FuzzError(f"verdicts[{i}].task_id is required when the verdict is {v['verdict']}",
                            f"verdicts[{i}].task_id")


def check_knowledge(items):
    _check(items, KNOWLEDGE, "items", 50)


def check_facts(items):
    _check(items, LOOKED_UP, "facts", 200)
