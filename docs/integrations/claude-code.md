# Governing Claude Code

The highest-leverage integration: DashClaw hooks intercept every consequential Claude Code tool call — `Bash`, `Edit`, `Write`, `MultiEdit`, sub-agent spawns, and every `mcp__*` tool — with semantic classification, risk scoring, and per-turn token capture. No SDK calls in your agent code, no repo clone.

This is a **mechanical** enforcement surface: in enforce mode, a `block` decision halts the tool before it runs (`PreToolUse` exit 2), and an unreachable DashClaw instance fails closed. See the [enforcement boundary](../architecture/enforcement-boundary.md).

## Install

```bash
npm i -g @dashclaw/cli
dashclaw install claude            # prompts for endpoint + API key; fresh installs default to enforce
dashclaw install claude --observe  # start in observe mode instead (log, never hold)
dashclaw install claude --trial    # no instance yet? browser signup on hosted.dashclaw.io, paste the key
```

What the installer does, in order:

1. **Preflights** the instance (`/api/health` plus an authenticated read) — nothing is written until that passes.
2. Downloads the hooks bundle from your instance, resolves `python3`/`python` automatically.
3. Merges managed hook entries into `~/.claude/settings.json` (with a `.dashclaw-bak` backup; reinstall replaces cleanly) — including a `SessionStart` enforcement-liveness probe when the bundle ships one.
4. Writes credentials to `~/.dashclaw/claude-hooks/.env` (mode 600) — no secret lands in `settings.json`. A genuinely fresh install sets `DASHCLAW_HOOK_MODE=enforce` and `DASHCLAW_APPROVAL_TIMEOUT=120`.

Working from a repo checkout instead, `npm run hooks:install` does the same wiring. Full hook internals: [`hooks/README.md`](../../hooks/README.md).

## Enforce by default; observe is the opt-out

A **fresh** install starts in **enforce mode** with the catastrophe pack live: `block` halts the tool mechanically and `require_approval` holds it until you approve (dashboard, CLI, phone, or Telegram — see [Operating DashClaw](../operations.md#approvals)), then the paused tool call resumes the moment you approve. A **re-install always preserves the existing mode** and approval timeout — it never clobbers a choice you made.

Two ways to step down to observe (log everything, hold nothing): pass `--observe` at install, or edit `~/.dashclaw/claude-hooks/.env` after:

```bash
DASHCLAW_HOOK_MODE=observe
```

The hook's approval wait window is `DASHCLAW_APPROVAL_TIMEOUT` (seconds). The global default is 30, but fresh installs write **120** so a first-time human has time to find `/approvals` before the hold times out.

### Enforcement-liveness probe

The installed `SessionStart` hook runs a probe at the start of each Claude Code session (self-throttled to once every 12 hours, detached). It drives one synthetic held action through the same hook path a live agent uses and confirms it was not executed — the verdict renders on `/setup`. It never touches your action or guard ledgers.

## Policies: the catastrophe pack is seeded for you

A fresh self-hosted instance seeds the **catastrophe-only** pack at its first migrate (`npm run db:migrate`, `npx dashclaw up`, or the Vercel deploy build): mass-destructive operations are blocked, secret-file writes are held for approval, and a warn-only rate limit nets runaways. Enforce mode holds from action one. Want broader gates (network calls, package installs)? Click **Import** on the `claude-code-starter` pack at `/policies` — that also retrofits any pre-M1 instance whose org predates the seed. Hosted trial workspaces come with `claude-code-starter` pre-seeded. What's in each pack and why: [policy modes](../policy-modes.md).

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
