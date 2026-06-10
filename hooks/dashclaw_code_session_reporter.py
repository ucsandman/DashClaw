#!/usr/bin/env python3
"""
DashClaw Code Sessions reporter — Stop-hook helper that ships the turn's
JSONL slice (plus the tool_use -> action_id map) to
POST /api/code-sessions/ingest-jsonl.

Opt-in: dashclaw_stop.py only imports this module when
DASHCLAW_CODE_SESSIONS_ENABLED is set to 1/true/yes. Fail-silent: every
exit path is wrapped in try/except so a misconfigured base URL or
unreachable server never breaks the Stop hook contract.
"""

import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel.http_client import request_with_retry  # noqa: E402


_SESSION_ID_RE = re.compile(r"[^A-Za-z0-9._-]")


def _safe_session_id(session_id):
    if not session_id:
        return ""
    return _SESSION_ID_RE.sub("_", session_id)


def _log_hook_error(message):
    try:
        path = os.path.join(tempfile.gettempdir(), "dashclaw_hook_errors.log")
        ts = datetime.now(timezone.utc).isoformat()
        with open(path, "a", encoding="utf-8") as f:
            f.write(ts + " code_session_reporter " + str(message) + "\n")
    except Exception:
        pass


def _iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Session-scoped tool_use -> action_id mapping (written by dashclaw_pretool)
# ---------------------------------------------------------------------------

def _session_tool_map_path(session_id):
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_session_tool_map_" + _safe_session_id(session_id),
    )


def _read_session_tool_map(session_id):
    """Read the (tool_use_id, action_id) pairs accumulated for this session.

    File format: tab-separated lines written by `write_action_id` in
    dashclaw_pretool.py. Returns a dict; last write wins per tool_use_id.
    """
    path = _session_tool_map_path(session_id)
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


def _clear_session_tool_map(session_id):
    try:
        os.remove(_session_tool_map_path(session_id))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Payload privacy — metadata/token-counts only by default
# ---------------------------------------------------------------------------
# With ingest ON by default, the payload must not carry prompt text. The
# redaction below keeps the structure the server parser needs (sessionId,
# uuids, timestamps, usage blocks, models, tool_use ids + names) and strips
# every field that can carry prompt/file/tool text. Shipping full content is
# an explicit opt-in via DASHCLAW_CODE_SESSIONS_CONTENT=full.

# Tool-input keys that are pure metadata (never file/prompt content).
_SAFE_TOOL_INPUT_KEYS = ("file_path", "path", "notebook_path")


def _content_mode():
    """'metadata' (default — prompt text stripped) or 'full' (explicit opt-in)."""
    raw = (os.environ.get("DASHCLAW_CODE_SESSIONS_CONTENT") or "").strip().lower()
    return "full" if raw == "full" else "metadata"


def _redact_content_block(block):
    if not isinstance(block, dict):
        return {"type": "redacted"}
    btype = block.get("type")
    out = dict(block)
    if btype == "text":
        out["text"] = ""
    elif btype == "thinking":
        out["thinking"] = ""
        out.pop("signature", None)
    elif btype == "tool_use":
        raw_input = out.get("input")
        safe = {}
        if isinstance(raw_input, dict):
            for k in _SAFE_TOOL_INPUT_KEYS:
                if isinstance(raw_input.get(k), str):
                    safe[k] = raw_input[k]
        out["input"] = safe
    elif btype == "tool_result":
        out["content"] = ""
    else:
        # Unknown block type — strip every value that could carry text.
        for k, v in list(out.items()):
            if isinstance(v, str) and k not in ("type", "id", "name", "tool_use_id"):
                out[k] = ""
            elif isinstance(v, (list, dict)):
                out[k] = [] if isinstance(v, list) else {}
    return out


def _redact_record(rec):
    out = dict(rec)
    msg = out.get("message")
    if isinstance(msg, dict):
        m = dict(msg)
        content = m.get("content")
        if isinstance(content, str):
            m["content"] = ""
        elif isinstance(content, list):
            m["content"] = [_redact_content_block(b) for b in content]
        out["message"] = m
    # Entry-level fields that carry prompt/result text in Claude Code JSONL.
    for key in ("toolUseResult", "summary"):
        if key in out:
            out[key] = "" if isinstance(out.get(key), str) else {}
    return out


def _redact_line(raw):
    """Return the metadata-only serialization of one raw JSONL line, or None
    when the line is unparseable (we refuse to ship raw unknown text)."""
    try:
        rec = json.loads(raw)
    except Exception:
        return None
    if not isinstance(rec, dict):
        return None
    try:
        return json.dumps(_redact_record(rec))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# JSONL slice + payload
# ---------------------------------------------------------------------------

