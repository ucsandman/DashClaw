# Agent identity & attribution v2 ("who is asking") — roadmap v2.2

Status: DRAFT → ratified by ship. Owner roadmap: `docs/plans/owner-roadmap.md` §v2.2.
Depends on: RFC `docs/rfcs/2026-06-01-subagent-fleet-identities.md` (step 1 shipped).

## Problem

The item-2 live audit's second finding: Wes couldn't tell who was asking for
approval — every agent on the machine reported the same identity ("codex").
Root-cause mechanics, verified against source 2026-07-02:

1. **The `.env` loader gives the inherited environment precedence.**
   `hooks/dashclaw_pretool.py:39` (`if key and key not in os.environ`) means
   one machine-wide `DASHCLAW_AGENT_ID` export silently overrides every
   installer-written per-harness `.env`. The Claude installer *does* write
   `DASHCLAW_AGENT_ID=claude-code` into `~/.dashclaw/claude-hooks/.env`
   (`cli/lib/claude/install.js:328-329`), but a global export beats it —
   that is the audit bug.
2. **The Codex installer never wires hook identity at all.** `dashclaw
   install codex` passes `--agent-id codex` only to the MCP server
   (`cli/lib/codex/install.js:212`); the PreToolUse/PostToolUse/Stop hook
   lines (`:214-230`) carry no identity and no `.env` is written into
   `~/.codex/hooks/dashclaw/`. Codex hook governance therefore reports the
   hardcoded `"claude-code"` default (`hooks/dashclaw_pretool.py:95`) or the
   stray global export — never reliably `"codex"`.
3. **The Hermes shims use `env.setdefault`**
   (`.hermes/hooks/dashclaw_pretool_hermes.py:47-48`), so a global export
   overrides `"hermes"` too.

Two adjacent debts fold in (roadmap bullets 2–3):

- **Subagent fleet identities** (RFC step 1) sit behind default-off
  `DASHCLAW_SUBAGENT_IDENTITY=provenance`. The server `baseAgentId()`
  fallback is live on the critical lookups (`app/lib/guard.ts:1539`,
  `agents.repository.ts:452-455`, `pairing-request.ts:76-92`) and pinned by
  tests, but `/agents` renders composed ids flat, and
  `agentExistsInOrg` (`agents.repository.ts:37-66`) has no base fallback.
- **x402 attribution** is plumbed end-to-end (`x402_purchases.agent_id`
  populated by `createPurchase`, agent-scoped budgets in
  `x402BudgetDecision`, per-agent UI on `/spend/x402`) — but the *value*
  arriving is the same flat machine-wide id, agent-scoped budgets do **not**
  roll composed subagent ids up to their parent (`sumWindowSpend` filters
  `agent_id = $id` exactly, `x402.repository.ts:283-290`), and the
  `(org_id, agent_id, created_at)` index that migration 0036's own comment
  deferred was never added.

## Design decisions

A rejected alternative first, because it looks obvious: flipping `.env`
precedence (hook-local file beats inherited env). It cannot work for the
dominant topology — the user-level install (`scripts/install-hooks.mjs`)
points every harness's hook command at **this repo's `hooks/` by absolute
path** (`install-hooks.mjs:276-284`), so all harnesses share one script
directory and one adjacent `.env.local`. A file-based rule cannot
distinguish harnesses that share the file. The harness declaration has to
ride the one channel that is genuinely per-harness: the hook command line
each integration writes.

### D1 — hooks accept `--agent-id`; argv beats env

The identity-reading hook scripts (`dashclaw_pretool.py`,
`dashclaw_stop.py`, `dashclaw_session_digest.py`; `dashclaw_posttool.py`
ignores argv but tolerates the flag) resolve identity in this order:

1. `--agent-id <id>` argv flag — the harness integration's explicit
   declaration, written by the installer that knows which harness it is
   wiring.
2. `DASHCLAW_AGENT_ID` from the environment (including the `.env` walk) —
   legacy behavior, byte-for-byte unchanged for installs without the flag.
3. The hardcoded harness default (`"claude-code"`).

`run_hook.cjs` already forwards extra argv (`run_hook.cjs:42`), so the
plugin launcher path needs no change. The Claude Code plugin's own
`hooks.json` stays flag-less on purpose: its hardcoded default
(`claude-code`) is already the correct harness identity there.

### D2 — every installer writes the flag

- `cli/lib/claude/install.js` `buildHookEntries` appends
  `--agent-id "<agentId>"` (the id the installer already collects, default
  `claude-code`) to each hook command in `~/.claude/settings.json`. The
  hook-local `.env` keeps `DASHCLAW_AGENT_ID` for SDK/config consumers.
- `scripts/install-hooks.mjs` `globalGovernanceBlocks` and
  `globalStopCommand` append `--agent-id claude-code` — the user-level
  install is by definition the Claude Code harness.
