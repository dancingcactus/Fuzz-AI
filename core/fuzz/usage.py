"""What each role run used, read from the client's own report, and the daily totals Settings links to.

Each client says it differently, and they aren't added together:
- Copilot ends a text run with a footer: "AI Credits 7.89 (42s)" and "Tokens ↑ 89.9k (61.6k cached, 22.2k
  written) • ↓ 510 (75 reasoning)". Credits are as the CLI reports them. The cached and written tokens are part of ↑.
- Claude Code (with --output-format json or stream-json) ends with a result object: total_cost_usd and usage.
  On a subscription the dollars are what the same tokens would cost on the API, not a bill.

Tokens are kept the same way for both: `in` is every input token, `cached` and `written` are the part of it read
from and written to the cache, `out` every output token, `reasoning` the part of it spent thinking.

Only the role runs (`fuzz run …`) are counted. The focus pass, evals and setup's connector discovery call the
client directly, and say nothing about what they used.
"""

import json
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta

from . import timeres
from .db import iso, parse_iso

TAIL_BYTES = 16384          # the footer or result is at the very end; extractor transcripts run to megabytes
NONE = {"none": True}       # looked, found nothing: the backfill doesn't read that transcript again

_NUM = r"([\d.,]+)\s*([km]?)"
CREDITS_RE = re.compile(r"^AI Credits\s+([\d.,]+)(?:\s*\(([^)]*)\))?\s*$", re.M)
TOKENS_RE = re.compile(r"^Tokens\s+↑\s*" + _NUM + r"(?:\s*\(" + _NUM + r" cached(?:,\s*" + _NUM + r" written)?\))?"
                       r"\s*•\s*↓\s*" + _NUM + r"(?:\s*\(" + _NUM + r" reasoning\))?\s*$", re.M)


def _n(num, suffix):
    """ "89.9" + "k" -> 89900. None when the group didn't match."""
    if num is None:
        return None
    v = float(num.replace(",", ""))
    return int(round(v * {"": 1, "k": 1e3, "m": 1e6}[suffix or ""]))


def _seconds(s):
    """ "42s", "11m 48s", "1h 2m 3s" -> seconds."""
    if not s:
        return None
    parts = re.findall(r"(\d+(?:\.\d+)?)\s*([hms])", s)
    if not parts:
        return None
    return int(round(sum(float(v) * {"h": 3600, "m": 60, "s": 1}[u] for v, u in parts)))


def parse_copilot(text):
    """The last footer in Copilot's text output, or None."""
    text = text or ""
    c = list(CREDITS_RE.finditer(text))
    t = list(TOKENS_RE.finditer(text))
    if not c and not t:
        return None
    out = {"source": "copilot", "credits": None, "cost_usd": None, "seconds": None,
           "in": None, "cached": None, "written": None, "out": None, "reasoning": None}
    if c:
        out["credits"] = float(c[-1].group(1).replace(",", ""))
        out["seconds"] = _seconds(c[-1].group(2))
    if t:
        g = t[-1].groups()
        out.update({"in": _n(g[0], g[1]), "cached": _n(g[2], g[3]), "written": _n(g[4], g[5]),
                    "out": _n(g[6], g[7]), "reasoning": _n(g[8], g[9])})
    return out


