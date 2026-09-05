# Round 3: dispatch tables and dead code

Branch `simplify/round-3`, base `902d4939` (main, v5.33.3). Numbers from `node scripts/loc-report.mjs`; invariants from `node --import tsx scripts/simplify-invariants.mjs` diffed against a snapshot of main taken in `.worktrees/simplify-main` at `902d4939`.

## Baseline column vs after

| Metric | Baseline (main d6b6b42c) | After round 2 | After round 3 | Round-3 delta |
|---|---:|---:|---:|---:|
| Source files | 820 | 849 | 849 | 0 |
| Source LOC | 163,106 | 163,723 | 162,668 | **-1,055** |
| Source code lines | 134,229 | 134,766 | 133,889 | -877 |
| Functions | 7,940 | 7,995 | 7,949 | -46 |
| app/lib LOC | 48,790 | 49,424 | 48,429 | -995 |
| app/components LOC | 7,338 | 7,338 | 7,303 | -35 |
| cli LOC | 7,154 | 7,154 | 7,129 | -25 |
| Files >= 1,500 LOC | 9 | 5 | 5 | 0 |
| Functions >= 150 LOC | 115 | 115 | 115 | 0 |

`git diff --numstat`: 28 files, 5 insertions, 1,060 deletions (the 5 insertions are import lines rewritten with one name dropped).

## Dispatch tables: no candidates

The scan for `if / else if` chains with >= 6 branches keyed on a constant (`scripts/loc-report.mjs` scope: app, sdk, mcp-server/src, cli, scripts, hooks) found **2** chains in the whole tree:

| Chain | Branches | Why it stays |
|---|---:|---|
| `app/lib/widget/pulse.ts:284` (posture ladder) | 6 | Ordered predicate ladder ("first match owns the posture"): the branches test different expressions (`freshness === 'stale'`, `queriesDegraded.length > 0`, `pendingCount > 0`, …) and the order is the semantics. A lookup table would have to encode the order as an array of predicates, which is the same construct with more indirection. The `switch (posture)` below it is already a keyed dispatch. |
| `scripts/drills/fresh-linux.mjs:27` (`parseArgs`) | 7 | Alternating `--flag value` / `--flag=value` argument parsing in a drill script; not a keyed dispatch. |

Every other keyed dispatch found while reading (CLI command table in `cli/bin/dashclaw.js`, `DEMO_API_ROUTES` in `middleware.demo.js`, `CHECK_RUNNERS` / `FIX_REGISTRY` in the doctor, `API_STYLE_HANDLERS` in providers, `ENTITY_ACTIONS` in the context menu) is already a table. Nothing to convert.

## Dead code: 64 exported symbols, 1,055 lines

Method, in the order the plan requires:

1. `repowise get_dead_code` (min_confidence 0.7; the index is 25 days old at commit 3c6f4706). Its high tier is mostly registry false positives (every doctor `runChecks`, the CLI `cmd*` handlers, provider handlers) and files that no longer exist on main (`app/lib/claude-code/`, `app/components/QuickStart.tsx`, `app/api/_archive/`). A Haiku scout grepped each of its 25 listed findings: 1 dead (`computePosturePayload`), the rest LIVE or NOT FOUND (table in the scout output, summarized in this section).
2. A current-tree scan (TypeScript compiler API over app/lib, app/components, cli/lib, cli/bin, mcp-server/src, sdk, scripts/lib, packages/openclaw-plugin/src) listing every exported declaration with zero word-boundary references in app/, sdk/, sdk-python/, mcp-server/, cli/, plugins/, scripts/, __tests__/, tests/, hooks/, packages/ and the root middleware files, other than its own declaration. 224 exported names had no external reference; 166 of those are used inside their own file (over-exported, not dead, left alone); **58** had no reference at all.
3. For each of the 58, `git grep -nw <name>` across the same trees, plus a second informational grep across docs (transcript: `docs/simplify/round-3-grep-transcript.txt`, 581 lines). Every code hit was the declaration itself; every other hit was prose (`docs/**`, `CHANGELOG.md`, `platform-guide-data.json` description strings, a legacy-SDK knowledge table).
4. Deleted with the private helpers and imports each deletion orphaned; then a cascade re-scan found 8 exports whose only user had just been deleted (`getCapabilityWithHealth` + its `CapabilityWithHealth` interface, `getFeedback`, `PosturePayload`, `RiskBand`, `SecurityFinding`, `ReplayStatus`, `ActionBindingStatus`, `OrganizationContext`); grepped and deleted the same way. `mcp-server/` was excluded on purpose (its compiled `lib/` is a tracked artifact).

