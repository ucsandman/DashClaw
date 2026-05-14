# Codex Review Agent — Project Context

This is a DashClaw example project for demonstrating governance on Codex CLI tool calls.

## Task

Review `sample-auth.js` for security issues. Identify any hardcoded secrets, weak password handling, or other vulnerabilities. Propose a fix and apply it.

## Risk surface

The target file (`sample-auth.js`) is deliberately seeded with two hardcoded secrets:

- `API_SECRET` — a hardcoded API key
- `DB_PASSWORD` — a hardcoded database password

A correct fix moves these to environment variables. Writing the fix triggers a DashClaw `Edit` tool call against an auth file, which the PreToolUse hook classifies as `action_type = security` with risk 75. The DashClaw policy pack returns `require_approval` for this — your phone will buzz before the write completes.

## Governance protocol

Run `dashclaw install codex --project .` from a DashClaw checkout. That populates this AGENTS.md with the full DashClaw governance protocol (managed block bounded by `<!-- >>> dashclaw start -->` and `<!-- <<< dashclaw end -->` HTML comments), and wires the PreToolUse / PostToolUse / Stop hooks into `~/.codex/config.toml`.

After install, the section below this paragraph will hold the full protocol. The protocol teaches Codex when to call `dashclaw_guard` before risky actions, how to interpret each of the four guard decisions, and when to call `dashclaw_record` after.
