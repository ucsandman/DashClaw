# DashClaw v5.0.0 — migration notes

v5.0.0 removes every surface that was not on the governance loop
(**intercept → decide → approve → prove**) or directly supporting it. See
[`THESIS.md`](../../THESIS.md) for the product definition and the
[kill ledger](2026-07-07-v5-kill-ledger.md) for the exhaustive, recoverable-by-SHA
list of what was removed.

## TL;DR

- **If you only use the governance core, nothing changes.** Guard, action
  recording, assumptions, approvals, halt, posture, sessions, identity/pairing,
  signals, policies, and signed evidence all survive with the same shapes.
- **If you used a platform-tier feature (workflows, knowledge, learning, prompts,
  scoring, reputation, drift, compliance, x402/finops, managed secrets, code
  sessions, messaging), it is gone by design.** Those were a different product.
  Most have no in-DashClaw replacement — the guidance is "do it in your own stack
  and *govern* the resulting tool calls through DashClaw."
- **The deprecated `dashclaw/legacy` Node SDK subpath is removed** (its removal
  was promised for v5). Move to the canonical `dashclaw` client.
- **Existing databases keep working.** No table was dropped. Retired tables stay
  in place; a documented export-then-drop path (below) can follow later.

## What survives (the governance core)

**Node & Python SDK:** `guard` / `runGoverned` / `guardedFetch`; `createAction` /
`updateOutcome` / `getAction` / `getActionGraph` / `reportActionOutcome`
(+Success/Failure/Partial) / `getActionOutcome`; `getPendingApprovals` /
`approveAction` / `waitForApproval`; `recordAssumption`; `createPairing` /
`waitForPairing` / identity registration; `scanPromptInjection`; `getSignals`;
session CRUD; `deriveIdempotencyKey` / `action_context`; `getGuardDecisions`;
`simulatePolicy` / `testPolicies` / `getProofReport` / `importPolicies`.

**MCP tools (12):** `dashclaw_guard`, `dashclaw_record`, `dashclaw_invoke`,
`dashclaw_capabilities_list`, `dashclaw_policies_list`, `dashclaw_wait_for_approval`,
`dashclaw_session_start`, `dashclaw_session_end`, `dashclaw_session_retro`,
`dashclaw_assumption_record`, `dashclaw_decisions_recent`, `dashclaw_pair` (plus
the DashClaw-gated `dashclaw_status`, `dashclaw_recent_decisions`,
`export_dashclaw_evidence`). **MCP resources (3):** `dashclaw://policies`,
`dashclaw://agent/{id}/history`, `dashclaw://status`.

**CLI (13):** `up`, `down`, `install`, `doctor`, `import`, `approvals`, `approve`,
`deny`, `logout`, `codex`, `halt`, `help`, `version`.

## Removed surfaces → what to do instead

