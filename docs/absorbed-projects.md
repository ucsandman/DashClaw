# Absorbed projects: canonical map

Phase 1 read-only investigation, 2026-06-04. This document maps the current canonical DashClaw governance modules and routes, records what each of the two sibling repos has already contributed to DashClaw, identifies what remains useful, gives an archive recommendation, maps the Agent-Reputation-Oracle reference onto DashClaw primitives, and lists the remaining gaps (x402 monetization, public verification, marketplace bootstrapping).

Every claim cites a file that was read during the investigation. No findings are fabricated. Where the run brief made an assumption that the code contradicts, the correction is stated with evidence.

## Three corrections to the brief (verified against code)

These matter for Phase 2 and are stated up front so nothing downstream inherits a wrong premise.

1. There is no dual `better-sqlite3` plus Postgres mode. `better-sqlite3` was a declared dependency that was never imported anywhere in the codebase (removed 2026-07-10 after it broke Windows up-smoke installs). The real dual mode is Neon serverless versus `postgres.js` (direct TCP), both Postgres, selected by `app/lib/db.js:61-66` and `scripts/_db.mjs:30-34`. Migrations are single-dialect Postgres DDL.
2. The signer is Ed25519 via Node's built-in `node:crypto`, not tweetnacl. `app/lib/integrity/sign.js:9` imports `sign`/`verify` from `node:crypto`; `app/lib/integrity/keys.js:15-18` generates Ed25519 keys with `SIGNING_ALG = 'EdDSA'`. There is no tweetnacl in the signing path. "Add no new crypto dependency" is satisfied because `node:crypto` is built in.
3. Signature verification does not use `timing-safe.js`. A grep across `app/lib/integrity/` returns no `timing-safe` usage; verification is `verifyCanonical` calling `node:crypto` verify (`app/lib/integrity/sign.js:30-42`). `app/lib/timing-safe.js:7-17` is used for secret and API-key comparison elsewhere, not for signatures.

## 1. Canonical DashClaw governance modules and routes

### Governance loop (guard, decisions, actions)

- Guard engine: `app/lib/guard.js`. `evaluateGuard(orgId, context, sql, options = {})` (`app/lib/guard.js:112`) is the single governance gate. It returns `{ decision, decision_id, action_id (deprecated alias), reason, signals, matched_policies, risk_score, agent_risk_score, predictive_risk, reasons, warnings }` (`app/lib/guard.js:441-501`). Decisions are `allow | warn | block | require_approval` with a `DECISION_SEVERITY` ordering.
- Base risk: `computeRiskScore(context)` (`app/lib/guard.js:44-62`) using `ACTION_TYPE_BASE_SCORES` (`app/lib/guard.js:24-29`), `reversible`, `systems_touched`, and `declared_goal` regex bumps, clamped to [0,100].
- Action ledger table: `action_records` (NOT `actions`), schema at `schema/schema.js:115-167`. Two outcome axes: lifecycle `status` and durable `outcome_status` (CHECK in `pending | completed | partial | failed | lost_confirmation`, `schema/schema.js:163-166`).
- Guard decisions table: `guard_decisions`, schema at `schema/schema.js:547-587`, written fire-and-forget at `app/lib/guard.js:401-402`. The live `GET /api/guard/decisions` route reads through `guardrails.repository.js` (`listGuardrailDecisions`), not `guard.repository.js` (`app/api/guard/decisions/route.js:7,20-23`).
- Action routes: `app/api/actions/route.js` and `app/api/actions/[actionId]/{route,outcome,trace,graph,messages,artifacts}/route.js`, plus `costs`, `stats`, `loops`. Repository: `app/lib/repositories/actions.repository.js`.

### Capabilities and invocation

