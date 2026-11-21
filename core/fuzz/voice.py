"""How you write: your own messages, as examples the executor reads before it drafts (docs/voice.md).

Where the examples come from:
  - writing_samples: messages you wrote, as the extractor read them from your sent mail and your Slack
    (submit_writing_samples), each only your own words: the quoted thread and the signature block are cut.
  - drafts you edited before they went out: what you sent, with what Fuzz had written beside it.

A draft you approved as written is Fuzz's writing, not yours, so it never counts: it's left out when it comes
back from your sent folder (by the link the sender reported, or the same words), or Fuzz would learn from itself.

Which examples a draft gets (examples()): the channel decides first (email or Slack). Then your messages to the
same person (or the same Slack channel), then to the same audience (one person or a group, inside the company
or outside it). What the new message is about only orders examples within a tier: an old message on the same
topic tends to get its facts copied into the new one.

style(): a few counted lines per audience (how long, greeting, sign-off, formatting), worked out with no model.

All of it stays in the local store. writing_samples is a plain table, not events: replay doesn't touch it, and
turning voice off (config voice.enabled) stops it being read or asked for.
"""

import json
import re
import statistics
from collections import Counter
from datetime import timedelta

import jsonschema

from .db import FuzzError, parse_iso
from .matching import entities
from .matching.vectors import STOP

MAX_TEXT = 4000      # characters kept of one message
MIN_WORDS = 2
WANT = 40            # samples Fuzz asks the extractor to read back for, from your sent mail and Slack
ASK_EVERY = timedelta(days=1)
STYLE_MIN = 5        # messages an audience needs before Fuzz describes how you write to it
POOL = 1500          # the newest samples a choice looks through

PERSON = {"type": "object", "properties": {"name": {"type": "string", "maxLength": 200},
                                           "email": {"type": "string", "maxLength": 320},
                                           "slack_id": {"type": "string", "maxLength": 40}},
          "additionalProperties": False}
