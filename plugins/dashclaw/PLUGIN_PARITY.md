# DashClaw Plugin — Dual-Target

This tree ships DashClaw governance as a single plugin source that installs
into two plugin ecosystems with separate manifest files:

| Ecosystem    | Manifest                              | MCP config          | Agent identity recorded |
| ------------ | ------------------------------------- | ------------------- | ----------------------- |
| Codex CLI    | `.codex-plugin/plugin.json`           | `.mcp.json`         | `codex`                 |
| Claude Code  | `.claude-plugin/plugin.json`          | `.mcp-claude.json`  | `claude-code`           |

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
ledger) clean separation between Codex sessions and Claude Code sessions.

## What the plugin does NOT install

Hooks (PreToolUse / PostToolUse / Stop guards over Bash, Edit, Write, and
MultiEdit) are **not** bundled in either manifest. They are agent-specific
filesystem artifacts that live in `~/.codex/config.toml` (Codex) or
`.claude/settings.json` (Claude Code) respectively, and require Python on
PATH. Use the dedicated installer commands instead:

- Codex: `dashclaw install codex` (Phase 1 of Codex parity)
- Claude Code: `node scripts/install-hooks.mjs`
