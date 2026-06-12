# Governance Posture Score — Progress & Handoff (2026-06-06)

> ⚠️ **SUPERSEDED (2026-06-12).** This handoff describes a 2026-06-06 worktree state that has since been merged and extended on `main` (the `/posture` page, posture APIs, storage, and MCP tools shipped in later 4.x releases; the branch named below is gone). **Do not resume from this document.** Current per-task dispositions and the remaining backlog live at `docs/plans/2026-06-12-posture-score-rebaseline.md`.

## TL;DR

**Phase 1 of the posture-score plan is COMPLETE and committed** (pure engine + signals I/O + `GET /api/posture`). The branch was rebased onto post-TypeScript-migration `main`. **Next step:** run the full-suite differential to confirm the gate, then start **Task 8** (Phase 2: migration + storage).

- **Worktree:** `C:/Projects/DashClaw/.claude/worktrees/feat+posture-score-engine`
- **Branch:** `worktree-feat+posture-score-engine`
- **HEAD:** `40d35f7e` (base = `2fe1268d`, the migrated `main`)
- **Pushed:** branch is on `origin` (`github.com/ucsandman/DashClaw`) with upstream tracking — **NOT** merged/pushed to `main`. Resume by checking out this branch.
- **Plan:** `C:/Projects/DashClaw/docs/superpowers/plans/2026-06-05-governance-posture-score.md` (Tasks 1–20)
- **Spec:** `C:/Projects/DashClaw/docs/superpowers/specs/2026-06-05-governance-posture-score-design.md` (design source of truth — §4 anti-gaming, §5 findings, §6 architecture, §10 reuse)
- These planning docs are **untracked** in the main worktree (deliberate "write spec, don't commit" pattern).

---

## Git state (branch commits on top of migrated main `2fe1268d`)

```
40d35f7e fix(posture): real x402 spend-exposure wiring + integer reversible SQL   ← Task 7 fixes (mine)
2b1ffdea feat(posture): signals + GET /api/posture                                 ← Task 7 (subagent)
c768760f test(posture): satisfy strict noUncheckedIndexedAccess after rebase       ← rebase fixup
02f33d4c refactor(posture): findings review cleanups                               ← Task 6 (pre-rebase)
d97fb960 feat(posture): findings derivation (prioritized remediation queue)        ← Task 6
92c7953a fix(posture): address code review                                         ← Task 2–5
fb1b7036 feat(posture): pure governance posture score engine                       ← Tasks 1–5
```

---

## What's DONE

### Phase 1 — the score engine + signals + first route (Tasks 1–7) ✅

| File | What |
|------|------|
| `app/lib/posture/types.ts` | Shared types (`Dimension`, `GovernableUnit`, `PostureScore`, `PostureFinding`, etc.) |
| `app/lib/posture/model.ts` | **Pure** engine: `riskFactor`, `bucketRiskScore`, `unitWeight`, `gradeCoverage`, `computeScore`, `applyIncidentCap` |
| `app/lib/posture/findings.ts` | **Pure** `deriveFindings` — prioritized remediation queue |
| `app/lib/posture/signals.ts` | I/O boundary: `buildUnits`, `buildReplayMap` (internal), `buildAdjustments` (internal), `computePosturePayload` |
| `app/lib/repositories/posture.repository.ts` | READ-ONLY: `getCapabilityUnits`, `getObservedActionUnits`, `getRecentDecisions`, `getIdentityBoundAgents`, `getX402SpendSurfaces` |
| `app/api/posture/route.ts` | `GET /api/posture` → `{ score, status, dimensions, findings, summary, snapshotTs: null }` (no inline SQL) |
| `__tests__/unit/posture-model.test.ts` | engine + anti-gaming property suite (spec §4.4) |
| `__tests__/unit/posture-findings.test.ts` | findings derivation |
| `__tests__/unit/posture-signals.test.ts` | `buildUnits` merge + x402 flip (added during Task 7 review) |
| `__tests__/unit/posture.repository.test.ts` | 18 repo tests (sql-mock harness) |
| `__tests__/unit/api-posture.test.ts` | 11 route-shape/error tests |

**Verified:** `tsc --noEmit` = 0 errors; **58 posture tests pass**; `npm run build` (webpack) exit 0; `route-sql:check` passes.

### The replay crux (anti-gaming core) — how coverage is proven
`signals.ts buildReplayMap` evaluates each org-wide active guard policy against a synthetic `GuardEvalContext` per unit using **`evaluatePolicy`** (the exported single-policy evaluator in `app/lib/guard.ts`), folds to the highest-severity decision, and feeds a sync `replay(unitKey)=>Decision` into the pure engine. It deliberately does **NOT** call `evaluateGuard` (that persists a `guard_decisions` audit row on every call). `guard.ts` was left **untouched**. A unit only counts as covered if an active policy actually *changes the decision* (warn=0.5, block/require_approval=1, allow=0).

