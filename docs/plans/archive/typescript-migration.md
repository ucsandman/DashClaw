# DashClaw TypeScript Migration Plan

> **Repository:** `ucsandman/DashClaw`  
> **Verified baseline:** `main` at `e8709bbc` on June 5, 2026 (the originally-cited `2bd56f2a` is an ancestor of HEAD; the FinOps Phase B and x402 foundation it references are present, plus the 4.2.0 `recordX402Purchase` self-report)  
> **Application version:** `4.2.0`  
> **Migration style:** Incremental, strict, behavior preserving, test gated  
> **Execution model:** Claude Code Goal plus Ultracode dynamic workflows

## 1. Objective

Convert the DashClaw production application from JavaScript and JSX to strict TypeScript and TSX while preserving public behavior, strengthening domain contracts, improving maintainability, and exposing correctness problems currently hidden by implicit object shapes.

This migration is not a mechanical extension rename. It must establish explicit contracts across identity, governance, actions, approvals, execution outcomes, FinOps, pricing, x402 spend governance, database repositories, API routes, integrations, and the dashboard.

The migration is complete only when the repository typechecks, tests, lints, builds, passes contract checks, and retains its security, tenancy, payment, and cost accounting invariants.

## 2. Current Repository State That Must Be Preserved

### 2.1 Core platform

DashClaw is currently a Next.js and React application running on Node.js with PostgreSQL support through Neon or a direct Postgres driver.

The repository uses:

* Next.js
* React
* PostgreSQL
* Neon serverless
* Zod
* Drizzle tooling
* Vitest
* Playwright
* ESLint
* Node and Python SDKs
* MCP and agent integrations
* Webhooks, Discord, Telegram, Stripe, and email integrations

### 2.2 x402 spend governance

The current x402 implementation is a governance and recording system, not a wallet or payment executor.

The current domain includes:

* `x402_providers`
* `x402_endpoints`
* `x402_purchases`
* `x402_spend_limit` guard policies
* Provider allow and block lists
* Maximum spend limits
* Approval thresholds
* Purchase records linked one to one with action records
* Purchase outcomes and operator feedback
* Fleet spend aggregation
* The `/spend/x402` operator surface

The agent executes the actual x402 provider call. DashClaw evaluates, approves, blocks, records, scores, and aggregates the purchase.

### 2.3 Unified FinOps

The current FinOps subsystem is an aggregation and presentation layer. It owns no tables.

It currently exposes:

* A governed Fleet lens
* Agent LLM spend
* x402 purchase spend
* A separate advisory Claude Code lens
* Spend aggregation by period
* Spend aggregation by day
* x402 aggregation by provider
* Claude Code aggregation by project
* `/api/finops/spend`
* `/api/finops/spend?lens=claude-code`
* `/spend`
* `/spend/x402`
* `/spend/code`

The migration must preserve the distinction between governed fleet spend and advisory personal Claude Code spend.

### 2.4 Pricing architecture

`app/lib/billing.js` is authoritative for stored cost values.

Stored values including `action_records.cost_estimate` and `code_sessions.cost_usd` are calculated through `estimateCost`.

`app/lib/claude-code/pricing.js` is currently analytics focused. It supports cache analysis and per message calculations.

The two modules currently share matching Claude model prices. The parity invariant is protected by `__tests__/unit/rate-card-parity.test.js`.

The migration is the intended time to create a true shared pricing source, but it must preserve these intentional differences:

* Unknown models return zero in the stored cost path rather than being guessed.
* Claude Code analytics currently has a Sonnet style fallback.
* Cache creation and cache read rates must remain distinct.
* Existing custom organization pricing must continue to work.
* Existing historical stored cost must not be silently repriced.
* x402 purchase spend must not be mixed into token pricing.
* `x402_purchase` actions must remain excluded from Agent LLM Spend to prevent double counting.

## 3. Non Goals

This migration must not:

1. Rewrite DashClaw in Go, Rust, Python, or another framework.
2. Replace Next.js, React, PostgreSQL, Zod, Vitest, or Playwright.
3. Turn DashClaw into a payment processor, wallet, or x402 execution engine.
4. Merge FinOps, x402, Code Sessions, CostClaw, and action records into one storage domain.
5. Reprice historical cost records.
6. Add CostClaw paid unlock behavior without a separate approved billing and entitlement decision.
7. Convert Python SDK code to TypeScript.
8. Convert shell scripts to TypeScript.
9. Delete historical migrations.
10. Introduce broad product features merely because the migration touches related files.
11. Commit, push, publish, release, deploy, or modify production infrastructure without explicit approval.
12. Convert, refactor, or extend `app/api/_archive/**` (legacy archived routes, ~48 files) — explicitly out of scope and retained as a documented JavaScript exception.

