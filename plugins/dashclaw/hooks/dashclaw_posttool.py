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

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error
from datetime import datetime, timezone

# Import the shared HTTP retry helper from the sibling intel package.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel.http_client import request_with_retry
from dashclaw_agent_intel.stop_state import contained_turn_path as _contained_turn_path

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
    URL. Mirrors dashclaw_pretool.py's _resolve_base_url -- see there for the
    2026-07-27 incident this fixes. Both hooks must resolve identically so a
    tool call governed under one BASE_URL isn't PATCHed against another."""
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
# Configuration
# ---------------------------------------------------------------------------

def _argv_agent_id():
    # Mirrors dashclaw_pretool.py's _argv_agent_id: the harness integration
    # that wires this hook may append `--agent-id <id>` to the command line.
    # Needed here (not just for identity) so the instance-state hash below
    # matches pretool's when a harness passes the flag to both.
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

# Short stable hash of (resolved BASE_URL + AGENT_ID) -- must match
# dashclaw_pretool.py's _INSTANCE_STATE_SUFFIX bit for bit so this reader only
# ever finds the state its OWN installation's pretool wrote. See
# dashclaw_pretool.py for the full rationale (2026-07-27 incident).
_INSTANCE_STATE_SUFFIX = hashlib.sha256((BASE_URL + "|" + AGENT_ID).encode("utf-8")).hexdigest()[:12]
# Set DASHCLAW_HOOK_DEBUG=1 in .env to capture PostToolUse invocation breadcrumbs
# in <tempdir>/dashclaw_hook_errors.log. Useful for diagnosing why PostToolUse
# isn't firing or is exiting early (missing tool_use_id, missing action_id, etc.)
# — the miss rate for PostToolUse has historically been ~96% in the wild and the
# root cause is opaque without this.
DEBUG = (os.environ.get("DASHCLAW_HOOK_DEBUG") or "").strip() in ("1", "true", "yes")

MAX_SUMMARY = 500

# Containment Verdicts (Task 10): cap on the staged-diff text bytes uploaded
# per contained mutation, env-overridable. Default keeps a single artifact
# well under the /api/artifacts 2MB request-body cap even for a large diff.
_DEFAULT_CONTAINMENT_DIFF_CAP_BYTES = 1_500_000


def _containment_diff_cap_bytes():
    raw = os.environ.get("DASHCLAW_CONTAINMENT_DIFF_CAP_BYTES")
    try:
        return max(1, int(raw)) if raw else _DEFAULT_CONTAINMENT_DIFF_CAP_BYTES
    except (TypeError, ValueError):
        return _DEFAULT_CONTAINMENT_DIFF_CAP_BYTES


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
    `running` and pollute Approvals as a zombie. A final failure is
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


def _post_artifact(body):
    """POST /api/artifacts. Fail-silent like every posttool path: logs and
    returns on any failure, never raises. Returns True only when the POST
    landed with a 2xx response -- False on any HTTP error (409/413/etc.) or
    network failure. Callers that gate a "captured" outcome on the artifact
    actually existing (final fix-wave IMPORTANT 1, 2026-07-27) must check
    this return value instead of assuming the fail-silent logging means the
    post succeeded."""
    url = BASE_URL + "/api/artifacts"
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
        request_with_retry(req, timeout=3)
        return True
    except urllib.error.HTTPError as e:
        _log_always("artifact_post_failed", "HTTP " + str(e.code))
        return False
    except Exception as e:
        _log_always("artifact_post_failed", type(e).__name__ + ": " + str(e))
        return False


