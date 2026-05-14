#!/usr/bin/env python3
"""
Hermes Agent post_tool_call shell-hook adapter for DashClaw.

The existing `.claude/hooks/dashclaw_posttool.py` records the action
outcome and never blocks. Hermes shell-hook payload uses the same
`tool_name`, `tool_input`, `tool_response`, and `session_id` keys, so we
just pipe stdin through to it.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
POSTTOOL_SCRIPT = REPO_ROOT / ".claude" / "hooks" / "dashclaw_posttool.py"


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        return 0

    if not POSTTOOL_SCRIPT.exists():
        return 0

    env = dict(os.environ)
    env.setdefault("DASHCLAW_AGENT_ID", "hermes")

    subprocess.run(
        ["python", str(POSTTOOL_SCRIPT)],
        input=json.dumps(payload).encode("utf-8"),
        capture_output=True,
        env=env,
        timeout=int(os.environ.get("DASHCLAW_POSTTOOL_TIMEOUT") or "15"),
    )

    # Hermes post-hooks never block; always emit no-op.
    sys.stdout.write("{}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
