"""Scripted roles: canned output, no model. They go through the real MCP server in-process, so a
scripted run checks the same tools, rules and events a model would use. If the system runs end to
end on these, the models really are swappable.
"""

import asyncio
import json

from mcp import Client

from .. import mcp_server

PROMPT_VERSION = "scripted-1"


class ToolFailed(Exception):
    pass


async def _call(client, name, args=None):
    r = await client.call_tool(name, args or {})
    text = r.content[0].text if r.content else "{}"
    if r.is_error:
        raise ToolFailed(text)
    return json.loads(text)


async def _executor(core, task_id, say):
    done = []
    async with Client(mcp_server.build(core, "executor")) as c:
        await _call(c, "whoami", {"prompt_version": PROMPT_VERSION, "client": "scripted"})
        while True:
            r = await _call(c, "claim_next_task", {"task_id": task_id} if task_id else {})
            t = r.get("task")
            if not t:
                say(f"Nothing to claim: {r.get('why')}")
                break
            tid = t["id"]
            say(f"Claimed #{tid}: {t['title']}")
            if t["sources"]:
                await _call(c, "read_source", {"source_id": t["sources"][0]["id"]})
            for f in [s for s in t["sources"] if s.get("path")][:1]:   # a real client opens it with its own tools
                with open(f["path"], "rb") as fh:
                    n = len(fh.read())
                await _call(c, "log_step", {"task_id": tid, "kind": "research",
                                            "text": f"Opened {f['title']} ({n} bytes)."})
            await _call(c, "log_step", {"task_id": tid, "kind": "research",
                                        "text": "Read the task" + (" and its first source." if t["sources"] else ".")})
            if t.get("gathering"):   # just captured: look, write the brief, pass it to triage
                await _call(c, "update_brief", {"task_id": tid, "context_md":
                            f"**{t['title']}**\n\nA scripted run gathered this. Nothing real was looked up.",
                            "summary": "A scripted run read the task; there was nothing to look up.",
                            "effort_mins": 15, "steps": 2})
                await _call(c, "finish_gathering", {"task_id": tid})
                say(f"Gathered #{tid}")
                done.append(tid)
                if task_id:
                    break
                continue
            await _call(c, "log_step", {"task_id": tid, "kind": "action", "text": "Drafted the next step."})
            if not t.get("context_md"):
                await _call(c, "update_brief", {"task_id": tid, "context_md":
                            f"**{t['title']}**\n\nA scripted run wrote this. Nothing real was read.",
                            "summary": "A scripted run read the task and drafted a next step.",
                            "effort_mins": 15, "steps": 2})
            body = f"Draft for “{t['title']}”, based on: {(t.get('notes') or t.get('ask') or t['title']).strip()}"
            await _call(c, "save_draft", {"task_id": tid, "kind": "note", "target": "", "body": body})
            say(f"Draft ready on #{tid}")
            done.append(tid)
            if task_id:
                break
    return {"tasks": done}


async def _sender(core, say):
    """Claims each approved draft and reports it sent, without sending anything."""
    sent = []
    async with Client(mcp_server.build(core, "sender")) as c:
        await _call(c, "whoami", {"prompt_version": PROMPT_VERSION, "client": "scripted"})
        while True:
            r = await _call(c, "claim_next_send")
            s = r.get("send")
            if not s:
                say(f"Nothing to send: {r.get('why')}")
                break
            await _call(c, "mark_sent", {"task_id": s["task_id"], "draft_id": s["draft_id"],
                                         "where": "scripted run, nothing really sent"})
            say(f"Sent #{s['task_id']} (scripted)")
            sent.append(s["task_id"])
    return {"tasks": sent}


