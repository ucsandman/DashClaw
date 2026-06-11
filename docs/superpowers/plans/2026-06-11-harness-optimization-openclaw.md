# Harness Optimization + DashClaw Session Digest + OpenClaw Elevation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim and repair the local Claude Code harness, ship a new `dashclaw_session_digest.py` SessionStart hook through DashClaw's existing distribution machinery, and elevate OpenClaw on the marketing site (quickstart card + origin story).

**Architecture:** Two repos. `C:\Projects\DashClaw` (git, Next.js app + Python hooks + Node installer) gets the new hook, installer/zip/docs wiring, and marketing edits — TDD with pytest (hooks) and the existing Vitest/Jest unit tests (installer). `C:\Users\sandm\.claude` (not git) gets surgical settings edits, skill archiving, cleanup, and a new read-only `harness-health` skill.

**Tech Stack:** Python 3 stdlib (hooks), Node ESM (installer), pytest, existing JS unit test runner, Next.js/React (marketing), PowerShell 7 (harness-health).

**Spec:** `C:\Users\sandm\.claude\docs\specs\2026-06-11-harness-optimization-openclaw-design.md`

**Discovery deltas from spec (verified in repo, 2026-06-11):**
- `/guides/openclaw` page **already exists and is complete** — Workstream E shrinks to: quickstart card in `landingData.js` + origin-story copy (landing card + guide intro).
- Spec said "install digest locally via `install-hooks.mjs --global`". **Deviation:** the user's `~\.claude\settings.json` DashClaw entries have hand-tuned timeouts/statusMessages; a `--global --governance` re-run would clobber them with stock blocks (incl. a 3600000ms pretool timeout). Instead, add ONLY a SessionStart entry manually, in the user's existing absolute-path style. Installer correctness is verified against a temp target dir instead (Task 4).

---

## Part 1 — DashClaw repo (`C:\Projects\DashClaw`)

### Task 1: Verify API response shapes for the digest

The digest hook consumes `GET /api/learning` and `GET /api/handoffs?latest=true`. The code in Task 3 is written defensively, but key names must be confirmed.

**Files:**
- Read: `C:\Projects\DashClaw\app\api\learning\route.ts` (response JSON keys: expect `decisions[]` with `decision`, `outcome`, `confidence`, `created_at`; `lessons` from `consolidateLessons()`; `stats`)
- Read: `C:\Projects\DashClaw\app\lib\learning-lessons.ts` (shape of `lessons` — string list vs objects)
- Read: `C:\Projects\DashClaw\app\api\handoffs\route.ts` (the `latest=true` branch — single object vs `{ handoffs: [...] }`; field names `bundle_json`, `created_at`, `consumed_at`; confirm auth via `x-api-key`)

- [ ] **Step 1:** Read the three files above. Write down the exact JSON keys for: decisions list + per-decision fields, lessons shape, latest-handoff shape, and the query-param names.
- [ ] **Step 2:** If any key differs from what Task 2/3 code assumes (`decisions`, `decision`, `outcome`, `confidence`, `lessons`, `bundle_json`, `created_at`), adjust the test fixture in Task 2 and the parsing in Task 3 to the real keys before proceeding. The defensive `.get()` chains stay either way.

### Task 2: Failing tests for `dashclaw_session_digest.py`

**Files:**
- Test: `C:\Projects\DashClaw\hooks\tests\test_session_digest.py`

Follow the existing subprocess-style hook tests (see `test_stop_fail_silent.py` for the pattern: run the hook as a subprocess with `DASHCLAW_DISABLE_DOTENV=1` and controlled env).

- [ ] **Step 1: Write the failing tests**

