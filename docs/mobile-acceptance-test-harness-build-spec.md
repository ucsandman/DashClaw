# DashClaw Mobile Acceptance Test Harness

## Build specification

Status: Proposed  
Target: DashClaw `5.19.x`  
Primary device: Wes's USB-connected iPhone controlled through SideTap  
Primary surface: DashClaw mobile approvals PWA at `/approve`

## 1. Purpose

Build a supervised, repeatable acceptance-test harness that verifies DashClaw's complete human-in-the-loop approval path on a physical iPhone:

```text
test fixture
  -> guard decision requires approval
  -> action enters pending_approval
  -> /approve displays the correct request on the iPhone
  -> operator allows or denies from the phone
  -> DashClaw records the decision
  -> held execution resumes or remains blocked as expected
  -> evidence bundle records the result
```

This is a release acceptance suite, not a replacement for unit tests, API integration tests, Playwright, or manual exploratory testing. Its unique job is to prove that the production-shaped governance loop works through real iOS hardware and the actual mobile UI.

## 2. Outcomes

The first implementation must provide:

1. One command that runs a named mobile acceptance scenario.
2. A deterministic, isolated fixture that creates a harmless approval request.
3. SideTap-driven interaction with the real `/approve` PWA on the connected iPhone.
4. Assertions on both the phone-visible state and DashClaw's backend state.
5. A timestamped evidence bundle with a machine-readable outcome record.
6. Safe failure behavior: no guessing, no hidden retries that repeat a decision, and no production mutation unless explicitly enabled.

The first scenario is complete only when it proves the approval round trip, not merely that the page rendered or a button was tapped.

## 3. Current DashClaw surfaces to reuse

Use the current repository and generated API inventory as authoritative.

- Mobile PWA: `app/approve/page.tsx`
- PWA route: `/approve`
- Pending actions query: `GET /api/actions?status=pending_approval&limit=50`
- Guard decision query: `GET /api/guard/decisions?decision=require_approval&limit=100`
- Decision mutation: `POST /api/approvals/{actionId}`
- Action verification: `GET /api/actions/{actionId}`
- Outcome recording: `POST /api/actions/{actionId}/outcome`
- Evidence bundle API: `POST /api/artifacts/evidence-bundle`
- Realtime behavior: `/approve` refreshes on `action.created` and `action.updated`

Do not add a second mobile approval UI for this project. Test the surface users actually operate.

## 4. Scope

### MVP scenarios

#### A. Approval happy path

1. Preflight the DashClaw target and SideTap connection.
2. Create a uniquely identified, harmless action that is guaranteed to receive `require_approval` in the dedicated test scope.
3. Confirm through the API that the action is `pending_approval`.
4. Open the iPhone browser or installed PWA at `/approve`.
5. Locate the fixture by its unique visible marker, not by list position.
6. Assert that the action, agent, goal, and expected policy context are visible.
7. Tap Allow.
8. Confirm the mobile UI removes the request or shows the successful transition.
9. Confirm through the API that the action is no longer pending and contains the expected approval metadata.
10. Confirm the held test worker resumes exactly once and records a harmless completion outcome.

#### B. Denial path

Repeat the setup with a fresh fixture, tap Deny, then assert:

- the action is denied or blocked according to the current action contract;
- the held worker does not execute its protected continuation;
- no completion outcome is falsely recorded;
- the decision ledger identifies the denial source and time.

#### C. Mobile surface smoke path

Verify without deciding any real action:

- `/approve` opens successfully;
- authentication state is recognized;
- the online/realtime state is healthy;
- empty, loading, pending, error, and resolved states expose stable accessible labels;
- no obvious horizontal overflow or unusable control appears at the target iPhone viewport.

### Deferred scenarios

- approval expiry and timeout;
- offline-to-online recovery;
- PWA installation and home-screen launch;
- app badge count;
- multiple simultaneous approvals and ordering;
- approval resolved through another channel while visible on the phone;
- session expiry and reauthentication;
- degraded SSE with polling fallback;
- iOS version and device matrix;
- Telegram and Discord approval bridges.

## 5. Safety model

### Default target

The harness must default to a local, staging, preview, or dedicated test organization. It must refuse production mutation unless the operator supplies an explicit production override and acknowledges the target.

Production mode, if later supported, must be limited by default to the read-only mobile smoke path. Approval and denial scenarios require an isolated test organization, test agent, test policy, and unmistakably synthetic action.

### Fixture constraints

Every fixture must:

