# DashClaw Plugin — Multi-Target

This tree ships DashClaw governance as a single plugin source that installs
into three plugin ecosystems with separate manifest files:

| Ecosystem    | Manifest                              | MCP config          | Agent identity recorded |
| ------------ | ------------------------------------- | ------------------- | ----------------------- |
| Codex CLI    | `.codex-plugin/plugin.json`           | `.mcp.json`         | `codex`                 |
| Claude Code  | `.claude-plugin/plugin.json`          | `.mcp-claude.json`  | `claude-code`           |
| Hermes Agent | `.hermes-plugin/plugin.yaml`          | `.mcp.json`         | `hermes`                |

Both manifests reference the same shared content:

- `skills/dashclaw-governance/` — agent-neutral governance protocol skill
  (allow/warn/block/require_approval decision tree, session lifecycle,
  capability invocation patterns).
- `skills/dashclaw-platform-intelligence/` — DashClaw platform expert skill
  with API surface, route inventory, and troubleshooting playbooks.
  Snapshot-based — prefer `python -m livingcode query` for live state.

The MCP configs differ only by the `--agent-id` passed to the bundled
`@dashclaw/mcp-server`. Keeping the agent identity distinct per ecosystem
gives DashClaw's analytics (`/agents`, Mission Control posture, decision
ledger) clean separation between Codex, Claude Code, and Hermes sessions.

## Hooks

The **Claude Code** manifest bundles the governance hooks (PreToolUse /
PostToolUse / Stop guards over Bash, Edit, Write, MultiEdit, sub-agent spawns
(Agent/Task), and MCP tool calls (mcp__*)). They ship under
`plugins/dashclaw/hooks/` — `hooks.json` (declared via the manifest's `hooks`
field) plus the four Python scripts and the `dashclaw_agent_intel/` module,
referenced through `${CLAUDE_PLUGIN_ROOT}`. They fire automatically once the
plugin is enabled (no separate install, no per-folder trust gate) and require
Python on PATH. The `.py` scripts + module are a generated mirror of the
canonical `hooks/` tree, kept in sync by `npm run livingcode:refresh`; the
authored `hooks.json` is not generated.

The **Codex** manifest does not bundle hooks — Codex hooks are filesystem
artifacts in `~/.codex/config.toml`. Use `dashclaw install codex`.

The **Hermes Agent** surface ships under `.hermes-plugin/` with a
`plugin.yaml`, installer README, config snippet, and eight shell-hook adapters:
pre/post tool, pre/post LLM, session start/end, transform tool result, and
subagent stop. Hermes shares the same `skills/` directory and MCP server as the
Codex and Claude Code surfaces; the installer wires the hook block from
`hermes_config_snippet.yaml` into `~/.hermes/config.yaml`.

A standalone Claude Code installer (`node scripts/install-hooks.mjs`) remains
available as an alternative for installing the hooks into `.claude/settings.json`
without enabling the full plugin.
