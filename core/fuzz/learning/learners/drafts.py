"""How you write: style rules from the drafts you edited before sending (docs/self-improving.md, "Draft edits").

Each edited draft is compared with what you sent, as facts (draft_evals.form): you cut it by a third or more,
took out the greeting, the sign-off, or the headings, bold and bullets. Over your last WINDOW edited drafts, a
change you made AGREE times or more becomes an active rule the executor reads before it drafts: a wording
lesson goes live once the evidence agrees, and every draft still waits for your OK. Seen twice, it's proposed
for your yes in Settings. A rule you said yes to stays; one Fuzz inferred goes when the evidence does.

SQL only. Facts you corrected in a draft (a wrong date, the wrong person) aren't style: they belong to memory.
"""

from . import Learner

LEARNER = Learner(name="drafts", surface="draft", prefix="draft:")
WINDOW = 10
AGREE = 3
STYLE = {
    "shorter": ("Keep drafts short: they cut {n} of their last {m} edited drafts by a third or more.",
                lambda f: (f["length"] or 0) >= 1.5),
    "no_greeting": ("Leave out the greeting: they took it out of {n} of their last {m} edited drafts.",
                    lambda f: f["greeting_dropped"]),
    "no_signoff": ("Leave out the sign-off: they took it out of {n} of their last {m} edited drafts.",
                   lambda f: f["signoff_dropped"]),
    "no_markup": ("Write plain sentences, with no headings, bold or bullet lists: they took them out of {n} of "
                  "their last {m} edited drafts.", lambda f: f["markup_dropped"]),
}


def learn(core):
    from ... import draft_evals
    out = []
    kept = {r["key"]: r for r in core.all("SELECT key, rule FROM lessons WHERE user_id=? AND surface='draft' "
                                          "AND how='confirmed' AND status='active'", (core.user_id,))}
    edited = [h for h in draft_evals.history(core) if h["edited"] and h["sent"]][-WINDOW:]
    m = len(edited)
    forms = [draft_evals.form(h["wrote"], h["sent"]) for h in edited]
    for name, (text, test) in STYLE.items():
        key = f"draft:{name}"
        n = sum(1 for f in forms if test(f))
        if n >= 2:
            out.append({"key": key, "kind": "rule", "rule": text.format(n=n, m=m),
                        "status": "active" if n >= AGREE else "proposed", "how": "inferred",
                        "example": {"style": name, "seen": n, "of": m}})
        elif key in kept:   # you said yes to it: it stays
            out.append({"key": key, "kind": "rule", "rule": kept[key]["rule"], "status": "active", "how": "confirmed",
                        "example": {"style": name, "seen": n, "of": m}})
    return out
