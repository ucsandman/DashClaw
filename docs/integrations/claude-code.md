# Governing Claude Code

The highest-leverage integration: DashClaw hooks intercept every consequential Claude Code tool call — `Bash`, `Edit`, `Write`, `MultiEdit`, sub-agent spawns, and every `mcp__*` tool — with semantic classification, risk scoring, and per-turn token capture. No SDK calls in your agent code, no repo clone.

This is a **mechanical** enforcement surface: in enforce mode, a `block` decision halts the tool before it runs (`PreToolUse` exit 2), and an unreachable DashClaw instance fails closed. See the [enforcement boundary](../architecture/enforcement-boundary.md).

## Install

```bash
npm i -g @dashclaw/cli
dashclaw install claude            # prompts for endpoint + API key
dashclaw install claude --trial    # no instance yet? browser signup on hosted.dashclaw.io, paste the key
```

What the installer does, in order:

1. **Preflights** the instance (`/api/health` plus an authenticated read) — nothing is written until that passes.
2. Downloads the hooks bundle from your instance, resolves `python3`/`python` automatically.
3. Merges managed hook entries into `~/.claude/settings.json` (with a `.dashclaw-bak` backup; reinstall replaces cleanly).
4. Writes credentials to `~/.dashclaw/claude-hooks/.env` (mode 600) — no secret lands in `settings.json`.

Working from a repo checkout instead, `npm run hooks:install` does the same wiring. Full hook internals: [`hooks/README.md`](../../hooks/README.md).

## Observe first, then enforce

The installer starts in **observe mode**: every tool call is guarded, scored, and logged to your decisions ledger, but nothing is blocked. Run like this for a day and look at `/decisions` — you will know exactly what enforcing will interrupt before it interrupts anything.

Flip to enforce by editing `~/.dashclaw/claude-hooks/.env`:

```bash
DASHCLAW_HOOK_MODE=enforce
```

In enforce mode, `block` halts the tool mechanically and `require_approval` holds it until you approve (dashboard, CLI, phone, or Telegram — see [Operating DashClaw](../operations.md#approvals)). The hook's approval wait window is configurable via `DASHCLAW_APPROVAL_TIMEOUT` (seconds, default 30).

## Seed the starter policies

A fresh self-hosted instance has no policies, so observe mode logs everything and enforce mode blocks nothing. Import the `claude-code-starter` pack from `/policies` on your instance (or run `node scripts/seed-claude-code-starter.mjs` from a checkout). Hosted trial workspaces come with the pack pre-seeded. What's in it and why: [policy modes](../policy-modes.md).

## Verify it fires

Pipe a fake tool call through the hook. A clean exit — and a guard evaluation when DashClaw is reachable — confirms the wiring:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"echo hello"},"tool_use_id":"test_001","session_id":"smoke"}' | python .claude/hooks/dashclaw_pretool.py
```

Then open `/decisions` on your instance: the evaluation should be the newest row. If nothing arrives, set `DASHCLAW_HOOK_DEBUG=1` in the hooks `.env` and re-run — the hook writes breadcrumbs. More failure modes: [troubleshooting](../troubleshooting.md).

## What identity your sessions get

- **Per-harness identity.** The installer writes an explicit agent id onto each hook command, so Claude Code, Codex, and Hermes on one machine report as three distinct agents in Mission Control.
- **Sub-agents are first-class.** Spawned sub-agents appear as their own fleet identities (e.g. `claude-code:explore`) grouped under their parent in `/agents`, inheriting its permissions, targeted policies, and spend budgets.
- **Sessions are joined from evidence.** Every action carries its harness session id; a multi-agent fan-out reads as one governed unit with per-leaf attribution on the `/agents` Fan-outs panel.

## What you get beyond guard/record

- **Per-turn token and cost capture** — `dashclaw cost` prints your Claude Code spend from the terminal; `/analytics` prices the fleet.
- **Coverage truth** — the Stop hook reports expected-vs-recorded tool-use counts per turn, rendered as a Coverage column on `/agents` with an explicit "no evidence" state. Silence never reads as health.
- **Assumption alerts** — if an operator invalidates an assumption your agent recorded, the warning rides the next guard call and the pretool hook surfaces and acknowledges it.
- **Code Sessions** — ingest transcripts (`dashclaw code ingest`), get spend pricing, optimizer signals, and an Optimal Files bundle applied via `dashclaw code apply`.

## The plugin alternative

Prefer plugin distribution? [`plugins/dashclaw/`](../../plugins/dashclaw/) ships the same governance as a Claude Code plugin: bundled MCP server, hooks, and the two skills (`dashclaw-governance` protocol + `dashclaw-platform-intelligence` reference). The hooks path above and the plugin land in the same place — pick one, not both.

## Uninstall

Reinstalling replaces the managed hook entries; the original `settings.json` is preserved at `~/.claude/settings.json.dashclaw-bak`. Removing the managed entries and deleting `~/.dashclaw/claude-hooks/` fully de-governs the machine.
