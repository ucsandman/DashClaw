# DashClaw Security, Reliability, and Production Hardening Plan

> **Repository:** `ucsandman/DashClaw`  
> **Execution model:** Claude Code Goal plus Ultracode dynamic workflows  
> **Purpose:** Harden the platform before the TypeScript migration  
> **Recommended repository path:** `docs/plans/dashclaw-hardening.md`

## 1. Objective

Transform DashClaw into a substantially more secure, reliable, maintainable, and production ready agent governance platform.

Make the largest responsible improvement that can be completed and verified in one goal run. Prioritize foundational correctness, security, auditability, tenant isolation, payment governance, and data integrity over new product features.

This work must stabilize observable behavior before the TypeScript migration begins.

## 2. Core Product Boundary

DashClaw is a governance and decision control plane for AI agents.

DashClaw may:

* Evaluate proposed actions
* Apply policies
* Calculate authoritative risk
* Require human approval
* Block actions
* Record decisions
* Record execution outcomes
* Store audit evidence
* Aggregate spend
* Govern x402 purchases
* Score and analyze agent behavior

DashClaw must not:

* Execute x402 payments
* Hold wallet credentials
* Silently expand tenant access
* Trust client supplied identity, risk, approval, or verification state
* Report successful governance before required audit evidence is durable
* Conflate token spend with x402 purchase spend
* Reprice historical stored costs during aggregation

## 3. Known Concerns to Investigate

### 3.1 Identity enforcement

The guard route supports stronger identity verification, replay protection, and action binding than some action creation paths.

Investigate whether action creation, x402 purchase creation, integrations, hooks, and other routes can rely on self asserted `agent_id` values or optional signatures.

Required outcome:

* All governed action creation paths use a shared identity resolution contract.
* Verified identity overrides body identity.
* Self asserted identity is represented explicitly and cannot be confused with verified identity.
* Cross tenant identity substitution is rejected.

### 3.2 Guard decision durability

Investigate whether guard decision persistence is performed asynchronously without guaranteeing that the audit row commits before the response completes.

Required outcome:

* A successful guard response is not returned until required audit evidence is durable.
* Database failure behavior is explicit and tested.
* Serverless execution cannot silently lose decision evidence.
* Retries do not create invalid duplicate decisions.

### 3.3 Authoritative risk consistency

Investigate whether the guard engine calculates authoritative risk while action records store the caller supplied value or zero.

Required outcome:

* Server calculated risk is authoritative.
* Client risk may increase risk but may never reduce it.
* The same authoritative value flows through guard decisions, action records, x402 purchase actions, alerts, analytics, API responses, and dashboard displays.

### 3.4 API surface and validation

The repository has a large API surface containing stable, beta, and experimental routes.

Investigate:

* Duplicated request parsing
* Missing runtime validation
* Insecure defaults
* Missing authorization checks
* Inconsistent organization resolution
* Fragile error handling
* Information leakage
* Missing rate limits
* Invalid state transitions
* Unnecessary experimental complexity
* Routes that bypass shared governance helpers

### 3.5 Version and deployment consistency

Investigate inconsistencies among:

* `package.json`
* SDK versions
* Changelog
* Release metadata
* Documentation
* Environment examples
* Migrations
* OpenAPI output
* API inventory
* Generated documentation
* Deployment instructions

### 3.6 Fail safe security behavior

Review:

* Authentication
* Authorization
* Tenant isolation
* Agent identity
* API keys
* JWT and JWKS validation
* Replay protection
* Action binding
* Signature enforcement
* Secret scanning
* Secret redaction
* Prompt injection scanning
* Webhook delivery
* Approval workflows
* Outcome finality
* Audit integrity
* Dependency failure behavior

Security controls must fail safely without causing unnecessary platform wide outages.

## 4. New x402 and FinOps Scope

The hardening work must include the current x402 spend governance and FinOps implementation.

### 4.1 x402 invariants

Preserve these boundaries:

* DashClaw governs and records purchases.
* The agent executes the provider call and payment.
* DashClaw never becomes a wallet or payment executor.
* Purchases remain linked to governed action records.
* Provider and endpoint identity remain explicit.
* Spend policies remain server enforced.
* Approval thresholds remain authoritative.
* Wallet and payment references are treated as sensitive identifiers.
* Purchase outcome states remain consistent with action outcome states.

Investigate:

