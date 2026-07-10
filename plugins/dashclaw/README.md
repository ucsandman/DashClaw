# DashClaw plugin

Governance for your AI agents, packaged for one step install. It adds guard checks, action recording, approvals, policy discovery, and session tracking through the DashClaw MCP server, plus a skill that teaches the agent how to operate DashClaw.

This is a multi-target plugin: the same source installs into Claude Code, Codex CLI, and Hermes Agent, keeping the recorded agent identity separate per ecosystem.

## What you get

- **dashclaw-governance** skill: the governance protocol. When to call guard, how to read allow / warn / block / require_approval decisions, when to record actions, how to wait on approvals, and session lifecycle. Loads your org policies and capabilities from MCP at session start.
- **MCP server** (`@dashclaw/mcp-server`): the tool surface for guard checks, governed capability invocation, action recording, approval waits, policy discovery, and session start / end.

- **Governance hooks** (PreToolUse / PostToolUse / Stop guards over Bash, Edit, Write, MultiEdit, sub-agent spawns (Agent/Task), and MCP tool calls (mcp__*) — so Gmail/Stripe/Calendar MCP sends are governed too). The plugin now ships these and they fire automatically once the plugin is enabled. They require Python on PATH (see Prerequisites). A standalone installer remains available as an alternative (see below).

## Prerequisites

- Node.js 18+ on PATH (the MCP server runs via `npx -y @dashclaw/mcp-server`).
- A DashClaw instance and an API key, either self hosted or a hosted workspace.
- **Python on PATH** for the bundled governance hooks. The hook commands invoke `python`; on systems where the binary is `python3`, alias it or ensure `python` resolves. Without Python the hooks exit silently and govern nothing (MCP tools + skills still work).

## Install (Claude Code)

Add the marketplace, then install the plugin:

```bash
claude plugin marketplace add ucsandman/DashClaw
claude plugin install dashclaw@dashclaw
```

Or from inside a Claude Code session:

```text
/plugin marketplace add ucsandman/DashClaw
/plugin install dashclaw@dashclaw
```

Reload to activate, then confirm the MCP tools are live:

```text
/reload-plugins
/mcp
```

## Install (Codex and Hermes)

Codex uses the `.codex-plugin/` manifest and `.mcp.json` config:

```bash
dashclaw install codex --project <path>
```

Hermes Agent uses the `.hermes-plugin/` manifest plus eight shell-hook adapters declared in `hermes_config_snippet.yaml`:

```bash
./scripts/install-hermes-plugin.sh
# Windows: powershell -File scripts/install-hermes-plugin.ps1
```

## Configure

The MCP server reads its connection from environment variables:

| Variable | Purpose | Example |
| --- | --- | --- |
| `DASHCLAW_URL` | Base URL of your DashClaw instance | `https://your-workspace.example.com` |
| `DASHCLAW_API_KEY` | API key for the workspace | `oc_live_...` |
| `DASHCLAW_AGENT_ID` | Agent identity recorded for this session | `claude-code` |

Set these in your shell before launching, or add an `env` block to the plugin MCP config to pin them per install.

> **Heads-up on env-var names:** the MCP server reads `DASHCLAW_URL`, but the bundled hooks read `DASHCLAW_BASE_URL` (falling back to `DASHCLAW_URL`) — different name, same value, plus the same `DASHCLAW_API_KEY`. Set `DASHCLAW_BASE_URL` (or `DASHCLAW_URL`) + `DASHCLAW_API_KEY` in the environment Claude Code launches from, or the hooks exit silently and govern nothing.

## Use it

Both skills are model invoked, so the agent pulls them in automatically when a task matches. Prompts to try:

- "Instrument this agent with DashClaw."
- "Should this action need approval? Run it through guard first."
- "Debug this DashClaw guard decision."
- "Show me the open loops and recent governed decisions."

A fast health check is the `dashclaw_capabilities_list` tool, the lightest way to confirm the connection is up.

