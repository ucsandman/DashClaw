#!/usr/bin/env python3
"""
DashClaw PostToolUse Hook v2 for Claude Code.

Records the outcome of governed tool calls by updating the action record
created by the PreToolUse hook. v2 adds richer outcome reporting:
  - 500-char output summaries (up from 200)
  - Structured outcome_metadata with exit_code, error_type classification
  - Improved error detection: checks exit code AND error field
  - Error classification: timeout, permission, not_found, runtime

Never blocks. Always exits 0.
"""

import json
import os
import sys
import tempfile
import urllib.request
import urllib.error
from datetime import datetime, timezone

# Import the shared HTTP retry helper from the sibling intel package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel.http_client import request_with_retry
from dashclaw_agent_intel import behavior_recorder

# ---------------------------------------------------------------------------
# Load .env file (C:/Projects/DashClaw/.env) before reading config.
# Values already in the environment take precedence.
# ---------------------------------------------------------------------------

def _apply_env_line(line):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        return
    key, _, val = line.partition("=")
    key = key.strip()
    val = val.strip().strip('"').strip("'")
    if " #" in val:
        val = val[:val.index(" #")].strip()
    if key and key not in os.environ:
        os.environ[key] = val


def _apply_env_file(env_path):
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                _apply_env_line(line)
    except FileNotFoundError:
        return


def _load_dotenv():
    # Test isolation escape hatch: when DASHCLAW_DISABLE_DOTENV is set, skip
    # the .env walk entirely so the subprocess only sees env vars the test
    # explicitly passed in. Never set this in production.
    if os.environ.get("DASHCLAW_DISABLE_DOTENV"):
        return
    # Walk up from the hook file's directory looking for env files. Works
    # whether this runs from hooks/X.py (project root is one parent up) or
    # from .claude/hooks/X.py after install-hooks runs (project root is two
    # parents up). Earlier files win because of `key not in os.environ`.
    tried = set()
    current = os.path.abspath(os.path.dirname(__file__))
    for _ in range(5):
        for fname in (".env.local", ".env"):
            env_path = os.path.join(current, fname)
            if env_path in tried:
                continue
            tried.add(env_path)
            _apply_env_file(env_path)
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent

_load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
# Set DASHCLAW_HOOK_DEBUG=1 in .env to capture PostToolUse invocation breadcrumbs
# in <tempdir>/dashclaw_hook_errors.log. Useful for diagnosing why PostToolUse
# isn't firing or is exiting early (missing tool_use_id, missing action_id, etc.)
# — the miss rate for PostToolUse has historically been ~96% in the wild and the
# root cause is opaque without this.
DEBUG = (os.environ.get("DASHCLAW_HOOK_DEBUG") or "").strip() in ("1", "true", "yes")

MAX_SUMMARY = 500


def _log(tag, msg):
    if not DEBUG:
        return
    try:
        path = os.path.join(tempfile.gettempdir(), "dashclaw_hook_errors.log")
        ts = datetime.now(timezone.utc).isoformat()
        with open(path, "a", encoding="utf-8") as f:
            f.write(ts + " posttool " + tag + ": " + str(msg) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------

def _classify_error(error_str):
    """Classify an error string into a category.

    Returns one of: timeout, permission, not_found, runtime.
    """
    lower = error_str.lower()
    if "timeout" in lower or "timed out" in lower:
        return "timeout"
    if "permission" in lower or "denied" in lower:
        return "permission"
    if "not found" in lower or "no such file" in lower:
        return "not_found"
    return "runtime"


# ---------------------------------------------------------------------------
# Outcome extraction
# ---------------------------------------------------------------------------

def _extract_outcome(tool_response):
    """Extract structured outcome from tool_response.

    Returns (status, output_summary, outcome_metadata).
    """
    error_val = tool_response.get("error")
    exit_code = tool_response.get("exit_code")
    output_val = str(tool_response.get("output") or tool_response.get("stdout") or "")

    metadata = {}

    # Record exit_code if present
    if exit_code is not None:
        metadata["exit_code"] = exit_code

    # Priority 1: explicit error field
    if error_val:
        error_str = str(error_val)
        metadata["error_type"] = _classify_error(error_str)
        return "failed", error_str[:MAX_SUMMARY], metadata

    # Priority 2: non-zero exit code
    if exit_code is not None and exit_code != 0:
        metadata["error_type"] = _classify_error(output_val)
        summary = output_val[:MAX_SUMMARY] if output_val else "Process exited with code %d" % exit_code
        return "failed", summary, metadata

    # Otherwise: completed
    return "completed", output_val[:MAX_SUMMARY], metadata


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _patch_action(action_id, body):
    """PATCH /api/actions/{action_id}. Failures log (if DEBUG) and return.

    Retries up to three times with 0.4s then 0.8s backoff between
    attempts so a Vercel or Neon cold start does not drop the action's
    terminal status, which would otherwise leave the row stuck in
    `running` and pollute Mission Control as a zombie.
    """
    url = BASE_URL + "/api/actions/" + action_id
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        method="PATCH",
    )
    try:
        request_with_retry(req, timeout=2)
    except urllib.error.HTTPError as e:
        _log("patch_failed", "action_id=" + action_id + " HTTP " + str(e.code))
    except Exception as e:
        _log("patch_failed", "action_id=" + action_id + " " + type(e).__name__ + ": " + str(e))


