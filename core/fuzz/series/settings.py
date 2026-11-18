"""Every number series detection and suggestions use, in one place (docs/series.md, "Rules for a series").

They are starting points from the spikes, not settled values: tune them in config.json under "series"
(any key here, e.g. {"series": {"min_tasks": 5}}) rather than in the code.
"""

DEFAULTS = {
    # Rules for a series: at least this many tasks, from this many origins, active on this many days
    "min_tasks": 4,
    "min_origins": 2,
    "min_days": 3,
    # Attach: a task joins a series when its anchor score reaches this; a second series scoring within
    # near_tie of the best is "also touches", never a judge item
    "attach_score": 6.0,
    "near_tie": 0.6,
    # Seed: an anchor on this many free tasks proposes a candidate
    "seed_min": 3,
    "seed_kinds": ["topic", "ticket", "term", "chan", "meet"],   # documents support a series, never start one
    # Rarity: an anchor on more than this share of tasks (and more than broad_floor tasks) says nothing
    "broad": 0.10,
    "broad_floor": 8,
    "n_floor": 150,                 # rarity is worked out against at least this many tasks
    # Candidates overlap enough to be one when they share this much (Jaccard), or the smaller is this much inside
    "merge_jaccard": 0.4,
    "merge_inside": 0.8,
    # A cluster the judge waited on, split or left comes back once it has grown by this many tasks
    "regrow": 2,
    # Areas: their anchors count for this much when scoring; a cluster inside one is re-judged at this growth
    "area_weight": 0.5,
    "area_regrow": 2.0,
    # Forming series: re-checked with the judge after this many days without growing
    "forming_stall_days": 7,
    # Gone quiet: no task moved for this many days
    "dormant_days": 21,
    # Suggestions: per series per week, per run in all, and each detector's window
    "suggest_per_week": 2,
    "suggest_per_run": 3,
    "stall_days": 7,
    "prep_days": 3,
    "risk_days": 5,
    "decision_wait_days": 1,        # a decision gets this long for a task or message to follow it
    "decision_window_days": 14,
    # How much each kind of anchor is worth, before rarity
    "weights": {"topic": 3.0, "ticket": 3.0, "document": 3.0, "term": 2.0, "word": 3.0, "meet": 2.0,
                "chan": 2.0, "proj": 1.0, "tool": 1.0, "org": 1.0, "dm": 0.75, "person": 0.75},
}


def get(core):
    """The settings with config.json's "series" laid over the defaults (weights merged key by key)."""
    over = (core.config.get("series") or {}) if core is not None else {}
    out = dict(DEFAULTS)
    for k, v in over.items():
        if k == "weights" and isinstance(v, dict):
            out["weights"] = dict(DEFAULTS["weights"], **v)
        elif k in DEFAULTS:
            out[k] = v
    return out
