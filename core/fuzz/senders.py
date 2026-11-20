"""Who a sender is: a person, a bot, a list or a brand (docs/evals.md, "Senders"). No model: the same answer
every run, from what a message carries and what Fuzz already knows about the address.

  human  a person
  bot    a notifier, relay or no-reply address: nobody reads a reply (github-actions, a tracker sending as
         whoever commented, a Slack app)
  list   a distribution list or group you're addressed through (Grp-…, DL-…, …-all)
  brand  an organisation, newsletter or team inbox speaking as itself (hello@, "Nora at Leadwise", an internal
         comms mailbox)

classify() reads, in order: the relay rule (one address that has sent as several different people), the bot
signs in a name or address, the list signs, the directory (a person it found is a person; an address at your
own organisation it didn't find is a team mailbox), then bulk and brand signs, then whether the name looks
like a person's. When nothing decides, it's a person: hiding a real person from People and "waiting on" costs
more than showing a bot there.

The eval (`fuzz eval senders`) scores classify() on labelled senders: invented ones in eval_seeds/senders.json.
A run is an eval_runs row (surface "senders"), gated like any run on "nothing that was right went wrong"; its
meta holds the confusion table and how many people it took for something else.
"""

import json
import re
import time
from pathlib import Path

from . import evals, learning
from .db import FuzzError

SURFACE = "senders"
SEEDS = evals.SEEDS / "senders.json"
KINDS = ("human", "bot", "list", "brand")

NOREPLY = re.compile(r"(^|[.+_-])(no[-_]?reply|do[-_]?not[-_]?reply)([.+_-]|$)|^(mailer-daemon|postmaster|bounces?)$", re.I)
NOTIFY = re.compile(r"notif|alert|reminder|automat|relay|digest", re.I)
BOT_NAME = re.compile(r"\[bot\]|\bbot\b|notifier|\bdigests?\b|\((tracker|jira|confluence|github|wiki)\)$"
                      r"|^(slack|github|teams|zoom|jira)$", re.I)
CAMEL = re.compile(r"^[a-z]+[A-Z]\w*$")   # opsAgent: an account named like code (case matters here)
LIST_NAME = re.compile(r"^(grp|dl|org|gr)[-_ ]|[-_ ]all$|^all[A-Z]", re.I)
LIST_LOCAL = re.compile(r"^(dl|grp|gr)[-_]|-all$|^all-|^all[a-z]+$|-(eng|team|pm|leads|dev|ops|staff|group|list|users|"
                        r"insiders|regular|informed|watchers|hours|clinic|announce)$", re.I)
BULK_LOCAL = re.compile(r"^(news|newsletter|info|mail-info|hello|hi|marketing|updates?|team|grow|events?|support|"
                        r"caresupport|customerservice|breakingnews|messages|contact|promo|training|webinars?|"
                        r"communications|email|reply)$", re.I)
BULK_WORD = re.compile(r"newsletter|webcast|customerservice|marketing|promotions", re.I)
BULK_SUB = re.compile(r"^(e|em|email|emails|mail|m|r|news|reply|info|hello|team|marketing|notify|comms|campaign|go|now)\.",
                      re.I)
GROUP_WORDS = {"team", "newsletter", "digest", "news", "updates", "events", "marketing", "summit", "support",
               "notifications", "services", "service", "admin", "help", "community", "announcements", "careers",
               "management", "notification", "weekly", "daily", "systems", "technologies", "inc", "llc", "ltd",
               "center", "centre", "hub", "communications", "insiders", "sessions", "bakery"}
PERSONA = re.compile(r"\s(at|@)\s", re.I)
NAME = re.compile(r"[A-ZÀ-Þ][\w'’.-]*(?:,)?(?: [A-ZÀ-Þ][\w'’.-]*){1,3}")


