#!/usr/bin/env python3
"""
Hermes Agent pre_tool_call shell-hook adapter for DashClaw.

Hermes shell hooks deliver `tool_name`, `tool_input`, `session_id`, and
`extra` via JSON on stdin — the same field names Claude Code's PreToolUse
hook uses. So this adapter simply pipes stdin into the existing
`.claude/hooks/dashclaw_pretool.py` script as a subprocess and translates
its exit code to Hermes's JSON response shape.

Hermes response contract (stdout):
  - allow:        empty or `{}`
  - block:        `{"decision": "block", "reason": "..."}`
  - inject:       `{"context": "..."}`  (unused here)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

# Locate the existing Claude Code pretool hook. It lives at the repo root
# under .claude/hooks/. Resolve relative to this file so the adapter works
# wherever the user has the repo checked out.
REPO_ROOT = Path(__file__).resolve().parents[2]
PRETOOL_SCRIPT = REPO_ROOT / ".claude" / "hooks" / "dashclaw_pretool.py"


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        # Invalid stdin — don't block; Hermes treats no-op as allow.
        return 0

    if not PRETOOL_SCRIPT.exists():
        # Misconfigured install. Fail open per
        # `DASHCLAW_GUARD_UNAVAILABLE_POLICY` semantics — emit nothing.
        return 0

    # Declare the harness identity (roadmap v2.2): --agent-id beats the
    # machine-ambient DASHCLAW_AGENT_ID env var inside the target script, so
    # Hermes calls stay attributed to Hermes even when another harness
    # exported an id in the shared environment. The env override (not
    # setdefault) covers older target scripts without argv support.
    # Operators customize with DASHCLAW_HERMES_AGENT_ID.
    agent_id = os.environ.get("DASHCLAW_HERMES_AGENT_ID") or "hermes"
    env = dict(os.environ)
    env["DASHCLAW_AGENT_ID"] = agent_id

    proc = subprocess.run(
        ["python", str(PRETOOL_SCRIPT), "--agent-id", agent_id],
        input=json.dumps(payload).encode("utf-8"),
        capture_output=True,
        env=env,
        timeout=int(os.environ.get("DASHCLAW_GUARD_TIMEOUT") or "30"),
    )

    # Existing script convention: exit 0 = allow, exit 2 = block.
    # stderr carries the user-facing reason on a block.
    if proc.returncode == 2:
        reason = (proc.stderr.decode("utf-8", errors="replace") or "Blocked by DashClaw policy").strip()
        # Hermes truncates very long reasons; first line is the most useful.
        first_line = reason.splitlines()[0] if reason else "Blocked by DashClaw policy"
        sys.stdout.write(json.dumps({"decision": "block", "reason": first_line}))
        return 0

    # Allow (or anything other than block). Hermes is forgiving about
    # empty stdout — emit explicit `{}` for clarity.
    sys.stdout.write("{}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