# ---------------------------------------------------------------------------
# Temp file helpers
# ---------------------------------------------------------------------------

def _read_action_id(tool_use_id):
    """Read action_id from the temp file written by PreToolUse.

    Returns action_id string or None if not found.
    """
    path = os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip() or None
    except Exception:
        return None


def _cleanup_temp(tool_use_id):
    """Remove the temp file for this tool_use_id."""
    path = os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id)
    try:
        os.remove(path)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _parse_stdin():
    """Read and parse the hook payload from stdin.

    Read raw bytes and decode as UTF-8 — sys.stdin.read() uses the platform
    default (cp1252 on Windows) which corrupts any multi-byte character in
    tool output before the JSON parse. Pretool already does this; posttool
    was missed.

    On any parse failure, logs and exits 0 (never blocks).
    """
    try:
        raw = sys.stdin.buffer.read().decode("utf-8-sig").strip()
        return json.loads(raw) if raw else {}
    except Exception as e:
        _log("exit_early", "stdin parse failed: " + type(e).__name__)
        sys.exit(0)


def _require_configured():
    """Exit silently if DashClaw is not configured."""
    if BASE_URL and API_KEY:
        return
    _log("exit_early", "no BASE_URL/API_KEY")
    sys.exit(0)


def _require_tool_use(data):
    """Return (tool_name, tool_use_id), exiting when the hook payload is unusable."""
    tool_name = data.get("tool_name") or ""
    tool_use_id = data.get("tool_use_id") or ""
    if tool_use_id:
        return tool_name, tool_use_id
    _log("exit_early", "no tool_use_id (tool_name=" + tool_name + ")")
    sys.exit(0)


def _require_action_id(tool_use_id, tool_name):
    """Return the PreToolUse action id, or exit when this tool was not recorded."""
    action_id = _read_action_id(tool_use_id)
    if action_id:
        return action_id
    _log("exit_early", "no action_id for tool_use_id=" + tool_use_id
         + " tool_name=" + tool_name
         + " (pretool didn't record — guard denied, un-governed tool, or pretool crashed)")
    sys.exit(0)


def _patch_body(status, output_summary, outcome_metadata):
    return {
        "status": status,
        "output_summary": output_summary,
        "timestamp_end": datetime.now(timezone.utc).isoformat(),
        "outcome_metadata": outcome_metadata,
    }


def _record_behavior_post(tool_use_id, status, outcome_metadata, action_id):
    """Finalize behavior sample; fail-silent because PostToolUse must never block."""
    try:
        behavior_recorder.record_post(
            tool_use_id, status, outcome_metadata, action_id,
            os.environ.get("DASHCLAW_WORKSPACE"),
        )
    except Exception:
        pass


def main():
    _log("invoked", "pid=" + str(os.getpid()))
    _require_configured()

    data = _parse_stdin()
    tool_name, tool_use_id = _require_tool_use(data)

    # Find the action ID from the temp file written by PreToolUse
    action_id = _require_action_id(tool_use_id, tool_name)

    # Extract structured outcome from tool_response
    tool_response = data.get("tool_response") or {}
    status, output_summary, outcome_metadata = _extract_outcome(tool_response)

    # PATCH the action with the outcome
    _patch_action(action_id, _patch_body(status, output_summary, outcome_metadata))
    _log("patched", "action_id=" + action_id + " status=" + status)

    # Behavior Learning: finalize the pending sample stashed by PreToolUse with
    # this outcome and append it to the local JSONL log (opt-in, fail-silent).
    _record_behavior_post(tool_use_id, status, outcome_metadata, action_id)

    # Clean up temp file
    _cleanup_temp(tool_use_id)

    sys.exit(0)


if __name__ == "__main__":
    main()