def _letters(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def name_matches_address(name, local):
    """Whether a display name and an address's local part are the same person's: p + navarro, first.last, a
    surname alone. Accents and punctuation are dropped first."""
    import unicodedata
    plain = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    toks = [_letters(t) for t in re.split(r"[\s,]+", plain) if _letters(t)]
    lp = _letters(local)
    if not toks or not lp:
        return False
    if any(len(t) >= 3 and t[:4] in lp for t in toks):
        return True
    return len(toks) >= 2 and lp.startswith(toks[0][0]) and toks[-1][:3] in lp


def _bare(n):
    """A name without a relay's tag: "Sam Ortiz (Tracker)" is Sam Ortiz."""
    return re.sub(r"\s*\(.*\)$", "", n or "").strip()


def _tokens(s):
    """The words of a name or an address, lowercased, three letters or more."""
    return {w for w in re.findall(r"[a-z]{3,}", (s or "").lower())}


def _a_person(n):
    """Whether a name looks like a person's (two to four capitalised words, none a team or company word), so an
    address that sent as several of them is a relay; a brand sending as several campaigns isn't."""
    return bool(NAME.fullmatch(n)) and len(n.split()) <= 4 and not ({w.lower() for w in re.findall(r"[A-Za-z]+", n)} & GROUP_WORDS)


def _looks_like_a_name(local):
    """An address with no display name that reads as a person's: first.last, f.last."""
    return bool(re.fullmatch(r"[a-z]+([._][a-z]+)?\d*", local or "", re.I))


def classify(sender, seen=None, orgs=()):
    """(kind, why) for one sender: {name, email, slack_id}. seen: {directory: True|False|None, names: [other names
    this address has sent as]}. orgs: the person's own organisation domains (from their addresses)."""
    seen = seen or {}
    name = (sender.get("name") or "").strip()
    email = (sender.get("email") or "").strip().lower()
    local, _, domain = email.partition("@")
    if name.lower() == email:
        name = ""   # the address as its own name says nothing more
    words = {w.lower() for w in re.findall(r"[A-Za-z]+", name)}
    own = _tokens(_bare(name)) | _tokens(local.replace(".", " ")) | _tokens(domain.replace(".", " "))
    others = {_letters(_bare(n)) for n in seen.get("names") or []
              if _a_person(_bare(n)) and not (_tokens(_bare(n)) & own)} - {_letters(_bare(name))}

    if email and len(others) >= 2:
        return "bot", "the address has sent as several different people"
    if BOT_NAME.search(name) or (not email and CAMEL.match(name)):
        return "bot", "the name is a bot's"
    if local and (NOREPLY.search(local) or NOREPLY.search(domain.split(".")[0])):
        return "bot", "a no-reply address"
    if local and NOTIFY.search(local):
        return "bot", "a notification address"
    if LIST_NAME.search(name) or (local and LIST_LOCAL.search(local)):
        return "list", "named like a list"
    if seen.get("directory") is True:
        return "human", "the directory knows them"
    if email and seen.get("directory") is False and domain in orgs:
        return "brand", "at your organisation but not in its directory"
    if PERSONA.search(name):
        return "brand", "someone at a company: a marketing sender"
    if local and (BULK_LOCAL.search(local) or BULK_WORD.search(local) or (domain.count(".") >= 2 and BULK_SUB.search(domain))):
        return "brand", "a bulk or company mailbox"
    if words & GROUP_WORDS:
        return "brand", "the name is a team's or a company's"
    if not email:
        if sender.get("slack_id"):
            return "human", "a Slack user"
        return "human", "a name" if " " in name else "a first name"
    if not name:
        return ("human", "the address is a name") if _looks_like_a_name(local) else ("brand", "an address with no name")
    if name_matches_address(name, local):
        return "human", "the name matches the address"
    if name_matches_address(name, domain.split(".")[-2] if "." in domain else domain):
        return "brand", "the name is the company's domain"
    return "human", "nothing says otherwise"


# ---- the eval

def global_cases(path=None):
    p = Path(path) if path else SEEDS
    if not p.exists():
        return []
    data = json.loads(p.read_text())
    if data.get("format", 1) not in evals.FORMATS:
        raise FuzzError(f"{p.name} is format {data.get('format')}", "format")
    return data["cases"]


def score(cases, orgs):
    """[{key, kind, got, why, passed}] per case, and the confusion table {expected: {got: n}}."""
    out, table = [], {k: {g: 0 for g in KINDS} for k in KINDS}
    for c in cases:
        got, why = classify(c["sender"], c.get("seen"), orgs)
        table[c["kind"]][got] += 1
        out.append({"key": f"seed:{c['name']}", "kind": c["kind"], "got": got, "why": why, "passed": got == c["kind"],
                    "input": {"sender": c["sender"], "seen": c.get("seen")}})
    return out, table


def run(core, sets="all", against=None, path=None):
    """Score the labelled senders and record the run."""
    if sets not in evals.SETS:
        raise FuzzError(f"set is one of {', '.join(evals.SETS)}", "set")
    if sets == "personal":
        raise FuzzError("no personal sender labels yet: run the global set", "set")
    started = time.monotonic()
    cases = global_cases(path)
    if not cases:
        raise FuzzError("no labelled senders: add eval_seeds/senders.json", "cases")
    scored, table = score(cases, orgs=("acme.example",))   # the seeds' person is alex@acme.example
    results = [{"key": r["key"], "case_id": None, "origin": r["key"], "scope": "global", "kind": r["kind"],
                "fp": evals.fingerprint(r["input"], {"kind": r["kind"]}), "passes": int(r["passed"]), "runs": 1,
                "passed": r["passed"], "got": r["got"], "why": r["why"]} for r in scored]
    hidden = sum(1 for r in scored if r["kind"] == "human" and r["got"] != "human")
    meta = {"confusion": {"global": table}, "people_hidden": {"global": hidden}}
    base = evals.get_run(core, against) if against else evals.baseline(core, SURFACE)
    rid = evals.record(core, SURFACE, results, base, skill_version="rules", skill_copy="senders", client="rules",
                       model=None, repeats=1, lessons=learning.lessons_for(core, SURFACE), sets=sets,
                       seconds=round(time.monotonic() - started, 1), meta=meta)
    return evals.get_run(core, rid)


def summary(core, run):
    meta = json.loads(run["meta"]) if isinstance(run.get("meta"), str) else (run.get("meta") or {})
    base = evals.summary(core, run)
    out = {k: base[k] for k in ("run", "set", "passing", "against", "gate", "regressions", "seconds",
                                "changed", "fixed", "broke") if k in base}
    out["people_hidden"] = meta.get("people_hidden")
    out["confusion"] = meta.get("confusion")
    out["wrong"] = [{"case": r["origin"], "should_be": r["kind"], "got": r["got"], "because": r["why"]}
                    for r in run["results"] if not r["passed"]]
    return out