- Engine: `app/lib/capability-invoke.js` (HTTP, timeout, retry, backoff, SSRF) and `app/lib/capability-runtime.js` (prepare, validate, execute).
- Invoke route and its exact ordering: `app/api/capabilities/[capabilityId]/invoke/route.js` (`POST`, lines 27-339). The governed sequence is:
  - mint action id `act_${crypto.randomUUID()}` (`route.js:84`);
  - compute `riskScore = RISK_SCORE_MAP[capability.risk_level] || 50` (`route.js:88`);
  - guard request via `evaluateGuard(orgId, context, sql)` with context `{ action_type:'capability_invoke', risk_score, agent_id, systems_touched:[capability:<slug>], reversible:true, declared_goal }` (`route.js:89-100`);
  - on `block`, `createBlockedActionRecord(...)` then HTTP 403 (`route.js:121-144`); on `require_approval`, `createActionRecord(... 'pending_approval' ...)` then HTTP 202 (`route.js:147-171`);
  - action record created with status `running` and `costEstimate: capability.pricing?.estimated_cost_usd || 0` (`route.js:247-256`); cost is a write-time snapshot;
  - HTTP execution via `executeCapabilityInvocation(...)` (`capability-runtime.js:46`);
  - outcome written by an inline `UPDATE action_records ...` (`route.js:275-283`); the parallel test route uses the repository helper `updateActionOutcome` instead (`app/api/capabilities/[capabilityId]/test/route.js:106-112`).
- Risk map: `export const RISK_SCORE_MAP = { low: 20, medium: 50, high: 75, critical: 95 }` (`app/lib/capability-invoke.js:10-15`), keyed by the capability `risk_level` enum `RISK_LEVELS` (`app/lib/repositories/capabilities.repository.js:8`).
- Reusable seams a future caller can delegate to without reimplementing: `prepareCapabilityInvocation(sql, orgId, capabilityId)` (`capability-runtime.js:22`), `executeCapabilityInvocation({ endpoint, authHeaders, schema, body })` (`capability-runtime.js:46`), `invokeCapability(...)` (`capability-invoke.js:162`), `resolveAuth(auth, settings)` (`capability-invoke.js:19`), `createActionRecord` (`actions.repository.js:234`), `createBlockedActionRecord` (`actions.repository.js:304`), `updateActionOutcome` (`actions.repository.js:409`), `evaluateAccess` (`capability-access.repository.js:19`), `checkCircuitBreaker` (`capability-health.js:250`).
- SSRF defense: `safeUrlWithIps(url)` and `buildPinnedDispatcher(validatedIps)` from `app/lib/webhooks.js:43,20`, used in `capability-invoke.js:82-100` with `redirect:'manual'`. The general helper `app/lib/url-safety.js` exists but the capability path uses the `webhooks.js` variant.

### Integrity and signing

- Canonicalization front door: `canonicalizeJson(value)` (`app/lib/integrity/canonicalize.js:79`), which adds a depth bound (`MAX_JSON_DEPTH = 100`) and NFC normalization on top of the shared `canonicalJsonStringify` in `app/lib/canonical-json.js:38`. Hash helpers: `digestJson(value)` and `digestText(input)` returning `'sha256:' + base64url(...)` (`app/lib/integrity/canonicalize.js:85-95`).
- Signing: `signCanonical(base, { kid, privateKeyJwk })` returns `{ alg:'EdDSA', kid, sig }` (`app/lib/integrity/sign.js:19`). Verify: `verifyCanonical(base, signature, publicKeyJwk)` (`app/lib/integrity/sign.js:30`). Receipt envelope: `issueReceipt(...)` / `verifyReceipt(...)` (`app/lib/integrity/receipt.js:42,63`). Bundle envelope: `signBundle` / `verifyBundle` (`app/lib/integrity/bundle.js:41,61`).
- Keys: `generateSigningKey(kid)` (`app/lib/integrity/keys.js:32`), loader `getServerSigningKey(sql)` and publisher `getServerPublicJwks(sql)` (`app/lib/integrity/server-key.js:58,101`). Table `server_signing_keys` is instance-global with no `org_id` (`schema/schema.js:592-600`, `drizzle/0013_non_fabrication_integrity.sql:11-19`; repository `app/lib/repositories/signing-keys.repository.js:2-7,10,26,36`).
- Public routes: `POST /api/integrity/verify` (`app/api/integrity/verify/route.js:20`, branches only on `body.receipt` and `body.bundle`) and `GET /api/integrity/jwks` (`app/api/integrity/jwks/route.js:16`).
- Live issuance precedents: guard receipts at `app/lib/guard.js:608-617`; compliance bundles at `app/lib/compliance/exporter.js:195-196`.

