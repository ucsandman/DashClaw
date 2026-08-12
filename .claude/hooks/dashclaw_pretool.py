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
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

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


def _resolve_base_url(base_explicit, url_explicit):
    """Resolve DASHCLAW_BASE_URL/DASHCLAW_URL with explicit-env-beats-dotenv
    precedence: explicit BASE_URL > explicit URL > dotenv BASE_URL > dotenv
    URL. `base_explicit`/`url_explicit` say whether the process env already
    had that key set BEFORE _load_dotenv() ran (captured below).

    Without this, a repo's own .env setting DASHCLAW_BASE_URL silently wins
    over an explicitly-exported DASHCLAW_URL merely because BASE_URL is
    checked first in the naive `BASE_URL or URL` fallback -- the 2026-07-27
    incident that misrouted three hook-triggered calls to a hosted production
    instance instead of the exported localhost URL."""
    base_val = os.environ.get("DASHCLAW_BASE_URL") or ""
    url_val = os.environ.get("DASHCLAW_URL") or ""
    if base_explicit and base_val:
        return base_val
    if url_explicit and url_val:
        if base_val and not base_explicit:
            sys.stderr.write(
                "[DashClaw] Explicit DASHCLAW_URL=%s overrides a .env-provided "
                "DASHCLAW_BASE_URL=%s\n" % (url_val, base_val)
            )
        return url_val
    return base_val or url_val


# Captured BEFORE _load_dotenv() fills gaps, so _resolve_base_url can tell an
# explicitly-exported value apart from one that only exists because dotenv
# populated it.
_BASE_URL_EXPLICIT = "DASHCLAW_BASE_URL" in os.environ
_URL_EXPLICIT = "DASHCLAW_URL" in os.environ

_load_dotenv()

# ---------------------------------------------------------------------------
# Import dashclaw_agent_intel (sibling directory)
# ---------------------------------------------------------------------------

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel import classify_bash, scan_file_operation, classify_tool, McpHealthMonitor
from dashclaw_agent_intel.bash_classifier import is_bounded_rm, is_regenerable_artifact_rm
from dashclaw_agent_intel.written_paths_ledger import (
    extract_exec_candidates,
    grade_script_content,
    lookup_written_path,
)
from dashclaw_agent_intel.file_scanner import is_placeholder_path
from dashclaw_agent_intel.http_client import request_with_retry, env_retries

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _argv_agent_id():
    # Per-harness identity declaration (roadmap v2.2). The harness integration
    # that wires this hook appends `--agent-id <id>` to the command line, so
    # identity is per-harness even when every harness on the machine shares
    # one script directory / .env / DASHCLAW_AGENT_ID export. argv beats env
    # by design: the flag is written by the installer that knows which
    # harness it is wiring; the env var is machine-ambient.
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--agent-id" and i + 1 < len(argv):
            return argv[i + 1].strip()
        if arg.startswith("--agent-id="):
            return arg.split("=", 1)[1].strip()
    return ""


BASE_URL = _resolve_base_url(_BASE_URL_EXPLICIT, _URL_EXPLICIT).rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
AGENT_ID = _argv_agent_id() or os.environ.get("DASHCLAW_AGENT_ID") or "claude-code"

# Short stable hash of (resolved BASE_URL + AGENT_ID), used to namespace this
# hook installation's tempdir state files from any OTHER DashClaw hook
# installation that fires for the SAME Claude Code tool_use_id / session_id on
# this machine -- e.g. a user's global ~/.claude hooks racing a project's
# local hooks under a different agent identity / base URL. Both pretool
# (writer) and posttool (reader) derive this independently from their own
# resolved env, so they only agree when they ARE the same installation.
# (2026-07-27 incident: a co-installed instance consumed/overwrote the real
# session's PostToolUse state file before it ever posted an artifact.)
_INSTANCE_STATE_SUFFIX = hashlib.sha256((BASE_URL + "|" + AGENT_ID).encode("utf-8")).hexdigest()[:12]
HOOK_MODE = os.environ.get("DASHCLAW_HOOK_MODE") or "enforce"
WORKSPACE = os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd()
PERMISSION_MODE = os.environ.get("DASHCLAW_PERMISSION_MODE") or "danger"
GUARD_TIMEOUT = float(os.environ.get("DASHCLAW_GUARD_TIMEOUT") or "5")
# Guard call retry count (extra attempts AFTER the first). Default 0: one
# attempt, so an unreachable instance fails closed in ~one connect timeout
# instead of ~8s of retries+backoff per tool call. Override for flaky
# networks with DASHCLAW_GUARD_RETRIES=2 (the old behavior).
GUARD_RETRIES = env_retries("DASHCLAW_GUARD_RETRIES", 0)
# TCP preflight bound for the guard call. urllib's timeout covers connect AND
# read, so a SYN-blackholed host would otherwise burn the full GUARD_TIMEOUT
# (5s) before failing closed. A 2s connect check bounds the dead-host case
# while a live-but-cold server still gets the full read window.
GUARD_CONNECT_TIMEOUT = float(os.environ.get("DASHCLAW_GUARD_CONNECT_TIMEOUT") or "2")
APPROVAL_TIMEOUT = float(os.environ.get("DASHCLAW_APPROVAL_TIMEOUT") or "30")
GUARD_UNAVAILABLE_POLICY = (os.environ.get("DASHCLAW_GUARD_UNAVAILABLE_POLICY") or "block").lower()
# distinct (default since roadmap v2.2): emit a composed agent_id
# (<parent>:<agent_type>) so sub-agents are distinct fleet identities (the
# server falls back to the parent's pairing/permissions, so composed ids
# inherit and never over-block). provenance: legacy pre-v2.2 behavior — the
# governed agent_id stays the parent and sub-agent identity rides only the
# provenance fields; set DASHCLAW_SUBAGENT_IDENTITY=provenance to roll back.
# See docs/rfcs/2026-06-01-subagent-fleet-identities.md.
SUBAGENT_IDENTITY = (os.environ.get("DASHCLAW_SUBAGENT_IDENTITY") or "distinct").lower()

# Containment Verdicts (v5.6): capability advertisement + contained-execution
# redirect. See docs/rfcs/2026-07-06-containment-verdicts.md and
# app/lib/guard/containment.ts (server-side eligibility + negotiation).
CONTAINMENT_ENABLED = (os.environ.get("DASHCLAW_CONTAINMENT") or "1") != "0"
# Task 1 spike verdict: updatedInput rewrite works on Claude Code v2.1.220.
# Default ON so a contained Write/Edit/MultiEdit stages transparently instead
# of always falling back to an instructive deny.
CONTAINMENT_REWRITE = (os.environ.get("DASHCLAW_CONTAINMENT_REWRITE") or "1") == "1"
_CONTAINABLE_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "Bash"})

# todo-001: one-shot demo-mode probe to surface a misrouted DASHCLAW_BASE_URL
# (e.g. a stale env var pointing at a local sandbox) before the operator burns
# 30 minutes debugging fixture decisions as if they were real policies. The
# probe is cached per-URL so we only pay the HTTP cost once per TTL window;
# changing BASE_URL forces a fresh check because the cache key includes the URL.
DEMO_CHECK_TTL_SECONDS = 15 * 60
# Probe FAILURES are cached too (short TTL) so consecutive tool calls against
# a dead instance don't re-pay the probe timeout on every call.
DEMO_CHECK_NEGATIVE_TTL_SECONDS = 60
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
    "interpreter": "build",  # server base 25 — client classifier score drives the decision
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

# Sentinel returned by api_request(distinguish_auth=True) when the API rejects
# our credentials (HTTP 401/403). Distinct from None (connection failure / other
# error) so the guard path can report "invalid API key" instead of the misleading
# "guard unreachable" — a 401 IS a response, not a connectivity failure.
AUTH_FAILED = object()


def derive_idempotency_key(parts):
    """Derive a stable idempotency key from the intent of an action.

    Mirror of the reference implementation in sdk/dashclaw.js
    deriveIdempotencyKey (and sdk-python derive_idempotency_key): sorted
    "k=v" pairs joined with "|", SHA-256 hex. Identical parts must derive
    identical keys on every surface (hook / MCP / SDK), so a blind retry of
    the same tool call dedupes server-side instead of duplicating the
    ledger. Use only strings/numbers/None as values (bool formatting
    differs between languages).
    """
    ordered = "|".join(
        "%s=%s" % (k, parts.get(k) if parts.get(k) is not None else "")
        for k in sorted(parts)
    )
    return hashlib.sha256(ordered.encode("utf-8")).hexdigest()


