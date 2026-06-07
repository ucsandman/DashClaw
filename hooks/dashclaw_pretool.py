#!/usr/bin/env python3
"""
DashClaw PreToolUse Hook v2 for Claude Code.

Evaluates all 40+ agent tool calls against DashClaw guard policies
using the dashclaw_agent_intel module for semantic classification.

Exit codes:
  0 - Allow the tool to proceed
  2 - Block the tool (Claude Code shows stderr to user)
"""

import hashlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Load .env file (C:/Projects/DashClaw/.env) before reading config.
# Values already in the environment take precedence.
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
# Import dashclaw_agent_intel (sibling directory)
# ---------------------------------------------------------------------------

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel import classify_bash, scan_file_operation, classify_tool, McpHealthMonitor
from dashclaw_agent_intel.http_client import request_with_retry
from dashclaw_agent_intel import behavior_recorder

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
AGENT_ID = os.environ.get("DASHCLAW_AGENT_ID") or "claude-code"
HOOK_MODE = os.environ.get("DASHCLAW_HOOK_MODE") or "enforce"
WORKSPACE = os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd()
PERMISSION_MODE = os.environ.get("DASHCLAW_PERMISSION_MODE") or "danger"
GUARD_TIMEOUT = float(os.environ.get("DASHCLAW_GUARD_TIMEOUT") or "5")
APPROVAL_TIMEOUT = float(os.environ.get("DASHCLAW_APPROVAL_TIMEOUT") or "30")
GUARD_UNAVAILABLE_POLICY = (os.environ.get("DASHCLAW_GUARD_UNAVAILABLE_POLICY") or "block").lower()
# provenance (default): record sub-agent identity as provenance; the governed
# agent_id stays the parent. distinct: emit a composed agent_id
# (<parent>:<agent_type>) so sub-agents are distinct fleet identities (the server
# falls back to the parent's pairing/permissions). See
# docs/rfcs/2026-06-01-subagent-fleet-identities.md.
SUBAGENT_IDENTITY = (os.environ.get("DASHCLAW_SUBAGENT_IDENTITY") or "provenance").lower()

# todo-001: one-shot demo-mode probe to surface a misrouted DASHCLAW_BASE_URL
# (e.g. a stale env var pointing at a local sandbox) before the operator burns
# 30 minutes debugging fixture decisions as if they were real policies. The
# probe is cached per-URL so we only pay the HTTP cost once per TTL window;
# changing BASE_URL forces a fresh check because the cache key includes the URL.
DEMO_CHECK_TTL_SECONDS = 15 * 60
DEMO_CHECK_TIMEOUT_SECONDS = 0.5

# ---------------------------------------------------------------------------
# Intent-to-action_type mapping
# ---------------------------------------------------------------------------

_INTENT_TO_ACTION: dict[str, str] = {
    "readonly": "review",
    "write": "apply",
    "destructive": "security",
    "network": "api",
    "process_management": "security",
    "package_management": "build",
    "system_admin": "deploy",
    "unknown": "other",
}

# ---------------------------------------------------------------------------
# File-modifying tool names that trigger file scanning
# ---------------------------------------------------------------------------

_FILE_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "NotebookEdit"})


def log(msg):
    """Print to stderr (visible to Claude Code user)."""
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only, no third-party)
# ---------------------------------------------------------------------------

def api_request(method, path, body=None, timeout=None):
    """Make an HTTP request to the DashClaw API. Returns parsed JSON or None.

    Retries up to three times total with 0.4s then 0.8s backoff between
    attempts so a Vercel or Neon cold start does not block the tool call.
    See dashclaw_agent_intel.http_client for the retry shape.
    """
    if timeout is None:
        timeout = GUARD_TIMEOUT
    url = BASE_URL + path
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        method=method,
    )
    try:
        body_bytes = request_with_retry(req, timeout=timeout)
        return json.loads(body_bytes.decode("utf-8"))
    except Exception:
        return None


def guard_check(context):
    """POST /api/guard. Returns response dict or None on failure."""
    return api_request("POST", "/api/guard", body=context)


def create_action(context, status="running"):
    """POST /api/actions. Returns response dict or None on failure."""
    payload = dict(context)
    payload["status"] = status
    return api_request("POST", "/api/actions", body=payload)


def get_action(action_id):
    """GET /api/actions/<id>. Returns response dict or None."""
    return api_request("GET", "/api/actions/" + action_id, timeout=3)


