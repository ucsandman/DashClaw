# DashClaw plugin for Hermes Agent

Governance, integration, troubleshooting, and platform-intelligence skills for [Hermes Agent](https://hermes-agent.nousresearch.com/), plus **eight** shell-hook lifecycle adapters that wire Hermes into DashClaw's governance runtime, secret redactor, and code-session ingest pipeline.

Parallels the Codex plugin in `../.codex-plugin/` and the Claude Code installation in `.claude/`. All three share the same MCP server (`mcp-server/bin/dashclaw-mcp.js`) and the same skill directories under `../skills/`.

## What you get

**Skills** (registered as `dashclaw:governance` and `dashclaw:platform-intelligence`)
- `dashclaw-governance` — when to call guard, how to interpret decisions, action recording, session lifecycle.
- `dashclaw-platform-intelligence` — auto-generated API surface reference (181 routes) plus diagnostic scripts.

**MCP tools** via `../.mcp.json` (same server as Codex and Claude Code) — guard check, action recording, approval wait, governed capability invocation, policy discovery, session tracking, Optimal Files preview/manifest, code-session resources.

**Slash commands** — `/dashclaw-status`, `/dashclaw-approvals`, `/dashclaw-policies`, `/dashclaw-session`.

**CLI** — `hermes dashclaw <setup|status|doctor|skills|policies>`. The `doctor` subcommand runs a full env + hooks-on-disk + skills + API + finalize-probe checklist.

**Lifecycle hooks** (shell-hook delivery, declared in `hermes_config_snippet.yaml`)

| Hermes event | What it does |
|---|---|
| `pre_tool_call` | Guard check + action creation. Blocks denied actions, waits for approval on `require_approval`. |
| `post_tool_call` | Records outcome + MCP health for the action. Never blocks. |
| `pre_llm_call` | Injects a one-line governance context (active policies, pending approvals, today's action count). Cached 5 min. |
| `post_llm_call` | Per-turn live ingest into `/api/code-sessions/ingest-live`. Captures session/tool/cost structure. |
| `on_session_start` | Pre-warms the pre_llm_call cache so the first turn already has fresh state. |
| `on_session_end` | Calls `ingest-live` with `finalize: true`, triggering the optimizer + alerts pass on the now-complete session. |
| `transform_tool_result` | Redacts API keys, JWTs, AWS / GitHub / Slack / Stripe / Anthropic / OpenAI tokens, and PEM private-key blocks from tool output before the model sees them. Never blocks. |
| `subagent_stop` | Records every `delegate_task` child exit as a DashClaw action with `action_type=subagent`, feeding the subagent-ROI dashboard. |

## Install

The fastest path is the bundled installer. From the DashClaw checkout root:

```powershell
# Windows PowerShell
.\scripts\install-hermes-plugin.ps1
```

```bash
# macOS / Linux
./scripts/install-hermes-plugin.sh
```

What the installer does:
1. Symlinks `plugins/dashclaw/.hermes-plugin` into `~/.hermes/plugins/dashclaw`.
2. Symlinks `plugins/dashclaw/skills` into `~/.hermes/skills/dashclaw` (Hermes auto-discovers skills there).
3. Appends the hooks block from `hermes_config_snippet.yaml` to `~/.hermes/config.yaml`, substituting `${DASHCLAW_REPO}` with the absolute path of your checkout. A sentinel marker is added so re-runs are idempotent.
4. Prints an env-var checklist.

Flags: `--force` overwrites an existing install; `--copy` (or `-Mode copy` on PowerShell) avoids symlinks. Symlinks on Windows require Developer Mode or an elevated shell.

### Manual install

If you'd rather not run the script:

```bash
export DASHCLAW_REPO=$(pwd)
ln -s "$DASHCLAW_REPO/plugins/dashclaw/.hermes-plugin" "$HOME/.hermes/plugins/dashclaw"
ln -s "$DASHCLAW_REPO/plugins/dashclaw/skills" "$HOME/.hermes/skills/dashclaw"

# Append `hermes_config_snippet.yaml` to ~/.hermes/config.yaml,
# replacing ${DASHCLAW_REPO} with the absolute path above.
```

### Required env vars

```bash
export DASHCLAW_BASE_URL="https://your-instance.vercel.app"
export DASHCLAW_API_KEY="dcw_..."        # workspace API key
export DASHCLAW_AGENT_ID="hermes"         # optional; default "hermes"
```

You can also put these under `plugins.dashclaw.env:` in `~/.hermes/config.yaml` if you'd rather not export them globally.

### Enable + verify

```bash
hermes plugins enable dashclaw
hermes dashclaw doctor       # full sanity check
hermes                       # start a session; first run will prompt you to approve each shell hook
```

Set `hooks_auto_accept: true` in `~/.hermes/config.yaml` once you've reviewed the shell-hook commands so Hermes does not re-prompt every session.

## How it differs from Claude Code / Codex

| Surface | Claude Code | Codex | Hermes |
|---|---|---|---|
| Hook delivery | `.claude/settings.json` | gateway-level | shell hooks in `~/.hermes/config.yaml` |
| Pre-LLM context injection | n/a | n/a | **yes** — `pre_llm_call` surfaces approvals + policies every turn |
| Session ingest | `~/.claude/projects/*.jsonl` parser → `/api/code-sessions/ingest-jsonl` | n/a | per-turn live push → `/api/code-sessions/ingest-live` |
| Optimizer/alerts pass | inline at ingest time | n/a | triggered by `on_session_end` via `finalize: true` |
| Secret redaction in tool output | n/a (only in file writes) | n/a | **yes** — `transform_tool_result` redacts 10 secret-pattern families |
| Subagent tracking | turn-distributed in JSONL parse | n/a | dedicated `subagent_stop` hook → `action_type=subagent` |
| Slash commands | n/a | n/a | `/dashclaw-status`, `/dashclaw-approvals`, `/dashclaw-policies`, `/dashclaw-session` |
| CLI surface | `dashclaw` Node CLI | n/a | `hermes dashclaw doctor / status / setup / skills / policies` |

The live-ingest endpoint stores the same `code_sessions` schema as JSONL ingest, but additively (one append per turn). Weekly memos, subagent-ROI, and optimal-files manifests all work transparently — they read from `code_sessions` and don't care which path populated it.

## Cache locations

| Path | Purpose |
|---|---|
| `~/.dashclaw/hermes/prellm_<session>.json` | pre_llm_call state cache (5-min TTL) |
| `~/.dashclaw/hermes/session_<session>.json` | on_session_start metadata for on_session_end |
| `~/.dashclaw/hermes-hook-errors.log` | best-effort error log from all Hermes hooks |
| `~/.dashclaw/postllm-errors.log` | post_llm_call ingest errors |

All caches are session-scoped and harmless to delete.

## Known gaps

- **Token attribution from `post_llm_call`** is opportunistic: Hermes doesn't expose `usage` in the hook payload, so the adapter forwards whatever `usage` field appears on the last assistant message in `conversation_history`. Missing tokens are stored as `0`; cost-attribution dashboards degrade gracefully.
- **`pre_llm_call` context injection** is a 500-char ceiling. If you want longer briefings, register a skill that the model can pull on demand instead.
- **`transform_tool_result` redaction** is pattern-based and intentionally conservative. It catches the most common API-key shapes; it does not attempt heuristic entropy scoring.

## Files

- `plugin.yaml` — Hermes plugin manifest.
- `__init__.py` — `register(ctx)` entry that wires skills, slash commands, and the `hermes dashclaw` CLI.
- `hermes_config_snippet.yaml` — shell-hook declarations appended to `~/.hermes/config.yaml`.
- `../skills/` — shared skill directories (also used by Codex).
- `../.mcp.json` — MCP server wiring (shared).
- `../../.hermes/hooks/` — the eight Python hook adapters (project-local, gated by `HERMES_ENABLE_PROJECT_PLUGINS=true`).
- `../../scripts/install-hermes-plugin.{ps1,sh}` — one-shot installer.