## 4. Hard Architectural Invariants

### 4.1 Governance boundary

DashClaw governs, records, approves, blocks, scores, and aggregates agent activity.

DashClaw must not execute x402 payments or hold wallet credentials.

### 4.2 Aggregation, not fusion

FinOps may compose data from sovereign domains, but it must not become the owner of those domains.

`finops.repository` must remain a read only composition layer unless a separately approved architecture change proves otherwise.

### 4.3 Tenant isolation

Every tenant owned query must remain scoped by `org_id`.

Organization context must never become optional inside security critical services or repositories.

### 4.4 Authoritative identity

Verified identity must override self asserted identity.

All routes that create or govern actions, including x402 purchase routes, must converge on one typed identity resolution contract.

### 4.5 Authoritative risk

Server calculated risk must remain authoritative.

Client supplied risk may increase risk but must never reduce the server calculation.

The risk value stored on action records, guard decisions, alerts, analytics, and responses must be consistent.

### 4.6 Durable audit evidence

A successful governance response must not be returned before required audit evidence is durably persisted, unless an equally strong durable mechanism is proven and tested.

### 4.7 Money safety

All monetary values must be validated as finite and nonnegative where appropriate.

Currency must be explicit.

The migration must not silently change database precision, API representation, rounding, or units.

Because USDC and micropayments may require fractional precision, do not convert values to integer cents without an approved compatibility design.

If JavaScript numbers remain at an external boundary, introduce explicit validated amount types and document precision limitations.

A switch to decimal strings, database numeric wrappers, or minor units requires explicit approval and migration guidance.

> **Migration-team note (2026-06-05):** In the live schema, `action_records.cost_estimate` is `real` (float4) and `code_sessions.cost_usd` / `cache_savings_usd` / `naive_cost_usd` are `numeric` (returned as strings by the Neon HTTP driver). Neither database type changes in this migration. Typed row mappers must model `real`→`number` and `numeric`→`Number()`-coerced-`number` without altering stored precision, rounding, or units.

### 4.8 Cost accounting

Preserve all current cost accounting behavior:

* Stored model cost is calculated through the canonical billing path.
* Claude Code spend aggregates stored `code_sessions.cost_usd`.
* FinOps does not reprice stored rows.
* Agent LLM Spend excludes `x402_purchase`.
* Fleet spend equals Agent LLM Spend plus x402 spend.
* Claude Code spend remains advisory and separate.
* The rate card parity test remains green until the shared pricing source replaces the duplicate tables.

## 5. Migration Principles

1. Use one Goal run with multiple controlled workflow phases.
2. Keep the repository runnable after each major phase.
3. Introduce TypeScript gradually with JavaScript coexistence.
4. Convert by dependency order and domain boundary.
5. Keep shared architecture decisions in the parent session.
6. Assign write agents explicit, nonoverlapping ownership.
7. Prefer schema inferred types at external boundaries.
8. Treat database rows as untrusted until mapped and validated.
9. Preserve public status codes and response shapes unless a confirmed bug requires change.
10. Avoid broad formatting and unrelated cleanup.
11. Do not hide errors with broad suppressions.
12. Verify every converted module before deleting its JavaScript predecessor.
13. Do not let the plan replace execution.

## 6. Phase 0: Safe Workspace Preparation

Before changing code:

1. Confirm the current branch and commit.
2. Confirm the working tree state.
3. Record all modified and untracked files.
4. Do not overwrite or stage unrelated work from other sessions.
5. Use explicit pathspecs for any future staging.
6. Create or confirm an isolated migration branch.
7. Record the current Node and package manager versions.
8. Record the current application version.
9. Confirm that the repository is on or contains commit `2bd56f2a`.
10. Confirm that the FinOps Phase B commits and x402 foundation are present.

Recommended branch:

```text
refactor/typescript-migration
```

Do not use `git add -A`.

## 7. Phase 1: Baseline and Architecture Inventory

### 7.1 Inventory

Inventory all:

* `.js`
* `.jsx`
* `.mjs`
* `.cjs`
* `.ts`
* `.tsx`
* Python files
* Shell scripts
* SQL migrations
* Test files
* Generated files
* Configuration files
* SDK packages