# ---------------------------------------------------------------------------
# Intel enrichment
# ---------------------------------------------------------------------------

def _enrich_bash(tool_input: dict, tool_info: dict) -> dict:
    """Run bash classifier and build enriched intel for a Bash tool call."""
    command = tool_input.get("command") or ""
    bash_intel = classify_bash(command, mode=PERMISSION_MODE, workspace=WORKSPACE)

    # Map bash intent to action_type
    action_type = _INTENT_TO_ACTION.get(bash_intel["intent"], "other")

    # Risk scoring. Trust the per-command classifier for recognized intents; fall
    # back to the Bash tool's blunt base_risk only for an 'unknown' (unparseable)
    # command. The previous max(base_risk, score) pinned EVERY bash call to the 70
    # base, so a readonly `echo hello` reported 70 — defeating the semantic
    # classifier this module exists to provide.
    base_risk = tool_info["risk_profile"]["base_risk"]
    intent = bash_intel["intent"]
    if intent == "unknown":
        risk_score = max(base_risk, bash_intel["risk_score"])
    else:
        risk_score = bash_intel["risk_score"]

    parsed = bash_intel.get("parsed", {})
    targets = parsed.get("targets", [])
    redirections = parsed.get("redirections", [])
    redirect_targets = [r.get("target", "") for r in redirections]
    all_paths = list(targets) + redirect_targets

    # A shell redirection writes to a file even when the command itself (echo/cat)
    # classifies as readonly, so a low readonly score must not hide the write.
    if redirections and risk_score < 35:
        risk_score = 35

    # Boost for path traversal in any target.
    for path in all_paths:
        if ".." in path.replace("\\", "/").split("/"):
            risk_score += 20
            break
    # Boost for sensitive targets (.env, keys, credentials).
    for path in all_paths:
        if _is_sensitive_path(path):
            risk_score += 15
            break
    # Escalate redirections that WRITE into a protected system location (e.g.
    # `echo x > /etc/passwd`) — dangerous even though `echo` classifies as readonly.
    for path in redirect_targets:
        if _is_system_path(path):
            risk_score = max(risk_score, 75)
            break

    risk_score = min(risk_score, 100)

    return {
        "action_type": action_type,
        "risk_score": risk_score,
        "reversible": bash_intel["reversible"],
        "declared_goal": "Bash: " + command[:120],
        # A shell redirection target is a write path; forward it as `target` so a
        # protected_path policy can gate `echo secret > app/secrets/x` style writes.
        "target": redirect_targets[0] if redirect_targets else None,
        "intel": {
            "bash": {
                "intent": bash_intel["intent"],
                "risk_score": bash_intel["risk_score"],
                "reversible": bash_intel["reversible"],
                "validations": bash_intel["validations"],
            },
        },
    }


def _enrich_file(tool_name: str, tool_input: dict, tool_info: dict) -> dict:
    """Run file scanner and build enriched intel for a file tool call."""
    path = tool_input.get("file_path") or tool_input.get("path") or "unknown"
    content = tool_input.get("content") or ""

    file_intel = scan_file_operation(path, content, workspace=WORKSPACE)

    # Determine action_type from file characteristics
    if file_intel["sensitive_path"]:
        action_type = "security"
    else:
        action_type = "apply"

    # Risk from tool base
    base_risk = tool_info["risk_profile"]["base_risk"]
    risk_score = base_risk

    # Boost for traversal or outside workspace
    if file_intel["traversal_detected"] or file_intel["outside_workspace"]:
        risk_score += 20
    # Boost for sensitive file
    if file_intel["sensitive_path"]:
        risk_score += 15

    risk_score = min(risk_score, 100)

    return {
        "action_type": action_type,
        "risk_score": risk_score,
        "reversible": True,
        "declared_goal": "%s: %s" % (tool_name, path),
        # `target` is forwarded into the guard context so a protected_path policy
        # (Behavior Learning) can match the file being written. It is the only
        # path field that survives guard input validation.
        "target": path,
        "intel": {
            "file": {
                "traversal_detected": file_intel["traversal_detected"],
                "outside_workspace": file_intel["outside_workspace"],
                "sensitive_path": file_intel["sensitive_path"],
                "sensitive_pattern": file_intel["sensitive_pattern"],
                "binary_detected": file_intel["binary_detected"],
                "size_bytes": file_intel["size_bytes"],
                "resolved_path": file_intel["resolved_path"],
            },
        },
    }


