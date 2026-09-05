# September 5 audit remediation

This records the repository repairs following the whole-repository production audit. It is not a deployment or production-readiness attestation. The original audit, all 47 finding records, implementation handoffs, and executable evidence are retained locally under `plans/audit-2026-09-05/`.

## Safety changes

- Operator-key reveal requires an attested human operator in the operator organization. Membership failures no longer create a default-organization session. OAuth scopes, token expiry, refresh rotation, and stable principals are enforced server-side.
- New execution claims bind organization, principal, agent, action, exact act, verified-identity continuity, current policy decision, and attempt. PostgreSQL consumes approval or plan authority in the same statement as the claim. Evaluation alone does not consume authority.
- Permissive decisions are reevaluated on replay. Restrictive replay advertises the same claim protocol as a fresh decision. A recorded allow cannot skip the current-policy checkpoint.
- Capability invocation obtains a claim before its side effect. Governance evidence binds the resolved request without disclosing server custody values to external decision providers.
- Hermes and OpenClaw reject malformed governance responses. Hermes uses the canonical hook implementation. Governed SDK helpers distinguish callback failure from uncertain outcome confirmation, and reconcile approval state while SSE stays connected.
- Approval mutations enforce expiry and separation of duties atomically. Standing grants preview their bounded scope before mutation. Approval cards expose the redacted bound act; identity verification and payload signing are distinct evidence.
- Migrations have a transactional, checksummed ledger and required-schema checks. Plans and billing transitions no longer leave partial state on failure. Explicit test database configuration wins over repository dotenv loading.
- New signing keys and webhook secrets use authenticated encryption. Key lifecycle and disposable recovery commands support rotation, compromised-key exclusion, historical verification, and explicit reconciliation.

## Operator and maintenance changes

The approval queue distinguishes loading, unavailable, stale, and empty states. Pulse says "No active signals" rather than making a global safety claim. Zero confidence stays zero. Decision filters and tabs have accessible names and keyboard behavior. Setup reports protection state and displays probe-reported runtime versions and installed-hook fingerprints. Missing or unrecognized measurements remain unavailable; these client-supplied diagnostics are not cryptographic attestation.

CLI update checks process ownership and served version. MCP errors remain structural errors, package exports and declarations agree, and onboarding emits the key formats both SDKs consume. CI covers previously omitted package tests, typechecking, hosted HTTP behavior, real PostgreSQL claim concurrency, and script syntax. Test discovery excludes audit copies, and Python test servers close their sockets.

Simplification removed the stale executable hook copy and obsolete plan-grant consumer, centralized authority consumption, and replaced the obsolete finality draft with the [current execution and outcome contract](architecture/durable-execution-finality.md). No speculative feature cull or broad dead-code deletion was justified by the audit.

## Rollout contract

The working-tree hook upgrade initially interrupted live harness sessions because the deployed server had not advertised claim protocol 1. Compatibility was repaired without setting global observe mode. Missing protocol advertisement preserves the older guard/approval flow; malformed or unsupported advertisement still stops execution. Strict deployments can set `DASHCLAW_REQUIRE_EXECUTION_CLAIMS=1` after upgrading the server.

The new Node and Python governed helpers require a confirmed claim. Deploy the matching schema and server before publishing or upgrading those helpers. Old cooperative clients still cannot be treated as mechanically enforcing claims. Shared credentials remain a shared trust boundary, and a same-user process can tamper with its own hook.

One claimed attempt is not exactly-once external execution. Lost claim responses, process crashes, and missing outcome confirmation require reconciliation. Effect-specific idempotency remains the target system's responsibility. See the [trust model](architecture/trust-and-failure-model.md).

## Evidence and release boundaries

Additional integration findings were repaired during implementation:

