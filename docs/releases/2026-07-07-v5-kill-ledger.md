# DashClaw v5.0.0 — kill ledger

**Release:** v5.0.0 (2026-07-07) · **Branch:** `v5-cull` · **Canonical product definition:** [`THESIS.md`](../../THESIS.md)

This is the exhaustive, per-surface record of what the v5 cull removed and why.
It is how the owner audits the run. THESIS.md defines the product as **one loop —
intercept → decide → approve → prove** — plus the surfaces that directly support it
(auth/keys, setup, health). Everything not on that loop was removed. Nothing here is
irreversible: **every deleted file is recoverable by SHA** (git history is intact; no
history was rewritten), and **no destructive database migration shipped** — retired
tables stay physically in place (see [§ Retired-in-place tables](#retired-in-place-tables-no-destructive-migration)).

## How to read this ledger

- Each wave landed as one (or, for W0/W6, a small ordered series of) squashed commit(s)
  on `v5-cull`, tagged `v5-w<N>`.
- **Deleting commit** = the SHA that removed the surface.
- **Last SHA containing it** = the *parent* of the wave's first commit. Check out that
  SHA (or any earlier one) to recover any deleted file: `git show <parent>:<path>` or
  `git checkout <parent> -- <path>`.
- Route/page enumerations below are the exact `git diff --diff-filter=D` output for each
  wave range, so the list is complete, not a summary.

Aggregate effect (verified live at the release candidate):

| Surface | Before (v4.76.0) | After (v5.0.0) | Counted from |
|---|---|---|---|
| API routes (canonical inventory) | 337 | 116 | `docs/api-inventory.json` |
| API route files | 338 | 117 | `app/api/**/route.{js,ts,tsx}` |
| App pages | 95 | 46 | `app/**/page.{js,jsx,ts,tsx}` |
| MCP tools (`dashclaw_*`) | 33 | 12 | `mcp-server/src/tools.ts` |
| MCP resources | 6 | 3 | `mcp-server/src/resources.ts` |
| Node SDK methods | 149 | 28 | `sdk/dashclaw.js` |
| Python SDK methods | 234 | 51 | `sdk-python/dashclaw/client.py` |
| CLI commands | 21 | 13 | `cli/bin/dashclaw.js` |
| Guard policy types | 17 | 14 | `app/lib/guard/policy.ts` |

221 route files, 49 pages, ~1,100 tracked files removed in total across the deletion waves.

---

## Wave 0 — KEEP-surface + guard-core decoupling (no deletions on the loop)

- **Rationale:** before any deletion, every surviving (KEEP/DEMOTE) file was severed from
  every dying subsystem so each subsequent wave is a pure deletion. Zero intended behavior
  change on the loop; the guard hot path was edited exactly once.
- **Deleting commits:** `a4833a9c` (0A guard core), `49db7204` (0B front door/nav/demo/policy UI),
  `092d094f` (0C runtime hooks) · **Last SHA containing pre-cull state:** `8e49064a`
- **Files deleted here (orphaned by the decoupling):** `app/lib/learning-context.ts`,
  `app/lib/recovery.ts`, `hooks/tests/test_code_session_reporter.py`.
- **Policy types removed from the guard registry (17 → 14):** `semantic_check`,
  `behavioral_anomaly`, `x402_spend_limit` — removed in lockstep across
  `app/lib/guard/policy.ts` (`POLICY_EVALUATORS`), `app/lib/validate.js` (`POLICY_TYPES`),
  and `app/lib/types/governance.ts` (`GuardPolicyType`). The org-authored risk-template math,
  `protected_path` matching, and `computePredictiveRisk` (statistical fallback,
  `PREDICTIVE_RISK_ENABLED`-gated) were **ported into guard-owned modules and kept**.

## Wave 1 — `app/api/_archive` fossil (48 routes)

- **Rationale (THESIS "what dies"):** 48 runtime-dead routes from the archived agent-platform
  era — "the fossil taught its lesson," deleted outright.
- **Deleting commit:** `2722a84b` · **Last SHA containing it:** `092d094f`
- **Routes deleted (48):** the entire `app/api/_archive/**` tree —
  agent-schedules, bounties, bug-hunter, calendar, content, context/points,
  context/threads (+ `[threadId]`, entries), digest, docs/raw, feedback (+ `[feedbackId]`, stats),
  goals, handoffs, identities, inspiration, invite/`[token]`, memory,
  messages (+ attachments, docs, threads), notifications, onboarding (api-key, status, workspace),
  pairings (+ `[pairingId]`, approve), preferences, relationships,
  routing (agents (+ `[agentId]`), health, stats, tasks (+ `[taskId]`, complete)),
  schedules, snippets (+ `[snippetId]`, use), sync, tokens (+ budget), workflows.
- Also removed the 7 `_archive`-importing routing route tests.

## Wave 2 — Observability, dashboard, fleet roster, posture, team/RBAC (17 routes, 11 pages)

- **Rationale:** fleet/dashboard/posture are observability, not enforcement (LangSmith/Langfuse
  record; DashClaw prevents). Team/RBAC stays declined per THESIS (trigger unchanged: a second
  human governing an org).
- **Deleting commit:** `7f2380fa` · **Last SHA containing it:** `2722a84b`
- **Routes (17):** `/api/agents`, `/api/agents/[agentId]`, `/api/agents/[agentId]/profile`,
  `/api/agents/connections`, `/api/agents/heartbeat`, `/api/analytics`, `/api/digest/fleet`,
  `/api/invite/[token]`, `/api/operations/feed`, `/api/posture`, `/api/posture/findings`,
  `/api/posture/findings/[key]/resolve`, `/api/posture/scan`, `/api/security/scan`,
  `/api/team`, `/api/team/[userId]`, `/api/team/invite`.
- **Pages (11):** `activity`, `agents`, `agents/[agentId]`, `analytics`, `dashboard`,
  `invite/[token]`, `mission-control`, `mission-control/codebase`, `posture`, `security`, `team`.
- **Libs:** `capabilityHighlightsState.ts`, `digest-tick.ts`, `fleet-digest.ts`,
  `operations-feed.ts`, repositories `analytics`, `connections`, `invites`. `DraggableDashboard`
  and its entire tile-card thicket were deleted here so no later wave had to decouple a card.
- **MCP tools removed:** `dashclaw_posture`, `dashclaw_posture_next`.
- **SDK removed:** `heartbeat` / `startHeartbeat` / `stopHeartbeat` / `reportConnections`.
- **KEPT:** `/api/agents/fanouts` (fleet attribution lineage — audit/Prove), `/api/operations/summary`
  (DEMOTE), `/api/activity` API (DEMOTE), `/api/security/status` (DEMOTE), all of `app/lib/posture/*`
  (backs `/policies` tightening/loosening + `/setup`).

## Wave 3 — Workflows / work-orders / swarm (20 routes, 6 pages)

- **Rationale:** orchestration is the agent-platform tier, not governance. DashClaw governs goals;
  it does not run them.
- **Deleting commit:** `7a3a0f1b` · **Last SHA containing it:** `7f2380fa`
- **Routes (20):** `/api/workflows/**` (10, incl. `draft`, which freed `lib/prompt` +
  `knowledge.repository` for Waves 4–5), `/api/work-orders/**` (7), `/api/swarm/graph`,
  `/api/swarm/link`, `/api/cron/routing-maintenance`.
- **Pages (6):** `workflows`, `workflows/new`, `workflows/[templateId]`,
  `workflows/[templateId]/runs/[runActionId]`, `work-orders`, `swarm`.
- **Libs:** repositories `workflow-templates`, `workflow-runs`, `work-orders`, `swarm`;
  `workflow-executor.ts`, `step-handlers.ts`, `work-orders/{receipt,schema-validate,sweeps}.ts`.
- **MCP tools removed:** `dashclaw_work_order_submit`, `dashclaw_work_order_status`.
- **SDK removed:** workflow-template + work-order families (Node + Python).
- **PRESERVED:** `action_records.swarmId` + pretool `swarm_id` context + posttool `Workflow` spawn
  handling (fleet attribution for the kept `/api/agents/fanouts`).

## Wave 4 — Prompts library (7 routes, 1 page)

- **Rationale:** a prompt-template CRUD store is platform tooling, off the loop.
- **Deleting commit:** `88238295` · **Last SHA containing it:** `7a3a0f1b`
- **Routes (7):** `/api/prompts/{render,runs,stats,templates,templates/[id],
  templates/[id]/versions,templates/[id]/versions/[versionId]}`.
- **Page:** `prompts`. **Libs:** `prompt.ts`, repositories `prompts`, `snippets`.
- **SDK removed:** prompt family (Node + Python).
- **KEPT:** the 3 raw-prompt routes (`agent-connect/raw`, `sdk-coverage/raw`, `server-setup/raw`)
  that back marketing/self-host "copy prompt" buttons, plus `connectPrompt.ts`,
  `promptInjection.ts` (guard security).

## Wave 5 — Knowledge / RAG (5 routes, 3 pages)

- **Rationale:** pgvector knowledge collections are an agent-platform capability, not governance.
- **Deleting commit:** `d31dd4f8` · **Last SHA containing it:** `88238295`
- **Routes (5):** `/api/knowledge/collections/**`. **Pages (3):** `knowledge`,
  `knowledge/new`, `knowledge/[collectionId]`.
- **Libs:** `knowledge-ingest.ts`, repository `knowledge`.
- **SDK removed:** knowledge-collection family (Node + Python).
- **Carve-out:** `action_embeddings` + `embeddings.ts` are the *behavioral_anomaly guard* subsystem,
  not knowledge/RAG — retired via Wave 0 (write path) + Wave 7 (orphaned lib), not here.

## Wave 6 — Learning + behavior + policy-coach (21 routes, 3 pages)

- **Rationale:** behavior/learning is inference over history, not interception. It was scaffolding
  that never fired a real catch.
- **Deleting commits:** `a1bc7465` (re-home the enforcement-liveness probe onto SessionStart,
  retire the session digest), `386edac4` (remove learning + behavior + policy-coach) ·
  **Last SHA containing it:** `d31dd4f8`
- **Routes (21):** 6 × `/api/behavior/*`, 13 × `/api/learning*`, `/api/cron/learning-episodes-backfill`,
  `/api/cron/learning-recommendations`.
- **Pages (3):** `learning`, `learning/analytics`, `policy-coach`.
- **Libs:** the `app/lib/behavior/**` tree (analyzer, model-tier, path-match, policy-model, redaction,
  sample-source/store, simulate, task-classifier), `learning-export/lessons/loop/stats`,
  `learningAnalytics`, `learningLoop.service`, repositories `behavior`, `learning`, `learningLoop`.
- **Hooks:** `dashclaw_session_digest.py` deleted; the enforcement-liveness probe re-homed to
  SessionStart (it previously rode the now-deleted digest wiring). Mirrored for Codex + Hermes.
- **MCP tools removed:** `dashclaw_learning_log`, `dashclaw_learning_query`,
  `dashclaw_behavior_suggestions`. **SDK removed:** learning family (Python).
- **npm scripts removed:** `migrate:behavioral`, `migrate:learning-loop`,
  `backfill:learning-episodes`, `rebuild:learning-recommendations` (+ their `scripts/*.mjs`).
- **KEPT:** `policy-suggestions.ts` (backs `/api/cron/policy-suggestions` — on-thesis calibration;
  its `feedback`/`drift_alerts` triggers go dormant against retired tables), `agent_allowlist` policy.

## Wave 7 — Model-strategies / BYOK + orphaned llm/embeddings (4 routes, 3 pages)

- **Rationale:** BYOK model routing is platform plumbing; with `semantic_check`/`behavioral_anomaly`
  and the `action_embeddings` write gone (Wave 0), `llm.ts` and `embeddings.ts` were orphaned.
- **Deleting commit:** `12cd588f` · **Last SHA containing it:** `386edac4`
- **Routes (4):** `/api/model-strategies` (×3), `/api/settings/llm-status`.
- **Pages (3):** `workflows/strategies`, `workflows/strategies/new`, `workflows/strategies/[strategyId]`.
- **Libs:** `embeddings.ts`, repository `model-strategies` (`llm.ts` removed in W8a with the last
  scoring importers).
- **SDK removed:** model-strategies family. **npm/CI removed:** `pricing:refresh(:apply)`,
  `backfill:embeddings`, `refresh-model-pricing.yml`, `scripts/{refresh-model-pricing,
  backfill-embeddings,migrate-behavioral-ai}.mjs`, `test-semantic-guard.mjs`.
- **RETAINED:** `providers.ts` + `providers/providerRegistry.ts` (used by guard `predictive-risk`,
  the kept policy-generator, integration-health).

## Wave 8a — Scoring + evaluations (15 routes, 3 pages)

- **Rationale:** scoring profiles and eval runs are quality tooling, not the decide step. (Guard
  *calibration* is a different subsystem and survives.)
- **Deleting commit:** `72bb9b84` · **Last SHA containing it:** `12cd588f`
- **Routes (15):** `/api/scoring/**` (8), `/api/evaluations/**` (7).
- **Pages (3):** `scoring`, `evaluations`, `quality` (legacy redirect).
- **Libs:** `scoringProfiles.ts`, `scoring-ui.ts`, `eval.ts`, `llm.ts`, `demoScoringData.ts`,
  repository `evaluations`.
- **SDK removed:** scoring + evaluations families.
- **KEPT:** `guardrails/evaluator.ts` (used by `/api/policies/test`), `guard/calibration.ts`,
  `risk_templates` table + `guard/caches.ts:loadOrgRiskTemplates` (the Wave-0 risk-template port
  reads seeded templates). Also removed the `seedDefaultData` importers from the hosted-mint path
  (`/api/orgs`, `hosted-workspace.repository.ts`) — verified by `drill:hosted`.

## Wave 8b — Code sessions / optimal-files / skill-scan (21 routes, 3 pages)

- **Rationale:** code-session ingest, optimal-file recommendation, and CLAUDE.md generation are the
  agent-platform tier — the largest single lib tree removed (34 files under `app/lib/claude-code/**`).
- **Deleting commit:** `5a77ecc7` · **Last SHA containing it:** `72bb9b84`
- **Routes (21):** all `/api/code-sessions/**` (incl. optimal-files/manifests/memos/projects/
  ingest-jsonl/ingest-live/alerts/autopsy/insights/subagent-roi), `/api/skills/scan`,
  `/api/skills/scans/[id]`, `/api/cron/code-session-cache-crater`, `/api/cron/code-session-weekly-memo`.
- **Pages (3):** `code-sessions`, `code-sessions/[projectId]`, `code-sessions/[projectId]/[sessionId]`.
- **Libs:** `app/lib/claude-code/**` (incl. `pricing.ts` — importer-free after Waves 6 + 12),
  `app/lib/claude-code/optimal-files/**`, `skill-scanner.ts`, repository `skill-scan-results`.
- **Hooks:** `dashclaw_code_session_reporter.py` deleted (pretool skill-scan + stop-hook reporter
  already stripped in Wave 0C).
- **MCP tools removed:** `dashclaw_optimal_files_preview`, `dashclaw_optimal_files_manifest`,
  `dashclaw_skill_scan`. **MCP resources removed:** `dashclaw://code-sessions/projects`,
  `dashclaw://code-sessions/sessions/{id}` (6 → 4 resources here).

## Wave 9a — Messaging / threads / handoffs / open-loops (10 routes, 1 page)

- **Rationale:** an inter-agent messaging product is not governance. The one part of it the loop
  depends on — the assumption-ack — was carved out and kept.
- **Deleting commit:** `c85ae21e` · **Last SHA containing it:** `5a77ecc7`
- **Routes (10):** `/api/messages/attachments`, `/api/messages/threads`,
  `/api/messages/threads/[threadId]`, `/api/actions/[actionId]/messages`, `/api/handoffs*` (4),
  `/api/actions/loops`, `/api/actions/loops/[loopId]`.
- **Page:** `messages`. **Libs:** repository `code-session-handoffs`, `tutorial-handoffs` fixture.
- **MCP tools removed:** `dashclaw_inbox_list`, `dashclaw_messages_mark_read`, `dashclaw_handoff_*` (3),
  `dashclaw_loop_*` (3). **SDK removed:** messages / handoffs / loops families.
- **KEPT (RISK-2 ruling):** a **slim `/api/messages`** exposing only the assumption-ack `GET`/`PATCH`,
  plus `assumption-notify.ts` and the `agent_messages` table (retired-in-place). This leaves the
  pretool ack call and policy-smoke section N unchanged.

## Wave 9b — Reputation / leaderboard + routing engine (7 routes, 1 page)

- **Rationale:** agent reputation and a task-routing engine are marketplace/platform features.
- **Deleting commit:** `7d177362` · **Last SHA containing it:** `c85ae21e`
- **Routes (7):** `/api/reputation/**` (7). (The routing cron died in Wave 3.)
- **Page:** `reputation`. **Libs:** `reputation.ts`, repositories `reputation`, `routing`,
  `routing/{matcher,registry,router}.ts`.
- **SDK removed:** reputation family + legacy routing agents/tasks.

## Wave 10 — Drift engine (5 routes, 1 page)

- **Rationale:** behavioral drift detection is observability, off the loop.
- **Deleting commit:** `a2f3134b` · **Last SHA containing it:** `7d177362`
- **Routes (5):** `/api/drift/**`. **Page:** `drift`.
- **Libs:** `drift.ts`, `drift-tick.ts`, `demoDriftData.ts`, `scripts/migrate-drift.mjs`.
- **SDK removed:** drift family (Node + Python + legacy).
- **KEPT:** `app/lib/doctor/checks/drift.mjs` (artifact-shape drift — unrelated).

## Wave 11 — Compliance cockpit (11 routes, 2 pages) — with the signed-export fold

- **Rationale:** the compliance cockpit is a reporting product; its one durable value — signed
  evidence — **folds into the Prove layer** rather than dying. `/api/artifacts/evidence-bundle`
  was upgraded to sign via `app/lib/integrity/bundle.signBundle`; `/api/integrity/{jwks,verify}`
  and all of `app/lib/integrity/*` are kept.
- **Deleting commit:** `6f53f96a` · **Last SHA containing it:** `a2f3134b`
- **Routes (11):** `/api/compliance/**`. **Pages (2):** `compliance`, `compliance/exports`.
- **Libs:** `app/lib/compliance/*` (analyzer, effort, exporter, framework-labels, mapper, reporter,
  gap-to-policy, and the framework JSONs: gdpr, imda-agentic, iso27001, nist-ai-rmf, soc2),
  repository `compliance`, `compliance-fixtures`.
- **SDK removed:** compliance family (Python).

## Wave 12 — x402 / FinOps / billing / plan-quota (13 routes, 4 pages)

- **Rationale:** spend governance is real but is a **separate thesis** (RFC 0002, gated on Wes) —
  not this product. THESIS: "bankrupted" moves out of scope. `/api/cron/reset-meters` was
  reclassified KILL (it purges `usage_meters`).
- **Deleting commit:** `160aeeb9` · **Last SHA containing it:** `6f53f96a`
- **Routes (13):** `/api/x402/**` (6), `/api/finops/spend`, `/api/usage`, `/api/usage/costs`,
  `/api/actions/costs`, `/api/billing/checkout`, `/api/billing/portal`, `/api/webhooks/stripe`,
  `/api/cron/reset-meters`.
- **Pages (4):** `spend`, `spend/x402`, `spend/code`, `usage`.
- **Libs:** `usage.ts`, repositories `tokens`, `x402`, `finops`, `code-sessions` (cost repo),
  `types/{x402,pricing-finops}.ts`.
- **OpenClaw plugin:** the x402 subsystem stripped from `packages/openclaw-plugin/src/index.ts`
  (config + detect/guard/parse/record fns); core before/after tool-call governance kept.
- **SDK removed:** x402 family. **npm scripts removed:** `diagnose:cost`, `backfill:null-model-cost`,
  `scripts/{seed-x402-sample,backfill-x402-provider-id}.mjs`.
- **PRESERVED:** policy-smoke `L1`/`L2` (the `block_action_type` identity family — on-thesis).

## Wave X — Managed secrets + status-widget PWA (6 routes, 2 pages)

- **Rationale:** a managed-secret vault and a standalone status widget are both off the loop.
- **Deleting commit:** `e663ee23` · **Last SHA containing it:** `160aeeb9`
- **Routes (6):** `/api/secrets/**` (5, incl. `secrets/env` = `getAgentEnv` delivery),
  `/api/widget/summary`. **Pages (2):** `secrets`, `widget`.
- **Libs:** repository `governed-secrets`, `widget/summary.ts`, `widgetPrefs.ts`.
- **MCP tools removed:** `dashclaw_secret_list`, `dashclaw_secret_due`, `dashclaw_secret_mark_rotated`.
- **SDK removed:** `getAgentEnv` / `get_agent_env`.
- **RETAINED:** `governed_secrets` table + `drizzle/0032_managed_secrets.sql` (retire-in-place).

## Wave 13 — Capabilities / agent-registry residue (11 routes, 5 pages) — seam preserved

- **Rationale:** the capability registry CRUD/UI is a platform product; the **`dashclaw_invoke`
  enforcement seam explicitly survives** (THESIS). Only the create/edit/registry surface dies.
- **Deleting commit:** `a11e7963` · **Last SHA containing it:** `e663ee23`
- **Routes (11):** `/api/capabilities/[id]`, `/[id]/access`, `/[id]/access/[ruleId]`, `/[id]/health`,
  `/[id]/history`, `/[id]/test`, `/api/capabilities/health`, `/api/agents/invoke`,
  `/api/agents/registry` (×3). (`POST createCapability` also removed from `/api/capabilities`.)
- **Pages (5):** `capabilities`, `capabilities/new`, `capabilities/[capabilityId]`,
  `capabilities/[capabilityId]/edit`, `agents/registry`.
- **Libs:** `agent-registry.ts`, `capability-history.ts`, repository `registered-agents`.
- **MCP resource removed:** `dashclaw://capabilities` (4 → 3 resources). **SDK removed:** capabilities
  CRUD/test/health/history + agent-registry families (Node + Python).
- **KEPT (DEMOTE seam):** `GET /api/capabilities` (list source), `/api/capabilities/[id]/invoke`,
  `/api/capabilities/[id]/access/check`, `dashclaw_invoke`, `dashclaw_capabilities_list`, and the
  libs `capability-{access.repository,runtime,health,invoke}` + `capabilities.repository`.
- **SHIP-NOTE:** the surviving `dashclaw_invoke` seam has **no in-product create/edit path** post-cull
  (inert-by-default; fed by manual SQL). Recorded here per THESIS residue intent.

## Wave 14 — MCP provider-fork + launch + local scaffolding (~9k lines)

- **Rationale:** the MCP server had re-imported the archived platform's provider toolset
  (Stripe/Vercel/Neon/Twilio/Namecheap/Supabase/Sentry/GitHub/Clerk/Cloudflare-R2/Resend/Upstash/
  PostHog/Railway). ~19k lines contradicting "a minimal governance runtime, not an agent platform."
- **Deleting commit:** `c67b6046` · **Last SHA containing it:** `a11e7963`
- **Deleted (`mcp-server/src`):** `provider-actions.ts`, `providers/**` (14 provider modules + auth +
  http + shape), `launch/**` (checks, index, playbook, store, types), and the orphaned
  `actions.ts`, `cli.ts`, `context.ts`, `policy.ts`, `sql.ts`, `dashclaw/guard.ts`, `config.ts`.
  `mcp-server/lib/**` (checked-in tsc output) rebuilt to match.
- **MCP tool groups removed:** the ~82 provider tools, the launch-plan tools
  (`create_launch_plan`/`get_launch_status`/`preflight_launch`/`verify_launch`), the local
  scaffolding tools (project/environment/connection/provider-mapping/app-env/logs/project-memory),
  and the duplicate local-governance store (`check_policy`, `simulate_action`, `list/set_policy_rule`,
  `list_pending_approvals`, `approve_action`, `reject_action`, `list/export_audit_log`,
  `explain_action_risk`, `governed_action_summary`, local `doctor`). None were in the "33 governance
  tools" count. The MCP server now registers only the governance surface (12 `dashclaw_*` tools +
  the 3 DashClaw-gated `dashclaw_status`/`dashclaw_recent_decisions`/`export_dashclaw_evidence`).

## Wave 15 — Legacy SDK subpath + Python langchain extra

- **Rationale:** the deprecated `dashclaw/legacy` Node subpath had its removal **promised for v5**;
  the LangChain adapter served the platform surface.
- **Deleting commit:** `bf42c999` · **Last SHA containing it:** `c67b6046`
- **Deleted:** `sdk/legacy/dashclaw-v1.js`, `sdk/legacy/index-v1.cjs`,
  `sdk-python/dashclaw/integrations/langchain.py`. The `./legacy` export block dropped from
  `sdk/package.json`; the `[optional-dependencies] langchain` extra dropped from `pyproject.toml`;
  `actionContext.sendMessage` (messaging) removed. Node SDK 149 → 28, Python 234 → 51.

## Wave 16 — CLI collapse (21 → 13 commands)

- **Rationale:** the CLI keeps the install/run/doctor/approvals path; the platform-tier commands go.
- **Deleting commit:** `141087b9` · **Last SHA containing it:** `bf42c999`
- **Commands removed (8):** `code`, `prompts`, `inbox`, `behavior`, `posture`, `cost`, `next`,
  `env` (managed-secret delivery — verdict corrected from KEEP).
- **Deleted:** `cli/lib/code/**` (6 files), `cli/lib/cost.js`, `cli/lib/env.js`, `cli/lib/posture.js`,
  `app/lib/codex/parser.ts`, and their tests/fixtures.
- **KEPT (13):** `up`, `down`, `install`, `doctor`, `import`, `approvals`, `approve`, `deny`,
  `logout`, `codex`, `halt`, `help`, `version`.

## Wave 17 — Docs, marketing, superseded-doc archival, process-exhaust, CI cleanup

- **Rationale:** the docs and marketing describe the product; they were realigned to the enforcement
  loop, superseded strategy docs were archived (not erased), and the platform-convergence-era CI
  harness was removed.
- **Deleting commits:** `5552d1b5`, `d21e032e`, `1190d077`, `ef76e4f3`, `1cb9cf45` ·
  **Last SHA containing it:** `141087b9`
- **Deleted:** `PRODUCT.md` (superseded by THESIS), `docs/{behavior-learning,fleet-digest,
  ANALYTICS-ROLLOUT}.md`, the WS1 latency evidence JSONs + collectors
  (`check-convergence-ws1-latency.mjs`, `collect-platform-convergence-evidence.mjs`),
  `poll-github-traffic.mjs`, `verify-demo-e2e.mjs`, and the orphaned
  `dashclaw_agent_intel/{behavior_recorder,stop_uploads}.py` (+ their tests + plugin mirrors).
- **npm scripts / CI removed:** `reliability:evidence`, `reliability:ws1:check` (+ its `ci.yml` step),
  `traffic:poll`.
- **Archived (git mv, recoverable in place):** the platform-convergence / hardening /
  typescript-migration / adaptive-learning / sdk-consolidation strategy docs and RFCs 0001/0002,
  moved under `docs/plans/archive/` per THESIS "Superseded documents."

## Wave 18 — Surface-budget CI brake (anti-regrowth gate; additive)

- **Rationale:** the 2026-03 purge regrew to full sprawl in four months. This time the brake is
  mechanical and shipped.
- **Commit:** `56dbfa0e` · Adds `scripts/check-surface-budget.mjs`, `contracts/surface-budget.json`,
  `npm run surface:check`, the `__tests__/unit/surface-budget.test.js` test, and the `ci.yml` wiring.
  Records the v5.0.0 ceilings in THESIS.md. Exceeding any ceiling fails the build unless the commit
  also amends THESIS.md with a written reason.

---

## MCP tools removed (33 → 12)

21 `dashclaw_*` tools removed: `dashclaw_posture`, `dashclaw_posture_next` (W2);
`dashclaw_work_order_submit`, `dashclaw_work_order_status` (W3);
`dashclaw_learning_log`, `dashclaw_learning_query`, `dashclaw_behavior_suggestions` (W6);
`dashclaw_optimal_files_preview`, `dashclaw_optimal_files_manifest`, `dashclaw_skill_scan` (W8b);
`dashclaw_inbox_list`, `dashclaw_messages_mark_read`, `dashclaw_handoff_create`,
`dashclaw_handoff_latest`, `dashclaw_handoff_consume`, `dashclaw_loop_add`, `dashclaw_loop_list`,
`dashclaw_loop_close` (W9a); `dashclaw_secret_list`, `dashclaw_secret_due`,
`dashclaw_secret_mark_rotated` (WX). Plus the entire non-governance provider/launch/local toolset (W14).

**Surviving 12:** `dashclaw_guard`, `dashclaw_record`, `dashclaw_invoke`, `dashclaw_capabilities_list`
(DEMOTE), `dashclaw_policies_list`, `dashclaw_wait_for_approval`, `dashclaw_session_start`,
`dashclaw_session_end`, `dashclaw_session_retro`, `dashclaw_assumption_record`,
`dashclaw_decisions_recent`, `dashclaw_pair` — plus 3 DashClaw-gated tools in `tools/index.ts`
(`dashclaw_status`, `dashclaw_recent_decisions`, `export_dashclaw_evidence`).

**MCP resources removed (6 → 3):** `dashclaw://capabilities` (W13),
`dashclaw://code-sessions/projects`, `dashclaw://code-sessions/sessions/{id}` (W8b).
Surviving: `dashclaw://policies`, `dashclaw://agent/{id}/history`, `dashclaw://status`.

## SDK method families removed (Node 149 → 28, Python 234 → 51)

fleet presence (`heartbeat`/`reportConnections`/`startHeartbeat`/`stopHeartbeat`); open-loops
(`registerOpenLoop`/`resolveOpenLoop`); handoffs (`createHandoff`/`getLatestHandoff`); managed
secrets (`getAgentEnv`); learning; prompts library; scoring + evaluations; messages/threads
(incl. `actionContext.sendMessage`); workflows; model-strategies; knowledge collections;
capabilities CRUD/invoke/test/health/history; reputation; agent registry; x402/providers/purchases;
work orders; drift; compliance; the entire **legacy CRM tier** (goals/content/relationships/calendar/
ideas/memory/threads/snippets/preferences/mood/approach/digest), legacy routing agents/tasks, legacy
webhooks/sync/org-admin/token-usage/wrapClient, the `dashclaw/legacy` subpath + `OpenClawAgent` alias,
and the Python `dashclaw[langchain]` extra.

**Surviving governance core:** guard / runGoverned / guardedFetch; createAction / updateOutcome /
getAction / getActionGraph / reportActionOutcome(+Success/Failure/Partial) / getActionOutcome;
getPendingApprovals / approveAction / waitForApproval; recordAssumption; createPairing /
waitForPairing / register_identity / get_identities; scanPromptInjection; getSignals; session CRUD;
deriveIdempotencyKey / action_context; getGuardDecisions; simulatePolicy / testPolicies /
getProofReport / importPolicies.

## CLI commands removed (21 → 13)

`code`, `prompts`, `inbox`, `behavior`, `posture`, `cost`, `next`, `env`.

## Guard policy types removed (17 → 14)

`semantic_check`, `behavioral_anomaly`, `x402_spend_limit`.
**Surviving 14:** risk_threshold, require_approval, block_action_type, warn_action_type, allow_grant,
protected_path, agent_allowlist, rate_limit, webhook_check, non_fabrication, permission_escalation,
green_contract, branch_freshness, require_evidence.

## npm scripts removed

`pricing:refresh`, `pricing:refresh:apply` (W7); `backfill:embeddings` (W7);
`migrate:behavioral`, `migrate:learning-loop`, `backfill:learning-episodes`,
`rebuild:learning-recommendations` (W6); `diagnose:cost`, `backfill:null-model-cost` (W12);
`reliability:evidence`, `reliability:ws1:check`, `traffic:poll` (W17). Plus dozens of one-off
`scripts/*.mjs` seed/migrate/backfill/test helpers for the dying subsystems (enumerated per wave above).

## Demotions (survive, but off the front door)

- **Hosted trial (hosted.dashclaw.io) → secondary door.** `/api/hosted/*` and
  `/api/workspace/{export,import}` kept (DEMOTE); no funnel step points a stranger at a credential
  before a block fires. The graduation/export path survives with it.
- **/proof + `/api/self-governance` → off the front door.** The "an AI maintains this under its own
  governance" story moves to an about/proof page; it is supporting evidence, not the pitch.
- **Calibration → constitutional default.** The distribution-free interruption controller ships
  **on**, in its constitutional mode: anything that loosens enforcement is a proposal a human
  ratifies with one click in `/policies` (MAINTAINER.md §3).
- **`dashclaw_invoke` capability seam → inert-by-default.** The enforcement seam survives with no
  in-product create/edit path (fed by manual SQL). `dashclaw_capabilities_list` demoted to the
  list-source for the seam.
- **API-only DEMOTEs (off nav):** `/api/activity`, `/api/operations/summary`, `/api/security/status`,
  `/api/settings/test`. **Page DEMOTEs:** `/proof`, `/practical-systems`, `/guides/platform`
  (regenerated smaller, "1,400+" headline dropped).

## Retired-in-place tables (no destructive migration)

Per THESIS "what dies" and MAINTAINER.md constitution-safety, **no destructive DB migration ships
with the cull.** Every table below stays physically in `schema/schema.js` + `drizzle/*.sql`; code
simply stops reading/writing it. A documented **export-then-drop** path can follow separately (see
`docs/releases/v5-migration.md`). `drizzle-kit generate` was **not** run for any removal.

Retired: `registered_agents`, `registered_agent_capabilities`, `capability_access_rules`,
`agent_invocations`; `code_projects`, `code_sessions`, `code_session_messages`,
`code_session_tool_uses`, `code_session_signals`, `code_session_alerts`, `code_session_memos`,
`code_optimal_file_manifests`, `code_session_handoffs`; `work_order_types`, `work_orders`,
`work_order_receipts`; `workflows`, `executions`, `scheduled_jobs`, `workflow_step_results`,
`workflow_templates`; `prompt_templates`, `prompt_versions`, `prompt_runs`, `snippets`;
`action_embeddings`, `entities`, `topics`, `context_points`, `context_entries`, `knowledge_chunks`,
`knowledge_collections`, `knowledge_collection_items`; `learning_episodes`, `learning_recommendations`,
`learning_recommendation_events`, `learning_velocity`, `learning_curves`, `health_snapshots`;
`behavior_samples`, `behavior_dismissals`; `feedback`, `user_observations`, `user_preferences`,
`user_moods`, `user_approaches`, `notification_preferences`; `drift_baselines`, `drift_alerts`,
`drift_snapshots`; `scoring_profiles`, `scoring_dimensions`, `profile_scores`, `risk_templates`;
`agent_reputation_events`, `agent_reputation_receipts`, `agent_reputation_snapshots`;
`routing_agents`, `routing_tasks`, `routing_agent_metrics`, `routing_decisions`; `eval_scorers`,
`eval_scores`, `eval_runs`, `guardrails_test_runs`; `compliance_snapshots`, `compliance_exports`,
`compliance_schedules`; `agent_messages`*, `message_threads`, `shared_docs`, `message_attachments`;
`governed_secrets`; `open_loops`; `model_strategies`; `x402_providers`, `x402_endpoints`,
`x402_purchases`, `token_snapshots`, `daily_totals`, `token_budgets`, `usage_meters`;
`posture_findings_state`, `posture_snapshots`; `agent_presence`, `agent_connections`;
`skill_scan_results`; the legacy workspace tier (`goals`, `milestones`, workspace `decisions`,
`content`, `ideas`, `contacts`, `interactions`, `calendar_events`, `waitlist`); `invites`.

\* `agent_messages` is retained *and still read/written* by the slim assumption-ack survivor
(`/api/messages` GET/PATCH) — it is listed as "retired product" but the ack seam keeps it live.