def _enrich_mcp(tool_name: str, tool_input: dict, tool_info: dict) -> dict:
    """Check MCP server health and build enriched intel for an mcp__ tool."""
    # Extract server name: mcp__<server>__<method>
    parts = tool_name.split("__")
    server_name = parts[1] if len(parts) >= 2 else "unknown"

    monitor = McpHealthMonitor.from_state_file()
    health = monitor.check(server_name)

    base_risk = tool_info["risk_profile"]["base_risk"]
    risk_score = base_risk

    # Unhealthy servers get a risk boost
    if not health["healthy"]:
        risk_score += 15

    risk_score = min(risk_score, 100)

    return {
        "action_type": "api",
        "risk_score": risk_score,
        "reversible": True,
        "declared_goal": "MCP: %s" % tool_name,
        "intel": {
            "mcp": {
                "server": health["server"],
                "status": health["status"],
                "healthy": health["healthy"],
                "error": health["error"],
            },
        },
    }


def _enrich_default(tool_name: str, tool_input: dict, tool_info: dict) -> dict:
    """Build intel context for any other governed tool."""
    base_risk = tool_info["risk_profile"]["base_risk"]
    category = tool_info["category"]

    # Map category to a reasonable action_type
    category_action_map = {
        "execution": "security",
        "orchestration": "orchestration",
        "file_io": "apply",
        "interactive": "other",
        "mcp": "api",
        "unknown": "other",
    }
    action_type = category_action_map.get(category, "other")

    return {
        "action_type": action_type,
        "risk_score": base_risk,
        "reversible": True,
        "declared_goal": "%s: %s" % (tool_name, json.dumps(tool_input)[:120]),
        "intel": {},
    }


def _is_sensitive_path(path: str) -> bool:
    """Quick check if a path string matches common sensitive patterns."""
    lower = path.lower()
    for pattern in (".env", "secret", "credential", "private_key", ".pem", "id_rsa", ".key"):
        if pattern in lower:
            return True
    return False


def _is_system_path(path: str) -> bool:
    """True if a path targets a protected system location (/etc, /usr, /bin, ...).

    Used to escalate shell redirections that WRITE into system locations — those
    are dangerous even when the command (echo/printf) classifies as readonly.
    """
    norm = path.replace("\\", "/").strip().strip('"').strip("'")
    for prefix in ("/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64",
                   "/boot", "/sys", "/proc", "/var", "/opt", "/dev"):
        if norm == prefix or norm.startswith(prefix + "/"):
            return True
    return False


def _subagent_id_segment(s):
    """Slugify an agent_type into a safe segment for a `<parent>:<segment>` id."""
    out = "".join(c if (c.isalnum() or c in "-_") else "-" for c in (s or "").lower())
    return out.strip("-")[:64] or "subagent"


# ---------------------------------------------------------------------------
# Temp file for passing action_id to PostToolUse
# ---------------------------------------------------------------------------

def write_action_id(tool_use_id, action_id):
    """Write action_id to a temp file keyed by tool_use_id.

    Also appends the (tool_use_id, action_id) pair to a per-session mapping
    log so the Stop hook's code-session reporter can populate the
    `tool_use_action_map` field in POST /api/code-sessions/ingest-jsonl.
    PostToolUse cleans up the per-tool_use_id file after PATCHing, so the
    session-scoped log is the only persistent record of which Claude Code
    tool calls correspond to which DashClaw action_records by the time
    Stop fires.
    """
    path = os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(action_id)
    except Exception:
        pass
    if _SESSION_ID and tool_use_id and action_id:
        _append_session_tool_map(_SESSION_ID, tool_use_id, action_id)


def _append_session_tool_map(session_id, tool_use_id, action_id):
    """Append "<tool_use_id>\\t<action_id>" to a per-session log used by the
    Stop hook's code-session reporter. Best-effort; never raises."""
    path = os.path.join(
        tempfile.gettempdir(),
        "dashclaw_session_tool_map_" + _safe_session_id(session_id),
    )
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(tool_use_id + "\t" + action_id + "\n")
    except Exception:
        pass


# Module-level session id; set from hook stdin in main() so handlers can
# route action_ids into the per-session turn log without threading it
# through every signature. Consumed by dashclaw_stop.py.
_SESSION_ID = ""