# ---------------------------------------------------------------------------
# Containment Verdicts (Task 10): staged-diff artifact + ref/status flip.
#
# When PreToolUse (Task 9) redirected a mutation into a per-session
# containment worktree, its state file carries a non-None containment_ref.
# Here we compute the worktree's staged diff, upload it as a `patch` artifact
# for operator review, and flip the action to awaiting_promotion with its ref
# stamped. containment_ref can ONLY be persisted together with
# containment_status='awaiting_promotion' -- the server's PATCH handler
# (app/api/actions/[actionId]/route.ts) only reads body.containment_ref
# inside the containment_status branch, and setContainmentAwaiting always
# sets both columns in the same UPDATE. The Stop hook's awaiting-promotion
# sweep (dashclaw_stop.py) repeats this PATCH as an idempotent backstop in
# case this call never lands. Fail-silent throughout: git and HTTP failures
# never raise past this function.
# ---------------------------------------------------------------------------

_GIT_SUBPROCESS_KWARGS = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


def _run_git(args, cwd, timeout=15):
    """Run `git <args>` in cwd. Returns a CompletedProcess, or None on any
    failure (missing git, spawn error, timeout) -- never raises."""
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


def _git_add_and_commit(worktree, action_id):
    """Stage everything in the worktree and commit it under a dedicated
    dashclaw-containment identity, so a contained mutation actually lands on
    the containment branch's history and `git merge --no-ff <ref>` at
    promotion time has something to merge (F1: the 2026-07-27 e2e proof found
    zero commits on the containment branch -- a brand-new file was staged
    into the worktree but never committed, so the "governed merge" was a
    silent no-op that printed "Already up to date." and left `notes.md` out
    of the main tree). `--no-verify` keeps the user's own pre-commit hooks
    from blocking or mutating a contained commit; the `-c` identity flags
    make the commit succeed even when the repo has no configured git user;
    `-c commit.gpgsign=false` keeps a machine with `commit.gpgsign=true` set
    globally from silently blocking on a missing/locked GPG key here (a
    contained promotion commit is machine-internal bookkeeping, not something
    that needs -- or should require -- the operator's signing key).

    Returns True on success, INCLUDING the idempotent "nothing to commit"
    case (a rerun after an earlier commit this session already captured
    everything -- not a failure). Returns False only when `git add` or `git
    commit` itself failed to run (git unreachable, bad worktree path,
    timeout, or a real commit error) -- callers must treat that the same as
    a diff-compute failure and skip the artifact + status flip."""
    add_proc = _run_git(["add", "-A"], cwd=worktree)
    if not add_proc or add_proc.returncode != 0:
        return False
    commit_proc = _run_git(
        [
            "-c", "user.name=dashclaw-containment",
            "-c", "user.email=containment@dashclaw.local",
            "-c", "commit.gpgsign=false",
            "commit", "--no-verify", "-m", "contained: " + action_id,
        ],
        cwd=worktree,
    )
    if not commit_proc:
        return False
    if commit_proc.returncode == 0:
        return True
    combined = (commit_proc.stdout + commit_proc.stderr).decode("utf-8", "replace").lower()
    # "nothing to commit, working tree clean" is the idempotent common case
    # (e.g. the Stop hook's awaiting-promotion sweep re-runs this after
    # PostToolUse already committed + flipped it), not a failure.
    return "nothing to commit" in combined


