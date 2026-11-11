"""How much to trust a fact: a pure function of the fact, the clock and how often it was shown.

Levels, best first: confirmed (you stated, edited or approved it), authoritative (an official source or the
owner, in their own words), reported (stated by someone else), inferred (Fuzz concluded it; nobody said it).
A fact older than its attribute's half-life is stale. Confirmed facts age at half the rate. A fact shown on
`exposure_days` separate days without a correction moves up one level, as far as reported: that changes how
it's labelled, never its `how`, so rule 4 (an inferred fact never drives an action) still sees it as inferred.
"""

from datetime import datetime, timezone

from ..db import parse_iso

LEVELS = ("confirmed", "authoritative", "reported", "inferred")
RANK = {"confirmed": 0, "authoritative": 1, "reported": 2, "inferred": 3, "stale": 4}
BASE_SCORE = {"confirmed": 1.0, "authoritative": 0.9, "reported": 0.7, "inferred": 0.5}

# days for the score to halve, per attribute; memory.half_life in config overrides any of them
HALF_LIFE = {"role": 120, "team": 120, "manager": 120, "company": 180, "projects": 45, "owns": 45,
             "cares_about": 90, "prefers": 90, "how_met": 3650, "works_hours": 120,
             "definition": 365, "stands_for": 730, "used_for": 180, "what_it_is": 365, "owner": 120,
             "relationship": 180, "contacts": 120}
DEFAULT_HALF_LIFE = 180
EXPOSURE_DAYS = 3


def _cfg(core):
    return (core.config.get("memory") or {}) if core is not None else {}


def half_life(core, attr):
    over = _cfg(core).get("half_life") or {}
    return float(over.get(attr) or HALF_LIFE.get(attr) or DEFAULT_HALF_LIFE)


def base_level(f):
    if f.get("confirmed_at") or f.get("how") == "edited":
        return "confirmed"
    if f.get("how") == "inferred":
        return "inferred"
    if f.get("authority") in ("owner", "official"):
        return "authoritative"
    return "reported"


def _when(f):
    """The date the fact is as of: when you confirmed it, else its source's date, else when Fuzz captured it."""
    return parse_iso(f.get("confirmed_at") or f.get("source_ts") or f.get("captured_at"))


def trust(f, now, views=(), half_life_days=None, exposure_days=EXPOSURE_DAYS):
    """{level, base, score, stale, exposed, age_days, half_life, why}. views: the days (or times) it was shown
    since it was captured. level is the label to show: confirmed, authoritative, reported, inferred or stale."""
    now = now if isinstance(now, datetime) else parse_iso(now)
    base = base_level(f)
    hl = float(half_life_days or HALF_LIFE.get(f.get("attr"), DEFAULT_HALF_LIFE))
    if base == "confirmed":
        hl *= 2
    when = _when(f) or now
    age = max((now - when).total_seconds() / 86400.0, 0.0)
    factor = 0.5 ** (age / hl)
    level, exposed = base, 0
    captured = f.get("captured_at") or ""
    days = {str(v)[:10] for v in views if str(v) >= captured[:10]}
    if base == "inferred" and len(days) >= exposure_days:
        level, exposed = "reported", len(days)
    stale = age > hl
    why = [f"base {base.title()} ({f.get('how')}, {f.get('authority')})",
           f"aged {factor:.2f} ({f.get('attr')}, {int(age)} of {int(hl)} days)"]
    if exposed:
        why.append(f"+1 shown on {exposed} days without a correction")
    if stale:
        why.append("stale: older than its half-life")
    return {"level": "stale" if stale else level, "base": base, "score": round(BASE_SCORE[level] * factor, 3),
            "stale": stale, "exposed": exposed, "age_days": round(age, 1), "half_life": hl, "why": " · ".join(why)}


def order_key(f, t):
    """A total order for picking the winner among facts that disagree: level (stale last), then the most
    recent source, then the newest id. Deterministic, so the winner never flips between reads."""
    ts = f.get("confirmed_at") or f.get("source_ts") or f.get("captured_at") or ""
    return (RANK[t["level"]], _neg(ts), -int(f.get("id") or 0))


def _neg(ts):
    # newest first inside a tuple that sorts ascending
    try:
        return -parse_iso(ts).timestamp()
    except (TypeError, ValueError):
        return 0.0


def utcnow():
    return datetime.now(timezone.utc)