def api_request(method, path, body=None, timeout=None, retries=2, distinguish_auth=False,
                read_error_body=False):
    """Make an HTTP request to the DashClaw API. Returns parsed JSON or None.

    By default retries up to three times total with 0.4s then 0.8s backoff
    between attempts so a Vercel or Neon cold start does not block the tool
    call. The latency-critical guard call passes retries=GUARD_RETRIES
    (default 0) instead. See dashclaw_agent_intel.http_client.

    When distinguish_auth is True, a 401/403 response returns the AUTH_FAILED
    sentinel instead of None, so callers can tell "bad/missing API key" apart
    from "host unreachable".

    When read_error_body is True, a non-2xx response's JSON body is parsed and
    returned instead of None. POST /api/actions answers 403 for a blocked
    create *with the created action in the body* — the observe-mode block
    path needs that action_id for the executed-despite witness (F0).
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
        body_bytes = request_with_retry(req, timeout=timeout, retries=retries)
        return json.loads(body_bytes.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # An HTTP error IS a response (the host answered), not a connectivity
        # failure. Surface auth rejection distinctly when asked; everything else
        # collapses to None as before.
        if distinguish_auth and exc.code in (401, 403):
            return AUTH_FAILED
        if read_error_body:
            try:
                return json.loads(exc.read().decode("utf-8"))
            except Exception:
                return None
        return None
    except Exception:
        return None


def _can_connect(url, timeout):
    """Cheap TCP preflight: True when a connection to url's host:port opens
    within `timeout`. Bounds the dead-host case (SYN blackhole) at ~timeout
    seconds instead of the full request timeout. Anything unexpected (parse
    failure, missing host) returns True so urlopen stays the authority."""
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname
        if not host:
            return True
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False
    except Exception:
        return True


def guard_check(context):
    """POST /api/guard?record=true. Returns response dict or None on failure.

    ?record=true asks the server (4.7.11+) to also create the running action
    record in the same request and return its action_id — one HTTP call per
    governed tool call instead of guard + create_action. An older server
    ignores the unknown query param and responds without a `recorded` field;
    the decision handlers detect that and fall back to the two-call flow.

    Dead-host bound: when the startup health probe (already run by main())
    cached "unreachable" — or left no cached verdict — a cheap TCP preflight
    bounds the SYN-blackhole case at GUARD_CONNECT_TIMEOUT instead of the
    full request timeout. A healthy cached verdict skips the preflight, so
    the steady-state happy path pays zero extra round-trips."""
    mode = _read_demo_check_cache(_demo_check_cache_path())
    if mode is None or mode == "unreachable":
        if not _can_connect(BASE_URL, GUARD_CONNECT_TIMEOUT):
            return None
    return api_request("POST", "/api/guard?record=true", body=context, retries=GUARD_RETRIES, distinguish_auth=True)


def create_action(context, status="running"):
    """POST /api/actions. Returns response dict or None on failure.

    A blocked create answers HTTP 403 with the created action in the body —
    read it, don't discard it: the observe-mode block path extracts the
    action_id from it for the executed-despite witness (F0)."""
    payload = dict(context)
    payload["status"] = status
    return api_request("POST", "/api/actions", body=payload,
                       read_error_body=(status == "blocked"))


def get_action(action_id):
    """GET /api/actions/<id>. Returns response dict or None."""
    return api_request("GET", "/api/actions/" + action_id, timeout=3)


# ---------------------------------------------------------------------------
# Intel enrichment
# ---------------------------------------------------------------------------

def _bash_base_risk_score(bash_intel: dict, tool_info: dict) -> int:
    """Risk scoring. Trust the per-command classifier for recognized intents; fall
    back to the Bash tool's blunt base_risk only for an 'unknown' (unparseable)
    command. The previous max(base_risk, score) pinned EVERY bash call to the 70
    base, so a readonly `echo hello` reported 70 — defeating the semantic
    classifier this module exists to provide."""
    base_risk = tool_info["risk_profile"]["base_risk"]
    if bash_intel["intent"] == "unknown":
        return max(base_risk, bash_intel["risk_score"])
    return bash_intel["risk_score"]


def _contains_path_traversal(path: str) -> bool:
    return ".." in path.replace("\\", "/").split("/")


def _bash_path_boosts(risk_score: int, all_paths: list, redirect_targets: list) -> int:
    """Apply traversal / sensitive / system-location boosts to a bash risk score."""
    # Boost for path traversal in any target.
    if any(_contains_path_traversal(path) for path in all_paths):
        risk_score += 20
    # Boost for sensitive targets (.env, keys, credentials).
    if any(_is_sensitive_path(path) for path in all_paths):
        risk_score += 15
    # Escalate redirections that WRITE into a protected system location (e.g.
    # `echo x > /etc/passwd`) — dangerous even though `echo` classifies as readonly.
    if any(_is_system_path(path) for path in redirect_targets):
        risk_score = max(risk_score, 75)
    return risk_score


def _apply_script_then_execute(parsed, risk_score):
    """Script-then-execute composition detection (spec
    docs/plans/2026-08-06-script-then-execute-spec.md): when this command
    executes a script the SESSION itself recently wrote, grade the script's
    content with the same classifiers inline commands get and fold that grade
    in. The composition signal never escalates risk by itself (F5 lesson) —
    `bash cleanup.sh` with regenerable-delete content stays in the cleanup
    band exactly as the inline command would. Returns
    (risk_score, extra_validations, target_or_None). Fail-soft: any error
    degrades to pre-spec behavior."""
    try:
        if not _SESSION_ID:
            return risk_score, [], None
        for cand in extract_exec_candidates(parsed or {}):
            norm = lookup_written_path(_SESSION_ID, _INSTANCE_STATE_SUFFIX, cand, _HOOK_CWD)
            if not norm:
                continue
            graded = grade_script_content(norm)
            if not graded["readable"]:
                # A recently-self-written executable whose content can't be
                # inspected is the evasion shape — review band, not block
                # (large legitimate generated scripts exist).
                return (
                    max(risk_score, 60),
                    [{
                        "check": "script_then_execute_unreadable",
                        "result": "warn",
                        "reason": "self-written script content unreadable or oversized: " + norm,
                    }],
                    norm,
                )
            escalated = graded["risk_score"] > risk_score
            validations = [{
                "check": "script_then_execute",
                "result": "warn" if escalated else "allow",
                "reason": "executing a script this session wrote; content graded "
                + str(graded["risk_score"]),
            }]
            for v in graded["validations"]:
                validations.append({
                    "check": "script_content:" + str(v.get("check", "")),
                    "result": v.get("result", "allow"),
                    "reason": v.get("reason", ""),
                })
            return max(risk_score, graded["risk_score"]), validations, norm
        return risk_score, [], None
    except Exception as e:
        _log_hook_error("script_then_execute: " + type(e).__name__ + ": " + str(e))
        return risk_score, [], None


def _enrich_bash(tool_input: dict, tool_info: dict, label: str = "Bash") -> dict:
    """Run the command classifier and build enriched intel for a Bash or
    PowerShell tool call. PowerShell rides the same path: the classifier
    understands Verb-Noun cmdlets, and without semantic classification every
    PowerShell call fell to the blunt execution base (70) — which blocked a
    benign `Get-Content -Tail` at risk 100 (2026-07-02 incident)."""
    command = tool_input.get("command") or ""
    bash_intel = classify_bash(command, mode=PERMISSION_MODE, workspace=WORKSPACE)

    # Map bash intent to action_type. A bounded single-file rm — or a
    # recursive delete of a regenerable build artifact (.next, dist,
    # node_modules...) — maps to "cleanup", not "security": the server takes
    # max(server base, client score), and the security base (80) +
    # irreversible modifier alone would push every routine delete into the
    # block band regardless of the classifier's graded score (2026-07-03
    # `rm -rf .next` hard-block, vector rm-rf-next-build-cache).
    if bash_intel["intent"] == "destructive" and (
        is_bounded_rm(bash_intel.get("parsed") or {})
        or is_regenerable_artifact_rm(bash_intel.get("parsed") or {})
    ):
        action_type = "cleanup"
    else:
        action_type = _INTENT_TO_ACTION.get(bash_intel["intent"], "other")

    risk_score = _bash_base_risk_score(bash_intel, tool_info)

    parsed = bash_intel.get("parsed", {})
    targets = parsed.get("targets", [])
    redirections = parsed.get("redirections", [])
    redirect_targets = [r.get("target", "") for r in redirections]
    all_paths = list(targets) + redirect_targets

    # A shell redirection writes to a file even when the command itself (echo/cat)
    # classifies as readonly, so a low readonly score must not hide the write.
    if redirections and risk_score < 35:
        risk_score = 35

    risk_score = _bash_path_boosts(risk_score, all_paths, redirect_targets)

    # Script-then-execute composition (spec §3.3): a hit routes the script's
    # CONTENT grade into this call; a miss changes nothing.
    risk_score, stx_validations, stx_target = _apply_script_then_execute(parsed, risk_score)

    risk_score = min(risk_score, 100)

    return {
        "action_type": action_type,
        "risk_score": risk_score,
        "reversible": bash_intel["reversible"],
        # Full command up to the server's declared_goal cap (validate.js maxLength
        # 2000). The old 120-char slice amputated the very thing the approval
        # surfaces exist to show the operator (field report 2026-08-07: a Telegram
        # approval card cut a command mid-word, making it unjudgeable).
        "declared_goal": (label + ": " + command)[:2000],
        # A shell redirection target is a write path; forward it as `target` so a
        # protected_path policy can gate `echo secret > app/secrets/x` style writes.
        # A script-then-execute hit forwards the script path instead, so
        # protected_path policies can match the file being executed.
        "target": stx_target or (redirect_targets[0] if redirect_targets else None),
        "intel": {
            "bash": {
                "intent": bash_intel["intent"],
                "risk_score": bash_intel["risk_score"],
                "reversible": bash_intel["reversible"],
                "validations": bash_intel["validations"] + stx_validations,
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
        # Same full-visibility rule as the Bash path: slice the WHOLE goal to the
        # server cap (2000), never the payload to 120 — operators judge approvals
        # by this string.
        "declared_goal": ("%s: %s" % (tool_name, json.dumps(tool_input)))[:2000],
        "intel": {},
    }


def _is_sensitive_path(path: str) -> bool:
    """Quick check if a path string matches common sensitive patterns.

    Placeholder/template files (.env.example, .env.sample, ...) are exempt —
    they hold placeholders by convention and updating them is routine work."""
    if is_placeholder_path(path):
        return False
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

def _action_state_path(tool_use_id):
    # Instance-suffixed (F2, 2026-07-27 e2e proof): a tool_use_id is unique
    # per Claude Code tool call, but TWO co-installed hook instances (e.g. a
    # user's global ~/.claude hooks racing a project's local hooks under a
    # different agent identity / base URL) both fire for that SAME tool call
    # and would otherwise clobber each other's action_id here. posttool.py
    # derives the identical suffix from its own resolved env, so only the
    # matching installation's PostToolUse ever reads this file.
    return os.path.join(
        tempfile.gettempdir(), "dashclaw_last_action_" + _INSTANCE_STATE_SUFFIX + "_" + tool_use_id
    )


def write_action_id(tool_use_id, action_id):
    """Write action_id to a temp file keyed by tool_use_id.

    Also appends the (tool_use_id, action_id) pair to a per-session mapping
    log the Stop hook's coverage counter reads (expected-vs-recorded governed
    tool_uses for /api/coverage). PostToolUse cleans up the per-tool_use_id
    file after PATCHing, so the session-scoped log is the only persistent
    record of which Claude Code tool calls correspond to which DashClaw
    action_records by the time Stop fires.
    """
    path = _action_state_path(tool_use_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(action_id)
    except Exception:
        pass
    if _SESSION_ID and tool_use_id and action_id:
        _append_session_tool_map(_SESSION_ID, tool_use_id, action_id)


def _write_unenforced_action_state(tool_use_id, action_id, verdict):
    """Observe-mode block / require_approval: the tool call is about to
    execute DESPITE a gating verdict. Write the pretool->posttool temp file
    as JSON so PostToolUse stamps `executed_despite` on the row instead of
    reporting an ordinary outcome — the durable witness that a logged verdict
    did not stop execution (F0, governance gap audit 2026-08-05). Mirrors
    write_action_id's session-map append so coverage counting still sees the
    governed tool_use."""
    path = _action_state_path(tool_use_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"action_id": action_id or "", "unenforced_verdict": verdict}))
    except Exception:
        pass
    if _SESSION_ID and tool_use_id and action_id:
        _append_session_tool_map(_SESSION_ID, tool_use_id, action_id)


def _append_session_tool_map(session_id, tool_use_id, action_id):
    """Append "<tool_use_id>\\t<action_id>" to a per-session log the Stop hook's
    coverage counter reads. Best-effort; never raises."""
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

# Hook-stdin cwd; set in main(). Relative script paths in a Bash command are
# resolved against this for the written-paths ledger lookup (spec §4).
_HOOK_CWD = ""


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
# Containment (allow_contained): git-repo detection, worktree lifecycle,
# capability advertisement, and the updatedInput rewrite.
# ---------------------------------------------------------------------------

_GIT_SUBPROCESS_KWARGS = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


def _run_git(args, cwd, timeout=10):
    """Run `git <args>` in cwd. Returns a CompletedProcess, or None on any
    failure (missing git, spawn error, timeout) -- never raises. Windows:
    CREATE_NO_WINDOW keeps a console from flashing on every git call."""
    git = shutil.which("git")
    if not git:
        return None
    try:
        return subprocess.run(
            [git] + list(args),
            cwd=cwd,
            capture_output=True,
            timeout=timeout,
            **_GIT_SUBPROCESS_KWARGS,
        )
    except Exception:
        return None


_is_git_repo_cache = None


def _is_git_repo():
    """True if WORKSPACE is inside a git working tree. Cached per process --
    every governed tool call in this invocation shares one answer."""
    global _is_git_repo_cache
    if _is_git_repo_cache is None:
        proc = _run_git(["rev-parse", "--is-inside-work-tree"], cwd=WORKSPACE, timeout=5)
        _is_git_repo_cache = bool(
            proc and proc.returncode == 0
            and proc.stdout.decode("utf-8", "replace").strip() == "true"
        )
    return _is_git_repo_cache


_repo_root_cache = ""
_repo_root_computed = False


def _repo_root():
    """The repo's toplevel directory, or None. Cached per process."""
    global _repo_root_cache, _repo_root_computed
    if not _repo_root_computed:
        proc = _run_git(["rev-parse", "--show-toplevel"], cwd=WORKSPACE, timeout=5)
        raw = proc.stdout.decode("utf-8", "replace").strip() if proc and proc.returncode == 0 else ""
        # git always prints forward slashes for --show-toplevel, even on
        # Windows; normalize so paths built from this join cleanly with
        # os.path.join (native backslashes) instead of a mixed-separator string.
        _repo_root_cache = os.path.normpath(raw) if raw else ""
        _repo_root_computed = True
    return _repo_root_cache or None