```python
"""Tests for dashclaw_session_digest.py (SessionStart digest hook).

Contract: never blocks, always exits 0, prints a digest to stdout when the
API answers, prints nothing when config is missing or the API is down.
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HOOK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dashclaw_session_digest.py")


def run_hook(env_overrides):
    env = {**os.environ, "DASHCLAW_DISABLE_DOTENV": "1"}
    # Start from a config-clean slate so machine env vars don't leak in.
    for k in ("DASHCLAW_BASE_URL", "DASHCLAW_URL", "DASHCLAW_API_KEY", "DASHCLAW_AGENT_ID"):
        env.pop(k, None)
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, HOOK], input=b"{}", capture_output=True, env=env, timeout=15
    )


class _Api(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/learning"):
            body = {
                "decisions": [
                    {"decision": "Use FF-only sync for main checkout", "outcome": "success", "confidence": 0.9, "created_at": "2026-06-10T12:00:00Z"},
                    {"decision": "Retry flaky vercel deploy once", "outcome": "failure", "confidence": 0.4, "created_at": "2026-06-09T12:00:00Z"},
                ],
                "lessons": ["Prefer reversible deploy strategies (success rate 0.92, n=24)"],
                "stats": {"success_rate": 0.88, "total_decisions": 31},
            }
        elif self.path.startswith("/api/handoffs"):
            body = {"handoff": {"id": "h_1", "created_at": "2026-06-11T01:00:00Z", "bundle_json": {"summary": "Finished digest hook tests"}}}
        else:
            self.send_response(404); self.end_headers(); return
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):  # keep test output clean
        pass


def _serve():
    srv = HTTPServer(("127.0.0.1", 0), _Api)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def test_no_config_prints_nothing_exits_zero():
    r = run_hook({})
    assert r.returncode == 0
    assert r.stdout == b""


def test_api_unreachable_fails_silent():
    r = run_hook({"DASHCLAW_BASE_URL": "http://127.0.0.1:1", "DASHCLAW_API_KEY": "oc_test"})
    assert r.returncode == 0
    assert r.stdout == b""


def test_digest_rendered_from_api():
    srv = _serve()
    try:
        r = run_hook({
            "DASHCLAW_BASE_URL": f"http://127.0.0.1:{srv.server_address[1]}",
            "DASHCLAW_API_KEY": "oc_test",
            "DASHCLAW_AGENT_ID": "claude-code",
        })
    finally:
        srv.shutdown()
    out = r.stdout.decode()
    assert r.returncode == 0
    assert "DashClaw digest" in out
    assert "FF-only sync" in out                  # decision title
    assert "reversible deploy strategies" in out  # lesson
    assert "unconsumed handoff" in out.lower()    # handoff pointer
    assert "dashclaw_handoff_consume" in out      # how to consume
    assert len(out.splitlines()) <= 22            # stays compact


def test_disabled_flag_prints_nothing():
    srv = _serve()
    try:
        r = run_hook({
            "DASHCLAW_BASE_URL": f"http://127.0.0.1:{srv.server_address[1]}",
            "DASHCLAW_API_KEY": "oc_test",
            "DASHCLAW_DIGEST_DISABLED": "1",
        })
    finally:
        srv.shutdown()
    assert r.returncode == 0
    assert r.stdout == b""
```

- [ ] **Step 2: Run tests, verify they fail**