Classify each file as:

* Production application
* API route
* Domain logic
* Repository
* UI
* Integration
* Operational script
* Migration
* Test
* Generated artifact
* Documentation
* Intentionally retained JavaScript or MJS

### 7.2 Architecture map

Map these boundaries:

* UI
* API routes
* Runtime validation
* Authentication
* Authorization
* Agent identity
* Organization context
* Guard evaluation
* Policy evaluation
* Actions
* Approvals
* Execution outcomes
* Audit evidence
* Database repositories
* Code Sessions
* Pricing
* FinOps
* x402 providers
* x402 endpoints
* x402 purchases
* Notifications
* External integrations
* SDKs
* Migrations
* Build and release tooling

### 7.3 Baseline verification

Run and record:

```bash
npm install
npm run lint
npx vitest run
npm run build
npm run docs:check
npm run contracts:check
npm run openapi:check
npm run api:inventory:check
npm run route-sql:check
npm run version:sync:check
npm run scripts:check-syntax
npm run startup:smoke
```

Run other documented checks when relevant.

Record preexisting failures separately. Do not attribute them to the migration.

### 7.4 Deliverables

Create:

* A baseline report
* A file inventory
* A dependency graph
* A migration order
* An agent ownership plan
* A verification matrix
* A list of approval gates
* A list of intentional JavaScript exceptions

Proceed automatically after these artifacts exist.

## 8. Phase 2: TypeScript Foundation

Introduce TypeScript without forcing an immediate repository wide conversion.

### 8.1 Required configuration

