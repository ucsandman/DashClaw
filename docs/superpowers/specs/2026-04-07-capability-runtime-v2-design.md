---
source-of-truth: false
owner: SDK Lead
last-verified: 2026-04-07
doc-type: spec
status: proposed
---

# Capability Runtime V2 Design

## Purpose

Define the first production-grade version of DashClaw's governed capability runtime.

This spec turns the existing capability registry plus HTTP invoke path into a coherent execution domain with:

- canonical SDK ownership,
- typed capability contracts,
- governed invocation semantics,
- capability test and health flows,
- a clear migration path away from `legacy` drift.

## Why This Is First

Capabilities are the strongest commercial wedge in the current platform direction.

DashClaw already has:

- capability registry CRUD in the canonical Node SDK,
- a governed HTTP invoke route,
- workflow steps that call the same runtime helper,
- quota, guard, DLP, auth resolution, and action logging in the invoke path.

What it does not have yet is a mature capability runtime contract that customers can trust as the default gateway for agent tool use.

## Current State

As of this spec:

- `sdk/dashclaw.js` exposes `listCapabilities`, `createCapability`, `getCapability`, and `updateCapability`.
- `app/api/capabilities/[capabilityId]/invoke/route.js` provides governed invocation for `http_api` capabilities only.
- `app/lib/capability-invoke.js` handles auth resolution, request mapping, response mapping, timeout, and normalized downstream errors.
- `app/lib/step-handlers.js` uses the same helper for workflow `capability_invoke` steps.
- Python exposes capability registry CRUD but no broader canonical capability runtime abstraction.
- `legacy` should not become the place where new capability features land.

## Problems To Solve

1. The canonical SDK exposes capability metadata, but not capability execution.
2. Invocation contracts are too loose and validated too late.
3. The runtime only supports one-shot HTTP calls.
4. There is no first-class test flow for operators validating a capability before use.
5. There is no health model that operators can trust.
6. There is no clean story for features that were started in `legacy` or Python-first surfaces.

## Product Decision

The capability domain is promoted first and lives in the canonical SDK.

Canonical target:

- `execution.capabilities`

Compatibility policy:

- `dashclaw/legacy` may provide compatibility wrappers only. (now DEPRECATED — removed in v5.0.0)
- No new capability feature begins in `legacy`.
- Python should align to the same route contracts and method semantics, even if namespace convergence happens later.

## Goals

1. Make DashClaw the governed path for tool and API execution.
2. Make capability definitions safer and more inspectable before runtime.
3. Give operators a real test, health, and failure surface.
4. Keep the runtime aligned with workflows and future artifacts/evidence.
5. Make SDK behavior explicit and stable enough for public examples and packaging.

## Non-Goals

1. Do not build a marketplace in this phase.
2. Do not add every source type at once.
3. Do not make `legacy` feature-complete again.
4. Do not build full async workflow orchestration here.
5. Do not block on final Python namespace redesign.

## Canonical Object Model

The capability runtime extends the platform object model with these first-class concepts:

### Capability

The registered governed tool definition.

Minimum fields:

- `capability_id`
- `name`
- `slug`
- `category`
- `source_type`
- `risk_level`
- `requires_approval`
- `status`
- `docs_url`
- `tags`
- `contract`
- `runtime_policy`
- `health`

### Capability Contract

The versioned input, output, auth, and invocation definition.

Minimum fields:

- `version`
- `transport`
- `method`
- `endpoint`
- `auth`
- `input_schema`
- `output_schema`
- `request_mapping`
- `response_mapping`
- `error_mapping`

### Runtime Policy

Operator-controlled execution behavior.

Minimum fields:

- `timeout_ms`
- `retry_policy`
- `concurrency_limit`
- `budget_policy`
- `approval_policy`
- `dlp_policy`
- `idempotency_policy`

### Capability Health

Operator-visible state derived from test runs and governed invocations.

Minimum fields:

- `status`
- `last_checked_at`
- `last_success_at`
- `last_failure_at`
- `success_rate_1d`
- `success_rate_7d`
- `p95_latency_ms`
- `recent_errors`
- `certification_status`