- `cli/lib/codex/install.js` `buildConfigTomlBlock` appends
  `--agent-id codex` to the three hook command lines (the MCP server line
  already carries it — `:212`). No `.env` is written: the Codex installer
  never collects credentials, and identity no longer needs a file.

Migration: re-running any installer (all idempotent, managed-block based)
adds the flag. Un-migrated installs keep exact legacy behavior (level 2).

### D3 — Hermes shims declare identity via argv

`.hermes/hooks/dashclaw_pretool_hermes.py` / `dashclaw_posttool_hermes.py`
replace `env.setdefault("DASHCLAW_AGENT_ID", "hermes")` with an explicit
`--agent-id` argv on the subprocess call, valued
`DASHCLAW_HERMES_AGENT_ID or "hermes"`. This survives both the shared
`.env.local` and a machine-wide export. The Hermes-native hooks
(`dashclaw_common.py`, `dashclaw_postllm_hermes.py`) prefer
`DASHCLAW_HERMES_AGENT_ID` over the generic var, keeping the generic
fallback for operators who configured it deliberately (documented in the
Hermes config snippet).

### D4 — flip `DASHCLAW_SUBAGENT_IDENTITY` default to `distinct`

RFC rollout step 3, due in this minor release. Default flips in all shipped
hook copies (`hooks/`, `plugins/dashclaw/hooks/`; `.claude/hooks/` is the
installed copy of `hooks/`). Rollback stays one env var
(`DASHCLAW_SUBAGENT_IDENTITY=provenance`). Validation before the flip:
hook integration tests (both modes) plus a composed-id scenario in
`scripts/policy-smoke.mjs` proving the permission fallback live —
the roadmap's acceptance pin.

With composed ids becoming the norm, `agentExistsInOrg`
(`agents.repository.ts:37-66`) gets the `baseAgentId` fallback so composed
ids aren't treated as unknown agents. `identity.ts` JWKS lookup stays
exact-match **deliberately**: a JWT's `sub` is the enrolled identity;
composed hook ids never present JWTs (RFC-acknowledged edge case).

### D5 — `/agents` groups sub-agents under their parent

Composed ids render indented under their base agent (derive via
`baseAgentId`), presentational only — no query change
(`listAgentsForOrg` already returns them as rows). Design per
`.impeccable.md` tokens; no new route.

### D6 — x402 agent-scoped budgets bind to the identity family

`x402BudgetDecision` and `verifyX402BudgetAfterInsert` normalize the budget
identity to `baseAgentId(context.agent_id) ?? context.agent_id` and
`sumWindowSpend` gains family matching for the budget path:
`(agent_id = $base OR agent_id LIKE $base || ':%')`. A parent-scoped
budget therefore captures its sub-agents' spend; a sub-agent cannot escape
the family budget by virtue of its composed id. Sub-agent-specific budgets
(exact composed-id scope) are explicitly **not** supported — documented,
mirroring the RFC's "`:` is reserved" rule. UI/aggregation paths keep exact
filtering (they enumerate the distinct ids on purpose).

### D7 — the deferred index

New migration (drizzle/0038): `idx_x402_purchases_org_agent_created
(org_id, agent_id, created_at)` on `x402_purchases` — the follow-through
migration 0036's own comment deferred. It serves the exact-identity arm of
the family match and the `/spend/x402` agent filter; the `LIKE '<base>:%'`
sub-agent arm resolves as a filter within 0036's (org_id, created_at)
bounds — x402 volume is low, so no `text_pattern_ops` index is warranted.

## Not in scope

- A `harness` field on the guard payload (identity value IS the fix; a
  provenance field can ride a later item if /approvals needs richer display).
- Credential (API key) wiring for Codex hooks (D2 note).
- Hermes composed-subagent identities (Hermes has its own `subagent_stop`
  ROI model; the RFC mechanism is Claude Code-scoped).
- Python/Node SDK constructor changes — SDK callers already pass explicit
  identity; `connectPrompt.ts` guidance stays.

## Acceptance (from the roadmap)

1. Two different local harnesses appear as two identities live: proven by
   hook-level integration tests (a machine-wide `DASHCLAW_AGENT_ID` export
   present; a hook invoked with `--agent-id claude-code` reports
   `claude-code`, one with `--agent-id codex` reports `codex`, the Hermes
   shim passes `hermes`) + live /approvals check after re-running the
   installers on the dev machine.
2. The composed-identity permission fallback stays pinned by smoke: new
   policy-smoke scenario — a composed id inherits the parent's permission
   level through guard, and an agent-scoped x402 budget captures a
   composed child's spend.
3. `/agents` shows sub-agents grouped under their parent (rendered proof
   via frontend-verify).