Run (from repo root): `python -m pytest hooks/tests/test_session_digest.py -v`
Expected: all 4 FAIL/ERROR (hook file doesn't exist yet).

### Task 3: Implement `dashclaw_session_digest.py`

**Files:**
- Create: `C:\Projects\DashClaw\hooks\dashclaw_session_digest.py`

- [ ] **Step 1: Write the hook** (adjust JSON keys if Task 1 found different ones)

```python
#!/usr/bin/env python3
"""
DashClaw SessionStart Digest Hook for Claude Code.

Prints a compact digest of recent DashClaw memory at session start:
recent decisions, distilled lessons, and any unconsumed handoff. Claude Code
adds SessionStart stdout to the session context, so the agent starts every
session already knowing what it learned and what was handed off.

Read-only, fail-silent: any missing config, network error, or slow API
produces NO output and exit 0. Total budget ~3s (two requests, 1.4s each).

Config (env or .env.local discovered by walking up from this file):
  DASHCLAW_BASE_URL (or DASHCLAW_URL), DASHCLAW_API_KEY,
  DASHCLAW_AGENT_ID (default: claude-code),
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

BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or os.environ.get("DASHCLAW_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
AGENT_ID = os.environ.get("DASHCLAW_AGENT_ID") or "claude-code"
TIMEOUT_S = 1.4  # per request; two requests stay inside the ~3s budget
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
    conf_s = f" ({float(conf):.0%})" if isinstance(conf, (int, float)) else ""
    return f"  {glyph} {_short(d.get('decision'))}{conf_s}"


def _fmt_lesson(item):
    # consolidateLessons() may yield strings or {guidance|text|...} objects.
    if isinstance(item, dict):
        item = item.get("guidance") or item.get("text") or item.get("hint") or json.dumps(item)
    return f"  * {_short(item)}"


def _handoff_lines(payload):
    h = payload.get("handoff") if isinstance(payload, dict) else None
    if h is None and isinstance(payload, dict):
        items = payload.get("handoffs")
        h = items[0] if isinstance(items, list) and items else None
    if not isinstance(h, dict) or h.get("consumed_at"):
        return []
    bundle = h.get("bundle_json") or {}
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
    if isinstance(stats.get("success_rate"), (int, float)):
        lines.append(f"Success rate: {float(stats['success_rate']):.0%} over {stats.get('total_decisions', '?')} decisions")

    try:
        lines.extend(_handoff_lines(_get(f"/api/handoffs?latest=true&agent_id={urllib.parse.quote(AGENT_ID)}")))
    except Exception:
        pass  # digest still useful without the handoff

    if len(lines) > 1:
        lines.append("Query details: dashclaw_learning_query | full export: GET /api/learning/export")
        sys.stdout.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # absolute fail-silent backstop
    sys.exit(0)
```

- [ ] **Step 2: Run the tests**

Run: `python -m pytest hooks/tests/test_session_digest.py -v`
Expected: 4 PASS. If `test_digest_rendered_from_api` fails on key names, reconcile with Task 1 findings.

- [ ] **Step 3: Run the full hook suite** (regression)

Run: `python -m pytest hooks/tests -q`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add hooks/dashclaw_session_digest.py hooks/tests/test_session_digest.py
git commit -m "feat(hooks): SessionStart digest hook — recent decisions, lessons, unconsumed handoff"
```

### Task 4: Wire the digest into the installer + bundled settings snippet

**Files:**
- Modify: `C:\Projects\DashClaw\scripts\install-hooks.mjs`
- Modify: `C:\Projects\DashClaw\hooks\settings.json`
- Test: `C:\Projects\DashClaw\__tests__\unit\install-hooks.test.js`

- [ ] **Step 1: Add failing tests** to `__tests__/unit/install-hooks.test.js` (match the file's existing import/describe style):

```js
describe('session digest hook', () => {
  it('hookBlocks includes a SessionStart digest entry', () => {
    const blocks = hookBlocks('python');
    expect(blocks.SessionStart).toBeDefined();
    const cmd = blocks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain('dashclaw_session_digest.py');
    expect(cmd).toContain('$CLAUDE_PROJECT_DIR');
  });

  it('isManagedHookCommand matches the digest script', () => {
    expect(isManagedHookCommand('python "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_session_digest.py"')).toBe(true);
    expect(isManagedHookCommand('python "x/my_dashclaw_session_digest.py"')).toBe(false);
  });

  it('globalGovernanceBlocks includes SessionStart with absolute path', () => {
    const blocks = globalGovernanceBlocks('/repo', 'python3');
    expect(blocks.SessionStart[0].hooks[0].command).toContain('/repo/hooks/dashclaw_session_digest.py');
  });

  it('re-merge does not duplicate the SessionStart entry', () => {
    const once = mergeGlobalGovernanceHooks({}, '/repo', { python: 'python3' });
    const twice = mergeGlobalGovernanceHooks(once, '/repo', { python: 'python3' });
    expect(twice.hooks.SessionStart).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify the new tests fail** — use the runner the repo's `package.json` declares for `__tests__` (check `scripts.test`); e.g. `npm test -- install-hooks`.

- [ ] **Step 3: Implement in `install-hooks.mjs`:**
  - `MANAGED_HOOK_FILES`: add `'dashclaw_session_digest.py'`.
  - `hookBlocks(python)`: add (SessionStart entries take no matcher):

```js
SessionStart: [
  {
    hooks: [
      {
        type: 'command',
        command: `${python} "$CLAUDE_PROJECT_DIR/.claude/hooks/dashclaw_session_digest.py"`,
        timeout: 10,
      },
    ],
  },
],
```

  - `globalGovernanceBlocks(repoRoot, python)`: add `SessionStart: [{ hooks: [{ type: 'command', command: cmd('dashclaw_session_digest.py'), timeout: 10 }] }],`
  - `main()` per-project copy list: add `'dashclaw_session_digest.py'` to the filename array.
  - Final env-var help text in `main()`: add line `console.log('  DASHCLAW_DIGEST_DISABLED (optional: 1 disables the SessionStart digest)');`

- [ ] **Step 4: Add the SessionStart block to `hooks/settings.json`** (the snippet bundled in the zip), after the `Stop` block:

```json
"SessionStart": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/run_hook.cjs\" dashclaw_session_digest.py",
        "timeout": 10
      }
    ]
  }
]
```

- [ ] **Step 5: Run tests** — `npm test -- install-hooks` → new tests PASS, prior tests still PASS.

- [ ] **Step 6: End-to-end installer check against a temp dir:**

```powershell
$tmp = Join-Path $env:TEMP "dc-install-test-$(Get-Random)"
New-Item -ItemType Directory $tmp | Out-Null
node scripts/install-hooks.mjs --target=$tmp
node scripts/install-hooks.mjs --target=$tmp   # idempotency
Get-Content "$tmp\.claude\settings.json"
```
Expected: `dashclaw_session_digest.py` copied into `$tmp\.claude\hooks\`; settings contain exactly ONE SessionStart digest entry after the double run. Then `Remove-Item -Recurse -Force $tmp -Confirm:$false`.

- [ ] **Step 7: Commit**

```bash
git add scripts/install-hooks.mjs hooks/settings.json __tests__/unit/install-hooks.test.js
git commit -m "feat(installer): distribute SessionStart digest hook (copy, merge, global governance)"
```

### Task 5: Docs + downloads page + zip

**Files:**
- Modify: `C:\Projects\DashClaw\hooks\README.md`
- Modify: `C:\Projects\DashClaw\app\downloads\page.tsx` (lines ~313 and ~320)

- [ ] **Step 1: `hooks/README.md`** — add a "Session digest (SessionStart)" section after the existing per-hook sections, covering: what it prints (decisions/lessons/handoff), fail-silent contract (~3s budget, exit 0, no output on any failure), config vars incl. `DASHCLAW_DIGEST_DISABLED=1`, and that the installer wires it automatically. Mirror the README's existing section voice/format.
- [ ] **Step 2: Downloads page copy** — in `app/downloads/page.tsx`: plugin-bundle description (~line 313): "Installs three hooks (PreToolUse, PostToolUse, Stop)" → "Installs four hooks (PreToolUse, PostToolUse, Stop, SessionStart digest)". Hooks DownloadCard `role` (~line 320): "The four hook scripts (pretool, posttool, stop, code-session reporter)" → "The five hook scripts (pretool, posttool, stop, code-session reporter, session digest)".
- [ ] **Step 3: Regenerate bundles:** `npm run livingcode:refresh` → then verify the zip contains the new hook:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::OpenRead("C:\Projects\DashClaw\public\downloads\dashclaw-claude-code-hooks.zip").Entries.FullName | Select-String session_digest
```
Expected: one match.
- [ ] **Step 4: Commit** — `git add hooks/README.md app/downloads/page.tsx public/downloads/` + `git commit -m "docs(downloads): ship session digest hook in bundle, README, and page copy"` (include zip only if the repo tracks `public/downloads/*.zip` — check `git status`).

### Task 6: OpenClaw quickstart card + origin story

**Files:**
- Modify: `C:\Projects\DashClaw\app\landingData.js` (append to `frameworkQuickstarts`, after `hermes` entry ending near line 225)
- Modify: `C:\Projects\DashClaw\app\page.tsx:733-736` (OpenClaw integration card desc)
- Modify: `C:\Projects\DashClaw\app\guides\openclaw\page.tsx` (intro, near the heading around line 149)

- [ ] **Step 1: Quickstart entry** (matches existing entry shape; config keys verified against the shipped guide page):

```js
{
  id: 'openclaw',
  name: 'OpenClaw',
  label: 'Plugin — full governance loop',
  code: `// openclaw.config.json — the framework that
// inspired the "Claw" in DashClaw
{
  "plugins": {
    "entries": {
      "dashclaw-governance": {
        "enabled": true,
        "config": {
          "dashclawUrl": "https://your-instance.vercel.app",
          "dashclawApiKey": "oc_live_...",
          "agentId": "my-openclaw-agent",
          "failClosed": true
        }
      }
    }
  }
}
// Every tool call: guard -> record -> approval
// -> outcome. x402 spend gating included.`
},
```

- [ ] **Step 2: Landing card origin line** — `app/page.tsx:734` desc becomes: `'Native plugin for OpenClaw — the agent framework that inspired the "Claw" in DashClaw. Intercepts PreToolUse / PostToolUse, runs guard / record / wait-for-approval automatically.'`
- [ ] **Step 3: Guide intro origin line** — in `app/guides/openclaw/page.tsx`, add one sentence to the intro/description block near the `frameworkName="OpenClaw"` heading: `OpenClaw is where DashClaw's "Claw" comes from — it was the first agent runtime we governed, and the plugin remains one of the deepest integrations.` (Place it in the existing intro prose element; match surrounding JSX.)
- [ ] **Step 4:** `npm run lint` and `npm run build` from the app root — both pass. Visually check `/` quickstart tabs and `/guides/openclaw` in `npm run dev` if quick.
- [ ] **Step 5: PAUSE — show the three copy changes to the user for review before committing** (spec gate: marketing copy is user-reviewed). After approval: `git add app/landingData.js app/page.tsx app/guides/openclaw/page.tsx && git commit -m "feat(marketing): OpenClaw quickstart card + origin story"`.

**No deploy in this plan** — deploying is a hard stop requiring separate explicit confirmation.

---

## Part 2 — Local harness (`C:\Users\sandm\.claude`, not a git repo — no commits)

### Task 7: Slim — disable plugins, add digest hook entry, archive skills

**Files:**
- Modify: `C:\Users\sandm\.claude\settings.json`
- Create dir: `C:\Users\sandm\.claude\skills-archive\`

- [ ] **Step 1:** Back up settings: `Copy-Item C:\Users\sandm\.claude\settings.json C:\Users\sandm\.claude\settings.json.bak-20260611`
- [ ] **Step 2:** In `enabledPlugins`, set to `false`: `example-skills@anthropic-agent-skills`, `mcp-server-dev@claude-plugins-official`, `claude-code-setup@claude-plugins-official`, `code-simplifier@claude-plugins-official`, `claude-mem@thedotmack`.
- [ ] **Step 3:** Add SessionStart digest entry alongside the existing `session-count.py` entry (user's absolute-path style, NOT an installer run — see deviation note):

```json
{
  "type": "command",
  "command": "python \"C:/Projects/DashClaw/hooks/dashclaw_session_digest.py\"",
  "timeout": 10,
  "statusMessage": "Fetching DashClaw digest..."
}
```
(appended to the `hooks` array of the existing SessionStart block.)
- [ ] **Step 4:** Archive the 17 never-used skills (agentcash handled in Task 8):

```powershell
New-Item -ItemType Directory -Force C:\Users\sandm\.claude\skills-archive | Out-Null
$skills = 'audit','codebase-map','critique','frontend-code-review','frontend-testing','graphify','harden','harness-skill','improve','learned','make-interfaces-feel-better','new-ps-project','optimize','react-best-practices','tailwind-patterns','thermo-nuclear-code-quality-review','web-accessibility'
foreach ($s in $skills) { if (Test-Path "C:\Users\sandm\.claude\skills\$s") { Move-Item "C:\Users\sandm\.claude\skills\$s" "C:\Users\sandm\.claude\skills-archive\$s" } }
Get-ChildItem C:\Users\sandm\.claude\skills | Select-Object -ExpandProperty Name
```
Expected remaining: `claude-api`, `frontend-verify`, `polish`, `dashclaw-governance`, `dashclaw-platform-intelligence` (+ `harness-health` after Task 9).

### Task 8: Fix — delete orphans, remove agentcash, cleanup cruft

- [ ] **Step 1:** Delete `C:\Users\sandm\.claude\hooks\ts-check.sh` (orphaned — referenced by no settings file; typescript-lsp covers diagnostics).
- [ ] **Step 2:** Remove agentcash: delete `C:\Users\sandm\.claude\skills\agentcash\`; then find its MCP registration — `Grep pattern "agentcash" in C:\Users\sandm\.claude\.claude.json and settings*.json` — and remove that server block. (It is broken: `spawn npx ENOENT`, zero usage.)
- [ ] **Step 3:** Enumerate cruft, print the list (spec gate: exact list shown before deletion), then delete:

```powershell
$cruft = @()
$cruft += Get-Item C:\Users\sandm\.claude\CLAUDE.md.bak* -ErrorAction SilentlyContinue
$cruft += Get-ChildItem C:\Users\sandm\.claude -Filter 'security_warnings_state_*.json' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-7)
$cruft += Get-ChildItem C:\Users\sandm\.claude\backups -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'corrupted' -or $_.LastWriteTime -lt (Get-Date).AddDays(-7) }
$cruft | Select-Object FullName, LastWriteTime
# After printing the list in the session output:
$cruft | Remove-Item -Force -Confirm:$false
```

### Task 9: Add — `harness-health` skill + script

**Files:**
- Create: `C:\Users\sandm\.claude\scripts\harness-health.ps1`
- Create: `C:\Users\sandm\.claude\skills\harness-health\SKILL.md`

- [ ] **Step 1: Write `harness-health.ps1`** (read-only report):

```powershell
# harness-health.ps1 — read-only Claude Code harness check. Changes nothing.
$ErrorActionPreference = 'SilentlyContinue'
$claude = "$env:USERPROFILE\.claude"
$issues = @()

# 1. Every hook command's script file exists
$settings = Get-Content "$claude\settings.json" -Raw | ConvertFrom-Json
$refd = @()
foreach ($event in $settings.hooks.PSObject.Properties) {
  foreach ($block in $event.Value) {
    foreach ($h in $block.hooks) {
      foreach ($m in [regex]::Matches($h.command, '"([^"]+\.(py|cjs|sh|ps1|mjs))"')) {
        $p = $m.Groups[1].Value -replace '/', '\'
        $refd += $p
        if (-not (Test-Path $p)) { $issues += "MISSING hook target: $p (event $($event.Name))" }
      }
    }
  }
}

# 2. Orphaned scripts in hooks\ that no settings entry references
Get-ChildItem "$claude\hooks" -File | ForEach-Object {
  if ($refd -notcontains $_.FullName) { $issues += "ORPHANED hook script (not in settings.json): $($_.Name)" }
}

# 3. Enabled plugins with no cache directory
foreach ($p in $settings.enabledPlugins.PSObject.Properties | Where-Object Value) {
  $name = ($p.Name -split '@')[0]
  if (-not (Get-ChildItem "$claude\plugins\cache" -Directory -Recurse -Depth 1 | Where-Object Name -eq $name)) {
    $issues += "ENABLED plugin with no cache dir: $($p.Name)"
  }
}

# 4. Cruft counts
$bak = (Get-Item "$claude\CLAUDE.md.bak*").Count
$warn = (Get-ChildItem $claude -Filter 'security_warnings_state_*.json').Count
$backups = (Get-ChildItem "$claude\backups" -File).Count
if ($bak -gt 0) { $issues += "$bak stale CLAUDE.md backups" }
if ($warn -gt 5) { $issues += "$warn security-warning state files (prune?)" }
if ($backups -gt 10) { $issues += "$backups files in backups\ (prune?)" }

"=== harness-health $(Get-Date -Format yyyy-MM-dd) ==="
"Hook targets checked: $($refd.Count) | Enabled plugins: $(($settings.enabledPlugins.PSObject.Properties | Where-Object Value).Count) | Skills: $((Get-ChildItem "$claude\skills" -Directory).Count) (archived: $((Get-ChildItem "$claude\skills-archive" -Directory).Count))"
if ($issues) { "ISSUES:"; $issues | ForEach-Object { "  ! $_" } } else { "No issues found." }
exit 0
```

- [ ] **Step 2: Write `SKILL.md`:**

```markdown
---
name: harness-health
description: Read-only health check of the local Claude Code harness — verifies every hook target file exists, finds orphaned hook scripts, flags enabled plugins with missing cache dirs, and counts backup/state-file cruft. Use when hooks misbehave, after editing settings.json, after installing/removing plugins, or for periodic maintenance.
---

# Harness Health

Run: `pwsh -NoProfile -File "$env:USERPROFILE\.claude\scripts\harness-health.ps1"`

Read-only — it never modifies anything. Interpret the output:
- **MISSING hook target** — a settings.json hook points at a deleted/moved script. Fix the path or remove the entry (use the update-config skill).
- **ORPHANED hook script** — a file in `hooks\` no settings entry references. Wire it up or archive it.
- **ENABLED plugin with no cache dir** — plugin enabled in settings but not installed/cached; re-install or disable.
- **Cruft counts** — prune when flagged; safe to delete backups older than 7 days.

If issues were found and the fix is obvious and reversible, apply it; otherwise report.
```

- [ ] **Step 3: Run it:** `pwsh -NoProfile -File C:\Users\sandm\.claude\scripts\harness-health.ps1`
Expected after Tasks 7–8: "No issues found." — except it SHOULD flag the `repowise-rewrite` command (bare command, no script path — acceptable: regex only checks quoted script paths) and must NOT flag the DashClaw absolute-path hooks (they exist). If it flags valid things, fix the script, not the harness.

### Task 10: Verification sweep (both repos)

- [ ] **Step 1:** DashClaw: `npm run lint && npm test && python -m pytest hooks/tests -q` — all pass. Confirm `npm run build` passes if not already run in Task 6.
- [ ] **Step 2:** Local: confirm `settings.json` parses (`Get-Content ... | ConvertFrom-Json`), digest hook fires manually: `python C:\Projects\DashClaw\hooks\dashclaw_session_digest.py < NUL` prints a digest (or nothing, silently, if the API is down — both are correct; distinguish by checking the API is up).
- [ ] **Step 3:** Tell the user: plugin disables and the SessionStart digest take effect in NEW sessions — ask them to open one and confirm (a) the `$CMEM` block is gone, (b) the DashClaw digest block appears, (c) shorter skills list.
- [ ] **Step 4:** Update `~\.claude\memory\MEMORY.md` + a memory file noting: skills archived to `skills-archive\`, claude-mem disabled (data retained), digest hook is the replacement, harness-health exists for future audits.

## Self-review notes

- Spec coverage: A→Task 7, B→Task 8, C→Tasks 7/9, D→Tasks 1–5, E→Task 6, verification→Task 10. Guide-page creation dropped (already exists — discovery delta, documented above).
- Deviation from spec (installer-based local install) is intentional and documented at top.
- Marketing copy has an explicit user-review pause (Task 6 Step 5). No deploy anywhere.