def _log_hook_error(message):
    """Best-effort append to the shared tempdir log so governance-runtime
    operators can detect token-attribution drift. Never raises."""
    try:
        path = os.path.join(tempfile.gettempdir(), "dashclaw_hook_errors.log")
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).isoformat()
        with open(path, "a", encoding="utf-8") as f:
            f.write(ts + " pretool " + str(message) + "\n")
    except Exception:
        pass


_SESSION_ID_RE = re.compile(r"[^A-Za-z0-9._-]")


def _safe_session_id(session_id):
    # Session IDs come from untrusted stdin. Before we use one as a temp-file
    # suffix, replace anything outside this whitelist so a crafted session_id
    # like "../etc/passwd" cannot escape the tempdir.
    if not session_id:
        return ""
    return _SESSION_ID_RE.sub("_", session_id)


def append_turn_action(session_id, action_id):
    """Append action_id to the per-session turn log consumed by the Stop hook.

    The Stop hook reads this file, distributes the turn's LLM token usage
    across each recorded action_id, then clears the file. Failures here mean
    tokens won't attribute to this action — log so ops can spot it."""
    if not session_id or not action_id:
        return
    path = os.path.join(tempfile.gettempdir(), "dashclaw_turn_" + _safe_session_id(session_id))
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(action_id + "\n")
    except Exception as e:
        _log_hook_error("append_turn_action(" + session_id + "): " + type(e).__name__ + ": " + str(e))


# ---------------------------------------------------------------------------
# Decision handlers
# ---------------------------------------------------------------------------

def handle_allow(context, tool_use_id):
    """Record the action and exit 0."""
    resp = create_action(context, status="running")
    if resp:
        action_id = (resp.get("action_id")
                     or (resp.get("action") or {}).get("action_id")
                     or "")
        if action_id:
            write_action_id(tool_use_id, action_id)
            append_turn_action(_SESSION_ID, action_id)
        else:
            # Governance server returned a response but no action_id — the Stop
            # hook will produce orphan_tokens for this turn. Log so ops can spot
            # the attribution gap instead of the failure disappearing silently.
            _log_hook_error("handle_allow: create_action returned no action_id; response=" + str(resp)[:200])
    else:
        _log_hook_error("handle_allow: create_action failed (None); tool proceeded without governance record")
    sys.exit(0)


def handle_warn(guard_resp, context, tool_use_id):
    """Print warning, record action, exit 0."""
    warnings = guard_resp.get("warnings") or guard_resp.get("reasons") or []
    msg = warnings[0] if warnings else "Policy warning"
    log("[DashClaw] Warning: " + msg)
    resp = create_action(context, status="running")
    if resp:
        action_id = (resp.get("action_id")
                     or (resp.get("action") or {}).get("action_id")
                     or "")
        if action_id:
            write_action_id(tool_use_id, action_id)
            append_turn_action(_SESSION_ID, action_id)
        else:
            _log_hook_error("handle_warn: create_action returned no action_id; response=" + str(resp)[:200])
    else:
        _log_hook_error("handle_warn: create_action failed (None); tool proceeded without governance record")
    sys.exit(0)


def handle_block(guard_resp, context):
    """Block in enforce mode, warn in observe mode. Always records the action."""
    reasons = guard_resp.get("reasons") or []
    policies = guard_resp.get("matched_policies") or []
    reason = reasons[0] if reasons else "Guard policy violation"
    policy = policies[0] if policies else "guard policy"

    # RECORD THE BLOCK — this was missing, causing blocks to vanish from the ledger
    # with zero audit trail (BUG-02, fixed 2026-04-11 in Phase 1.5).
    create_action(context, status="blocked")

    if HOOK_MODE == "observe":
        log("[DashClaw] [observe] Would block: " + reason)
        sys.exit(0)

    log("[DashClaw] Blocked by policy: " + reason)
    log("Policy: " + policy)
    log("Action: " + context["declared_goal"])
    log("Run 'dashclaw approvals' to review or override.")
    sys.exit(2)