| File | Deleted | Lines |
|---|---|---:|
| app/lib/posture/signals.ts | `computePosturePayload`, `redactFindingAttribution`, `PosturePayload` + private `buildReplayMap`, `toDecision`, `DECISION_SEV`, `VALID_DECISIONS`, `PolicyRow`, `PolicyRules` and 12 orphaned imports (the file is now the pure signal math the tests import; the `/posture` routes that consumed it were culled in v5.0.0) | 323 |
| app/lib/feedback.ts | `createFeedback`, `listFeedback`, `resolveFeedback`, `deleteFeedback`, `getFeedbackStats`, `getFeedback` + `CreateFeedbackInput`, `ListFeedbackInput`, `crypto`/`getSql`/`getOrgId` imports (`detectSentiment`, `autoTag` stay; they are test-covered) | 203 |
| app/lib/types/governance.ts | `RiskScore`, `GuardPolicyRow`, `GuardContext`, `GuardDecisionRow`, `PromptInjectionFinding`, `SensitiveDataFinding`, `AuditReceipt`, `SecurityFinding` + 4 orphaned type imports | 90 |
| app/lib/repositories/capability-access.repository.ts | `listAccessRules`, `createAccessRule`, `deleteAccessRule` + `AccessRuleInput`, `VALID_ACCESS_LEVELS`, `crypto` | 71 |
| app/lib/capability-health.ts | `listCapabilityHealthSummaries`, `getCapabilityWithHealth`, `CapabilityWithHealth` + `listCapabilities` import | 52 |
| app/lib/types/identity.ts | `AgentName`, `JwtClaims`, `ApiKeyContext`, `AuthenticatedAgentContext`, `ReplayStatus`, `ActionBindingStatus`, `OrganizationContext` | 46 |
| app/lib/types/actions.ts | `ActionId`, `IdempotencyKey`, `ActionType`, `ActionStatus`, `ActionCreateInput`, `ActionCreateResult`, `ExecutionOutcome`, `ApprovalDecision` + `Brand` import | 41 |
| app/lib/repositories/capabilities.repository.ts | `getCapabilityBySlug`, `deleteCapability` | 27 |
| app/components/ui/Skeleton.tsx | `StatSkeleton`, `CardSkeleton` | 25 |
| cli/lib/render.js | `printApprovalBlock` (the approval box the tests print comes from `sdk/dashclaw.js`, a separate implementation) | 25 |
| app/lib/colors.ts | `actionTypeIcons` | 24 |
| app/lib/validate.js | `validateAssumptionUpdate` + `ASSUMPTION_UPDATE_SCHEMA` | 19 |
| app/lib/repositories/identities.repository.ts | `getIdentity` | 14 |
| app/lib/repositories/guardrails.repository.ts | `listTestRuns` | 13 |
| app/lib/guardrails/import-pack.ts | `importPolicyPack` | 10 |
| app/lib/types/brand.ts | `NumericString`, `IsoTimestamp` | 10 |
| app/lib/riskThresholds.ts | `riskBand`, `RiskBand` | 9 |
| app/lib/repositories/plans.repository.ts | `PLAN_STATUSES`, `STEP_GRANT_STATUSES` | 9 |
| app/lib/providers/providerRegistry.ts | `getProviderRegistry`, `isSupportedProvider` | 8 |
| app/lib/inert-policies.ts | `grantCoversTarget` + `prefixMatches` import | 7 |
| app/components/context-menu/ContextMenuProvider.tsx | `useContextMenu` + `useContext` import | 7 |
| app/lib/validateEnv.ts | `envValidation` | 6 |
| app/lib/types/db.ts | `FromNumeric` + `Nullable` import | 5 |
| app/components/ClaimWorkspaceBanner.tsx | `_resetClaimProbeForTests` | 4 |
| app/lib/guard/protected-path.ts | `DEFAULT_PROTECTED_PATHS` | 3 |
| app/lib/guard/evidence.ts | `ActKind` | 2 |
| app/lib/security-filter.ts | `SignalSeverity` | 2 |
| app/lib/integrity/keys.ts | `SIGNING_CRV` | 1 |