## Phase 1 Source-Type Scope

Phase 1 supports only:

- `http_api`

That is deliberate. It matches the runtime that already exists and lets DashClaw harden one path well before expanding source types.

Future source types can be added later:

- `webhook`
- `internal_sdk`
- `human_approval`
- `marketplace`

But those are not part of this build.

## Canonical SDK Design

### Short-Term Rule

Preserve the existing flat methods for compatibility in the main SDK while introducing the canonical domain grouping in parallel.

Short-term acceptable state:

```js
dc.listCapabilities(...)
dc.createCapability(...)
dc.getCapability(...)
dc.updateCapability(...)
dc.execution.capabilities.invoke(...)
dc.execution.capabilities.test(...)
dc.execution.capabilities.getHealth(...)
```

### End-State Shape

```js
dc.execution.capabilities.list(filters)
dc.execution.capabilities.create(data)
dc.execution.capabilities.get(capabilityId)
dc.execution.capabilities.update(capabilityId, patch)
dc.execution.capabilities.invoke(capabilityId, payload)
dc.execution.capabilities.test(capabilityId, payload)
dc.execution.capabilities.getHealth(capabilityId)
dc.execution.capabilities.listHealth(filters)
```

### Compatibility Rules

1. Existing flat main-SDK capability methods remain temporarily as aliases.
2. `legacy` wrappers call the same HTTP routes and return the same payload shapes.
3. New runtime-only methods (`invoke`, `test`, `getHealth`) are canonical-first and are not introduced in `legacy` as first-class design surfaces.

## Route Design

### Keep

- `GET /api/capabilities`
- `POST /api/capabilities`
- `GET /api/capabilities/:id`
- `PATCH /api/capabilities/:id`
- `POST /api/capabilities/:id/invoke`

### Add

- `POST /api/capabilities/:id/test`
- `GET /api/capabilities/:id/health`
- `GET /api/capabilities/health`

### Route Semantics

#### Invoke

`POST /api/capabilities/:id/invoke`

Production governed execution.

Must:

- create an action record,
- run guard evaluation,
- enforce approval rules,
- run quota and budget checks,
- run DLP scanning,
- use runtime policy,
- emit structured outcome data,
- contribute to health metrics.

#### Test

`POST /api/capabilities/:id/test`

Operator validation flow.

Must:

- use the same contract resolution path as invoke,
- skip production metering by default,
- clearly mark runs as tests,
- record test outcome and timing,
- optionally persist test evidence for certification.

#### Health

`GET /api/capabilities/:id/health`

Capability-specific health summary.

Should return:

- current health state,
- recent latency,
- recent success/failure counts,
- certification state,
- last test result summary.

#### Health List

`GET /api/capabilities/health`

Operator table backing route for the future cockpit.

Should support filtering by:

- status,
- certification,
- category,
- risk level,
- stale checks.

## Contract Model

The existing `invocation_schema` should evolve into a more explicit contract object.

### Current-Compatible Model

Support both:

- `invocation_schema` for compatibility
- `contract` as the new canonical field

Phase 1 rule:

- reads accept either,
- writes normalize to canonical `contract`,
- route responses may include both during migration if needed.

### Required Contract Fields

- `version`
- `transport`
- `method`
- `endpoint`
- `auth`
- `input_schema`
- `output_schema`

### Optional Contract Fields

- `request_mapping`
- `response_mapping`
- `error_mapping`
- `timeout_ms`
- `retry_policy`
- `idempotency_key_field`

### Validation Rules

Create and update must reject invalid definitions before runtime.

At minimum validate:

- `transport` is supported,
- `endpoint` is resolvable,
- auth config is structurally valid,
- input schema is valid JSON Schema or approved schema subset,
- output schema is valid JSON Schema or approved schema subset,
- request and response mappings reference legal paths,
- timeout and retry values are within safe bounds.

## Runtime Behavior

### Invocation Lifecycle

