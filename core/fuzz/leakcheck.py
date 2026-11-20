"""The repo leak check: nothing from your store goes into a commit, a test or a PR.

This repo is public. The store holds the people you work with, their addresses and your employer's domain, and
it's easy for one to slip into a test fixture, a commit message or a PR body while chasing a bug. This compares
what you're about to publish with the store, the same comparison copies.leaks makes for invented eval cases:

  - full names, surnames, organisations, multi-word aliases and codes from your entities
  - every email address, Slack ID and non-example domain from your identifiers
  - your own names, emails and Slack IDs from config.json
  - anything in <store>/leakcheck-terms.txt (one per line: an employer, a project codename, a street)
  - and, with or without a store, any email address off the reserved example domains

The store is opened read-only: a git hook never migrates, writes to or locks it. False positives (a colleague's
surname that is also an everyday word) go in <store>/leakcheck-allow.txt, never in the repo, since the list
itself would name them.

  python -m fuzz.leakcheck --staged          # pre-commit: lines the commit adds
  python -m fuzz.leakcheck --message FILE    # commit-msg
  python -m fuzz.leakcheck --range A..B      # pre-push: every commit's message and added lines
  python -m fuzz.leakcheck --all             # every tracked file, as it stands
  python -m fuzz.leakcheck --files - < body  # anything else: a PR body, an issue, a comment
  python -m fuzz.leakcheck --claude-hook     # Claude Code PreToolUse: blocks `gh pr create` with a leaky body

Exits 1 when it finds something (2 as a Claude Code hook), 0 when it's clean. .githooks/ and .claude/settings.json
call it; `git config core.hooksPath .githooks` turns the git hooks on.
"""

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys

from . import config as config_mod
from .copies import EMAIL_RE, GROUP_WORDS, _known, _reserved
from .db import default_home

TERMS_FILE = "leakcheck-terms.txt"
ALLOW_FILE = "leakcheck-allow.txt"
# addresses that are fine in a public repo: commit trailers and GitHub's own
SAFE_EMAILS = re.compile(r"^[a-z0-9._+-]*(no-?reply|notifications?)[a-z0-9._+-]*@", re.I)
SKIP_FILES = re.compile(r"(^|/)(uv\.lock|package-lock\.json)$|\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|db|sqlite)$", re.I)


class ReadOnlyStore:
    """Just enough of Core for copies._known: .all, .user_id, .config. Never writes."""

    def __init__(self, home, user_id=None):
        self.home = home
        self.user_id = int(user_id or os.environ.get("FUZZ_USER") or 1)
        path = os.path.join(home, "fuzz.db")
        self.conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        self.conn.row_factory = sqlite3.Row

    @property
    def config(self):
        return config_mod.load(self.home)

    def all(self, sql, args=()):
        return [dict(r) for r in self.conn.execute(sql, args).fetchall()]

    def close(self):
        self.conn.close()