def _git_diff_payload(worktree, cap_bytes, base_sha=None):
    """Return (diff_text, truncated, stat_text, untracked_paths) for the
    worktree's changes, or None if the `git diff` itself failed (missing
    git, bad worktree path, non-zero exit, timeout).

    When base_sha is given (F1 -- the worktree's HEAD at containment
    creation time), the diff spans `base_sha..HEAD`: cumulative across every
    commit this session's contained mutations produced, and correct for a
    brand-new file (a plain `git diff HEAD` never shows an untracked file's
    body). Falls back to `git diff HEAD` when base_sha is missing (older
    containment session state written before F1) -- callers should note the
    fallback in the artifact content, since after this function's caller
    commits everything first, a plain `git diff HEAD` will typically be
    empty.

    None is distinct from a legitimately empty diff: a zero-length diff after
    a successful `git diff` (returncode 0) is a valid outcome and returns
    normally with diff_text=""; only a failed subprocess call returns None.
    Callers must not conflate the two -- treating a git failure as an empty
    diff would let an operator promote a change that was never actually
    captured for review."""
    diff_range = [base_sha, "HEAD"] if base_sha else ["HEAD"]
    diff_proc = _run_git(["diff"] + diff_range, cwd=worktree)
    if not diff_proc or diff_proc.returncode != 0:
        return None
    diff_bytes = diff_proc.stdout
    truncated = len(diff_bytes) > cap_bytes
    if truncated:
        diff_bytes = diff_bytes[:cap_bytes]
    diff_text = diff_bytes.decode("utf-8", "replace")

    stat_proc = _run_git(["diff"] + diff_range + ["--stat"], cwd=worktree)
    stat_text = stat_proc.stdout.decode("utf-8", "replace") if (stat_proc and stat_proc.returncode == 0) else ""

    status_proc = _run_git(["status", "--porcelain"], cwd=worktree)
    untracked = []
    if status_proc and status_proc.returncode == 0:
        for line in status_proc.stdout.decode("utf-8", "replace").splitlines():
            if line.startswith("?? "):
                untracked.append(line[3:])

    return diff_text, truncated, stat_text, untracked


# SECURITY (2026-07-27 pre-ship sweep, MEDIUM): the contained diff/stat is
# uploaded to the server as a `patch` artifact for HUMAN review -- unlike the
# act payload, this text was never gated by the guard's own redaction and
# could contain whatever secret-shaped string the agent's mutation touched
# (an API key committed to a file, an env var echoed into a diff hunk).
# Mirrors dashclaw_pretool.py's _ACT_SCRUB_PATTERNS/_ACT_SCRUB_KV bit for bit
# (duplicated, not imported -- same parity convention as the SDKs' scrub_act;
# pretool.py is a sibling hook script, not a shared package). Scrubbing only
# the UPLOADED copy is correct and sufficient: the merge itself (`git merge
# --no-ff <containment_ref>`) replays the local worktree's real commits, so
# redacting this artifact never changes what actually lands in the repo --
# it only protects what a human reviewer sees rendered on /approvals.
_ACT_SCRUB_PATTERNS = [
    (re.compile(r"oc_live_[A-Za-z0-9_-]+"), "[REDACTED]"),
    (re.compile(r"sk-[A-Za-z0-9_-]{10,}"), "[REDACTED]"),
    (re.compile(r"ghp_[A-Za-z0-9]{20,}"), "[REDACTED]"),
    (re.compile(r"Bearer\s+[A-Za-z0-9._-]+", re.IGNORECASE), "Bearer [REDACTED]"),
]
_ACT_SCRUB_KV = re.compile(r"(password|token|secret)\s*=\s*[^\s&\"']+", re.IGNORECASE)


def _scrub_act_text(text):
    """Mask secret-looking substrings before the text leaves the machine."""
    if not text:
        return text
    for pattern, replacement in _ACT_SCRUB_PATTERNS:
        text = pattern.sub(replacement, text)
    return _ACT_SCRUB_KV.sub(lambda m: m.group(1) + "=[REDACTED]", text)