def _git_common_dir(root):
    """<git_common_dir> for the repo at root -- where info/exclude lives.
    Falls back to `<root>/.git` on any failure (the common case)."""
    proc = _run_git(["rev-parse", "--git-common-dir"], cwd=root, timeout=5)
    if not proc or proc.returncode != 0:
        return os.path.join(root, ".git")
    path = proc.stdout.decode("utf-8", "replace").strip()
    if not path:
        return os.path.join(root, ".git")
    if not os.path.isabs(path):
        path = os.path.join(root, path)
    return os.path.normpath(path)


def _ensure_exclude_line(git_common_dir):
    """Append `.dashclaw/` to <git_common_dir>/info/exclude if not already
    present. NEVER touches the tracked .gitignore. Best-effort."""
    exclude_path = os.path.join(git_common_dir, "info", "exclude")
    try:
        os.makedirs(os.path.dirname(exclude_path), exist_ok=True)
        existing_lines = []
        if os.path.exists(exclude_path):
            with open(exclude_path, encoding="utf-8") as f:
                existing_lines = f.read().splitlines()
        if any(line.strip() == ".dashclaw/" for line in existing_lines):
            return
        with open(exclude_path, "a", encoding="utf-8") as f:
            f.write(".dashclaw/\n")
    except Exception:
        pass


_BRANCH_SEGMENT_RE = re.compile(r"[^A-Za-z0-9-]")