1. Load capability definition.
2. Normalize contract and runtime policy.
3. Validate request payload against input schema.
4. Resolve auth and endpoint from org settings.
5. Evaluate guard and approval requirements.
6. Create action record with governed metadata.
7. Execute runtime with timeout and retry policy.
8. Validate output against output schema.
9. Update action outcome and capability health metrics.
10. Return structured result.

### Error Taxonomy

Standardize these error families:

- `capability_not_found`
- `capability_not_invocable`
- `capability_contract_invalid`
- `capability_input_invalid`
- `auth_not_configured`
- `endpoint_not_configured`
- `blocked_by_policy`
- `pending_approval`
- `quota_exceeded`
- `capability_timeout`
- `capability_network_error`
- `capability_downstream_error`
- `capability_output_invalid`

### Retry Policy (Implemented 2026-04-08)

Retry support is runtime-controlled via `retry_policy` inside `invocation_schema`.

Implemented fields:

- `max_retries` — integer 0-5, default 0 (disabled)
- `backoff` — `none` | `fixed` | `exponential`
- `base_delay_ms` — integer 100-30000, default 1000
- `max_delay_ms` — integer 100-60000, default 30000 (cap for exponential)
- `retryable_status_codes` — array of HTTP status codes 400-599, defaults to [429, 500, 502, 503, 504]

Retryability rules:

- Always retry on `capability_timeout` and `capability_network_error`
- Retry on `capability_error` when status is in `retryable_status_codes`
- Never retry on input/output schema validation errors or auth errors

Backoff algorithm:

- `none`: 0ms delay (immediate retry)
- `fixed`: constant `base_delay_ms` between attempts
- `exponential`: `base_delay_ms * 2^attempt` with 10% jitter, capped at `max_delay_ms`

Response includes `retry_metadata` when retries are configured:

```js
retry_metadata: {
  total_attempts: 3,
  retried: true,
  attempts: [
    { attempt: 1, error: 'capability_timeout', elapsed_ms: 5000 },
    { attempt: 2, error: 'capability_error', status: 503, elapsed_ms: 450 },
    { attempt: 3, success: true, elapsed_ms: 320 },
  ]
}
```

Default behavior (max_retries: 0) is identical to pre-retry behavior — no retry_metadata emitted.

### Circuit Breaker (Implemented 2026-04-08)

Circuit breaker support is configured via `circuit_breaker` inside `invocation_schema`.

Implemented fields:

- `enabled` — boolean, default false
- `consecutive_failures` — integer 1-50, default 5

Behavior:

- Before executing an invocation, the invoke route queries the last N `capability_invoke` action records
- If all N are `'failed'` AND `capability.health_status !== 'healthy'`, returns 503 with `error: 'circuit_breaker_open'`
- If `health_status === 'healthy'` (set by a successful test or successful invocation), the check is bypassed
- The test route always bypasses the circuit breaker — operators can always test to reset
- Successful invocations update `health_status` to `'healthy'` (fire-and-forget)

Reset mechanism:

1. Circuit trips after N consecutive invoke failures
2. Operator runs a test via `/api/capabilities/:id/test` → test succeeds → sets `health_status` to `'healthy'`
3. Next invoke sees `health_status === 'healthy'`, skips circuit check, executes normally

Default behavior (circuit_breaker absent or enabled: false) is identical to pre-circuit behavior — no blocking check performed.

### Output Validation

Phase 1 must validate outputs when `output_schema` exists.

If validation fails:

- mark invocation failed,
- record output validation error,
- update health metrics,
- do not silently pass raw downstream output as success.

## Test and Certification Model

Capability testing should be an explicit operator action.

### Test Run

A test run is a governed but non-production invocation.

Attributes:

- `mode: test`
- optional saved fixture payload
- optional expected assertions
- explicit evidence summary

### Certification

Certification is simple in Phase 1.

A capability becomes `certified` when:

- a test run passes,
- contract validation passes,
- auth and endpoint resolution succeed.

Certification is revoked when:

- contract changes,
- auth becomes unresolved,
- endpoint becomes invalid,
- repeated health failures breach threshold.

## Health Model

Health should be derived, not hand-edited.

### Health States

- `healthy`
- `degraded`
- `failing`
- `untested`
- `disabled`