def handle_require_approval(guard_resp, context, tool_use_id):
    """Create pending action, wait for approval, or block on timeout."""
    policies = guard_resp.get("matched_policies") or []
    policy = policies[0] if policies else "require_approval policy"

    resp = create_action(context, status="pending_approval")
    if not resp:
        log("[DashClaw] Could not create approval request, proceeding")
        sys.exit(0)

    action_id = (resp.get("action_id")
                 or (resp.get("action") or {}).get("action_id")
                 or "")
    if not action_id:
        log("[DashClaw] Could not create approval request, proceeding")
        sys.exit(0)

    if HOOK_MODE == "observe":
        log("[DashClaw] [observe] Would require approval for: " + context["declared_goal"])
        write_action_id(tool_use_id, action_id)
        append_turn_action(_SESSION_ID, action_id)
        sys.exit(0)

    log("[DashClaw] Approval required")
    log("Action ID: " + action_id)
    log("Goal:      " + context["declared_goal"])
    log("Policy:    " + policy)
    log("Replay:    " + BASE_URL + "/replay/" + action_id)
    log("")
    log("Approve from terminal: dashclaw approve " + action_id)
    log("Or visit the approval queue in your DashClaw dashboard.")
    log("Waiting for approval... (%ds timeout, then blocking)" % int(APPROVAL_TIMEOUT))

    deadline = time.time() + APPROVAL_TIMEOUT
    while time.time() < deadline:
        time.sleep(3)
        action_resp = get_action(action_id)
        if not action_resp:
            continue
        action = action_resp.get("action") or action_resp
        if action.get("approved_by"):
            write_action_id(tool_use_id, action_id)
            append_turn_action(_SESSION_ID, action_id)
            sys.exit(0)
        status = action.get("status", "")
        if status == "running":
            write_action_id(tool_use_id, action_id)
            append_turn_action(_SESSION_ID, action_id)
            sys.exit(0)
        if status in ("failed", "cancelled"):
            log("[DashClaw] Action denied by operator.")
            sys.exit(2)

    log("[DashClaw] Approval timeout. Blocking tool execution.")
    sys.exit(2)


