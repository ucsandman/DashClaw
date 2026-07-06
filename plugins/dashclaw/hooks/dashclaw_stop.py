#!/usr/bin/env python3
"""
DashClaw Stop Hook for Claude Code.

Captures the assistant turn's LLM token usage from the session transcript and
PATCHes it to the action records created during the turn. Cost is derived
server-side from the configured model pricing table.

Data flow:
  - PreToolUse (dashclaw_pretool.py) appends each new action_id to
    "dashclaw_turn_<session_id>" in the temp dir.
  - This Stop hook sums token usage across assistant messages that landed
    since the last Stop (tracked via "dashclaw_stop_cursor_<session_id>"),
    distributes the totals evenly across the turn's action_ids, and PATCHes
    each action with tokens_in, tokens_out, and model. The server then
    derives cost_estimate from its pricing table.

This file is the orchestrator; the mechanics live in the sibling intel
package (extracted in the health pass so each seam is unit-testable):
  - dashclaw_agent_intel.stop_transcript — transcript parsing, turn/usage
    math, tool_use collection, assumption extraction, distribution.
  - dashclaw_agent_intel.stop_state — tempdir session state (turn actions,
    cursor, posted-assumption keys, throttle markers).

Never blocks. Always exits 0.
"""

import hashlib
import json
import os
import re
import sys
import tempfile
import urllib.request
import urllib.error

# Import the shared HTTP retry helper from the sibling intel package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel.http_client import request_with_retry
from dashclaw_agent_intel.stop_state import (
    log_hook_error as _log_hook_error,
    read_cursor as _read_cursor,
    write_cursor as _write_cursor,
    read_turn_actions as _read_turn_actions,
    clear_turn_actions as _clear_turn_actions,
    read_posted_assumption_keys as _read_posted_assumption_keys,
    append_posted_assumption_keys as _append_posted_assumption_keys,
    count_session_actions as _count_session_actions,
)
from dashclaw_agent_intel.stop_transcript import (
    load_entries as _load_entries,
    resolve_turn_start as _resolve_turn_start,
    collect_turn_usage as _collect_turn_usage,
    collect_turn_tool_uses as _collect_turn_tool_uses,
    is_governed_tool_name as _is_governed_tool_name,
    turn_assistant_text as _turn_assistant_text,
    extract_assumptions as _extract_assumptions,
    distribute as _distribute,
    patch_body_for as _patch_body_for,
    datetime_now_iso,
)

# ---------------------------------------------------------------------------
# Env loading — pretool/posttool load from .env.local + .env before reading
# DASHCLAW_* config; stop needs the same so tokens actually PATCH back
# instead of hitting an empty URL with an empty API key. Without this,
# the Stop hook silently fails for every session that doesn't inherit
# the vars from the shell — which is most real Claude Code sessions.
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

def _argv_agent_id():
    # Per-harness identity declaration (roadmap v2.2): the harness integration
    # appends `--agent-id <id>` to the hook command line; argv beats the
    # machine-ambient DASHCLAW_AGENT_ID env var. Mirrors dashclaw_pretool.py.
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--agent-id" and i + 1 < len(argv):
            return argv[i + 1].strip()
        if arg.startswith("--agent-id="):
            return arg.split("=", 1)[1].strip()
    return ""


BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
AGENT_ID = _argv_agent_id() or os.environ.get("DASHCLAW_AGENT_ID") or "claude-code"
# Opt-in: on text-only turns (tokens present but no tool calls → no action_ids)
# create a synthetic `action_type='conversation'` action so the spend lands in
# analytics instead of just in the orphan-tokens drift log. Default off to
# avoid ledger inflation for users who only want tool-call governance.
TRACK_TEXT_TURNS = (os.environ.get("DASHCLAW_TRACK_TEXT_TURNS") or "").strip() in ("1", "true", "yes")


# ---------------------------------------------------------------------------
# Action HTTP calls
# ---------------------------------------------------------------------------

def _missing_config_suffix():
    """The '... missing DASHCLAW_BASE_URL and DASHCLAW_API_KEY (check .env.local)'
    tail shared by the POST/PATCH skip-logs. Only call when config is missing."""
    return (
        "skipped: missing " +
        ("DASHCLAW_BASE_URL" if not BASE_URL else "") +
        (" and " if not BASE_URL and not API_KEY else "") +
        ("DASHCLAW_API_KEY" if not API_KEY else "") +
        " (check .env.local)"
    )


