#!/usr/bin/env python3
"""
DashClaw enforcement-liveness probe (roadmap v8.2).

Proves the enforcement seam holds END TO END on a live install: drives a
synthetic action that policy must hold (block or approval-wait) through the
SAME PreToolUse hook seam real actions use, and verdicts by observing whether
the action executed — never by reading the decision ledger, because the ledger
is exactly what kept lying in v4.72.1 (a hook timeout misconfig cancelled the
pretool hook; guard rows kept flowing while every block failed open).

Harness emulation contract (each clause verified against the real Claude Code
harness during the v4.72.1 incident, 2026-07-06):
  1. The hook `timeout` field in settings.json is SECONDS (default 600).
  2. The harness arms a timer of timeout*1000 ms; a value whose ms product
     exceeds 2^31-1 overflows the timer, which fires immediately and cancels
     the hook (73/73 cancellations observed).
  3. Exit code 2 blocks the tool; any other outcome — exit 0, other codes,
     cancellation — lets the tool PROCEED (fail-open).
The probe reproduces exactly that contract around the real, unmodified hook:
exit 2 => the synthetic action is not executed; anything else => the probe
executes it (a Write of a marker file) and the file's existence is the witness.

Verdicts:
  held       — the seam blocked the probe action (exit 2), witness absent.
  executed   — the harness contract would have let the action through and the
               witness file exists (v4.72.1 class: overflowed timeout, hook
               crash, fail-open path).
  unprovable — the seam ran but enforcement cannot be proven: no hook entry
               installed, observe mode, no policy holds the probe action, or
               the hook hung past the probe's wait budget. Rendered broken on
               the surfaces — you cannot claim enforcement you cannot prove.

Synthetic hygiene: the probe runs the hook as agent `smoke-liveness-probe`
(the `smoke-` prefix is the established synthetic marker), so its guard rows
are excluded from every aggregate, and any pending approval it creates is
cancelled in teardown. Its verdict is filed to POST /api/enforcement-liveness
— its own table, never the action/guard ledgers (live-canary precedent).

SessionStart entry point: wired directly as the SessionStart hook (it replaced
the retired session-digest hook that used to spawn it). Invoked as
`--source session-start`, the probe throttles itself to at most once per 12h
(marker file) and runs the actual probe in a DETACHED child, so session start
is never delayed or broken — the same contract the digest provided. Every
other `--source` (manual, ci, session-start's own detached child) runs the
probe inline.

Usage:
  python hooks/enforcement_liveness_probe.py [--settings PATH] [--source S]
      [--witness-dir DIR] [--max-wait SECONDS] [--json]

Env: DASHCLAW_BASE_URL + DASHCLAW_API_KEY enable reporting (loaded from .env
like the hooks). DASHCLAW_LIVENESS_PROBE_DISABLED=1 exits 0 immediately.
Exit code: 0 when the verdict is `held` (and the report, if configured,
filed); 1 otherwise.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

# Same .env loading contract as the hooks (values already in the environment
# win; DASHCLAW_DISABLE_DOTENV skips the walk for test isolation).


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


def _load_dotenv():
    if os.environ.get("DASHCLAW_DISABLE_DOTENV"):
        return
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
                        _apply_env_line(line)
            except FileNotFoundError:
                pass
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent


_load_dotenv()

INT32_MAX_MS = 2**31 - 1
DEFAULT_HOOK_TIMEOUT_SECONDS = 600  # harness default when the field is absent
PROBE_AGENT_ID = "smoke-liveness-probe"  # `smoke-` = synthetic, excluded everywhere
APPROVAL_WAIT_SECONDS = "8"  # bounds the hook's approval poll for the probe run


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def effective_hook_timer(timeout_value):
    """Reproduce the harness's timer arithmetic for a settings.json `timeout`.

    Returns (timeout_seconds, effective_timer_ms, overflowed). `timeout` is
    read as SECONDS; non-numeric/absent values fall back to the harness
    default. A ms product past INT32_MAX overflows the harness timer, which
    fires immediately and cancels the hook — the v4.72.1 hole.
    """
    try:
        seconds = float(timeout_value)
        if seconds != seconds or seconds <= 0:  # NaN or nonsensical
            seconds = DEFAULT_HOOK_TIMEOUT_SECONDS
    except (TypeError, ValueError):
        seconds = DEFAULT_HOOK_TIMEOUT_SECONDS
    ms = seconds * 1000
    overflowed = ms > INT32_MAX_MS
    return seconds, ms, overflowed


def find_pretool_entries(settings_paths):
    """Collect every DashClaw PreToolUse hook entry from the given settings
    files. Returns a list of {settings_path, command, timeout_seconds,
    effective_timer_ms, overflowed}."""
    entries = []
    for path in settings_paths:
        try:
            with open(path, encoding="utf-8") as f:
                settings = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            continue
        for matcher_group in (settings.get("hooks") or {}).get("PreToolUse", []) or []:
            for hook in matcher_group.get("hooks", []) or []:
                command = hook.get("command") or ""
                if "dashclaw_pretool" not in command:
                    continue
                seconds, ms, overflowed = effective_hook_timer(hook.get("timeout"))
                entries.append({
                    "settings_path": path,
                    "command": command,
                    "timeout_seconds": seconds,
                    "effective_timer_ms": ms,
                    "overflowed": overflowed,
                })
    return entries


def default_settings_paths(project_root):
    home = os.path.expanduser("~")
    return [
        os.path.join(project_root, ".claude", "settings.json"),
        os.path.join(home, ".claude", "settings.json"),
    ]


def command_with_probe_identity(command):
    """Force the synthetic probe identity onto the installed hook command.

    Installed commands carry `--agent-id <harness-id>`, and argv beats the
    DASHCLAW_AGENT_ID env var by design in the hook — without this rewrite the
    probe's guard rows would be recorded under the REAL harness agent and leak
    into every aggregate. Identity is orthogonal to the enforcement mechanics
    being probed, so the rewrite does not reduce seam fidelity."""
    import re
    if re.search(r"--agent-id(=|\s+)\S+", command):
        return re.sub(r"--agent-id(=|\s+)\S+", "--agent-id %s" % PROBE_AGENT_ID, command)
    return "%s --agent-id %s" % (command, PROBE_AGENT_ID)


def build_payload(witness_path, run_id):
    """The synthetic held action: a Write to a probe-owned `.env` path outside
    the declared workspace. The path shape trips the hook's sensitive-path and
    outside-workspace risk boosts and matches protected-path/.env policy rules
    — while remaining a file the probe owns and may safely create when the
    seam fails open (broken enforcement is exactly when it WILL be written)."""
    return json.dumps({
        "tool_name": "Write",
        "tool_input": {
            "file_path": witness_path,
            "content": "DashClaw enforcement-liveness probe witness %s — if this file exists, an action the policy should have held EXECUTED." % run_id,
        },
        "tool_use_id": "elp-%s" % run_id,
        "session_id": "liveness-probe-%s" % run_id,
    })


def run_seam(entry, payload, project_root, max_wait_seconds):
    """Run one installed hook entry under the emulated harness contract.

    Returns {outcome: 'held'|'proceed'|'hung', exit_code, cancelled, stderr}.
    """
    if entry["overflowed"]:
        # Harness timer fires immediately: the hook is cancelled before its
        # exit code can matter, and the tool proceeds. Not spawned at all —
        # a real cancellation kills the process mid-flight; the effect on the
        # tool call is identical.
        return {"outcome": "proceed", "exit_code": None, "cancelled": True, "stderr": ""}

    env = {
        **os.environ,
        "CLAUDE_PROJECT_DIR": project_root,
        "DASHCLAW_AGENT_ID": PROBE_AGENT_ID,
        "DASHCLAW_APPROVAL_TIMEOUT": APPROVAL_WAIT_SECONDS,
        "DASHCLAW_WORKSPACE": project_root,
    }
    harness_timer_seconds = entry["effective_timer_ms"] / 1000.0
    wait = min(harness_timer_seconds, max_wait_seconds)
    try:
        proc = subprocess.run(
            command_with_probe_identity(entry["command"]),
            shell=True,
            input=payload.encode("utf-8"),
            capture_output=True,
            env=env,
            cwd=project_root,
            timeout=wait,
        )
    except subprocess.TimeoutExpired as exc:
        if wait >= harness_timer_seconds:
            # The harness timer itself would have fired: cancelled, proceed.
            return {"outcome": "proceed", "exit_code": None, "cancelled": True,
                    "stderr": (exc.stderr or b"").decode("utf-8", "replace")}
        # The hook outlived the probe's wait budget but not the harness timer:
        # a real session would still be waiting. Enforcement state unknown.
        return {"outcome": "hung", "exit_code": None, "cancelled": False,
                "stderr": (exc.stderr or b"").decode("utf-8", "replace")}
    except OSError as exc:
        # Command failed to spawn (missing node/python/hook file). The harness
        # treats a hook that cannot run as a no-op: the tool proceeds.
        return {"outcome": "proceed", "exit_code": None, "cancelled": False,
                "stderr": "spawn failed: %s" % exc}

    stderr = proc.stderr.decode("utf-8", "replace")
    if proc.returncode == 2:
        return {"outcome": "held", "exit_code": 2, "cancelled": False, "stderr": stderr}
    return {"outcome": "proceed", "exit_code": proc.returncode, "cancelled": False, "stderr": stderr}


def api_request(method, path, body=None, timeout=10):
    base = (os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL") or "").rstrip("/")
    key = os.environ.get("DASHCLAW_API_KEY") or ""
    if not base or not key:
        return None
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={"content-type": "application/json", "x-api-key": key},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def diagnose_decision():
    """Best-effort, DIAGNOSIS-ONLY read of what the guard decided for the
    probe agent's latest action. Never used to declare `held` — only to make
    a non-held verdict actionable. Returns (status, action_id) or (None, None)."""
    resp = api_request("GET", "/api/actions?agent_id=%s&limit=1" % PROBE_AGENT_ID)
    actions = (resp or {}).get("actions") or []
    if not actions:
        return None, None
    return actions[0].get("status"), actions[0].get("id")


def teardown(action_id, witness_dir, checks):
    """Cancel any pending approval the probe created and remove the witness
    directory. Best-effort: failures are recorded, never fatal."""
    if action_id:
        resp = api_request("PATCH", "/api/actions/%s" % action_id, {"status": "cancelled"})
        checks.append({
            "id": "teardown-approval",
            "title": "Cancel the probe's pending approval",
            "status": "pass" if resp is not None else "fail",
            "detail": "cancelled %s" % action_id if resp is not None else "PATCH failed — cancel it from /approvals (agent smoke-liveness-probe)",
        })
    try:
        shutil.rmtree(witness_dir, ignore_errors=True)
    except OSError:
        pass


def _throttle_and_detach_session_start():
    """SessionStart entry point: run the probe at most once per 12h (marker
    file), in a DETACHED child, so session start is never delayed. Ported from
    the retired session-digest hook, which owned this spawn before it was
    culled. The child re-invokes this script with DASHCLAW_LIVENESS_PROBE_SPAWNED
    so it runs the probe body inline (see main). Fail-silent — a throttle miss
    or spawn failure never breaks session start."""
    root = os.path.join(os.path.expanduser("~"), ".dashclaw", "liveness-probe")
    marker = os.path.join(root, ".last-spawn")
    try:
        if time.time() - os.path.getmtime(marker) < 12 * 3600:
            return  # within the throttle window: nothing to do this session
    except OSError:
        pass  # no marker yet: first run
    try:
        os.makedirs(root, exist_ok=True)
        with open(marker, "w", encoding="utf-8") as f:
            f.write(str(time.time()))
        env = {**os.environ, "DASHCLAW_LIVENESS_PROBE_SPAWNED": "1"}
        kwargs = {"env": env}
        if os.name == "nt":
            kwargs["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        with open(os.path.join(root, "last-run.log"), "w", encoding="utf-8") as log:
            subprocess.Popen(
                [sys.executable, os.path.abspath(__file__), "--source", "session-start"],
                stdin=subprocess.DEVNULL, stdout=log, stderr=log, **kwargs,
            )
    except Exception:
        pass  # never let the probe break session start


def main():
    parser = argparse.ArgumentParser(description="DashClaw enforcement-liveness probe")
    parser.add_argument("--settings", action="append", default=None,
                        help="settings.json path(s) to inspect (default: project + global .claude/settings.json)")
    parser.add_argument("--source", default="manual", help="run source label (manual|session-start|ci)")
    # WHICH SEAM this probe drove, as distinct from --source (WHY it ran).
    # Claude Code and Codex both wire the probe with --source session-start, so
    # before this flag the two seams were indistinguishable server-side and the
    # newest run spoke for the whole fleet — a dead Codex seam rendered green
    # behind a healthy Claude Code run. See drizzle/0072.
    parser.add_argument("--runtime", default="unknown",
                        help="which seam this probe drove (claude-code|codex|...)")
    parser.add_argument("--witness-dir", default=None, help="probe-owned directory for the witness file")
    parser.add_argument("--max-wait", type=float, default=90.0,
                        help="probe wait budget for the hook process, seconds")
    parser.add_argument("--json", action="store_true", help="print the full run payload as JSON")
    # parse_known_args so the probe tolerates being wired next to the other
    # hooks (harness installers append flags like `--agent-id`); identity is
    # forced to PROBE_AGENT_ID internally, so any such flag is a harmless no-op.
    args, _unknown = parser.parse_known_args()

    if os.environ.get("DASHCLAW_LIVENESS_PROBE_DISABLED"):
        print("[liveness-probe] disabled via DASHCLAW_LIVENESS_PROBE_DISABLED")
        sys.exit(0)

    # SessionStart entry point: throttle to once/12h and run detached so the
    # session start that fired this hook is never delayed. The detached child
    # carries DASHCLAW_LIVENESS_PROBE_SPAWNED and falls through to run inline.
    if args.source == "session-start" and not os.environ.get("DASHCLAW_LIVENESS_PROBE_SPAWNED"):
        _throttle_and_detach_session_start()
        sys.exit(0)

    started_at = utc_now()
    t0 = time.time()
    run_id = uuid.uuid4().hex[:12]
    project_root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    witness_root = args.witness_dir or os.path.join(os.path.expanduser("~"), ".dashclaw", "liveness-probe")
    witness_dir = os.path.join(witness_root, run_id)
    witness_path = os.path.join(witness_dir, ".env")

    checks = []
    settings_paths = args.settings or default_settings_paths(project_root)
    entries = find_pretool_entries(settings_paths)

    checks.append({
        "id": "config-discovery",
        "title": "DashClaw PreToolUse hook installed",
        "status": "pass" if entries else "fail",
        "detail": ("%d entr%s in %s" % (len(entries), "y" if len(entries) == 1 else "ies",
                   ", ".join(sorted({e["settings_path"] for e in entries}))))
                  if entries else "no dashclaw_pretool entry in: %s" % ", ".join(settings_paths),
    })
    for entry in entries:
        checks.append({
            "id": "timeout-sanity",
            "title": "Hook timeout arms a real harness timer (%s)" % entry["settings_path"],
            "status": "fail" if entry["overflowed"] else "pass",
            "detail": ("timeout %s is read as SECONDS; x1000 overflows the harness timer -> hook cancelled instantly, enforcement fail-open (v4.72.1)"
                       % int(entry["timeout_seconds"])) if entry["overflowed"]
                      else "timeout %ss -> %sms timer" % (int(entry["timeout_seconds"]), int(entry["effective_timer_ms"])),
        })

    hook_report = {
        "installed": bool(entries),
        "settings_path": entries[0]["settings_path"] if entries else None,
        "timeout_seconds": entries[0]["timeout_seconds"] if entries else None,
        "effective_timer_ms": entries[0]["effective_timer_ms"] if entries else None,
        "overflowed": any(e["overflowed"] for e in entries) if entries else None,
        "mode": os.environ.get("DASHCLAW_HOOK_MODE") or "enforce",
        "exit_code": None,
        "cancelled": False,
    }

    verdict = None
    detail = ""
    decision = None
    witness_executed = False

    if not entries:
        verdict = "unprovable"
        detail = "No DashClaw PreToolUse hook found — real tool calls in this project run ungoverned. Install: dashclaw install claude."
    else:
        payload = build_payload(witness_path, run_id)
        results = []
        seam_t0 = time.time()
        for entry in entries:
            result = run_seam(entry, payload, project_root, args.max_wait)
            results.append((entry, result))
            if result["outcome"] == "held":
                break
        seam_ms = round((time.time() - seam_t0) * 1000)

        held = next(((e, r) for e, r in results if r["outcome"] == "held"), None)
        hung = next(((e, r) for e, r in results if r["outcome"] == "hung"), None)
        last_entry, last_result = results[-1]
        hook_report["exit_code"] = last_result["exit_code"]
        hook_report["cancelled"] = any(r["cancelled"] for _, r in results)

        if held:
            verdict = "held"
            unavailable = "unreachable" in held[1]["stderr"] or "unavailable" in held[1]["stderr"].lower()
            detail = ("Probe action blocked at the seam (exit 2) — guard unreachable, fail-closed held."
                      if unavailable else "Probe action blocked at the seam (exit 2); the witness was never executed.")
            checks.append({"id": "seam", "title": "Hook held the synthetic action",
                           "status": "pass", "detail": detail, "durationMs": seam_ms})
        elif hung:
            verdict = "unprovable"
            detail = ("Hook outlived the probe's %ds wait budget (harness timer %ds) — enforcement state unknown this run."
                      % (int(args.max_wait), int(hung[0]["effective_timer_ms"] / 1000)))
            checks.append({"id": "seam", "title": "Hook hung past the probe wait budget",
                           "status": "fail", "detail": detail, "durationMs": seam_ms})
        else:
            # Every armed entry let the action through: execute the witness,
            # exactly as the harness would have.
            os.makedirs(witness_dir, exist_ok=True)
            with open(witness_path, "w", encoding="utf-8") as f:
                f.write("executed by enforcement-liveness probe %s at %s\n" % (run_id, utc_now()))
            witness_executed = os.path.exists(witness_path)

            observe = any("[observe]" in r["stderr"] for _, r in results)
            if any(r["exit_code"] is not None for _, r in results):
                time.sleep(1.5)  # let the hook's async record land before diagnosis
                status, action_id = diagnose_decision()
            else:
                # No hook process ran to completion (overflow/cancelled path):
                # the guard was never consulted this run, so there is nothing
                # to diagnose — a query would only surface a PREVIOUS run's row.
                status, action_id = None, None
            decision = status
            if hook_report["cancelled"]:
                verdict = "executed"
                detail = ("Hook cancelled by the harness timer (overflowed timeout — v4.72.1 class); the held action EXECUTED. "
                          "Fix the hook timeout in settings.json (seconds, e.g. 3660) and restart the session.")
            elif observe:
                verdict = "unprovable"
                detail = "Hook is in observe mode (DASHCLAW_HOOK_MODE=observe) — enforcement is disabled by config, so holding cannot be proven."
            elif status in ("blocked", "pending_approval"):
                verdict = "executed"
                detail = ("Guard decided %s but the seam let the action through (exit %s) — enforcement is broken above the guard."
                          % (status, last_result["exit_code"]))
            else:
                verdict = "unprovable"
                detail = ("No policy held the probe action (hook exit %s%s) — add or scope a policy that blocks writes to *.env "
                          "(protected paths or risk_threshold) so enforcement is provable."
                          % (last_result["exit_code"],
                             ", recorded decision: %s" % status if status else ""))
            checks.append({"id": "seam", "title": "Hook let the synthetic action proceed",
                           "status": "fail", "detail": detail, "durationMs": seam_ms})
            teardown(action_id if status == "pending_approval" else None, witness_dir, checks)

        checks.append({
            "id": "witness",
            "title": "Witness: did the held action execute?",
            "status": "pass" if not witness_executed else "fail",
            "detail": "%s %s" % (witness_path, "EXISTS — the action executed" if witness_executed else "absent"),
        })

    shutil.rmtree(witness_dir, ignore_errors=True)

    run = {
        "source": args.source,
        "runtime": args.runtime,
        "verdict": verdict,
        "detail": detail,
        "hook": {k: v for k, v in hook_report.items() if v is not None},
        "witness": {"path": witness_path, "executed": witness_executed},
        **({"decision": decision} if decision else {}),
        "checks": checks,
        "startedAt": started_at,
        "finishedAt": utc_now(),
    }

    for c in checks:
        print("  %s  %s%s" % ("PASS" if c["status"] == "pass" else c["status"].upper(),
                              c["title"], " — " + c["detail"] if c.get("detail") else ""))
    print("[liveness-probe] verdict: %s — %s (%.1fs)" % (verdict.upper(), detail, time.time() - t0))
    if args.json:
        print(json.dumps(run, indent=2))

    reported = api_request("POST", "/api/enforcement-liveness", run)
    if reported is None:
        base = os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL") or ""
        print("[liveness-probe] verdict NOT reported%s" % (
            " (DASHCLAW_BASE_URL / DASHCLAW_API_KEY not set)" if not base else " — POST /api/enforcement-liveness failed"))
    else:
        print("[liveness-probe] verdict reported: %s" % reported.get("id"))

    sys.exit(0 if verdict == "held" and (reported is not None or not (os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL"))) else 1)


if __name__ == "__main__":
    main()
