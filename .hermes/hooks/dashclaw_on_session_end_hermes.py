#!/usr/bin/env python3
"""
Hermes Agent on_session_end hook for DashClaw.

Fires at the end of every `run_conversation()` call. Sends a finalize
signal to `/api/code-sessions/ingest-live` so the server can run the
optimizer + alerts pass on the now-complete session.

Never blocks. Best-effort.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dashclaw_common import (  # noqa: E402
    AGENT_ID,
    WORKSPACE,
    api_request,
    derive_slug,
    emit_noop,
    log_error,
    read_cache,
    read_stdin_json,
)


def main() -> int:
    data = read_stdin_json()
    session_id = data.get("session_id") or ""
    if not session_id:
        emit_noop()
        return 0

    state = read_cache(session_id, suffix="session")
    payload = {
        "session_uuid": session_id,
        "agent_id": AGENT_ID,
        "finalize": True,
        "project": {
            "slug": state.get("slug") or derive_slug(WORKSPACE),
            "cwd": state.get("workspace") or WORKSPACE,
            "source_host": "hook",
        },
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "completed": bool(data.get("completed", True)),
        "interrupted": bool(data.get("interrupted", False)),
    }

    try:
        result = api_request("POST", "/api/code-sessions/ingest-live", body=payload, timeout=8)
        if not result:
            log_error("on_session_end", "ingest-live finalize returned None")
    except Exception as e:
        log_error("on_session_end", f"{type(e).__name__}: {e}")

    emit_noop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
