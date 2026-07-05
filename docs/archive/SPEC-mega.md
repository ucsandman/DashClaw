# SPEC-mega: three features for DashClaw

Phase 1 plan, 2026-06-04. Three capability groups land as first-party DashClaw features following existing patterns: Group A (cleanup and integration), Group B (Agent Reputation), Group C (Agent Registry). The API is already cleaned up and contracts are stable; this spec matches the contracts as they exist in the code, with citations from `docs/absorbed-projects.md`.

Each item is marked IN SCOPE (implement in Phase 2) or OUT OF SCOPE (document only, with a one line reason). The bias is conservative: anything that is a large migration, risky, or reaches outside its area is OUT OF SCOPE. The three groups are ordered so each is an independently valid checkpoint: A, then B, then C. C depends on B for the trust metric and on the existing capability runtime for invocation.

## Facts that override the brief

The investigation found three places where the brief's stated assumption is contradicted by the code. Phase 2 follows the code, not the assumption.

1. No dual better-sqlite3 mode. `better-sqlite3` is declared but never imported (`package.json:82`). The dual driver is Neon versus postgres.js, both Postgres (`app/lib/db.js:61-66`, `scripts/_db.mjs:30-34`). New migrations are single-dialect Postgres DDL authored as a `drizzle/NNNN_*.sql` file (next sequence is `0018`), not a standalone `migrate-*.mjs` (those are legacy catch-up tools and are not run by `npm run db:migrate`, which only applies `drizzle/*.sql` via `scripts/auto-migrate.mjs:70-194`).
2. The signer is Ed25519 via `node:crypto`, not tweetnacl (`app/lib/integrity/sign.js:9`, `app/lib/integrity/keys.js:15-18`). Reputation receipts reuse this and add no new crypto dependency.
3. Signature verification does not use `timing-safe.js`. It is `verifyCanonical` over `node:crypto` verify (`app/lib/integrity/sign.js:30-42`). `timing-safe.js` is for secret comparison, not signatures, and is not needed by reputation receipts.

## Shared reuse seams (used by B and C, never reimplemented)

- Guard gate: `evaluateGuard(orgId, context, sql, options)` (`app/lib/guard.js:112`).
- Risk: `RISK_SCORE_MAP` (`app/lib/capability-invoke.js:10-15`), `computeStatisticalAdjustment` and `getPredictiveRisk` (`app/lib/predictive-risk.js:32,167`). Whole scale is integer 0-100, base plus clamped signed adjustment (`app/lib/guard.js:220-249`). `risk_class` maps 1:1 to capability `risk_level`.
- Action ledger: `createActionRecord` (`app/lib/repositories/actions.repository.js:234`), `createBlockedActionRecord` (`:304`), `updateActionOutcome` (`:409`). Table is `action_records`.
- Capability invocation: `prepareCapabilityInvocation` (`app/lib/capability-runtime.js:22`), `executeCapabilityInvocation` (`:46`), which already does auth (none, bearer, api_key), timeout, retry with backoff, request and response mapping, and SSRF defense (`app/lib/capability-invoke.js:82-100` via `app/lib/webhooks.js`).
- Integrity: `digestJson` (`app/lib/integrity/canonicalize.js:93`), `signCanonical` and `verifyCanonical` (`app/lib/integrity/sign.js:19,30`), `getServerSigningKey` and `getServerPublicJwks` (`app/lib/integrity/server-key.js:58,101`). The signing key is instance-global, no `org_id` (`app/lib/repositories/signing-keys.repository.js:2-7`).

These modules are reused by import. Phase 2 does not modify `guard.js`, `predictive-risk.js`, `capability-invoke.js`, `capability-runtime.js`, the integrity layer, or `signing-keys.repository.js`. The one exception is the optional shared-helper extraction in C3, which is flagged for an explicit user decision because it touches the capability invoke route.

---

## Group A: cleanup and integration

Independently valid checkpoint. No dependency on B or C. Touches policy and compliance areas only.

### A1. Policy authoring as testable recipes. IN SCOPE.