Add a strict `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Adjust framework required options using the configuration generated or recommended by the installed Next.js version.

### 8.2 Required scripts and dependencies

1. Add TypeScript and required React and Node type packages.
2. Add:

```json
"typecheck": "tsc --noEmit"
```

3. Keep Next.js build type checking enabled.
4. Keep JavaScript coexistence enabled until the migration is complete.
5. Configure test, browser, Node, JSX, path alias, and generated type behavior correctly.
6. Do not introduce path alias churn unless it materially improves consistency.

### 8.3 Suppression policy

Do not use broad:

* `@ts-ignore`
* `@ts-nocheck`
* `eslint-disable`
* `any`
* Unsafe nonnull assertions
* Double assertions
* Unvalidated `JSON.parse`
* Unvalidated `process.env`

A narrow suppression is allowed only when:

1. It is required by a third party definition or framework limitation.
2. The reason is documented beside it.
3. A tracking note identifies how it can be removed.
4. It does not cross a security, tenancy, pricing, or payment boundary.

The repository must still build after the TypeScript foundation is introduced.

> **Migration-team note (2026-06-05) — route-discovery generators (CRITICAL):** `scripts/generate-openapi.mjs`, `scripts/generate-api-inventory.mjs`, and the route-sql baseline discover API routes by the literal `route.js` filename (`generated_from: 'app/api/**/route.js'`). They MUST be taught to match `route.{js,ts,tsx}` and be re-baselined as part of this foundation phase, BEFORE any route file is converted (§15). Otherwise `openapi:check`, `api:inventory:check`, and `route-sql:check` will silently skip TypeScript routes, under-reporting coverage and breaking the contract gates.

## 9. Phase 3: Domain Type Architecture

Do not create one enormous global type file.

Organize types by domain.

### 9.1 Identity and tenancy

Define:

* `OrganizationId`
* `OrganizationRole`
* `AgentId`
* `AgentName`
* `AgentIdentity`
* `AuthenticatedAgentContext`
* `OrganizationContext`
* `VerificationStatus`
* `ReplayStatus`
* `ActionBindingStatus`
* `JwtClaims`
* `ApiKeyContext`

### 9.2 Governance

Define:

* `GuardInput`
* `GuardContext`
* `GuardDecision`
* `GuardDecisionType`
* `GuardPolicy`
* `GuardPolicyType`
* Policy specific rule types
* `RiskScore`
* `SecurityFinding`
* `PromptInjectionFinding`
* `SensitiveDataFinding`
* `AuditReceipt`

Use discriminated unions for decisions and policy rules.

### 9.3 Actions and outcomes

Define:

* `ActionId`
* `ActionType`
* `ActionStatus`
* `ActionRecord`
* `ApprovalDecision`
* `ApprovalStatus`
* `ExecutionOutcome`
* `OutcomeStatus`
* `IdempotencyKey`
* `ActionCreateInput`
* `ActionCreateResult`

### 9.4 Pricing and FinOps

Define:

* `ModelId`
* `TokenCount`
* `PricingRate`
* `ModelPricingEntry`
* `ModelPricingTable`
* `UsageTotals`
* `CacheUsage`
* `CostEstimate`
* `SpendPeriod`
* `FinOpsLens`
* `FleetSpend`
* `ClaudeCodeSpend`
* `AgentSpendAggregation`
* `CodeSessionSpendAggregation`
* `X402SpendAggregation`
* `ProjectSpend`
* `ProviderSpend`

Use explicit types for the current period allow list:

```ts
type SpendPeriod = "7d" | "30d" | "90d";
type FinOpsLens = "fleet" | "claude-code";
```

Do not conflate the route lens value `claude-code` with the current response label `claude_code` without an explicit mapping.

### 9.5 x402 domain

Define:

* `X402ProviderId`
* `X402EndpointId`
* `X402Provider`
* `X402Endpoint`
* `X402Purchase`
* `X402PurchaseInput`
* `X402PurchaseOutcome`
* `X402ProviderStatus`
* `X402ExecutionStatus`
* `X402PolicyRules`
* `PaymentMethod`
* `WalletReference`
* `PaymentReference`
* `CurrencyCode`
* `SpendAmount`

Model provider allow lists, provider block lists, maximum spend, and approval thresholds explicitly.

Do not treat `provider`, `provider_id`, and `endpoint_id` as interchangeable.

### 9.6 Database contracts

For each repository define:

* Database row types
* Insert input types
* Update patch types
* Domain output types
* JSON column schemas
* Mapping functions

Database row types must reflect nullable columns accurately.

## 10. Phase 4: Runtime Validation Alignment

TypeScript types do not validate runtime input.

Review every external boundary:

* HTTP request bodies
* Query parameters
* Headers
* API keys
* JWT claims
* Webhook payloads
* Discord and Telegram payloads
* Stripe payloads
* x402 provider data
* x402 purchase requests
* Environment variables
* Database JSON columns
* SDK inputs
* Workflow inputs
* MCP inputs
* Code Session ingest payloads

Use Zod or an existing authoritative schema layer.

Infer TypeScript types from schemas where practical.

Remove duplicate handwritten interfaces that can drift from runtime schemas.

### 10.1 x402 validation requirements

Replace manual required field checks with explicit schemas.

Validate:

* Agent identity
* Provider identity
* Provider status
* Endpoint identity
* Spend amount
* Currency
* Payment method
* Purchase reason
* Context gap
* Expected value
* Confidence score
* Execution status
* Wallet and payment references
* Alternatives considered

Reject:

* Negative amounts
* `NaN`
* Infinity
* Unsupported currencies where an allow list exists
* Invalid provider and endpoint combinations
* Invalid approval or execution states
* Oversized text fields
* Untrusted client verification state
* Client attempts to reduce server risk

### 10.2 FinOps validation requirements

Validate:

* Period
* Lens
* Numeric database aggregates
* Nullable provider and project groupings
* Response shapes used by React pages

Do not silently convert an invalid lens to another lens unless existing compatibility behavior is intentionally preserved and tested.

## 11. Phase 5: Pricing and FinOps Foundation

This phase should occur early because pricing modules are pure, highly testable, and now central to multiple cost surfaces.

### 11.1 Convert current modules

Convert:

* `app/lib/billing.js`
* `app/lib/claude-code/pricing.js`
* `app/lib/repositories/finops.repository.js`
* Relevant pricing refresh and parity tests
* Closely related pure pricing helpers

### 11.2 Shared pricing source

Create one typed source of model pricing truth.

The shared source must support:

* Input rates
* Output rates
* Cache creation rates
* Cache read rates
* Model aliases
* Versioned models
* Family defaults
* Organization custom pricing
* Unknown model behavior
* Analytics fallback behavior
* Generated pricing refresh markers or an equivalent generation contract

Do not simply merge the two current modules and erase their different fallback semantics.

Prefer:

1. One shared typed rate card.
2. A stored cost adapter with unknown model behavior that returns zero and warns once.
3. An analytics adapter with its documented fallback.
4. Shared cache aware calculation primitives.
5. Explicit tests for every intentional difference.

### 11.3 Preserve parity and history

The migration must:

* Keep `rate-card-parity.test` green until the duplicate cards are removed.
* Replace the parity test with equivalent shared source coverage after unification.
* Preserve custom organization pricing.
* Preserve stored cost behavior.
* Avoid historical repricing.
* Preserve cache savings calculations.
* Preserve unknown model behavior.
* Preserve generated rate refresh behavior.
* Document the new source of truth.

> **Migration-team note (2026-06-05) — pricing refresh coupling (CRITICAL):** `scripts/refresh-model-pricing.mjs` rewrites the `MODEL_PRICING_GENERATED:BILLING:START/END` and `:PRICING:START/END` marker blocks via hardcoded paths `path.join(REPO_ROOT,'app','lib','billing.js')` and `…'claude-code','pricing.js'` (string `indexOf` on the markers, `fs.writeFileSync`). Converting those modules to `.ts` MUST update the script's target paths in lockstep and preserve the exact marker comment strings; verify with a `node scripts/refresh-model-pricing.mjs` dry-run (no `--apply`) reporting markers found in both `.ts` files before deleting the `.js` predecessors.

### 11.4 FinOps contracts

Type these response paths:

* Fleet lens
* Agent spend
* x402 spend
* Claude Code lens
* Daily series
* Provider series
* Project series
* Total cost
* Cache savings
* Session counts
* Purchase counts

Preserve the rule:

```text
Fleet Spend = Agent LLM Spend + x402 Purchase Spend
```

Preserve the exclusion of `x402_purchase` from Agent LLM Spend.

## 12. Phase 6: Security Critical Conversion

Convert and strengthen these modules before broad UI work:

1. Organization resolution
2. API key authentication
3. Agent identity resolution
4. JWT and JWKS verification
5. Replay protection
6. Action binding
7. Guard input validation
8. Guard policy evaluation
9. Risk scoring
10. Action creation
11. Approval transitions
12. Outcome reporting
13. Secret scanning
14. Prompt injection handling
15. Webhook delivery
16. Audit persistence
17. x402 purchase governance

### 12.1 Required identity outcome

All action creating routes must use one typed identity resolver.

This includes:

* `/api/guard`
* `/api/actions`
* `/api/x402/purchases`
* Any integration route that creates actions

Verified JWT identity must override body identity.

Self asserted identity must be marked explicitly and must not be confused with verified identity.

### 12.2 Required risk outcome

Create one typed risk calculation result and flow it through:

* Guard evaluation
* Guard decision records
* Action records
* x402 purchase actions
* Alerts
* Analytics
* API responses
* Dashboard display

Do not store the client supplied risk value when a higher authoritative risk was calculated.

### 12.3 Required audit outcome

Make guard decision persistence durable.

Test database failure, partial failure, serverless response timing, and retry behavior.

## 13. Phase 7: x402 Repository and API Conversion

Convert:

* `app/lib/repositories/x402.repository.js`
* `app/api/x402/providers`
* `app/api/x402/providers/[id]`
* Endpoint routes
* `app/api/x402/purchases/route.js`
* Related SDK methods
* x402 tests
* `drizzle/0021_x402_spend_governance.sql` consumers

### 13.1 Preserve purchase lifecycle

The typed lifecycle must distinguish:

* Proposed
* Blocked
* Pending approval
* Approved
* Running
* Succeeded
* Failed
* Partial
* Lost confirmation where applicable

Do not allow action status and x402 execution status to drift without an explicit mapping.

### 13.2 Preserve governance order

The purchase path must remain:

1. Resolve organization and identity.
2. Validate input.
3. Resolve provider and endpoint.
4. Build authoritative guard context.
5. Evaluate policies.
6. Persist the decision.
7. Block, require approval, or create the action.
8. Create the purchase detail.
9. Let the agent execute the provider call.
10. Record the outcome and artifacts.

### 13.3 Data consistency

Investigate whether action record creation and purchase creation can become partially inconsistent.

Preserve current compatibility, but introduce a typed consistency strategy.

If a transaction cannot be used on the Neon HTTP path, document and test the compensating or idempotent recovery path.

Do not introduce cross table foreign keys or change house migration conventions without approval.

### 13.4 Payment security

Never log or return raw wallet secrets.

Treat wallet and payment references as potentially sensitive identifiers.

Redact values where appropriate while retaining enough information for reconciliation.

Do not add wallet custody.

## 14. Phase 8: Database Repository Conversion

Convert repositories in dependency order.

For every repository:

1. Type inputs and outputs.
2. Define row types.
3. Define mapping functions.
4. Parse JSON columns safely.
5. Preserve `org_id` filters.
6. Preserve parameterized SQL.
7. Preserve idempotency.
8. Preserve concurrency controls.
9. Preserve nullable values.
10. Avoid unsafe assertions.
11. Preserve current Neon and direct Postgres compatibility.
12. Preserve route SQL guard behavior.

Priority repositories:

* Settings
* Guard
* Actions
* Approvals
* Outcomes
* x402
* Code Sessions
* FinOps
* Agents
* Webhooks
* Notifications

## 15. Phase 9: API Route Conversion

Convert routes by domain group rather than randomly.

For every route:

1. Type request parsing.
2. Validate body, query, headers, and path parameters.
3. Resolve organization and role through shared helpers.
4. Resolve agent identity through shared helpers where relevant.
5. Type response payloads.
6. Use shared API error contracts.
7. Preserve status codes.
8. Preserve middleware expectations.
9. Reject invalid state before persistence.
10. Add regression coverage.

Priority route groups:

1. Guard
2. Actions
3. Approvals
4. Outcomes
5. x402
6. FinOps
7. Code Sessions
8. Integrations
9. Administrative APIs
10. Remaining experimental routes

## 16. Phase 10: UI and TSX Conversion

Convert React pages and components to TSX.

Priority surfaces:

* Decisions
* Actions
* Approvals
* Agents
* Spend overview
* x402 purchases
* Your Claude Code spend
* Code Sessions
* Settings
* Security and policy management

Requirements:

1. Type props.
2. Type API responses.
3. Type loading and error states.
4. Type event handlers.
5. Type chart data.
6. Type nullable and partial records.
7. Render decision and status unions exhaustively.
8. Preserve the current design.
9. Preserve the `/spend` active state fix.
10. Preserve token resolved Recharts colors on `/spend/code`.
11. Add a focused visual or browser check for the brand orange chart rendering.
12. Avoid unnecessary component abstractions.

## 17. Phase 11: Integrations, SDKs, and Scripts

### 17.1 Integrations

Convert actively maintained JavaScript integrations:

* Discord
* Telegram
* Webhooks
* Stripe
* Email
* MCP
* Claude Code hooks
* OpenClaw
* Hermes
* Notification adapters

### 17.2 SDKs

Preserve:

* Node SDK public API
* Python SDK public API
* Current method counts unless a separately approved contract change occurs
* Existing response compatibility

Do not convert Python to TypeScript.

> **Migration-team note (2026-06-05) — Node SDK CJS bridge:** `sdk/index.cjs` provides a lazy `Symbol.hasInstance` error-class bridge and a deferred proxy for nested namespace access (e.g. `client.execution.capabilities.list()`). Converting the SDK internals to TypeScript can break `instanceof` checks and nested access. Convert SDK internals ONLY behind a passing `instanceof` + nested-namespace contract test; otherwise keep `sdk/dashclaw.js` as a documented JavaScript exception. Public method counts and response shapes must stay stable (`version:sync:check`, `sdk:integration`).

### 17.3 Scripts

Convert actively maintained Node scripts when TypeScript provides clear value.

Stable `.mjs` operational scripts may remain JavaScript when:

1. They are isolated.
2. They are already well tested.
3. Conversion adds little safety.
4. They are listed in the final exceptions report.

Do not convert generated files merely to increase migration percentage.

## 18. Phase 12: Test Migration and Expansion

Convert tests to TypeScript where practical.

Add or preserve regression coverage for:

### 18.1 Identity and security

* Forged agent identity
* JWT identity overriding request identity
* Missing tokens
* Invalid tokens
* Expired tokens
* Replayed tokens
* Action binding mismatch
* Cross tenant access
* Missing organization context
* Invalid roles
* Secret redaction
* Prompt injection detection

### 18.2 Actions and governance

* Authoritative risk persistence
* Guard decision persistence failure
* Blocked action recording
* Approval transition conflicts
* Concurrent outcome reporting
* Idempotent action creation
* Lost confirmation
* Webhook timeout behavior
* External dependency failure

### 18.3 Pricing and FinOps

* Every supported model rate
* Cache creation and cache read rates
* Unknown model stored cost behavior
* Analytics fallback behavior
* Custom organization pricing
* Rate refresh behavior
* Agent spend exclusion of `x402_purchase`
* Fleet spend equation
* Claude Code spend aggregation
* Period allow list
* Lens allow list
* No repricing during aggregation
* No rate card drift

### 18.4 x402

* Negative spend rejection
* Nonfinite spend rejection
* Provider block list
* Provider allow list
* Maximum spend block
* Approval threshold
* Missing provider
* Invalid endpoint
* Provider and endpoint mismatch
* Purchase idempotency
* Action and purchase consistency
* Outcome state mapping
* Currency validation
* Wallet reference redaction
* Cross tenant purchase access
* Agent executes payment boundary

### 18.5 UI and compatibility

* FinOps response typing
* Spend page rendering
* `/spend/code` chart data
* `/spend` navigation active state
* API response compatibility
* Production route presence

Do not weaken assertions merely to make tests pass.

## 19. Phase 13: Unsafe Typing Audit

Search for:

```text
any
unknown
as
!
@ts-ignore
@ts-expect-error
@ts-nocheck
eslint-disable
JSON.parse
process.env
Record<string, unknown>
```

Review every occurrence.

`unknown` is acceptable at an untrusted boundary only when it is narrowed before use.

`any` is acceptable only at a proven external limitation and must include a nearby explanation.

Do not replace `any` with meaningless generic types that provide no actual safety.

Apply extra scrutiny to:

* Identity
* Organization context
* Guard inputs
* Policy rules
* Money
* Currency
* Pricing
* x402 purchase requests
* Database JSON
* Webhook responses
* SDK payloads

## 20. Phase 14: Parallel Adversarial Review

After conversion, run independent review workflows for:

1. Type correctness
2. Runtime validation
3. Identity and authorization
4. Tenant isolation
5. Guard and risk correctness
6. Audit durability
7. Database consistency
8. Pricing correctness
9. FinOps accounting
10. x402 governance and payment boundaries
11. API compatibility
12. React correctness
13. Test quality
14. Build and deployment compatibility
15. Dead code and duplicate implementations

Reviewers must attempt to disprove that the migration is complete.

Every finding must include:

* Severity
* File paths
* Direct evidence
* Failure or exploit scenario
* Recommended fix
* Verification method

Fix every confirmed critical and high severity finding.

## 21. Dynamic Workflow Instructions

Use dynamic workflows for independent discovery, bounded conversion, testing, and adversarial review.

The parent session owns:

* Architecture
* Shared domain types
* Shared schemas
* Pricing source design
* Identity contract
* Integration decisions
* Final conflict resolution
* Final verification
* Completion judgment

### 21.1 Suggested workflow lanes

#### Lane A: Baseline and dependency graph

Read only.

#### Lane B: TypeScript configuration and build tooling

Own configuration and package metadata only.

#### Lane C: Shared identity and governance types

Own shared identity, organization, guard, action, and outcome contracts.

#### Lane D: Pricing and FinOps

Own billing, Claude Code pricing, FinOps repository, spend schemas, and parity tests.

#### Lane E: x402 governance

Own x402 repository, schemas, routes, and tests.

#### Lane F: Security core

Own JWT, JWKS, replay, action binding, redaction, and prompt injection modules.

#### Lane G: Database repositories

Assign repositories in nonoverlapping groups.

#### Lane H: API routes

Assign domain route groups after shared contracts stabilize.

#### Lane I: UI and TSX

Assign isolated page and component groups.

#### Lane J: Integrations and SDK compatibility

Keep Node and Python public contracts stable.

#### Lane K: Test conversion and missing regression coverage

Avoid editing production files unless explicitly reassigned.

#### Lane L: Adversarial verification

Read only until findings are accepted by the parent session.

### 21.2 Required worker instruction

Every write capable worker must receive:

```text
You are not alone in the repository. Other agents may edit other modules. Do not revert unrelated changes. Adapt to nearby changes. Edit only your assigned files unless blocked. Do not commit, push, publish, release, or deploy.
```

### 21.3 Coordination rules

1. Assign explicit file ownership.
2. Do not let multiple agents redefine shared types.
3. Do not delegate the immediate parent critical path.
4. Do not run broad formatting.
5. Continue parent work while nonblocking agents run.
6. Inspect every result before integration.
7. Reject claims without evidence.
8. Recheck reviewer findings against actual repository conventions.
9. Keep workflow artifacts and result notes.
10. Report failed or refuted lanes honestly.

## 22. Approval Gates

Ask for approval before:

1. Deleting major functionality.
2. Changing public API contracts incompatibly.
3. Changing database schema semantics.
4. Changing money representation or precision.
5. Changing currency behavior.
6. Adding wallet custody or payment execution.
7. Adding CostClaw paid unlock or entitlements.
8. Repricing historical data.
9. Replacing the framework or database.
10. Introducing cross table foreign keys that conflict with established migration conventions.
11. Publishing, deploying, releasing, committing, pushing, or opening a pull request.
12. Performing an irreversible repository operation.
13. Running an unusually expensive or broad workflow swarm.

Safe local edits, tests, builds, documentation updates, and incremental conversion do not require additional approval.

## 23. Verification Matrix

Run the narrowest relevant checks after each packet.

Run the full gate after each major phase and before completion.

Required final gate:

```bash
npm run typecheck
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