SAMPLE = {
    "type": "object",
    "required": ["source", "source_id", "ts", "text"],
    "properties": {
        "source": {"enum": ["email", "slack"]},
        "source_id": {"type": "string", "minLength": 1, "maxLength": 500},
        "ts": {"type": "string", "pattern": r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$"},
        "text": {"type": "string", "minLength": 1, "maxLength": 20000},
        "to": {"type": "array", "items": PERSON, "maxItems": 100},
        "place": {"type": "string", "maxLength": 200},   # a Slack channel's name or ID; none for a DM or an email
        "link": {"type": "string", "maxLength": 2000},
    },
    "additionalProperties": False,
}

GREETING = re.compile(r"^\s*(hi|hello|hey|dear|good (morning|afternoon)|morning)\b[^\n]{0,40}", re.I)
SIGNOFF = re.compile(r"(?:^|\n)\s*(thanks|thank you|thx|best|cheers|regards|talk soon|ty)\b[^\n]{0,20}\s*(\n[^\n]{0,40})?\s*$",
                     re.I)
MARKUP = re.compile(r"(\*\*[^*]+\*\*|^#{1,6} |^\s*[-*•] |^\s*\d+[.)] )", re.M)
EMOJI = re.compile(r"(:[a-z0-9_+-]+:|[\U0001F300-\U0001FAFF☀-➿])")
EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")

# where your own words end in a sent email: the quoted thread, a forward, the signature block
CUT = [re.compile(p, re.I | re.M) for p in (
    r"^\s*On .{4,200}(wrote|écrit|schrieb):?\s*$",
    r"^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}",
    r"^\s*_{8,}\s*$",
    r"^\s*From:\s.+\n\s*(Sent|Date):\s",
    r"^\s*Begin forwarded message:",
    r"^--\s*$",
    r"^\s*Sent from my (iPhone|iPad|phone|Android)",
    r"^\s*Get Outlook for ",
)]


def enabled(core):
    return bool((core.config.get("voice") or {}).get("enabled", True))


# ---- cleaning and taking samples in

def clean(text):
    """Only your own words: cut at the quoted thread, a forward or the signature marker, drop > lines."""
    text = (text or "").replace("\r\n", "\n")
    end = len(text)
    for p in CUT:
        m = p.search(text)
        if m and m.start() < end:
            end = m.start()
    lines = [ln for ln in text[:end].split("\n") if not ln.lstrip().startswith(">")]
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return out[:MAX_TEXT].rstrip()


def _norm(text):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", (text or "").lower())).strip()


def _fuzz_wrote(core):
    """What came from Fuzz: the links the sender reported, and the words of every draft that went out
    (as written, or as you edited it, which comes in from the drafts side with its pair instead)."""
    links = set()
    for e in core.all("SELECT payload FROM events WHERE user_id=? AND type='task.sent'", (core.user_id,)):
        p = json.loads(e["payload"]) if isinstance(e["payload"], str) else e["payload"]
        if (p.get("data") or {}).get("link"):
            links.add(p["data"]["link"])
    bodies = [_norm(d["body"]) for d in core.all(
        "SELECT body FROM drafts WHERE user_id=? AND status IN ('approved', 'sent') AND kind NOT LIKE 'calendar%' "
        "AND kind != 'note' AND body IS NOT NULL", (core.user_id,))]
    return links, [b for b in bodies if b]


def _is_fuzz(text, link, links, bodies):
    if link and link in links:
        return True
    a = _norm(text)
    return any(a == b or (len(b) >= 30 and (b in a or a in b)) for b in bodies)


def submit(core, samples, no_more=False):
    """Store messages you wrote. Returns counts; refuses a malformed sample by its exact field."""
    if not isinstance(samples, list):
        raise FuzzError("samples must be a JSON array", "samples")
    if len(samples) > 200:
        raise FuzzError("Send at most 200 samples per call", "samples")
    v = jsonschema.Draft202012Validator(SAMPLE)
    for i, s in enumerate(samples):
        errs = sorted(v.iter_errors(s), key=lambda e: list(e.absolute_path))
        if errs:
            e = errs[0]
            field = f"samples[{i}]" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in e.absolute_path)
            raise FuzzError(f"{field}: {e.message}", field)
    out = {"saved": 0, "fuzz_wrote": 0, "too_short": 0}
    if not enabled(core):
        return dict(out, off=True)
    links, bodies = _fuzz_wrote(core)
    me = core.config.get("me") or {}
    for s in samples:
        text = clean(s["text"])
        if len(text.split()) < MIN_WORDS:
            out["too_short"] += 1
            continue
        if _is_fuzz(text, s.get("link"), links, bodies):
            out["fuzz_wrote"] += 1
            continue
        to = [p for p in s.get("to") or [] if not entities._is_me(p, me)]
        core.q("INSERT OR REPLACE INTO writing_samples (user_id, source, source_id, ts, recipients, place, text, link, "
               "added_at) VALUES (?,?,?,?,?,?,?,?,?)",
               (core.user_id, s["source"], s["source_id"], s["ts"], json.dumps(to), s.get("place"), text,
                s.get("link"), core.now_iso()))
        out["saved"] += 1
    if no_more:
        _state(core, done_at=core.now_iso())
    out["have"] = count(core)
    return out


def count(core):
    return core.one("SELECT COUNT(*) n FROM writing_samples WHERE user_id=?", (core.user_id,))["n"]


def _state(core, **kw):
    row = core.one("SELECT asked_at, done_at FROM voice_state WHERE user_id=?", (core.user_id,)) or {}
    row = {"asked_at": row.get("asked_at"), "done_at": row.get("done_at"), **kw}
    core.q("INSERT OR REPLACE INTO voice_state (user_id, asked_at, done_at) VALUES (?,?,?)",
           (core.user_id, row["asked_at"], row["done_at"]))
    return row


def wanted(core):
    """What the extractor should read back for this run, once a day until Fuzz has WANT samples or you have no
    older messages: {count, before}. None when there's nothing to ask."""
    if not enabled(core):
        return None
    have = count(core)
    if have >= WANT:
        return None
    st = core.one("SELECT asked_at, done_at FROM voice_state WHERE user_id=?", (core.user_id,)) or {}
    if st.get("done_at"):
        return None
    if st.get("asked_at") and core.now() - parse_iso(st["asked_at"]) < ASK_EVERY:
        return None
    _state(core, asked_at=core.now_iso())
    oldest = core.one("SELECT MIN(ts) ts FROM writing_samples WHERE user_id=?", (core.user_id,))["ts"]
    return {"count": WANT - have, "before": oldest or core.now_iso()}


