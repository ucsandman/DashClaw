# Security Guide

This is the operator-facing security guide for DashClaw (self-host and cloud). It documents the security model, key controls, and how to run audits.

> Sections are dated and reverse-chronological (newest first) down to the evergreen **Core Controls** reference; older dated sweeps are preserved below it as an audit trail.

## 2026-07-05 Intent-Integrity and Approval-Boundary Hardening

Three trust-boundary changes shipped in the first days of July 2026:

- **Evidence-graded intent (v4.63.0).** Guard callers can attach the actual act — shell command, HTTP request, SQL statement, or file write (`act: {kind, …}`, size-capped, secret-redacted before persistence). The server classifies the act deterministically and folds the derived risk in via `max()`, so evidence can raise a score but never lower it. Decisions record `intent_source: evidence | declared`; a `require_evidence` policy type escalates declared-only calls. Threat model and limits: [`architecture/enforcement-boundary.md`](./architecture/enforcement-boundary.md) ("Evidence-graded intent") — this defeats a lying model, not a lying process.
- **Separation of duties on approvals (v4.61.1/v4.62.0).** Every approval-capable surface stamps `created_by`; an actor approving an action they created is rejected with `SELF_APPROVAL_FORBIDDEN` (single-operator `root` deployments exempt by explicit design).
- **Replay protection default flip (2026-07-04, v3.6 graduation).** `DASHCLAW_JTI_REPLAY_PROTECTION` now defaults to `required` for JWKS-verified callers (fail-closed when the replay store is unreachable); API-key callers are unaffected. `DASHCLAW_ACT_BINDING` defaults to `best_effort`. Both keep one-env-var rollbacks.

## 2026-06-09 Launch Security Posture Sweep (ASVS 5.0.0)

Scope: `middleware.js` public allowlist, stable/beta mutating API posture, centralized security headers, outbound fetch/SSRF defenses, secret/client-bundle exposure, and ASVS-oriented residual risks.

### Public Route Allowlist Review

`middleware.js` remains default-deny for `/api/*`: any API route outside `PUBLIC_ROUTES` requires a valid API key or authenticated session context before it reaches a handler. Public prefixes are intentionally narrow and either read-only, externally self-authenticating, or protocol-required.

| Public prefix | Active surface | Why it is public | Route-local controls / residual risk |
| --- | --- | --- | --- |
| `/api/health` | Health check | Load balancers and operators need unauthenticated liveness. | Sanitizes DB/realtime errors to status labels and does not emit backend exception text. |
| `/api/setup/status` | Setup readiness status | First-run self-host page needs setup state before auth exists. | Read-only projection from setup status helper. |
| `/api/setup/proof` | Setup proof artifact | Operators and support can export setup proof; live-proof token upgrades detail where available. | `projectReadinessReport` projects based on authenticated viewer/live proof; response is `no-store`. |
| `/api/setup/ping` | Authenticated setup ping | Agent/validator proof path must be callable before full UI auth. | Requires `x-api-key`; timing-safe env-key compare or active DB API key lookup; demo mode returns 403. |
| `/api/setup/migrate` | Runtime migration fallback | First-run bootstrap may need to initialize the DB before auth tables exist. | Public only before initialization. After `org_default` exists, `isAuthorizedSetupWriter` requires an admin-scoped API key. Idempotent DDL uses repository/setup helpers. |
| `/api/auth` | NextAuth/local auth endpoints | Auth protocol endpoints must be reachable to sign in. | Local password compare is timing-safe; issued local-admin JWT is scoped to `org_default` or configured org. |
| `/api/cron/*` | Scheduled maintenance jobs | Vercel/cron callers cannot present app API-key middleware auth. | Each active cron route requires `Authorization: Bearer $CRON_SECRET`, fails closed when unset, and uses timing-safe comparison. Covered by `cron-auth` tests. |
| `/api/telegram/webhook` | Telegram approval callback | Telegram must POST directly to the webhook. | Timing-safe `x-telegram-bot-api-secret-token`, admin chat allowlist, callback-data regex, fixed Telegram API host, and atomic approval update. |
| `/api/discord/interactions` | Discord approval callback | Discord must POST directly to the interaction URL. | Ed25519 raw-body signature, timestamp anti-replay, sender allowlist, callback-data regex, fixed Discord API host, and async atomic approval update. |
| `/api/docs/raw` | SDK markdown | Public documentation fetch for docs UI. | Reads fixed repo files only; optional legacy source is static and deprecated. |
| `/api/integrity/jwks` | Public JWKS | Third parties need issuer public keys to verify proof receipts/bundles. | Serves public JWK members only; empty/error states return empty key set rather than a secret-bearing 500. |
| `/api/integrity/verify` | Receipt/bundle verifier | Anyone holding an artifact should be able to verify it independently. | Stateless verification against published JWKS; bad input or internal errors return non-verification, not privileged data. |
| `/api/oauth/*` | OAuth authorization server endpoints | OAuth metadata, DCR, authorize, and token endpoints are public by protocol. | DCR accepts only HTTPS redirects in production; authorize requires session, S256 PKCE, registered redirect URI, HTML escaping, same-origin consent POST; token consumes one-time codes and rotates refresh tokens. Set `DASHCLAW_URL` on self-host proxies with non-canonical Host headers. |
| `/api/prompts/*/raw` | Static setup/connect prompt markdown | Public `/self-host` copy buttons need these without auth. | Only the three fixed `/raw` files are public. The broader `/api/prompts` surface remains default-deny for templates, versions, render, runs, and stats. |
| `/api/marketing/*` | Anonymous funnel telemetry | Public marketing visitors have no session/API key. | Event names are allowlisted; properties are flat, type-limited, capped at 8 keys and 200 bytes/value; middleware rate limit and 2 MB body cap still apply; response does not reveal Redis state. |
| `/practical-systems` | Public page | Marketing/content page. | Non-API page; no mutating handler. |
| `/replay` | Public replay page | Shareable read-only replay route. | Non-API page prefix; API data access remains controlled by the underlying route handlers. |