def _safe_branch_segment(session_id):
    """Sanitize an (untrusted, harness-supplied) session_id into an
    alnum+dash segment safe for a git branch name / directory component.

    Deliberately stricter than _safe_session_id (which allows `.` and `_` for
    temp-file suffixes above): a git branch/ref component rejects a leading
    `.` and disallows `..` outright, and this segment doubles as a filesystem
    directory name, so the narrower alnum+dash charset sidesteps both classes
    of surprise rather than special-casing them."""
    cleaned = _BRANCH_SEGMENT_RE.sub("-", session_id or "").strip("-")
    return cleaned[:64] or "session"


def _containment_session_state_path(session_id):
    # Instance-suffixed (F2, 2026-07-27 e2e proof): two co-installed hook
    # instances sharing this session_id must never read/write each other's
    # worktree/ref/base_sha.
    return os.path.join(
        tempfile.gettempdir(),
        "dashclaw_containment_session_" + _INSTANCE_STATE_SUFFIX + "_" + _safe_session_id(session_id) + ".json",
    )


def _read_containment_session_state(session_id):
    """Return (worktree_path, ref, base_sha) from a prior contained call this
    session, or None when there is no state yet or the worktree no longer
    exists. base_sha is None for state written by an older hook version that
    predates F1 (no base_sha field) -- callers fall back accordingly."""
    path = _containment_session_state_path(session_id)
    try:
        with open(path, encoding="utf-8") as f:
            data = json.loads(f.read())
        worktree_path = data.get("worktree_path")
        ref = data.get("ref")
        base_sha = data.get("base_sha")
    except Exception:
        return None
    if not worktree_path or not ref or not os.path.isdir(worktree_path):
        return None
    return worktree_path, ref, base_sha


def _write_containment_session_state(session_id, worktree_path, ref, base_sha):
    """Best-effort persist of (worktree_path, ref, base_sha) so the next
    contained call in this session reuses the worktree instead of adding a
    second one. base_sha (F1) is the worktree's HEAD at creation time, so
    PostToolUse can later compute a cumulative `git diff base_sha HEAD`."""
    path = _containment_session_state_path(session_id)
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps({"worktree_path": worktree_path, "ref": ref, "base_sha": base_sha}))
    except Exception:
        pass


def _worktree_base_sha(worktree_path):
    """`git -C <worktree_path> rev-parse HEAD`, or None on any failure."""
    proc = _run_git(["rev-parse", "HEAD"], cwd=worktree_path, timeout=10)
    if not proc or proc.returncode != 0:
        return None
    sha = proc.stdout.decode("utf-8", "replace").strip()
    return sha or None


# The exact ref shape this hook ever produces (and the PATCH flip route
# validates). A server-stamped ref outside this shape is never adopted.
_SERVER_CONTAINMENT_REF_RE = re.compile(r"^dashclaw/contained-([A-Za-z0-9-]{1,64})$")


def _server_containment_ref(guard_resp):
    """The server-stamped merge target from the guard response (security
    follow-up to RFC 2026-07-06): the server derives the ref from this hook's
    own harness_session_id at guard time and stamps it on the recorded action,
    so the worktree branch should be created under the SERVER's name, not a
    locally re-derived one. Returns the ref, or None when absent or malformed
    (malformed -> fall back to local derivation; the flip will 409 loudly if
    the two ever truly diverge)."""
    containment = guard_resp.get("containment") if isinstance(guard_resp, dict) else None
    ref = containment.get("ref") if isinstance(containment, dict) else None
    if isinstance(ref, str) and _SERVER_CONTAINMENT_REF_RE.match(ref):
        return ref
    return None


def _ensure_containment_worktree(session_id, server_ref=None):
    """Lazily create (once per session) or reuse the containment worktree.

    Returns (worktree_path, ref, base_sha), or None on any failure -- not a
    git repo, repo root unresolvable, `git worktree add` failed. Callers MUST
    fail toward interruption on None (invariant 5): a contained effect never
    proceeds unstaged. base_sha (F1) is recorded at creation time so
    PostToolUse can later compute a cumulative diff against it; it is None
    when `git rev-parse HEAD` itself fails (rare -- the worktree add above
    already succeeded, so HEAD should resolve).

    server_ref (validated by _server_containment_ref) names the branch when
    present; otherwise the ref is derived locally from session_id -- both
    derivations sanitize the same harness session id identically, so they only
    diverge on version skew."""
    if not _is_git_repo():
        return None

    cached = _read_containment_session_state(session_id)
    if cached:
        if server_ref and cached[1] != server_ref:
            log("[DashClaw] Containment ref skew: server stamped %s but this session's "
                "worktree is on %s -- reusing the existing worktree." % (server_ref, cached[1]))
        return cached

    root = _repo_root()
    if not root:
        return None

    if server_ref:
        ref = server_ref
        branch_seg = ref[len("dashclaw/contained-"):]
    else:
        # Local fallback (server predates ref stamping): mirror of the server's
        # buildContainmentRef WITH the instance discriminator — session segment
        # truncated so segment + '-' + suffix stays within the 64-char cap the
        # ref-shape regexes enforce. Keeps co-installed instances on distinct
        # branches even against an old server.
        inst = _INSTANCE_STATE_SUFFIX
        seg = _safe_branch_segment(session_id)[: 64 - len(inst) - 1].rstrip("-")
        branch_seg = seg + "-" + inst
        ref = "dashclaw/contained-" + branch_seg
    worktree_path = os.path.join(root, ".dashclaw", "contained", branch_seg)

    _ensure_exclude_line(_git_common_dir(root))

    os.makedirs(os.path.dirname(worktree_path), exist_ok=True)
    proc = _run_git(["worktree", "add", worktree_path, "-b", ref], cwd=root, timeout=30)
    if not proc or proc.returncode != 0:
        return None

    base_sha = _worktree_base_sha(worktree_path)
    _write_containment_session_state(session_id, worktree_path, ref, base_sha)
    return worktree_path, ref, base_sha


def _attach_client_capabilities(context, tool_name):
    """Advertise containment support to the guard so an eligible allow_contained
    verdict is not skewed down to require_approval (server-side negotiation --
    see app/lib/guard/containment.ts, clientAdvertisesContainment). Gated so a
    non-enforcing or non-git caller never claims a capability it cannot stage:
    observe mode cannot redirect anything, and there is no worktree to redirect
    into outside a git repo."""
    if not CONTAINMENT_ENABLED:
        return
    if HOOK_MODE != "enforce":
        return
    if tool_name not in _CONTAINABLE_TOOLS:
        return
    if not _is_git_repo():
        return
    context["client_capabilities"] = ["allow_contained"]
    # Instance discriminator: the server folds this into the containment ref it
    # stamps (buildContainmentRef), so two co-installed hook instances firing
    # for the SAME harness session get DISTINCT branches/worktrees instead of
    # the second `git worktree add` failing forever. Same suffix that already
    # namespaces this instance's tempdir state files.
    context["containment_instance"] = _INSTANCE_STATE_SUFFIX


def _relative_to_repo(path, root):
    """path's location relative to root, or None if it can't be expressed
    that way (outside the repo, cross-drive on Windows, etc.)."""
    try:
        rel = os.path.relpath(os.path.abspath(path), root)
    except Exception:
        return None
    if rel == os.pardir or rel.startswith(os.pardir + os.sep):
        return None
    return rel


def _rewrite_input_for_containment(tool_input, worktree_path, root):
    """Build a COMPLETE replacement tool_input with its path field rewritten
    under the worktree, preserving the file's repo-relative layout. Returns
    None when there's no path field or it can't be mapped into the repo."""
    key = "file_path" if "file_path" in tool_input else ("path" if "path" in tool_input else None)
    if not key:
        return None
    path = tool_input.get(key)
    if not path:
        return None
    rel = _relative_to_repo(path, root)
    if rel is None:
        return None
    updated = dict(tool_input)
    updated[key] = os.path.join(worktree_path, rel)
    return updated


