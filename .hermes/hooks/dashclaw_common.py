"""
Shared helpers for the DashClaw Hermes-Agent hook adapters.

Keeps HTTP, env, and session-cache logic in one place so the six hook
scripts in this directory stay short. Standard library only — no
third-party imports — so the hook startup cost stays close to zero.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
# DASHCLAW_HERMES_AGENT_ID is the harness-specific declaration (roadmap
# v2.2); the generic var stays as a fallback for operators who configured
# it deliberately for Hermes.
AGENT_ID = (
    os.environ.get("DASHCLAW_HERMES_AGENT_ID")
    or os.environ.get("DASHCLAW_AGENT_ID")
    or "hermes"
)
WORKSPACE = os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd()

CACHE_DIR = Path.home() / ".dashclaw" / "hermes"

_SESSION_ID_RE = re.compile(r"[^A-Za-z0-9._-]")


def safe_session_id(session_id: str) -> str:
    """Sanitise a session id for filesystem use."""
    if not session_id:
        return ""
    return _SESSION_ID_RE.sub("_", session_id)


def cache_path(session_id: str, suffix: str = "session") -> Path:
    """Return the on-disk cache path for `(session_id, suffix)`."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{suffix}_{safe_session_id(session_id)}.json"


def read_cache(session_id: str, suffix: str = "session") -> dict:
    """Return the cached dict for this session, or `{}` on any failure."""
    try:
        with open(cache_path(session_id, suffix), encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_cache(session_id: str, data: dict, suffix: str = "session") -> None:
    """Write a cache dict for this session. Silent on failure."""
    try:
        with open(cache_path(session_id, suffix), "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass


def log_error(area: str, msg: str) -> None:
    """Best-effort append to ~/.dashclaw/hermes-hook-errors.log."""
    try:
        path = Path.home() / ".dashclaw" / "hermes-hook-errors.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{ts} {area} {msg}\n")
    except Exception:
        pass


def api_request(method: str, path: str, body=None, timeout: float = 5.0):
    """Make a DashClaw API request. Returns parsed JSON or `None` on any error."""
    if not BASE_URL or not API_KEY:
        return None
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        BASE_URL + path,
        data=data,
        headers={"Content-Type": "application/json", "x-api-key": API_KEY},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        log_error("api_request", f"{method} {path} -> HTTP {e.code}")
        return None
    except Exception as e:
        log_error("api_request", f"{method} {path} -> {type(e).__name__}: {e}")
        return None


def derive_slug(workspace: str = WORKSPACE) -> str:
    """Derive a stable code_projects slug from a workspace path."""
    if not workspace:
        return "unknown"
    last = workspace.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1] or "unknown"
    cleaned = "".join(c if c.isalnum() or c in "_.-" else "-" for c in last)
    return cleaned[:80] or "unknown"


def read_stdin_json() -> dict:
    """Read JSON from stdin, returning `{}` on failure."""
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def emit_noop() -> None:
    """Emit Hermes shell-hook no-op response to stdout."""
    sys.stdout.write("{}")


def emit_context(context: str) -> None:
    """Emit Hermes shell-hook context-injection response."""
    sys.stdout.write(json.dumps({"context": context}))


def emit_block(reason: str) -> None:
    """Emit Hermes shell-hook block response."""
    first_line = (reason or "Blocked").splitlines()[0]
    sys.stdout.write(json.dumps({"decision": "block", "reason": first_line}))


# ---------------------------------------------------------------------------
# Handoff helpers — POST /api/handoffs, GET /latest, POST /<id>/consume
# ---------------------------------------------------------------------------

def post_handoff_create(*, agent_id: str, project_id, bundle: dict):
    """POST /api/handoffs. Returns the new handoff id or None on failure."""
    try:
        resp = api_request(
            "POST",
            "/api/handoffs",
            body={
                "agent_id": agent_id,
                "project_id": project_id,
                "bundle": bundle,
            },
        )
        return (resp or {}).get("id")
    except Exception as exc:
        log_error("post_handoff_create", f"{type(exc).__name__}: {exc}")
        return None


def get_handoff_latest(*, agent_id: str, project_id=None):
    """GET /api/handoffs/latest. Returns the parsed response dict or None."""
    try:
        qs = f"agent_id={agent_id}"
        if project_id:
            qs += f"&project_id={project_id}"
        return api_request("GET", f"/api/handoffs/latest?{qs}")
    except Exception as exc:
        log_error("get_handoff_latest", f"{type(exc).__name__}: {exc}")
        return None


def post_handoff_consume(*, handoff_id: str, session_id=None) -> bool:
    """POST /api/handoffs/<id>/consume. Idempotent. Returns True on success."""
    try:
        result = api_request(
            "POST",
            f"/api/handoffs/{handoff_id}/consume",
            body={"session_id": session_id} if session_id else {},
        )
        return result is not None
    except Exception as exc:
        log_error("post_handoff_consume", f"{type(exc).__name__}: {exc}")
        return False
