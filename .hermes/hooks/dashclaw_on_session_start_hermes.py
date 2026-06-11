#!/usr/bin/env python3
"""
Hermes Agent on_session_start hook for DashClaw.

Fires once at the start of every new session. Pre-warms the pre_llm_call
cache so the first turn already has fresh state without paying the HTTP
round-trip on the hot path.

Never blocks. Never injects. Best-effort.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dashclaw_common import (  # noqa: E402
    AGENT_ID,
    WORKSPACE,
    api_request,
    derive_slug,
    emit_noop,
    get_handoff_latest,
    log_error,
    post_handoff_consume,
    read_stdin_json,
    write_cache,
)


def _bootstrap(session_id: str, platform: str | None) -> None:
    summary = api_request("GET", "/api/operations/summary", timeout=4) or {}
    pending_res = api_request("GET", "/api/actions?status=pending_approval&limit=5", timeout=4) or {}
    pending = pending_res.get("actions") or []
    policies_res = api_request("GET", "/api/policies", timeout=4) or {}
    policies = [p for p in (policies_res.get("policies") or []) if isinstance(p, dict) and p.get("active", 1)]
    throughput = summary.get("throughput") or {}

    write_cache(
        session_id,
        {
            "fetched_at": int(time.time()),
            "pending_approvals_count": len(pending),
            "pending_approvals_first": [a.get("action_id") for a in pending[:3] if isinstance(a, dict)],
            "policies_active": len(policies),
            "actions_24h": throughput.get("last_24h", 0),
        },
        suffix="prellm",
    )

    # Initialise the session-state cache that on_session_end uses to
    # decide whether to fire the optimizer pass.
    write_cache(
        session_id,
        {
            "started_at": int(time.time()),
            "platform": platform or "cli",
            "agent_id": AGENT_ID,
            "workspace": WORKSPACE,
            "slug": derive_slug(WORKSPACE),
            "turns_recorded": 0,
        },
        suffix="session",
    )


def _load_handoff(session_id: str, project_id) -> None:
    """Best-effort: fetch latest handoff for AGENT_ID, cache it, mark consumed."""
    try:
        handoff = get_handoff_latest(agent_id=AGENT_ID, project_id=project_id)
        if not handoff or not isinstance(handoff, dict):
            return
        if not handoff.get("bundle"):
            return
        write_cache(session_id, handoff, suffix="handoff")
        handoff_id = handoff.get("id")
        if handoff_id:
            post_handoff_consume(handoff_id=handoff_id, session_id=session_id)
    except Exception as e:
        log_error("on_session_start", f"handoff_load failed: {type(e).__name__}: {e}")


def main() -> int:
    data = read_stdin_json()
    session_id = data.get("session_id") or ""
    if not session_id:
        emit_noop()
        return 0

    try:
        _bootstrap(session_id, data.get("platform"))
    except Exception as e:
        log_error("on_session_start", f"{type(e).__name__}: {e}")

    _load_handoff(session_id, data.get("project_id"))

    emit_noop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