def forget(core):
    """Delete every stored sample (Settings, "Forget my messages"). Fuzz may ask to read back again."""
    n = count(core)
    core.q("DELETE FROM writing_samples WHERE user_id=?", (core.user_id,))
    core.q("DELETE FROM voice_state WHERE user_id=?", (core.user_id,))
    return n


# ---- who a message is to, and its audience

def parse_target(target, kind=None):
    """A draft's "to" as the person would say it: ("email" | "slack", [people], place)."""
    target = (target or "").strip()
    channel = "slack" if (kind or "").startswith(("slack", "nudge.slack")) or target.lower().startswith("slack") \
        or target.startswith("#") else "email"
    place = None
    m = re.search(r"#([\w.-]+)", target)
    if m:
        place = m.group(1)
    people = [{"email": e.lower()} for e in EMAIL.findall(target)]
    rest = re.sub(r"<[^>]*>|" + EMAIL.pattern, "", target)
    rest = re.sub(r"(?i)^\s*slack\b(\s*(dm|message)\s*(with|to)?)?", "", rest)
    rest = re.sub(r"#[\w.-]+", "", rest)
    names = [n.strip(" ,;:()\"'") for n in re.split(r",|;|\band\b|&", rest)]
    names = [n for n in names if n and not n.lower().startswith(("channel", "thread", "the "))]
    if people and len(names) == len(people):
        people = [dict(p, name=n) for p, n in zip(people, names)]
    elif not people:
        people = [{"name": n} for n in names]
    return channel, people, place


def _ids(core, person):
    """Every way a person is known: email addresses, Slack IDs and full names (lowercased)."""
    out = set()
    for k in ("email", "slack_id"):
        if person.get(k):
            out.add(person[k].lower())
    if person.get("name") and len(person["name"].split()) > 1:
        out.add(person["name"].strip().lower())
    eid = entities.lookup_person(core, person)
    if eid:
        for r in core.all("SELECT value FROM identifiers WHERE user_id=? AND entity_id=?", (core.user_id, eid)):
            out.add(str(r["value"]).lower())
        for r in core.all("SELECT alias FROM aliases WHERE entity_id=?", (eid,)):
            if len(str(r["alias"]).split()) > 1:
                out.add(str(r["alias"]).lower())
    return out


def _sample_ids(to):
    out = set()
    for p in to:
        for k in ("email", "slack_id"):
            if p.get(k):
                out.add(p[k].lower())
        if p.get("name") and len(p["name"].split()) > 1:
            out.add(p["name"].strip().lower())
    return out


def _my_domains(core):
    return {e.split("@")[1].lower() for e in (core.config.get("me") or {}).get("emails", []) if "@" in e}


def audience(core, channel, to, place=None):
    """(channel, reach, side): reach is one (one person) or group; side is inside or outside the company,
    or None when no email tells. Slack is inside."""
    reach = "group" if place or len(to) > 1 else "one"
    if channel == "slack":
        return channel, reach, "inside"
    mine = _my_domains(core)
    emails = [p["email"].lower() for p in to if p.get("email")]
    if not emails:
        for p in to:
            eid = entities.lookup_person(core, p)
            if eid:
                emails += [r["value"].lower() for r in core.all(
                    "SELECT value FROM identifiers WHERE user_id=? AND entity_id=? AND type='email'", (core.user_id, eid))]
    if not emails or not mine:
        return channel, reach, None
    return channel, reach, "inside" if all(e.split("@")[-1] in mine for e in emails) else "outside"


SIDE = {"inside": "inside the company", "outside": "outside the company"}


def describe(aud):
    channel, reach, side = aud
    who = "one person" if reach == "one" else "a group"
    where = "by email" if channel == "email" else "on Slack"
    return f"To {who}{' ' + SIDE[side] if side and channel == 'email' else ''}, {where}"


# ---- the samples

