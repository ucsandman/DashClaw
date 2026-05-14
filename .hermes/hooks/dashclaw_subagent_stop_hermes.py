#!/usr/bin/env python3
"""
Hermes Agent subagent_stop hook for DashClaw.

Fires after a `delegate_task` child session exits. We record the
delegation as a DashClaw action with a `subagent` action_type so the
subagent-ROI dashboards (`/api/code-sessions/subagent-roi`) have data
to attribute spend and stuck-loop signals to delegated work.

Never blocks. Best-effort.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dashclaw_common import (  # noqa: E402
    AGENT_ID,
    api_request,
    emit_noop,
    log_error,
    read_stdin_json,
)


def main() -> int:
    data = read_stdin_json()
    parent = data.get("parent_session_id") or ""
    if not parent:
        emit_noop()
        return 0

    role = data.get("child_role") or "subagent"
    status = data.get("child_status") or "completed"
    duration_ms = data.get("duration_ms")

    payload = {
        "agent_id": AGENT_ID,
        "action_type": "subagent",
        "status": "completed" if status in ("completed", "success") else "failed",
        "declared_goal": f"Delegated task ({role})",
        "metadata": {
            "parent_session_id": parent,
            "child_role": role,
            "child_status": status,
            "duration_ms": duration_ms,
            "ended_at": datetime.now(timezone.utc).isoformat(),
        },
    }

    try:
        result = api_request("POST", "/api/actions", body=payload, timeout=5)
        if not result:
            log_error("subagent_stop", "POST /api/actions returned None")
    except Exception as e:
        log_error("subagent_stop", f"{type(e).__name__}: {e}")

    emit_noop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
