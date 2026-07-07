# DashClaw Plugin — Multi-Target

This tree ships DashClaw governance as a single plugin source that installs
into three plugin ecosystems with separate manifest files, plus a fourth
consumer surface (Claude Desktop) that connects remotely instead of
installing anything:

| Ecosystem      | Manifest                       | MCP config                       | Agent identity recorded |
| -------------- | ------------------------------ | -------------------------------- | ----------------------- |
| Codex CLI      | `.codex-plugin/plugin.json`    | `.mcp.json`                      | `codex`                 |
| Claude Code    | `.claude-plugin/plugin.json`   | `.mcp-claude.json`               | `claude-code`           |
| Hermes Agent   | `.hermes-plugin/plugin.yaml`   | `.mcp.json`                      | `hermes`                |
| Claude Desktop | none (OAuth custom connector)  | remote `type: http` → `/api/mcp` | `claude-desktop`        |

The three manifests reference the same shared content:

- `skills/dashclaw-governance/` — agent-neutral governance protocol skill
  (allow/warn/block/require_approval decision tree, session lifecycle,
  capability invocation patterns).
- `skills/dashclaw-platform-intelligence/` — DashClaw platform expert skill
  with API surface, route inventory, and troubleshooting playbooks.
  Snapshot-based — prefer `python -m livingcode query` for live state.

The MCP configs differ only by the `--agent-id` passed to the bundled
`@dashclaw/mcp-server`. Keeping the agent identity distinct per ecosystem
gives DashClaw's analytics (`/agents`, Mission Control posture, decision
ledger) clean separation between Codex, Claude Code, Hermes, and Desktop
sessions.

**Version lockstep:** the three ecosystem manifests describe one plugin source
and must carry the same version — `npm run version:sync:check` (CI + the
pre-commit hook) fails when they drift. The Desktop plugin builder
(`scripts/build-desktop-plugin.mjs`) reads its version from the Claude Code
manifest, so it can't drift independently.

## Hooks

The **Claude Code** manifest bundles the governance hooks (PreToolUse /
PostToolUse / Stop guards over Bash, Edit, Write, MultiEdit, sub-agent spawns
(Agent/Task), and MCP tool calls (mcp__*)). They ship under
`plugins/dashclaw/hooks/` — `hooks.json` (declared via the manifest's `hooks`
field) plus the Python scripts and the `dashclaw_agent_intel/` module,
referenced through `${CLAUDE_PLUGIN_ROOT}`. They fire automatically once the
plugin is enabled (no separate install, no per-folder trust gate) and require
Python on PATH. The `.py` scripts + module are a generated mirror of the
canonical `hooks/` tree, kept in sync by `npm run livingcode:refresh`; the
authored `hooks.json` is not generated.

The **Codex** manifest does not bundle hooks — Codex hooks are filesystem
artifacts in `~/.codex/config.toml`. Use `dashclaw install codex`, which wires
PreToolUse / PostToolUse / Stop / SessionStart with an explicit `--agent-id
codex` and ships four hook scripts: `dashclaw_pretool.py`,
`dashclaw_posttool.py`, `dashclaw_stop.py`, and `enforcement_liveness_probe.py`
for the SessionStart enforcement-liveness probe (which replaced the retired
Code-Sessions reporter and SessionStart-digest hooks in the v5 cull). The
SessionStart hook was verified live once the lifecycle was confirmed: the
installed codex-cli 0.139.0 binary's hook-event enum contains `SessionStart`
(PascalCase in `config.toml`, same convention as the other three), and a live,
trusted `session_start` hook registered by an unrelated tool was observed
firing in this machine's `~/.codex/config.toml` (2026-07-04). **Known delta vs
Claude Code** (explicit decision, not an oversight): there is no JSONL
transcript parser (Codex session ingest rides the `notify` integration
instead). Consequence since v4.2 coverage truth: the Stop hook's per-turn
coverage report (`POST /api/coverage`, expected-vs-recorded from the
transcript's `tool_use` blocks) has no ground-truth source on Codex, so
Codex agents render the "no evidence" coverage state on `/agents`. The
server-side outcome-coverage dimension (`action_records.close_source`)
covers Codex regardless.

The **Hermes Agent** surface ships under `.hermes-plugin/` with a
`plugin.yaml`, installer README, config snippet, and six shell-hook adapters:
pre/post tool, pre-LLM, session start, transform tool result, and
subagent stop. Hermes shares the same `skills/` directory and MCP server as the
Codex and Claude Code surfaces; the installer wires the hook block from
`hermes_config_snippet.yaml` into `~/.hermes/config.yaml`. Identity comes from
`DASHCLAW_HERMES_AGENT_ID` (default `hermes`), which beats the machine-ambient
`DASHCLAW_AGENT_ID`. Hermes-only capabilities (secret redaction of tool output,
per-turn pre-LLM context injection) exist because
Hermes exposes lifecycle events the other harnesses don't — see the "How it
differs" table in `.hermes-plugin/README.md`.

**Claude Desktop** cannot run local hooks at all — consumer chat has no
tool-interception layer, so governance there is **cooperative** (the model,
guided by the governance skill, calls `dashclaw_guard` before acting), never a
hard kernel block. The canonical per-surface enforced-vs-cooperative table —
and the recorded decision that a universal enforcing proxy for such surfaces
is killed — is `docs/architecture/enforcement-boundary.md`. Desktop connects via the OAuth custom connector (paste
`https://<instance>/api/mcp` under Settings → Connectors; the hosted route pins
the `claude-desktop` server-level identity for OAuth callers). The two skills
can additionally be loaded via the plugin marketplace ZIP built by
`scripts/build-desktop-plugin.mjs`. Full walkthrough:
`docs/CLAUDE-DESKTOP-PLUGIN.md`.

A standalone Claude Code installer (`node scripts/install-hooks.mjs`) remains
available as an alternative for installing the hooks into `.claude/settings.json`
without enabling the full plugin.