def _maybe_post_containment_diff(action_id, ref, worktree, base_sha=None):
    """Commit the worktree's contained mutation onto the containment branch
    (F1), then upload the resulting diff as a `patch` artifact and flip the
    action to awaiting_promotion with its ref stamped. No-op when ref/
    worktree are missing (a containment failure path already recorded None
    for both).

    Sequencing matters: `git add -A` + commit MUST run before the diff is
    computed -- a brand-new untracked file (the common case: Write creating a
    file that doesn't exist yet) never gets a real diff hunk otherwise, and
    the containment branch never accumulates any history for `git merge
    --no-ff <ref>` to actually merge (2026-07-27 e2e proof: "Already up to
    date." -- a silent merge no-op with the change never landing).

    A commit failure (as opposed to "nothing to commit", the idempotent
    common case) is treated the same as a diff-compute failure: skip BOTH the
    artifact upload and the status flip so an operator can never promote a
    change that was never actually captured. The action stays 'contained';
    the change stays reviewable later via `dashclaw contained diff` (CLI)
    once a retry succeeds. Fail-silent end to end.

    Returns True only when the commit landed AND the diff artifact was
    posted -- i.e. capture fully succeeded. Final fix-wave IMPORTANT 3
    (2026-07-27): the caller uses this to gate _append_contained_turn_action,
    which feeds the Stop hook's awaiting-promotion sweep. Previously that
    sweep ran unconditionally and could flip a capture-failed action to
    awaiting_promotion anyway -- reintroducing exactly the class the F1 fix
    above closed (a promotable card on /approvals with no diff artifact
    behind it, so Promote is a silent no-op merge). A failed capture must
    leave the action 'contained' with NO backstop path to awaiting_promotion
    until a retry actually captures something."""
    if not ref or not worktree:
        return False
    try:
        if not _git_add_and_commit(worktree, action_id):
            _log_always(
                "containment_commit_failed",
                "git add/commit failed in " + worktree + " for " + action_id
                + " — leaving contained for stop-hook retry",
            )
            return False
        cap = _containment_diff_cap_bytes()
        payload = _git_diff_payload(worktree, cap, base_sha)
        if payload is None:
            _log_always(
                "containment_diff_failed",
                "containment diff computation failed for " + action_id
                + " — leaving contained for stop-hook retry",
            )
            return False
        diff_text, truncated, stat_text, untracked = payload
        content_json = {
            "diff": _scrub_act_text(diff_text),
            "stat": _scrub_act_text(stat_text),
            "ref": ref,
            "truncated": truncated,
        }
        if untracked:
            content_json["untracked"] = untracked
        if not base_sha:
            content_json["note"] = (
                "base_sha unavailable (older containment session state) — diff "
                "computed as `git diff HEAD` instead of the cumulative base..HEAD "
                "range and may be empty once the mutation is committed."
            )
        posted = _post_artifact({
            "artifact_type": "patch",
            "name": "containment-diff-" + action_id,
            "source_action_id": action_id,
            "content_json": content_json,
        })
        if not posted:
            _log_always(
                "containment_artifact_post_failed",
                "artifact POST failed for " + action_id
                + " — leaving contained for stop-hook retry",
            )
            return False
        # IMPORTANT 5 (final fix wave, 2026-07-27): the server now binds this
        # transition to the caller's own agent_id (WHERE-gated in
        # setContainmentAwaiting) — without it in the body, an org-key-only
        # caller has no attributable identity and the PATCH 403s.
        _patch_action(action_id, {
            "containment_status": "awaiting_promotion",
            "containment_ref": ref,
            "agent_id": AGENT_ID,
        })
        return True
    except Exception as e:
        _log_always("containment_diff_failed", "action_id=" + action_id + " " + type(e).__name__ + ": " + str(e))
        return False