def _scripted_verdict(item):
    """Deterministic stand-in for the judge: anchors and strong shared entities mean the same task."""
    for s in item["shortlist"]:
        if s.get("anchor_hit"):
            return {"candidate_id": item["candidate_id"], "task_id": s["task_id"], "verdict": "same",
                    "confidence": 0.9, "new_ask": False, "reason": "scripted: same thread"}
    best = max(item["shortlist"], key=lambda s: s.get("entity_score") or 0)
    if (best.get("entity_score") or 0) >= 2:
        return {"candidate_id": item["candidate_id"], "task_id": best["task_id"], "verdict": "same",
                "confidence": 0.7, "new_ask": False, "reason": "scripted: shares a document or ticket"}
    return {"candidate_id": item["candidate_id"], "task_id": None, "verdict": "new", "confidence": 0.8,
            "reason": "scripted: nothing close enough"}


async def _extractor(core, signals, say):
    # signals: a list, or {"signals", "facts", "knowledge", "meetings"} for memory's second pass too
    extra = signals if isinstance(signals, dict) else {}
    signals = (extra.get("signals") or []) if extra else signals
    async with Client(mcp_server.build(core, "extractor")) as c:
        await _call(c, "whoami", {"prompt_version": PROMPT_VERSION, "client": "scripted"})
        await _call(c, "get_cursors")
        out = {"submitted": None, "verdicts": 0}
        if extra.get("meetings"):
            out["meetings"] = await _call(c, "report_meetings", {"meetings": extra["meetings"]})
        if signals:
            out["submitted"] = await _call(c, "submit_signals", {"signals": signals})
            say(f"Submitted {len(signals)} signals: {out['submitted']['outcomes']}")
        while True:
            page = await _call(c, "get_pending_judgments", {"page": 1})
            if not page["items"]:
                break
            verdicts = [_scripted_verdict(i) for i in page["items"]]
            r = await _call(c, "submit_verdicts", {"verdicts": verdicts})
            out["verdicts"] += len(verdicts)
            say(f"Judged {len(verdicts)}: {r['outcomes']}")
        out["lookups"] = {k: len(v) for k, v in (await _call(c, "get_lookups")).items() if isinstance(v, list)}
        if extra.get("facts"):
            out["facts"] = await _call(c, "submit_facts", {"facts": extra["facts"]})
            say(f"Looked up {len(extra['facts'])} facts: {out['facts']}")
        if extra.get("knowledge"):
            out["knowledge"] = await _call(c, "submit_knowledge", {"items": extra["knowledge"]})
            say(f"Summarised {len(extra['knowledge'])}: {out['knowledge']}")
    return out


async def _ask(core, ask, say):
    """Look up the first name-like word of the question and answer with what's found, citing it."""
    ask_id, question = ask
    async with Client(mcp_server.build(core, "ask")) as c:
        await _call(c, "whoami", {"prompt_version": PROMPT_VERSION, "client": "scripted"})
        words = [w.strip("?.,!") for w in question.split()]
        names = [w for w in words[1:] if w[:1].isupper()] or words[-1:]
        r = await _call(c, "who_is", {"name": names[0]})
        if not r.get("found"):
            r = await _call(c, "what_is", {"term": names[0]})
        if r.get("found"):
            bits = [f"{f['attr'].replace('_', ' ')}: {f['value']}" + ("" if f["level"] not in ("inferred", "stale")
                                                                       else f" ({f['trust']})") for f in r["facts"][:4]]
            text = f"{r['name']}: " + ("; ".join(bits) or "Fuzz knows the name but nothing more yet.")
            sources = [{"title": s.get("kind"), "link": s.get("link")} for f in r["facts"][:4] for s in f["sources"][:1]]
        else:
            text, sources = r.get("say") or "Fuzz has nothing on that yet.", []
        await _call(c, "answer_ask", {"ask_id": ask_id, "text": text, "sources": sources})
        say(text)
    return {"answered": ask_id}


def run_ask(core, ask, say=lambda s: None):
    return asyncio.run(_ask(core, ask, say))


def run_executor(core, task_id=None, say=lambda s: None):
    return asyncio.run(_executor(core, task_id, say))


def run_extractor(core, signals=None, say=lambda s: None):
    return asyncio.run(_extractor(core, signals if isinstance(signals, dict) else (signals or []), say))


def run_sender(core, say=lambda s: None):
    return asyncio.run(_sender(core, say))