def parse_claude(text):
    """The last result object in Claude Code's json or stream-json output, or None."""
    for line in reversed((text or "").strip().splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if not isinstance(msg, dict) or msg.get("type") != "result":
            continue
        u = msg.get("usage") or {}
        fresh, read, wrote = (int(u.get(k) or 0) for k in
                              ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
        cost = msg.get("total_cost_usd")
        ms = msg.get("duration_ms")
        return {"source": "claude-code", "credits": None,
                "cost_usd": float(cost) if cost is not None else None,
                "seconds": int(round(ms / 1000)) if isinstance(ms, (int, float)) else None,
                "in": fresh + read + wrote, "cached": read, "written": wrote,
                "out": int(u.get("output_tokens") or 0), "reasoning": None}
    return None


PARSERS = {"copilot": parse_copilot, "claude-code": parse_claude}


def parse(client, text):
    """What a run used, from its output. Never raises: a report it can't read is None."""
    try:
        fn = PARSERS.get(client)
        return fn(text) if fn else None
    except Exception:   # noqa: BLE001 — a changed footer must not fail the run
        return None


def _tail(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - TAIL_BYTES))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return None


def record(core, run_id, used):
    with core.tx("system"):
        core.q("UPDATE runs SET usage=? WHERE id=?", (json.dumps(used or NONE), run_id))


def backfill(core):
    """Read the footer of every finished run that hasn't been read yet (runs from before this was recorded).
    Returns how many it read."""
    rows = core.all("SELECT id, client FROM runs WHERE user_id=? AND usage IS NULL AND finished_at IS NOT NULL "
                    "AND client IN ('copilot', 'claude-code')", (core.user_id,))
    found = []
    for r in rows:
        text = _tail(os.path.join(core.home, "runs", str(r["id"]), "transcript.log"))
        found.append((json.dumps(parse(r["client"], text) or NONE), r["id"]))
    if found:
        with core.tx("system"):
            core.conn.executemany("UPDATE runs SET usage=? WHERE id=?", found)
    return len(found)


FIELDS = ("credits", "cost_usd", "in", "cached", "written", "out", "reasoning", "seconds")


def _blank():
    return {"runs": 0, "measured": 0, **{k: 0 for k in FIELDS}}


def _add(acc, used):
    acc["runs"] += 1
    if not used or used.get("none"):
        return
    acc["measured"] += 1
    for k in FIELDS:
        if used.get(k) is not None:
            acc[k] += used[k]


def _round(acc):
    acc["credits"] = round(acc["credits"], 2)
    acc["cost_usd"] = round(acc["cost_usd"], 4)
    return acc


def daily(core, days=30):
    """Each of the last `days` local days, newest first, per client and per role within it. A day with no runs is
    still there, with zeros, so a chart has no gaps."""
    days = max(1, min(int(days), 366))
    backfill(core)
    tz = timeres.local_tz(core)
    today = core.now().astimezone(tz).date()
    first = today - timedelta(days=days - 1)
    since = datetime.combine(first, datetime.min.time(), tz) - timedelta(days=1)   # a margin for the zone
    rows = core.all("SELECT id, role, client, model, started_at, usage FROM runs WHERE user_id=? AND started_at>=? "
                    "AND client IN ('copilot', 'claude-code') ORDER BY id",
                    (core.user_id, iso(since)))
    by_day = defaultdict(lambda: defaultdict(lambda: {"total": _blank(), "roles": defaultdict(_blank)}))
    totals = defaultdict(_blank)
    for r in rows:
        d = parse_iso(r["started_at"]).astimezone(tz).date()
        if d < first:
            continue
        used = json.loads(r["usage"]) if r["usage"] else None
        c = by_day[d.isoformat()][r["client"]]
        _add(c["total"], used)
        _add(c["roles"][r["role"]], used)
        _add(totals[r["client"]], used)
    out = []
    for i in range(days):
        d = (today - timedelta(days=i)).isoformat()
        clients = {k: {"total": _round(v["total"]), "roles": {rk: _round(rv) for rk, rv in v["roles"].items()}}
                   for k, v in by_day.get(d, {}).items()}
        out.append({"date": d, "clients": clients})
    return {"days": out, "totals": {k: _round(v) for k, v in totals.items()}, "since": first.isoformat(),
            "today": today.isoformat(), "tz": timeres.tz_name(core),
            "counts": "role runs only: evals, the focus pass and setup's connector discovery aren't counted"}


def recent(core, limit=50):
    """The newest measured runs, for seeing which one cost what."""
    backfill(core)
    rows = core.all("SELECT id, role, client, model, trigger, started_at, finished_at, outcome, usage FROM runs "
                    "WHERE user_id=? AND client IN ('copilot', 'claude-code') ORDER BY id DESC LIMIT ?",
                    (core.user_id, int(limit)))
    out = []
    for r in rows:
        d = dict(r)
        u = json.loads(d.pop("usage")) if r["usage"] else None
        d["usage"] = None if not u or u.get("none") else u
        out.append(d)
    return out