def _collect_new_raw_lines(transcript_path, previous_cursor):
    """Re-open the transcript and return raw lines (strings) after the entry
    whose `uuid` matched `previous_cursor`. If no cursor is provided or it
    can't be located, returns every non-empty line.
    """
    if not transcript_path or not os.path.exists(transcript_path):
        return []
    new_lines = []
    cursor_seen = not previous_cursor  # if no cursor, all lines are "new"
    try:
        with open(transcript_path, encoding="utf-8") as f:
            for raw in f:
                stripped = raw.strip()
                if not stripped:
                    continue
                if not cursor_seen:
                    # Skip lines until we find the cursor entry. Parse each
                    # line just enough to compare uuids.
                    try:
                        rec = json.loads(stripped)
                    except Exception:
                        continue
                    if rec.get("uuid") == previous_cursor:
                        cursor_seen = True
                    continue
                new_lines.append(stripped)
    except Exception:
        return []
    return new_lines


def _collect_tool_use_action_map(session_id, raw_lines):
    """Intersect the session-scoped (tool_use_id, action_id) map with the
    tool_use ids actually referenced in this turn's raw lines. Trims the
    payload so we don't ship stale entries from earlier turns.
    """
    full_map = _read_session_tool_map(session_id)
    if not full_map:
        return {}
    out = {}
    for raw in raw_lines:
        try:
            rec = json.loads(raw)
        except Exception:
            continue
        msg = rec.get("message") if isinstance(rec, dict) else None
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") != "tool_use":
                continue
            tool_use_id = block.get("id")
            if not tool_use_id:
                continue
            mapped = full_map.get(tool_use_id)
            if mapped:
                out[tool_use_id] = mapped
    return out


def _derive_project_slug(transcript_path):
    """Per addendum #3 in AGENTLENS_INTEGRATION_GOAL.md: slug =
    basename(dirname(transcript_path)). Claude Code lays JSONL files out
    as ~/.claude/projects/<slug>/<session>.jsonl, so the parent directory
    name is the canonical project identifier."""
    if not transcript_path:
        return None
    parent = os.path.dirname(transcript_path)
    if not parent:
        return None
    return os.path.basename(parent) or None


def _post_ingest(base_url, api_key, body, timeout=3):
    url = base_url.rstrip("/") + "/api/code-sessions/ingest-jsonl"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
        },
        method="POST",
    )
    body_bytes = request_with_retry(req, timeout=timeout)
    return json.loads(body_bytes.decode("utf-8")) if body_bytes else None


# ---------------------------------------------------------------------------
# Public entry point — called by dashclaw_stop.py
# ---------------------------------------------------------------------------

def report_turn(base_url, api_key, agent_id, session_id, transcript_path,
                entries, previous_cursor, new_cursor):
    """Ship the JSONL slice since `previous_cursor` to the ingest endpoint.

    Fail-silent: catches everything, logs to dashclaw_hook_errors.log, and
    returns. Never raises. `entries` is the pre-parsed list (passed for
    cheap signaling — we re-read raw lines from disk because the server
    needs raw bytes, not parsed JSON).

    Returns the parsed ingest response dict (truthy) on a successful POST,
    False otherwise. The Stop hook uses session.id from the response to
    fetch the session's cost for the end-of-turn recap line.
    """
    try:
        if not base_url or not api_key:
            return False
        if not session_id or not transcript_path:
            return False

        new_lines = _collect_new_raw_lines(transcript_path, previous_cursor)
        if not new_lines:
            return False

        tool_use_action_map = _collect_tool_use_action_map(session_id, new_lines)

        # Default privacy posture: metadata/token-counts only. Full content
        # is an explicit opt-in (DASHCLAW_CODE_SESSIONS_CONTENT=full).
        if _content_mode() != "full":
            new_lines = [ln for ln in (_redact_line(raw) for raw in new_lines) if ln is not None]
            if not new_lines:
                return False

        cwd = None
        if isinstance(entries, list):
            for entry in entries:
                if isinstance(entry, dict) and isinstance(entry.get("cwd"), str):
                    cwd = entry["cwd"]
                    break

        body = {
            "project": {
                "slug": _derive_project_slug(transcript_path),
                "cwd": cwd,
                "source_host": "hook",
            },
            "session_uuid": session_id,
            "source_file": transcript_path,
            "source_mtime": _iso_now(),
            "jsonl_lines": new_lines,
            "tool_use_action_map": tool_use_action_map,
        }

        try:
            response = _post_ingest(base_url, api_key, body)
        except urllib.error.HTTPError as e:
            _log_hook_error("POST /api/code-sessions/ingest-jsonl -> HTTP " + str(e.code))
            return False
        except Exception as e:
            _log_hook_error("POST /api/code-sessions/ingest-jsonl -> " + type(e).__name__ + ": " + str(e))
            return False

        # On success we leave the session tool-map alone so any tool_use_id
        # that fires across multiple turns stays mapped. The map only gets
        # cleared at session end (Stop hook's existing _clear_turn_actions
        # handles the per-turn slate; the cross-turn map is best-effort
        # bounded by tempdir cleanup policy).
        return response if isinstance(response, dict) else True
    except Exception as e:
        _log_hook_error("report_turn -> " + type(e).__name__ + ": " + str(e))
        return False