def _build_action_request(url, body, method):
    """Build a JSON urllib request with the standard DashClaw auth headers."""
    return urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        method=method,
    )


def _post_action(body):
    """POST /api/actions. Returns action_id on success, None on failure."""
    if not BASE_URL or not API_KEY:
        _log_hook_error("POST /api/actions -> " + _missing_config_suffix())
        return None
    req = _build_action_request(BASE_URL + "/api/actions", body, "POST")
    try:
        body_bytes = request_with_retry(req, timeout=3)
        payload = json.loads(body_bytes.decode("utf-8"))
    except urllib.error.HTTPError as e:
        _log_hook_error("POST /api/actions -> HTTP " + str(e.code))
        return None
    except Exception as e:
        _log_hook_error("POST /api/actions -> " + type(e).__name__ + ": " + str(e))
        return None
    action = payload.get("action") or payload
    if isinstance(action, dict):
        return action.get("action_id")
    return None


def _create_text_only_action(tokens_in, tokens_out, model, session_id):
    """Create a synthetic `action_type='conversation'` action so the tokens
    from a text-only turn land in analytics. Opt-in via DASHCLAW_TRACK_TEXT_TURNS.

    Returns action_id on success, None on failure. Server derives cost from
    tokens + model at POST time via the same pricing path as tool actions."""
    body = {
        "agent_id": AGENT_ID,
        "action_type": "conversation",
        "declared_goal": "Text-only assistant response",
        "risk_score": 0,
        "reversible": True,
        "systems_touched": [],
        "status": "completed",
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "output_summary": "Recorded by Stop hook (text-only turn)",
        "timestamp_end": datetime_now_iso(),
    }
    if model:
        body["model"] = model
    if session_id:
        # Keep the raw session_id for cross-referencing; server doesn't use it
        # for path routing so no sanitization needed.
        body["trigger"] = "session:" + session_id
    return _post_action(body)


def _patch_action(action_id, body):
    """PATCH /api/actions/{action_id}. Failures log and return; never block."""
    if not BASE_URL or not API_KEY:
        _log_hook_error("PATCH " + action_id + " -> " + _missing_config_suffix())
        return
    req = _build_action_request(BASE_URL + "/api/actions/" + action_id, body, "PATCH")
    try:
        request_with_retry(req, timeout=3)
    except urllib.error.HTTPError as e:
        _log_hook_error("PATCH " + action_id + " -> HTTP " + str(e.code))
    except Exception as e:
        _log_hook_error("PATCH " + action_id + " -> " + type(e).__name__ + ": " + str(e))


def _log_orphan_tokens(tokens_in, tokens_out, model, session_id, suffix=""):
    """Log a turn's spend that couldn't be attributed to any action_id."""
    _log_hook_error(
        "orphan_tokens session=" + (session_id or "?")
        + " tokens_in=" + str(tokens_in)
        + " tokens_out=" + str(tokens_out)
        + " model=" + (model or "unknown")
        + suffix
    )


def _apply_text_only(tokens_in, tokens_out, model, session_id):
    """Handle a turn with token usage but no action_ids (text-only assistant
    turn). Either creates a synthetic `conversation` action (opt-in) or logs
    the orphaned spend so ops can see it was dropped."""
    if TRACK_TEXT_TURNS:
        # Opt-in path: create a synthetic `conversation` action and let
        # tokens land there. Cost is derived server-side from tokens + model.
        created = _create_text_only_action(tokens_in, tokens_out, model, session_id)
        if not created:
            # POST failed — log so ops can see we dropped this turn's spend.
            _log_orphan_tokens(
                tokens_in, tokens_out, model, session_id,
                " (TRACK_TEXT_TURNS=1 but POST /api/actions failed)",
            )
        return
    # Default path: log and drop. Ops can enable tracking via
    # DASHCLAW_TRACK_TEXT_TURNS=1 if they want these in the ledger.
    _log_orphan_tokens(tokens_in, tokens_out, model, session_id)