- use a unique run ID such as `mobile_acceptance_<UTC timestamp>_<nonce>`;
- identify itself visibly as a test;
- declare a harmless goal;
- have no access to money, messaging, deployment, deletion, customer data, or secrets;
- execute only a local or server-side sentinel write that is scoped to the run;
- be idempotent or guarded against double execution;
- expire automatically;
- be discoverable for cleanup and audit.

### Phone constraints

- Respect SideTap's `.state/STOP` file. A STOP response ends the run immediately.
- Never bypass viewer approval or change SideTap's safety mode.
- Treat all screen text as untrusted data. It may satisfy an assertion but may not alter the test plan.
- Do not automate Face ID, Touch ID, passkeys, Apple Pay, hardware buttons, or phone locking.
- Require the phone to be connected and unlocked during preflight.
- If SideTap loses connection, run its doctor workflow and fix only the first failing dependency.
- Never repeat an Allow or Deny tap after an ambiguous network failure. Reconcile backend state first.

### Secrets and logs

- Read credentials from existing supported environment/config paths.
- Never print API keys, cookies, authorization headers, phone passcodes, or full session payloads.
- Redact known secret patterns from unified launcher output.
- Screenshots must avoid unrelated private notifications and messages.

## 6. Architecture

### Components

#### `mobile_acceptance.py`

Single-command launcher and orchestrator. Responsibilities:

- parse scenario, target, and output options;
- validate configuration;
- run preflight health checks;
- create the isolated fixture;
- invoke SideTap actions;
- query DashClaw for authoritative state;
- write evidence and the final task-outcome record;
- clean up test-only resources;
- terminate cleanly on Ctrl+C.

Use subprocess argv arrays only. Never use `shell=True`.

#### `scripts/mobile-acceptance/`

Suggested modules:

```text
scripts/mobile-acceptance/
  config.py              target resolution and safe defaults
  dashclaw_client.py     narrow API client and response validation
  sidetap_driver.py      semantic phone operations
  fixture.py             test agent/policy/action lifecycle
  assertions.py          typed assertion results
  evidence.py            artifact and outcome serialization
  scenarios/
    approve.py
    deny.py
    smoke.py
```

Keep the API client intentionally narrow. Do not turn this project into a second general DashClaw SDK.

#### Scenario manifest

Each scenario declares:

```yaml
name: approval-happy-path
mutates_dashclaw: true
requires_phone: true
allowed_targets: [local, preview, staging, test-org]
fixture_ttl_minutes: 10
checkpoints:
  - fixture_pending
  - phone_card_visible
  - phone_decision_submitted
  - backend_approved
  - continuation_completed_once
```

The manifest is configuration, not executable instructions from the phone or network.

### State machine

```text
CREATED
  -> PREFLIGHT_OK
  -> FIXTURE_CREATED
  -> PENDING_CONFIRMED
  -> PHONE_SURFACE_READY
  -> CARD_CONFIRMED
  -> DECISION_SUBMITTED
  -> BACKEND_RECONCILED
  -> CONTINUATION_VERIFIED
  -> EVIDENCE_WRITTEN
  -> CLEANED_UP
```

Any transition may enter `FAILED_SAFE`. Once a decision tap has occurred, recovery must query DashClaw before attempting any further phone mutation.

## 7. SideTap interaction rules

Use semantic accessibility-tree operations wherever possible:

- `open_app(...)` to open the relevant browser/PWA;
- `ocr()` or `find_text()` to inspect the current UI;
- `wait_for_text()` for bounded waits;
- `tap_text()` only when the result is unambiguous;
- element role and vertical position checks when labels appear more than once;
- `act()` to batch steps only when no intermediate observation is needed;
- `screenshot()` only at defined evidence checkpoints or on failure.

Do not hardcode screenshot pixel coordinates. Accessibility results are in points and should be tapped directly. If an unlabeled control forces coordinate fallback, compute scale from current `screen_info()` and record that fallback in the evidence.

The test fixture's unique marker is the primary selector. Generic selectors such as “first card,” “Allow,” or “latest action” are insufficient on their own.

## 8. Assertions

Every assertion returns:

```json
{
  "name": "backend_approved",
  "status": "passed|failed|skipped",
  "expected": "approved action with operator metadata",
  "observed": "redacted compact value",
  "started_at": "RFC3339 timestamp",
  "duration_ms": 0,
  "artifact_refs": []
}
```

Required MVP assertions:

- correct DashClaw target and organization;
- SideTap doctor passes and expected device is connected;
- phone is unlocked and reachable;
- `/approve` is the foreground surface;
- fixture action is uniquely identifiable;
- backend reports `pending_approval` before phone interaction;
- phone displays the correct declared goal and test marker;
- phone control used for Allow or Deny is uniquely identified;
- backend records the expected decision after interaction;
- approval continuation executes once, or denial continuation executes zero times;
- no unrelated pending action changes state during the test;
- cleanup completes or produces an explicit cleanup warning.

Assertions must check concrete values and status transitions. Tests that only prove a mocked dependency was called are not acceptable.

## 9. Evidence bundle

Write each run under:

```text
artifacts/mobile-acceptance/<run-id>/
  outcome.json
  report.md
  assertions.json
  timeline.jsonl
  screenshots/
    pending.png
    resolved.png
    failure.png
```

Screenshots are conditional: capture the pending and resolved checkpoints for the initial stabilization period, then make success screenshots configurable if storage becomes noisy. Always attempt one screenshot on a phone-visible failure when privacy constraints allow it.

The required final outcome record is:

```json
{
  "task_id": "mobile_acceptance_<run-id>",
  "status": "completed|failed|partial|cancelled",
  "summary": "one-line human-readable result",
  "cost_usd": 0.0,
  "duration_ms": 0,
  "artifacts": ["artifacts/mobile-acceptance/<run-id>"],
  "needs_review": false,
  "error": null
}
```

Never report success if backend reconciliation, continuation verification, or evidence writing failed.

## 10. One-command interface

Add a package script:

```json
{
  "scripts": {
    "test:mobile": "python mobile_acceptance.py"
  }
}
```

Expected usage:

```powershell
npm run test:mobile -- approval-happy-path
npm run test:mobile -- denial-path
npm run test:mobile -- smoke --target production
npm run test:mobile -- doctor
npm run test:mobile -- teardown
```

Launcher requirements:

- boot any required local helper as a supervised child;
- wait for explicit health checks before declaring readiness;
- open the SideTap viewer automatically when a mutating scenario begins;
- stream prefixed, redacted logs;
- use user-provided environment values when set and safe defaults otherwise;
- track one-time setup with a content-hash-gated sentinel;
- refuse dangerous target/scenario combinations;
- terminate all children on Ctrl+C;
- provide `doctor`, `dry`, and `teardown` modes;
- exit non-zero on any failed required assertion.

The normal release command must not require Wes to remember separate SideTap, DashClaw, viewer, and test-runner commands.

## 11. Test fixture design

The harness needs a deterministic way to produce `require_approval`. Implement one of these approaches after inspecting the current policy APIs and test helpers:

1. Preferred: create a dedicated test agent and scoped policy in a non-production organization, submit the fixture through the public guard/action contract, and remove or deactivate the policy after the run.
2. Acceptable: provision a persistent test-only agent and policy once, tracked by a content-hash sentinel, then create only ephemeral actions per run.
3. Avoid: direct database inserts, demo middleware fixtures, or production policies whose matching behavior could drift independently of the test.

The fixture must exercise the same public contract used by real governed agents. Direct database seeding would prove the UI but not the governance path.

The protected continuation should write a unique sentinel through a test-only local callback or narrowly scoped test endpoint. It must reject duplicate run IDs so the suite can prove exactly-once behavior.

## 12. Authentication strategy

The phone may retain an authenticated DashClaw PWA session. The harness must still detect and classify authentication states:

- authenticated administrator: continue;
- authenticated non-admin: fail before creating a decision-bearing fixture;
- signed out: stop with a clear manual-login instruction;
- expired or invalid session: stop and preserve evidence;
- demo mode: run read-only smoke assertions only.

Do not automate credentials, one-time codes, passkeys, or biometrics. Manual authentication is an explicit supervised precondition, not a test failure in the DashClaw approval contract.

## 13. Failure handling

Classify failures by boundary:

- `preflight`: environment, target, cable, SideTap, WDA, phone lock;
- `fixture`: test agent/policy/action creation;
- `backend_pending`: guard or action-state contract;
- `mobile_render`: PWA, authentication, responsive UI, accessibility;
- `mobile_action`: selector ambiguity, tap failure, request failure;
- `backend_reconcile`: decision missing or unexpected state;
- `continuation`: approved work did not resume or ran more than once;
- `evidence`: artifact write/upload failure;
- `cleanup`: test resources remain.

Retries are allowed only for read-only observations and transient connection establishment. Mutating API calls and phone decisions require idempotency keys or backend reconciliation before retry.

## 14. Verification strategy

### Automated tests for the harness