def samples(core, before=None, leave_out=()):
    """Your messages, newest first: {text, ts, channel, to, place, origin, fuzz_wrote?}. before: only ones
    written before this time; leave_out: texts never to use (an eval's own reference)."""
    if not enabled(core):
        return []
    skip = {_norm(t) for t in leave_out if t}
    out = []
    for r in core.all("SELECT source, source_id, ts, recipients, place, text FROM writing_samples WHERE user_id=? "
                      + ("AND ts<? " if before else "") + "ORDER BY ts DESC LIMIT ?",
                      (core.user_id, before, POOL) if before else (core.user_id, POOL)):
        to = json.loads(r["recipients"]) if isinstance(r["recipients"], str) else (r["recipients"] or [])
        out.append({"text": r["text"], "ts": r["ts"], "channel": r["source"], "to": to, "place": r["place"],
                    "origin": f"{r['source']}:{r['source_id']}"})
    out += _edited_drafts(core, before)
    out = [s for s in out if _norm(s["text"]) not in skip]
    return sorted(out, key=lambda s: s["ts"] or "", reverse=True)


def _edited_drafts(core, before=None):
    from . import draft_evals
    when = {d["id"]: d["approved_at"] or d["created_at"] for d in core.all(
        "SELECT id, approved_at, created_at FROM drafts WHERE user_id=?", (core.user_id,))}
    out = []
    for h in draft_evals.history(core):
        if not h["edited"] or not h["sent"] or h["kind"].startswith("wiki"):
            continue
        ts = when.get(h["draft_id"])
        if before and (not ts or ts >= before):
            continue
        channel, to, place = parse_target(h["to"], h["kind"])
        text = clean(h["sent"])
        if len(text.split()) >= MIN_WORDS:
            out.append({"text": text, "ts": ts, "channel": channel, "to": to, "place": place,
                        "origin": f"draft:{h['draft_id']}", "fuzz_wrote": h["wrote"]})
    return out


def _words(text):
    return {w for w in re.findall(r"[a-z0-9']+", (text or "").lower()) if w not in STOP and len(w) > 2}