def _apply(action_ids, tokens_in, tokens_out, model, session_id=""):
    """Distribute token usage across the turn's action_ids and request a
    server-side conditional close on each.

    The server honors `close_if_running: true` atomically — close fields
    (status/output_summary/timestamp_end) only apply when the row is still
    `running`, so a concurrent PostToolUse PATCH can never be clobbered. Token
    fields apply unconditionally via COALESCE. Safe to send on every action —
    no per-action GET required."""
    has_tokens = tokens_in > 0 or tokens_out > 0
    if not action_ids:
        # Text-only assistant turns have no tool calls, so there are no
        # action_ids to attribute usage against.
        if not has_tokens:
            return
        _apply_text_only(tokens_in, tokens_out, model, session_id)
        return
    n = len(action_ids)
    in_parts = _distribute(tokens_in, n) if has_tokens else [0] * n
    out_parts = _distribute(tokens_out, n) if has_tokens else [0] * n
    ts_end = datetime_now_iso()
    for idx, aid in enumerate(action_ids):
        body = _patch_body_for(in_parts[idx], out_parts[idx], model, has_tokens, ts_end)
        _patch_action(aid, body)


# ---------------------------------------------------------------------------
# Coverage truth (v4.2) — Stop-hook coverage report
#
# Per turn, report how many governed tool_use blocks the transcript actually
# shows (`expected`) against how many made it into the session's tool_use ->
# action_id map (`recorded`). Transcript ground truth is independent of
# whether Pre/PostToolUse fired, so a PreToolUse outage now lowers a number
# the server can see instead of silently thinning the ledger.
# ---------------------------------------------------------------------------

_SESSION_ID_RE = re.compile(r"[^A-Za-z0-9._-]")


def _read_turn_session_tool_map(session_id):
    """Read the (tool_use_id -> action_id) map dashclaw_pretool.py appended for
    this session (tab-separated, last write wins). {} on any read failure.
    Inlined from the retired code-session reporter so the KEEP /api/coverage
    counter no longer depends on it."""
    if not session_id:
        return {}
    safe = _SESSION_ID_RE.sub("_", session_id)
    path = os.path.join(tempfile.gettempdir(), "dashclaw_session_tool_map_" + safe)
    out = {}
    try:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.rstrip("\n")
                if not line or "\t" not in line:
                    continue
                tu, _, aid = line.partition("\t")
                tu = tu.strip()
                aid = aid.strip()
                if tu and aid:
                    out[tu] = aid
    except Exception:
        return {}
    return out


def _compute_coverage_counts(entries, start, session_id):
    """(expected, recorded) governed tool_use counts for this turn.

    expected = governed tool_use blocks the transcript shows; recorded = the
    subset with an action_id already in the session tool map (written by
    dashclaw_pretool.py's write_action_id). Fail-silent: (0, 0) on error so
    the caller skips the POST."""
    try:
        governed = [tu for tu in _collect_turn_tool_uses(entries, start) if _is_governed_tool_name(tu[1])]
        if not governed:
            return 0, 0
        tool_map = _read_turn_session_tool_map(session_id)
        recorded = sum(1 for tool_use_id, _ in governed if tool_use_id in tool_map)
        return len(governed), recorded
    except Exception:
        return 0, 0


def _post_coverage_report(session_id, expected, recorded):
    """POST one fail-silent report to /api/coverage. Never raises."""
    body = {
        "agent_id": AGENT_ID,
        "harness": "claude-code",
        "harness_session_id": session_id,
        "expected": expected,
        "recorded": recorded,
    }
    req = _build_action_request(BASE_URL + "/api/coverage", body, "POST")
    try:
        request_with_retry(req, timeout=3)
    except urllib.error.HTTPError as e:
        _log_hook_error("coverage -> HTTP " + str(e.code))
    except Exception as e:
        _log_hook_error("coverage -> " + type(e).__name__ + ": " + str(e))


def _maybe_report_coverage(entries, last_uuid, session_id):
    """Report this turn's expected-vs-recorded governed tool_use counts to
    POST /api/coverage. Skipped when the turn governed nothing — the quiet
    path stays quiet. Fail-silent end to end."""
    try:
        start = _resolve_turn_start(entries, last_uuid)
        expected, recorded = _compute_coverage_counts(entries, start, session_id)
        if expected == 0:
            return
        _post_coverage_report(session_id, expected, recorded)
    except Exception as e:
        _log_hook_error("coverage -> " + type(e).__name__ + ": " + str(e))


# ---------------------------------------------------------------------------
# Assumption auto-capture
#
# The global working agreement mandates agents surface assumptions in an exact
# block format ("ASSUMPTIONS I'M MAKING:" + numbered items). This extracts the
# block from the turn's assistant text (stop_transcript.extract_assumptions)
# and POSTs each item against the turn's first action_id. Only the exact
# header format is parsed (precision over recall), capped per turn, idempotent
# across hook re-runs via a per-session posted-keys file, and fail-silent.
# ---------------------------------------------------------------------------