Current contract: `POST /api/policies/test` ignores its request body and runs derived tests over current active policies through the weaker guardrailgen conversion path (`evaluateGuardrailPolicy`, which only understands block and approval) (`app/api/policies/test/route.js:15-70`, `app/lib/guardrails/evaluator.js:15`). A `rules.tests` array exists only as an import passthrough (`app/api/policies/import/route.js:96-102`); the authoring form never writes it (`app/policies/lib/policyFormModel.js`).

Build:
- Add an optional `tests` array inside a policy's `rules` JSON, each entry `{ name, input (an example action context), expect: { decision } }` where `decision` is one of `allow | warn | block | require_approval` (`app/lib/validate.js:264`). Allow it through `POLICY_SCHEMA` (`app/lib/validate.js:266-272`) and emit it from the authoring form model.
- Extend `POST /api/policies/test` to accept an optional body `{ policy_type, rules, tests }` and, when present, run each inline recipe through the real enforcement evaluator `evaluatePolicy(dummyPolicy, rules, context, sql, orgId)` (`app/lib/guard.js:515`, the same one `simulate` uses), comparing the produced decision to `expect.decision`. Keep the existing no-body behavior unchanged for backward compatibility.

Constraints: `/api/policies` is a stable prefix, so regenerate the OpenAPI and inventory artifacts and confirm no drift (adding optional body handling does not change the generated operation shape, which is derived from path and method only, `scripts/generate-openapi.mjs:30-84`). No inline SQL in the route; route through `guardrails.repository.js` and the guard lib.

Tests: a unit test that an inline recipe expecting `block` passes when the rule blocks and fails when it does not; a test that an empty body preserves the legacy derived-test response shape.

### A2. Policy packs as the primary start-with-safe-defaults flow with preview before import. IN SCOPE.

Current contract: `POST /api/policies/import` already supports a conflict-aware dry run via `?preview=true` returning `{ preview, would_create, would_skip, policies:[{ name, policy_type, rules, conflict, conflict_reason? }] }` (`app/api/policies/import/route.js:64-86`), but no UI calls it (the import panel is positioned as an advanced expert overlay and POSTs directly without preview, `app/policies/components/PolicyAdvancedImportPanel.jsx`, `CustomTab.jsx:203-225`). Pack metadata is in `app/lib/policyPackPreviews.js` and the read-only template preview is `GET /api/policies/templates` (`app/api/policies/templates/route.js:9-46`).

Build (UI, server contract already exists):
- Make pack selection the primary path: a guided "start with safe defaults" step that lists the packs from `policyPackPreviews.js` plus the per-policy preview from `/api/policies/templates`, then calls `import?preview=true` to show exactly what would be created and which names conflict, then commits on confirm.
- Keep raw YAML or JSON as a clearly secondary advanced escape hatch (the existing panel), not the default.

Constraints: this is a frontend change. Read `.impeccable.md` first and use CSS tokens from `app/globals.css`; never hardcode hex. Reuse existing UI components. No new server route is required.

Tests: a component test that the preview step renders `would_create` and `conflict` from a mocked `import?preview=true` response and only commits after confirmation.

### A3. Replace alert()-based policy simulation with an in-page result panel. IN SCOPE.

Current contract: `handleSimulate` posts to `/api/policies/simulate` then surfaces only a native `alert(...)` with summary counts and discards the rich `matches[]` array (`app/policies/components/CustomTab.jsx:259-272`). `/api/policies/test` already has an in-page panel pattern to mirror (`CustomTab.jsx:414-466`).

Build: replace the `alert` with an in-page panel that shows the likely impact before save or activate: the summary counts (`total, matches, block, warn, require_approval, allow`) and a few sample matched actions (`action_id, goal, simulated_action, simulated_reason`) from the response (`app/api/policies/simulate/route.js:69-74`).

Constraints: frontend change, design-context prerequisite as in A2. No server change.

Tests: a component test that the panel renders summary and sample matches from a mocked simulate response and that no `window.alert` is called.

### A4. Per-policy observe, warn, enforce dry-run lifecycle. OUT OF SCOPE (document only).

