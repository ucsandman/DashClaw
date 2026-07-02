#!/usr/bin/env python3
"""
DashClaw SessionStart Digest Hook for Claude Code.

Prints a compact digest of recent DashClaw memory at session start:
recent decisions, distilled lessons, and any unconsumed handoff. Claude Code
adds SessionStart stdout to the session context, so the agent starts every
session already knowing what it learned and what was handed off.

Read-only, fail-silent: any missing config, network error, or slow API
produces NO output and exit 0. Total budget ~4.2s (three requests, 1.4s each).

Config (env or .env.local discovered by walking up from this file):
  DASHCLAW_BASE_URL (or DASHCLAW_URL), DASHCLAW_API_KEY,
  DASHCLAW_AGENT_ID (default: claude-code; a `--agent-id <id>` argv flag
  written by the harness installer takes precedence),
  DASHCLAW_DIGEST_DISABLED=1 to turn off.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

# --- .env loading: same walk-up convention as the sibling hooks -------------

def _apply_env_line(line):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        return
    key, _, val = line.partition("=")
    key = key.strip()
    val = val.strip().strip('"').strip("'")
    if " #" in val:
        val = val[: val.index(" #")].strip()
    if key and key not in os.environ:
        os.environ[key] = val


def _apply_env_file(env_path):
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                _apply_env_line(line)
    except (FileNotFoundError, OSError):
        return


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
            _apply_env_file(env_path)
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent


_load_dotenv()


def _argv_agent_id():
    # Per-harness identity declaration (roadmap v2.2): the harness integration
    # appends `--agent-id <id>` to the hook command line; argv beats the
    # machine-ambient DASHCLAW_AGENT_ID env var. Mirrors dashclaw_pretool.py.
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--agent-id" and i + 1 < len(argv):
            return argv[i + 1].strip()
        if arg.startswith("--agent-id="):
            return arg.split("=", 1)[1].strip()
    return ""


BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
AGENT_ID = _argv_agent_id() or os.environ.get("DASHCLAW_AGENT_ID") or "claude-code"
TIMEOUT_S = 1.4  # per request; three requests stay inside the ~4.2s budget
MAX_DECISIONS = 5
MAX_LESSONS = 3


def _get(path):
    req = urllib.request.Request(
        BASE_URL + path,
        headers={"x-api-key": API_KEY, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _short(text, n=70):
    text = str(text or "").strip().replace("\n", " ")
    return text if len(text) <= n else text[: n - 1] + "…"


def _fmt_decision(d):
    outcome = str(d.get("outcome") or "").lower()
    glyph = "+" if outcome in ("success", "succeeded", "ok") else ("-" if outcome in ("failure", "failed") else "·")
    conf = d.get("confidence")
    # decisions.confidence is an integer 0-100 (schema default 50)
    conf_s = f" ({float(conf):.0f}%)" if isinstance(conf, (int, float)) else ""
    return f"  {glyph} {_short(d.get('decision'))}{conf_s}"


def _fmt_lesson(item):
    # consolidateLessons() lessons carry the text in `guidance` (string|null).
    if isinstance(item, dict):
        item = item.get("guidance") or item.get("text") or item.get("summary") or json.dumps(item)
    return f"  * {_short(item)}"


def _handoff_lines(h):
    # GET /api/handoffs?latest=true returns the unconsumed handoff as a
    # top-level object {id, agent_id, project_id, bundle, created_at};
    # a 404 (no_handoff) never reaches here — _get raises and the caller skips.
    if not isinstance(h, dict) or not h.get("id"):
        return []
    bundle = h.get("bundle") or {}
    summary = bundle.get("summary") if isinstance(bundle, dict) else None
    return [
        f"Unconsumed handoff from {h.get('created_at', '?')}: {_short(summary or '(no summary)')}",
        "  -> consume with dashclaw_handoff_consume",
    ]


def main():
    if not BASE_URL or not API_KEY or os.environ.get("DASHCLAW_DIGEST_DISABLED"):
        return
    try:
        learning = _get(f"/api/learning?agent_id={urllib.parse.quote(AGENT_ID)}&limit=10") or {}
    except Exception:
        return  # API down/slow/misconfigured: silent, never delay session start

    lines = [f"# DashClaw digest — agent {AGENT_ID}"]
    decisions = learning.get("decisions") or []
    if decisions:
        lines.append("Recent decisions:")
        lines.extend(_fmt_decision(d) for d in decisions[:MAX_DECISIONS])
    lessons = learning.get("lessons") or []
    if lessons:
        lines.append("Lessons:")
        lines.extend(_fmt_lesson(l) for l in lessons[:MAX_LESSONS])
    stats = learning.get("stats") or {}
    sr = stats.get("successRate")
    if isinstance(sr, (int, float)) and stats.get("totalDecisions"):
        pct = sr * 100 if 0 <= sr <= 1 else sr  # tolerate ratio or percent
        lines.append(f"Success rate: {pct:.0f}% over {stats['totalDecisions']} decisions")

    try:
        lines.extend(_handoff_lines(_get(f"/api/handoffs?latest=true&agent_id={urllib.parse.quote(AGENT_ID)}")))
    except Exception:
        pass  # 404 no_handoff or network blip: digest still useful without it

    # W3: pending approvals + flood state (one extra request, fail-silent).
    try:
        lite = _get("/api/digest/fleet?lite=1") or {}
        pa = lite.get("pending_approvals")
        if isinstance(pa, int) and pa > 0:
            age = lite.get("oldest_pending_minutes")
            suffix = f" (oldest {int(age)}m)" if isinstance(age, (int, float)) else ""
            lines.append(f"{pa} approval(s) pending{suffix} - review at {BASE_URL}/approvals")
        for f in (lite.get("floods") or [])[:2]:
            # _short(): API-sourced names reach session context — strip newlines, cap length
            name = _short(f.get("name") or f.get("policy_id") or "policy", 40)
            count = int(f.get("count")) if isinstance(f.get("count"), (int, float)) else 0
            lines.append(f"WARNING approval flood active: {name} ({count} in window)")
    except Exception:
        pass

    if len(lines) > 1:
        lines.append("Query details: dashclaw_learning_query | full export: GET /api/learning/export")
        try:
            # Windows consoles default to cp1252; Claude Code reads hook
            # stdout as UTF-8, so force it (em-dash/ellipsis in the digest).
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        sys.stdout.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # absolute fail-silent backstop
    sys.exit(0)
