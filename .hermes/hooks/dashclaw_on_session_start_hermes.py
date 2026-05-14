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
    log_error,
    read_stdin_json,
    write_cache,
)


def _bootstrap(session_id: str, platform: str | None) -> None:
    summary = api_request("GET", "/api/setup/summary", timeout=4) or {}
    approvals = api_request("GET", "/api/approvals?status=pending&limit=5", timeout=4) or {}
    pending = approvals.get("approvals") or approvals.get("items") or []
    counts = summary.get("counts") or {}

    write_cache(
        session_id,
        {
            "fetched_at": int(time.time()),
            "pending_approvals_count": len(pending),
            "pending_approvals_first": [a.get("id") for a in pending[:3] if isinstance(a, dict)],
            "policies_active": counts.get("policies_active", 0),
            "actions_24h": counts.get("actions_24h", 0),
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

    emit_noop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