## Governance hooks (bundled — fire automatically)

The plugin ships the tool-layer governance hooks: PreToolUse / PostToolUse / Stop guards over Bash, Edit, Write, MultiEdit, sub-agent spawns (Agent/Task), and MCP tool calls (mcp__*). They are declared in `hooks/hooks.json` and reference the plugin root via `${CLAUDE_PLUGIN_ROOT}`, so they activate as soon as the plugin is enabled — **no separate install step, and no per-folder trust gate.** (A plugin's hooks are not gated by Claude Code's "trust this folder?" prompt the way a project `.claude/settings.json` is, so they fire out-of-the-box in fresh / Docker / headless sessions once the plugin is enabled.)

Requirements for the hooks to fire:

- **Python on PATH.** The hook commands run `node "${CLAUDE_PLUGIN_ROOT}/hooks/run_hook.cjs" dashclaw_pretool.py` (and posttool / stop) — a Node shim that probes for `python3`, then `python`, and runs the script with whichever resolves. Either interpreter name works; if neither is on PATH the hook is skipped with a notice.
- `DASHCLAW_BASE_URL` (or `DASHCLAW_URL` as a fallback) + `DASHCLAW_API_KEY` set in the environment Claude Code launches from. Without these the hooks exit silently.

### Alternative: the standalone installer

You can still install the hooks into `.claude/settings.json` (per project) or `~/.claude/settings.json` (global) with the repo's installer — useful if you want the hooks without enabling the full plugin, or want global governance over every project:

```bash
git clone https://github.com/ucsandman/DashClaw.git

# Per project (writes to that project's .claude/settings.json):
node /path/to/DashClaw/scripts/install-hooks.mjs --target=/path/to/your/project

# OR govern EVERY project at the user level (incl. fresh clones / Docker /
# headless) — installs into ~/.claude/settings.json with no secret written:
node /path/to/DashClaw/scripts/install-hooks.mjs --global --governance
```

The installer paths also require Python on PATH plus the same env vars. **Folder-trust note (installer only):** a project `.claude/settings.json` loads only after you accept Claude Code's "trust this folder?" prompt, so in a fresh/Docker/headless session per-project installer hooks won't fire — use `--global --governance`, or just rely on the bundled plugin hooks above (which have no trust gate).

## Troubleshooting

- **MCP tools listed but every call returns 503 `SCHEMA_NOT_INITIALIZED`.** Your instance is on a stale schema. Run `npm run db:migrate` against it, then retry. (Instances older than v4.61.0 answer this as a misleading 401.)
- **Tools don't appear after install.** Run `/reload-plugins`, then `/mcp`, and confirm `DASHCLAW_URL` + `DASHCLAW_API_KEY` are set in the environment the MCP server launches from.
- **MCP works but the hooks govern nothing.** The bundled hooks need Python on PATH and `DASHCLAW_BASE_URL` (or `DASHCLAW_URL`) + `DASHCLAW_API_KEY` in the environment Claude Code launched from — without either they exit silently. The hooks launch via a Node shim (`hooks/run_hook.cjs`) that probes `python3` then `python`, so confirm `python3 --version` or `python --version` resolves and that the plugin is enabled (`/reload-plugins`). If you used the standalone installer instead, a per-project `.claude/settings.json` also has to pass Claude Code's folder-trust gate — the bundled plugin hooks do not.
- **Guard always allows, or you see a demo-mode warning.** `DASHCLAW_BASE_URL` points at the demo instance. Set it to your real instance.
- **Fastest connectivity check.** Call the `dashclaw_capabilities_list` tool — the lightest way to confirm the connection is up.

## Validate before sharing

```bash
claude plugin validate ./plugins/dashclaw
```

## Links

- Homepage: https://dashclaw.io
- Docs: https://dashclaw.io/docs
- Repository: https://github.com/ucsandman/DashClaw
- License: MIT
