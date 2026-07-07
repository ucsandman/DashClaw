---
source-of-truth: true
owner: Platform PM
last-verified: 2026-02-14
doc-type: rfc
---

# RFC: DashClaw Reliability And Platform Convergence

- RFC ID: RFC-2026-02-13-platform-convergence
- Status: In execution (approval pending)
- Date: February 13, 2026
- Horizon: 12 weeks (February 16, 2026 to May 8, 2026)

## 1. Objective

Ship a production-ready convergence plan across data access, API contracts, realtime delivery, documentation governance, and SDK parity with measurable SLO outcomes.

## 2. Scope

- In scope:
  - Repository-layer standardization for critical domains.
  - API schema/contract governance with CI enforcement.
  - SSE migration from in-memory bus to durable broker fanout.
  - Docs source-of-truth governance and CI checks.
  - Core Node/Python SDK parity on critical endpoints.
- Out of scope:
  - Full rewrite of all endpoints.
  - New product features unrelated to platform stability.
  - Deprecation of experimental APIs in this cycle.

## 3. Owners

- Executive Sponsor: Product Engineering Director
- Program Owner: Platform PM
- WS1 Owner: Backend Platform Lead
- WS2 Owner: API Governance Lead
- WS3 Owner: Realtime/Infra Lead
- WS4 Owner: DevEx Lead
- WS5 Owner: SDK Lead
- SRE/Observability: SRE Lead
- QA: Staff QA Engineer

## 4. Workstreams

### WS1: Data Access Convergence

- Owner: Backend Platform Lead
- Timeline: February 16, 2026 to April 10, 2026
- Goal: Eliminate direct route-level SQL in critical paths and enforce typed repository boundaries.
- Milestones:
  1. February 27, 2026: Repository interface spec approved for `actions`, `orgs/team`, `messages/context`.
  2. March 13, 2026: Top 10 high-traffic handlers migrated.
  3. March 27, 2026: Contract tests added for migrated repositories.
  4. April 10, 2026: CI guard blocks new direct `sql` usage in route handlers.
- Acceptance criteria:
  - 0 new direct `sql` calls in `app/api/**/route.js` after April 10, 2026.
  - 100% of critical-domain handlers use repository layer.
  - Repository contract test pass rate is 100% in CI.
  - No p95 regression greater than 10% on migrated endpoints.

### WS2: API Contract Governance

- Owner: API Governance Lead
- Timeline: February 16, 2026 to April 3, 2026
- Goal: Standardize request/response validation and compatibility checks.
- Milestones:
  1. February 27, 2026: Shared schema package and route contract template published.
  2. March 13, 2026: OpenAPI generation enabled for critical stable APIs.
  3. March 27, 2026: CI contract diff check required on PRs touching stable APIs.
  4. April 3, 2026: Maturity labels (`stable`, `beta`, `experimental`) applied to all routes.
- Acceptance criteria:
  - 100% stable endpoints have request/response schemas.
  - OpenAPI artifact generated in CI and versioned.
  - Breaking changes to stable APIs fail CI unless explicitly approved via RFC tag.
  - Route inventory includes maturity status for every API route.

### WS3: Realtime Reliability (SSE Fanout)

- Owner: Realtime/Infra Lead
- Timeline: February 16, 2026 to March 27, 2026
- Goal: Replace in-memory event bus with durable broker-backed fanout and replay window.
- Milestones:
  1. February 20, 2026: Broker design approved, channel strategy finalized (`org`-scoped channels and event IDs).
  2. March 6, 2026: Broker-backed publisher/subscriber merged behind feature flag.
  3. March 20, 2026: Reconnect and `Last-Event-ID` replay window shipped.
  4. March 27, 2026: Production cutover complete.
- Acceptance criteria:
  - Multi-instance SSE delivery success rate at or above 99.9% in load test.
  - Reconnect replay restores missed events within 60 seconds for short disconnects.
  - No duplicate event processing beyond idempotency tolerance (0.1% max).
  - Rollback plan tested in staging and documented.

### WS4: Documentation Governance

- Owner: DevEx Lead
- Timeline: February 16, 2026 to March 20, 2026
- Goal: Enforce canonical doc hierarchy and prevent version drift.
- Milestones:
  1. February 20, 2026: Canonical hierarchy ratified (`PROJECT_DETAILS.md` and ADR precedence).
  2. March 6, 2026: Doc metadata headers added (`source-of-truth`, `last-verified`, `owner`).
  3. March 13, 2026: CI checks for link validity and version consistency enabled.
  4. March 20, 2026: `README.md` trimmed to onboarding and canonical links.
- Acceptance criteria:
  - 0 unresolved version conflicts across canonical docs in CI checks.
  - 100% architecture docs include metadata headers.
  - Broken link check pass rate is 100%.
  - Contributor guide includes doc update protocol.

### WS5: SDK Core Parity

