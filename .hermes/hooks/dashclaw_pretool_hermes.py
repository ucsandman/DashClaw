#!/usr/bin/env python3
"""
Hermes Agent pre_tool_call shell-hook adapter for DashClaw.

Hermes shell hooks deliver `tool_name`, `tool_input`, `session_id`, and
`extra` via JSON on stdin — the same field names Claude Code's PreToolUse
hook uses. So this adapter simply pipes stdin into the canonical
`hooks/dashclaw_pretool.py` script as a subprocess and translates
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

# Resolve the canonical hook bundle relative to this adapter. The repository
# `.claude/hooks` directory is an installed copy and can drift; `hooks/` is the
# source that refresh-bundles mirrors into every supported distribution.
REPO_ROOT = Path(__file__).resolve().parents[2]
PRETOOL_SCRIPT = REPO_ROOT / "hooks" / "dashclaw_pretool.py"


def _block(reason: str) -> int:
    first_line = (reason or "DashClaw governance adapter failed").strip().splitlines()[0]
    sys.stdout.write(json.dumps({"decision": "block", "reason": first_line[:500]}))
    return 0


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return _block("Invalid Hermes hook input; DashClaw could not evaluate this tool call")
    if not isinstance(payload, dict):
        return _block("Invalid Hermes hook input; expected one JSON object")

    if not PRETOOL_SCRIPT.exists():
        return _block("DashClaw delegate is missing; reinstall or refresh the Hermes plugin")

    # Declare the harness identity (roadmap v2.2): --agent-id beats the
    # machine-ambient DASHCLAW_AGENT_ID env var inside the target script, so
    # Hermes calls stay attributed to Hermes even when another harness
    # exported an id in the shared environment. The env override (not
    # setdefault) covers older target scripts without argv support.
    # Operators customize with DASHCLAW_HERMES_AGENT_ID.
    agent_id = os.environ.get("DASHCLAW_HERMES_AGENT_ID") or "hermes"
    env = dict(os.environ)
    env["DASHCLAW_AGENT_ID"] = agent_id

    try:
        proc = subprocess.run(
            ["python", str(PRETOOL_SCRIPT), "--agent-id", agent_id],
            input=json.dumps(payload).encode("utf-8"),
            capture_output=True,
            env=env,
            timeout=int(os.environ.get("DASHCLAW_GUARD_TIMEOUT") or "30"),
        )
    except subprocess.TimeoutExpired:
        return _block("DashClaw delegate timed out; tool execution was interrupted")
    except (OSError, ValueError) as exc:
        return _block("DashClaw delegate failed to start: " + str(exc))

    # Existing script convention: exit 0 = allow, exit 2 = block.
    # stderr carries the user-facing reason on a block.
    if proc.returncode == 2:
        reason = (proc.stderr.decode("utf-8", errors="replace") or "Blocked by DashClaw policy").strip()
        # Hermes truncates very long reasons; first line is the most useful.
        return _block(reason)

    if proc.returncode != 0:
        reason = proc.stderr.decode("utf-8", errors="replace").strip()
        return _block(
            "DashClaw delegate exited unexpectedly"
            + ((": " + reason) if reason else "")
        )

    # Ordinary canonical allows emit no stdout. `{}` is accepted for forward
    # compatibility with explicit no-op responses. Any other payload is not a
    # Hermes response and must not be treated as permission; in particular,
    # Claude's updatedInput containment response cannot safely be discarded.
    delegate_stdout = proc.stdout.decode("utf-8", errors="replace").strip()
    if delegate_stdout:
        try:
            delegate_result = json.loads(delegate_stdout)
        except json.JSONDecodeError:
            return _block("DashClaw delegate returned malformed output")
        if delegate_result != {}:
            return _block("DashClaw delegate returned an unsupported success response")

    # Exact successful delegate completion is the only allow path.
    sys.stdout.write("{}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
