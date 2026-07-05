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

import hashlib
import hmac
import json
import os
import re
import socket
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


def _fetch_recorder_config(base, key):
    """Perform the actual HTTP GET for the recorder config. Returns a normalized
    {"enabled": bool, "until": ...} dict, or {} on any failure. Stdlib only."""
    try:
        import urllib.request

        req = urllib.request.Request(
            base + "/api/behavior/recorder",
            headers={"x-api-key": key, "accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, dict):
            return {"enabled": bool(data.get("enabled")), "until": data.get("until")}
    except Exception:
        pass
    return {}


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
    _server_config_cache = _fetch_recorder_config(base, key)
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


def _strip_home_prefix(p):
    """Replace a leading home-directory prefix with ``~``."""
    home = os.path.expanduser("~").replace("\\", "/")
    if home and p.startswith(home):
        return "~" + p[len(home):]
    return p


def _relativize_workspace(p, workspace=None):
    """Make a path workspace-relative when it lives under the workspace root."""
    ws = (workspace or os.environ.get("DASHCLAW_WORKSPACE") or "").replace("\\", "/")
    if ws and p.startswith(ws):
        return p[len(ws):].lstrip("/") or "."
    return p


def redact_path(path, workspace=None):
    """Normalize, home-strip, workspace-relativize, and scrub a path."""
    if not path:
        return None
    p = str(path).replace("\\", "/")
    p = _strip_home_prefix(p)
    p = _relativize_workspace(p, workspace)
    return redact_text(p)


def _looks_like_path(tok):
    """True for an operand that should be masked as ``<path>`` (a slash-bearing,
    home-relative, or variable-expanded token)."""
    return "/" in tok or "\\" in tok or tok.startswith("~") or tok.startswith("$")


def _shape_token(tok):
    """Reduce one command token to its secret-free shape."""
    if tok.startswith("<REDACTED:"):
        return tok
    if tok.startswith("-"):
        return tok.split("=")[0]  # keep flag name, drop value
    if re.match(r"^https?://", tok):
        return "<url>"
    if _looks_like_path(tok):
        return "<path>"
    return tok


def command_shape(command, workspace=None):
    """Reduce a shell command to a redacted, secret-free shape that preserves
    verbs/flags (so destructive shapes like ``rm -rf`` / ``git push --force``
    remain detectable) while replacing path/url/value operands with placeholders.
    """
    if not command:
        return None
    scrubbed = redact_text(command)
    shaped = [_shape_token(tok) for tok in scrubbed.split()[:12]]
    return " ".join(shaped)[:120]


# ── Sample construction ───────────────────────────────────────────────────────

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _detect_model():
    for key in ("DASHCLAW_MODEL", "ANTHROPIC_MODEL", "CLAUDE_MODEL"):
        v = os.environ.get(key)
        if v:
            return v.strip()
    return None


def _resolve_sample_paths(tool_name, tool_input, context, workspace=None):
    """Return ``(read_paths, write_paths)`` for the tool, each a redacted list
    (0 or 1 entries). Mirrors the original elif ladder exactly."""
    if tool_name in _FILE_WRITE_TOOLS:
        return [], _one_redacted_path(_first_value(tool_input, ("file_path", "path", "notebook_path")), workspace)
    if tool_name in _FILE_READ_TOOLS:
        return _one_redacted_path(_first_value(tool_input, ("file_path", "notebook_path")), workspace), []
    if tool_name == "Bash":
        return [], _one_redacted_path(context.get("target"), workspace)
    return [], []


def _first_value(source, keys):
    for key in keys:
        value = source.get(key)
        if value:
            return value
    return None


def _one_redacted_path(path, workspace=None):
    rp = redact_path(path, workspace)
    return [rp] if rp else []


def _context_field(context, key, default=None):
    value = context.get(key)
    return default if value is None else value


def _tool_category(context):
    return ((context.get("tool") or {}).get("category")) or None


def _sample_identity(context, workspace):
    ws = workspace or os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd()
    return {
        "session_id": context.get("swarm_id") or None,
        "agent_id": context.get("agent_id") or "claude-code",
        "agent_name": context.get("agent_name") or None,
        "project": os.path.basename(os.path.normpath(ws)) or None,
    }


def _command_shape_for(tool_name, tool_input, workspace=None):
    return command_shape(tool_input.get("command"), workspace) if tool_name == "Bash" else None


def _sample_static_fields(tool_name, context, workspace):
    sample = {
        "schema_version": 1,
        "event_id": "bse_" + uuid.uuid4().hex[:16],
        "ts": _now_iso(),
        "source": "claude-code",
        "model": _detect_model(),
        "tool": tool_name,
        "tool_category": _tool_category(context),
    }
    sample.update(_sample_identity(context, workspace))
    return sample


def _sample_intel_fields(tool_name, tool_input, context, intel, workspace):
    bash_intel = intel.get("bash") or {}
    read_paths, write_paths = _resolve_sample_paths(tool_name, tool_input, context, workspace)
    return {
        "command_shape": _command_shape_for(tool_name, tool_input, workspace),
        "bash_intent": bash_intel.get("intent"),
        "read_paths": read_paths,
        "write_paths": write_paths,
        "sensitive_path": bool((intel.get("file") or {}).get("sensitive_path")),
    }


def _sample_governance_fields(context, guard_resp, decision):
    return {
        "action_type": _context_field(context, "action_type", "other"),
        "risk_score": _context_field(context, "risk_score"),
        "reversible": _context_field(context, "reversible"),
        "guard_decision": decision or "allow",
        "matched_policies": (guard_resp or {}).get("matched_policies") or [],
    }


def _sample_outcome_fields():
    return {
        "outcome_status": "running",
        "error_type": None,
        "duration_ms": None,
        "action_id": None,
    }


def build_pre_sample(tool_name, tool_input, context, guard_resp, decision, workspace=None):
    """Assemble the pre-execution portion of a sample dict (already redacted)."""
    intel = (context or {}).get("intel") or {}
    sample = _sample_static_fields(tool_name, context, workspace)
    sample.update(_sample_intel_fields(tool_name, tool_input, context, intel, workspace))
    sample.update(_sample_governance_fields(context, guard_resp, decision))
    sample.update(_sample_outcome_fields())
    return sample


# ── Pending bridge (pretool → posttool) ───────────────────────────────────────

def _pending_path(tool_use_id):
    return os.path.join(tempfile.gettempdir(), _PENDING_PREFIX + (tool_use_id or "unknown"))


def _load_pending(path):
    """Read and JSON-decode a pending sample file. Returns the dict, or None when
    the file is missing or unparseable."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.loads(f.read())
    except (OSError, ValueError):
        return None


def _remove_quietly(path):
    """Delete a file, swallowing OS errors."""
    try:
        os.remove(path)
    except OSError:
        pass


def _elapsed_ms(start_ms):
    """Milliseconds since ``start_ms`` (clamped at 0), or None when unset."""
    if not start_ms:
        return None
    return max(0, int(time.time() * 1000) - int(start_ms))


def _remove_if_stale(path, now):
    """Remove a pending file if it is older than the TTL. Best-effort."""
    try:
        if now - os.path.getmtime(path) > _PENDING_TTL_SECONDS:
            os.remove(path)
    except OSError:
        pass


def _sweep_stale_pending():
    """Best-effort removal of pending files older than the TTL (denied-approval
    samples never get flushed by posttool, so they would otherwise linger)."""
    try:
        tmp = tempfile.gettempdir()
        now = time.time()
        for name in os.listdir(tmp):
            if not name.startswith(_PENDING_PREFIX):
                continue
            _remove_if_stale(os.path.join(tmp, name), now)
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
        sample = _load_pending(path)
        if sample is None:
            return
        start_ms = sample.pop("_start_ms", None)
        sample["outcome_status"] = "completed" if status == "completed" else "failed"
        sample["error_type"] = (outcome_metadata or {}).get("error_type")
        elapsed = _elapsed_ms(start_ms)
        if elapsed is not None:
            sample["duration_ms"] = elapsed
        if action_id:
            sample["action_id"] = action_id
        append_sample(sample, workspace)
        _remove_quietly(path)
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
            _flush_interrupted(os.path.join(tmp, name), workspace)
    except Exception:
        pass


def _flush_interrupted(path, workspace=None):
    """Finalize one stranded pending sample as ``interrupted`` and remove it."""
    sample = _load_pending(path)
    if sample is None:
        return
    start_ms = sample.pop("_start_ms", None)
    sample["outcome_status"] = "interrupted"
    elapsed = _elapsed_ms(start_ms)
    if elapsed is not None:
        sample["duration_ms"] = elapsed
    append_sample(sample, workspace)
    _remove_quietly(path)


# ── Insights snapshot (safe aggregate for hosted display) ──────────────────────
# The local machine is the only place that can read the (local-only) samples.
# build_insights() distills them into a SAFE aggregate — counts, per-agent
# tallies, signal totals, and timestamps — with NO command shapes, paths, or
# goals. The Stop hook posts this to /api/behavior/insights so a hosted DashClaw
# dashboard can show that DashClaw is alive and learning, without any raw
# behavior ever leaving the machine.

_DAY_FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.jsonl$")
_INSIGHTS_MAX_AGENTS = 25
_INSIGHTS_MAX_LINES = 200000  # hard ceiling so a runaway log can't stall the hook
_HIGH_RISK_THRESHOLD = 70


def _ts_seconds(sample):
    try:
        return datetime.fromisoformat(str(sample.get("ts", "")).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _pick_final_insight(a, b):
    """Mirror the JS pickFinalSample: a finalized record supersedes a 'running'
    one; among same-tier records the latest ts wins."""
    a_running = a.get("outcome_status") == "running"
    b_running = b.get("outcome_status") == "running"
    if a_running != b_running:
        return b if a_running else a
    return b if _ts_seconds(b) >= _ts_seconds(a) else a


def _parse_sample_line(line):
    """Parse one JSONL line into a valid sample dict, or None when the line is
    blank, unparseable, or missing the required event_id/agent_id keys."""
    line = line.strip()
    if not line:
        return None
    try:
        obj = json.loads(line)
    except Exception:
        return None
    if obj.get("event_id") and obj.get("agent_id"):
        return obj
    return None


def _append_day_samples(path, out):
    """Append valid samples from one day-file into ``out`` (in place). Returns
    True once the global line cap is reached so the caller can stop early."""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                obj = _parse_sample_line(line)
                if obj is None:
                    continue
                out.append(obj)
                if len(out) >= _INSIGHTS_MAX_LINES:
                    return True
    except OSError:
        pass
    return False


def _read_recent_samples(workspace=None, window_days=7):
    """Read recent JSONL samples (newest day-files first, capped). Stdlib only."""
    directory = samples_dir(workspace)
    try:
        names = [n for n in os.listdir(directory) if _DAY_FILE_RE.match(n)]
    except OSError:
        return []
    names.sort(reverse=True)  # newest day first
    if window_days and window_days > 0:
        names = names[:window_days]
    out = []
    for name in names:
        if _append_day_samples(os.path.join(directory, name), out):
            break
    return out


def _merge_by_event_id(raw):
    """Collapse running+finalized records sharing an event_id so a pre/post pair
    counts once (matches the dashboard's merge-on-read semantics)."""
    by_id = {}
    for s in raw:
        eid = str(s.get("event_id"))
        existing = by_id.get(eid)
        by_id[eid] = s if existing is None else _pick_final_insight(existing, s)
    return list(by_id.values())


def _empty_signals():
    return {
        "destructive_commands": 0,
        "protected_path_writes": 0,
        "failed_actions": 0,
        "high_risk_actions": 0,
        "blocked": 0,
        "approvals": 0,
    }


def _get_or_create_agent(agents, agent_id):
    """Fetch the running per-agent tally, creating it on first sight."""
    a = agents.get(agent_id)
    if a is None:
        a = {"agent_id": agent_id, "count": 0, "destructive": 0,
             "protected_writes": 0, "failed": 0, "_tools": set()}
        agents[agent_id] = a
    return a


def _is_high_risk(sample):
    """True when the sample's risk_score meets the high-risk threshold."""
    try:
        return float(sample.get("risk_score") or 0) >= _HIGH_RISK_THRESHOLD
    except (TypeError, ValueError):
        return False


def _accumulate_tool(sample, agent):
    tool = sample.get("tool")
    if tool:
        agent["_tools"].add(tool)


def _accumulate_intent_signals(sample, agent, signals):
    if sample.get("bash_intent") == "destructive":
        agent["destructive"] += 1
        signals["destructive_commands"] += 1
    if sample.get("sensitive_path"):
        agent["protected_writes"] += 1
        signals["protected_path_writes"] += 1


def _accumulate_status_signals(sample, agent, signals):
    status = sample.get("outcome_status")
    if status == "failed":
        agent["failed"] += 1
        signals["failed_actions"] += 1
    elif status == "blocked":
        signals["blocked"] += 1


def _accumulate_guard_signals(sample, signals):
    if sample.get("guard_decision") == "require_approval":
        signals["approvals"] += 1
    if _is_high_risk(sample):
        signals["high_risk_actions"] += 1


def _accumulate_sample(s, agents, signals):
    """Fold one merged sample into the per-agent tallies and signal counters."""
    a = _get_or_create_agent(agents, s.get("agent_id") or "unknown")
    a["count"] += 1
    _accumulate_tool(s, a)
    _accumulate_intent_signals(s, a, signals)
    _accumulate_status_signals(s, a, signals)
    _accumulate_guard_signals(s, signals)


def _ts_span(samples):
    """Return ``(oldest_ts, newest_ts)`` across samples (lexicographic ISO
    compare, matching the original)."""
    oldest = None
    newest = None
    for s in samples:
        ts = s.get("ts")
        if not ts:
            continue
        if oldest is None or ts < oldest:
            oldest = ts
        if newest is None or ts > newest:
            newest = ts
    return oldest, newest


def _build_agent_list(agents):
    """Project the per-agent tallies into the public, count-sorted, capped list."""
    agent_list = [
        {
            "agent_id": a["agent_id"],
            "count": a["count"],
            "destructive": a["destructive"],
            "protected_writes": a["protected_writes"],
            "failed": a["failed"],
            "tools": len(a["_tools"]),
        }
        for a in agents.values()
    ]
    agent_list.sort(key=lambda x: x["count"], reverse=True)
    return agent_list[:_INSIGHTS_MAX_AGENTS]


def _host_label():
    """Best-effort, length-bounded hostname for the insights snapshot."""
    try:
        return (socket.gethostname() or "")[:64] or None
    except Exception:
        return None


def build_insights(workspace=None, window_days=7):
    """Compute the SAFE aggregate snapshot from local samples.

    Returns a dict ready to POST to /api/behavior/insights, or None when there
    are no samples. Counts only — never command shapes, paths, or goals."""
    raw = _read_recent_samples(workspace, window_days)
    if not raw:
        return None

    merged = _merge_by_event_id(raw)
    if not merged:
        return None

    agents = {}
    signals = _empty_signals()
    for s in merged:
        _accumulate_sample(s, agents, signals)

    oldest, newest = _ts_span(merged)

    return {
        "schema_version": 1,
        "host_label": _host_label(),
        "window_days": window_days,
        "sample_count": len(merged),
        "agent_count": len(agents),
        "oldest_ts": oldest,
        "newest_ts": newest,
        "signals": signals,
        "agents": _build_agent_list(agents),
    }


# ── Anonymized upload projection (opt-in remote Policy Coach) ─────────────────
# anonymize_sample_for_upload() projects one local sample into the upload-safe
# shape used by POST /api/behavior/samples/ingest. It BUILDS UP a new dict from
# an explicit allowlist (never copy-then-delete), so a field added to the local
# sample format can never leak to the server by accident. Identifying values
# (session_id, paths) become salted HMAC tokens — string identity is preserved
# so server-side loop detection keeps working — and write paths additionally
# get classified into protected-path GROUP names so protected_path_approval
# suggestions work without the server ever seeing a real path.

# Mirror of PROTECTED_PATH_GROUPS in app/lib/behavior/path-match.ts — keep the
# two in sync so the group a client reports is the group the guard enforces.
_PROTECTED_PATH_GROUPS = {
    "auth": ["**/auth/**", "**/auth.js", "**/auth.mjs", "app/login/**", "app/api/auth/**", "**/authConfig*"],
    "middleware": ["middleware.js", "middleware.ts", "**/middleware.js", "**/middleware.ts"],
    "billing": ["**/billing.js", "**/billing/**", "app/api/billing/**", "**/stripe*"],
    "secrets": ["**/secrets/**", "**/.env", "**/.env.*", "**/*.pem", "**/id_rsa*", "**/*.key", "app/secrets/**"],
    "organism": [".organism/**", "**/.organism/**", "organism.json"],
    "livingcode": ["livingcode/**", "**/livingcode/**", "public/livingcode/**"],
    "cron/gateway": ["**/cron/**", "vercel.json", "**/gateway*", "**/openclaw.json", "docker-compose.yml", "Dockerfile"],
}

# Fields copied through verbatim. Everything else is dropped, hashed, or
# rebuilt (session_id, read_paths, write_paths, write_path_groups,
# matched_policy_count, command_shape).
_UPLOAD_KEEP_FIELDS = (
    "schema_version", "event_id", "ts", "source", "model", "tool",
    "tool_category", "bash_intent", "action_type", "risk_score", "reversible",
    "guard_decision", "sensitive_path", "outcome_status", "error_type",
    "duration_ms", "agent_id",
)

# Bare command operands that may survive masking — generic verbs the analyzer
# needs (reload-loop / failed-loop detection) that can never identify anything.
_UPLOAD_SAFE_OPERANDS = frozenset({
    "test", "lint", "build", "typecheck", "format", "status", "diff", "log",
    "coverage", "--version",
})


def _normalize_glob_path(p):
    """Mirror of normalizePath in path-match.ts (forward slashes, drop a
    Windows drive prefix, strip leading ./)."""
    if p is None:
        return ""
    s = str(p).strip().replace("\\", "/")
    s = re.sub(r"^[a-zA-Z]:/", "/", s)
    while s.startswith("./"):
        s = s[2:]
    return s


def _glob_to_regex(glob):
    """Mirror of globToRegExp in path-match.ts: `**` crosses `/`, `*` does not."""
    normalized = _normalize_glob_path(glob)
    out = "^"
    i = 0
    while i < len(normalized):
        c = normalized[i]
        if c == "*":
            if i + 1 < len(normalized) and normalized[i + 1] == "*":
                i += 1
                if i + 1 < len(normalized) and normalized[i + 1] == "/":
                    i += 1
                out += ".*"
            else:
                out += "[^/]*"
        elif c in "\\^$.|?+()[]{}":
            out += "\\" + c
        else:
            out += c
        i += 1
    return re.compile(out + "$")


def _matches_protected_path(path, patterns):
    """Mirror of matchesProtectedPath: anchored glob match plus the bare
    relative-pattern suffix fallback (`middleware.js` catches `a/b/middleware.js`)."""
    norm = _normalize_glob_path(path)
    if not norm or not patterns:
        return False
    for pattern in patterns:
        if not pattern:
            continue
        if _glob_to_regex(pattern).match(norm):
            return True
        p = str(pattern)
        if not p.startswith("**") and not p.startswith("/"):
            if _glob_to_regex("**/" + p).match(norm):
                return True
    return False


def classify_protected_path(path):
    """Return the protected-group label for a path, or None if unprotected."""
    for group, patterns in _PROTECTED_PATH_GROUPS.items():
        if _matches_protected_path(path, patterns):
            return group
    return None


def _hmac_token(salt, prefix, value):
    """Salted HMAC-SHA256 token (prefix + first 12 hex). Same salt + same
    value ⇒ same token, so string-identity-based detectors keep working."""
    digest = hmac.new(
        str(salt).encode("utf-8"), str(value).encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return prefix + digest[:12]


def _mask_command_shape_for_upload(shape):
    """Tighten an already-shaped command for transit: keep the first two tokens
    (verb + subcommand), flag tokens, existing placeholders, and a small safe
    operand allowlist; every other bare operand becomes <arg>."""
    if not shape:
        return None
    out = []
    for i, tok in enumerate(str(shape).split()):
        if i < 2 or tok.startswith("-") or tok.startswith("<") or tok in _UPLOAD_SAFE_OPERANDS:
            out.append(tok)
        else:
            out.append("<arg>")
    return " ".join(out)


def anonymize_sample_for_upload(sample, salt):
    """Project one recorded sample into the upload-safe shape.

    Returns a NEW dict containing ONLY allowlisted keys (built up, never
    copy-then-delete). Drops declared_goal/project/agent_name/intel entirely,
    replaces matched_policies with matched_policy_count, hashes session_id and
    every path with the caller's salt, adds write_path_groups, and masks
    command_shape operands. The salt itself is never stored in the result."""
    src = sample if isinstance(sample, dict) else {}
    out = {}
    for key in _UPLOAD_KEEP_FIELDS:
        if key in src:
            out[key] = src[key]
    sid = src.get("session_id")
    out["session_id"] = _hmac_token(salt, "sh_", sid) if sid else None
    out["read_paths"] = [_hmac_token(salt, "ph_", p) for p in (src.get("read_paths") or []) if p]
    out["write_paths"] = [_hmac_token(salt, "ph_", p) for p in (src.get("write_paths") or []) if p]
    groups = []
    for p in (src.get("write_paths") or []):
        g = classify_protected_path(p)
        if g and g not in groups:
            groups.append(g)
    out["write_path_groups"] = groups
    out["matched_policy_count"] = len(src.get("matched_policies") or [])
    out["command_shape"] = _mask_command_shape_for_upload(src.get("command_shape"))
    return out