def _emit_contained_allow(updated_input, worktree_path, ref):
    """Emit the Task-1-spike hookSpecificOutput JSON on stdout and exit 0.
    Verified working on Claude Code v2.1.220: updatedInput is honored as a
    COMPLETE replacement of the tool's input, redirecting the effect into the
    containment worktree instead of the working tree."""
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": (
                "Contained: staged under %s (containment ref %s)." % (worktree_path, ref)
            ),
            "updatedInput": updated_input,
        }
    }
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def _write_containment_action_state(tool_use_id, action_id, containment_ref, worktree_path, base_sha=None):
    """Extend the pretool->posttool temp file (see write_action_id) with
    containment fields. PostToolUse (Task 10) parses this JSON shape to
    resolve a contained action's staged effect; ordinary allow/warn decisions
    still write the bare action_id string PostToolUse reads today. base_sha
    (F1) is the worktree's HEAD at creation time, so PostToolUse can diff the
    cumulative range instead of missing new/untracked files with `git diff
    HEAD` on an uncommitted worktree."""
    path = _action_state_path(tool_use_id)
    payload = {
        "action_id": action_id or "",
        "containment_ref": containment_ref,
        "containment_worktree": worktree_path,
        "containment_base_sha": base_sha,
    }
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(payload))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Decision handlers
# ---------------------------------------------------------------------------

def _extract_action_id(resp):
    """Pull the action_id out of a create_action / get_action response shape."""
    return (resp.get("action_id")
            or (resp.get("action") or {}).get("action_id")
            or "")


def _record_running_action(handler, context, tool_use_id):
    """Create a running action and route its id to the per-tool / per-turn logs.

    Shared by handle_allow and handle_warn: on success it persists the id for
    PostToolUse and token attribution; on a missing id or failed create it logs
    the attribution gap so it never disappears silently. `handler` names the
    caller for the log line. Returns the action_id, or "" on failure (existing
    callers ignore the return value; handle_allow_contained uses it)."""
    resp = create_action(context, status="running")
    if not resp:
        _log_hook_error(handler + ": create_action failed (None); tool proceeded without governance record")
        return ""
    action_id = _extract_action_id(resp)
    if not action_id:
        # Governance server returned a response but no action_id — the Stop
        # hook will produce orphan_tokens for this turn. Log so ops can spot
        # the attribution gap instead of the failure disappearing silently.
        _log_hook_error(handler + ": create_action returned no action_id; response=" + str(resp)[:200])
        return ""
    write_action_id(tool_use_id, action_id)
    append_turn_action(_SESSION_ID, action_id)
    return action_id


def _persist_guard_recorded_action(guard_resp, tool_use_id):
    """When the guard call itself recorded the action (?record=true on a
    4.7.11+ server), persist its action_id and skip the legacy create_action
    round-trip. Returns the action_id, or "" when the server did not record
    (older server ignoring the param, or recorded:false) so the caller can
    fall back to the two-call flow."""
    if not guard_resp or guard_resp.get("recorded") is not True:
        return ""
    action_id = guard_resp.get("action_id") or ""
    if not action_id:
        return ""
    write_action_id(tool_use_id, action_id)
    append_turn_action(_SESSION_ID, action_id)
    return action_id


def handle_allow(guard_resp, context, tool_use_id):
    """Record the action (in-guard via ?record=true when supported) and exit 0."""
    if not _persist_guard_recorded_action(guard_resp, tool_use_id):
        _record_running_action("handle_allow", context, tool_use_id)
    sys.exit(0)


def _log_recovery(guard_resp):
    """Surface the guard's recovery recipe (suggestion + steps) to the agent.

    The server has attached recovery objects to warn/block decisions since the
    layered-intelligence ship; without this the guidance is silently dropped.
    """
    recovery = guard_resp.get("recovery")
    if not isinstance(recovery, dict):
        return
    suggestion = recovery.get("suggestion")
    if suggestion:
        log("[DashClaw] Recovery: " + str(suggestion)[:500])
    steps = recovery.get("steps")
    if isinstance(steps, list):
        for step in steps[:5]:
            log("  - " + str(step)[:300])


def handle_warn(guard_resp, context, tool_use_id):
    """Print warning (+ recovery guidance), record action, exit 0."""
    warnings = guard_resp.get("warnings") or guard_resp.get("reasons") or []
    msg = warnings[0] if warnings else "Policy warning"
    log("[DashClaw] Warning: " + msg)
    _log_recovery(guard_resp)
    if not _persist_guard_recorded_action(guard_resp, tool_use_id):
        _record_running_action("handle_warn", context, tool_use_id)
    sys.exit(0)


def handle_block(guard_resp, context, tool_use_id):
    """Block in enforce mode, warn in observe mode. Always records the action."""
    reasons = guard_resp.get("reasons") or []
    policies = guard_resp.get("matched_policies") or []
    reason = reasons[0] if reasons else "Guard policy violation"
    policy = policies[0] if policies else "guard policy"

    # RECORD THE BLOCK — this was missing, causing blocks to vanish from the ledger
    # with zero audit trail (BUG-02, fixed 2026-04-11 in Phase 1.5).
    # A 5.10.1+ server already recorded the blocked action inside the
    # ?record=true guard call (recorded:true, action_id = the blocked row) —
    # calling create_action again would re-evaluate guard server-side and
    # write a DUPLICATE guard_decisions row, so every block showed twice in
    # the ledger. Fall back to create_action only when the server did not
    # record (older server, or record failure).
    action_id = ""
    if guard_resp.get("recorded") is True:
        action_id = guard_resp.get("action_id") or ""
    if not action_id:
        resp = create_action(context, status="blocked")
        action_id = _extract_action_id(resp) if resp else ""

    if HOOK_MODE == "observe":
        # The tool call is about to execute despite the block. Leave the
        # unenforced-verdict state for PostToolUse so the row gets its
        # `executed_despite` witness stamp (F0) — and route the turn's token
        # usage to the row, since in observe mode the work actually happens.
        if action_id:
            _write_unenforced_action_state(tool_use_id, action_id, "block")
            append_turn_action(_SESSION_ID, action_id)
        log("[DashClaw] [observe] Would block: " + reason)
        sys.exit(0)

    log("[DashClaw] Blocked by policy: " + reason)
    log("Policy: " + policy)
    log("Action: " + context["declared_goal"])
    _log_recovery(guard_resp)
    log("Run 'dashclaw approvals' to review or override.")
    sys.exit(2)


def _wait_for_approval(action_id, tool_use_id):
    """Poll get_action until approved, denied, or the deadline passes.

    On approval: persist the id and exit 0. On denial: exit 2. On timeout:
    return so the caller can block. Same polling cadence and decision rules as
    before — only the nesting is flattened."""
    deadline = time.time() + APPROVAL_TIMEOUT
    while time.time() < deadline:
        time.sleep(3)
        action_resp = get_action(action_id)
        if not action_resp:
            continue
        action = action_resp.get("action") or action_resp
        status = action.get("status", "")
        approved = bool(action.get("approved_by")) or status == "running"
        if approved:
            write_action_id(tool_use_id, action_id)
            append_turn_action(_SESSION_ID, action_id)
            sys.exit(0)
        if status == "expired":
            # Approvals lifecycle (roadmap v2.3): the server decided this
            # approval can no longer release anything. Terminal — stop polling.
            log("[DashClaw] Approval expired server-side.")
            sys.exit(2)
        if status in ("failed", "cancelled"):
            log("[DashClaw] Action denied by operator.")
            sys.exit(2)


def handle_require_approval(guard_resp, context, tool_use_id):
    """Create pending action, wait for approval, or block on timeout."""
    policies = guard_resp.get("matched_policies") or []
    policy = policies[0] if policies else "require_approval policy"

    # ?record=true already created the pending_approval record server-side;
    # only persist/attribute the id after approval (below), like the two-call
    # flow. Fall back to create_action against an older server.
    action_id = ""
    if guard_resp.get("recorded") is True:
        action_id = guard_resp.get("action_id") or ""
    if not action_id:
        resp = create_action(context, status="pending_approval")
        action_id = _extract_action_id(resp) if resp else ""
    if not action_id:
        # The server said "ask a human" and we could not create the request to
        # ask with (a 5xx or a timeout both collapse to None in api_request).
        # Proceeding would run the gated tool with no approval AND no ledger
        # row — the same hole handle_guard_unavailable exists to close, so it
        # fails closed the same way and honors the same escape hatch.
        _exit_ungovernable(
            "approval is required, but the approval request could not be created at "
            + BASE_URL + ".",
            "Action: " + context["declared_goal"] + " — retry once the server answers.")

    if HOOK_MODE == "observe":
        log("[DashClaw] [observe] Would require approval for: " + context["declared_goal"])
        # Unenforced-verdict state (not the bare action_id): the tool executes
        # without waiting for approval, so PostToolUse must stamp
        # `executed_despite` on the pending row instead of reporting an
        # ordinary outcome (F0).
        _write_unenforced_action_state(tool_use_id, action_id, "require_approval")
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

    _wait_for_approval(action_id, tool_use_id)

    log("[DashClaw] Approval timeout. Blocking tool execution.")
    sys.exit(2)