### Task 7 review findings (already fixed in `40d35f7e`)
1. `buildUnits` x402 augmentation was a **no-op** (required pre-existing exposure to trigger) → now slugs actually flip `hasSpendExposure`.
2. `getObservedActionUnits` used `reversible = false` on an **integer** column (Postgres runtime error) → `reversible = 0`.
3. Added `posture-signals.test.ts` (the pure `buildUnits` had no test).

---

## ⚠️ Environment caveats — READ before trusting any gate in this worktree

This worktree is **nested inside the repo** (`.claude/worktrees/...`) and was created **pre-migration**. I ran `npm ci` in it to sync `node_modules` to the migrated lockfile (added 732 packages). After that, the **real code gate is reliable** but two tooling surfaces are NOT, for reasons unrelated to the posture code:

1. **`npx next build` ≠ the build gate.** The repo build is **`npm run build`** = `next build --webpack`. Plain `npx next build` uses **Turbopack** and throws ~hundreds of bogus module-resolution errors (this is why `main` commit `99e39719` forced `--webpack`). **Always use `npm run build`.** (It passes — exit 0.)
2. **`npm run lint` (`eslint .`) fails to resolve `next/core-web-vitals`** in this worktree even though `eslint-config-next` is installed (eslint 8 + Next 16 config-resolution quirk). Not a posture issue (fails identically on pre-existing files). **Lint must be validated at integration in the canonical repo**, not here.
3. **Full `vitest` shows 4 pre-existing failures that are environmental, NOT posture-related** — ignore them; they don't exist in CI's clean Linux/LF env:
   - `__tests__/unit/install-hooks.test.js`, `refresh-model-pricing.test.js`, `hosted/check-hosted-ready.test.mjs` → `RolldownError` shebang-parse bug (vite 8 / **rolldown `1.0.0-rc.13`** can't parse `#!/usr/bin/env node` after injected imports, on this Windows worktree).
   - `onboarding-snippets.test.js` (1 assertion) → the worktree checked out the target `.md` as **CRLF** (main is LF), breaking a `\n` regex.

### The working gate definition for THIS worktree
```
npx tsc --noEmit            # must be 0 errors  (authoritative TS gate)
npx vitest run <your files> # your new tests green
npx vitest run              # FULL — must show ONLY the 4 known-env failures, nothing new
npm run build               # webpack — must exit 0
npm run route-sql:check     # must pass (no inline SQL in routes)
```
`npm run lint` → defer to the canonical-repo integration step.

### Flag to the owner (real, but out of the posture feature's scope)
- The migrated lockfile pins **rolldown `1.0.0-rc.13`** (a release candidate) which has a shebang-parse bug that breaks 3 script-import tests on a **clean `npm ci`** (at least on Windows). CI passed the migration via an npx-cached vite, so it was masked. Worth a deps follow-up (pin a stable rolldown / strip shebangs in those scripts).
- This worktree checks out some text files as CRLF while `main` is LF — a `.gitattributes`/autocrlf inconsistency.

---

## Verified integration facts (recon, distilled) — for Tasks 8–17

- **Guard evaluator:** `app/lib/guard.ts` — `evaluateGuard(orgId, ctx, sql, opts)` PERSISTS an audit row (never call per-unit); `evaluatePolicy(policy, rules, ctx, sql, orgId, riskScore)` is exported and returns `{ action: 'allow'|'warn'|'require_approval'|'block' } | null`. Active policies: `getActivePolicies(sql, orgId)` in `app/lib/repositories/guardrails.repository`.
- **Route pattern** (`app/api/**/route.ts`): `const sql = getSql()` (`app/lib/db`), `const orgId = getOrgId(request)` (`app/lib/org`), pass `(sql, orgId)` to repositories, wrap in try/catch → `apiErrorResponse(error, 'LABEL')`. **No inline SQL in routes** (`route-sql:check`). Mirror `app/api/actions/route.ts`.
- **Repository pattern:** functions take `sql: SqlTag` (`app/lib/types/db`) first, then `orgId`, then filters; shape rows via a `shapeX(row)` mapper. **Test mock harness** to mirror: `__tests__/unit/capabilities.repository.test.js` (`makeSqlMock([...responses])` returning queued arrays). Write posture tests as `.ts`.
- **Schema/migrations:** `schema/schema.js` (still `.js`). `capabilities` and `x402_*` tables are **raw-SQL/migration-only** (not in schema.js). **New posture tables go the standard route: add to `schema/schema.js` + `drizzle/0022_posture.sql`** (0021 is the current highest). `x402_providers` cols: `provider_id, slug, status('active'), org_id`. `action_records.reversible` = **integer** (1/0). `guard_decisions`: `action_id, decision, risk_score, action_type, created_at, org_id`.
- **Policy-Coach "insert inactive policy" (draft) path** — needed for **Task 11** `create_draft`. NOT yet confirmed exactly. Recon pointed at `app/lib/behavior/` (analyzer/simulate) + the `POST /api/policies` insert with `active = 0`. **Confirm the exact reusable insert-inactive function before Task 11.**
- **Simulator:** `app/lib/behavior/simulate.ts` `simulateBehaviorPolicy(rule, samples)` — reuse for the Task 15 "draft preview" UI.
- **CLI:** `cli/bin/dashclaw.js` — per-subcommand `async function cmdX(){ const claw = createClient(); ... }`; tests in `cli/test/api.test.js` (stub `global.fetch`).
- **MCP:** `mcp-server/lib/tools.js` — `TOOL_DEFINITIONS[]` (name/description/inputSchema) + `createToolHandlers(client)` factory; dispatched by `app/api/mcp/route.ts`. New tool = add to both. **Resolve-via-MCP must be draft-only** (agents can never self-activate enforcement).

### Deferred stubs in `signals.ts` to wire during Phase 2
- `approvalFollowThrough: 1` (needs pending-approval + outcome-sweep query)
- `coachOpenGapUnitKeys: []` (needs Policy-Coach suggestion state)
- `infraOk: () => true` (needs per-unit infra health: MCP/embedding service)
- `snapshotTs: null` (needs `posture_snapshots` table — Task 8)

---

## What's LEFT (Tasks 8–20)

### Phase 2 — Findings + loop API + storage (Tasks 8–12)
- **T8** Migration + schema: `posture_findings_state(org_id, finding_key, status, note, actor, created_at, updated_at, PK(org_id,finding_key))` + `posture_snapshots(id, org_id, score numeric, dimensions jsonb, created_at)` → `schema/schema.js` + `drizzle/0022_posture.sql`. **Run `npm run db:migrate` at execution time.** Coerce `Number(score)` on read (Neon returns numeric as string).
- **T9** Finding-state repo + merge into `signals.ts` (a resolved/snoozed/accepted finding drops from the open queue).
- **T10** `GET /api/posture/findings` (filters `?status=`/`?dimension=`).
- **T11** `POST /api/posture/findings/[key]/resolve` — `create_draft` (insert **inactive** guard_policies via the Policy-Coach path → finding state `drafted`, NOT `resolved`) | `snooze` | `accept_risk`. **Honesty property test:** after `create_draft`, `GET /api/posture` score is **unchanged** (drafting ≠ coverage).
- **T12** `POST /api/posture/scan` — recompute + `insertSnapshot`.

### Phase 3 — `/posture` page (Tasks 13–15)
- **READ `.impeccable.md` first.** `app/posture/page.tsx`, token-first/dark, orange-as-signal-only, `.tabular-nums`. Score hero + sparkline + six dimension cards + next-queue + resolve flow (reuse Policy-Coach simulate summary). Honesty property in the UI (draft creation doesn't move the on-page score).

### Phase 4 — CLI + MCP (Tasks 16–17)
- CLI: `dashclaw posture` / `next` / `posture resolve <key>` (draft-only). MCP: `dashclaw_posture` + `dashclaw_posture_next` (resolve draft-only).

### Phase 5 — Ship pass + release (Tasks 18–20)
- Use the **`dashclaw-ship`** skill: regenerate derived artifacts (openapi/api-inventory/livingcode), update hand-authored docs (SDK READMEs, `docs/sdk-parity.md`, `PROJECT_DETAILS.md`, `app/docs`), `npm run version:set <x.y.z>` (platform + both SDKs lockstep) → `npm install` → owner publishes `npm run release:sdks`.

### Final — integrate to main
- Use **`superpowers:finishing-a-development-branch`** in the canonical repo (where the full suite is clean of the 4 worktree-env failures and lint resolves). Workflow is **commit to `main`, no PRs** (owner preference). Run the full gate there.

---

## Process being used
- **`superpowers:subagent-driven-development`**: fresh implementer subagent per task → spec-compliance review → code-quality review → fix loop → mark complete. For Task 7 I (controller) acted as the independent reviewer and found+fixed 3 real bugs rather than spinning separate review subagents — for the UI/Phase-3 work, prefer dispatching the dedicated reviewers.
- Task tracker (this session) had 6 items: #1 Task 7 (DONE), #2 Phase 2, #3 Phase 3, #4 Phase 4, #5 Phase 5, #6 Final integration.

## Immediate next action for the next session
1. `cd` into the worktree; run the **full-suite differential** (`npx vitest run`) to confirm only the 4 known-env failures (this was interrupted right after the Task 7 fix commit — `tsc`/targeted-tests/build were already green).
2. Start **Task 8** (migration + schema), following the plan.