| Removed (SDK family / MCP tool / route group) | What to do instead |
|---|---|
| **Workflows / work-orders / swarm** (`/api/workflows/**`, `/api/work-orders/**`, `/api/swarm/*`; `dashclaw_work_order_*`; SDK workflow/work-order families) | Orchestrate in your own runner or agent framework. Govern each resulting tool call through `guard` / the PreToolUse hook. DashClaw governs goals; it does not run them. |
| **Prompts library** (`/api/prompts/{templates,versions,render,runs,stats}`; SDK prompt family) | Manage prompts in your repo or prompt tool. The raw connect/setup/sdk-coverage prompt routes (marketing "copy prompt") are unaffected. |
| **Knowledge / RAG** (`/api/knowledge/collections/**`; SDK knowledge family) | Use a dedicated vector store (pgvector, etc.) in your stack. |
| **Learning + behavior + policy-coach** (`/api/learning*`, `/api/behavior/*`; `dashclaw_learning_*`, `dashclaw_behavior_suggestions`; SDK learning family) | Policy tuning survives as the **calibration controller** — mined interruption proposals ratified with one click in `/policies`. That is the on-thesis replacement for behavior-driven suggestions. |
| **Model-strategies / BYOK** (`/api/model-strategies/*`, `/api/settings/llm-status`; SDK model-strategy family) | Choose models in your own client. Guard's `predictive-risk` (statistical, no BYOK key) is unaffected. |
| **Scoring + evaluations** (`/api/scoring/**`, `/api/evaluations/**`; SDK scoring/eval families) | Run evals in your CI/eval harness. Guard **calibration** (a different subsystem) survives; `/api/policies/test` + `guardrails/evaluator` survive. |
| **Code sessions / optimal-files / skill-scan** (`/api/code-sessions/**`, `/api/skills/scan`; `dashclaw_optimal_files_*`, `dashclaw_skill_scan`; CLI `code`) | No replacement — out of scope. Prompt-injection scanning (`scanPromptInjection`, `/api/security/prompt-injection`) and session-retro defensibility survive. |
| **Messages / threads / handoffs / loops** (`/api/messages/{threads,attachments}`, `/api/handoffs*`, `/api/actions/loops*`; `dashclaw_inbox_list`, `dashclaw_messages_mark_read`, `dashclaw_handoff_*`, `dashclaw_loop_*`; SDK messages/handoffs/loops families; `actionContext.sendMessage`; CLI `inbox`) | Out of scope. **The assumption-ack path survives:** `/api/messages` GET/PATCH still delivers assumption-alert acks; `recordAssumption` + the pretool ack are unchanged. |
| **Reputation / leaderboard + routing** (`/api/reputation/**`, `/api/cron/routing-maintenance`; SDK reputation + legacy routing families) | Out of scope. The tamper-evident audit trail (signed receipts) is the surviving "who did what" record. |
| **Drift engine** (`/api/drift/**`; SDK drift family) | Out of scope. Risk **signals** (`getSignals`, `/api/signals`) survive for decision-surfacing. |
| **Compliance cockpit** (`/api/compliance/**`; SDK compliance family) | **Folded into Prove:** `/api/artifacts/evidence-bundle` now returns a **signed** bundle; verify independently via `/api/integrity/{jwks,verify}`. Framework-mapping reports are gone; the signed audit trail is the evidence. |
| **x402 / FinOps / billing / plan-quota** (`/api/x402/**`, `/api/finops/spend`, `/api/usage*`, `/api/billing/*`, `/api/webhooks/stripe`, `/api/cron/reset-meters`; `x402_spend_limit` policy; SDK x402 family; CLI `cost`) | Spend governance is a **separate thesis** (RFC 0002, gated) and out of this repo. Track spend in your own FinOps tool. |
| **Managed secrets** (`/api/secrets/**`; `dashclaw_secret_*`; `getAgentEnv`; CLI `env`) | Use your platform's secret manager. `getAgentEnv` has no replacement. |
| **Status-widget PWA** (`/api/widget/summary`, `/widget`) | Use the Approvals inbox / `/decisions`. |
| **Capability registry CRUD/UI** (`/api/capabilities/{[id],access,health,history,test}`, `POST /api/capabilities`, `/api/agents/registry*`, `/api/agents/invoke`; SDK capabilities/agent-registry families; `dashclaw://capabilities`) | **The enforcement seam survives:** `dashclaw_invoke`, `GET /api/capabilities`, `/api/capabilities/[id]/invoke`, and `/api/capabilities/[id]/access/check` still enforce governance on invocation. Note: `POST /api/capabilities` came back in **5.33.0** (admin-only, create only, 201/400/409) because credential custody needs a registration path that is not raw SQL; there is still no page and no update/delete/health. |
| **Fleet / observability / posture / team-RBAC** (`/api/agents` roster, `/api/analytics`, `/api/operations/feed`, `/api/posture/**`, `/api/team/**`; `dashclaw_posture*`; SDK `heartbeat`/`reportConnections`) | Out of scope — LangSmith/Langfuse *record*; DashClaw *prevents*. Fleet **attribution** (`/api/agents/fanouts`) and the audit ledger survive. |