* Forged agent identity on purchase creation
* Client supplied risk reduction
* Negative, nonfinite, or malformed spend amounts
* Unsupported or inconsistent currencies
* Invalid provider and endpoint combinations
* Disabled providers
* Cross tenant provider, endpoint, and purchase access
* Partial failure between action record creation and purchase detail creation
* Duplicate purchase creation
* Outcome state drift
* Raw wallet or payment reference leakage
* Bypass of provider allow lists, block lists, maximum spend, or approval thresholds

### 4.2 FinOps invariants

Preserve:

* Agent LLM Spend excludes `x402_purchase`.
* Fleet Spend equals Agent LLM Spend plus x402 Purchase Spend.
* Claude Code spend remains advisory and separate from governed fleet spend.
* FinOps remains a read only aggregation layer that owns no tables.
* Stored cost values are aggregated without repricing.
* Billing remains authoritative for stored model cost.
* The pricing parity guard remains green until the planned TypeScript pricing unification.

Investigate:

* Double counting
* Incorrect currency assumptions
* Invalid periods or lenses
* Cross tenant spend aggregation
* Numeric coercion problems
* Missing or malformed database values
* Dashboard and API shape disagreement
* Drift between pricing modules
* Cost values being recalculated during read aggregation

## 5. Workflow Requirements

Use Ultracode dynamic workflows with parallel agents, isolated worktrees where useful, independent verification, adversarial review, and parent session integration.

The parent session owns:

* Architecture decisions
* Shared security contracts
* Identity semantics
* Risk semantics
* Audit durability decisions
* x402 governance boundaries
* FinOps accounting rules
* Final integration
* Final verification
* Completion judgment

Write capable agents must receive:

```text
You are not alone in the repository. Other agents may edit other modules. Do not revert unrelated changes. Adapt to nearby changes. Edit only your assigned files unless blocked. Do not commit, push, publish, release, or deploy.
```

## 6. Phase 1: Baseline, Architecture Map, and Threat Model

Before modifying code:

1. Record the current branch, commit, version, and working tree state.
2. Identify modified and untracked files from other sessions.
3. Do not stage or overwrite unrelated work.
4. Run the current verification baseline.
5. Record preexisting failures separately.
6. Map the full request lifecycle.

Map:

```text
Agent proposal
→ identity resolution
→ organization resolution
→ input validation
→ guard evaluation
→ authoritative risk calculation
→ decision persistence
→ action creation
→ approval
→ execution by the agent
→ outcome reporting
→ artifact recording
→ alerts and notifications
→ analytics and FinOps
→ dashboard presentation
```

For each boundary identify:

* Trust source
* Tenant source
* Identity source
* Validation owner
* Persistence guarantee
* Retry behavior
* Failure behavior
* Audit evidence
* Sensitive data
* Duplicate representations
* Current tests

Produce a prioritized findings report containing:

* Severity
* File paths
* Direct evidence
* Exploit or failure scenario
* Affected users or tenants
* Proposed fix
* Verification method
* Compatibility implications

Reject speculative findings that cannot be verified.

## 7. Phase 2: Parallel Audits

Run independent read only audits for:

### Audit A: Identity and tenancy

Review authentication, authorization, identity resolution, role checks, API keys, JWT validation, replay protection, action binding, signatures, and `org_id` scoping.

### Audit B: Guard and risk

Review policy evaluation, risk calculation, client supplied values, decision precedence, failure modes, policy ordering, and action record consistency.

### Audit C: Persistence and concurrency

Review database consistency, idempotency, compare and set behavior, retries, partial writes, transaction limitations, audit durability, and lost confirmation handling.

### Audit D: API validation

Review request bodies, queries, headers, path parameters, error behavior, rate limiting, insecure defaults, and information leakage.

### Audit E: Approvals and outcomes

Review approval state transitions, execution outcomes, retries, terminal state conflicts, cancellation, partial completion, and duplicate reports.

### Audit F: Secrets and integrations

Review secret scanning, redaction, prompt injection handling, webhook authentication, webhook retries, Stripe, Discord, Telegram, email, MCP, OpenClaw, Hermes, and external provider failures.

### Audit G: x402

Review provider and endpoint integrity, purchase creation, spend validation, policy enforcement, approval thresholds, payment references, partial writes, idempotency, outcomes, tenant isolation, and the govern rather than execute boundary.

### Audit H: FinOps and pricing