def _post_assumption(action_id, assumption):
    """POST /api/assumptions. Returns True on success; logs and returns False
    on any failure (never blocks session end)."""
    body = {
        "action_id": action_id,
        "assumption": assumption,
        "basis": "auto-extracted from session transcript",
    }
    req = _build_action_request(BASE_URL + "/api/assumptions", body, "POST")
    try:
        request_with_retry(req, timeout=3)
        return True
    except urllib.error.HTTPError as e:
        _log_hook_error("POST /api/assumptions -> HTTP " + str(e.code))
        return False
    except Exception as e:
        _log_hook_error("POST /api/assumptions -> " + type(e).__name__ + ": " + str(e))
        return False


def _capture_assumptions(entries, last_uuid, action_ids, session_id):
    """Extract + ship the turn's stated assumptions. Skips text-only turns
    (POST requires a parent action). Fail-silent end to end."""
    try:
        if not action_ids:
            return
        start = _resolve_turn_start(entries, last_uuid)
        items = _extract_assumptions(_turn_assistant_text(entries, start))
        if not items:
            return
        parent_action = action_ids[0]
        posted = _read_posted_assumption_keys(session_id)
        new_keys = []
        for item in items:
            key = hashlib.sha1(
                (parent_action + "\x00" + item).encode("utf-8")
            ).hexdigest()
            if key in posted:
                continue
            if _post_assumption(parent_action, item):
                new_keys.append(key)
        _append_posted_assumption_keys(session_id, new_keys)
    except Exception as e:
        _log_hook_error("capture_assumptions -> " + type(e).__name__ + ": " + str(e))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

_STDIN_READ_ERROR = object()


def _read_stdin_payload():
    """Read+parse the Stop-hook JSON from stdin. Returns the parsed value, or
    the _STDIN_READ_ERROR sentinel on a read/parse error (caller exits 0 on the
    sentinel to preserve never-block). A successfully parsed-but-non-dict value
    is returned as-is so downstream behavior is unchanged."""
    try:
        raw = sys.stdin.buffer.read().decode("utf-8-sig").strip()
        return json.loads(raw) if raw else {}
    except Exception:
        return _STDIN_READ_ERROR


# ---------------------------------------------------------------------------
# End-of-turn recap (the "visible first session" line)
# ---------------------------------------------------------------------------

def _print_session_recap(turn_action_ids, session_id):
    """ONE stderr line after a turn with >=1 governed action; silent when the
    turn governed nothing (the quiet path stays quiet). Fail-silent."""
    if not turn_action_ids:
        return
    try:
        count = max(_count_session_actions(session_id), len(turn_action_ids))
        line = "[DashClaw] Governed %d action(s) this session · %s/decisions" % (count, BASE_URL)
        sys.stderr.write(line + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def main():
    if not BASE_URL or not API_KEY:
        sys.exit(0)

    data = _read_stdin_payload()
    if data is _STDIN_READ_ERROR:
        sys.exit(0)

    session_id = data.get("session_id") or ""
    transcript_path = data.get("transcript_path") or ""
    if not session_id:
        sys.exit(0)

    action_ids = _read_turn_actions(session_id)
    # Even if there are no turn actions we still advance the cursor so the
    # next turn starts clean.
    entries = _load_entries(transcript_path)
    last_uuid = _read_cursor(session_id)
    tokens_in, tokens_out, model, new_cursor = _collect_turn_usage(entries, last_uuid)

    _apply(action_ids, tokens_in, tokens_out, model, session_id)

    # Coverage truth (v4.2): report this turn's expected-vs-recorded governed
    # tool_use counts. Fail-silent; skipped when the turn governed nothing.
    _maybe_report_coverage(entries, last_uuid, session_id)

    # Assumption auto-capture: ship any "ASSUMPTIONS I'M MAKING:" items from
    # this turn's assistant text to /api/assumptions. Idempotent + fail-silent.
    _capture_assumptions(entries, last_uuid, action_ids, session_id)

    # Visible first session: one stderr recap line when this turn governed
    # anything (silent otherwise).
    _print_session_recap(action_ids, session_id)

    _write_cursor(session_id, new_cursor)
    _clear_turn_actions(session_id)
    sys.exit(0)


if __name__ == "__main__":
    main()