def _record_observed_containment(guard_resp, context, tool_use_id):
    """Observe mode never blocks or redirects anything (mirrors handle_block /
    handle_require_approval): record the action as an ordinary allow — no
    worktree, no JSON containment state — and let the caller exit 0."""
    log("[DashClaw] [observe] Would contain: " + context.get("declared_goal", "unknown"))
    if not _persist_guard_recorded_action(guard_resp, tool_use_id):
        _record_running_action("handle_allow_contained", context, tool_use_id)


def handle_allow_contained(guard_resp, tool_name, tool_input, context, tool_use_id):
    """Contained execution: a negotiated allow_contained verdict. Redirect the
    effect into a per-session git worktree instead of the working tree, and
    persist the containment_ref for PostToolUse (Task 10) to resolve.

    Worktree creation failure (or not being in a git repo at all) is fail-
    toward-interruption (invariant 5): governance never lets a contained
    effect proceed unstaged. DASHCLAW_CONTAINMENT=0 is a full kill switch, not
    just a capability-advertisement toggle: a server that still emits
    allow_contained (version skew, a stale cached decision, mixed hook
    versions across a multi-hook install) must never cause a worktree to be
    created while the operator has explicitly disabled containment."""
    if not CONTAINMENT_ENABLED:
        if HOOK_MODE == "observe":
            # Observe mode never blocks or redirects, disabled or not.
            _record_observed_containment(guard_resp, context, tool_use_id)
            sys.exit(0)
        action_id = _persist_guard_recorded_action(guard_resp, tool_use_id)
        if not action_id:
            action_id = _record_running_action("handle_allow_contained", context, tool_use_id)
        log("[DashClaw] Containment disabled by DASHCLAW_CONTAINMENT=0 — interrupting.")
        _write_containment_action_state(tool_use_id, action_id, None, None)
        sys.exit(2)

    if HOOK_MODE == "observe":
        # A conformant server never emits allow_contained here (observe mode
        # never advertises the capability, so negotiation would have
        # downgraded to require_approval) — this is a defense-in-depth
        # carve-out for version skew or a misconfigured server, not a path
        # this hook's own capability gating can reach.
        _record_observed_containment(guard_resp, context, tool_use_id)
        sys.exit(0)

    action_id = _persist_guard_recorded_action(guard_resp, tool_use_id)
    if not action_id:
        action_id = _record_running_action("handle_allow_contained", context, tool_use_id)

    ensured = _ensure_containment_worktree(_SESSION_ID, _server_containment_ref(guard_resp))
    if not ensured:
        log("[DashClaw] Containment failed: could not create or reuse a containment worktree "
            "(not a git repo, or `git worktree add` failed). Failing toward interruption — "
            "a contained effect must never proceed unstaged.")
        _write_containment_action_state(tool_use_id, action_id, None, None)
        sys.exit(2)

    worktree_path, ref, base_sha = ensured
    _write_containment_action_state(tool_use_id, action_id, ref, worktree_path, base_sha)

    if tool_name in ("Write", "Edit", "MultiEdit") and CONTAINMENT_REWRITE:
        root = _repo_root()
        updated_input = _rewrite_input_for_containment(tool_input, worktree_path, root) if root else None
        if updated_input is not None:
            _emit_contained_allow(updated_input, worktree_path, ref)
            sys.exit(0)
        # Path couldn't be mapped into the worktree (no path field, or outside
        # the repo) — fall through to the instructive deny below.

    log("Contained: re-run this edit against " + worktree_path + " (containment ref " + ref
        + "). Effects will be staged for operator promotion.")
    sys.exit(2)


def _exit_ungovernable(headline, remedy):
    """Fail closed on a path that could not govern this tool call for a reason
    other than a guard outage — no verdict enforced and no ledger row, which is
    exactly the hole handle_guard_unavailable is written to close.

    Honors the SAME opt-out an operator has already chosen for degraded
    operation (DASHCLAW_GUARD_UNAVAILABLE_POLICY) instead of inventing a second
    knob, and observe mode still never blocks."""
    if HOOK_MODE == "observe":
        log("[DashClaw] [observe] " + headline + " Proceeding — observe mode never blocks.")
        sys.exit(0)

    if GUARD_UNAVAILABLE_POLICY in ("allow", "warn"):
        log("[DashClaw] ⚠ " + headline
            + " Proceeding anyway (DASHCLAW_GUARD_UNAVAILABLE_POLICY=" + GUARD_UNAVAILABLE_POLICY + ").")
        sys.exit(0)

    log("[DashClaw] Blocked: " + headline)
    log(remedy)
    log("This is by design — an action that could not be governed must not proceed.")
    log("To change: set DASHCLAW_GUARD_UNAVAILABLE_POLICY=warn or =allow (not recommended).")
    sys.exit(2)