### Initial Thresholds

- `untested`: no successful test or invoke yet
- `healthy`: recent success rate acceptable and no severe stale failures
- `degraded`: elevated error rate or stale last success
- `failing`: repeated recent failures or last checks consistently bad
- `disabled`: operator-disabled

### Data Sources

Health calculations should use:

- governed invocation results,
- test results,
- latency metrics,
- recent error codes,
- contract validation failures.

## Workflow Integration

Workflow `capability_invoke` steps must continue to use the same runtime core.

Rules:

1. Workflow steps should call the same normalized contract execution layer as direct invoke.
2. Workflow failures should preserve capability error taxonomy.
3. Capability test-only semantics do not apply inside workflow execution.
4. Workflow step outputs should benefit from output validation once enabled.

This avoids direct invoke and workflow invoke drifting apart.

## Data and Storage Changes

### Capability Table Changes

Add or normalize storage for:

- canonical `contract`
- `runtime_policy`
- `health_status`
- `health_snapshot`
- `certification_status`
- `last_tested_at`
- `last_invoked_at`

### Capability Event or Metrics Storage

Add a storage path for:

- test run summaries,
- recent error distribution,
- latency aggregates,
- success/failure counters.

This can be a dedicated metrics table or a summarized repository layer over action records plus capability events.

## UI and Operator Implications

This spec is backend-first, but it exists to support an operator-visible product.

Minimum UI hooks enabled by this work:

- capability detail health section,
- capability detail test button,
- certification badge,
- recent failure summary,
- latency and success-rate indicators.

## Migration Plan

### Step 1

Refactor the current invoke path into a normalized capability runtime service.

### Step 2

Add contract validation on create and update.

### Step 3

Add canonical SDK runtime methods for invoke, test, and health.

### Step 4

Add test route and health routes.

### Step 5

Shim flat or legacy wrappers to the same route contracts where needed.

### Step 6

Update docs and examples to point to the canonical surface first.

## Testing Plan

### Unit Tests

- contract validation success and failure
- input validation
- output validation
- retry policy behavior
- health state transitions
- certification transitions

### Route Tests

- invoke success
- invoke blocked by policy
- invoke pending approval
- invoke auth missing
- invoke endpoint missing
- invoke output schema invalid
- test route success
- health route payloads

### SDK Tests

- canonical capability runtime methods call correct routes
- compatibility wrappers return same payload shapes

### Integration Tests

- workflow `capability_invoke` uses normalized runtime
- health metrics update after invoke and test flows

## Milestones

### M1: Runtime Consolidation

- extract shared capability runtime service
- keep current invoke route behavior stable
- no public behavior regressions

### M2: Contract Validation

- create/update validation
- canonical contract field support
- input and output validation

### M3: SDK Promotion

- canonical `execution.capabilities` methods
- temporary flat aliases
- legacy shims where required

### M4: Test and Health

- test route
- health routes
- certification state
- operator-visible summaries

### M5: Workflow Convergence

- workflow steps fully aligned with runtime service
- consistent taxonomy and validation behavior

## Open Questions

1. Should output schemas use raw JSON Schema or a constrained subset in Phase 1?
2. Do we want to store both raw downstream output and validated output summary, or only validated output plus redacted raw evidence?
3. Should capability tests create action records in the same table or a dedicated run table linked back to the capability?
4. Should Python expose final namespaces directly in the same milestone as Node, or follow one milestone later with equivalent route coverage first?

## Recommendation

Proceed with this domain before any broader capability marketplace, agent-tool gallery, or advanced workflow branching work.

The right order is:

1. make capability execution trustworthy,
2. make it operator-legible,
3. then widen the product surface built on top of it.

## Related Documents

- [Agent Operating Layer Roadmap](../../planning/2026-04-07-agent-operating-layer-roadmap.md)
- [SDK Consolidation RFC](../../rfcs/2026-04-07-sdk-consolidation.md)
- [SDK Migration Matrix](../../planning/2026-04-07-sdk-migration-matrix.md)
- [Platform Object Model](../../architecture/platform-object-model.md)