def _overlap(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def examples(core, to, kind=None, about=None, n=3, before=None, leave_out=()):
    """Up to n of your messages to show the executor before it drafts this one, with how you write to this
    audience. {examples: [{text, to, when, why, fuzz_wrote?}], style: [lines], audience, note?}."""
    if not enabled(core):
        return {"examples": [], "style": [], "note": "The person turned this off: write plainly and briefly."}
    channel, people, place = parse_target(to, kind)
    pool = [s for s in samples(core, before, leave_out) if s["channel"] == channel]
    aud = audience(core, channel, people, place)
    want = set().union(*[_ids(core, p) for p in people]) if people else set()
    topic = _words(about)

    def same_person(s):
        if place:
            return bool(s["place"]) and s["place"].lstrip("#").lower() == place.lower()
        # a group email to them isn't how you write to them alone
        return bool(want & _sample_ids(s["to"])) and len(s["to"]) <= max(len(people), 1)

    def rank(s):
        return (_overlap(topic, _words(s["text"])), s["ts"] or "")

    tier1 = sorted([s for s in pool if same_person(s)], key=rank, reverse=True)
    picked = tier1[:n]
    seen = {id(s) for s in picked}
    if len(picked) < n:
        same = [s for s in pool if id(s) not in seen and _same_audience(core, s, aud)]
        picked += sorted(same, key=rank, reverse=True)[:n - len(picked)]
    pairs = [s for s in picked if s.get("fuzz_wrote")]
    if len(pairs) > 1:   # one before-and-after is enough to show the gap; the rest are plain examples
        picked = [s for s in picked if not s.get("fuzz_wrote") or s is pairs[0]]
    out = []
    for s in picked:
        mine = s in tier1
        ex = {"text": s["text"], "to": _display(s), "when": (s["ts"] or "")[:10],
              "why": ("Their message to the same person" if not place else "Their message in the same channel")
              if mine else describe(aud)}
        if s.get("fuzz_wrote"):
            ex["fuzz_wrote"] = s["fuzz_wrote"]
        out.append(ex)
    res = {"examples": out, "style": style(core, aud, before=before, leave_out=leave_out, pool=pool),
           "audience": describe(aud)}
    if not out:
        res["note"] = "No messages of theirs to this audience yet: write plainly and briefly."
    return res


def _aud(core, s):
    if "aud" not in s:   # worked out once per sample: it may look people up
        s["aud"] = audience(core, s["channel"], s["to"], s["place"])
    return s["aud"]


def _same_audience(core, s, aud):
    a = _aud(core, s)
    return a[:2] == aud[:2] and (aud[2] is None or a[2] is None or a[2] == aud[2])


def _display(s):
    if s["place"]:
        return f"#{s['place'].lstrip('#')}"
    names = [p.get("name") or p.get("email") or p.get("slack_id") for p in s["to"]]
    names = [x for x in names if x]
    return ", ".join(names[:3]) + (f" and {len(names) - 3} more" if len(names) > 3 else "") if names else "someone"


# ---- how you write to an audience, counted

def form(text):
    g = GREETING.match(text or "")
    s = SIGNOFF.search(text or "")
    return {"words": len((text or "").split()), "greeting": g.group(1).lower() if g else None,
            "signoff": s.group(1).lower() if s else None, "markup": bool(MARKUP.search(text or "")),
            "question": "?" in (text or ""), "exclaim": "!" in (text or ""), "emoji": bool(EMOJI.search(text or "")),
            "lower_start": bool(re.match(r"^\s*[a-z]", text or ""))}


def _share(n, m):
    return f"{n} of {m}"


def style(core, aud, before=None, leave_out=(), pool=None):
    """A few lines on how the person writes to this audience, from STYLE_MIN messages or more; [] with fewer."""
    if pool is None:
        pool = [s for s in samples(core, before, leave_out) if s["channel"] == aud[0]]
    mine = [s for s in pool if _same_audience(core, s, aud) and not s.get("fuzz_wrote")][:50]
    m = len(mine)
    if m < STYLE_MIN:
        return []
    forms = [form(s["text"]) for s in mine]
    words = int(statistics.median(f["words"] for f in forms))
    lines = [f"{describe(aud)}, from {m} of their messages.", f"Usually about {words} words."]
    greet = Counter(f["greeting"] for f in forms if f["greeting"])
    n = sum(greet.values())
    if n * 2 >= m:
        lines.append(f"They open with a greeting in {_share(n, m)}, most often “{greet.most_common(1)[0][0].capitalize()}”.")
    else:
        lines.append("They never open with a greeting." if not n else f"They rarely open with a greeting ({_share(n, m)}).")
    sign = Counter(f["signoff"] for f in forms if f["signoff"])
    n = sum(sign.values())
    if n * 2 >= m:
        lines.append(f"They sign off in {_share(n, m)}, most often “{sign.most_common(1)[0][0].capitalize()}”.")
    else:
        lines.append("They never sign off." if not n else f"They rarely sign off ({_share(n, m)}).")
    n = sum(f["markup"] for f in forms)
    lines.append(f"Bullets, numbers or bold in {_share(n, m)}." if n * 4 >= m else "Plain sentences: no bullets or bold.")
    n = sum(f["lower_start"] for f in forms)
    if n * 2 >= m:
        lines.append(f"They often start in lower case ({_share(n, m)}).")
    n = sum(f["exclaim"] for f in forms)
    if n * 3 >= m:
        lines.append(f"Exclamation marks in {_share(n, m)}.")
    n = sum(f["emoji"] for f in forms)
    if n * 4 >= m:
        lines.append(f"Emoji in {_share(n, m)}.")
    return lines


def overview(core):
    """For Settings: whether it's on, how many messages Fuzz has, and how you write to each audience."""
    pool = samples(core) if enabled(core) else []
    auds = Counter(_aud(core, s) for s in pool if not s.get("fuzz_wrote"))
    profiles = []
    for aud, n in auds.most_common():
        lines = style(core, aud, pool=[s for s in pool if s["channel"] == aud[0]])
        if lines:
            profiles.append({"audience": describe(aud), "messages": n, "lines": lines[1:], "summary": lines[0]})
    return {"enabled": enabled(core), "messages": count(core),
            "edited_drafts": sum(1 for s in pool if s.get("fuzz_wrote")), "profiles": profiles,
            "want": WANT}