### Risk

- Behavioral layer: `app/lib/predictive-risk.js`. `getPredictiveRisk(sql, orgId, agentId, actionType, triggerRiskScore, orgSettings)` returns `{ statistical, llm, total_adjustment }` (`app/lib/predictive-risk.js:167-189`); deterministic core `computeStatisticalAdjustment(stats)` (`app/lib/predictive-risk.js:32-70`); optional LLM layer `assessRiskWithLLM(...)` clamped to [-20,+20] (`app/lib/predictive-risk.js:103-162`).
- Composition pattern (the wrap seam): guard takes `max(authoritative, agent)` then adds the clamped predictive adjustment (`app/lib/guard.js:220-249`). The whole scale is integer 0-100, base plus signed adjustment, clamped.

### Evidence sources

All multi-tenant by a text `org_id` column resolved per-request by `getOrgId(request)` returning `... || 'org_default'` (`app/lib/org.js:10-12`); `org_default` is a real org, not a sentinel. Agent identity is a repeated free-text `agent_id` column, not a foreign key; cross-org spoofing is gated by `agentExistsInOrg(sql, orgId, agentId)` (`app/lib/repositories/agents.repository.js:8-14`).

- `action_records` (`schema/schema.js:115-167`): the richest source, `agent_id` NOT NULL, with `status`, `outcome_status`, `risk_score`, `confidence`, `reversible`, `cost_estimate`, `tokens_in/out`, `duration_ms`, `approved_by`. Ready aggregators: `getActionStats` (`actions.repository.js:900-983`), `getCostAggregation` (`actions.repository.js:1001-1052`), `getAnalytics.by_agent` (`analytics.repository.js:71-79`).
- `guard_decisions` (`schema/schema.js:547-587`): `agent_id` nullable; bucket by `decision`. Live reader `listGuardrailDecisions` (`guardrails.repository.js:45-86`).
- `eval_scores` (`schema/schema.js:1033-1050`): only `action_id`; reach an agent by joining `action_records` on `(action_id, org_id)`. `listEvalScores` already implements that join (`evaluations.repository.js:1-52`).
- `feedback` (`schema/schema.js:916-933`): full per-agent helpers in `app/lib/feedback.js` (rating, sentiment, `by_agent`), but it has no HTTP route (the legacy `_archive/feedback/*` routes were removed in the v5 cull). Usable server-side via the lib or direct table read; `agent_id` is stored as `''` when absent.
- `learning_episodes` (`schema/schema.js:295-316`) and `learning_recommendations` (`schema/schema.js:318-333`): precomputed, per-agent, already scored. `learning_recommendations` is a per `(org_id, agent_id, action_type)` rollup with `success_rate` and `avg_score`, arguably the most reputation-shaped table in the schema.
- `decisions` (`schema/schema.js:227-238`): coarse per-decision `outcome`.
- `profile_scores` (`schema/schema.js:1113-1123`): rule-based composite quality scores, `agent_id` nullable.
- `drift_baselines` / `drift_alerts` (`schema/schema.js:717-761`): `agent_id` NOT NULL, but it holds the agent NAME, not `action_records.agent_id`, because drift reads source data filtered by `agent_name` (`app/lib/drift.js:131,176-177`). This is the single biggest cross-source key mismatch to design around.

### Agents