> **Migration-team note (2026-06-05) — host caveat:** On Windows + Node 24, `npm run startup:smoke` fails with `spawn EINVAL` (it spawns `npm.cmd` without `shell:true`; the CVE-2024-27980 hardening blocks `.cmd` spawns) and `npm run test:api` requires a running dev server at `localhost:3000`. Both are preexisting and environmental — not migration regressions. Run them on Linux/CI or against a started server, and treat them as preexisting in the final audit rather than migration gates.

Run Playwright smoke tests when the environment supports them.

Perform a manual or browser visual check of `/spend/code` to confirm the chart paints with the intended brand color.

Read and report all command output. Do not report only exit codes.

## 24. Completion Criteria

The migration is complete only when:

1. Production application code is TypeScript or TSX except explicitly documented exceptions.
2. `npm run typecheck` passes with zero errors.
3. Lint passes.
4. The full Vitest suite passes.
5. API tests pass.
6. The production build passes.
7. Relevant Playwright tests pass when runnable.
8. Documentation checks pass.
9. Contract checks pass.
10. OpenAPI checks pass.
11. API inventory checks pass.
12. Route SQL checks pass.
13. Version synchronization checks pass.
14. SDK integration checks pass.
15. No duplicate JavaScript and TypeScript implementations remain.
16. No unexplained TypeScript suppressions remain.
17. Security critical external inputs are runtime validated.
18. Identity semantics are consistent across guard, action, x402, and integration routes.
19. Authoritative risk is stored consistently.
20. Tenant isolation is preserved.
21. Guard audit evidence is durable.
22. x402 remains governance only and does not execute payments.
23. x402 amounts, currencies, providers, endpoints, and statuses are explicitly typed and validated.
24. Agent LLM Spend still excludes `x402_purchase`.
25. Fleet Spend still equals Agent LLM Spend plus x402 Spend.
26. Claude Code spend remains advisory and separately modeled.
27. Stored cost remains canonical through the billing path.
28. Shared pricing preserves every intentional fallback and cache behavior.
29. The pricing drift guard is replaced only by equal or stronger shared source tests.
30. Existing public behavior remains compatible unless an approved change was required.
31. Documentation accurately describes the TypeScript architecture.
32. The final report documents every intentional JavaScript exception.

