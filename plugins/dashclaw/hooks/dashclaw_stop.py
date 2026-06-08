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

Never blocks. Always exits 0.
"""

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
from dashclaw_agent_intel import behavior_recorder

# ---------------------------------------------------------------------------
# Env loading — pretool/posttool load from .env.local + .env before reading
# DASHCLAW_* config; stop needs the same so tokens actually PATCH back
# instead of hitting an empty URL with an empty API key. Without this,
# the Stop hook silently fails for every session that doesn't inherit
# the vars from the shell — which is most real Claude Code sessions.
# ---------------------------------------------------------------------------

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
            try:
                with open(env_path, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        key, _, val = line.partition("=")
                        key = key.strip()
                        val = val.strip().strip('"').strip("'")
                        if " #" in val:
                            val = val[:val.index(" #")].strip()
                        if key and key not in os.environ:
                            os.environ[key] = val
            except FileNotFoundError:
                continue
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
AGENT_ID = os.environ.get("DASHCLAW_AGENT_ID") or "claude-code"
# Opt-in: on text-only turns (tokens present but no tool calls → no action_ids)
# create a synthetic `action_type='conversation'` action so the spend lands in
# analytics instead of just in the orphan-tokens drift log. Default off to
# avoid ledger inflation for users who only want tool-call governance.
TRACK_TEXT_TURNS = (os.environ.get("DASHCLAW_TRACK_TEXT_TURNS") or "").strip() in ("1", "true", "yes")
# Opt-in (Phase 3 — AgentLens absorption): when set, ship the turn's JSONL
# slice to POST /api/code-sessions/ingest-jsonl after the existing PATCH
# loop. Fail-silent: any error inside the reporter is logged and swallowed.
CODE_SESSIONS_ENABLED = (os.environ.get("DASHCLAW_CODE_SESSIONS_ENABLED") or "").strip().lower() in ("1", "true", "yes")

# Session IDs come from untrusted stdin. Before we use one as a temp-file
# suffix, replace anything outside this whitelist so a crafted session_id
# like "../etc/passwd" cannot escape the tempdir.
_SESSION_ID_RE = re.compile(r"[^A-Za-z0-9._-]")


def _safe_session_id(session_id):
    if not session_id:
        return ""
    return _SESSION_ID_RE.sub("_", session_id)


# ---------------------------------------------------------------------------
# Error logging — best-effort append to a shared tempdir log so ops can detect
# token-attribution drift (API-key rotation, base-URL typo, transient 5xx).
# ---------------------------------------------------------------------------

def _log_hook_error(message):
    try:
        path = os.path.join(tempfile.gettempdir(), "dashclaw_hook_errors.log")
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).isoformat()
        with open(path, "a", encoding="utf-8") as f:
            f.write(ts + " stop " + str(message) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# State files
# ---------------------------------------------------------------------------

def _turn_actions_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_turn_" + _safe_session_id(session_id))


def _cursor_path(session_id):
    return os.path.join(tempfile.gettempdir(), "dashclaw_stop_cursor_" + _safe_session_id(session_id))


def _read_cursor(session_id):
    try:
        with open(_cursor_path(session_id), encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def _write_cursor(session_id, uuid):
    if not uuid:
        return
    try:
        with open(_cursor_path(session_id), "w", encoding="utf-8") as f:
            f.write(uuid)
    except Exception:
        pass


def _read_turn_actions(session_id):
    try:
        with open(_turn_actions_path(session_id), encoding="utf-8") as f:
            ids = [ln.strip() for ln in f.readlines()]
    except Exception:
        return []
    # Preserve order, drop blanks and duplicates
    seen = set()
    out = []
    for aid in ids:
        if aid and aid not in seen:
            seen.add(aid)
            out.append(aid)
    return out


def _clear_turn_actions(session_id):
    try:
        os.remove(_turn_actions_path(session_id))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Transcript walk
# ---------------------------------------------------------------------------

def _load_entries(transcript_path):
    if not transcript_path or not os.path.exists(transcript_path):
        return []
    out = []
    try:
        with open(transcript_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        return []
    return out


def _index_after_last_user_prompt(entries):
    """Return the index of the first entry after the most recent real user
    prompt — i.e. the start of the current assistant turn.

    A "real" user prompt is a user entry whose content is a string, or whose
    content list has no tool_result blocks. Tool results are modeled as user
    messages but are not prompts."""
    for i in range(len(entries) - 1, -1, -1):
        e = entries[i]
        if e.get("type") != "user":
            continue
        msg = e.get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            return i + 1
        if isinstance(content, list):
            has_tool_result = any(
                isinstance(c, dict) and c.get("type") == "tool_result"
                for c in content
            )
            if not has_tool_result:
                return i + 1
    return 0


def _collect_turn_usage(entries, last_uuid):
    """Sum token usage and pick a model from assistant entries since last_uuid.

    Returns (tokens_in, tokens_out, model, new_cursor_uuid).
    If last_uuid is missing or not found, starts from the last user prompt."""
    start = -1
    if last_uuid:
        for i, e in enumerate(entries):
            if e.get("uuid") == last_uuid:
                start = i + 1
                break
    if start < 0:
        start = _index_after_last_user_prompt(entries)

    tokens_in = 0
    tokens_out = 0
    model = ""
    new_cursor = last_uuid
    for e in entries[start:]:
        if e.get("type") != "assistant":
            if e.get("uuid"):
                new_cursor = e["uuid"]
            continue
        msg = e.get("message") or {}
        usage = msg.get("usage") or {}
        # tokens_in is the "effective" input-token count used for cost:
        #   - regular input tokens        full price
        #   - cache_creation_input_tokens full price (~1.25x is close to 1x for 5m cache)
        #   - cache_read_input_tokens     10% price — apply the discount here so
        #                                 downstream cost derivation matches real billing
        tokens_in += int(usage.get("input_tokens") or 0)
        tokens_in += int(usage.get("cache_creation_input_tokens") or 0)
        cache_read = int(usage.get("cache_read_input_tokens") or 0)
        # Half-away-from-zero to match JS Math.round() in packages/openclaw-plugin/src/index.ts
        # so the same transcript produces the same token totals across both paths.
        # Python's built-in round() uses banker's rounding, which diverges on .5 boundaries.
        tokens_in += int(cache_read * 0.1 + 0.5)
        tokens_out += int(usage.get("output_tokens") or 0)
        if not model and msg.get("model"):
            model = msg["model"]
        if e.get("uuid"):
            new_cursor = e["uuid"]

    return tokens_in, tokens_out, model, new_cursor


# ---------------------------------------------------------------------------
# Distribution + HTTP
# ---------------------------------------------------------------------------

def _distribute(total, n):
    """Split `total` into `n` non-negative integers that sum to `total`.

    Early buckets get one extra when the split isn't even. n must be > 0."""
    base = total // n
    remainder = total - base * n
    return [base + (1 if i < remainder else 0) for i in range(n)]