def handle_guard_unavailable(context, tool_use_id, reason="unreachable"):
    """Guard call did not yield a decision. Behavior governed by
    DASHCLAW_GUARD_UNAVAILABLE_POLICY.

    reason="unreachable" — host did not answer (connection failure/timeout).
    reason="unauthorized" — host answered HTTP 401/403: the API key is bad or
    missing. Same policy applies, but the message names the real cause instead
    of misreporting an auth failure as "unreachable"."""
    policy = GUARD_UNAVAILABLE_POLICY
    mode = HOOK_MODE

    if reason == "unauthorized":
        state = "unauthorized - invalid or missing API key (HTTP 401); check DASHCLAW_API_KEY"
        orphan_reason = "guard_unauthorized"
    else:
        state = "unreachable"
        orphan_reason = "guard_unreachable"

    # Write orphan log record for backfill regardless of policy — never lose audit
    orphan_path = os.path.join(os.path.expanduser("~"), ".dashclaw", "orphan-actions.jsonl")
    try:
        os.makedirs(os.path.dirname(orphan_path), exist_ok=True)
        from datetime import datetime, timezone
        record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "reason": orphan_reason,
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

    attempts = "%d attempt(s)" % (GUARD_RETRIES + 1)

    # Observe mode always proceeds (by definition — observe is "warn loudly, don't block")
    if mode == "observe":
        log("[DashClaw] [observe] Guard " + state + " at " + BASE_URL + " after " + attempts + ". Action logged to ~/.dashclaw/orphan-actions.jsonl for backfill.")
        log("Action: " + context.get("declared_goal", "unknown"))
        sys.exit(0)

    # Enforce mode: behavior governed by DASHCLAW_GUARD_UNAVAILABLE_POLICY
    if policy == "allow":
        log("[DashClaw] Guard " + state + " at " + BASE_URL + " after " + attempts + "; proceeding (DASHCLAW_GUARD_UNAVAILABLE_POLICY=allow).")
        log("Action logged to ~/.dashclaw/orphan-actions.jsonl for backfill.")
        sys.exit(0)

    if policy == "warn":
        log("[DashClaw] \u26a0 Guard " + state + " at " + BASE_URL + " after " + attempts + "; proceeding anyway (DASHCLAW_GUARD_UNAVAILABLE_POLICY=warn).")
        log("Action logged to ~/.dashclaw/orphan-actions.jsonl for backfill.")
        log("Set DASHCLAW_GUARD_UNAVAILABLE_POLICY=block to fail closed instead.")
        sys.exit(0)

    # Default: block (fail closed)
    log("[DashClaw] Blocked: guard at " + BASE_URL + " is " + state + " after " + attempts + ".")
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
    """Return cached mode if fresh; None if missing, expired, or unreadable.

    A negative entry ("unreachable", written when the probe failed) uses its
    own short TTL so a recovered instance is re-probed within a minute."""
    try:
        with open(path, encoding="utf-8") as f:
            ts_line, mode_line = f.read().strip().split("\n", 1)
        mode = mode_line.strip()
        ttl = DEMO_CHECK_NEGATIVE_TTL_SECONDS if mode == "unreachable" else DEMO_CHECK_TTL_SECONDS
        if time.time() - float(ts_line) < ttl:
            return mode
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
        # Negative cache: don't re-probe a dead instance on every tool call
        # (short TTL — see DEMO_CHECK_NEGATIVE_TTL_SECONDS). Stays silent.
        _write_demo_check_cache(cache_path, "unreachable")
        return

    _write_demo_check_cache(cache_path, mode)

    if mode == "demo":
        log("[DashClaw] ⚠ DASHCLAW_BASE_URL points to a demo-mode instance (" + BASE_URL + ").")
        log("           Governance decisions will come from fixture data, not your real policies.")
        log("           Set DASHCLAW_BASE_URL to your real instance to dogfood properly.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _check_configured():
    """Exit silently when DashClaw isn't configured at all — someone who never set
    it up must never see hook noise. But if EXACTLY ONE of the two is present,
    the setup is half-done: surface a one-line reason so "nothing happened"
    is diagnosable instead of an invisible exit (the #1 setup trap)."""
    if BASE_URL and API_KEY:
        return
    if BASE_URL or API_KEY:
        missing = "DASHCLAW_API_KEY" if not API_KEY else "DASHCLAW_BASE_URL (or DASHCLAW_URL)"
        log("[DashClaw] ⚠ Governance hook is half-configured — %s is not set, so this action was NOT governed." % missing)
    sys.exit(0)


def _read_hook_input():
    """Parse stdin -- read as raw bytes and decode as UTF-8 to handle
    Windows PowerShell which pipes UTF-8 BOM bytes through cp1252 stdin.

    No readable payload at all means the hook is not being driven by Claude
    Code, so exiting 0 silently is right. A payload that WAS present and could
    not be parsed is different: a real tool call is about to run and this hook
    cannot govern it, which the old blanket exit 0 made indistinguishable from
    "not governed" (client fail-open review, 2026-08-11)."""
    try:
        raw = sys.stdin.buffer.read().decode("utf-8-sig").strip()
    except Exception:
        sys.exit(0)
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        _exit_ungovernable(
            "the hook received a tool payload it could not parse, so this call was NOT governed.",
            "Check that the DashClaw hooks match your Claude Code version, then retry.")


def _enrich_tool(tool_name, tool_input, tool_info):
    """Build enriched intel context based on tool type."""
    if tool_name in ("Bash", "PowerShell"):
        return _enrich_bash(tool_input, tool_info, label=tool_name)
    if tool_name in _FILE_TOOLS:
        return _enrich_file(tool_name, tool_input, tool_info)
    if tool_name.startswith("mcp__"):
        return _enrich_mcp(tool_name, tool_input, tool_info)
    return _enrich_default(tool_name, tool_input, tool_info)


_ACT_COMMAND_CAP = 8192
_ACT_FILE_EXCERPT_CAP = 4096

# Same pattern set as the SDKs' scrub_act (parity; the server re-redacts).
_ACT_SCRUB_PATTERNS = [
    (re.compile(r"oc_live_[A-Za-z0-9_-]+"), "[REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_-]{10,}"), "[REDACTED]"),
    (re.compile(r"ghp_[A-Za-z0-9]{20,}"), "[REDACTED]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._-]+", re.IGNORECASE), "Bearer [REDACTED]"),
]
_ACT_SCRUB_KV = re.compile(r"(password|token|secret)\s*=\s*[^\s&\"']+", re.IGNORECASE)


def _scrub_act_text(text):
    """Mask secret-looking substrings before the act leaves the machine."""
    if not text:
        return text
    for pattern, replacement in _ACT_SCRUB_PATTERNS:
        text = pattern.sub(replacement, text)
    return _ACT_SCRUB_KV.sub(lambda m: m.group(1) + "=[REDACTED]", text)


def _build_act(tool_name, tool_input):
    """Evidence-first guard: attach the actual act (shell command / file
    write) so the server can classify it and fold the derived risk in,
    independent of this hook's own (also client-side, and therefore
    tamperable) classification. PowerShell rides the same shell path as Bash
    (see _enrich_tool). See
    docs/superpowers/specs/2026-07-05-evidence-first-guard.md."""
    if tool_name in ("Bash", "PowerShell"):
        command = str(tool_input.get("command") or "")
        if not command:
            return None
        return {"kind": "shell", "command": _scrub_act_text(command[:_ACT_COMMAND_CAP])}
    if tool_name in ("Write", "Edit", "MultiEdit"):
        path = tool_input.get("file_path") or tool_input.get("path") or ""
        if not path:
            # act.file.path is required non-empty server-side; omit act rather
            # than send a payload the server would 400 on (ACT_TOO_LARGE's
            # sibling validation error), which would break the tool call.
            return None
        content = str(_outbound_content(tool_name, tool_input) or "")
        return {
            "kind": "file",
            "file": {
                "path": path,
                "content_excerpt": _scrub_act_text(content[:_ACT_FILE_EXCERPT_CAP]),
                "bytes": len(content.encode("utf-8", errors="ignore")),
            },
        }
    return None


# The guard scorer matches systems_touched against a DECLARED-SYSTEM vocabulary
# (app/lib/guard/risk.ts): filesystem/shell are +5, database/production/postgres/
# neon/redis are +10. Our internal tool categories ("execution", "file_io", ...)
# share no word with that vocabulary, so forwarding the category raw made
# systemsTouchedFactors() return [] on every Claude Code tool call — the
# modifier was dead on this path and the server risk FLOOR was thinner than the
# design says. Map to the scorer's words instead. Categories with no declared
# system of their own stay empty: inventing one would inflate the floor on
# nothing. The category itself is still reported under context["tool"].
CATEGORY_SYSTEMS = {
    "execution": ["shell"],
    "file_io": ["filesystem"],
}


def _build_guard_context(tool_name, tool_info, enrichment, tool_input):
    """Assemble the guard context dict and forward the resolved target path."""
    context = {
        "action_type": enrichment["action_type"],
        "agent_id": AGENT_ID,
        "declared_goal": enrichment["declared_goal"],
        "risk_score": enrichment["risk_score"],
        "reversible": enrichment["reversible"],
        "systems_touched": list(CATEGORY_SYSTEMS.get(tool_info["category"], [])),
        "tool": {
            "name": tool_name,
            "category": tool_info["category"],
            "required_permission": tool_info["required_permission"],
        },
        "intel": enrichment.get("intel", {}),
        # Approvals lifecycle (roadmap v2.3): declare how long this hook will
        # poll for an approval, so a require_approval row gets a truthful
        # approval_expires_at stamp (server adds a retry grace on top).
        # Clamped to the server's accepted range (5..86400).
        "approval_wait_seconds": max(5, min(int(APPROVAL_TIMEOUT), 86400)),
        # Enforcement posture: tell the server how this hook will TREAT the
        # decision (enforce = blocks stop the tool call; observe = logged
        # only). Attribution-only server-side, but it is the ONLY way the
        # dashboard can show that an agent's blocks are not actually enforced.
        "enforcement_mode": HOOK_MODE,
    }
    # Forward the resolved target path (file tools, bash redirects) so a
    # protected_path guard policy can match it. Omitted when there is no path.
    if enrichment.get("target"):
        context["target"] = enrichment["target"]
    act = _build_act(tool_name, tool_input)
    if act:
        context["act"] = act
    return context


def _outbound_content(tool_name, tool_input):
    """Return the outbound file content for a file tool, or None."""
    if tool_name == "Write":
        return tool_input.get("content")
    if tool_name == "Edit":
        return tool_input.get("new_string")
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits") or []
        return "\n".join(str(e.get("new_string", "")) for e in edits if isinstance(e, dict))
    if tool_name == "NotebookEdit":
        return tool_input.get("new_source")
    return None


def _attach_autoscan_content(context, tool_name, tool_input):
    """Auto-scan: forward the outbound file content so the guard can secret-scan
    it (warn by default; hard-blocks only when the org sets DASHCLAW_AUTOSCAN_
    BLOCK). Capped to the guard schema's content limit. Best-effort — a failure
    here must never break the tool call."""
    try:
        content = _outbound_content(tool_name, tool_input)
        if content:
            context["content"] = str(content)[:50000]
    except Exception:
        pass


def _subagent_values(data):
    return data.get("agent_id"), data.get("agent_type")


def _is_swarm_call(subagent_id, subagent_type, tool_name):
    return bool(subagent_id or subagent_type or tool_name in ("Agent", "Task", "Workflow"))