- There is no `agents` table and no create-agent endpoint. An agent is a derived entity: any distinct `agent_id` that left a trace, reconstructed by `listAgentsForOrg(sql, orgId)` via `GROUP BY agent_id` across `action_records`, `goals`, `decisions`, `token_snapshots`, and `agent_presence` (`app/lib/repositories/agents.repository.js:52-269`).
- Trust today is a posture panel, not a number: `getAgentTrustPosture(sql, orgId, agentId)` returns `{ permission_level, identity_verified, signature_enforced, active_policies_count, policies[], approval_record, blocks_30d }` (`app/lib/repositories/agents.repository.js:363-427`), displayed as badges in `app/agents/[agentId]/components/AgentTrustPosture.jsx`. There is no aggregate 0-100 trust score.
- Durable agent-related tables: `agent_presence` (`schema/schema.js:422-430`), `agent_connections` (`schema/schema.js:432-443`), `agent_pairings` (`schema/schema.js:1138-1150`), `agent_identities` (`schema/schema.js:1152-1161`).
- Swarm is an observational communication graph over `agent_messages` between already-active agents (`app/api/swarm/graph/route.js:15-107`); it does not model owned external providers. Pairings enroll an `agent_id` public key plus a `permission_level` (`app/lib/repositories/pairings.repository.js:5-93`); this is the nearest existing primitive to "registering" an agent, but it is identity and permission enrollment of an observed agent, not a catalog of external providers. Connections are agent self-reported provider usage (`app/lib/repositories/connections.repository.js:6-104`).
- Reusable UI shells for a registry dashboard: the fleet table in `app/agents/page.js:179-271` (Card, Badge, EmptyState, Skeleton), the detail-card stack in `app/agents/[agentId]/page.js:115-138`, and the connection list rows in `AgentConnectionsSection.jsx`.

### SDKs and contract tooling