## 25. Final Migration Report

The final report must include:

* Baseline commit and version
* Baseline command results
* Preexisting failures
* Files converted
* Files intentionally retained as JavaScript or MJS
* Shared types created
* Runtime schemas created
* Architecture changes
* Identity and security changes
* Audit durability changes
* Pricing source changes
* FinOps changes
* x402 changes
* Money and currency decisions
* Database mapping decisions
* Tests added
* All commands run
* Final command results
* Public compatibility implications
* Database compatibility implications
* SDK compatibility implications
* Remaining suppressions
* Remaining risks
* Deferred work
* Recommended follow up milestones

## 26. Definition of Done

Do not declare completion because most files were renamed.

Do not declare completion because TypeScript compiles while tests fail.

Do not declare completion while duplicate JavaScript implementations remain.

Do not declare completion while payment, identity, tenancy, risk, pricing, or audit invariants are unverified.

Continue until all completion criteria are satisfied or a genuine technical blocker prevents progress.

When blocked, report:

1. The exact blocker.
2. Direct evidence.
3. Attempts made.
4. Affected files.
5. Security or compatibility implications.
6. The smallest decision required from the operator.

Begin with the baseline report, migration graph, domain type architecture, agent ownership plan, and verification matrix. Then proceed automatically with safe local implementation and verification.