Public surfaces were never candidates: nothing under `sdk/`, `sdk-python/`, `mcp-server/`, `hooks/`, no route file, no CLI command, no MCP tool.

## Invariant diffs (all identical)

`diff -r <main v5.33.3 snapshot> <round-3 snapshot>`: **empty** (8 entries): contracts (92 files), MCP tools (17) + resources (3), Node SDK exports, Python SDK `__all__`, CLI help, guard calibration replay (43 vectors), hook stdout (13 payloads), doc counts. Policy smoke harness against `next start` of main (worktree, port 3001) and the branch (port 3000): `137 checks, 108 passed, 29 failed` on both, normalized diff **0 lines**.

## Gate output

| Gate | Output |
|---|---|
| `npm run lint` | `✖ 4 problems (0 errors, 4 warnings)` (the same 4 pre-existing warnings) |
| `npm run typecheck` | exit 0 |
| `npx vitest run --maxWorkers=2` | `Test Files  517 passed | 1 skipped (518)`, `Tests  5360 passed | 5 skipped (5365)` |
| `npx next build` | `✓ Compiled successfully in 4.4s` |
| `npm run openapi:check` / `api:inventory:check` | up to date |
| `npm run route-sql:check` | `current total 23, baseline total 23` |
| `npm run version:check` | OK |
| `npm run doc:counts` | all gated counts match |
| `npm run hooks:test:python` | sdk-python `Ran 133 tests OK`; hooks `Ran 776 tests OK (skipped=3)` |

Test files edited: **0**.

## DEVIATIONS

1. Dispatch-table work produced no edits: the scan found only two chains of six or more branches and neither is a keyed dispatch (table above).
2. repowise's dead-code index was 25 days stale and its high tier was mostly registry false positives, so the authoritative list came from a current-tree scan plus the per-symbol grep transcript. Both steps of the plan's "repowise AND grep" rule were still run.
3. Exported types with zero references were deleted along with functions; the `app/lib/types/*` catalog files stay, smaller.
4. A cascade pass ran once after the first deletions; a third pass found nothing further to remove among the checked trees.

## THINGS LEFT UNTOUCHED

- 166 exports that nothing outside their file imports but that are used inside it (over-exported, not dead). Removing the `export` keyword is a surface trim with no size gain and was not in scope.
- Stale comments the deletions exposed (comment edits are out of scope): `app/lib/posture/signals.ts` header still says "I/O boundary" and line 171 still names `computePosturePayload`.
- `mcp-server/src` types with zero references (`DashclawGuardDecision`, `DashclawGuardPayload`, `PolicyDecision`): the compiled `mcp-server/lib` is a tracked artifact and the MCP surface is an invariant; left for a dedicated MCP release.
- Docs that still mention deleted names as history (`docs/superpowers/**`, `docs/platform-guide-coverage.json` legacy rows, `.claude/skills/dashclaw-agent/knowledge/legacy-sdk-reference.md`).

## Program totals (baseline main d6b6b42c → after round 3)

| Metric | Baseline | Final | Delta |
|---|---:|---:|---:|
| Source LOC | 163,106 | 162,668 | **-438 raw; -941 excluding the 503-line phase-0 tooling** |
| Source code lines | 134,229 | 133,889 | -340 |
| Files >= 1,500 LOC | 9 | 5 | -4 (the remaining five are excluded by design) |
| Same-name helper clusters (similarity >= 0.60) | 70 | 57 | -13 |
| Structural clones | 17 | 12 | -5 |
| Largest product file | actions.repository.ts 2,601 | middleware.js 1,258 | |
| Public surface (routes, OpenAPI, MCP, SDK, CLI, hooks, guard replay, smoke harness) | | identical | |