- Node SDK: `class DashClaw` with one `_request(path, method, body, params)` helper (`sdk/dashclaw.js:66`); methods are 2-space-indent `async camelCase(...)` returning `_request(...)`.
- Python SDK: `class DashClaw` with `_request(self, path, method, body, params, json_payload, **kwargs)` (`sdk-python/dashclaw/client.py:87`); methods are 4-space-indent `def snake_case(self, ...)`.
- Route maturity is path-prefix-only (`scripts/lib/api-route-inventory.mjs:6-50`): `/api/policies` is stable, `/api/agents` is experimental, `/api/compliance` and any unlisted prefix default to experimental (`scripts/lib/api-route-inventory.mjs:93-96`). `openapi:generate` includes stable routes only (`scripts/generate-openapi.mjs:99-100`).
- `route-sql:check` is a non-decreasing baseline guard; a new `route.js` must contain zero `` sql` `` or `sql.query(` usages (`scripts/check-route-sql-guard.mjs:16-35`, `scripts/lib/route-sql-guard.mjs:4-15`). Repositories are exempt.
- `docs:check` validates markdown links plus the Next.js major version in three docs only (`scripts/validate-docs.mjs:16-36`); it does not enforce SDK doc-surface coverage. That checklist is manual (MEMORY.md). `sdk:count` (`scripts/count-sdk-methods.mjs`) is a manual aid, not a CI gate.

## 2. Sibling repo: dashclaw-guardrails

Read: `README.md`, `docs/{DASHCLAW_INTEGRATION,MVP,POLICY_COOKBOOK}.md`, `proposals/{dashclaw-policy-dry-run-mode,dashclaw-policy-simulator}.md`, `schema/guardrails.schema.json`, `packages/guardrailgen-js/{bin/guardrailgen.js,src/evaluator.js,src/report.js,src/adapters/dashclaw.js,src/converters/dashclaw-to-yaml.js,src/generators/{jest,pytest}.js}`, `policies/README.md`, `policies/smb-safe/*`, `policies/development/policies.yml`, `generated-tests/PROOF.md`.

What it is: a standalone "guardrails as code" CLI that compiles a YAML policy doc into Jest tests and a markdown proof report, with a binary allow/deny evaluator (`packages/guardrailgen-js/src/evaluator.js:11-65`). Its decision model has no `warn`, no risk score, no rate limit. The converter `dashclaw-to-yaml.js:65-117` proves DashClaw already has a strictly richer 7-type policy model that guardrailgen has to downgrade (5 of 7 types collapse to `block:true`).

Already absorbed into DashClaw:
- Runtime policy enforcement with the full `allow | warn | block | require_approval` decision model (`app/lib/guard.js:441-501`), which supersedes the binary evaluator.
- The YAML policy-pack import path and offline-test concept: DashClaw has `app/lib/guardrails/{evaluator,converter,report}.js` and `app/api/policies/{import,test,proof,templates}/route.js`, plus packs at `app/lib/guardrails/packs/<pack>/policies.yml` (read by `app/api/policies/import/route.js:44` and `templates/route.js:18`). The DashClaw test route runs converted policy tests (`app/api/policies/test/route.js:35-49`) and the proof route emits a report (`app/api/policies/proof/route.js:14-40`).
- The two proposals describe DashClaw features (a per-policy `mode` column plus `/api/guard/dry-run-impact`, and `POST /api/guard/simulate`). DashClaw partly covers the simulate intent through `POST /api/policies/simulate` (`app/api/policies/simulate/route.js:14-78`, historical replay through the real evaluator) and the Policy Coach simulate-before-adopt feature (MEMORY.md). The literal per-policy observe/warn/enforce `mode` column does not exist yet (see Group A in docs/archive/SPEC-mega.md and section below).

What remains useful:
- The two proposals as ready specs for the observe/warn/enforce lifecycle and a historical simulator, if Phase 2 builds toward that. They cite DashClaw paths directly and should be folded into a DashClaw decision record rather than left in a separate repo.
- The four starter policy packs (`policies/README.md:14` cites 22 policies, 57 tests) as candidate seed content, with the caveat that their vocabulary (approval, block, allowlist) is narrower than DashClaw's 12 policy types.

Dead weight: the Pytest generator is a stub with no Python evaluator to import (`packages/guardrailgen-js/src/generators/pytest.js:16-21`); the binary evaluator is lower-fidelity than DashClaw's runtime; the per-pack `policies.yml` files are undocumented duplicates of `guardrails.yml`; `docs/POLICY_COOKBOOK.md` is a 12-line draft stub.

Archive recommendation: archive the repo, but first lift the two proposals into a DashClaw spec or decision record and reconcile them against Policy Coach. The runtime enforcement, the richer decision model, and simulate-before-adopt already live in DashClaw; the offline Jest-from-YAML and binary evaluator are strictly lower fidelity and not worth carrying as live code. Package is `@dashclaw/guardrailgen` 0.0.1 with no publish config, so archiving carries no external-consumer risk.

## 3. Sibling repo: AI-Agent-Governance-Compliance-Kit

Read: `README.md`, `packages/compliance-engine/{bin/compliance.js,src/{analyzer,mapper,reporter}.js,package.json}`, `frameworks/{soc2,gdpr,nist-ai-rmf,iso27001,imda-agentic}.json`, cross-checked against `app/lib/compliance/mapper.js`, `app/api/compliance/evidence/route.js`, and `app/lib/compliance/frameworks/soc2.json`.

What it is: a file-only, CLI-only, in-development prototype that maps a guardrail policy doc to framework controls and emits compliance markdown. `mapPolicies` computes `coverage_percentage = round(((covered + partial*0.5)/total)*100)` (`packages/compliance-engine/src/mapper.js:66-68`). `evidence_queries` in the framework JSON are inert SQL-fragment strings; nothing in the kit reads them, and the advertised `--dashclaw-url` live pull is documented but not implemented (`packages/compliance-engine/bin/compliance.js:66-69`).

Already absorbed into DashClaw, with provenance in code: `app/lib/compliance/mapper.js:1-5` carries the header "Absorbed from AI-Agent-Governance-Compliance-Kit/packages/compliance-engine/src/mapper.js". DashClaw's `mapPolicies`/`evaluateControl`/`checkPolicyPattern` are the same logic (`app/lib/compliance/mapper.js:42-170`) with `FRAMEWORKS_DIR` pointing at `app/lib/compliance/frameworks` and a shared `globToRegex`. DashClaw ships the same five framework JSONs and built everything the kit only promised: `app/lib/compliance/{analyzer,reporter,exporter}.js` and a live HTTP surface `app/api/compliance/{evidence,exports,frameworks,gaps,map,report,schedules,trends}`. The `evidence` route executes the evidence concept against the DB through `compliance.repository.js` (`app/api/compliance/evidence/route.js:7-42`).

What remains useful: nothing unique. DashClaw's `app/lib/compliance` plus `/api/compliance/*` is a strict superset.

Archive recommendation: archive the repo. There is zero unique capability left. A line-by-line diff of `analyzer.js`, `reporter.js`, `exporter.js`, and the five framework JSONs would give a definitive sign-off, but the "Absorbed from" provenance comment and identical control set make divergence unlikely.

## 4. Agent-Reputation-Oracle: mapping onto DashClaw primitives

Read: `src/types/index.ts`, `src/models/event.ts`, `src/reputation/{math,decay,engine}.ts`, `src/crypto/{signing,receipt,attestation}.ts`, `src/storage/{event-log,migrations,cache}.ts`, `src/routes/{events,reputation}.ts`, `src/x402/{middleware,pricing}.ts`, `src/{app,config}.ts`, `docs/{threat-model,reputation-math,api-spec,demo}.md`, `package.json`.

What it is: a standalone Express plus SQLite (better-sqlite3) TypeScript service that computes a time-decayed, Bayesian-smoothed reputation vector per EVM address from a signed append-only event log, returns it with an EIP-712 oracle-signed receipt, and gates every read and write behind x402 USDC micropayments on Base Sepolia. Identity is an `0x` EVM address; crypto is secp256k1 EIP-712 via `viem` (`src/crypto/signing.ts`, `package.json:31-40`).

The portable asset is the math, which is self-contained and dependency-free except for `Math`:

- Vector fields (`src/types/index.ts:7-16`): `reliabilityScore`, `completionRate`, `disputeRate`, `slaAdherence`, `volumeWeight`, `totalEvents`, `lastEventTimestamp`, `computedAt`. Plus `confidence` and `isActive` on the summary (`src/types/index.ts:115-127`).
- Decay (`src/reputation/decay.ts:15-42`): `lambda = ln(2) / halfLifeDays`, `weight = e^(-lambda * deltaDays)`, default half-life 90 days, future events clamped to 1.0, active window 180 days.
- Smoothing (`src/reputation/math.ts:22-35`): pseudo-count Bayesian average `score = (prior_w*prior_v + sum(w_i*x_i)) / (prior_w + sum(w_i))`, priors reliability {5,0.5}, completion {3,0.7}, dispute {5,0.05}, sla {2,0.8}.
- Volume (`src/reputation/math.ts:149-160`): `volumeWeight = ln(1 + sum(decayWeight_i))`. Confidence (`src/reputation/engine.ts:105-108`): `1 - e^(-0.1*volumeWeight)`, range [0,1).
- Collusion discount (`src/reputation/engine.ts:18-29,116-118`): based on per-attester event share, pulls scores toward their prior.
- Storage (`src/storage/migrations.ts`): `events` (append-only), `reputation_cache` (the snapshot, one row per agent), no persisted receipts table (computed per request).

How it maps onto DashClaw:

- Identity: key on DashClaw's existing text `agent_id` and `org_id`, not on minted EVM addresses. The oracle's `sourceAgentId` (attester) versus `agentId` (subject) separation maps naturally to "which agent or system reported the outcome" versus "the agent being scored," and the self-attestation guard (`agentId !== sourceAgentId`, `src/routes/events.ts:45-48`) is directly portable.
- Events: DashClaw does not need agents to POST signed events. The natural event source is the existing evidence layer: `action_records` outcomes for transaction success and failure, `guard_decisions` blocks for policy violations, `eval_scores` and `profile_scores` for quality, `feedback` for sentiment, approvals for adherence. The reputation `risk_score` dimension should reuse DashClaw's existing 0-100 risk numbers (already on `action_records.risk_score`, which folds in `computeRiskScore` plus the predictive adjustment), not a parallel formula.
- Snapshot: mirror `reputation_cache` as a Postgres snapshot table, upsert one row per agent, staleness keyed on the newest contributing event. No EVM, no SQLite.
- Receipts: DashClaw already has an Ed25519 sign and verify layer (section 1, integrity). A reputation receipt reuses `digestJson(vector)` plus `signCanonical(base, key)` plus `getServerSigningKey(sql)`, adding no new crypto dependency. It does not need viem, keccak, or EIP-712.

How the eventual DashClaw reputation feature relates to the standalone project: it is a re-implementation of the math and the event-to-vector model on top of DashClaw's own recorded decisions and its own Ed25519 signing, scoped to a single tenant and internally trusted. The standalone oracle's external-marketplace machinery (x402 paywall, public EIP-712 receipts for trustless third-party verification, collusion-graph defense, EVM key rotation) is deliberately out of scope for a DashClaw v1 and is catalogued in section 5.

## 5. Remaining gaps

These are present in the Agent-Reputation-Oracle reference but intentionally not part of a DashClaw v1 reputation feature. They are recorded so the boundary is explicit.

### External x402 monetization

The oracle gates every paid endpoint behind x402 USDC micropayments on Base Sepolia: `src/x402/middleware.ts:21-110` builds a route-to-price map, `src/x402/pricing.ts` and `src/config.ts:14-17` set per-endpoint prices (query 0.001, summary 0.0005, attestation 0.001, event submit 0.01). The middleware is mounted only when `NODE_ENV === 'production'` (`src/app.ts:60-64`), so governance logic is cleanly separable from the paywall. DashClaw authenticates by workspace token, not per-call micropayment. Gap status: out of scope. Pulling x402 into DashClaw would require an entire payment-settlement and wallet layer that does not exist (`agentcash`/x402 are available as a skill in the environment but unused in DashClaw). For the registry, the brief allows recording x402 and auth metadata fields only, with no settlement, which is consistent with this boundary.

### Public verification

The oracle exists so external parties can trustlessly verify the oracle off-chain: EIP-712 signed receipts (`src/crypto/receipt.ts`) plus deterministic recomputation from the append-only log (`docs/threat-model.md:36-37`). DashClaw is a trusted control plane for its own workspaces. It already has the building blocks for verifiable receipts (`POST /api/integrity/verify`, `GET /api/integrity/jwks`), but two gaps remain for cross-org or public reputation verification: (1) the public verify router branches only on `body.receipt` and `body.bundle` (`app/api/integrity/verify/route.js:25-30`), so a reputation envelope must either be shaped as a receipt or get a new branch; (2) the signing key is instance-global with no `org_id` (`app/lib/repositories/signing-keys.repository.js:2-7`), so per-org issuer identity would need a schema change. Gap status: signed reputation receipts using the instance key are achievable in scope; cross-org or public portability is a later layer, out of scope for v1.

### Marketplace and network-effect bootstrapping

The oracle's whole "agents pay to attest about other agents" model, its Sybil and collusion defenses, and its open multi-party event ingestion presuppose an open marketplace (`docs/threat-model.md` threats 1, 2, 5). DashClaw's first reputation version computes from its own recorded decisions, single-tenant and internally trusted, so it does not face Sybil or collusion at v1. Gap status: out of scope. The marketplace, cross-org attestation network, and the associated anti-gaming machinery are deferred until reputation is exposed across orgs. The collusion-discount math is portable as a tunable constant if and when peer attestation is added, but it is not needed for a self-sourced v1.
