#!/usr/bin/env python3
"""
Hermes Agent post_llm_call shell-hook adapter for DashClaw.

Hermes fires post_llm_call once per turn, after the tool-calling loop
settles. Payload (per Hermes docs):
  - session_id
  - assistant_response          (full text of the assistant's turn)
  - conversation_history        (list of message dicts; last entries are
                                 the assistant turn and its tool calls)

We extract the per-turn delta and POST it to
/api/code-sessions/ingest-live. Token usage is opportunistic — Hermes
does not expose token counts in this hook payload, so we forward whatever
`usage` field appears on the last assistant message (some providers
inject it). Missing token data is acceptable; the route stores `null`
and downstream optimizer rules degrade gracefully.

Never blocks. Failures are silent except for a best-effort error log at
`~/.dashclaw/postllm-errors.log`.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
# Harness-specific id first (roadmap v2.2) — mirrors dashclaw_common.py.
AGENT_ID = (
    os.environ.get("DASHCLAW_HERMES_AGENT_ID")
    or os.environ.get("DASHCLAW_AGENT_ID")
    or "hermes"
)
WORKSPACE = os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd()
INGEST_TIMEOUT = float(os.environ.get("DASHCLAW_INGEST_TIMEOUT") or "10")


def _log_error(msg: str) -> None:
    """Best-effort error log. Never raises."""
    try:
        log_dir = Path.home() / ".dashclaw"
        log_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        with open(log_dir / "postllm-errors.log", "a", encoding="utf-8") as f:
            f.write(f"{ts} {msg}\n")
    except Exception:
        pass


def _derive_slug(workspace: str) -> str:
    if not workspace:
        return "unknown"
    last = workspace.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1] or "unknown"
    cleaned = "".join(c if c.isalnum() or c in "_.-" else "-" for c in last)
    return cleaned[:80] or "unknown"


def _extract_last_assistant(conversation_history):
    """Find the most recent assistant message in conversation_history.

    Returns (message_dict_or_None, model_str_or_None, usage_dict_or_None,
    list_of_tool_call_dicts).
    """
    if not isinstance(conversation_history, list):
        return None, None, None, []
    for msg in reversed(conversation_history):
        if not isinstance(msg, dict):
            continue
        if (msg.get("role") or "").lower() != "assistant":
            continue
        model = msg.get("model") or msg.get("model_id")
        usage = msg.get("usage") if isinstance(msg.get("usage"), dict) else None
        # Tool calls may live under "tool_calls" (OpenAI-shape) or as content
        # blocks of type "tool_use" (Anthropic-shape).
        tool_calls = []
        for call in (msg.get("tool_calls") or []):
            if not isinstance(call, dict):
                continue
            fn = call.get("function") or {}
            tool_calls.append({
                "name": call.get("name") or fn.get("name"),
                "tool_use_id": call.get("id"),
                "target": (fn.get("arguments") or {}) if isinstance(fn.get("arguments"), dict) else None,
            })
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool_calls.append({
                        "name": block.get("name"),
                        "tool_use_id": block.get("id"),
                        "target": block.get("input") if isinstance(block.get("input"), dict) else None,
                    })
        return msg, model, usage, tool_calls
    return None, None, None, []


def _post_ingest(payload: dict) -> None:
    if not BASE_URL or not API_KEY:
        _log_error("BASE_URL or API_KEY missing; skipping ingest")
        return
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE_URL + "/api/code-sessions/ingest-live",
        data=body,
        headers={"Content-Type": "application/json", "x-api-key": API_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=INGEST_TIMEOUT) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        _log_error(f"ingest-live HTTP {e.code}: {e.reason}")
    except Exception as e:
        _log_error(f"ingest-live failed: {type(e).__name__}: {e}")


def main() -> int:
    raw = sys.stdin.read()
    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return 0

    session_id = data.get("session_id") or ""
    if not session_id:
        # Without a session id we cannot key into code_sessions. Silent exit.
        sys.stdout.write("{}")
        return 0

    history = data.get("conversation_history") or []
    _, model, usage, tool_calls = _extract_last_assistant(history)

    payload = {
        "session_uuid": session_id,
        "agent_id": AGENT_ID,
        "project": {
            "slug": _derive_slug(WORKSPACE),
            "cwd": WORKSPACE,
            "source_host": "hook",
        },
        "model": model,
        "usage": usage,  # may be None — route tolerates this
        "tool_calls": tool_calls,
        "assistant_text_preview": (data.get("assistant_response") or "")[:500],
        "turn_timestamp": datetime.now(timezone.utc).isoformat(),
    }
    _post_ingest(payload)
    sys.stdout.write("{}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