## Legacy SDK subpath removal (breaking)

The `dashclaw/legacy` Node subpath (the v1 platform SDK, deprecated since v4.x
with removal promised at v5) is **deleted**. The `./legacy` export is gone from
`sdk/package.json` and `sdk/legacy/**` no longer exists.

- Replace `require('dashclaw/legacy')` / `import … from 'dashclaw/legacy'` with the
  canonical `dashclaw` client.
- The `OpenClawAgent` alias and the Python `dashclaw[langchain]` optional extra are
  removed; import the core client directly.

## Plugin hook changes (bundle → 3.0.0, breaking)

The `dashclaw` plugin bundle (Claude Code / Codex / Hermes manifests) bumps to
**3.0.0** for breaking hook changes:

- **Session digest removed** (`dashclaw_session_digest.py` deleted) — it only posted
  to now-removed handoffs/learning/fleet-digest endpoints.
- **Enforcement-liveness probe re-homed** onto SessionStart (it previously rode the
  digest wiring).
- **Code-session reporter + behavior recorder + stop-uploads deleted**; the pretool
  skill-scan and stop-hook cost recap are stripped.

**Action:** re-install hooks to pick up the new wiring:

```bash
dashclaw install
```

The surviving hooks (`dashclaw_pretool.py`, `dashclaw_posttool.py`,
`dashclaw_stop.py`, `enforcement_liveness_probe.py`) keep guard/record/coverage/
assumptions behavior and the fail-closed exit-2-on-block seam.

## CLI (`@dashclaw/cli` → 0.8.0, breaking)

8 commands removed: `code`, `prompts`, `inbox`, `behavior`, `posture`, `cost`,
`next`, `env`. The install/run/doctor/approvals path is unchanged.

## Database: retired-in-place tables + the export-then-drop path

**No destructive migration shipped.** Every retired subsystem's tables remain
physically present in `schema/schema.js` and `drizzle/*.sql`; the code simply
stops reading/writing them. `drizzle-kit generate` was **not** run for any
removal. Existing databases are unaffected and existing installs keep working.

If you want to reclaim the space later, the **documented, separate** path is:

1. **Export** any data you want to keep from the retired tables (the tables are
   still queryable — standard `pg_dump -t <table>` or a `SELECT … INTO` export).
2. **Drop** them in a deliberate, reviewed migration authored by hand (not
   `drizzle-kit generate`), applied via your normal `npm run db:migrate` flow.

The retired-table list is in the [kill ledger](2026-07-07-v5-kill-ledger.md#retired-in-place-tables-no-destructive-migration).
Note that `agent_messages` is retained **and still read/written** by the slim
assumption-ack survivor — do not drop it.

**Retired policy-type rows are not auto-disabled.** If your `guard_policies`
table carries rows of a retired type (`semantic_check`, `behavioral_anomaly`,
`x402_spend_limit`), they remain in place but the guard no longer evaluates
them — they are silent no-ops. The cull does not disable them for you
(constitution §3: the operator owns policy state). `/policies` now flags each
such row with a **"retired — no longer enforced"** badge; review them and use
the active/inactive toggle to disable the ones you no longer want.

## Versions

| Package | 4.76.0 | 5.0.0 |
|---|---|---|
| Platform (`package.json`) | 4.76.0 | **5.0.0** |
| Node SDK (`sdk/package.json`) | 4.76.0 | **5.0.0** |
| Python SDK (`sdk-python`) | 4.76.0 | **5.0.0** |
| Plugin bundle (Claude/Codex/Hermes) | 2.16.0 | **3.0.0** |
| CLI (`@dashclaw/cli`) | 0.7.6 | **0.8.0** |

The platform and both SDKs share one version by design; the plugin bundle and CLI
keep their own (enforced by `npm run version:sync:check`).