Review Agent LLM Spend, x402 spend, Claude Code spend, period handling, lens handling, pricing parity, custom pricing, double counting, aggregation accuracy, and dashboard compatibility.

### Audit I: Tests

Review coverage, weak assertions, brittle mocks, missing failure cases, skipped tests, concurrency tests, and false positive tests.

### Audit J: Architecture and maintainability

Review duplicated helpers, dead code, experimental routes, inconsistent contracts, overly broad modules, and unnecessary complexity.

### Audit K: Documentation and deployment

Review versions, migrations, environment variables, SDK documentation, OpenAPI, API inventory, release metadata, self hosting instructions, and deployment expectations.

## 8. Phase 3: Remediation Plan

Create an ordered plan separating:

1. Critical security and tenant isolation fixes
2. Data integrity and audit durability fixes
3. x402 payment governance fixes
4. FinOps and pricing correctness fixes
5. Reliability and consistency fixes
6. Architectural cleanup
7. Test improvements
8. Documentation and release consistency

For each implementation packet specify:

* Owner
* Files
* Read only or write capable
* Dependencies
* Risk
* Expected behavior
* Verification command
* Approval requirement
* Rollback approach

Assign nonoverlapping files to write capable agents.

Before implementation, show:

* Architecture findings
* Prioritized remediation plan
* Expected file ownership
* Approval gates
* Baseline verification results

Then proceed automatically with safe local implementation.

## 9. Phase 4: Required Implementation Outcomes

Implement the highest impact confirmed fixes.

At minimum complete the following.

### 9.1 Shared identity resolution

Create or strengthen a shared identity helper used by:

* Guard routes
* Action creation routes
* x402 purchase routes
* Integration routes that create actions
* Hooks that submit governed actions

Preserve backward compatibility where reasonable.

When compatibility requires accepting self asserted identity, represent it explicitly and prevent it from receiving verified privileges.

### 9.2 Durable guard evidence

Guarantee that required guard decisions are durably recorded before success is returned.

Do not use fire and forget persistence for required audit evidence.

Add explicit behavior for persistence failure.

### 9.3 Authoritative risk propagation

Use one authoritative risk result throughout governance and persistence.

Replace body supplied or default zero values where they can conflict with the guard calculation.

### 9.4 Tenant isolation

Verify `org_id` scope on all modified data paths.

Add regression tests for cross tenant attempts.

### 9.5 x402 hardening

Validate and enforce:

* Amount
* Currency
* Provider
* Endpoint
* Provider status
* Policy result
* Approval state
* Action linkage
* Purchase idempotency
* Outcome consistency
* Reference redaction

Investigate partial failure between action creation and purchase creation.

If transactions are unavailable on the Neon HTTP path, implement and test an idempotent or compensating recovery strategy.

Do not introduce wallet custody or payment execution.

### 9.6 FinOps correctness

Preserve and test:

```text
Fleet Spend = Agent LLM Spend + x402 Purchase Spend
```

Preserve the exclusion of `x402_purchase` from Agent LLM Spend.

Preserve the advisory Claude Code lens.

Preserve read only aggregation.

Do not reprice stored records.

### 9.7 Shared validation and errors

Prefer shared runtime schemas and error helpers over duplicated manual checks.

Do not weaken validation to preserve invalid callers silently.

When a security change is incompatible, create an explicit compatibility mode, migration guidance, and tests.

## 10. Phase 5: Verification

Run all relevant checks, including:

```bash
npm run lint
npx vitest run
npm run test:api
npm run build
npm run docs:check
npm run contracts:check
npm run openapi:check
npm run api:inventory:check
npm run route-sql:check
npm run version:sync:check
npm run sdk:integration
npm run sdk:integration:python
npm run scripts:check-syntax
npm run startup:smoke
```

Run TypeScript checks only if the repository already has an active TypeScript configuration. Do not begin the full TypeScript migration during this hardening goal.

Run Playwright smoke tests when the environment supports them.

Read and report command output, not only exit codes.

## 11. Required Regression Tests

Add focused tests for confirmed critical and high severity issues.

At minimum cover:

### Identity and tenancy

* Forged agent identity
* Verified JWT overriding body identity
* Missing token
* Invalid token
* Expired token
* Replayed token
* Action binding mismatch
* Cross tenant action access
* Cross tenant x402 access
* Missing organization context

### Guard and risk

* Authoritative risk overrides lower client risk
* Guard and action risk consistency
* Guard decision persistence failure
* Blocked decision persistence
* Policy evaluation failure behavior