Reason: it does not exist (only `active` 0/1 plus the per-rule `action` severity, `schema/schema.js:534-545`, `app/lib/validate.js:264`), and a real lifecycle requires a new `guard_policies.mode` column plus a behavior branch in the hot enforcement path `evaluateGuard` (match without escalating, force allow when all matches are dry-run, record `policy_mode` on the decision) plus UI state. That is a risky change to the core guard path. The existing `POST /api/policies/simulate` already provides ad-hoc dry-run against history, and the guardrails proposal `proposals/dashclaw-policy-dry-run-mode.md` is the reference design if this is built later. Per the brief, do not build the migration; document the gap only.

### A5. Compliance page versus API contract. IN SCOPE.

Current contract: the compliance page reads several fields the API does not return under those names (confirmed mismatches):
- Page reads `controlMap.coverage.{total,covered,partial,gaps}` (`app/compliance/page.jsx:160-163,247-263`); API returns `summary.{total_controls,covered,partial,gaps,coverage_percentage}` (`app/lib/compliance/mapper.js:42-72`). The coverage rail renders zeros.
- Page reads `gapAnalysis.{gaps,remediations,risk_level,narrative}` and treats `quick_wins` as a string (`app/compliance/page.jsx:165-167,393-399`); API returns `remediation_plan`, `risk_assessment.overall_risk` (UPPERCASE), `risk_assessment.narrative`, and `quick_wins` as an array (`app/lib/compliance/analyzer.js:37-50`). The gap analysis, risk badge, and quick wins render wrong or empty.
- Page reads `control.recommendations`; API field is `gap_recommendations` (`app/lib/compliance/mapper.js:106-115`). The per-control recommendation list renders empty.
- The evidence card and basic control list (id, title, status, matched_policies) already align (`app/api/compliance/evidence/route.js:30-42`).

Build: fix the page (the broken consumer) to read the actual API shapes, since the API output is the canonical shape also consumed by `reporter.js` and the absorbed compliance engine. Map `summary.*`, `remediation_plan`, `risk_assessment.{overall_risk,narrative,immediate_actions}`, `quick_wins` as an array, `gap_recommendations`, and normalize the uppercase risk levels. Also add `imda-agentic` to the page `FRAMEWORK_LABELS` map so it does not render with a raw id.

Constraints: frontend change, design-context prerequisite. The page is `.jsx`, so it is unit-testable (per the project memory on testable pages). Do not change the API shapes.

Tests: a component test pinning that the page reads `summary.total_controls`, `summary.coverage_percentage`, `remediation_plan`, `risk_assessment.overall_risk`, and `quick_wins` as an array from a mocked API response and renders non-zero coverage.

### A6. Path from compliance gaps to policy creation. IN SCOPE (scoped helper plus documented next step).

Current contract: nothing links a gap to policy creation; `gap_recommendations` are free-text strings (`app/api/compliance/gaps/route.js`, `app/lib/compliance/frameworks/soc2.json:31-35`). The only suggestion-to-policy bridge is `generatePolicySuggestions` (`app/lib/policy-suggestions.js:5-103`), driven by feedback and drift, returning `suggested_policy:{ name, policy_type, rules (JSON string), agent_ids }`.

Build (scoped, deterministic, no LLM):
- Add a small helper `gapToPolicyDraft(control)` that maps a gap's expected `policy_mappings[].policy_pattern` plus `tool_patterns` to a prefilled policy draft `{ policy_type, rules }` for the patterns DashClaw already recognizes (`block`, `require_approval`, `allowlist`, `rate_limit`, `risk_threshold`, per `app/lib/compliance/mapper.js:142-168`), reusing the `suggested_policy` shape and the policy authoring model `app/policies/lib/policyFormModel.js`.
- From the compliance gap UI, add a "Create policy from this gap" deep-link that opens the policy authoring form prefilled with that draft.
- Controls whose recommendation is purely free text (no recognized pattern) show the recommendation text with a documented manual path, not a prefill.

Constraints: frontend plus a small lib helper. No new server route required. Design-context prerequisite for the UI. No inline SQL.

Tests: a unit test that `gapToPolicyDraft` produces a valid `{ policy_type, rules }` for a `block` control and returns null for a free-text-only control.