def _has_subagent_provenance(subagent_id, subagent_type):
    return bool(subagent_id or subagent_type)


def _agent_name_for(subagent_type):
    return ("%s/%s" % (AGENT_ID, subagent_type)) if subagent_type else AGENT_ID


def _apply_distinct_subagent_id(context, subagent_type):
    if SUBAGENT_IDENTITY == "distinct" and subagent_type:
        context["agent_id"] = "%s:%s" % (AGENT_ID, _subagent_id_segment(subagent_type))


def _attach_harness_session(context):
    """v4.3 fleet attribution (verdict 1): stamp harness_session_id on EVERY
    record payload, not just swarm/subagent calls. Unlike swarm_id (spawn +
    subagent leaf calls only), this rides every governed action in the
    session so a fan-out's leaves and non-subagent actions can be joined as
    one unit at read time. Server-side this is a separate column from
    session_id (which stays in the sess_* DashClaw-session namespace) — see
    docs/superpowers/specs/2026-07-04-fleet-attribution.md. Capped to the
    server's accepted length (200 chars)."""
    if _SESSION_ID:
        context["harness_session_id"] = _SESSION_ID[:200]


def _attach_subagent_provenance(context, data, tool_name):
    """Sub-agent provenance. Claude Code puts agent_id / agent_type on hook stdin
    ONLY when the call fires inside a sub-agent. We keep the governed agent_id =
    the configured parent (sub-agents inherit the parent's pairing and policies,
    matching Claude Code's own model) and record the sub-agent as provenance
    DashClaw persists: a display name, a per-session swarm group, and intel. Spawn
    calls (Agent/Task/Workflow) are also tagged into the session swarm so the
    delegation and the delegated work group together in the ledger."""
    subagent_id, subagent_type = _subagent_values(data)
    if _is_swarm_call(subagent_id, subagent_type, tool_name) and _SESSION_ID:
        context["swarm_id"] = _SESSION_ID
    if not _has_subagent_provenance(subagent_id, subagent_type):
        return
    # In `distinct` mode the sub-agent gets its own composed agent_id so it is a
    # first-class fleet identity; the server falls back to the parent's pairing
    # for permission inheritance. Default `provenance` mode keeps agent_id = parent.
    _apply_distinct_subagent_id(context, subagent_type)
    context["agent_name"] = _agent_name_for(subagent_type)
    context["trigger"] = "subagent:%s" % (subagent_type or "unknown")
    context["intel"]["subagent"] = {"agent_id": subagent_id, "agent_type": subagent_type}
    # v4.3 verdict 2a: persist the subagent instance uuid so the read path can
    # join this leaf row against its spawn row's outcome_metadata.spawned_agent_uuid.
    if subagent_id:
        context["subagent_uuid"] = str(subagent_id)[:200]


def _warn_secret_scan(guard_resp, decision):
    """Auto-scan advisory: surface a visible warning when the guard detected a
    secret in the outbound content, even on allow (warn-by-default). A 'block'
    decision is handled by handle_block below."""
    try:
        scan = guard_resp.get("secret_scan") or {}
        if scan.get("detected") and decision != "block":
            # Category LABELS only (e.g. "api_key"), never matched content —
            # charset-restricted so a hostile server response can't smuggle
            # ANSI escapes or secret bytes into the operator's terminal.
            labels = {
                re.sub(r"[^A-Za-z0-9_-]", "", str(f.get("category", "secret")))[:32]
                for f in scan.get("findings", [])
            }
            cats = ", ".join(sorted(x for x in labels if x)) or "secret"
            log("[DashClaw] ⚠ Possible secret in this content (%s) — flagged by auto-scan. Review before it leaves your machine." % cats)
    except Exception:
        pass


def _warn_assumption_alerts(guard_resp):
    """Advocate v2a: an operator invalidated an assumption this agent recorded.
    Advisory only — printed even on allow, never changes the decision. After
    surfacing, acknowledge (mark the inbox message read) so the alert stops
    riding future guard responses. The ack is the ONLY extra HTTP call and it
    fires solely when alerts are present, so the common path stays single-call."""
    try:
        alerts = guard_resp.get("assumption_alerts") or []
        if not alerts:
            return
        message_ids = []
        for a in alerts[:3]:
            text = (a.get("assumption") or "an assumption")[:120]
            reason = (a.get("invalidated_reason") or "no reason given")[:200]
            log('[DashClaw] ⚠ Operator invalidated an assumption you recorded: "%s" — reason: %s. Re-verify before relying on it.' % (text, reason))
            if a.get("message_id"):
                message_ids.append(a["message_id"])
        if message_ids:
            api_request("PATCH", "/api/messages",
                        body={"message_ids": message_ids, "action": "read", "agent_id": AGENT_ID},
                        retries=0)
    except Exception:
        pass  # fail-silent: the alert simply rides again next call


def _dispatch_decision(decision, guard_resp, context, tool_use_id, tool_name=None, tool_input=None):
    """Route the guard decision to its handler. Each handler calls sys.exit."""
    if decision == "warn":
        handle_warn(guard_resp, context, tool_use_id)
    elif decision == "block":
        handle_block(guard_resp, context, tool_use_id)
    elif decision == "require_approval":
        handle_require_approval(guard_resp, context, tool_use_id)
    elif decision == "allow_contained":
        handle_allow_contained(guard_resp, tool_name, tool_input, context, tool_use_id)
    elif decision == "allow":
        handle_allow(guard_resp, context, tool_use_id)
    else:
        # Everything unrecognized used to fall through to allow, so a verdict a
        # newer server adds — or a truncated/garbled body — executed ungoverned.
        # Land on the human instead: require_approval is the most restrictive
        # verdict that stays recoverable, where treating it as block would hard-
        # break every agent the day the server ships a new verdict name.
        log("[DashClaw] Verdict '" + str(decision)[:40]
            + "' is not one this hook understands — treating it as require_approval. "
              "Update the DashClaw hooks if this persists.")
        handle_require_approval(guard_resp, context, tool_use_id)


def main():
    _check_configured()

    # Surface a warning if the configured instance is in demo mode (todo-001).
    # Non-blocking: never exits or alters enforcement, only writes to stderr.
    _maybe_warn_demo_mode()

    data = _read_hook_input()

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    tool_use_id = data.get("tool_use_id") or "unknown"

    global _SESSION_ID, _HOOK_CWD
    _SESSION_ID = data.get("session_id") or ""
    _HOOK_CWD = data.get("cwd") or ""

    # Step 1: Classify the tool using the intel module
    tool_info = classify_tool(tool_name, tool_input)

    # Step 2: If not governed, exit 0 immediately
    if not tool_info["governed"]:
        sys.exit(0)

    # Step 3: Build enriched intel context based on tool type
    enrichment = _enrich_tool(tool_name, tool_input, tool_info)

    # Step 4: Build guard context
    context = _build_guard_context(tool_name, tool_info, enrichment, tool_input)
    _attach_harness_session(context)
    _attach_autoscan_content(context, tool_name, tool_input)
    _attach_subagent_provenance(context, data, tool_name)
    _attach_client_capabilities(context, tool_name)

    # Idempotency: tool_use_id is unique per tool call, so a blind retry of
    # the SAME call derives the same key (server dedupes the guard decision
    # and the ?record=true action row) while distinct calls never collide.
    # Skipped when the harness supplied no tool_use_id — a shared "unknown"
    # discriminator would wrongly dedupe distinct calls.
    if data.get("tool_use_id"):
        context["idempotency_key"] = derive_idempotency_key({
            "agent_id": context.get("agent_id") or "",
            "action_type": context.get("action_type") or "",
            "tool_use_id": data.get("tool_use_id"),
        })

    # Step 5: POST /api/guard with enriched context
    guard_resp = guard_check(context)
    if guard_resp is AUTH_FAILED:
        handle_guard_unavailable(context, tool_use_id, reason="unauthorized")
    if guard_resp is None:
        handle_guard_unavailable(context, tool_use_id)

    # Step 6: Handle decision
    # No default verdict: a body with no `decision` is a garbled response, not
    # an allow — _dispatch_decision routes it to the human like any other
    # verdict this hook can't read.
    decision = guard_resp.get("decision") or ""
    _warn_secret_scan(guard_resp, decision)
    _warn_assumption_alerts(guard_resp)
    _dispatch_decision(decision, guard_resp, context, tool_use_id, tool_name, tool_input)


if __name__ == "__main__":
    main()
