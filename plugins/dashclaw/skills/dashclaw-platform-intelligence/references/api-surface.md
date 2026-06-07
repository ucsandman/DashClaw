# DashClaw API Surface

**300 active routes** (verified 2026-06-07 against `docs/api-inventory.json`): 51 stable, 24 beta, 225 experimental. Node SDK uses camelCase, Python SDK uses snake_case.

> ⚠️ **Authoritative source:** `SKILL.md` (regenerated from the livingcode shape) and `docs/api-inventory.md`. This file is a curated narrative for the most commonly consumed surfaces plus anything new that doesn't yet have an SDK mapping. Some sections below describe legacy v1 endpoints that may not exist in the current build (e.g. `/api/context/*`, `/api/snippets/*`, `/api/decisions`, `/api/feedback/*`) — cross-check against `docs/api-inventory.md` before integrating.

## Table of Contents

- [Doctor (self-host diagnostics)](#doctor-self-host-diagnostics)
- [MCP Server](#mcp-server)
- [Analytics](#analytics)
- [Action Recording](#action-recording)
- [Approvals](#approvals)
- [Agent Fleet and Profile](#agent-fleet-and-profile)
- [Loops and Assumptions](#loops-and-assumptions)
- [Signals](#signals)
- [Behavior Guard](#behavior-guard)
- [Guard Decisions Audit Log](#guard-decisions-audit-log)
- [Policies](#policies)
- [Capabilities](#capabilities)
- [x402 Governed Capability Spend](#x402-governed-capability-spend)
- [FinOps / Spend](#finops--spend)
- [Governance Posture](#governance-posture)
- [Workflows](#workflows)
- [Context Manager](#context-manager)
- [Agent Messaging](#agent-messaging)
- [Automation Snippets](#automation-snippets)
- [Session Handoffs](#session-handoffs)
- [Memory](#memory)
- [User Preferences](#user-preferences)
- [Daily Digest](#daily-digest)
- [Security Scanning](#security-scanning)
- [Webhooks](#webhooks)
- [Agent Pairing](#agent-pairing)
- [Identity Binding](#identity-binding)
- [Organization Management](#organization-management)
- [Activity Logs](#activity-logs)
- [Compliance Engine](#compliance-engine)
- [Compliance Exports](#compliance-exports)
- [Bulk Sync](#bulk-sync)
- [Evaluation Framework](#evaluation-framework)
- [Prompt Management](#prompt-management)
- [Drift Detection](#drift-detection)
- [Learning Analytics](#learning-analytics)
- [Scoring Profiles](#scoring-profiles)
- [Risk Templates](#risk-templates)
- [Session Lifecycle](#session-lifecycle)
- [Guard Policy Types](#guard-policy-types)
- [Dashboard Data and Other Routes](#dashboard-data-and-other-routes)

## Doctor (self-host diagnostics)

**Maturity:** New (April 2026)

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/doctor` | GET | Run all check modules (database, config, auth, deployment, SDK, governance, drift guard). Returns per-check pass/fail + summary. |
| `/api/doctor/fix` | POST | Apply safe auto-fixes (migrate DB, generate secrets, CORS config, seed default policy). Backs up `.env` before any write. |

The CLI (`dashclaw doctor`) invokes these endpoints. Local mode (`npm run doctor`) runs the same engine with filesystem access for env writes. Check modules + constants are emitted from the livingcode shape into `app/lib/doctor/generated/checks-from-shape.mjs`.

## MCP Server

**Maturity:** New (April 2026)

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/mcp` | POST | Model Context Protocol Streamable HTTP transport. Same 29 tools / 6 resources exposed by the stdio binary (`@dashclaw/mcp-server`). |

**29 tools across 10 groups.** Core governance (8): `dashclaw_guard`, `dashclaw_record`, `dashclaw_invoke`, `dashclaw_capabilities_list`, `dashclaw_policies_list`, `dashclaw_wait_for_approval`, `dashclaw_session_start`, `dashclaw_session_end`. Optimal files (2): `dashclaw_optimal_files_preview`, `dashclaw_optimal_files_manifest`. Session continuity (3): `dashclaw_handoff_create`, `dashclaw_handoff_latest`, `dashclaw_handoff_consume`. Credential hygiene (3): `dashclaw_secret_list`, `dashclaw_secret_due`, `dashclaw_secret_mark_rotated`. Skill safety (1): `dashclaw_skill_scan`. Open loops (3): `dashclaw_loop_add`, `dashclaw_loop_list`, `dashclaw_loop_close`. Learning + retrospection (4): `dashclaw_learning_log`, `dashclaw_learning_query`, `dashclaw_decisions_recent`, `dashclaw_assumption_record`. Agent inbox (2): `dashclaw_inbox_list`, `dashclaw_messages_mark_read`. Behavior learning (1): `dashclaw_behavior_suggestions`. Governance posture (2, read-only): `dashclaw_posture`, `dashclaw_posture_next`.

**Resources:** `dashclaw://policies`, `dashclaw://capabilities`, `dashclaw://agent/{agent_id}/history`, `dashclaw://status`, `dashclaw://code-sessions/projects`, `dashclaw://code-sessions/sessions/{session_id}`.

Tool route mapping lives in `mcp-server/lib/routes-inventory.generated.json` — emitted from shape, not hand-edited.

## Analytics

**Maturity:** New (April 2026)

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/analytics` | GET | Aggregated cost + action analytics for the `/analytics` dashboard. Returns hero stats with trend comparison, cost trend series, action volume series, breakdowns by agent/action type/model, and token usage. |

## Approvals

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/approvals/[actionId]` | POST | Approve or deny a pending action (body: `{ decision, reasoning }`). Shared by browser, CLI, `/approve` mobile PWA, and SDK polling. Publishes `action.updated` to the Redis SSE stream. |

## Agent Fleet and Profile

| Endpoint | Methods | Node SDK |
|---|---|---|
| `/api/agents` | GET | `getAgents` |
| `/api/agents/[agentId]` | GET | `getAgent` |
| `/api/agents/[agentId]/profile` | GET | Aggregated governance profile: vitals strip, trust posture, assumptions summary, policies, recent decisions, signals. Powers `/agents/[agentId]` page. |
| `/api/agents/connections` | GET, POST | `getAgentConnections`, `reportConnections` |
| `/api/agents/heartbeat` | POST | `heartbeat` — auto-updates `agent_presence` on action submission (`418fc872`) |

## Guard Decisions Audit Log

**Maturity:** New (April 2026)

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/guard/decisions` | GET | Queryable guard decision audit log (triggering policy, risk score, matched rules, outcome). Powers `/policies` ActivityTab. SQL consolidated into `guardrails.repository.js`. |

## Capabilities

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/capabilities` | GET, POST | List / register capabilities |
| `/api/capabilities/[capabilityId]` | GET, PATCH, DELETE | Read / edit / delete (DELETE added April 2026 — `36a307ac`) |
| `/api/capabilities/[capabilityId]/access` | GET, POST | Access rules |
| `/api/capabilities/[capabilityId]/access/[ruleId]` | DELETE | Remove access rule |
| `/api/capabilities/[capabilityId]/access/check` | GET | Resolve access for a given caller |
| `/api/capabilities/[capabilityId]/health` | GET | Per-capability health |
| `/api/capabilities/[capabilityId]/history` | GET | Invocation history |
| `/api/capabilities/[capabilityId]/invoke` | POST | Full guard → execute → record loop |
| `/api/capabilities/[capabilityId]/test` | POST | Dry-run test invocation |
| `/api/capabilities/health` | GET | Registry-wide health |

## x402 Governed Capability Spend

**Maturity:** Beta

x402 micropayments are treated as **governed capability spend**: DashClaw governs the purchase intent and records the spend, but never holds a wallet — the wallet and payment adapters stay agent-side (govern-not-do).

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/x402/providers` | GET, POST | List / register paid-API providers (governed provider registry) |
| `/api/x402/providers/[id]` | GET, PATCH | Read / edit a provider |
| `/api/x402/providers/[id]/endpoints` | GET, POST | List / register priced endpoints for a provider |
| `/api/x402/purchases` | GET, POST | Record a purchase intent and its recorded spend |

Purchases are evaluated against the `x402_spend_limit` guard policy type (per-purchase / daily ceiling) before they are recorded. See [Guard Policy Types](#guard-policy-types).

## FinOps / Spend

**Maturity:** Beta

A read-only aggregation/presentation layer that unifies spend across surfaces. FinOps owns no tables — it aggregates existing records rather than fusing them.

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/finops/spend?lens=fleet` | GET | Fleet spend: agent LLM cost + x402 capability spend (`getFleetSpend`). Returns `{ lens, period, agent, x402, fleet_total_usd }` |
| `/api/finops/spend?lens=claude-code` | GET | Your Claude Code spend, advisory (`getClaudeCodeSpend`). Returns `{ lens, period, code_sessions, code_total_usd }` |

`period` accepts `7d`, `30d`, or `90d`. Backed by `app/lib/repositories/finops.repository.js`. UI pages: `/spend` (Overview), `/spend/x402` (Purchases), `/spend/code` (Your Claude Code).

## Governance Posture

**Maturity:** Experimental

Govern-the-governance: a gaming-resistant org governance posture score over 6 dimensions measuring what the fleet CAN do vs what it actually GOVERNS. The score is gaming-resistant — it only rises from ACTIVE, proven-to-fire policies; drafting a fix never raises it. Remediation is human-gated and DRAFT-ONLY (`resolve` does `create_draft | snooze | accept_risk` — it never auto-activates a policy).

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/posture` | GET | Org governance posture score + 6 dimensions + findings + summary + snapshot trend |
| `/api/posture/findings` | GET | Prioritized remediation queue (`?status=`, `?dimension=`) |
| `/api/posture/findings/[key]/resolve` | POST | Human-gated finding resolution: `create_draft` \| `snooze` \| `accept_risk` (DRAFT-ONLY — never auto-applies) |
| `/api/posture/scan` | POST | Recompute the score and persist a trend snapshot |

UI: `/posture`. MCP (read-only): `dashclaw_posture`, `dashclaw_posture_next`. CLI: `dashclaw posture`, `dashclaw next`, `dashclaw posture resolve <key>`. Tables: `posture_findings_state`, `posture_snapshots`.

## Workflows

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/workflows/draft` | POST | Draft a workflow from a natural-language goal |
| `/api/workflows/templates` | GET, POST | List / create templates |
| `/api/workflows/templates/[templateId]` | GET, PATCH, DELETE | CRUD |
| `/api/workflows/templates/[templateId]/duplicate` | POST | Clone a template |
| `/api/workflows/templates/[templateId]/execute` | POST | One-shot execution |
| `/api/workflows/templates/[templateId]/launch` | POST | Long-running launch (returns runActionId) |
| `/api/workflows/templates/[templateId]/runs` | GET | List runs |
| `/api/workflows/templates/[templateId]/runs/[runActionId]` | GET | Run detail |
| `/api/workflows/templates/[templateId]/runs/[runActionId]/cancel` | POST | Cancel |
| `/api/workflows/templates/[templateId]/runs/[runActionId]/resume` | POST | Resume after pause/approval |

Template variables serialize objects and preserve arrays (`c4164311`); `prompt_template` replaces the old `prompt` field in analyze steps (`58bc63e1`).

## Action Recording

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/actions` | GET, POST, DELETE | `createAction`, `getActions` | `create_action`, `get_actions` |
| `/api/actions/[actionId]` | GET, PATCH | `getAction`, `updateOutcome` | `get_action`, `update_outcome` |

**PATCH outcome fields (v2.13.1+):** `status`, `output_summary`, `side_effects`, `artifacts_created`, `error_message`, `timestamp_end`, `duration_ms`, `cost_estimate`, `tokens_in`, `tokens_out`, `model`. When `tokens_in` / `tokens_out` are reported without an explicit `cost_estimate`, the server derives cost from the configured pricing table (see `app/lib/billing.js`) using `model` to pick the right pricing row. The `model` column was added to `action_records` on 2026-04-14 — run `node scripts/_run-with-env.mjs scripts/migrate-action-model-column.mjs` against existing instances before deploying the matching server build.

**Token capture pipeline (Claude Code):** the `Stop` hook (`hooks/dashclaw_stop.py`) reads the session transcript at turn end, sums LLM token usage across that turn's assistant messages (cache_read tokens weighted at 0.1× to match Anthropic billing), and PATCHes the per-turn share onto every action_id the pretool opened during the turn. Same idea for the OpenClaw plugin (v1.2.1+) via the `llm_output` and `agent_end` hooks.

| `/api/actions/[actionId]/artifacts` | GET | `getActionArtifacts` | `get_action_artifacts` |
| `/api/actions/[actionId]/graph` | GET | `getActionGraph` | `get_action_graph` |
| `/api/actions/[actionId]/messages` | GET | `getActionMessages` | `get_action_messages` |
| `/api/actions/[actionId]/trace` | GET | `getActionTrace` | `get_action_trace` |
| `/api/actions/[actionId]/outcome` | GET, POST | `getActionOutcome`, `reportActionOutcome` (+ `reportActionSuccess` / `reportActionFailure` / `reportActionPartial`) | `get_action_outcome`, `report_action_outcome` (+ `report_action_success` / `report_action_failure` / `report_action_partial`) |
| `/api/actions/costs` | GET | `getActionCosts` | `get_action_costs` |
| `/api/actions/loops` | GET, POST | see Loops and Assumptions | — |
| `/api/actions/stats` | GET | `getActionStats` | `get_action_stats` |
| `/api/cron/outcome-sweep` | GET (Bearer `CRON_SECRET`) | — | — |

**Durable execution finality (v2.13.3+):** `POST /api/actions/[actionId]/outcome` records a terminal `outcome_status` — one of `completed`, `partial`, `failed` — that is independent from the legacy PATCH lifecycle status. Outcomes are one-shot: the first call wins, every subsequent POST returns `409 { error: "outcome already set", current_status }`. `GET /api/actions/[actionId]/outcome` returns the current outcome plus an `elapsed_ms` derived field, so agents can poll before retry to avoid double-execution. The Node + Python SDKs ship matching `deriveIdempotencyKey` / `derive_idempotency_key` helpers; passing `idempotency_key` on `POST /api/actions` short-circuits duplicate creates to `{ idempotent_replay: true }`. Pending outcomes age into `lost_confirmation` via `/api/cron/outcome-sweep` (daily on Vercel Hobby, hourly externally if you wire it up); the sweep emits a `signal.detected` event of type `lost_confirmation` and fires webhooks for orgs subscribed to that event. Per-org timeout via the `DASHCLAW_OUTCOME_TIMEOUT_MINUTES` setting (default 15, clamped `[1, 1440]`). Full spec: `docs/architecture/durable-execution-finality.md`.

`getPendingApprovals` / `get_pending_approvals` — queries actions with `status=pending_approval`.

**Action approvals moved** — use `POST /api/approvals/[actionId]` (see [Approvals](#approvals)), not the legacy `/api/actions/[actionId]/approve` path.

**Validation notes (April 2026):**
- `action_type` is **no longer restricted to an enum** — arbitrary strings from third-party agent frameworks are accepted (`11e0911a`).
- `status=blocked` is a valid action status. The `dashclaw_pretool` hook records blocked actions with `status=blocked` when guard returns `decision=block` (`6f0a57bd`, BUG-02).
- `GET /api/actions/[actionId]` responses include `message_summary` alongside the action record.

## Loops and Assumptions

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/actions/loops` | GET, POST | v2: `registerOpenLoop`, v1: `reportLoop`, `getLoops` | `register_open_loop`, `report_loop`, `get_loops` |
| `/api/actions/loops/{loopId}` | GET, PATCH | v2: `resolveOpenLoop`, v1: `closeLoop` | `resolve_open_loop`, `close_loop` |
| `/api/actions/assumptions` | GET, POST | v2: `recordAssumption`, v1: `reportAssumption`, `getAssumptions` | `record_assumption`, `report_assumption`, `get_assumptions` |
| `/api/actions/assumptions/{assumptionId}` | GET, PATCH | `getAssumption`, `updateAssumption` | `get_assumption`, `update_assumption` |

## Signals

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/actions/signals` | GET | `getSignals` | `get_signals` |

**Signal types:** `guard_block`, `guard_warn`, `approval_timeout`, `loop_stale`, `injection_detected`, `drift_alert`, `feedback_negative`, `session_stalled`, `branch_stale`, `mcp_degraded`, `green_insufficient`

## Behavior Guard

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/guard` | GET, POST | `guard`, `getGuardDecisions` | `guard`, `get_guard_decisions` |

POST sends an action for policy evaluation. Returns `{ decision, reasons, warnings, matched_policies, risk_score }`.
Decisions: `allow`, `block`, `warn`, `require_approval`.

## Policies

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/policies` | GET, POST, PATCH, DELETE | `importPolicies` | `import_policies` |
| `/api/policies/import` | POST | `importPolicies` | `import_policies` |
| `/api/policies/test` | POST | `testPolicy` | `test_policy` |
| `/api/policies/proof` | GET | `getProofReport` | `get_proof_report` |

## Context Manager

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/context/points` | GET, POST | `saveContextPoint`, `getContextPoints` | `save_context_point`, `get_context_points` |
| `/api/context/threads` | GET, POST | `createThread`, `getThreads` | `create_thread`, `get_threads` |
| `/api/context/threads/{threadId}` | GET, PATCH | `getThread`, `closeThread` | `get_thread`, `close_thread` |
| `/api/context/threads/{threadId}/entries` | POST | `addThreadEntry` | `add_thread_entry` |

Context thread IDs use `ct_` prefix.

## Agent Messaging

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/messages` | GET, POST, PATCH | `sendMessage`, `getMessages`, `markRead`, `archiveMessages`, `broadcast` | `send_message`, `get_messages`, `mark_read`, `archive_messages`, `broadcast` |
| `/api/messages/threads` | GET, POST, PATCH | `createMessageThread`, `getMessageThreads`, `resolveMessageThread` | `create_message_thread`, `get_message_threads`, `resolve_message_thread` |
| `/api/messages/docs` | GET, POST | `getSharedDocs`, `saveSharedDoc` | `get_shared_docs`, `save_shared_doc` |
| `/api/messages/attachments` | GET | `getMessageAttachments` | `get_message_attachments` |
| `/api/actions/{actionId}/messages` | GET | `getActionMessages` | `get_action_messages` |
| `/api/actions/{actionId}/messages?summary=true` | GET | -- | -- |

`GET /api/actions/{actionId}/messages?summary=true` returns `{ total, participants[], correlation, first_message_at, last_message_at }` instead of full messages. `GET /api/actions/{actionId}` now includes `message_summary` in the response.

Message thread IDs use `mt_` prefix.

## Automation Snippets

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/snippets` | GET, POST, DELETE | `saveSnippet`, `getSnippets`, `deleteSnippet` | `save_snippet`, `get_snippets`, `delete_snippet` |
| `/api/snippets/{snippetId}` | GET | `getSnippet` | `get_snippet` |
| `/api/snippets/{snippetId}/use` | POST | `useSnippet` | `use_snippet` |

Snippet IDs use `sn_` prefix.

## Session Handoffs

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/handoffs` | GET, POST | `createHandoff`, `getHandoffs`, `getLatestHandoff` | `create_handoff`, `get_handoffs`, `get_latest_handoff` |

## Memory

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/memory` | GET, POST | `reportMemoryHealth` | `report_memory_health` |

## User Preferences

**Maturity:** Experimental

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/preferences` | GET, POST | `logObservation`, `setPreference`, `logMood`, `trackApproach`, `getPreferenceSummary`, `getApproaches` | `log_observation`, `set_preference`, `log_mood`, `track_approach`, `get_preference_summary`, `get_approaches` |

GET accepts `?type=summary|observations|preferences|moods|approaches`.

## Daily Digest

**Maturity:** Experimental

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/digest` | GET | `getDailyDigest` | `get_daily_digest` |

## Security Scanning

**Maturity:** Beta

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/security/scan` | POST | `scanContent` | `scan_content` |
| `/api/security/status` | GET | `reportSecurityFinding` | `report_security_finding` |
| `/api/security/prompt-injection` | GET, POST | `scanPromptInjection` | `scan_prompt_injection` |

POST scans text for prompt injection attacks. Returns `{ clean, risk_level, recommendation, findings_count, categories, findings }`. Recommendation: `allow`, `warn`, or `block`. Scan metadata stored with `pi_` prefixed IDs.

## Webhooks

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/webhooks` | GET, POST, DELETE | `getWebhooks`, `createWebhook`, `deleteWebhook` | `get_webhooks`, `create_webhook`, `delete_webhook` |
| `/api/webhooks/{webhookId}/test` | POST | `testWebhook` | `test_webhook` |
| `/api/webhooks/{webhookId}/deliveries` | GET | `getWebhookDeliveries` | `get_webhook_deliveries` |

## Agent Pairing

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/pairings` | GET, POST | `createPairing`, `listPairings` | `create_pairing`, `list_pairings` |
| `/api/pairings/{pairingId}` | GET | `getPairing` | `get_pairing` |
| `/api/pairings/{pairingId}/approve` | POST | `approvePairing`, `waitForPairing` | `approve_pairing`, `wait_for_pairing` |

`POST /api/pairings` — Agent identity pairing enrollment. `GET /api/pairings` — List all pairings. `POST /api/pairings/:id/approve` — Approve a pending pairing.

`PATCH /api/pairings/{pairingId}` now accepts `permission_level` in the body. Valid values: `readonly`, `workspace_write`, `danger`, `prompt`, `allow`.

Management UI: `/settings?tab=identity`

## Identity Binding

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/identities` | GET, POST | `registerIdentity`, `getIdentities` | `register_identity`, `get_identities` |
| `/api/identities/{agentId}` | DELETE | `revokeIdentity` | `revoke_identity` |

`POST /api/identities` — Register a new agent identity. `GET /api/identities` — List all registered identities. `DELETE /api/identities/:id` — Revoke an agent identity.

## Organization Management

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/orgs` | GET, POST | `getOrg`, `createOrg` | `get_org`, `create_org` |
| `/api/orgs/{orgId}` | GET, PATCH | `getOrgById`, `updateOrg` | `get_org_by_id`, `update_org` |
| `/api/orgs/{orgId}/keys` | GET | `getOrgKeys` | `get_org_keys` |

## Activity Logs

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/activity` | GET | `getActivityLogs` | `get_activity_logs` |

## Compliance Engine

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/compliance/map` | POST | `mapCompliance` | `map_compliance` |
| `/api/compliance/gaps` | POST | `analyzeGaps` | `analyze_gaps` |
| `/api/compliance/report` | GET | `getComplianceReport` | `get_compliance_report` |
| `/api/compliance/frameworks` | GET | `listFrameworks` | `list_frameworks` |
| `/api/compliance/evidence` | GET | `getComplianceEvidence` | `get_compliance_evidence` |

Supports frameworks: SOC 2 (`soc2`), NIST AI RMF (`nist-ai-rmf`), EU AI Act (`eu-ai-act`), ISO 42001 (`iso-42001`).

## Compliance Exports

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/compliance/exports` | GET, POST | `createComplianceExport`, `listComplianceExports` | `create_compliance_export`, `list_compliance_exports` |
| `/api/compliance/exports/{exportId}` | GET, DELETE | `getComplianceExport`, `deleteComplianceExport` | `get_compliance_export`, `delete_compliance_export` |
| `/api/compliance/exports/{exportId}/download` | GET | `downloadComplianceExport` | `download_compliance_export` |
| `/api/compliance/exports/{exportId}/status` | GET | `getComplianceExportStatus` | `get_compliance_export_status` |
| `/api/compliance/schedules` | GET, POST | `createComplianceSchedule`, `listComplianceSchedules` | `create_compliance_schedule`, `list_compliance_schedules` |
| `/api/compliance/schedules/{scheduleId}` | PATCH, DELETE | `toggleComplianceSchedule`, `deleteComplianceSchedule` | `toggle_compliance_schedule`, `delete_compliance_schedule` |
| `/api/compliance/trends` | GET | `getComplianceTrends` | `get_compliance_trends` |

Export IDs use `ce_` prefix. Schedule IDs use `cs_` prefix.

## Evaluation Framework

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/evaluations/scorers` | GET, POST | `createScorer`, `listScorers` | `create_scorer`, `list_scorers` |
| `/api/evaluations/scorers/{scorerId}` | GET, PATCH, DELETE | `getScorer`, `updateScorer`, `deleteScorer` | `get_scorer`, `update_scorer`, `delete_scorer` |
| `/api/evaluations/scores` | GET, POST | `scoreOutput`, `listScores` | `score_output`, `list_scores` |
| `/api/evaluations/runs` | GET, POST | `createEvalRun`, `listEvalRuns` | `create_eval_run`, `list_eval_runs` |
| `/api/evaluations/types` | GET | `getScorerTypes` | `get_scorer_types` |

Scorer IDs use `es_` prefix. Score IDs use `sc_` prefix. Run IDs use `er_` prefix.

**5 scorer types**: `regex`, `contains`, `numeric_range`, `custom_function`, `llm_judge` (optional, requires LLM provider).

## Prompt Management

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/prompts/templates` | GET, POST | `createTemplate`, `listTemplates` | `create_template`, `list_templates` |
| `/api/prompts/templates/{templateId}` | GET, PATCH, DELETE | `getTemplate`, `updateTemplate`, `deleteTemplate` | `get_template`, `update_template`, `delete_template` |
| `/api/prompts/templates/{templateId}/duplicate` | POST | `duplicateTemplate` | `duplicate_template` |
| `/api/prompts/versions` | GET | `listVersions` | `list_versions` |
| `/api/prompts/versions/{templateId}` | POST | `createVersion` | `create_version` |
| `/api/prompts/versions/{templateId}/activate/{versionId}` | POST | `activateVersion` | `activate_version` |
| `/api/prompts/versions/{templateId}/rollback/{versionId}` | POST | `rollbackVersion` | `rollback_version` |
| `/api/prompts/render` | POST | `renderTemplate` | `render_template` |
| `/api/prompts/runs` | GET | `listPromptRuns` | `list_prompt_runs` |
| `/api/prompts/stats` | GET | `getPromptStats` | `get_prompt_stats` |
| `/api/prompts/variables` | GET | `listPromptVariables` | `list_prompt_variables` |

Template IDs use `pt_` prefix. Version IDs use `pv_` prefix.

## Drift Detection

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/drift/alerts` | GET, POST | `listDriftAlerts`, `detectDrift`, `computeDriftBaselines`, `recordDriftSnapshots` | `list_drift_alerts`, `detect_drift`, `compute_drift_baselines`, `record_drift_snapshots` |
| `/api/drift/alerts/{alertId}` | PATCH, DELETE | `acknowledgeDriftAlert`, `deleteDriftAlert` | `acknowledge_drift_alert`, `delete_drift_alert` |
| `/api/drift/stats` | GET | `getDriftStats` | `get_drift_stats` |
| `/api/drift/snapshots` | GET | `getDriftSnapshots` | `get_drift_snapshots` |
| `/api/drift/metrics` | GET | `getDriftMetrics` | `get_drift_metrics` |

Alert IDs use `da_` prefix. Baseline IDs use `db_` prefix. Snapshot IDs use `ds_` prefix.

**6 tracked metrics**: risk_score, confidence, duration_ms, cost_estimate, tokens_total, learning_score.
**Severity thresholds**: z >= 1.5 (info), z >= 2.0 (warning), z >= 3.0 (critical).

POST `/api/drift/alerts` accepts `action` field: `detect` (default), `compute_baselines`, `record_snapshots`.

## Learning Analytics

**Maturity:** Stable

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/learning/analytics/velocity` | GET, POST | `computeLearningVelocity`, `getLearningVelocity` | `compute_learning_velocity`, `get_learning_velocity` |
| `/api/learning/analytics/curves` | GET, POST | `computeLearningCurves`, `getLearningCurves` | `compute_learning_curves`, `get_learning_curves` |
| `/api/learning/analytics/summary` | GET | `getLearningAnalyticsSummary` | `get_learning_analytics_summary` |
| `/api/learning/analytics/maturity` | GET | `getMaturityLevels` | `get_maturity_levels` |

Velocity computed via linear regression slope. Acceleration is the change in velocity. Maturity classification uses 6 levels (novice through master) based on episode count, success rate, and average score.

## Scoring Profiles

**Maturity:** New (Phase 7)

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/scoring/profiles` | GET, POST | `createScoringProfile`, `listScoringProfiles` | `create_scoring_profile`, `list_scoring_profiles` |
| `/api/scoring/profiles/{profileId}` | GET, PATCH, DELETE | `getScoringProfile`, `updateScoringProfile`, `deleteScoringProfile` | `get_scoring_profile`, `update_scoring_profile`, `delete_scoring_profile` |
| `/api/scoring/profiles/{profileId}/dimensions` | POST | `addScoringDimension` | `add_scoring_dimension` |
| `/api/scoring/profiles/{profileId}/dimensions/{dimensionId}` | PATCH, DELETE | `updateScoringDimension`, `deleteScoringDimension` | `update_scoring_dimension`, `delete_scoring_dimension` |
| `/api/scoring/score` | GET, POST | `scoreWithProfile`, `batchScoreWithProfile`, `getProfileScores`, `getProfileScoreStats` | `score_with_profile`, `batch_score_with_profile`, `get_profile_scores`, `get_profile_score_stats` |
| `/api/scoring/calibrate` | POST | `autoCalibrate` | `auto_calibrate` |

POST `/api/scoring/profiles` supports inline dimension creation (pass `dimensions` array in body).
POST `/api/scoring/score` accepts either `action` (single) or `actions` (batch array).
GET `/api/scoring/score?view=stats` returns aggregate statistics.

**Composite methods**: `weighted_average`, `minimum`, `geometric_mean`.
**Data sources**: `duration_ms`, `cost_estimate`, `tokens_total`, `risk_score`, `confidence`, `eval_score`, `metadata_field`, `custom_function`.
**ID prefixes**: `sp_` (profiles), `sd_` (dimensions), `ps_` (scores).

## Risk Templates

**Maturity:** New (Phase 7)

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/scoring/risk-templates` | GET, POST | `createRiskTemplate`, `listRiskTemplates` | `create_risk_template`, `list_risk_templates` |
| `/api/scoring/risk-templates/{templateId}` | PATCH, DELETE | `updateRiskTemplate`, `deleteRiskTemplate` | `update_risk_template`, `delete_risk_template` |

Risk templates define rule-based risk scoring: `base_risk` + conditional `rules` (array of `{ condition, add }`).
Condition operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`. Supports nested paths.
**ID prefix**: `rt_`.

## Session Lifecycle

**Maturity:** New (Phase 8)

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/sessions` | GET, POST | `createSession`, `listSessions` | `create_session`, `list_sessions` |
| `/api/sessions/{sessionId}` | GET, PATCH | `getSession`, `updateSession` | `get_session`, `update_session` |
| `/api/sessions/{sessionId}/events` | GET | `getSessionEvents` | `get_session_events` |

`POST /api/sessions` — Create a session. Body: `{ agent_id, workspace, branch }`.
`GET /api/sessions` — List sessions. Query: `agent_id`, `status`, `limit`.
`GET /api/sessions/{sessionId}` — Get a single session.
`PATCH /api/sessions/{sessionId}` — Update session. Body: `{ status, green_level, branch_freshness, commits_behind, blocked_reason }`.
`GET /api/sessions/{sessionId}/events` — Get session lifecycle events.

Session IDs use `sess_` prefix.

## Guard Policy Types

Guard policies use a `policy_type` field. All types are evaluated server-side without an LLM.

| Policy Type | Purpose |
|---|---|
| `risk_threshold` | Block or require approval when risk exceeds a limit |
| `cost_limit` | Cap per-action and daily spend |
| `action_allowlist` | Only allow specific action types |
| `content_filter` | Guard against sensitive data in outputs |
| `permission_escalation` | Block when an agent requests a higher permission level than allowed |
| `green_contract` | Require green (passing) test status before certain actions proceed |
| `branch_freshness` | Block actions when the working branch is stale (N+ commits behind) |
| `x402_spend_limit` | Cap x402 micropayment spend (per-purchase / daily USDC ceiling) |

The three new types (`permission_escalation`, `green_contract`, `branch_freshness`) integrate with session lifecycle data. The guard evaluator reads `green_level`, `branch_freshness`, and `commits_behind` from the active session when evaluating these policies.

## Dashboard Data and Other Routes

| Endpoint | Methods | Node SDK | Python SDK |
|---|---|---|---|
| `/api/health` | GET | -- | -- |
| `/api/stream` | GET (SSE) | `events()` | -- |
| `/api/tokens` | POST | `reportTokenUsage` | `report_token_usage` |
| `/api/dashboard/data` | GET | -- | -- |
| `/api/decisions` | GET, POST | `recordDecision` | `record_decision` |
| `/api/goals` | GET, POST | `createGoal` | `create_goal` |
| `/api/content` | GET, POST | `recordContent` | `record_content` |
| `/api/interactions` | GET, POST | `recordInteraction` | `record_interaction` |
| `/api/integrations` | GET, POST | `reportConnections` | `report_connections` |
| `/api/calendar` | GET, POST | `createCalendarEvent` | `create_calendar_event` |
| `/api/ideas` | GET, POST | `recordIdea` | `record_idea` |
| `/api/onboarding/api-key` | POST | -- | -- |
| `/api/setup/status` | GET | -- | -- |
| `/api/settings/llm-status` | GET | `getLLMStatus` | `get_llm_status` |
| `/api/cron/*` | POST | -- | -- |
| `/api/schedules` | GET, POST | `listAgentSchedules`, `createAgentSchedule` | `list_agent_schedules`, `create_agent_schedule` |