### Mutating API Posture

Stable and beta mutating API routes remain protected by the middleware default-deny path unless they are one of the self-authenticating public protocol/webhook/cron/setup routes above. Route-level role gates continue to protect admin-only writes such as API-key creation/revocation, policy writes, team/org management, webhooks, identities, settings writes, and posture scan persistence. The Phase 4 verification set pins this posture with `guard.route`, `keys.route`, `knowledge-ingest`, `api-posture-scan`, and `cron-auth` tests.

### Outbound URL / SSRF Review

User- or tenant-controlled outbound URLs use the safe URL pattern:

| Surface | Control |
| --- | --- |
| Webhook delivery and notification webhook adapters | `safeUrlWithIps` plus `buildPinnedDispatcher` pins the resolved public IPs before `fetch`. |
| Capability invocation endpoints | `safeUrlWithIps` plus `buildPinnedDispatcher`. |
| Knowledge ingestion source URIs | `safeUrlWithIps` plus `buildPinnedDispatcher`. |
| Integration health checks and routing callbacks/agent endpoints | `safeUrlWithIps` plus `buildPinnedDispatcher`. |
| Settings connection tests, including custom webhook/Supabase origins | `assertSafeFetchUrl` / `safeFetch` with private-IP rejection and redirect handling. |
| Remote JWKS verification | `assertSafeFetchUrl` before fetch; unsafe URLs are treated as verification failure. |

Fixed vendor API calls are not request-host controlled: Telegram, Discord, Slack REST, Linear, GitHub, SendGrid, Stripe, Cloudflare Turnstile, OpenAI/Anthropic/provider APIs, PyPI, and local smoke/test scripts use constant or operator-supplied base URLs rather than anonymous request body hosts.

### Secret and Client-Bundle Scan

Phase 4 grep evidence:

- High-confidence secret pattern scan found only synthetic fixtures/placeholders in tests, examples, docs, and CI smoke env (`sk-*`, `sk-ant-*`, `ghp_*`, `oc_live_*`). No live credential material was identified.
- Suspicious client env scan for `NEXT_PUBLIC_*` names containing `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, or `API_KEY` returned zero matches.
- Full `NEXT_PUBLIC_*` inventory is limited to public-safe mode, app URL, analytics flag, version strings, Stripe publishable key, and Turnstile site key.

### ASVS 5.0.0 Mapping

| Area | Status | Evidence | Residual risk / operator action |
| --- | --- | --- | --- |
| Authentication | Pass | API middleware default-deny, NextAuth/local auth, timing-safe local password and API-key compares, OAuth S256 PKCE and one-time auth-code consumption. | Operators must set strong `NEXTAUTH_SECRET`, `DASHCLAW_API_KEY`, `CRON_SECRET`, and provider OAuth credentials where used. |
| Access control | Pass | Route-level `admin`/`member` gates for mutating APIs; setup migration becomes admin-key gated after initialization; public routes are narrow and documented above. | New mutating routes must be reviewed against `PUBLIC_ROUTES` and get role-gate tests before release. |
| Input validation | Pass | Public telemetry allowlists events and caps properties; OAuth validates redirect URIs and same-origin consent; webhook callback IDs are regex-bounded; setup/API tests pin request shape. | Continue contract and route-inventory checks for generated or migrated route surfaces. |
| SSRF | Pass | User-controlled outbound URLs use `safeUrlWithIps` plus pinned dispatcher or `assertSafeFetchUrl`/`safeFetch`. Fixed vendor calls are host constants. | Any new user-configured callback/endpoint must use the same helpers before fetch. |
| Secrets/config | Pass | `.env.example` uses placeholders; env/readiness contracts document required and advisory vars; secret grep found no live committed credentials; no suspicious `NEXT_PUBLIC_*` server-secret leak. | Test fixtures intentionally include fake secret-shaped strings to exercise redaction scanners; secret scanners should classify them as fixtures. |
| Audit/evidence | Pass | Guard decisions, action records, approval resolution, integrity receipts/JWKS, and setup proof artifacts remain available for verification. | Operators are responsible for key custody and retention policy for exported evidence bundles. |

## 2026-05-13 Durable Execution Finality (v2.13.3+)

The five-state outcome machine and idempotency-key surface shipped in commits `25599c35` through `5407b6ca` add three security-relevant guarantees. Full design context: [`docs/architecture/durable-execution-finality.md`](./architecture/durable-execution-finality.md).

### One-shot CAS at the repository layer

`setActionOutcome` (`app/lib/repositories/actions.repository.js`) gates the transition with `WHERE outcome_status = 'pending'` in the SQL itself, not just in route-level validation. Two concurrent reporters (or an agent racing against the cron sweep) cannot both terminate the same action; the second writer matches zero rows and the route returns `409 { error: "outcome already set", current_status }`. Outcomes are immutable once non-pending: a `completed` row cannot be retroactively rewritten as `failed`, even by an admin API key. Recovery for previously-partial actions is a new `action_records` row linked via `parent_action_id`, never a mutation of the original.

### Idempotency keys close the duplicate-create gap

`POST /api/actions` accepts an optional `idempotency_key` field. The lookup runs before quota, guard, signature verification, or insert; on `(org_id, idempotency_key)` hit the route returns the existing row with `{ idempotent_replay: true }` and zero downstream work. The unique `action_records_idempotency_idx ON (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL` index prevents a race-condition double-insert even if two requests slip past the lookup window. Closes the previous failure mode where a transient network error on the create side left duplicate audit entries.

### Outcome endpoint runs DLP redaction

`POST /api/actions/[actionId]/outcome` runs `scanSensitiveData` on the `summary`, `error_message`, and `progress` fields before persistence, matching the pattern already enforced on action create and outcome PATCH. Progress payloads are capped at 8 KB to bound the storage and DLP-scan cost per call.

### Cron sweep auth is consistent with existing pattern

`/api/cron/outcome-sweep` is in `PUBLIC_ROUTES` (allowlisted from API-key auth) but rejects every request without a matching `Authorization: Bearer $CRON_SECRET` header. Same model as `/api/cron/signals` and `/api/cron/integration-health`. The sweep marks pending rows past their org's timeout (`DASHCLAW_OUTCOME_TIMEOUT_MINUTES` setting, default 15, clamped `[1, 1440]`) as `lost_confirmation` and emits a `signal.detected` event for downstream webhook subscribers.

## 2026-04-21 Parallel-Reviewer Round (v2.13.3)

A five-agent parallel review targeting axes the earlier sweeps hadn't
covered — app/api/_archive reachability, workflow executor state
machine, file upload handling, non-API page security headers, and
performance / N+1 / missing indexes. Two axes came back clean
(archive routes are unreachable by Next.js `_`-prefix convention;
page-route security headers are already complete via next.config.js
globals). The remaining axes produced 10 findings: 8 fixed across
commits `7864cabd..fe4c2d09`, 1 verified false positive (filename
XSS — React text nodes auto-escape), 1 skipped as already-mitigated.

### Workflow cancel TOCTOU closed

`cancelWorkflowRun` previously read `status='running'` and then
UPDATEd to `'cancelled'` with no status gate in the WHERE clause. A
concurrent `executeWorkflow` that transitioned the parent action to
`'completed'` (or `'failed'`) between the read and the UPDATE had its
terminal status, output, and timestamp overwritten — the completed
workflow's result became irretrievable. The UPDATE now carries
`AND status = 'running'` + `RETURNING action_id`; when the CAS loses
the race we re-read the current status and return it, so the cancel
route surfaces "already completed" instead of silently stomping the
outcome.

### Attachment MIME verification + nosniff

`POST /api/messages` previously trusted the client's `mime_type`
field. An attacker could upload HTML/JS bytes labelled
`application/pdf`; the stored bytes later came back through the GET
endpoint with the claimed (and wrong) Content-Type. The
`Content-Disposition: attachment` header downgrades most browsers to
download-only, but not all.

Two defenses now stack:

- `verifyMagicBytes` on upload validates the first few decoded bytes
  against the claimed MIME type for every binary format the API
  accepts (PNG / JPEG / GIF / WebP / PDF + JSON structure validation).
  Mismatches return 400 with a specific per-attachment error.
- `GET /api/messages/attachments` now sets
  `X-Content-Type-Options: nosniff` so browsers honour the declared
  type even if `Content-Disposition` is ignored.

### Per-org attachment storage quota

Per-attachment (5MB) and per-message (3 attachments) caps existed
but total DB footprint was unbounded. A patient caller could fill
the database one max-sized upload at a time. New
`MAX_ORG_ATTACHMENT_BYTES` (default 100MB, configurable via
`DASHCLAW_MAX_ORG_ATTACHMENT_BYTES`) with a `SUM(size_bytes)` check
on upload returns 413 with detailed usage/incoming/quota numbers.

### Workflow step result CAS + resume by step.id

`updateStepResult` had no status guard — duplicate
persistStepResult calls, stale retries, or natural completion
racing against the cancel cascade could silently overwrite a
terminal row. Added `AND status = 'running'` to the WHERE clause;
first writer to transition out of running wins.

The executor's "step is reused from the prior run" check used
`steps.indexOf(step) < resumeContext.resumeFromIndex`, comparing
the OLD run's index against the CURRENT (possibly edited)
template's step positions. Template edits between runs silently
misaligned the check. Switched to
`resumeContext.priorSteps?.[step.id]` — stable across edits.

## 2026-04-21 Session Auth Parity + SSRF Consolidation

Follow-up to the same-day sprint below. 13 atomic commits between
`c7dbcbef` and `48c3fd60` closed a set of systematic pattern-classes
rather than one-off findings. Highlights:

### BUG-03b — local-password admins were silently read-only everywhere

14 client components and one hook derived `isAdmin` from NextAuth's
`useSession()`, which only reads the `next-auth.session-token` cookie
and ignores the `dashclaw-local-session` cookie issued by
`POST /api/auth/local`. Every self-hoster who signed in with
`DASHCLAW_LOCAL_ADMIN_PASSWORD` saw the orange READ-ONLY banner on
`/approvals`, `/decisions`, `/identities`, `/integrations`, `/webhooks`,
`/api-keys`, `/routing`, and `/approve`; was auto-redirected away from
`/login` while already signed in; couldn't accept invite links; and
received no realtime SSE events. Fix:

- New `GET /api/session/effective` endpoint backed by the existing
  `getViewerContextFromCookieHeader` helper, which unifies NextAuth JWT
  + local-session JWT resolution.
- New `useEffectiveRole()` hook in `app/hooks/useEffectiveRole.js`
  returns `{ role, isAdmin, authenticated, authType, settled }` and is
  now the source of truth across every admin-gated page, SSE
  subscription, and sign-in redirect.
- Regression test `__tests__/unit/approvals.page.test.jsx` pins the
  five settled / NextAuth-admin / local-admin / member / endpoint-fail
  states.

### SSRF consolidation — 6 more outbound-fetch call sites DNS-pinned

`safeUrlWithIps` + `buildPinnedDispatcher` from `app/lib/webhooks.js`
(originally introduced in the April 21 sprint for webhook delivery) are
now exported and used by every outbound fetch that takes a
user-configured URL. The DNS-rebinding window is closed across the full
surface:

- `app/lib/knowledge-ingest.js` `fetchSourceContent` — member-reachable
  via `POST /api/knowledge/collections/[id]/items`, previously a
  bare `fetch(sourceUri)` that would follow any URL including
  `http://169.254.169.254/...` (AWS IMDS) or RFC1918 ranges.
- `app/lib/routing/router.js` `dispatchToAgent` + `fireCallback` —
  had duplicate SSRF validation logic with no DNS pinning; ~50 lines
  of helper code deleted in favor of the shared module.
- `app/lib/notification-adapters/slack.js` (`SLACK_WEBHOOK_URL`) —
  no validation at all; a member could point the webhook URL at any
  private service and the server would POST on every signal fan-out.
- `app/lib/notification-adapters/discord.js` (`DISCORD_WEBHOOK_URL`) —
  same.
- `app/lib/integration-health.js` discord checker — reached on every
  "refresh health" click and the integration-health cron.

Every call site now resolves the hostname once, rejects any private /
loopback / link-local / IPv4-mapped-IPv6 answer, and pins the
connection to the validated IP via a custom `connect.lookup` on an
undici `Agent`. TLS SNI / certificate matching still uses the original
hostname — only the IP resolution is pinned.

### Privilege escalation — 8 mutation handlers now require admin role

A systematic audit of `POST`/`PATCH`/`DELETE` handlers across
`app/api/**` surfaced 8 handlers across 6 route files that let any
authenticated org member mutate org-wide state:

- `POST /api/drift/alerts` (run detection / compute baselines / record snapshots)
- `PATCH|DELETE /api/drift/alerts/[alertId]`
- `POST /api/prompts/templates`
- `PATCH|DELETE /api/prompts/templates/[templateId]`
- `POST /api/prompts/templates/[templateId]/versions`
- `POST /api/prompts/templates/[templateId]/versions/[versionId]`

Each now returns 403 on `getOrgRole(request) !== 'admin'`, matching the
pattern already enforced on /policies, /identities, /team, /webhooks,
and /orgs. New regression test pins the member-rejection path on
drift/alerts.

### `force-dynamic` pass — cache / static-render audit

21 tenant-aware routes lacked the explicit
`export const dynamic = 'force-dynamic'` prefix that the other 181
routes already carried. Most were implicitly dynamic via
`request.headers` access, but relying on auto-detection is fragile —
a future refactor that drops the `request` param could silently flip
the route to a statically-rendered response served identically to every
caller. `/api/health`'s `GET()` was the highest-risk case: it took no
request arg and was eligible for static build-time caching despite
reading live DB state. All 21 now carry the prefix.

### Schema allowlist on `users.role` + `api_keys.role`

Both columns were plain `TEXT DEFAULT 'member'` with no enum or CHECK,
so typos (`'Admin'`, `'administrator'`) and stale import values could
silently grant or withhold permissions. Added drizzle `check()`
definitions + a null-repair-then-ADD-CONSTRAINT block to the DDL.
Unexpected values trip `23514 check_violation` loudly so the operator
reconciles manually rather than being silently demoted.

### Orphaned migration pipeline fixed

`scripts/auto-migrate.mjs` hardcoded the read path to
`drizzle/0000_clammy_falcon.sql`, so 0001–0003 were silently skipped.
Fresh Neon databases never received `agent_sessions`, `session_events`,
`organizations.hosted_mode`, `trial_action_cap`, `trial_actions_used`,
`api_keys.scope`, `agent_pairings.permission_level`, or the
`agent_messages(org_id, action_id)` index. The script now iterates
`drizzle/*.sql` in filename order; the pgvector `skippedTables` set
persists across files. A follow-up hotfix adds `CREATE TABLE IF NOT
EXISTS` for `agent_pairings` and `agent_identities` (both present in
`schema/schema.js` but never in any DDL file) to 0002 so the ALTER
target exists on fresh deploys.

## 2026-04-21 Bug Hunt Hardening

Three consecutive read-only reviewer sweeps surfaced and remediated a
set of security-relevant issues across the runtime. Highlights (see
CHANGELOG for per-finding detail):

### Sandbox for org-supplied expressions
- `app/lib/scoringProfiles.js` (`custom_function` data source) and
  `app/lib/eval.js` (`_executeCustomFunction` scorer) previously evaluated
  JavaScript strings stored by any org member via the scoring-dimension
  and scorer APIs. The evaluator ran in the enclosing realm with full
  access to `process.env`, `require`, filesystem, and network — an
  RCE-class path reachable by any member account. Both now run the
  supplied body inside a `node:vm` context seeded with only the allowed
  fields and a 100ms timeout. `node:vm` is not a complete security
  boundary against prototype-chain escapes, but it blocks direct access
  to outer-scope globals — a large surface reduction.

### Webhook SSRF — DNS rebinding window closed
- `assertSafeWebhookUrl` in `app/lib/webhooks.js` resolves DNS and
  validates that every returned IP is public. The prior implementation
  let `fetch` re-resolve the hostname at connect time, leaving a
  DNS-rebinding window where a short-TTL record could flip to a private
  IP between the two lookups. Both `deliverWebhook` and
  `deliverGuardWebhook` now build an `undici` `Agent` whose
  `connect.lookup` is pinned to a validated IP and pass it to fetch via
  `dispatcher`. The original URL is still used for TLS SNI / certificate
  matching — only the IP resolution is overridden.

### Setup/migrate requires auth after first-run init
- `POST /api/setup/migrate` was in `PUBLIC_ROUTES` with no handler-side
  auth. First-run bootstrap needs it public (the 8-minute flow runs
  before any key exists), but nothing clamped access after init. Now
  gates on the presence of `org_default`: before init, public; after
  init, requires a Bearer token matching `DASHCLAW_API_KEY` (timing-safe)
  or an admin-role `api_keys` row. Without this, any unauthenticated
  POST could re-run DDL, force `plan='pro'` on the default org, and
  seed a predictable `api_keys` hash.

### Turnstile fails closed in production
- `verifyTurnstile` in `app/lib/hosted/turnstile.js` previously returned
  `{ ok: true, bypassed: true }` whenever `TURNSTILE_SECRET_KEY` was
  unset — so an operator who deployed with `DASHCLAW_HOSTED=true` but
  forgot the secret served unprotected workspace provisioning. The
  bypass is now gated on `NODE_ENV !== 'production'`. Local dev and
  vitest (`NODE_ENV='test'`) retain the convenience; production refuses
  to run without the secret.

### Cross-tenant message spoofing blocked
- `POST /api/messages` previously accepted the caller-supplied
  `from_agent_id` / `to_agent_id` without verifying those agents
  belonged to the caller's org — a valid API key holder could inject
  ledger entries that claimed to originate from another org's agent.
  Both fields are now checked via `agentExistsInOrg` against
  `agent_presence` / `agent_identities` / `agent_pairings` /
  `action_records`; mismatches return 403.

### Webhook audit trail no longer fire-and-forget
- `deliverWebhook` and `deliverGuardWebhook` now await the
  `webhook_deliveries` INSERT before returning. On failure the response
  carries `delivery_logged: false` so downstream replay and forensic
  tooling can distinguish "delivered and logged" from "delivered but
  audit lost".

### Cleanup secret comparison is timing-safe
- `app/api/hosted/cleanup/route.js` replaced `===` on
  `HOSTED_CLEANUP_SECRET` and `CRON_SECRET` with the existing
  `timingSafeCompare` helper. Practical risk was low for long secrets
  but the pattern diverged from every other secret comparison in the
  codebase.

### Compare-and-set on governance state machines
- Action PATCH terminal-state gate (F03), assumption invalidate gate
  (F31), open-loop status gate (F07), eval-run pending→running gate
  (F52), access-rule uniqueness via partial unique indexes (F04).
  These close a family of read-check-then-update TOCTOU holes where
  two concurrent operators could both win and silently clobber each
  other's audit-trail text, or where one caller could rewrite a
  terminal ledger row. All transitions are now atomic at the SQL layer.

### Governance mutation gates
- `POST` / `PATCH /api/workflows/templates[/:id]` now require
  `x-org-role: admin` like the sibling `DELETE` already did (F32).
  A non-admin member could previously rewrite a production template's
  steps or create new ones. `/api/setup/migrate` tightening (above)
  is also in this family.

### Auto-migrate stops swallowing real DDL errors
- `scripts/auto-migrate.mjs` previously logged non-SAFE_CODES errors
  at Warning and continued, leaving partial schemas on production
  instances. Now fails the build when real DDL errors are detected.
  pgvector-dependent statements are skipped deliberately when the
  extension is unavailable (CI Postgres), with cascade tracking so
  dependent indexes/FKs on skipped tables also skip.

---

## 2026-03-13 Security Remediation

On March 13, 2026, a comprehensive security audit and remediation was performed to address supply chain and runtime vulnerabilities:

### Supply Chain Hardening
- **Dependency Patching**: Resolved 11 High severity and 3 Medium severity vulnerabilities identified via OSV Scanner.
- **`jspdf`**: Upgraded to `4.2.0` to remediate PDF Object Injection and Denial of Service (GHSA-67pg-wm7f-q7fj, GHSA-9vjf-qc39-jprp).
- **`minimatch` / `ajv`**: Upgraded to latest patched versions to eliminate ReDoS vulnerabilities.
- **`xlsx` Migration**: Migrated from the vulnerable `xlsx` package to the community-maintained `@e965/xlsx` fork to remediate Prototype Pollution and ReDoS risks (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) while preserving Excel export functionality.
- **`next`**: Upgraded to `^16.1.6` to remediate an Unbounded Memory Consumption vulnerability (GHSA-5f7q-jpqc-wp7h).

### Linter & Best Practices
- **ESLint Migration**: Migrated the `lint` script to use the standard ESLint CLI (`eslint .`) instead of the deprecated `next lint` wrapper.
- **React Hook Safety**: Refactored `DraggableDashboard.js` to remove unnecessary dependencies in `useMemo`, preventing redundant re-renders and improving client-side performance.

---

## Architecture and Trust Boundaries (High Level)

DashClaw has two primary inbound trust boundaries:

- Browser/operator: NextAuth session token (dashboard UI -> `/api/*`)
- Agent/SDK: API key in `x-api-key` (agent tooling/SDK -> `/api/*`)

Outbound trust boundaries:

- LLM provider calls (e.g., OpenAI) for embeddings/guard evaluation
- Webhook deliveries to operator-configured HTTPS endpoints

## Data Handling (What We Store)

DashClaw stores the data you send to it, including (depending on which features you use):

- Actions, events, messages, docs/snippets/content, webhooks, guard decisions, and related metadata
- Encrypted integration credentials (at rest), when configured via Settings/Integrations

DashClaw includes Data Loss Prevention (DLP) redaction to reduce the chance of secrets being stored or exfiltrated, but DLP is a best-effort control. Do not rely on it as your only defense.

## Core Controls

### Encryption at Rest (Integration Secrets)

- Integration credentials are encrypted in the database using AEAD (AES-256-GCM).
- Required: `ENCRYPTION_KEY` must be set and must be exactly 32 characters (32 ASCII characters recommended).
- Backward compatibility: legacy ciphertext formats are still decryptable so upgrades do not break existing installs.

### API Access Control (Default Deny)

- All `/api/*` routes are protected by default in `middleware.js`.
- Only a small allowlist of `PUBLIC_ROUTES` is unauthenticated. The current set (see `middleware.js`):
  - `/api/health`, `/api/setup/status`, `/api/setup/ping`, `/api/setup/proof`, `/api/setup/migrate` (the last two each enforce additional gating in-handler — `live-proof` requires API auth; `migrate` is public before first-run init, then requires a Bearer match or admin role)
  - `/api/auth/*` (NextAuth flows)
  - `/api/cron/*` (`Authorization: Bearer $CRON_SECRET` required in every handler)
  - `/api/docs/raw`, `/api/prompts/*` (read-only content endpoints; specific prompt-management routes like `/api/prompts/templates`, `/render`, `/runs`, `/stats` re-enforce auth in middleware before reaching the handler)
  - `/api/telegram/webhook` and `/api/discord/interactions` (public-by-necessity inbound webhooks; each verifies its own signature inside the handler — Telegram via `X-Telegram-Bot-Api-Secret-Token` + chat-id allowlist, Discord via Ed25519 signature + user-id allowlist)
- `/setup` is the one intentional pre-auth page exception on the UI side. It is public so first-time operators can diagnose broken auth/setup states, but the page uses a public-safe projection that exposes verification status only, not secrets or raw configuration values.
- `/api/setup/proof` follows the same projection model: anonymous callers receive a sanitized JSON proof artifact, while authenticated operators receive richer operational detail.
- `/api/setup/live-proof` is not public. It stays behind normal API auth and only mints signed proof tokens from successful SDK validation summaries. The token contains sanitized verification metadata only and is designed to be safe to attach to `/setup?proof=...`.
- Tenant context headers (`x-org-id`, `x-org-role`, `x-user-id`) are stripped from all inbound API requests to prevent spoofing; middleware injects trusted values only after authentication.
- Readonly API keys are enforced centrally: API-key requests with role `readonly` are blocked from non-GET/HEAD methods.
- Decrypted integration secrets are only returned to admin API-key callers; non-admin API keys receive encrypted payloads only.
- New API keys default to role `member` (least privilege). **Agent keys must never be admin**: an admin key can approve its own pending actions, defeating the human-approval gate. Mint `admin` keys explicitly and only for operator/dashboard tooling, not for the agents being governed.
- Approvals require an attributable principal: middleware attributes every authenticated caller (`x-user-id` = session user, `trial:<org>`, `operator` for the bootstrap `DASHCLAW_API_KEY`, or the `key_<uuid>` row id for DB keys), and the approval routes reject requests whose principal resolves empty (`APPROVER_IDENTITY_REQUIRED`), so `approved_by` can never be blank and the guard's operator-approval grant additionally refuses empty-string grants.
- Separation of duties on the approval gate (drizzle/0055): every action record stamps the middleware-attributed principal that created it (`created_by`), and the approval routes reject an approval from that same principal (`SELF_APPROVAL_FORBIDDEN`; bulk resolution excludes such rows inside the atomic UPDATE). Even an explicitly-minted admin agent key cannot approve the actions it submitted. The `operator` root principal is exempt — in single-admin self-host the same credential legitimately submits and approves, and this is the honest trust-model boundary: **the operator key is root; an agent holding it is outside what enforcement can protect.** Give agents scoped (`member`) keys.
- Act-content grant binding (drizzle/0056, closing the limitation recorded at v4.62.0): when a pending action is created with an `act` payload (evidence-first guard), the server stamps `action_records.act_content_hash` — a server-computed canonical digest of that act (never a client-supplied hash). The operator-approval grant then only covers a retry whose own act recomputes to the same hash: approving act X cannot authorize a different act Y that shares the same `agent_id` + `declared_goal` + `action_type`. Rows created without an act keep the tuple match (the binding tightens grants, never loosens them), and the approvals queue marks act-stamped rows "Act-bound" so the approver knows what the approval covers. Both SDKs already send the same scrubbed act on the guard call and the pending record, so no SDK change is required; MCP callers pass the same `act` to `dashclaw_record` that they sent to `dashclaw_guard`. Residual honesty notes: (1) an approval of a row created *without* an act remains a tuple-wide grant — any act sharing that `agent_id` + `declared_goal` + `action_type` can consume it inside the 15-minute window; the absence of the "Act-bound" badge is the operator's signal, and a strict mode that refuses act-less grants is a possible future tightening. (2) The act itself is client-reported — a lying *process* is still only stopped by capability-registry credential custody, same as evidence-first grading.

Fail-closed behavior:

- In production (`NODE_ENV` not `development`), if `DASHCLAW_API_KEY` is not set, the API layer returns `503` and does not serve `/api/*`.

### Cron Endpoints (External Scheduler)

DashClaw exposes endpoints under `/api/cron/*` intended to be run on a schedule. These routes are allowlisted from browser/API-key auth, but they still require a shared secret:

- Required header: `Authorization: Bearer $CRON_SECRET`

This is compatible with any scheduler that can make HTTP requests (GitHub Actions, system cron, Windows Task Scheduler, Cloudflare, etc.).

Example (bash):

```bash
# Trigger any cron endpoint manually with the shared secret
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://YOUR_HOST/api/cron/signals"
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://YOUR_HOST/api/cron/outcome-sweep"
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://YOUR_HOST/api/cron/integration-health"
```

Current cron endpoints (see `vercel.json` for the registered schedule on the hosted path):

- `/api/cron/signals` — signal detection + notification pipeline
- `/api/cron/integration-health` — credential validation
- `/api/cron/reset-meters` — monthly meter rollover
- `/api/cron/outcome-sweep` — mark stale `pending` outcomes as `lost_confirmation`
- `/api/hosted/cleanup` — sweep expired trial workspaces (hosted operators only)

### CORS

- In production, CORS is restricted to configured/known origins.
- In development, CORS may be permissive to support local workflows.

### Rate Limiting and Client IP Trust

- All `/api/*` routes (including `PUBLIC_ROUTES`) are rate limited in middleware.
- By default this is best-effort per-instance. For multi-instance deployments, distributed rate limiting is supported via Upstash REST:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- Local/self-host tuning (middleware env vars):
  - `DASHCLAW_RATE_LIMIT_WINDOW_MS` (default: 60000)
  - `DASHCLAW_RATE_LIMIT_MAX` (default: 1000 in development, 100 otherwise)
  - `DASHCLAW_DISABLE_RATE_LIMIT=true` (dev only; do not use on public deployments)
- Self-hosting behind a proxy: set `TRUST_PROXY=true` if (and only if) you control your proxy and it sets `X-Forwarded-For` correctly. Otherwise, do not trust forwarded IPs for rate limiting/audit attribution.

### DLP Redaction (On Write + Before External Calls)

DashClaw scans and redacts common secret patterns (examples: OpenAI keys, AWS access keys, common API token shapes) in two places:

- Before storing user/agent free-text in high-risk ingestion endpoints (docs/snippets/content/sync/actions/loops/assumptions/approvals).
- Before sending content to external LLM APIs (embeddings + semantic guardrails), to reduce third-party exfil risk.

Limitations:

- DLP is pattern-based and can miss secrets (false negatives) or redact benign strings (false positives).
- Treat it as defense-in-depth; you should still keep secrets out of free text whenever possible.

### Webhook Security (SSRF + Optional Signing)

Outbound webhook delivery is hardened to reduce SSRF risk:

- HTTPS-only
- DNS resolution + private-IP blocking
- Redirects disabled
- Optional domain allowlist via `WEBHOOK_ALLOWED_DOMAINS`

Optional authenticity:

- If `GUARD_WEBHOOK_SECRET` is set, guard webhooks include:
  - `X-DashClaw-Timestamp`
  - `X-DashClaw-Signature: v1=<hmac>`

### Log Hygiene

- Webhook delivery logs redact payload and response bodies before persistence.
- Guard decision logs redact sensitive patterns before persistence.

### Analytics (Optional)

DashClaw supports Vercel Web Analytics (`@vercel/analytics`), but it is intentionally not enabled by default for self-hosts:

- Enabled automatically on Vercel deployments (`VERCEL=1`)
- Opt-in for non-Vercel hosts via `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=true`

## Deployment Checklist

- [ ] Confirm `.env`, `.env.local`, and any secrets are not git-tracked (`git ls-files .env*` should be empty).
- [ ] Set required production env vars:
  - [ ] `DATABASE_URL`
  - [ ] `NEXTAUTH_URL`
  - [ ] `NEXTAUTH_SECRET`
  - [ ] `DASHCLAW_API_KEY` (required to enable `/api/*` in production)
  - [ ] `ENCRYPTION_KEY` (32 characters)
  - [ ] `CRON_SECRET` (required for every `/api/cron/*` endpoint to function; without it, `signal.detected`, `lost_confirmation` sweeps, integration health checks, and meter resets cannot fire)
- [ ] Set optional security env vars as needed:
  - [ ] `TRUST_PROXY=true` (only if you control a reverse proxy)
  - [ ] `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (distributed rate limiting)
  - [ ] `WEBHOOK_ALLOWED_DOMAINS` (restrict outbound webhook targets)
  - [ ] `GUARD_WEBHOOK_SECRET` (sign guard webhooks)
  - [ ] `DASHCLAW_OUTCOME_TIMEOUT_MINUTES` (per-org override for the durable-finality sweep; default 15, clamped `[1, 1440]`; this is a `settings`-table key, not an env var, but listed here so operators remember it exists)
  - [ ] `NEXT_PUBLIC_ENABLE_VERCEL_ANALYTICS=true` (non-Vercel opt-in)
- [ ] Run the security scan: `node scripts/security-scan.js`

## Reporting Security Issues

Please do not open a public issue for security vulnerabilities. Email `practicalsystems@gmail.com` or open a private GitHub security advisory.

## Recent Hardening (2026-03)

- **HITL Approval Flow Hardening**:
  - **Explicit Metadata tracking**: Added `approved_by` and `approved_at` columns to the `action_records` table to provide a machine-readable source of truth for human decisions, moving away from relying solely on status transitions.
  - **SDK Verification**: Refactored `waitForApproval` in the DashClaw SDK (`sdk/dashclaw.js`) to strictly require `approved_by` metadata before resolving. The SDK now throws an error if an action leaves the `pending_approval` state without explicit approval metadata, preventing "auto-approval" bugs.
  - **Visual Distinction**: Renamed the status for unresolved assumptions to `unresolved_assumption` (labeled "Awaiting Validation") in the Mission Control UI to prevent visual conflation with pending approvals.
  - **Redaction**: Integrated DLP redaction into the approval reasoning flow to ensure human operators do not accidentally persist secrets when documenting approval decisions.

- Fixed SSRF vulnerability in `app/lib/webhooks.js` by ensuring IPv4-mapped IPv6 addresses (e.g. `::ffff:127.0.0.1`) are properly detected and blocked by the `isPrivateIp` check.
- Fixed False Encryption vulnerability in `app/api/settings/route.js` by explicitly preventing frontend mask placeholders (`••••••••`) from overriding real secrets.
- Added cryptographic context binding (AAD) to the AES-256-GCM encryption in `app/lib/encryption.js` and `app/api/settings/route.js` to prevent database-level ciphertext swapping across different settings.
- Enforced prevention of Plan Privilege Escalation by completely stripping the `plan_name` field from the validation schema (`app/lib/validators/sync.js`) and database upsert statements (`app/lib/repositories/connections.repository.js`).
- **Log Sanitization**: Sanitized API key generation and revocation logs in `app/api/keys/route.js` to prevent accidental leakage of sensitive error messages or database details.
- **Scanner Compliance**: Renamed sensitive-looking variables (e.g., `secret_warning` -> `storageWarning`, `demo_secret_mask` -> `masked_val`) in fixtures and route responses to improve signal-to-noise ratio in security scans while maintaining production compliance.
- **Structural Decomposition**: Modernized the `middleware.js` and `readiness.mjs` architectures by extracting complex logic into modular services, reducing the attack surface of monolithic files.

## Recent Hardening (2026-02)

- Fixed SSRF via DNS Rebinding TOCTOU in `app/lib/webhooks.js` by resolving IP once and forcing fetch to use the resolved IP.
- Fixed false encryption condition in `app/api/settings/route.js` handling falsy values and string booleans properly.
- Removed `plan_name` from bulk sync payload parsing and database upserts to prevent privilege escalation via spoofed plans.
- Added org-scoped guard to team member removal update (`/api/team/[userId]`) to prevent cross-tenant race-condition evictions.
- Added production guard on settings writes: when `NODE_ENV=production` and `ENCRYPTION_KEY` is missing, `/api/settings` POST now returns `503` with a clear misconfiguration error.
- Added org scoping in prompt version creation paths (`prompt_versions` max-version lookup and parent `prompt_templates` touch update).
- Added missing `org_id` guards to several `UPDATE`/`DELETE` statements in compliance/export, eval run updates, message/context thread updates, webhook failure counters, scoring profile touch updates, and onboarding user move.
- Normalized repository SQL in actions/evaluations repositories to Neon tagged-template style where non-standard placeholder/query patterns were used.