def _lines(path):
    try:
        with open(path, encoding="utf-8") as f:
            return [ln.strip() for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
    except FileNotFoundError:
        return []


# Public on any repo: well-known domains and the vocabulary of this codebase, which turn up in a store as orgs
# and codes. Nothing personal goes here; that's what <store>/leakcheck-allow.txt is for.
PUBLIC = {"github.com", "google.com", "gmail.com", "linkedin.com", "slack.com", "microsoft.com", "outlook.com",
          "office.com", "apple.com", "icloud.com", "anthropic.com", "claude.ai", "openai.com", "zoom.us",
          "youtube.com", "amazon.com", "atlassian.net", "atlassian.com", "notion.so", "figma.com",
          "mcp", "api", "apis", "url", "json", "http", "https", "sql", "llm", "cli", "sdk", "ios", "npm", "css",
          "html", "pdf", "csv", "uuid", "oauth", "sso", "faq", "eta", "eod", "eow", "asap", "fyi", "tbd", "okr",
          "okrs", "kpi", "kpis", "qbr", "wiki", "todo", "pto", "ooo", "ux", "ui", "ai", "pr", "prs", "ci", "qa",
          "github", "google", "slack", "gmail", "outlook", "claude", "anthropic", "linkedin", "microsoft", "zoom",
          "technologies", "webinar", "webinars", "teams", "jira", "confluence", "notion", "figma", "playwright", "launchd", "sqlite"}


def _common_words():
    """Lowercase dictionary words: 'Center' or 'Change' as the last word of a 'person' is a page, not a surname.
    Capitalised dictionary entries are proper names, so they're left out of this set and stay flagged."""
    try:
        with open("/usr/share/dict/words", encoding="utf-8") as f:
            return {w.strip() for w in f if w.strip().islower()}
    except OSError:
        return set()


def _public(value):
    """A well-known domain or one under it (a no-reply subdomain), or a no-reply sender: public, whoever's store."""
    v = value.lower()
    if SAFE_EMAILS.match(v):
        return True
    host = v.split("@", 1)[-1].split("/", 1)[0]
    return v in PUBLIC or any(host == d or host.endswith("." + d) for d in PUBLIC if "." in d)


def _ordinary(value, words):
    """A term made only of everyday words, numbers and public names: flagging it would bury the real leaks."""
    toks = re.findall(r"[a-z0-9]+", value.lower())
    if not any(re.search(r"[a-z]", t) for t in toks):
        return True                                    # "1:1", "2024"
    return all(t in words or t.rstrip("s") in words or t in PUBLIC or t in GROUP_WORDS or t.isdigit()
               for t in toks)


def load_terms(home=None, user_id=None):
    """(terms, note): terms is [(what, value, whole_word)]. note says what was missing, if anything."""
    home = home or default_home()
    terms, note = [], None
    if os.path.exists(os.path.join(home, "fuzz.db")):
        try:
            store = ReadOnlyStore(home, user_id)
            try:
                terms = _known(store)
            finally:
                store.close()
        except sqlite3.Error as e:
            note = f"couldn't read the store at {home} ({e}); checked addresses and leakcheck-terms.txt only"
    else:
        note = f"no store at {home}; checked addresses and leakcheck-terms.txt only"
    terms += [("private term", t, True) for t in _lines(os.path.join(home, TERMS_FILE))]
    allow = {a.lower() for a in _lines(os.path.join(home, ALLOW_FILE))}
    words = _common_words()
    seen, out = set(), []
    for what, value, whole in terms:
        v = (value or "").strip().lower()
        if _public(v):
            continue
        # your own names and addresses, identifiers and your private list are always checked; names inferred
        # from entities are checked unless they're everyday words
        if what not in ("you", "private term", "email", "slack", "domain") and whole and _ordinary(v, words):
            continue
        if len(v) >= 3 and v not in seen and v not in allow:
            seen.add(v)
            out.append((what, value.strip(), whole))
    return out, note


def _matcher(terms):
    """One compiled pass per kind instead of one regex per term per line: a store has thousands of terms."""
    whole = [re.escape(v.lower()) for _, v, w in terms if w]
    part = [re.escape(v.lower()) for _, v, w in terms if not w]
    pats = []
    if whole:
        pats.append(re.compile(r"(?<![a-z0-9])(" + "|".join(sorted(whole, key=len, reverse=True)) + r")(?![a-z0-9])"))
    if part:
        pats.append(re.compile("(" + "|".join(sorted(part, key=len, reverse=True)) + ")"))
    kind = {v.lower(): what for what, v, _ in terms}
    return pats, kind


def scan(items, terms, allow=()):
    """items: [(where, text)]. Returns [(where, finding)], one per term per item."""
    pats, kind = _matcher(terms)
    allow = {a.lower() for a in allow}
    out = []
    for where, text in items:
        low = (text or "").lower()
        hits = set()
        for p in pats:
            hits.update(m.group(1) for m in p.finditer(low))
        for h in sorted(hits):
            k = kind.get(h, "term")
            out.append((where, f"{'an' if k[0] in 'aeio' else 'a'} {k} from your store: {h}"))
        for m in EMAIL_RE.finditer(text or ""):
            addr = m.group(0)
            if (not _reserved(m.group(1)) and not _public(addr) and addr.lower() not in hits
                    and addr.lower() not in allow):
                out.append((where, f"an address off the example domains: {addr}"))
    return out


# ---- what to scan

def _git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def added_lines(diff):
    """[(file:line, text)] for each line a unified diff adds."""
    out, path, n = [], None, 0
    for ln in diff.splitlines():
        if ln.startswith("+++ "):
            path = ln[6:] if ln.startswith("+++ b/") else None
        elif ln.startswith("@@"):
            m = re.search(r"\+(\d+)", ln)
            n = int(m.group(1)) if m else 0
        elif path and not SKIP_FILES.search(path):
            if ln.startswith("+"):
                out.append((f"{path}:{n}", ln[1:]))
                n += 1
            elif not ln.startswith("-"):
                n += 1
    return out


def message_lines(text, where="commit message"):
    """A commit message as git will keep it: without the # comment block or the verbose diff below it."""
    keep = []
    for ln in text.splitlines():
        if ln.startswith("# ------------------------ >8"):
            break
        if not ln.startswith("#"):
            keep.append(ln)
    return [(f"{where}:{i}", ln) for i, ln in enumerate(keep, 1) if ln.strip()]


def staged():
    return added_lines(_git("diff", "--cached", "--unified=0", "--no-color", "--no-ext-diff"))


def commit_range(rng):
    """rng is rev-list arguments: "A..B", or "SHA --not --remotes" for a branch the remote hasn't seen."""
    items = []
    for sha in _git("rev-list", "--no-merges", *rng.split()).split():
        short = sha[:9]
        items += message_lines(_git("log", "-1", "--format=%B", sha), f"{short} message")
        diff = _git("show", "--format=", "--unified=0", "--no-color", "--no-ext-diff", sha)
        items += [(f"{short} {w}", t) for w, t in added_lines(diff)]
    return items


def tracked():
    items = []
    for path in _git("ls-files").splitlines():
        if SKIP_FILES.search(path) or not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                items += [(f"{path}:{i}", ln) for i, ln in enumerate(f, 1)]
        except UnicodeDecodeError:
            continue
    return items


PUBLISHING = re.compile(r"\bgh\s+(pr|issue|release)\s+(create|edit|comment|review)\b|\bgh\s+api\b.*\b(body|title)=")


def claude_hook(payload):
    """A Claude Code PreToolUse hook on Bash: what a `gh pr create` or `gh issue comment` would publish (the
    command line and any --body-file / -F file), which no git hook sees. [] when it's not publishing."""
    cmd = ((payload or {}).get("tool_input") or {}).get("command") or ""
    if not PUBLISHING.search(cmd):
        return []
    items = [(f"gh command:{i}", ln) for i, ln in enumerate(cmd.splitlines(), 1)]
    cwd = (payload or {}).get("cwd") or os.getcwd()
    for m in re.finditer(r"(?:--body-file|-F)[=\s]+(\"[^\"]+\"|'[^']+'|\S+)", cmd):
        path = os.path.join(cwd, os.path.expanduser(m.group(1).strip("'\"")))
        try:
            with open(path, encoding="utf-8") as f:
                items += [(f"{m.group(1)}:{i}", ln) for i, ln in enumerate(f.read().splitlines(), 1)]
        except OSError:
            pass
    return items


def main(argv=None):
    p = argparse.ArgumentParser(prog="fuzz.leakcheck", description="Check text for anything from your store.")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--staged", action="store_true", help="the lines the staged commit adds")
    g.add_argument("--message", metavar="FILE", help="a commit message file")
    g.add_argument("--range", metavar="REVS", help="rev-list arguments, e.g. A..B: each commit's message and added lines")
    g.add_argument("--all", action="store_true", help="every tracked file")
    g.add_argument("--claude-hook", action="store_true", help="a Claude Code PreToolUse payload on stdin")
    g.add_argument("--files", nargs="+", metavar="FILE", help="files to check whole ('-' reads stdin)")
    p.add_argument("--home", default=None, help="store folder (default: $FUZZ_HOME or the platform data folder)")
    p.add_argument("--user", type=int, default=None)
    p.add_argument("--quiet", action="store_true", help="say nothing when it's clean")
    a = p.parse_args(argv)

    if a.staged:
        items = staged()
    elif a.message:
        with open(a.message, encoding="utf-8") as f:
            items = message_lines(f.read())
    elif a.range:
        items = commit_range(a.range)
    elif a.all:
        items = tracked()
    elif a.claude_hook:
        try:
            items = claude_hook(json.load(sys.stdin))
        except ValueError:
            return 0
        if not items:
            return 0
    else:
        items = []
        for path in a.files or []:
            text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
            items += [(f"{'stdin' if path == '-' else path}:{i}", ln) for i, ln in enumerate(text.splitlines(), 1)]

    home = a.home or default_home()
    terms, note = load_terms(home, a.user)
    if note:
        print(f"leakcheck: {note}", file=sys.stderr)
    found = scan(items, terms, _lines(os.path.join(home, ALLOW_FILE)))
    if found:
        print("leakcheck: this would publish something from your store (the repo is public):", file=sys.stderr)
        for where, what in found:
            print(f"  {where}: {what}", file=sys.stderr)
        print("Describe it generically, or invent a name on an .example domain. A false positive goes in "
              f"{os.path.join(home, ALLOW_FILE)} (not the repo).", file=sys.stderr)
        return 2 if a.claude_hook else 1     # 2 is what makes Claude Code block the call and read the reason
    if not a.quiet:
        print(f"leakcheck: clean ({len(items)} lines against {len(terms)} terms)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
