"""Reading a model's reply: the JSON object in it.

Models wrap the object they were asked for in prose, a code fence, or a second object ("here's my thinking:
{...} and the answer: {...}"). A greedy {.*} match takes everything from the first brace to the last, so
any of those breaks it; this scans for each object that decodes on its own.
"""

import json

_DECODER = json.JSONDecoder()


def objects(text):
    """Every top-level JSON object in text, in order. Braces that don't start valid JSON are skipped."""
    text, i = text or "", 0
    while True:
        i = text.find("{", i)
        if i < 0:
            return
        try:
            obj, end = _DECODER.raw_decode(text, i)
        except ValueError:
            i += 1
            continue
        if isinstance(obj, dict):
            yield obj
        i = end


def json_object(text, want=None):
    """The first JSON object in a reply, or the first one want(obj) accepts; None when there is none."""
    for obj in objects(text):
        if want is None or want(obj):
            return obj
    return None