def handle_guard_unavailable(context, tool_use_id):
    """Guard could not be reached. Behavior governed by DASHCLAW_GUARD_UNAVAILABLE_POLICY."""
    policy = GUARD_UNAVAILABLE_POLICY
    mode = HOOK_MODE

    # Write orphan log record for backfill regardless of policy — never lose audit
    orphan_path = os.path.join(os.path.expanduser("~"), ".dashclaw", "orphan-actions.jsonl")
    try:
        os.makedirs(os.path.dirname(orphan_path), exist_ok=True)
        from datetime import datetime, timezone
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "reason": "guard_unreachable",
            "base_url": BASE_URL,
            "agent_id": AGENT_ID,
            "context": context,
            "hook_mode": mode,
            "policy": policy,
        }
        with open(orphan_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as e:
        _log_hook_error("handle_guard_unavailable: orphan log write failed: " + type(e).__name__ + ": " + str(e))

    # Observe mode always proceeds (by definition — observe is "warn loudly, don't block")
    if mode == "observe":
        log("[DashClaw] [observe] Guard unreachable at " + BASE_URL + " after 3 attempts. Action logged to ~/.dashclaw/orphan-actions.jsonl for backfill.")
        log("Action: " + context.get("declared_goal", "unknown"))
        sys.exit(0)

    # Enforce mode: behavior governed by DASHCLAW_GUARD_UNAVAILABLE_POLICY
    if policy == "allow":
        log("[DashClaw] Guard unreachable at " + BASE_URL + " after 3 attempts; proceeding (DASHCLAW_GUARD_UNAVAILABLE_POLICY=allow).")
        log("Action logged to ~/.dashclaw/orphan-actions.jsonl for backfill.")
        sys.exit(0)

    if policy == "warn":
        log("[DashClaw] \u26a0 Guard unreachable at " + BASE_URL + " after 3 attempts; proceeding anyway (DASHCLAW_GUARD_UNAVAILABLE_POLICY=warn).")
        log("Action logged to ~/.dashclaw/orphan-actions.jsonl for backfill.")
        log("Set DASHCLAW_GUARD_UNAVAILABLE_POLICY=block to fail closed instead.")
        sys.exit(0)

    # Default: block (fail closed)
    log("[DashClaw] Blocked: guard at " + BASE_URL + " is unreachable after 3 attempts.")
    log("Action: " + context.get("declared_goal", "unknown"))
    log("This is by design — destructive actions must not proceed without governance.")
    log("To change: set DASHCLAW_GUARD_UNAVAILABLE_POLICY=warn or =allow (not recommended).")
    log("Action logged to ~/.dashclaw/orphan-actions.jsonl for backfill on guard recovery.")
    sys.exit(2)


# ---------------------------------------------------------------------------
# Demo-mode startup warning (todo-001)
# ---------------------------------------------------------------------------

def _demo_check_cache_path():
    url_hash = hashlib.sha256(BASE_URL.encode("utf-8")).hexdigest()[:16]
    return os.path.join(tempfile.gettempdir(), "dashclaw_health_check_" + url_hash)


def _read_demo_check_cache(path):
    """Return cached mode if fresh; None if missing, expired, or unreadable."""
    try:
        with open(path, encoding="utf-8") as f:
            ts_line, mode_line = f.read().strip().split("\n", 1)
        if time.time() - float(ts_line) < DEMO_CHECK_TTL_SECONDS:
            return mode_line.strip()
    except Exception:
        pass
    return None


def _write_demo_check_cache(path, mode):
    """Best-effort cache write; failures are silent (warning still surfaces)."""
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(str(time.time()) + "\n" + mode + "\n")
    except Exception:
        pass


def _probe_health_mode():
    """GET /api/health (no auth, no retries). Return mode string or None."""
    try:
        req = urllib.request.Request(
            BASE_URL + "/api/health",
            headers={"User-Agent": "dashclaw-hook-demo-check/1"},
        )
        with urllib.request.urlopen(req, timeout=DEMO_CHECK_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            mode = payload.get("mode")
            return mode if isinstance(mode, str) else "unknown"
    except Exception:
        return None


def _maybe_warn_demo_mode():
    """Surface a one-shot stderr warning when BASE_URL is in demo mode.

    Cache hit -> no warning (we already warned this cycle when the cache was
    written). Cache miss -> probe; if mode=='demo', warn. Any probe failure
    stays silent so a transient health blip does not add hook noise."""
    if not BASE_URL:
        return
    cache_path = _demo_check_cache_path()
    if _read_demo_check_cache(cache_path) is not None:
        return

    mode = _probe_health_mode()
    if mode is None:
        return

    _write_demo_check_cache(cache_path, mode)

    if mode == "demo":
        log("[DashClaw] ⚠ DASHCLAW_BASE_URL points to a demo-mode instance (" + BASE_URL + ").")
        log("           Governance decisions will come from fixture data, not your real policies.")
        log("           Set DASHCLAW_BASE_URL to your real instance to dogfood properly.")


# ---------------------------------------------------------------------------
# Skill auto-scan (out-of-the-box protection)
# ---------------------------------------------------------------------------
# When the agent loads a Skill, scan its files for embedded secrets and
# dangerous/injection patterns and WARN (never block — advisory by design, the
# operator stays in control). Reuses POST /api/skills/scan, which dedupes by
# content hash so repeat loads of an unchanged skill are cheap. Opt out with
# DASHCLAW_SKILL_SCAN=0.

_SKILL_SCAN_ENABLED = (os.environ.get("DASHCLAW_SKILL_SCAN") or "1") != "0"
_SKILL_TEXT_EXTS = (".md", ".txt", ".py", ".js", ".mjs", ".ts", ".json",
                    ".yaml", ".yml", ".sh", ".toml", ".rb", ".go")
_SKILL_SCAN_MAX_FILE = 100_000      # per-file byte cap
_SKILL_SCAN_MAX_TOTAL = 400_000     # total chars sent
_SKILL_SCAN_MAX_FILES = 50


def _resolve_skill_dir(skill_name):
    """Best-effort: find the on-disk directory for a loaded skill, or None.

    Only project- and user-level skill dirs are resolvable here; built-in or
    plugin-bundled skills we can't locate are skipped (nothing to scan). The
    leaf-name guard rejects path separators so a crafted skill name can't walk
    outside the skills dir."""
    leaf = (skill_name or "").split(":")[-1].strip()
    if not leaf or "/" in leaf or "\\" in leaf or ".." in leaf:
        return None
    roots = []
    proj = os.environ.get("CLAUDE_PROJECT_DIR") or WORKSPACE
    if proj:
        roots.append(os.path.join(proj, ".claude", "skills", leaf))
    roots.append(os.path.join(os.path.expanduser("~"), ".claude", "skills", leaf))
    for d in roots:
        if os.path.isdir(d):
            return d
    return None


def _collect_skill_files(skill_dir):
    """Read the skill's text files into a {relpath: content} map (capped)."""
    files = {}
    total = 0
    for root, _dirs, names in os.walk(skill_dir):
        for n in names:
            if not n.lower().endswith(_SKILL_TEXT_EXTS):
                continue
            fp = os.path.join(root, n)
            try:
                if os.path.getsize(fp) > _SKILL_SCAN_MAX_FILE:
                    continue
                with open(fp, encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except Exception:
                continue
            rel = os.path.relpath(fp, skill_dir).replace("\\", "/")
            files[rel] = content
            total += len(content)
            if total >= _SKILL_SCAN_MAX_TOTAL or len(files) >= _SKILL_SCAN_MAX_FILES:
                return files
    return files


def scan_skill_and_warn(tool_input):
    """Scan a loaded skill for secrets / dangerous patterns and warn.

    Advisory only: prints to stderr, never blocks, never raises."""
    if not _SKILL_SCAN_ENABLED:
        return
    try:
        skill_name = (tool_input.get("skill") or tool_input.get("name")
                      or tool_input.get("command") or "").strip()
        if not skill_name:
            return
        skill_dir = _resolve_skill_dir(skill_name)
        if not skill_dir:
            return
        files = _collect_skill_files(skill_dir)
        if not files:
            return
        resp = api_request("POST", "/api/skills/scan",
                           body={"skill_name": skill_name, "files": files})
        findings = (resp or {}).get("findings") or []
        if not findings:
            return
        high = any(f.get("severity") == "high" for f in findings)
        rules = ", ".join(sorted({f.get("rule_id", "issue") for f in findings}))
        sev_word = "secrets/dangerous code" if high else "suspicious patterns"
        log("[DashClaw] ⚠ Skill '%s' flagged by auto-scan (%s: %s). Review before trusting it."
            % (skill_name, sev_word, rules))
        for f in findings[:6]:
            loc = f.get("file") or ""
            line = f.get("line")
            where = (" — %s:%s" % (loc, line)) if loc else ""
            log("   - [%s] %s%s" % (f.get("severity") or "warn", f.get("rule_id") or "finding", where))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Exit silently when DashClaw isn't configured at all — someone who never set
    # it up must never see hook noise. But if EXACTLY ONE of the two is present,
    # the setup is half-done: surface a one-line reason so "nothing happened"
    # is diagnosable instead of an invisible exit (the #1 setup trap).
    if not BASE_URL or not API_KEY:
        if BASE_URL or API_KEY:
            missing = "DASHCLAW_API_KEY" if not API_KEY else "DASHCLAW_BASE_URL (or DASHCLAW_URL)"
            log("[DashClaw] ⚠ Governance hook is half-configured — %s is not set, so this action was NOT governed." % missing)
        sys.exit(0)

    # Surface a warning if the configured instance is in demo mode (todo-001).
    # Non-blocking: never exits or alters enforcement, only writes to stderr.
    _maybe_warn_demo_mode()

    # Parse stdin -- read as raw bytes and decode as UTF-8 to handle
    # Windows PowerShell which pipes UTF-8 BOM bytes through cp1252 stdin
    try:
        raw = sys.stdin.buffer.read().decode("utf-8-sig").strip()
        data = json.loads(raw) if raw else {}
    except Exception:
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    tool_use_id = data.get("tool_use_id") or "unknown"

    global _SESSION_ID
    _SESSION_ID = data.get("session_id") or ""

    # Skill loads aren't governed actions, but DashClaw scans them for embedded
    # secrets and dangerous/injection patterns and warns out of the box
    # (advisory; never blocks). Handled before the governance flow because Skill
    # is not in the governed-tool set.
    if tool_name == "Skill":
        scan_skill_and_warn(tool_input)
        sys.exit(0)

    # Step 1: Classify the tool using the intel module
    tool_info = classify_tool(tool_name, tool_input)

    # Step 2: If not governed, exit 0 immediately
    if not tool_info["governed"]:
        sys.exit(0)

    # Step 3: Build enriched intel context based on tool type
    if tool_name == "Bash":
        enrichment = _enrich_bash(tool_input, tool_info)
    elif tool_name in _FILE_TOOLS:
        enrichment = _enrich_file(tool_name, tool_input, tool_info)
    elif tool_name.startswith("mcp__"):
        enrichment = _enrich_mcp(tool_name, tool_input, tool_info)
    else:
        enrichment = _enrich_default(tool_name, tool_input, tool_info)

    # Step 4: Build guard context
    context = {
        "action_type": enrichment["action_type"],
        "agent_id": AGENT_ID,
        "declared_goal": enrichment["declared_goal"],
        "risk_score": enrichment["risk_score"],
        "reversible": enrichment["reversible"],
        "systems_touched": [tool_info["category"]],
        "tool": {
            "name": tool_name,
            "category": tool_info["category"],
            "required_permission": tool_info["required_permission"],
        },
        "intel": enrichment.get("intel", {}),
    }

    # Forward the resolved target path (file tools, bash redirects) so a
    # protected_path guard policy can match it. Omitted when there is no path.
    if enrichment.get("target"):
        context["target"] = enrichment["target"]

    # Auto-scan: forward the outbound file content so the guard can secret-scan
    # it (warn by default; hard-blocks only when the org sets DASHCLAW_AUTOSCAN_
    # BLOCK). Capped to the guard schema's content limit. Best-effort — a failure
    # here must never break the tool call.
    try:
        _content = None
        if tool_name == "Write":
            _content = tool_input.get("content")
        elif tool_name == "Edit":
            _content = tool_input.get("new_string")
        elif tool_name == "MultiEdit":
            _edits = tool_input.get("edits") or []
            _content = "\n".join(str(e.get("new_string", "")) for e in _edits if isinstance(e, dict))
        elif tool_name == "NotebookEdit":
            _content = tool_input.get("new_source")
        if _content:
            context["content"] = str(_content)[:50000]
    except Exception:
        pass

    # Sub-agent provenance. Claude Code puts agent_id / agent_type on hook stdin
    # ONLY when the call fires inside a sub-agent. We keep the governed agent_id =
    # the configured parent (sub-agents inherit the parent's pairing and policies,
    # matching Claude Code's own model) and record the sub-agent as provenance
    # DashClaw persists: a display name, a per-session swarm group, and intel. Spawn
    # calls (Agent/Task) are also tagged into the session swarm so the delegation
    # and the delegated work group together in the ledger.
    subagent_id = data.get("agent_id")
    subagent_type = data.get("agent_type")
    if (subagent_id or subagent_type or tool_name in ("Agent", "Task")) and _SESSION_ID:
        context["swarm_id"] = _SESSION_ID
    if subagent_id or subagent_type:
        # In `distinct` mode the sub-agent gets its own composed agent_id so it is a
        # first-class fleet identity; the server falls back to the parent's pairing
        # for permission inheritance. Default `provenance` mode keeps agent_id = parent.
        if SUBAGENT_IDENTITY == "distinct" and subagent_type:
            context["agent_id"] = "%s:%s" % (AGENT_ID, _subagent_id_segment(subagent_type))
        context["agent_name"] = ("%s/%s" % (AGENT_ID, subagent_type)) if subagent_type else AGENT_ID
        context["trigger"] = "subagent:%s" % (subagent_type or "unknown")
        context["intel"]["subagent"] = {"agent_id": subagent_id, "agent_type": subagent_type}

    # Step 5: POST /api/guard with enriched context
    guard_resp = guard_check(context)
    if guard_resp is None:
        handle_guard_unavailable(context, tool_use_id)

    # Step 6: Handle decision
    decision = guard_resp.get("decision", "allow")

    # Auto-scan advisory: surface a visible warning when the guard detected a
    # secret in the outbound content, even on allow (warn-by-default). A 'block'
    # decision is handled by handle_block below.
    try:
        _scan = guard_resp.get("secret_scan") or {}
        if _scan.get("detected") and decision != "block":
            _cats = ", ".join(sorted({f.get("category", "secret") for f in _scan.get("findings", [])})) or "secret"
            log("[DashClaw] ⚠ Possible secret in this content (%s) — flagged by auto-scan. Review before it leaves your machine." % _cats)
    except Exception:
        pass

    # Behavior Learning: passively record a redacted sample of this governed
    # tool call (opt-in via DASHCLAW_BEHAVIOR_SAMPLES_ENABLED; fully fail-silent).
    # For allow/warn/approval the pending sample is finalized by PostToolUse;
    # an enforce-mode block is recorded terminally here since PostToolUse won't fire.
    try:
        behavior_recorder.record_pre(
            tool_use_id, tool_name, tool_input, context, guard_resp, decision, HOOK_MODE, WORKSPACE
        )
    except Exception:
        pass

    if decision == "allow":
        handle_allow(context, tool_use_id)
    elif decision == "warn":
        handle_warn(guard_resp, context, tool_use_id)
    elif decision == "block":
        handle_block(guard_resp, context)
    elif decision == "require_approval":
        handle_require_approval(guard_resp, context, tool_use_id)
    else:
        handle_allow(context, tool_use_id)


if __name__ == "__main__":
    main()
