# Codex Review Agent

A Codex CLI example that asks Codex to review a code file for security issues and propose a fix. DashClaw governance fires on the file-write step because the target path matches the `auth` pattern in the standard risk mapping.

This example is the Codex parallel of `examples/claude-code-review-agent/`. The vulnerable target file (`sample-auth.js`) is identical; the difference is the agent harness — here we invoke Codex CLI directly with an `AGENTS.md` that teaches the governance protocol, rather than calling the DashClaw SDK from Node.js.

## What happens

1. Codex reads the governance protocol from `AGENTS.md` at session start.
2. Codex reads `sample-auth.js` and identifies a hardcoded secret.
3. Codex proposes a fix and prepares to write it.
4. Before the write, the DashClaw PreToolUse hook intercepts the `Edit` call. It builds an intel dict (file scanner flags `auth` content), then calls `dashclaw_guard` with action_type `security` and risk_score `75`.
5. DashClaw's policy returns `require_approval`.
6. The hook prints the approval URL to stderr; Codex pauses on `dashclaw_wait_for_approval`.
7. You approve from your phone (Discord or Telegram), or from `/decisions` in the browser.
8. The hook unblocks and the fix is written.

## Prerequisites

- Codex CLI installed (`codex` on PATH)
- Python 3.10+ on PATH (the PreToolUse hook is Python)
- A running DashClaw instance (local or cloud) with the `claude-code-starter` policy pack enabled — the same pack works for Codex, just rename or alias if you want a `codex-starter` for clarity.
- `DASHCLAW_BASE_URL` and `DASHCLAW_API_KEY` in your shell environment

## Setup

Run the one-command installer from a DashClaw checkout, pointing at this example directory:

```bash
cd /path/to/DashClaw
node cli/bin/dashclaw.js install codex --project examples/codex-review-agent
```

That command:

- copies the Python governance hooks into `~/.codex/hooks/dashclaw/`
- merges a managed block into `~/.codex/config.toml` that registers the DashClaw MCP server and the three hook events (PreToolUse, PostToolUse, Stop)
- merges the DashClaw governance protocol into `examples/codex-review-agent/AGENTS.md` (this directory)

Trust the new hooks in Codex:

```bash
codex hooks list
codex hooks trust ~/.codex/config.toml:pre_tool_use:0:0
codex hooks trust ~/.codex/config.toml:post_tool_use:0:0
codex hooks trust ~/.codex/config.toml:stop:0:0
```

## Run

From this directory:

```bash
codex exec "Review sample-auth.js for security issues and fix any you find."
```

What you should see:

```
[DashClaw] guarding: Edit sample-auth.js (security, risk=75)
[DashClaw] decision: require_approval — see https://<your-dashclaw>/decisions/act_xxx
[DashClaw] waiting for approval...
```

On approval the file is written; on denial Codex exits cleanly without modifying the file.

## Why governance fires

- File path `sample-auth.js` matches the `auth` pattern in DashClaw's file scanner.
- Action type `security` (auto-classified by the tool recognizer for files matching the auth pattern) combined with risk score `75` triggers the `require_approval` rule in the starter policy pack.

## See it in DashClaw

After approval, visit:

- `/decisions` — the action record with the full intel dict (file path, classification, declared goal)
- `/replay/<action_id>` — step-by-step trace of the guard decision
- `/activity` — the day-grouped feed showing your Codex session alongside any Claude Code sessions

## Backing out

To uninstall, delete the managed block in `~/.codex/config.toml` between the `# >>> dashclaw start` and `# <<< dashclaw end` markers. A `.dashclaw-bak` next to the config holds the pre-install state.
