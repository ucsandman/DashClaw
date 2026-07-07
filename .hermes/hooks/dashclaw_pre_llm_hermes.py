#!/usr/bin/env python3
"""
Hermes Agent pre_llm_call hook — inject DashClaw governance context.

This is the only Hermes hook whose return value rewrites the current
turn's user message. We use it to surface governance state the model
should be aware of: pending approvals on this session, recent blocks,
and active policies.

Context is sourced from a cache file written by the on_session_start
hook (refreshed every 5 minutes on subsequent turns). We avoid a
network round-trip on every turn — important because pre_llm_call sits
in the hot path.

Injected text is bounded to ~500 chars to stay polite with the
conversation context budget.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dashclaw_common import (  # noqa: E402
    AGENT_ID,
    api_request,
    emit_context,
    emit_noop,
    read_cache,
    read_stdin_json,
    write_cache,
)

CACHE_TTL_SECONDS = int(os.environ.get("DASHCLAW_PRELLM_REFRESH") or "300")
MAX_CONTEXT_CHARS = 500


def _refresh_state(session_id: str) -> dict:
    """Pull a lightweight governance snapshot from DashClaw."""
    summary = api_request("GET", "/api/operations/summary", timeout=3) or {}
    pending_res = api_request("GET", "/api/actions?status=pending_approval&limit=5", timeout=3) or {}
    pending = pending_res.get("actions") or []
    policies_res = api_request("GET", "/api/policies", timeout=3) or {}
    policies = [p for p in (policies_res.get("policies") or []) if isinstance(p, dict) and p.get("active", 1)]
    throughput = summary.get("throughput") or {}
    return {
        "fetched_at": int(time.time()),
        "pending_approvals_count": len(pending),
        "pending_approvals_first": [a.get("action_id") for a in pending[:3] if isinstance(a, dict)],
        "policies_active": len(policies),
        "actions_24h": throughput.get("last_24h", 0),
    }


def _format_context(state: dict) -> str:
    pending = state.get("pending_approvals_count", 0)
    policies = state.get("policies_active", 0)
    actions = state.get("actions_24h", 0)

    # Skip injection entirely when there is nothing meaningful to add.
    # Empty `context` would still cost tokens; better to return no-op.
    if not pending and not policies:
        return ""

    parts = [f"[DashClaw] agent={AGENT_ID}"]
    if policies:
        parts.append(f"active_policies={policies}")
    if pending:
        ids = ", ".join(state.get("pending_approvals_first") or []) or "see /dashclaw-approvals"
        parts.append(f"pending_approvals={pending} (IDs: {ids})")
    if actions:
        parts.append(f"actions_today={actions}")
    parts.append("Call `dashclaw_guard` from MCP before destructive or network actions; record outcomes via `dashclaw_record_action`.")
    return " | ".join(parts)[:MAX_CONTEXT_CHARS]


def main() -> int:
    data = read_stdin_json()
    session_id = data.get("session_id") or ""
    if not session_id:
        emit_noop()
        return 0

    state = read_cache(session_id, suffix="prellm")
    now = int(time.time())
    if not state or (now - int(state.get("fetched_at", 0))) > CACHE_TTL_SECONDS:
        try:
            state = _refresh_state(session_id)
            write_cache(session_id, state, suffix="prellm")
        except Exception:
            # On any failure, fall back to the (possibly stale) cache or no-op.
            state = state or {}

    context = _format_context(state) if state else ""

    if context:
        emit_context(context)
    else:
        emit_noop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
