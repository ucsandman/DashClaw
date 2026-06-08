"""Behavior Learning passive recorder.

Writes redacted JSONL behavior samples to a LOCAL directory
(``.dashclaw/behavior-samples/<YYYY-MM-DD>.jsonl`` by default) so the DashClaw
Policy Coach can analyze real Claude Code / agent usage and suggest
evidence-backed policies. Nothing is uploaded anywhere by this module.

Design constraints (all non-negotiable):
  * Opt-in: does nothing unless ``DASHCLAW_BEHAVIOR_SAMPLES_ENABLED`` is truthy.
  * Fail-silent: every public function swallows all exceptions. Recording must
    never block, slow, or break a tool call.
  * No raw secrets: command shapes, paths, and goals are scrubbed of API keys,
    tokens, env assignments, and private keys before they touch disk. Full
    transcripts and message bodies are never stored.

Stdlib only. Mirrors the secret patterns in
``app/lib/claude-code/optimal-files/secret-scan.js`` so the recorder, code
sessions, and the JS-side defensive re-redaction never disagree.
"""

import json
import os
import re
import tempfile
import time
import uuid
from datetime import datetime, timezone

# ── Config ───────────────────────────────────────────────────────────────────

_PENDING_PREFIX = "dashclaw_behavior_pending_"
_PENDING_TTL_SECONDS = 24 * 3600
_MAX_FIELD = 200
_FILE_WRITE_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "NotebookEdit"})
_FILE_READ_TOOLS = frozenset({"Read", "NotebookRead"})
_SESSION_ID_RE = re.compile(r"[^A-Za-z0-9._-]")