| Finding | Severity / confidence / category | Evidence and failure scenario | Repair / effort / release gate |
|---|---|---|---|
| Live hook protocol rollout | P1 / high / compatibility and enforcement | `hooks/dashclaw_pretool.py` required a protocol the deployed server did not advertise. Because live harnesses referenced the checkout, local edits immediately blocked their calls. Old-server integration tests reproduce the mismatch. | Preserve legacy enforcement only when advertisement is wholly absent; retain strict advertised-protocol validation and an explicit strict-mode flag. Small. Block rollout until compatibility tests pass; repaired. |
| Replayed approval omitted claim negotiation | P1 / high / enforcement | `app/lib/guard/route-replay.ts` returned an approval replay without claim fields. A staged-compatible hook could treat it as a legacy response and skip the new claim. The dedicated regression fails when those fields are removed. | Advertise protocol 1 and the claim requirement on restrictive replay. Small. Production blocker until fixed; local HTTP now proves replay retains the exact-act single-use claim. |
| Capability custody egress | P1 / high / secret handling | The invoke route supplied resolved body and endpoint secrets to `evaluateGuard`; external verdicts forwarded the act before persistence redaction. Arbitrary non-pattern secrets reproduced both disclosures, including invalid-URL fallback. | Source-aware masking before guard, raw-request digests, identical sanitized act for record and claim, original request only for execution. Medium. Production blocker until fixed and independently reviewed; final review passed. |
| Smoke scripts overrode selected database | P1 / high / verification safety | The two live smoke scripts parsed `.env.local` independently and could replace explicitly selected test credentials or database configuration. A real credential-bearing checkout could therefore aim cleanup at the wrong database. | Use the canonical environment loader and its disable/precedence contract. Small. Block live verification until the synthetic environment regression passes. |
| OpenClaw claim could wait indefinitely | P2 / high / reliability | The new execution-claim fetch lacked a deadline. A hung response or response body could stop an unattended run indefinitely. | Bound both request and body reading, abort once, and block with reconciliation guidance without retrying the claim. Small. Regression covers a body that never resolves. |
| Liveness JSONB broke Setup | P2 / high / persistence and operator visibility | The direct PostgreSQL driver stored already-serialized liveness fields as JSON strings. A real report made `/setup` fail at `checks.map`; the browser smoke independently reproduced the failure. | Explicit text-to-JSONB writes, shared decoding of valid legacy rows, rejection of malformed stored data, and runtime projection on list reads. Small. Real database and built-browser regressions are release gates. |
| Recovery sample presented as a total | P2 / high / operational correctness | The production-data restore contained 105 outstanding actions, but the recovery query limited its sample to 100 and reported that sample length as the total. Operators could underestimate the reconciliation workload. | Count all matching rows in the same SQL statement, retain the bounded sample, and report sample count and truncation explicitly. Small. The regression failed before repair; a real PostgreSQL check now reports 105 total, 100 sampled, and truncation, with an empty-case check as well. |

The private audit evidence directory contains the pre-fix failures and post-fix
results. These findings extend the original audit rather than replacing its
47 finding records or changing their historical severity judgments.

Implementation-phase local verification passed: 5,552 root tests; 13 separately enabled PostgreSQL/hosted tests; 42 browser smoke tests; 153 live policy checks; 21 tenant-isolation checks; and five write-path canaries. Python ran 141 SDK tests and 799 hook tests, with three hook skips. CLI passed 251 tests with one skip, and MCP passed 83. Lint, typecheck, build, contracts, generated-artifact checks, and dependency/source scans passed. Lint retains four existing internal-navigation warnings. The implementation tracker preserves exact logs, failures, and bounded evidence.

The subsequent documentation and marketing pass passed a fresh production build, typecheck, documentation gates, 19 rendered public/discovery surfaces, 13 database/hosted integration tests, 42 browser smoke tests, 252 CLI tests, and 83 MCP tests. After adding the recovery-count regression and updating four older snippet assertions with explicit approval, the full root suite passed 5,553 tests with 13 skips. The updated assertions check governed helpers, execution claims, and outcome uncertainty; no failing test was skipped.

A production-data backup was encrypted, authenticated, and fully restored into an isolated PostgreSQL/pgvector fixture. All 80 migrations applied, a second pass applied zero, table and vector-row counts were preserved, and three historical signatures verified. The recovery drill still requires reconciliation of 95 running legacy actions. The separate marketing build database and the hosted service database also passed encrypted backup, full restore, and the two migration passes. This is recovery evidence for those source databases, not a service-wide RPO/RTO guarantee or confirmation of external effects.

This record captures the pre-deployment checkpoint. At that checkpoint no production migration, deployment, key rotation, secret-row rewrite, registry publication, or remote push had been performed. Provider failover, application OAuth exchange, and runtime installation matrices still require environment-specific verification. Runtime version and installed-hook fingerprint remain unavailable when a measurement cannot be resolved; the UI does not invent evidence. Published release status belongs to the corresponding release notes and deployment checks.

Automatic approval review rejected deletion of the extracted audit snapshot with "blocked by policy." That ignored artifact remains outside canonical test discovery.

## Retrospective

Real database constraints and built-server/browser checks found defects that isolated mocks missed. Editing a hook referenced by live sessions made a local checkout change operational immediately. Future enforcement upgrades must prove old-server/new-client compatibility before changing an installed entry point; the regression now exercises that boundary explicitly.