def _post_action(body):
    """POST /api/actions. Returns action_id on success, None on failure."""
    if not BASE_URL or not API_KEY:
        _log_hook_error(
            "POST /api/actions -> skipped: missing " +
            ("DASHCLAW_BASE_URL" if not BASE_URL else "") +
            (" and " if not BASE_URL and not API_KEY else "") +
            ("DASHCLAW_API_KEY" if not API_KEY else "") +
            " (check .env.local)"
        )
        return None
    url = BASE_URL + "/api/actions"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        method="POST",
    )
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
        _log_hook_error(
            "PATCH " + action_id + " -> skipped: missing " +
            ("DASHCLAW_BASE_URL" if not BASE_URL else "") +
            (" and " if not BASE_URL and not API_KEY else "") +
            ("DASHCLAW_API_KEY" if not API_KEY else "") +
            " (check .env.local)"
        )
        return
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
        request_with_retry(req, timeout=3)
    except urllib.error.HTTPError as e:
        _log_hook_error("PATCH " + action_id + " -> HTTP " + str(e.code))
    except Exception as e:
        _log_hook_error("PATCH " + action_id + " -> " + type(e).__name__ + ": " + str(e))


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
        if TRACK_TEXT_TURNS:
            # Opt-in path: create a synthetic `conversation` action and let
            # tokens land there. Cost is derived server-side from tokens + model.
            created = _create_text_only_action(tokens_in, tokens_out, model, session_id)
            if not created:
                # POST failed — log so ops can see we dropped this turn's spend.
                _log_hook_error(
                    "orphan_tokens session=" + (session_id or "?")
                    + " tokens_in=" + str(tokens_in)
                    + " tokens_out=" + str(tokens_out)
                    + " model=" + (model or "unknown")
                    + " (TRACK_TEXT_TURNS=1 but POST /api/actions failed)"
                )
            return
        # Default path: log and drop. Ops can enable tracking via
        # DASHCLAW_TRACK_TEXT_TURNS=1 if they want these in the ledger.
        _log_hook_error(
            "orphan_tokens session=" + (session_id or "?")
            + " tokens_in=" + str(tokens_in)
            + " tokens_out=" + str(tokens_out)
            + " model=" + (model or "unknown")
        )
        return
    n = len(action_ids)
    in_parts = _distribute(tokens_in, n) if has_tokens else [0] * n
    out_parts = _distribute(tokens_out, n) if has_tokens else [0] * n
    ts_end = datetime_now_iso()
    for idx, aid in enumerate(action_ids):
        body = {
            "close_if_running": True,
            "status": "completed",
            "output_summary": "Auto-closed by Stop hook",
            "timestamp_end": ts_end,
        }
        if has_tokens:
            body["tokens_in"] = in_parts[idx]
            body["tokens_out"] = out_parts[idx]
            if model:
                body["model"] = model
        _patch_action(aid, body)


def datetime_now_iso():
    """ISO-8601 UTC timestamp with trailing Z — matches posttool convention."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Behavior Learning: flush any pending samples whose PostToolUse never fired
    # as 'interrupted' so early-stop doesn't lose data. Local-only + fail-silent,
    # so it must run BEFORE the server-config early-exit below.
    try:
        behavior_recorder.record_stop(os.environ.get("DASHCLAW_WORKSPACE"))
    except Exception:
        pass

    if not BASE_URL or not API_KEY:
        sys.exit(0)

    try:
        raw = sys.stdin.buffer.read().decode("utf-8-sig").strip()
        data = json.loads(raw) if raw else {}
    except Exception:
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

    if CODE_SESSIONS_ENABLED:
        try:
            from dashclaw_code_session_reporter import report_turn
            report_turn(
                base_url=BASE_URL,
                api_key=API_KEY,
                agent_id=AGENT_ID,
                session_id=session_id,
                transcript_path=transcript_path,
                entries=entries,
                previous_cursor=last_uuid,
                new_cursor=new_cursor,
            )
        except Exception as e:
            _log_hook_error("code_session_reporter -> " + type(e).__name__ + ": " + str(e))

    _write_cursor(session_id, new_cursor)
    _clear_turn_actions(session_id)
    sys.exit(0)


if __name__ == "__main__":
    main()