- Owner: SDK Lead
- Timeline: February 23, 2026 to May 8, 2026
- Goal: Achieve Node/Python parity for critical domains.
- Milestones:
  1. March 6, 2026: `docs/sdk-parity.md` baseline matrix published.
  2. March 27, 2026: Python SDK parity for `actions`, `approvals`, `guard`, `webhooks`.
  3. April 17, 2026: Python parity for `context`, `memory`, `messages`.
  4. May 8, 2026: Cross-SDK integration suite and release.
- Acceptance criteria:
  - Critical parity matrix completion is 100%.
  - Shared integration tests pass for Node and Python clients against the same harness.
  - SDK docs include parity guarantees and version compatibility policy.
  - Release notes include migration guidance for changed behavior.

## 5. Cross-Cutting SLO Deliverables

- Owner: SRE Lead
- Timeline: February 16, 2026 to March 13, 2026
- Acceptance criteria:
  - Action approval roundtrip p95 dashboard live and alerting configured (target under 2 seconds, excluding human wait).
  - Webhook first-attempt p95 dashboard live (target under 5 seconds) and retry observability configured.
  - Signal freshness dashboards live (critical <= 5 minutes, non-critical <= 15 minutes).
  - Error budgets defined and reviewed weekly.

## 6. Program Milestones

1. M0 (February 16, 2026): Kickoff, owners assigned, RFC approved.
2. M1 (March 6, 2026): Architecture and standards foundations complete.
3. M2 (March 27, 2026): Realtime cutover and API governance controls active.
4. M3 (April 17, 2026): Data-layer convergence on critical paths complete.
5. M4 (May 8, 2026): SDK parity release and closeout review.

## 7. Dependencies

- Broker provisioning and networking approvals.
- CI capacity for new contract and integration jobs.
- QA environment that mirrors multi-instance production topology.
- Product signoff on API maturity labels and stable contract policy.

## 8. Risks And Mitigations

- Migration regressions in high-traffic routes.
  - Mitigation: phased rollout, canary flags, per-endpoint rollback switches.
- Team bandwidth collisions across workstreams.
  - Mitigation: fixed owner accountability and weekly dependency review.
- Hidden parity gaps discovered late.
  - Mitigation: parity matrix baseline by March 6, 2026 and weekly burn-down tracking.

## 9. Governance Cadence

- Weekly 30-minute platform convergence review.
- Biweekly executive checkpoint with sponsor.
- RFC change control via ADR references for scope/schedule deviations.

## 10. Approval Checklist

- Engineering sponsor approval.
- Platform PM schedule signoff.
- SRE readiness signoff.
- QA test-plan signoff.
- SDK release owner signoff.

## 11. Execution Reconciliation (As Of February 14, 2026)

### Milestone Completion Snapshot

- Program:
  - `M1` complete
  - `M2` complete
  - `M3` complete
  - `M4` complete
- WS1 Data Access Convergence: milestones 1-4 complete
- WS2 API Contract Governance: milestones 1-4 complete
- WS3 Realtime Reliability: milestones 1-4 complete
- WS4 Documentation Governance: milestones 1-4 complete
- WS5 SDK Core Parity: milestones 1-4 complete

Source: `docs/rfcs/platform-convergence-status.md`

### Acceptance Criteria Verification Snapshot

Status key: `met` | `partial` | `not-yet-verified`

| Workstream | Acceptance Criteria Status | Evidence |
|---|---|---|
| WS1 | `met` | SQL drift guard and repository contract tests are in CI (`scripts/check-route-sql-guard.mjs`, `__tests__/unit/repositories.contract.test.js`), and WS1 p95 regression evidence is baselined/enforced (`docs/rfcs/platform-convergence-ws1-latency-baseline.json`, `scripts/check-convergence-ws1-latency.mjs`). |
| WS2 | `met` | OpenAPI generation/check and route maturity inventory are active (`scripts/generate-openapi.mjs`, `scripts/check-openapi-diff.mjs`, `docs/api-inventory.md`), and stable breaking-change RFC-tag override workflow is codified in `docs/openapi/README.md`. |
| WS3 | `met` | Broker/replay/cutover controls are shipped (`app/lib/events.js`, `docs/rfcs/2026-02-13-sse-cutover-runbook.md`) and realtime SLO evidence is captured in `docs/rfcs/platform-convergence-evidence.json` (delivery 100%, duplicate 0%, replay recovery 5/5). |
| WS4 | `met` | Governance hierarchy, metadata headers, and CI doc checks are in place (`docs/documentation-governance.md`, `scripts/validate-docs.mjs`, `.github/workflows/ci.yml`). |
| WS5 | `met` | Cross-SDK integration harness and release closeout are complete (`scripts/check-sdk-cross-integration.mjs`, `sdk-python/tests/test_ws5_m4_integration.py`, `docs/releases/2026-02-14-platform-convergence-closeout.md`). |

Detailed execution log and verification commands are maintained in `docs/rfcs/platform-convergence-status.md`.
