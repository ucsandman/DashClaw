"""
DashClaw Hermes Agent plugin entry point.

Registers the two DashClaw skills, four slash commands, and the
`hermes dashclaw` CLI subcommand group. Lifecycle hooks are NOT
registered here — they ship as shell hooks (see hermes_config_snippet.yaml)
so they can be reused verbatim across Claude Code, Codex, and Hermes.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent
SKILLS_ROOT = PLUGIN_ROOT.parent / "skills"
REPO_ROOT = PLUGIN_ROOT.parent.parent.parent  # plugins/dashclaw/.hermes-plugin -> repo root
HOOKS_ROOT = REPO_ROOT / ".hermes" / "hooks"

REQUIRED_HOOKS = (
    "dashclaw_pretool_hermes.py",
    "dashclaw_posttool_hermes.py",
    "dashclaw_postllm_hermes.py",
    "dashclaw_pre_llm_hermes.py",
    "dashclaw_on_session_start_hermes.py",
    "dashclaw_on_session_end_hermes.py",
    "dashclaw_transform_tool_result_hermes.py",
    "dashclaw_subagent_stop_hermes.py",
)


def _dashclaw_env() -> dict:
    return {
        "base_url": (os.environ.get("DASHCLAW_BASE_URL") or "").rstrip("/"),
        "api_key": os.environ.get("DASHCLAW_API_KEY") or "",
        "agent_id": os.environ.get("DASHCLAW_AGENT_ID") or "hermes",
        "workspace": os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd(),
    }


def _api(method: str, path: str, body=None, timeout: float = 5.0):
    env = _dashclaw_env()
    if not env["base_url"] or not env["api_key"]:
        return {"error": "env_missing", "detail": "DASHCLAW_BASE_URL or DASHCLAW_API_KEY not set"}
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        env["base_url"] + path,
        data=data,
        headers={"x-api-key": env["api_key"], "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"error": f"http_{e.code}", "detail": e.reason}
    except Exception as e:
        return {"error": "request_failed", "detail": str(e)}


# ---------------------------------------------------------------------------
# Slash commands
# ---------------------------------------------------------------------------

def _slash_status(args, ctx=None):
    summary = _api("GET", "/api/setup/summary")
    if "error" in summary:
        return f"DashClaw not reachable: {summary.get('detail') or summary['error']}"
    org = summary.get("org", {}) or {}
    counts = summary.get("counts", {}) or {}
    return (
        f"DashClaw {org.get('name') or org.get('id') or 'workspace'}: "
        f"{counts.get('actions_24h', 0)} actions/24h, "
        f"{counts.get('open_approvals', 0)} open approvals, "
        f"{counts.get('policies_active', 0)} active policies."
    )


def _slash_approvals(args, ctx=None):
    res = _api("GET", "/api/approvals?status=pending&limit=10")
    if "error" in res:
        return f"DashClaw not reachable: {res.get('detail') or res['error']}"
    items = res.get("approvals") or res.get("items") or []
    if not items:
        return "No pending approvals."
    lines = ["Pending approvals:"]
    for a in items[:10]:
        lines.append(f"  {a.get('id', '?')} — {a.get('summary') or a.get('action_type') or 'action'}")
    return "\n".join(lines)


def _slash_policies(args, ctx=None):
    res = _api("GET", "/api/policies?active=true&limit=20")
    if "error" in res:
        return f"DashClaw not reachable: {res.get('detail') or res['error']}"
    items = res.get("policies") or res.get("items") or []
    if not items:
        return "No active policies."
    return "Active policies:\n" + "\n".join(
        f"  {p.get('slug', p.get('id', '?'))} — {p.get('name', '')}" for p in items[:20]
    )


def _slash_session(args, ctx=None):
    session_id = (ctx.session_id if ctx and hasattr(ctx, "session_id") else None)
    if not session_id:
        return "No active session id."
    res = _api("GET", "/api/code-sessions/sessions?session_uuid=" + session_id)
    if isinstance(res, dict) and "error" in res:
        return f"DashClaw session: {session_id} (live-ingest endpoint: /api/code-sessions/ingest-live)"
    return f"DashClaw session: {session_id}\nLive ingest endpoint: /api/code-sessions/ingest-live"


# ---------------------------------------------------------------------------
# CLI subcommands — `hermes dashclaw <sub>`
# ---------------------------------------------------------------------------

def _cli_setup(args):
    print("DashClaw setup")
    print("  1. Provision a workspace key: run the `dashclaw:register-on-dashclaw` skill,")
    print("     or sign in at https://dashclaw.io and copy the workspace API key.")
    print("  2. Export the env vars (shell or ~/.hermes/config.yaml under `plugins.dashclaw.env`):")
    print("       DASHCLAW_BASE_URL=https://<your-instance>.vercel.app")
    print("       DASHCLAW_API_KEY=dcw_...")
    print("       DASHCLAW_AGENT_ID=hermes        # optional, defaults to hermes")
    print("  3. Verify with: hermes dashclaw doctor")
    return 0


def _cli_status(args):
    print(_slash_status([], None))
    return 0


def _check(label: str, ok: bool, detail: str = "") -> bool:
    mark = "ok " if ok else "FAIL"
    print(f"  [{mark}] {label}" + (f"  ({detail})" if detail else ""))
    return ok


def _cli_doctor(args):
    """`hermes dashclaw doctor` — environment + hooks + API sanity check."""
    print("DashClaw doctor")
    env = _dashclaw_env()
    all_ok = True

    # Section 1: env vars.
    print("\n  Environment:")
    all_ok &= _check("DASHCLAW_BASE_URL set", bool(env["base_url"]))
    all_ok &= _check("DASHCLAW_API_KEY set",  bool(env["api_key"]))
    _check("DASHCLAW_AGENT_ID",                True, env["agent_id"])

    # Section 2: hook scripts on disk.
    print("\n  Hook scripts:")
    for name in REQUIRED_HOOKS:
        path = HOOKS_ROOT / name
        all_ok &= _check(name, path.exists(), str(path) if not path.exists() else "")

    # Section 3: skills on disk.
    print("\n  Skills:")
    for name in ("dashclaw-governance", "dashclaw-platform-intelligence"):
        path = SKILLS_ROOT / name / "SKILL.md"
        all_ok &= _check(f"{name}/SKILL.md", path.exists())

    # Section 4: API reachability (only if env is set).
    print("\n  API:")
    if env["base_url"] and env["api_key"]:
        summary = _api("GET", "/api/setup/summary", timeout=5)
        if "error" in summary:
            _check("GET /api/setup/summary", False, summary.get("detail") or summary["error"])
            all_ok = False
        else:
            org = summary.get("org", {}) or {}
            counts = summary.get("counts", {}) or {}
            _check("GET /api/setup/summary", True,
                   f"org={org.get('id', '?')}, policies={counts.get('policies_active', 0)}")

        live = _api(
            "POST",
            "/api/code-sessions/ingest-live",
            body={"session_uuid": "doctor-probe-do-not-record", "finalize": True,
                  "project": {"slug": "doctor-probe", "source_host": "hook"}},
            timeout=8,
        )
        if isinstance(live, dict) and "error" not in live:
            _check("POST /api/code-sessions/ingest-live", True, "finalize probe ok")
        else:
            _check("POST /api/code-sessions/ingest-live", False,
                   (live or {}).get("detail") or (live or {}).get("error") or "no response")
            all_ok = False
    else:
        print("  (skipped — set DASHCLAW_BASE_URL + DASHCLAW_API_KEY first)")

    print("\n  " + ("All checks passed." if all_ok else "One or more checks failed — see above."))
    return 0 if all_ok else 1


def _cli_skills(args):
    """`hermes dashclaw skills` — list bundled skills with their descriptions."""
    print("DashClaw skills bundled with this plugin:")
    for name in ("dashclaw-governance", "dashclaw-platform-intelligence"):
        path = SKILLS_ROOT / name / "SKILL.md"
        if not path.exists():
            print(f"  - {name}: MISSING ({path})")
            continue
        try:
            text = path.read_text(encoding="utf-8")
            # Pull description from YAML frontmatter (first paragraph after `description:`).
            desc = ""
            in_fm = False
            for line in text.splitlines():
                if line.strip() == "---":
                    in_fm = not in_fm
                    if not in_fm:
                        break
                    continue
                if in_fm and line.startswith("description:"):
                    desc = line.split(":", 1)[1].strip().strip(">").strip()
                    if not desc:
                        # Folded scalar — grab the next non-empty line.
                        idx = text.splitlines().index(line)
                        for nxt in text.splitlines()[idx + 1:]:
                            if nxt.strip() and not nxt.strip().startswith("---"):
                                desc = nxt.strip()
                                break
                    break
            print(f"  - {name}: {desc[:140] or '(no description)'}")
        except Exception as e:
            print(f"  - {name}: read failed ({type(e).__name__})")
    return 0


def _cli_policies(args):
    """`hermes dashclaw policies` — list active policies in the terminal."""
    print(_slash_policies([], None))
    return 0


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register(ctx):
    """Hermes plugin registration entry point."""

    # Skills — sibling directory shared with the Codex plugin.
    if hasattr(ctx, "register_skill"):
        for name, rel in (
            ("governance", "dashclaw-governance"),
            ("platform-intelligence", "dashclaw-platform-intelligence"),
        ):
            skill_path = SKILLS_ROOT / rel
            if skill_path.exists():
                ctx.register_skill(name=name, path=str(skill_path))

    # Slash commands (CLI + gateway sessions).
    if hasattr(ctx, "register_command"):
        ctx.register_command(name="dashclaw-status",    handler=_slash_status,
                             description="Show DashClaw workspace summary (actions, approvals, policies).")
        ctx.register_command(name="dashclaw-approvals", handler=_slash_approvals,
                             description="List pending DashClaw approvals.")
        ctx.register_command(name="dashclaw-policies",  handler=_slash_policies,
                             description="List active DashClaw policies.")
        ctx.register_command(name="dashclaw-session",   handler=_slash_session,
                             description="Show current session id and live-ingest endpoint.")

    # CLI subcommands — `hermes dashclaw <sub>`.
    if hasattr(ctx, "register_cli_command"):
        ctx.register_cli_command(
            name="dashclaw",
            help="DashClaw governance and instrumentation",
            setup_fn=None,
            handler_fn=lambda args: _dispatch_cli(args),
        )


def _dispatch_cli(args):
    sub = (args[0] if args else "").strip()
    rest = args[1:] if len(args) > 1 else []
    handlers = {
        "setup":    _cli_setup,
        "status":   _cli_status,
        "doctor":   _cli_doctor,
        "skills":   _cli_skills,
        "policies": _cli_policies,
    }
    if sub in handlers:
        return handlers[sub](rest)
    print("Usage: hermes dashclaw <setup|status|doctor|skills|policies>")
    return 2