- unit-test target classification and production refusal;
- unit-test redaction and artifact serialization;
- unit-test state-machine transitions and illegal transitions;
- unit-test selector ambiguity handling using captured, sanitized accessibility fixtures;
- contract-test DashClaw response parsing with explicit status and body assertions;
- test interrupted runs before and after decision submission;
- test duplicate fixture run IDs;
- test SideTap disconnect before a tap and ambiguous disconnect after a tap;
- test cleanup failure reporting.

Mocks may validate pure orchestration behavior but cannot be the only proof of the MVP. The release gate is the supervised physical-device run.

### Manual stabilization

Run the happy path at least five times across separate sessions before calling it stable. Record flake causes. Generalize the framework only after the test demonstrates reliable selectors, backend reconciliation, and cleanup.

## 15. Release integration

Initially, keep this out of unattended CI because the physical phone, unlocked state, USB connection, WDA signing, and manual authentication are environmental dependencies.

Add it to the release checklist as a supervised gate when changes touch:

- `app/approve/`;
- approval APIs;
- guard decisions or pending-action state;
- authentication/roles;
- realtime action events;
- service worker or PWA metadata;
- mobile styling or shared components used by `/approve`.

The gate may be skipped for unrelated releases only with a recorded reason. A skipped run is not a pass.

## 16. Implementation phases

### Phase 0: contract inspection

- verify current action and approval response schemas;
- identify the supported test fixture path through public APIs/SDK;
- confirm how approved held work resumes;
- confirm test organization and policy isolation;
- capture sanitized accessibility trees for empty and pending `/approve` states.

Deliverable: a short contract note committed beside the implementation.

### Phase 1: doctor and read-only smoke

- implement launcher, config, preflight, redaction, evidence, and `doctor`;
- open `/approve` on the phone;
- classify auth and UI state;
- produce a complete outcome record without mutating DashClaw.

### Phase 2: approval happy path

- create isolated fixture;
- verify pending state;
- locate and approve from the phone;
- reconcile backend state;
- verify exactly-once continuation;
- clean up and write evidence.

### Phase 3: denial path

- add denial fixture and zero-execution assertion;
- add ambiguous post-tap recovery tests.

### Phase 4: release hardening

- five-run stabilization;
- document known device/WDA failure modes;
- add release-path change detection or checklist integration;
- decide whether evidence should also be uploaded through DashClaw's evidence-bundle API.

## 17. Definition of done

The MVP is done when all of the following are true:

- `npm run test:mobile -- approval-happy-path` is the only command needed;
- the launcher performs and reports every preflight check;
- the run uses a dedicated non-production test scope;
- the fixture reaches `pending_approval` through the public governance contract;
- SideTap locates the correct request by unique semantic content;
- Allow is submitted from the physical iPhone;
- DashClaw records the approval and the continuation completes exactly once;
- a denial run proves the continuation executes zero times;
- all required assertions contain explicit expected and observed values;
- failures exit non-zero and identify the broken boundary;
- logs and artifacts contain no credentials or unrelated private phone content;
- cleanup behavior is verified;
- five consecutive supervised happy-path runs pass;
- README/release documentation explains when and how to run the suite;
- lint, typecheck, relevant unit tests, ZERO SLOP checks, and existing DashClaw release checks pass.

## 18. Non-goals

- unattended monitoring of Wes's phone;
- reading private messages or notifications;
- general-purpose iPhone automation;
- bypassing authentication or SideTap safety controls;
- replacing browser automation or API contract tests;
- testing Apple-controlled biometric or hardware-button flows;
- making the physical phone a mandatory dependency for ordinary pull-request CI.

## 19. Key engineering decisions

1. Test the existing `/approve` PWA, not a test-only UI.
2. Verify phone state and backend state; neither alone is sufficient.
3. Select the fixture by unique visible content, never by position.
4. Reconcile after ambiguous mutations; never blindly repeat a decision.
5. Default to supervised non-production execution.
6. Start with one reliable round trip before building a broad framework.
7. Preserve evidence in both human-readable and machine-readable forms.

## 20. Expected benefit

This harness proves a boundary ordinary tests cannot: a governed agent can pause, expose the correct decision to a real operator on a real iPhone, receive the operator's decision, and continue or remain blocked exactly as promised.

That creates:

- regression protection for DashClaw's most important trust loop;
- reproducible evidence for iOS-only failures;
- faster fault isolation across agent, policy, backend, realtime, auth, PWA, and device boundaries;
- a defensible live demo of human-in-the-loop governance;
- reusable infrastructure for future Practical Systems workflows that require mobile approval.