def _append_contained_turn_action(session_id, action_id, ref):
    """Append "<action_id>\\t<ref>" to the per-session contained-turn log so
    the Stop hook's awaiting-promotion sweep can flip this action even if the
    containment_status PATCH above failed or never landed. Cleared by the
    Stop hook at end of turn (dashclaw_agent_intel.stop_state). Best-effort;
    never raises.

    CALLER CONTRACT (final fix-wave IMPORTANT 3, 2026-07-27): only call this
    when _maybe_post_containment_diff returned True (commit landed + diff
    artifact posted). This log is a backstop for a failed PATCH, not a
    backstop for a failed CAPTURE -- appending unconditionally would let the
    Stop hook flip a capture-failed action to awaiting_promotion with no
    diff artifact behind it (a promotable card that merges nothing).

    Uses the shared stop_state.contained_turn_path (not a local path build) so
    this WRITER and dashclaw_stop.py's READER always agree on the
    instance-namespaced path (F2 follow-up, 2026-07-27 incident) -- both
    derive the identical suffix from their own resolved BASE_URL + AGENT_ID."""
    if not session_id or not action_id or not ref:
        return
    path = _contained_turn_path(session_id, _INSTANCE_STATE_SUFFIX)
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(action_id + "\t" + ref + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Temp file helpers
# ---------------------------------------------------------------------------

def _action_state_path(tool_use_id):
    # Instance-suffixed (F2, 2026-07-27 e2e proof): must match
    # dashclaw_pretool.py's _action_state_path bit for bit so this reader only
    # ever opens the file its own installation's PreToolUse wrote, even when
    # another co-installed hook instance fired for the same tool_use_id.
    return os.path.join(
        tempfile.gettempdir(), "dashclaw_last_action_" + _INSTANCE_STATE_SUFFIX + "_" + tool_use_id
    )


def _read_action_state(tool_use_id):
    """Read the PreToolUse temp-file payload for this tool_use_id.

    Ordinary (non-contained) decisions write a bare action_id string
    (write_action_id in dashclaw_pretool.py). Contained decisions
    (_write_containment_action_state, Task 9) write a JSON object instead:
    {"action_id": ..., "containment_ref": ..., "containment_worktree": ...,
    "containment_base_sha": ...} (ref/worktree/base_sha are None on a
    containment failure path; base_sha is also None for state written by an
    older hook version that predates F1). Returns {"action_id": str|None,
    "containment_ref": str|None, "containment_worktree": str|None,
    "containment_base_sha": str|None} -- never raises.
    """
    empty = {
        "action_id": None,
        "containment_ref": None,
        "containment_worktree": None,
        "containment_base_sha": None,
    }
    path = _action_state_path(tool_use_id)
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
    except Exception:
        return empty
    if not raw:
        return empty
    if raw.startswith("{"):
        try:
            parsed = json.loads(raw)
        except Exception:
            return empty
        return {
            "action_id": parsed.get("action_id") or None,
            "containment_ref": parsed.get("containment_ref"),
            "containment_worktree": parsed.get("containment_worktree"),
            "containment_base_sha": parsed.get("containment_base_sha"),
        }
    return {
        "action_id": raw,
        "containment_ref": None,
        "containment_worktree": None,
        "containment_base_sha": None,
    }


def _read_action_id(tool_use_id):
    """Read action_id from the temp file written by PreToolUse.

    Returns action_id string or None if not found.
    """
    return _read_action_state(tool_use_id)["action_id"]


def _cleanup_temp(tool_use_id):
    """Remove the temp file for this tool_use_id."""
    path = _action_state_path(tool_use_id)
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


def _require_action_id(state, tool_use_id, tool_name):
    """Return the PreToolUse action id from an already-read state dict, or
    exit when this tool was not recorded."""
    action_id = state.get("action_id")
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

    # Find the action ID (and any containment fields) from the temp file
    # written by PreToolUse.
    state = _read_action_state(tool_use_id)
    action_id = _require_action_id(state, tool_use_id, tool_name)

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

    # Containment Verdicts (Task 10): a contained mutation's staged diff is
    # uploaded as an artifact and the action flipped to awaiting_promotion.
    # No-op for ordinary (non-contained) actions.
    containment_ref = state.get("containment_ref")
    if containment_ref:
        captured = _maybe_post_containment_diff(
            action_id, containment_ref, state.get("containment_worktree"), state.get("containment_base_sha")
        )
        # IMPORTANT 3 (final fix wave, 2026-07-27): only feed the Stop hook's
        # awaiting-promotion backstop sweep when capture actually succeeded —
        # see _append_contained_turn_action's caller contract above. A failed
        # commit/diff must leave the action 'contained' with no path to
        # awaiting_promotion until a retry actually captures something.
        if captured:
            _append_contained_turn_action(data.get("session_id") or "", action_id, containment_ref)

    # Clean up temp file
    _cleanup_temp(tool_use_id)

    sys.exit(0)


if __name__ == "__main__":
    main()