### A7. Recommended future CLI commands. OUT OF SCOPE (document only).

Reason: the brief says recommend, and do not create a new published package unless clearly aligned. The existing `cli/` package already has subcommands (`code`, `prompts`, `inbox`, per the project memory). Document recommended additive subcommands that fit that package and the new routes: `dashclaw reputation get <agentId>`, `dashclaw reputation recompute <agentId>`, `dashclaw registry list`, `dashclaw registry invoke <id> <capability>`. Do not implement in Phase 2.

---

## Group B: Agent Reputation

Independently valid checkpoint. Depends on nothing new. Sources from the existing evidence layer and reuses the existing risk and integrity primitives.

### B1. Migration. IN SCOPE.

Author `drizzle/0018_agent_reputation.sql` (next sequence after `0017`), Postgres-only, idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), org-scoped, following the `capabilities` and `governed_secrets` exemplars (`drizzle/0000_clammy_falcon.sql:1087-1109`, `drizzle/0007_agent_toolkit_into_runtime.sql:25-41`). Statements separated by `--> statement-breakpoint`. Do not author a standalone `migrate-*.mjs` (legacy path). Optionally mirror the tables in `schema/schema.js` as `pgTable(...)` for livingcode and drizzle-kit tracking.

Three tables, fields derived from the Agent-Reputation-Oracle reference (`docs/absorbed-projects.md` section 4) and the DashClaw mapping:

