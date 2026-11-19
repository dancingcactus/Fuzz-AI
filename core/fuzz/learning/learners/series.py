"""What Fuzz suggests in a series (docs/series.md, "Suggesting new tasks"): "Not needed" feeds lessons.

From the outcomes of the last WINDOW suggestions of one kind in one series (the series_suggestion feedback rows
series/ask.py writes): when you said Not needed AGREE times or more and never took one, Fuzz stops suggesting
that kind there. The lesson goes live at once (it only ever makes Fuzz quieter) and shows in Settings, where you
can turn it off. series/suggest.py reads the active ones.
"""

import json

from . import Learner

LEARNER = Learner(name="series", surface="series_suggest", prefix="series:")
WINDOW = 5
AGREE = 2
WHAT = {"follow_through": "follow-ups on decisions", "prep": "getting ready for milestones", "stall": "nudges",
        "at_risk": "steps for work at risk", "usual_next": "its usual next steps"}


def learn(core):
    by = {}
    for r in core.all("SELECT a, note FROM feedback WHERE user_id=? AND kind='series_suggestion' ORDER BY id DESC", (core.user_id,)):
        try:
            n = json.loads(r["note"] or "{}")
        except ValueError:
            continue
        if n.get("detector"):
            by.setdefault((r["a"], n["detector"]), []).append(n.get("outcome"))
    out = []
    for (sid, det), outcomes in by.items():
        recent = outcomes[:WINDOW]
        no = sum(1 for o in recent if o == "not_needed")
        if no < AGREE or any(o in ("add", "mine") for o in recent):
            continue
        s = core.one("SELECT name FROM series WHERE id=? AND user_id=?", (sid, core.user_id))
        name = s["name"] if s else "this series"
        out.append({"key": f"series:{sid}:{det}", "kind": "rule", "status": "active", "how": "inferred",
                    "rule": f"Don’t suggest {WHAT.get(det, det)} in {name}: you said they weren’t needed {no} of the last "
                            f"{len(recent)} times."})
    return out