### Actions, approvals, and outcomes

* Duplicate action creation
* Concurrent outcome reporting
* Approval transition conflict
* Lost confirmation handling
* Database failure behavior
* External dependency failure behavior

### Secrets and integrations

* Secret redaction without raw leakage
* Prompt injection detection
* Webhook authentication
* Webhook timeout
* Retry behavior
* Sensitive reference redaction

### x402

* Negative spend rejection
* `NaN` and Infinity rejection
* Invalid currency
* Blocked provider
* Provider allow list
* Maximum spend block
* Approval threshold
* Invalid endpoint
* Provider and endpoint mismatch
* Duplicate purchase
* Partial action and purchase failure
* Outcome state consistency
* Agent executes payment boundary

### FinOps and pricing

* Agent LLM Spend excludes `x402_purchase`
* Fleet Spend equation
* Claude Code spend remains separate
* Period allow list
* Lens allow list
* Cross tenant aggregation
* No repricing during aggregation
* Rate card parity
* Custom organization pricing

## 12. Adversarial Review

After implementation, run independent reviewers for:

1. Identity and authorization bypasses
2. Tenant isolation
3. Guard and risk correctness
4. Audit durability
5. Database consistency and retries
6. x402 governance and payment boundaries
7. FinOps accounting and pricing
8. Secret leakage
9. API compatibility
10. Test quality
11. Build and deployment compatibility
12. Documentation accuracy

Reviewers must attempt to disprove that the fixes work.

Every finding must include direct evidence and a reproducible scenario.

Fix all confirmed critical and high severity findings.

## 13. Constraints

Do not:

* Commit
* Push
* Publish
* Release
* Deploy
* Delete major functionality
* Modify production infrastructure
* Perform irreversible repository operations
* Add wallet custody
* Execute payments
* Change money representation or precision
* Reprice historical records
* Start the full TypeScript migration
* Add broad new product features
* Run broad cosmetic refactors
* Silence failed tests or workflow agents
* Weaken security to make tests pass

Ask for approval before:

* Incompatible public API changes
* Database schema semantic changes
* Currency behavior changes
* Payment architecture changes
* Broad codemods
* Major route removal
* Framework replacement
* Production changes
* An unusually expensive workflow swarm

## 14. Completion Criteria

The goal is complete only when:

1. Every confirmed critical and high severity issue is fixed or documented with a precise blocker.
2. Guard and action identity semantics are consistent and tested.
3. Verified identity overrides self asserted identity.
4. Tenant isolation is verified on modified paths.
5. Guard decisions are durably persisted before success is reported.
6. Authoritative risk is stored and presented consistently.
7. x402 purchase creation uses the same identity and risk semantics as other governed actions.
8. x402 remains governance only.
9. x402 amounts, currencies, providers, endpoints, approvals, and outcomes are validated.
10. Agent LLM Spend excludes `x402_purchase`.
11. Fleet Spend equals Agent LLM Spend plus x402 Purchase Spend.
12. Claude Code spend remains advisory and separate.
13. FinOps does not reprice stored rows.
14. Secret and payment references are not leaked.
15. All new tests pass.
16. Existing tests pass except failures proven to be unrelated and documented.
17. Lint passes.
18. The production build passes.
19. API, contract, OpenAPI, inventory, route SQL, version, SDK, script, and startup checks pass.
20. Documentation and environment examples match the implementation.
21. An independent adversarial review is complete.
22. The final report contains findings, changes, files modified, tests run, command output, remaining risks, compatibility implications, and recommended TypeScript migration follow up work.

## 15. Blocker Protocol

Continue until the completion criteria are satisfied or a genuine technical blocker prevents further progress.

When blocked, report:

1. The exact blocker
2. Direct evidence
3. Attempts made
4. Affected files
5. Security and compatibility implications
6. The smallest decision required from the operator

Do not stop merely because the work is large.

## 16. Final Report

The final report must include:

* Baseline branch, commit, and version
* Architecture and threat model
* Prioritized findings
* Confirmed and rejected findings
* Changes implemented
* Files modified
* Identity and tenant changes
* Risk and audit changes
* x402 changes
* FinOps and pricing changes
* Tests added
* Every verification command
* Command results
* Preexisting failures
* Compatibility implications
* Remaining risks
* Deferred work
* Recommended TypeScript migration sequence