# Secret patterns — kept in sync with secret-scan.js. (name, compiled regex).
_SECRET_PATTERNS = [
    ("stripe_test", re.compile(r"sk_test_[A-Za-z0-9]{8,}")),
    ("stripe_live", re.compile(r"sk_live_[A-Za-z0-9]{8,}")),
    ("stripe_webhook", re.compile(r"whsec_[A-Za-z0-9]{8,}")),
    ("anthropic_key", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai_key", re.compile(r"sk-[A-Za-z0-9]{20,}")),
    ("github_pat", re.compile(r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}")),
    ("aws_access", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----")),
    ("env_assign", re.compile(r"\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CRED|AUTH))\s*=\s*['\"]?[^\s'\"]+")),
]


# Cached per-process so the server config is fetched at most once per agent run
# (None = not yet fetched; {} = fetched/failed with no usable config).
_server_config_cache = None


def _server_recorder_config():
    """Fetch the org's recorder config from the DashClaw server, once per
    process. Fail-safe: any error (no creds, unreachable, bad JSON, timeout)
    returns {} so the recorder simply stays off. Stdlib only."""
    global _server_config_cache
    if _server_config_cache is not None:
        return _server_config_cache
    _server_config_cache = {}
    base = (os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL") or "").rstrip("/")
    key = os.environ.get("DASHCLAW_API_KEY") or ""
    if not base or not key:
        return _server_config_cache
    try:
        import urllib.request

        req = urllib.request.Request(
            base + "/api/behavior/recorder",
            headers={"x-api-key": key, "accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, dict):
            _server_config_cache = {
                "enabled": bool(data.get("enabled")),
                "until": data.get("until"),
            }
    except Exception:
        _server_config_cache = {}
    return _server_config_cache


def is_enabled():
    """True when the recorder is switched on.

    Precedence:
      1. ``DASHCLAW_BEHAVIOR_SAMPLES_ENABLED`` env var, when explicitly set
         (1/true/yes ⇒ on, 0/false/no ⇒ off) — always wins.
      2. Otherwise the org's UI toggle (GET /api/behavior/recorder), honoring an
         optional auto-stop window. Fetched once per process, fail-safe to off.
    """
    val = (os.environ.get("DASHCLAW_BEHAVIOR_SAMPLES_ENABLED") or "").strip().lower()
    if val in ("1", "true", "yes"):
        return True
    if val in ("0", "false", "no"):
        return False

    cfg = _server_recorder_config()
    if not cfg.get("enabled"):
        return False
    until = cfg.get("until")
    if until:
        try:
            exp = datetime.fromisoformat(str(until).replace("Z", "+00:00"))
            if datetime.now(timezone.utc) >= exp:
                return False  # auto-stop window elapsed
        except Exception:
            pass
    return True


def samples_dir(workspace=None):
    """Resolve the local samples directory. Override with
    DASHCLAW_BEHAVIOR_SAMPLES_DIR; otherwise <workspace>/.dashclaw/behavior-samples."""
    override = os.environ.get("DASHCLAW_BEHAVIOR_SAMPLES_DIR")
    if override and override.strip():
        return os.path.abspath(override.strip())
    base = workspace or os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd()
    return os.path.join(base, ".dashclaw", "behavior-samples")


# ── Redaction ─────────────────────────────────────────────────────────────────

def redact_text(value):
    """Scrub secrets out of a string and bound its length."""
    if value is None:
        return None
    out = str(value)
    for name, pattern in _SECRET_PATTERNS:
        if name == "env_assign":
            out = pattern.sub(lambda m: m.group(1) + "=<REDACTED:env_assign>", out)
        else:
            out = pattern.sub("<REDACTED:%s>" % name, out)
    if len(out) > _MAX_FIELD:
        out = out[:_MAX_FIELD]
    return out


def redact_path(path, workspace=None):
    """Normalize, home-strip, workspace-relativize, and scrub a path."""
    if not path:
        return None
    p = str(path).replace("\\", "/")
    home = os.path.expanduser("~").replace("\\", "/")
    if home and p.startswith(home):
        p = "~" + p[len(home):]
    ws = (workspace or os.environ.get("DASHCLAW_WORKSPACE") or "").replace("\\", "/")
    if ws and p.startswith(ws):
        p = p[len(ws):].lstrip("/") or "."
    return redact_text(p)


def command_shape(command, workspace=None):
    """Reduce a shell command to a redacted, secret-free shape that preserves
    verbs/flags (so destructive shapes like ``rm -rf`` / ``git push --force``
    remain detectable) while replacing path/url/value operands with placeholders.
    """
    if not command:
        return None
    scrubbed = redact_text(command)
    tokens = scrubbed.split()
    shaped = []
    for tok in tokens[:12]:
        if tok.startswith("<REDACTED:"):
            shaped.append(tok)
        elif tok.startswith("-"):
            shaped.append(tok.split("=")[0])  # keep flag name, drop value
        elif re.match(r"^https?://", tok):
            shaped.append("<url>")
        elif "/" in tok or "\\" in tok or tok.startswith("~") or tok.startswith("$"):
            shaped.append("<path>")
        else:
            shaped.append(tok)
    out = " ".join(shaped)
    return out[:120]


# ── Sample construction ───────────────────────────────────────────────────────

def _safe_session_id(session_id):
    if not session_id:
        return ""
    return _SESSION_ID_RE.sub("_", session_id)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _detect_model():
    for key in ("DASHCLAW_MODEL", "ANTHROPIC_MODEL", "CLAUDE_MODEL"):
        v = os.environ.get(key)
        if v:
            return v.strip()
    return None


def build_pre_sample(tool_name, tool_input, context, guard_resp, decision, workspace=None):
    """Assemble the pre-execution portion of a sample dict (already redacted)."""
    intel = (context or {}).get("intel") or {}
    bash_intel = intel.get("bash") or {}
    write_paths = []
    read_paths = []

    if tool_name in _FILE_WRITE_TOOLS:
        p = tool_input.get("file_path") or tool_input.get("path") or tool_input.get("notebook_path")
        rp = redact_path(p, workspace)
        if rp:
            write_paths.append(rp)
    elif tool_name in _FILE_READ_TOOLS:
        p = tool_input.get("file_path") or tool_input.get("notebook_path")
        rp = redact_path(p, workspace)
        if rp:
            read_paths.append(rp)
    elif tool_name == "Bash" and context.get("target"):
        rp = redact_path(context.get("target"), workspace)
        if rp:
            write_paths.append(rp)

    cmd_shape = None
    if tool_name == "Bash":
        cmd_shape = command_shape(tool_input.get("command"), workspace)

    ws = workspace or os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd()
    return {
        "schema_version": 1,
        "event_id": "bse_" + uuid.uuid4().hex[:16],
        "ts": _now_iso(),
        "source": "claude-code",
        "session_id": context.get("swarm_id") or None,
        "agent_id": context.get("agent_id") or "claude-code",
        "agent_name": context.get("agent_name") or None,
        "model": _detect_model(),
        "project": os.path.basename(os.path.normpath(ws)) or None,
        "tool": tool_name,
        "tool_category": ((context.get("tool") or {}).get("category")) or None,
        "action_type": context.get("action_type") or "other",
        "command_shape": cmd_shape,
        "bash_intent": bash_intel.get("intent"),
        "read_paths": read_paths,
        "write_paths": write_paths,
        "risk_score": context.get("risk_score"),
        "reversible": context.get("reversible"),
        "guard_decision": decision or "allow",
        "matched_policies": (guard_resp or {}).get("matched_policies") or [],
        "outcome_status": "running",
        "error_type": None,
        "duration_ms": None,
        "action_id": None,
        "sensitive_path": bool((intel.get("file") or {}).get("sensitive_path")),
    }


# ── Pending bridge (pretool → posttool) ───────────────────────────────────────

def _pending_path(tool_use_id):
    return os.path.join(tempfile.gettempdir(), _PENDING_PREFIX + (tool_use_id or "unknown"))


def _sweep_stale_pending():
    """Best-effort removal of pending files older than the TTL (denied-approval
    samples never get flushed by posttool, so they would otherwise linger)."""
    try:
        tmp = tempfile.gettempdir()
        now = time.time()
        for name in os.listdir(tmp):
            if not name.startswith(_PENDING_PREFIX):
                continue
            path = os.path.join(tmp, name)
            try:
                if now - os.path.getmtime(path) > _PENDING_TTL_SECONDS:
                    os.remove(path)
            except OSError:
                pass
    except Exception:
        pass


def append_sample(sample, workspace=None):
    """Append one redacted sample as a JSONL line. Fail-silent."""
    try:
        directory = samples_dir(workspace)
        os.makedirs(directory, exist_ok=True)
        day = (sample.get("ts") or _now_iso())[:10]
        path = os.path.join(directory, day + ".jsonl")
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(sample, ensure_ascii=False) + "\n")
    except Exception:
        pass


def record_pre(tool_use_id, tool_name, tool_input, context, guard_resp, decision, hook_mode="enforce", workspace=None):
    """Called by PreToolUse once the guard decision is known.

    For tools that will execute, stashes a pending sample completed later by
    PostToolUse. For an enforce-mode block (the tool never runs, so PostToolUse
    won't fire) writes the terminal 'blocked' sample immediately.
    """
    if not is_enabled():
        return
    try:
        sample = build_pre_sample(tool_name, tool_input or {}, context or {}, guard_resp or {}, decision, workspace)
        if decision == "block" and hook_mode == "enforce":
            sample["outcome_status"] = "blocked"
            append_sample(sample, workspace)
            return
        # Will execute (allow/warn/approved). Persist the "running" record NOW so
        # the sample survives even if PostToolUse never fires (it misses ~96% of
        # the time). PostToolUse later appends a finalized record with the SAME
        # event_id; readSamples merges by event_id (finalized supersedes running).
        append_sample(sample, workspace)
        # Also stash a pending copy (with the start clock) so PostToolUse — or the
        # Stop-hook flush — can finalize this exact event.
        pending = dict(sample)
        pending["_start_ms"] = int(time.time() * 1000)
        with open(_pending_path(tool_use_id), "w", encoding="utf-8") as f:
            f.write(json.dumps(pending, ensure_ascii=False))
    except Exception:
        pass


def record_post(tool_use_id, status, outcome_metadata=None, action_id=None, workspace=None):
    """Called by PostToolUse. Finalizes the pending sample with the outcome and
    appends it. No-op if the recorder is disabled or there is no pending sample."""
    if not is_enabled():
        return
    try:
        path = _pending_path(tool_use_id)
        try:
            with open(path, "r", encoding="utf-8") as f:
                sample = json.loads(f.read())
        except (OSError, ValueError):
            return
        start_ms = sample.pop("_start_ms", None)
        sample["outcome_status"] = "completed" if status == "completed" else "failed"
        meta = outcome_metadata or {}
        sample["error_type"] = meta.get("error_type")
        if start_ms:
            sample["duration_ms"] = max(0, int(time.time() * 1000) - int(start_ms))
        if action_id:
            sample["action_id"] = action_id
        append_sample(sample, workspace)
        try:
            os.remove(path)
        except OSError:
            pass
        _sweep_stale_pending()
    except Exception:
        pass


def record_stop(workspace=None):
    """Called by the Stop / SessionEnd hook.

    Sweeps every pending sample that PreToolUse stashed but PostToolUse never
    finalized (the ~96% PostToolUse-miss case, and any tool still 'running' when
    the turn ended) and flushes it to the JSONL log as ``outcome_status:
    "interrupted"`` — so an early stop no longer loses data. The PreToolUse-time
    'running' record is already on disk; readSamples merges the two by event_id
    (interrupted supersedes running). Fail-silent, local-only, no server needed.
    """
    if not is_enabled():
        return
    try:
        tmp = tempfile.gettempdir()
        try:
            names = os.listdir(tmp)
        except OSError:
            return
        for name in names:
            if not name.startswith(_PENDING_PREFIX):
                continue
            path = os.path.join(tmp, name)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    sample = json.loads(f.read())
            except (OSError, ValueError):
                continue
            start_ms = sample.pop("_start_ms", None)
            sample["outcome_status"] = "interrupted"
            if start_ms:
                sample["duration_ms"] = max(0, int(time.time() * 1000) - int(start_ms))
            append_sample(sample, workspace)
            try:
                os.remove(path)
            except OSError:
                pass
    except Exception:
        pass
