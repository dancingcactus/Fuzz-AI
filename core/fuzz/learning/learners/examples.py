"""Examples from your corrections: every message you labelled becomes an example extraction reads.

A message you said Fuzz missed ("That's the one") is a keep example, active at once: the card says Fuzz learns
from it. A message you said held no task (Not a task) is a skip example, proposed: it changes what Fuzz drops,
so it waits for your OK in Settings. Only cases whose text was fetched count, and a case whose label was taken
back (Undo, a newer label) takes its example with it. One that only expired keeps it: the label was true.
"""

import json

from . import Learner

LEARNER = Learner(name="examples", surface="extract", prefix="case:")
WHERE = {"email": "email", "slack": "Slack message", "meeting": "meeting notes"}


def _who(f):
    if not isinstance(f, dict):
        return None
    name, email = f.get("name"), f.get("email")
    return f"{name} <{email}>" if name and email else name or email


def learn(core):
    rows = core.all("SELECT id, kind, input, expected, quote FROM eval_cases WHERE user_id=? AND surface='extract' "
                    "AND origin LIKE 'feedback:%' AND withdrawn=0 AND fetched_at IS NOT NULL "
                    "AND status IN ('active', 'retired') ORDER BY id", (core.user_id,))
    out = []
    for c in rows:
        msg = json.loads(c["input"]) if isinstance(c["input"], str) else c["input"]
        exp = json.loads(c["expected"]) if isinstance(c["expected"], str) else c["expected"]
        who = _who(msg.get("from"))
        where = WHERE.get(msg.get("source"), "message")
        title = msg.get("title") or msg.get("channel")
        example = {k: v for k, v in (("source", msg.get("source")), ("from", who), ("title", title),
                                      ("quote", c["quote"]), ("ask", exp.get("ask") if c["kind"] == "keep" else None))
                   if v}
        named = f"{who or 'Someone'}’s {where}" + (f" “{title}”" if title else "")
        if c["kind"] == "keep":
            ask = (exp.get("ask") or "do something").strip().rstrip(".")
            rule = f"{named} asked you to {ask[:1].lower() + ask[1:]}, and I missed it."
            status, how = "active", "confirmed"
        else:
            rule = f"{named} held nothing for you."
            status, how = "proposed", "inferred"
        out.append({"key": f"case:{c['id']}", "kind": c["kind"], "case_id": c["id"], "example": example,
                    "rule": rule, "status": status, "how": how})
    return out