- `agent_reputation_events` (`are_` prefix id): `id text PK`, `org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, `agent_id text NOT NULL`, `source_agent_id text` (the reporter, nullable; self-attestation guarded when equal to `agent_id`), `event_type text NOT NULL`, `weight real`, `value real`, `action_id text` (link to the source `action_records` row when derived), `occurred_at timestamptz NOT NULL`, `metadata jsonb DEFAULT '{}'::jsonb`, `created_at timestamptz DEFAULT now()`. Index on `(org_id, agent_id, occurred_at)`. Append-only.
- `agent_reputation_snapshots` (`ars_` prefix id, the snapshot, one current row per agent): `id text PK`, `org_id text NOT NULL`, `agent_id text NOT NULL`, `reliability_score real`, `completion_rate real`, `policy_violation_rate real`, `approval_adherence real`, `quality_score real`, `risk_score integer`, `volume_weight real`, `confidence real`, `total_events integer NOT NULL DEFAULT 0`, `last_event_at timestamptz`, `computed_at timestamptz NOT NULL`, `vector_hash text NOT NULL`. Unique `(org_id, agent_id)` via `UNIQUE NULLS NOT DISTINCT` or a `COALESCE` expression index (do not use `ON CONFLICT ON CONSTRAINT` against an expression index). Upsert on recompute.
- `agent_reputation_receipts` (`arr_` prefix id): `id text PK`, `org_id text NOT NULL`, `agent_id text NOT NULL`, `vector_hash text NOT NULL`, `receipt jsonb NOT NULL` (the signed envelope), `kid text NOT NULL`, `issued_at timestamptz NOT NULL`, `created_at timestamptz DEFAULT now()`. Index on `(org_id, agent_id, created_at)`.

Naming note: the vector dimension is `policy_violation_rate` (DashClaw blocks and denials) rather than the oracle's `dispute_rate`, and `approval_adherence` rather than `sla_adherence`, matching DashClaw signals. Both satisfy the brief's "dispute or policy_violation_rate" and "sla or approval_adherence".

### B2. reputation.repository.js and reputation.js. IN SCOPE.

- `app/lib/repositories/reputation.repository.js`: all SQL. Reads events, upserts snapshots, inserts and reads receipts, queries the evidence sources for an `(org_id, agent_id)` window (using the existing aggregators where possible: `getActionStats`, `getCostAggregation`, `listGuardrailDecisions`, `listEvalScores` with its action_records join, the `feedback` lib). Org-scoped `WHERE org_id = ${orgId}` on every query, no cross-org reads.
- `app/lib/reputation.js`: deterministic, dependency-free vector computation ported from the oracle math (`src/reputation/{decay,math,engine}.ts`):
  - Decay: `lambda = ln(2)/halfLifeDays`, `weight = e^(-lambda*deltaDays)`, default half-life 90 days, future events clamped to 1.0.
  - Smoothing: pseudo-count Bayesian average with the documented priors.
  - Volume: `ln(1 + sum(weights))`. Confidence: `1 - e^(-0.1*volumeWeight)`.
  - The vector includes at least `agent_id, reliability_score, completion_rate, policy_violation_rate, approval_adherence, quality_score, risk_score, volume_weight, confidence, total_events, last_event_at, computed_at`.
- REUSE crypto: hash the vector with `digestJson(vector)` (which routes through `canonical-json.js`), sign a receipt with `signCanonical(base, { kid, privateKeyJwk })` via `getServerSigningKey(sql)`, verify with `verifyCanonical`. Add no new crypto dependency (Ed25519 via `node:crypto`). The receipt uses the instance-global signing key; `org_id` and `agent_id` are inside the signed payload. Per-org issuer identity is OUT OF SCOPE (a schema change to `server_signing_keys`).
- RECONCILE risk: the `risk_score` dimension wraps DashClaw's existing risk numbers. Compute it from the agent's stored `action_records.risk_score` values (which already fold in `computeRiskScore` plus the predictive adjustment at write time), on the same integer 0-100 scale. Do not invent a parallel risk formula and do not duplicate `RISK_SCORE_MAP`.

Tests: decay weight at the half-life equals 0.5; Bayesian average with zero events equals the prior; volume and confidence monotonic in event count; vector hash determinism (same vector, same `digestJson`); receipt sign then verify round-trip; org-scoped event listing excludes other orgs.

### B3. Routes. IN SCOPE (core); leaderboard and summary optional IN SCOPE; recompute-all OUT OF SCOPE.

No inline SQL in any route; all SQL in `reputation.repository.js`. The `/api/reputation` prefix is unlisted, so it classifies as experimental and appears only in the inventory, not the OpenAPI spec (`scripts/lib/api-route-inventory.mjs:93-96`); regenerate the inventory. Org-scoped via `getOrgId(request)`; no cross-org lookup; a missing agent returns a clean 404.

- `GET /api/reputation/agents/[agentId]`: the current snapshot vector (recompute on demand if stale).
- `GET /api/reputation/agents/[agentId]/events`: paginated events, org-scoped.
- `POST /api/reputation/agents/[agentId]/recompute`: recompute the vector from evidence, upsert the snapshot, return the vector.
- `GET /api/reputation/agents/[agentId]/receipt`: the signed receipt for the current vector.
- `POST /api/reputation/verify`: verify a posted receipt via `verifyCanonical` against `getServerPublicJwks`. A dedicated route (do not overload `/api/integrity/verify`, which branches only on `body.receipt` and `body.bundle`).
- Optional IN SCOPE if easy: `GET /api/reputation/leaderboard` (top agents by reliability in the org), `GET /api/reputation/agents/[agentId]/summary`.
- OUT OF SCOPE: a recompute-all endpoint, because iterating every agent in an org is a batch job better suited to a cron or admin action and risks an unbounded request. Document it as a future scheduled job.

### B4. Evidence sourcing. IN SCOPE.

Source first from the straightforward evidence, architected so drift, learning, and scoring can be added later behind the same source interface:
- Spine: `action_records` (`agent_id` NOT NULL), using `outcome_status` as the success ground truth where present and falling back to `status` (the engine must understand both axes, `app/lib/repositories/actions.repository.js:498-506`). Feeds `completion_rate`, `reliability_score`, `risk_score`, `volume_weight`.
- `guard_decisions`: blocks and denials feed `policy_violation_rate`; `agent_id` is nullable so unattributed rows are skipped.
- `eval_scores` and `profile_scores`: feed `quality_score` (join `eval_scores` to `action_records` on `(action_id, org_id)`).
- approvals (`action_records.approved_by`, `outcome_status`): feed `approval_adherence`.
- `feedback` lib (`app/lib/feedback.js`): optional sentiment input via direct lib call (routes are archived; do not add a route).
- Deferred to a later pass (architected for, not built): `drift` (needs the `agent_name` versus `agent_id` reconciliation, `app/lib/drift.js:131,176-177`), `learning_recommendations` (already a per-agent success-rate rollup), and scoring profiles beyond `profile_scores`.

### B5. SDK methods, docs, and tests. IN SCOPE.

- Node (`sdk/dashclaw.js`, 2-space `async camelCase`): `getAgentReputation(agentId)`, `listAgentReputationEvents(agentId, filters)`, `recomputeAgentReputation(agentId)`, `getAgentReputationReceipt(agentId)`, `verifyReputationReceipt(receipt)`. All via `this._request(...)`.
- Python (`sdk-python/dashclaw/client.py`, 4-space `def snake_case`): `get_agent_reputation`, `list_agent_reputation_events`, `recompute_agent_reputation`, `get_agent_reputation_receipt`, `verify_reputation_receipt`.
- Docs: add a Reputation section across the manual doc surfaces in the project memory SDK checklist (`app/docs/page.js`, `sdk/README.md`, `sdk-python/README.md`, `docs/sdk-parity.md`, `PROJECT_DETAILS.md`); regenerate `docs/api-inventory.{json,md}`. Reconcile the SDK method counts with `npm run sdk:count`.
- Tests: the B2 unit tests, plus endpoint tests (each route, org scoping, missing agent), plus one contract-style test that seeds an agent, an action, and an outcome, calls recompute, fetches the vector and the receipt, and verifies the receipt.

---

## Group C: Agent Registry

Independently valid checkpoint. Depends on B for the trust metric and on the existing capability runtime for invocation. Routes live under `/api/agents`, which is experimental, so they appear only in the inventory.

### C1. Delegate, never reimplement. IN SCOPE (principle).

Every registry invocation routes through the existing guard, action, and capability invocation seams (shared reuse seams above). The registry route never reimplements HTTP, SSRF defense, the guard call, action creation, or the outcome flow. Risk derives from `risk_class` (mapped 1:1 to capability `risk_level`) via `RISK_SCORE_MAP` plus `getPredictiveRisk`, clamped to 0-100, exactly as the guard path does. No new risk map.

### C2. What a registered agent is. IN SCOPE (design, documented here).

A registered agent is a declarative, org-owned, delegatable provider that groups capabilities and is discoverable and invokable by other agents through governance. It adds over a bare capability: an external endpoint identity, an `auth_type` (none, bearer, api_key, plus x402 metadata fields only), a `risk_class`, a default `budget`, and a `status`, and it groups one or more existing capabilities.

It is distinct from the existing derived "agent" (any observed `agent_id`, no table) and from swarm (an observational message graph) and pairings (cryptographic identity plus permission enrollment of an observed agent). See `docs/absorbed-projects.md` section 1, Agents. To avoid the naming collision, the UI noun is "Agent Registry" or "registered provider" and the table uses a distinct `reg_` id prefix; the existing `/agents` fleet page and derived `agent_id` namespace are not reused or modified. Pairings remain complementary (a registered agent could later carry a pairing for identity), and `agent_connections` remains the agent-reported telemetry it is today; the registry does not subsume it in v1.

### C3. Migration, repository, lib, and routes. IN SCOPE. Shared-helper extraction OPTIONAL (user decision).

Migration `drizzle/0019_agent_registry.sql` (after `0018`), Postgres-only, idempotent, org-scoped, same exemplars as B1:
- `registered_agents` (`reg_` prefix id): `entry_id text PK`, `org_id text NOT NULL`, `name text NOT NULL`, `slug text NOT NULL`, `endpoint text`, `auth_type text DEFAULT 'none'`, `auth_metadata jsonb DEFAULT '{}'::jsonb` (holds x402 and auth metadata fields only, no settlement), `risk_class text DEFAULT 'medium'` (maps 1:1 to capability `risk_level`), `default_budget_usd real`, `status text DEFAULT 'active'`, `metadata jsonb`, `created_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`. Unique `(org_id, slug)`.
- `registered_agent_capabilities` (the grouping join, avoids touching the shared `capabilities` table): `id text PK`, `org_id text NOT NULL`, `registered_agent_id text NOT NULL`, `capability_id text NOT NULL`, `created_at timestamptz`. Unique `(org_id, registered_agent_id, capability_id)`.
- `agent_invocations` (thin record, references the existing action and capability rather than duplicating their fields): `id text PK` (`rai_` prefix), `org_id text NOT NULL`, `registered_agent_id text NOT NULL`, `capability_id text`, `action_id text` (links to `action_records.action_id`, where cost, outcome, and risk already live), `caller_agent_id text`, `created_at timestamptz DEFAULT now()`. Index on `(org_id, registered_agent_id, created_at)`.

Repository `app/lib/repositories/registered-agents.repository.js` (all SQL) and lib `app/lib/agent-registry.js` (resolution and risk derivation, importing `RISK_SCORE_MAP` and `getPredictiveRisk`). Routes (no inline SQL):
- `POST /api/agents/registry` (create), `GET /api/agents/registry` (list).
- `GET /api/agents/registry/[id]` (detail), `PATCH /api/agents/registry/[id]` (update).
- `POST /api/agents/registry/[id]/capabilities` (add), `GET /api/agents/registry/[id]/capabilities` (list).
- `POST /api/agents/invoke`: resolves the registered agent and the target capability (which must be grouped under that agent and belong to the same org), then runs the governed flow by composing the existing seams in this order: `evaluateGuard` (with risk derived from `risk_class`, budget, action type, and capability metadata), then `createActionRecord` or `createBlockedActionRecord`, then `prepareCapabilityInvocation` plus `executeCapabilityInvocation`, then `updateActionOutcome`, then write a thin `agent_invocations` row referencing the resulting `action_id`. SSRF defense, auth, timeout, and retry are inherited from `executeCapabilityInvocation`; the registry adds nothing of its own.

Shared-helper extraction (OPTIONAL, flagged for user decision): the capability invoke route currently inlines this orchestration (`app/api/capabilities/[capabilityId]/invoke/route.js:27-339`) and writes its outcome with inline SQL (`:275-283`). Extracting a shared `invokeGovernedCapability()` into a lib that both the capability route and the registry route call would remove the only duplicated orchestration. It is optional because it refactors an existing route on the hot path. Default for Phase 2: compose the existing exported seams in the registry route (no refactor). Extract the shared helper only if the user approves, in which case the capability invoke route is added to the allowlist for that one change.

### C4. SDK methods, dashboard, docs, and tests. IN SCOPE.

- Node (`sdk/dashclaw.js`): `registerAgent`, `listRegisteredAgents`, `getRegisteredAgent`, `updateRegisteredAgent`, `addAgentCapability`, `listAgentCapabilities`, `invokeRegisteredAgent`.
- Python (`sdk-python/dashclaw/client.py`): the seven snake_case equivalents.
- Dashboard: a minimal utilitarian page under `app/agents/registry/` (list, detail with grouped capabilities, invocation history, and a register form), reusing the existing fleet table pattern (`app/agents/page.js:179-271`), the detail-card stack (`app/agents/[agentId]/page.js:115-138`), and the shared UI components (Card, Badge, EmptyState, Skeleton, table). The detail page shows the reputation trust metric from Group B (the snapshot vector via `GET /api/reputation/agents/[agentId]`), not a placeholder. Design-context prerequisite: read `.impeccable.md`, use tokens, never hardcode hex.
- Docs: a Registry section across the same manual doc surfaces as B5; regenerate the inventory; reconcile SDK counts.
- Tests: repository and lib unit tests; route tests (create, list, detail, update, add and list capabilities, invoke); a test that `POST /api/agents/invoke` blocks when guard returns block and records a blocked action; a test that a private or loopback endpoint is rejected by the inherited SSRF defense; a test that cross-org lookups return not-found.

---

## Run protocol (Phase 2)

### Allowlist (the only DashClaw paths Phase 2 may modify)

- `app/api/policies/**`, `app/api/compliance/**` (Group A).
- `app/api/reputation/**` (Group B, new).
- `app/api/agents/registry/**`, `app/api/agents/invoke/**` (Group C, new).
- `app/lib/reputation.js` (new), `app/lib/agent-registry.js` (new).
- `app/lib/repositories/reputation.repository.js` (new), `app/lib/repositories/registered-agents.repository.js` (new).
- `app/lib/validate.js` (A1: allow `rules.tests`), `app/lib/policyPackPreviews.js`, `app/lib/policy-suggestions.js`, `app/lib/guardrails/**`, `app/lib/compliance/**` (Group A, expect compliance lib to stay unchanged; allowed for safety).
- `app/policies/**`, `app/compliance/**` (Group A UI).
- `app/agents/registry/**` (Group C UI, new). The existing `app/agents/**` pages and components are read-only reuse, not modified.
- `app/reputation/**` (optional Group B UI, if any).
- `sdk/dashclaw.js`, `sdk-python/dashclaw/client.py` (B5, C4).
- `drizzle/**` (new `0018`, `0019`), `schema/schema.js` (mirror new tables only).
- `scripts/**` only for regenerating artifacts; generated artifacts (`docs/openapi/critical-stable.openapi.json`, `docs/api-inventory.{json,md}`, `public/livingcode/**`) are regenerated by tooling, never hand-edited.
- `docs/**` (doc sections, `docs/sdk-parity.md`, inventory and openapi regenerated), `PROJECT_DETAILS.md`, `app/docs/page.js`, `sdk/README.md`, `sdk-python/README.md` (SDK doc checklist surfaces).
- `__tests__/**` (tests for A5, B, C).

Import-only, never modified (reused via import): `app/lib/guard.js`, `app/lib/predictive-risk.js`, `app/lib/capability-invoke.js`, `app/lib/capability-runtime.js`, `app/lib/integrity/**`, `app/lib/repositories/signing-keys.repository.js`, `app/lib/repositories/actions.repository.js`, `app/lib/webhooks.js`. The single exception is the OPTIONAL C3 shared-helper extraction, which adds `app/api/capabilities/[capabilityId]/invoke/route.js` plus a new shared lib to the allowlist only if the user approves it.

Never modified: the three sibling and reference repos (`C:\Projects\dashclaw-guardrails`, `C:\Projects\AI-Agent-Governance-Compliance-Kit`, `C:\Projects\Agent-Reputation-Oracle`); `app/api/_archive/**`; `CLAUDE.md` (no version hardcode); any unrelated worktree file. Never `git add -A`.

### Turn close protocol

End every Phase 2 turn with a fenced STATUS block containing: the literal output and exit code of any command run; the `bar-mega.json` values next to their targets; what advanced and what remains; and anything red. Paste real output. Never claim a check passed without the output.

### Build and break loop

- A build push implements one in-scope milestone item with its test or check.
- A break push runs the full pre-existing test suite plus the contract checks (`openapi:check`, `api:inventory:check`, `route-sql:check`, `docs:check`, `version:check`, `version:sync:check`) plus an allowlist-diff guard, and throws adversarial input at the new surface: malformed reputation events, cross-org lookups, missing fields, blocked or oversized invocations, and a private or loopback endpoint to confirm the registry inherits the capability runtime SSRF defense. It asserts zero regressions, zero contract drift, and zero out-of-allowlist changes. A break push that finds a failure files it as a failing test first.

## Safety (record and obey in Phase 2)

Modify only allowlisted DashClaw paths; never the sibling or reference repos; never unrelated worktree files; never `git add -A`. Prefer existing patterns. Repository helpers, not route-local SQL. No large or risky migrations; downgrade to a documented recommendation (A4, recompute-all). For the registry, delegate to the capability runtime and never reimplement invocation. For reputation, reuse the existing Ed25519 integrity crypto and the existing 0-100 risk numbers; do not add a new crypto dependency and do not invent a parallel risk score.

## Standards

Zero slop. No em dashes or en dashes as punctuation; normal hyphens are fine. No fabricated findings or metrics. Plain language. Direct and honest. Applies to code, comments, UI copy, and commit messages.
