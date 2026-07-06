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
import re
import sys
import tempfile
import urllib.request
import urllib.error
from datetime import datetime, timezone

# Import the shared HTTP retry helper from the sibling intel package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel.http_client import request_with_retry

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
    _log_always(tag, msg)


def _log_always(tag, msg):
    """Unconditional append to the shared hook error log (NOT debug-gated).

    Real failures — a dropped outcome PATCH leaves the action stuck in
    `running` forever — must leave a trace like the stop/pretool hooks do;
    only diagnostic breadcrumbs stay behind DASHCLAW_HOOK_DEBUG.
    """
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
    # MCP tools deliver tool_response as a bare list of content blocks
    # ([{"type": "text", "text": ...}]); built-in tools deliver a dict.
    # Normalize so both shapes flow through the same logic.
    if isinstance(tool_response, list):
        tool_response = {"content": tool_response}
    if not isinstance(tool_response, dict):
        tool_response = {"output": str(tool_response)}

    error_val = tool_response.get("error")
    exit_code = tool_response.get("exit_code")
    output_val = str(tool_response.get("output") or tool_response.get("stdout") or "")

    # MCP content array: join the text blocks for the summary; honor isError.
    if not output_val and isinstance(tool_response.get("content"), list):
        texts = [
            block.get("text", "")
            for block in tool_response["content"]
            if isinstance(block, dict)
        ]
        output_val = "\n".join(t for t in texts if t)
    if not error_val and tool_response.get("isError"):
        error_val = output_val or "MCP tool returned isError"

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
# Spawn linkage extraction (v4.3 fleet attribution, verdict 2b)
#
# Agent/Task/Workflow spawns hand back the spawned sub-agent's harness uuid
# in their tool_response once the spawn completes (sync) or launches (async).
# Persisting it into outcome_metadata.spawned_agent_uuid lets the read path
# join this spawn row against its leaves' subagent_uuid (stamped by pretool)
# inside one harness_session_id — a read-time join, never a client guess.
# Fail-soft throughout: no match found simply omits the field.
# ---------------------------------------------------------------------------

_SPAWN_TOOLS = ("Agent", "Task", "Workflow")
_AGENT_ID_LINE_RE = re.compile(r"agentId\s*:\s*([A-Za-z0-9_.-]+)", re.IGNORECASE)
_MAX_SPAWNED_UUID = 200


def _agent_id_from_mapping(obj):
    """Return the agentId/agent_id value from a JSON-shaped dict, or None."""
    if not isinstance(obj, dict):
        return None
    for key in ("agentId", "agent_id"):
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()[:_MAX_SPAWNED_UUID]
    return None


def _agent_id_from_text(text):
    """Return the value of an `agentId: <id>` line in free text, or None."""
    if not text:
        return None
    m = _AGENT_ID_LINE_RE.search(text)
    return m.group(1)[:_MAX_SPAWNED_UUID] if m else None


def _agent_id_from_json_string(text):
    """Parse text as JSON and pull agentId/agent_id if it is object-shaped."""
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError):
        return None
    return _agent_id_from_mapping(parsed)


def _extract_spawned_agent_uuid(tool_name, tool_response):
    """Extract the spawned agent's harness uuid from an Agent/Task/Workflow
    tool_response, or None. Handles the text shape (a line like
    `agentId: a0e90f949e494f49c` inside output/stdout/MCP content blocks) and
    the JSON shape (a top-level or embedded agentId/agent_id key)."""
    if tool_name not in _SPAWN_TOOLS:
        return None
    try:
        resp = tool_response
        if isinstance(resp, str):
            return _agent_id_from_json_string(resp) or _agent_id_from_text(resp)
        if isinstance(resp, list):
            resp = {"content": resp}
        if not isinstance(resp, dict):
            return None

        found = _agent_id_from_mapping(resp)
        if found:
            return found

        for key in ("output", "stdout"):
            found = _agent_id_from_text(resp.get(key) if isinstance(resp.get(key), str) else None)
            if found:
                return found

        content = resp.get("content")
        if isinstance(content, list):
            texts = [b.get("text", "") for b in content if isinstance(b, dict)]
            blob = "\n".join(t for t in texts if t)
            return _agent_id_from_json_string(blob) or _agent_id_from_text(blob)
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _patch_action(action_id, body):
    """PATCH /api/actions/{action_id}. Failures ALWAYS log and return.

    Retries up to three times with 0.4s then 0.8s backoff between
    attempts so a Vercel or Neon cold start does not drop the action's
    terminal status, which would otherwise leave the row stuck in
    `running` and pollute Mission Control as a zombie. A final failure is
    appended to dashclaw_hook_errors.log unconditionally (not debug-gated):
    a silently dropped outcome is an audit-trail gap, not a breadcrumb.
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
        _log_always("patch_failed", "action_id=" + action_id + " HTTP " + str(e.code)
                    + " — outcome not recorded; action may be stuck in 'running'")
    except Exception as e:
        _log_always("patch_failed", "action_id=" + action_id + " " + type(e).__name__ + ": " + str(e)
                    + " — outcome not recorded; action may be stuck in 'running'")


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

    # v4.3 fleet attribution: an Agent/Task/Workflow spawn's tool_response
    # carries the spawned sub-agent's harness uuid once available. Fail-soft —
    # no match simply omits the field, never blocks the PATCH.
    spawned_agent_uuid = _extract_spawned_agent_uuid(tool_name, tool_response)
    if spawned_agent_uuid:
        outcome_metadata["spawned_agent_uuid"] = spawned_agent_uuid

    # PATCH the action with the outcome
    _patch_action(action_id, _patch_body(status, output_summary, outcome_metadata))
    _log("patched", "action_id=" + action_id + " status=" + status)

    # Clean up temp file
    _cleanup_temp(tool_use_id)

    sys.exit(0)


if __name__ == "__main__":
    main()
