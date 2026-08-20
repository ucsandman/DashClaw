# The Short List — Policies + Calibration Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brand-new org is governed with zero clicks by a named, hard-capped "Short List" of at most ten interrupting rules (seeded: BLOCK mass destruction, HOLD secret-file writes, HOLD force-push over a protected branch, WATCH runaway); every other rule is Watch-tier (warn); calibration starts in shadow on day 0 and can be fed by retrospective Yes/No verdicts on warn groups; `/calibration` folds into `/policies#calibration`; a misfire card caps any shape misclassification at 3 interruptions.

**Architecture:** Engine first (pure modules + rule-JSON flags, zero migrations, zero new routes, zero new policy types), then the `/policies` page rebuilt around four sections (stat cards → Short List → Needs your call → Calibration → Everything else → Outside provider), then docs/budget. Short List membership is **derived**: a rule is on the list iff its effective action is `block`/`require_approval` OR `rules.short_list === true` — so existing orgs' interrupting rules are already on their list with no backfill.

**Tech Stack:** Next.js 16 App Router, TypeScript (engine) + TSX/JSX (UI), Postgres via repositories, vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-policies-calibration-onboarding-redesign.md` (read §2, §4, §5, §8, §9 before any task).

## Global Constraints

- **Zero migrations, zero new API routes, zero new pages, zero new policy types.** Everything rides `guard_policies.rules` JSON and existing routes. Surface budget: app pages 54 → **53** (delete `app/calibration/page.jsx`), routes stay 133, policy types stay 17.
- **Never auto-apply an enforcement change in either direction** (MAINTAINER.md §3). Relief/Active/tightening/promotion are always a human click. Seeding happens only at org birth.
- **`block` always wins the severity merge** (`app/lib/guard/evaluate.ts:111-113`); a HOLD rule can never out-vote a BLOCK. Force-push is made a HOLD by *excluding* force-pushes from the risk-100 BLOCK line via a predicate, not by out-voting it.
- **Ungrantable stays reserved for rare classes**; never mark a high-volume rule ungrantable. The misfire exception (`rules.shape_exceptions`) is the human escape hatch and works on ungrantable lines because it is a click.
- **Retrospective verdicts** (`source: 'warn_review'`): weight 0.5, never move θ in the tightening direction, Relief needs `labeledTotal ≥ 10` AND `labeledLive ≥ 3`.
- **Ten-line cap is HARD**: `SHORT_LIST_CAP = 10`; adding an 11th returns 409 `SHORT_LIST_FULL`; the UI opens a remove-one dialog.
- **Copy**: exactly as in spec §4–§5 (subtitle "A short list of things that stop your agent. Everything else is watched and measured."; section headers "The Short List", "Needs your call", "Calibration", "Everything else — watched, recorded, not interrupting", "Outside decision provider"). Greek θ leaves the UI (label table spec §5.4). Serious · precise · declarative voice (`.impeccable.md`). Tokens only, no hex. Dark only. Chips carry the WORD BLOCK/HOLD/WATCH, never colour alone.
- **No backticks in any agent prompt** when dispatching subagents; every `Agent` call sets `model:` (opus for UI/engine tasks, sonnet for doc sweeps, haiku for lookups).
- **Gates before push** (CLAUDE.md): `npm run lint`, `npx vitest run --maxWorkers=2`, `npm run typecheck`, `npx next build`, `npm run surface:check`, `npm run doc:counts`. Commit after every task with a conventional message.
- **Deviation recorded:** "Undo seed (24h)" from spec §3.3 is NOT built — per-line **Off** on the Short List covers it with less code. `/connect` receipt links "Review the Short List" → `/policies`.

---

## Phase A — Engine and data (no UI)

### Task A1: `git_push` predicate module

**Files:**
- Create: `app/lib/guard/git-push.ts`
- Test: `__tests__/unit/guard-git-push.test.ts`

**Interfaces (produces):**
```ts
export interface GitPushPredicate { force?: boolean; branches?: string[] }
export interface ParsedGitPush { force: boolean; branch: string | null; remote: string | null }
export const DEFAULT_PROTECTED_BRANCHES: readonly string[]; // ['main','master','trunk','production','release/*']
export function parseGitPush(text: unknown): ParsedGitPush | null;   // null when text contains no `git push`
export function branchMatches(branch: string | null, patterns: readonly string[]): boolean; // null branch => true (conservative)
export function gitPushPredicateMatches(pred: GitPushPredicate, text: unknown): boolean;
export function commandTextOf(context: { declared_goal?: unknown; act?: { command?: unknown } | null }): string; // act.command ?? declared_goal ?? ''
```

- [ ] **Step 1: Write the failing tests**

```ts
// __tests__/unit/guard-git-push.test.ts
import { describe, it, expect } from 'vitest';
import { parseGitPush, branchMatches, gitPushPredicateMatches, DEFAULT_PROTECTED_BRANCHES } from '../../app/lib/guard/git-push';

describe('parseGitPush', () => {
  it('returns null when there is no git push', () => {
    expect(parseGitPush('Bash: git log --date=format:%Y')).toBeNull();
    expect(parseGitPush('Bash: npm test')).toBeNull();
    expect(parseGitPush(undefined)).toBeNull();
  });
  it('detects --force, -f, --force-with-lease and +refspec', () => {
    expect(parseGitPush('Bash: git push --force origin main')).toEqual({ force: true, branch: 'main', remote: 'origin' });
    expect(parseGitPush('git push -f origin feature/x')).toEqual({ force: true, branch: 'feature/x', remote: 'origin' });
    expect(parseGitPush('git push --force-with-lease=main origin HEAD:main')).toMatchObject({ force: true, branch: 'main' });
    expect(parseGitPush('git push origin +main')).toMatchObject({ force: true, branch: 'main' });
  });
  it('treats --delete / -d / :branch as force (destructive)', () => {
    expect(parseGitPush('git push origin --delete main')).toMatchObject({ force: true, branch: 'main' });
    expect(parseGitPush('git push origin :release/1.2')).toMatchObject({ force: true, branch: 'release/1.2' });
  });
  it('a plain push is not force and reads the branch', () => {
    expect(parseGitPush('Bash: git push origin feature/x')).toEqual({ force: false, branch: 'feature/x', remote: 'origin' });
    expect(parseGitPush('Bash: git push')).toEqual({ force: false, branch: null, remote: null });
  });
  it('finds git push inside && chains and wrappers', () => {
    expect(parseGitPush('cd repo && git add -A && git push --force origin main')).toMatchObject({ force: true, branch: 'main' });
    expect(parseGitPush('rtk git push -f origin master')).toMatchObject({ force: true, branch: 'master' });
  });
});

describe('branchMatches', () => {
  it('matches exact names and glob prefixes', () => {
    expect(branchMatches('main', DEFAULT_PROTECTED_BRANCHES)).toBe(true);
    expect(branchMatches('release/2.0', DEFAULT_PROTECTED_BRANCHES)).toBe(true);
    expect(branchMatches('feature/x', DEFAULT_PROTECTED_BRANCHES)).toBe(false);
  });
  it('treats an unknown branch as protected (conservative)', () => {
    expect(branchMatches(null, DEFAULT_PROTECTED_BRANCHES)).toBe(true);
  });
});

describe('gitPushPredicateMatches', () => {
  const pred = { force: true, branches: [...DEFAULT_PROTECTED_BRANCHES] };
  it('holds a force-push over main, not over a feature branch, not a plain push', () => {
    expect(gitPushPredicateMatches(pred, 'Bash: git push --force origin main')).toBe(true);
    expect(gitPushPredicateMatches(pred, 'Bash: git push --force origin feature/x')).toBe(false);
    expect(gitPushPredicateMatches(pred, 'Bash: git push origin main')).toBe(false);
    expect(gitPushPredicateMatches(pred, 'Bash: rm -rf build')).toBe(false);
  });
  it('{force:true} with no branches matches every force-push', () => {
    expect(gitPushPredicateMatches({ force: true }, 'git push -f origin feature/x')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run __tests__/unit/guard-git-push.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// app/lib/guard/git-push.ts
// Branch-aware git push predicate. Used by (a) require_approval / block_action_type
// rules carrying `rules.git_push` and (b) risk_threshold rules carrying
// `rules.except_git_push`. Pure; no I/O. Funded 2026-08-20 so that a force-push
// over a protected branch is a HOLD with an approval card instead of a dead run.
export interface GitPushPredicate { force?: boolean; branches?: string[] }
export interface ParsedGitPush { force: boolean; branch: string | null; remote: string | null }

export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master', 'trunk', 'production', 'release/*'] as const;

const FORCE_FLAGS = new Set(['--force', '-f', '--delete', '-d']);

export function commandTextOf(context: { declared_goal?: unknown; act?: { command?: unknown } | null }): string {
  const act = context?.act && typeof context.act === 'object' ? (context.act as { command?: unknown }).command : undefined;
  if (typeof act === 'string' && act.trim()) return act;
  return typeof context?.declared_goal === 'string' ? context.declared_goal : '';
}

/** Split on shell chain operators; return the first segment containing `git push`. */
function gitPushSegment(text: string): string[] | null {
  for (const seg of text.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const words = seg.trim().split(/\s+/);
    const gi = words.findIndex((w, i) => w === 'git' && words[i + 1] === 'push');
    if (gi >= 0) return words.slice(gi + 2);
  }
  return null;
}

export function parseGitPush(text: unknown): ParsedGitPush | null {
  if (typeof text !== 'string') return null;
  const args = gitPushSegment(text);
  if (!args) return null;
  let force = false;
  const positional: string[] = [];
  for (const a of args) {
    if (FORCE_FLAGS.has(a) || a.startsWith('--force-with-lease')) { force = true; continue; }
    if (a.startsWith('-')) continue;
    positional.push(a);
  }
  const remote = positional[0] ?? null;
  let branch: string | null = null;
  const refspec = positional[1];
  if (refspec) {
    let spec = refspec;
    if (spec.startsWith('+')) { force = true; spec = spec.slice(1); }
    if (spec.startsWith(':')) { force = true; spec = spec.slice(1); }       // push :branch deletes it
    const colon = spec.indexOf(':');
    branch = colon >= 0 ? spec.slice(colon + 1) : spec;                    // src:dst → dst
    branch = branch.replace(/^refs\/heads\//, '') || null;
  }
  return { force, branch, remote };
}

export function branchMatches(branch: string | null, patterns: readonly string[]): boolean {
  if (branch == null) return true; // ponytail: unknown branch counts as protected — the conservative reading
  return patterns.some((p) => p.endsWith('/*') ? branch.startsWith(p.slice(0, -1)) : branch === p);
}

export function gitPushPredicateMatches(pred: GitPushPredicate, text: unknown): boolean {
  const parsed = parseGitPush(text);
  if (!parsed) return false;
  if (pred.force === true && !parsed.force) return false;
  if (Array.isArray(pred.branches) && pred.branches.length > 0 && !branchMatches(parsed.branch, pred.branches)) return false;
  return true;
}
```

- [ ] **Step 4: Run tests** → PASS. Run `npm run typecheck`.
- [ ] **Step 5: Commit** — `git add app/lib/guard/git-push.ts __tests__/unit/guard-git-push.test.ts && git commit -m "feat(guard): branch-aware git push predicate"`

---

### Task A2: Wire `git_push` / `except_git_push` into policy evaluation

**Files:**
- Modify: `app/lib/guard/policy.ts:89-108` (matchActionType), `:274-297` (risk_threshold evaluator)
- Modify: `app/lib/validate.js` (policy-type validators for require_approval / block_action_type / risk_threshold — find `POLICY_TYPE_VALIDATOR_MAP` ~line 793 and the per-type validators above it)
- Test: `__tests__/unit/guard-git-push-policy.test.ts` (new), existing `__tests__/unit/guard-characterization.test.js` must stay green.

**Interfaces:**
- Consumes: `gitPushPredicateMatches`, `commandTextOf` from A1.
- Produces: rule shapes `{ action_types?: string[], git_push?: GitPushPredicate, target_prefix?: string }` on `require_approval`/`block_action_type`; `{ threshold, action, except_git_push?: GitPushPredicate }` on `risk_threshold`. When `git_push` is present and `action_types` is empty/absent, the action-type check is skipped.

- [ ] **Step 1: Failing tests** (use the same harness `guard-characterization.test.js` uses to call `evaluatePolicy`/`evaluateGuard` with in-memory policies — copy its setup):

```ts
// __tests__/unit/guard-git-push-policy.test.ts — three assertions
// 1. require_approval { git_push: { force: true, branches: ['main'] } } + context declared_goal 'Bash: git push --force origin main'
//    → result.action === 'require_approval'
// 2. same rule, declared_goal 'Bash: git push --force origin feature/x' → evaluatePolicy returns null
// 3. risk_threshold { threshold: 100, action: 'block', except_git_push: { force: true } } with effectiveRiskScore 100:
//    declared_goal 'Bash: git push --force origin main' → null (excluded); declared_goal 'Bash: rm -rf /' → action 'block'
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

In `matchActionType`:
```ts
  const actionTypes = rules.action_types || [];
  const gitPred = rules.git_push && typeof rules.git_push === 'object' ? (rules.git_push as GitPushPredicate) : null;
  if (gitPred && !gitPushPredicateMatches(gitPred, commandTextOf(context))) return null;
  let matchedType: string | undefined;
  if (actionTypes.length > 0 || !gitPred) {
    matchedType = contextActionTypes(context).find((t) => actionTypes.includes(t));
    if (matchedType === undefined) return null;
  } else {
    matchedType = 'git push';
  }
```
In the `risk_threshold` evaluator, before `if (riskScore >= threshold)`:
```ts
    if (rules.except_git_push && typeof rules.except_git_push === 'object' &&
        gitPushPredicateMatches(rules.except_git_push as GitPushPredicate, commandTextOf(context))) {
      return null; // another Short List line owns force-pushes (see catastrophe-only pack)
    }
```
Add `git_push` / `except_git_push` to the `PolicyRules` type (find its declaration in policy.ts or `types.ts`). In `validate.js`: accept an optional object `{ force?: boolean, branches?: string[] (each ≤ 128 chars, ≤ 32 entries) }` for both keys; for `require_approval`/`block_action_type` relax the "action_types required" check when `git_push` is present. Reason strings: `Force-push over protected branch "${branch}" requires approval` when matched via git_push.

- [ ] **Step 4: Run** new test + `guard-characterization.test.js` + `validate` tests → PASS. Typecheck.
- [ ] **Step 5: Commit** — `feat(guard): git_push predicate on hold/block rules, except_git_push on risk_threshold`

---

### Task A3: `rules.shape_exceptions` — the misfire escape hatch in the engine

**Files:**
- Modify: `app/lib/guard/evaluate.ts:403-431` (policy loop)
- Modify: `app/lib/validate.js` (accept `shape_exceptions: string[]` ≤ 50 entries, each ≤ 128 chars, on ANY policy type)
- Test: `__tests__/unit/guard-shape-exceptions.test.ts`

**Interfaces:** `rules.shape_exceptions?: string[]` — list of `commandShapeKey(declared_goal)` values (`app/lib/policy-shapes.ts:362`) this policy must never fire on. Produces no new exports.

- [ ] **Step 1: Failing test** — a `require_approval { action_types:['security'], shape_exceptions:['git log'] }` policy; context `{ action_type:'security', declared_goal:'Bash: git log --date=format:%Y' }` → decision allow, policy not in `gatingPolicies`; context `{ action_type:'security', declared_goal:'Bash: rm -rf build' }` → require_approval. Assert `commandShapeKey('Bash: git log --date=format:%Y') === 'git log'` in the same file so the key grain is pinned.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in the loop right after `rules = JSON.parse(policy.rules)`:
```ts
    if (Array.isArray(rules.shape_exceptions) && rules.shape_exceptions.length > 0) {
      const shape = commandShapeKey(context.declared_goal);
      if (shape && rules.shape_exceptions.includes(shape)) {
        acc.warnings.push(`Policy "${policy.name}" skipped: shape "${shape}" is an exception you added`);
        continue;
      }
    }
```
(Import `commandShapeKey` from `../policy-shapes`; `acc.warnings` — use whatever the accumulator's warning array is called, see `applyInterruptionBudget` for the existing push.) Apply the same skip in the deviation_response loop at `:1133-1145`.
- [ ] **Step 4: Run → PASS.** Typecheck.
- [ ] **Step 5: Commit** — `feat(guard): rules.shape_exceptions skips a policy for a command shape`

---

### Task A4: Catastrophe-only pack becomes the four-line Short List

**Files:**
- Modify: `app/lib/guardrails/packs/catastrophe-only/policies.yml`
- Modify: `app/lib/setup/catastrophe-pack.mjs` (no logic change expected; confirm it copies `rules` verbatim)
- Modify tests: `__tests__/unit/catastrophe-only-pack.test.js`, `__tests__/unit/catastrophe-pack-seed.test.js` ("exactly three" → four)

- [ ] **Step 1: Update tests first**: pack declares exactly **four** policies; new cases: `holds_force_push_main` (declared_goal `Bash: git push --force origin main`, effective risk 100 → `require_approval`, NOT block), `allows_force_push_feature_branch` (declared_goal `Bash: git push --force origin feature/x` at risk 100 → not block, not require_approval — the block line excludes force-pushes, the hold line doesn't match the branch), `blocks_rm_rf` unchanged; `hold_secret_file_writes` rules carry `ungrantable: true` and `short_list: true`; every line carries `short_list: true`. Seed test: inserts all four.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Edit YAML** (keep the existing header comments; adjust the arithmetic comment to say force-pushes are carved out to line 3):
  - `block_mass_destructive.rules`: add `except_git_push: { force: true }` and `short_list: true`.
  - `hold_secret_file_writes.rules`: add `ungrantable: true`, `short_list: true`.
  - NEW `hold_force_push_protected`: `policy_type: require_approval`, `description: "Catastrophe Pack — Hold Force-Push Over Protected Branches"`, `rules: { action: require_approval, git_push: { force: true, branches: [main, master, trunk, production, "release/*"] }, short_list: true }` with tests `holds_force_push_main`, `allows_force_push_feature_branch`. Grantable (no ungrantable flag) — a single-use grant is the right answer when the human meant it.
  - `rate_limit_runaway_safety.rules`: add `short_list: true`.
- [ ] **Step 4: Run the two pack tests + `guard-git-push-policy` → PASS.**
- [ ] **Step 5: Commit** — `feat(packs): catastrophe-only = four Short List lines; force-push is a hold`

---

### Task A5: Watch-tier transform + Short List cap on every write path

**Files:**
- Create: `app/lib/guardrails/short-list.ts`
- Modify: `app/lib/guardrails/import-pack.ts:41-86` (importPolicies), `app/api/policies/route.ts` (POST; and PATCH when `rules` changes)
- Test: `__tests__/unit/short-list.test.ts`, extend `__tests__/unit/policy-import*.test.*` if present, route test for 409.

**Interfaces (produces):**
```ts
export const SHORT_LIST_CAP = 10;
export type ShortListTier = 'BLOCK' | 'HOLD' | 'WATCH';
export function effectiveAction(policyType: string, rules: Record<string, unknown>): 'allow'|'warn'|'require_approval'|'block'|'other';
  // rules.action if present; else defaults: block_action_type→block, risk_threshold→block, require_approval/protected_path/...→require_approval, warn_action_type/rate_limit→warn, allow_grant→allow. Mirror bucketFallback in app/lib/policy-modes/summary.ts — reuse it if exported.
export function isShortListLine(policyType: string, rules: Record<string, unknown>): boolean;
  // rules.short_list === true || effectiveAction ∈ {block, require_approval}
export function shortListTier(policyType: string, rules: Record<string, unknown>): ShortListTier; // block→BLOCK, require_approval→HOLD, else WATCH
export function toWatchTier(rules: Record<string, unknown>): Record<string, unknown>;
  // returns a copy with action:'warn' when effective action is block/require_approval, and short_list/ungrantable removed
export function countShortListLines(rows: Array<{ policy_type: string; rules: unknown; active?: unknown }>): number; // active rows only
export class ShortListFullError extends Error { code = 'SHORT_LIST_FULL'; }
```

- [ ] **Step 1: Failing tests** for each helper (toWatchTier on a block rule → warn + flags stripped; isShortListLine true for require_approval without flag; true for warn with flag; false for warn without; countShortListLines ignores inactive rows).
- [ ] **Step 2: Run → FAIL.** Step 3: implement.
- [ ] **Step 4: Wire the write paths:**
  - `importPolicies`: for each pack policy, if `rules.short_list !== true` → `rules = toWatchTier(rules)`; if it IS short_list → check `countShortListLines(existing active rows) + importedSoFar < SHORT_LIST_CAP` else skip with reason `short_list_full` (add to the returned `{skipped}` detail). Return value gains `watched: number` (rules forced to warn) so the install banner can say "Installed N rules in Watch."
  - `POST /api/policies`: body may carry `rules.short_list === true`; if so, enforce the cap → `409 { error: 'The Short List is full (10 of 10). Remove a line to add this one.', code: 'SHORT_LIST_FULL' }`; otherwise `rules = toWatchTier(rules)` when the caller did NOT set `short_list` AND the effective action interrupts. **Exception**: requests carrying `short_list: true` bypass the transform (that is the opt-in). `PATCH` that flips a warn rule to require_approval ("Hold instead", "Promote to Hold") must send `short_list: true` and is cap-checked the same way.
  - Keep the seeder (`catastrophe-pack.mjs`) untouched — it writes raw SQL at org birth and its YAML already carries the flags.
- [ ] **Step 5: Tests** for import (a block rule in a non-short-list pack lands as warn; the catastrophe pack lands intact; 11th short-list line skipped) and route (409). Run → PASS. Typecheck.
- [ ] **Step 6: Commit** — `feat(policies): Watch tier by default; Short List hard cap of 10`

---

### Task A6: Calibration — warn_review source, weight, live floor, shadow default, retro verdicts

**Files:**
- Modify: `app/lib/guard/calibration.ts` (`CalibrationState` + `labeledLive`, `CALIBRATION_DEFAULTS.reliefMinLiveLabels = 3`, `AdjudicationInput.weight?`/`source?`, `applyAdjudication`, `assessCalibration`, `coerceCalibrationState`, `parseCalibrationSettings` default mode → `'shadow'`, `freshCalibrationState`)
- Modify: `app/lib/guard/calibration-feedback.ts:32-39` (`source` union += `'warn_review'`; pass weight 0.5 + source through)
- Modify: `app/lib/repositories/policy-review.repository.ts` (`WarnGroup.max_risk`; SELECT adds `risk_score`), `app/api/policies/review/verdict/route.ts` (verdicts `retro_stop` | `retro_fine`)
- Modify: `app/api/calibration/controller/route.ts` GET → add `labeled_live`, `relief_min_live_labels`, and `relief_ready` uses both gates
- Tests: `__tests__/unit/calibration-controller.test.ts` (add cases; existing cases must stay green because `weight` defaults to 1), `calibration-feedback.test.js`, `policy-review-verdict*.test.*` (find/extend), `calibration-controller.route.test.ts`.

**Interfaces (produces):**
```ts
// calibration.ts
interface CalibrationState { ...; labeledLive: number }          // live approve/deny verdicts only
interface AdjudicationInput { riskScore; label; agentId?; weight?: number /* default 1 */; source?: 'live' | 'warn_review' /* default 'live' */ }
CALIBRATION_DEFAULTS.reliefMinLiveLabels = 3
// calibration-feedback.ts
source: 'approval' | 'bulk_approval' | 'seed' | 'warn_review'   // warn_review ⇒ weight 0.5, agentId null
// verdict route body: { verdict: 'retro_fine' | 'retro_stop', shape: { action_type, target_prefix? } }
```

- [ ] **Step 1: Failing tests** in `calibration-controller.test.ts` (new describe 'warn_review adjudications'):
  1. weight 0.5 adds 0.5 to `labeledTotal`, 0 to `labeledLive`; a live one adds 1 to both.
  2. warn_review benign with score ≥ θ raises θ exactly like live (loss=1); warn_review benign with score < θ leaves θ **unchanged** (no tightening step), whereas live benign below θ lowers θ by γ·α.
  3. warn_review dangerous pulls `reliefCeiling` to score−1 and leaves θ unchanged.
  4. `assessCalibration` `would_relieve` is false at `labeledTotal=12, labeledLive=2` and true at `labeledLive=3` (ceiling ≥ score, score < θ).
  5. `parseCalibrationSettings([])` → mode `'shadow'`; explicit `'off'` stored → `'off'`.
  6. `coerceCalibrationState({})` yields `labeledLive: 0` (legacy rows).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in `applyAdjudication`:
```ts
  const weight = input.weight ?? 1;
  const retro = input.source === 'warn_review';
  const loss: 0 | 1 = score >= thetaBefore && input.label === 'benign' ? 1 : 0;
  const rawDelta = CALIBRATION_DEFAULTS.gamma * (loss - settings.targetRate) * weight;
  // Retrospective verdicts may loosen (Δ>0) but never tighten (Δ<0): spec §8 invariant 8.
  const delta = retro && rawDelta < 0 ? 0 : rawDelta;
  const thetaAfter = clampTheta(thetaBefore + delta);
  ...agents: skip the e-process when retro (no agent owns a group verdict)
  ...labeledTotal: state.labeledTotal + weight, labeledBenign/Denied + weight, labeledLive: state.labeledLive + (retro ? 0 : 1), lossSum + loss * weight
```
`assessCalibration.would_relieve` adds `state.labeledLive >= CALIBRATION_DEFAULTS.reliefMinLiveLabels`. `parseCalibrationSettings`: unknown/missing → `'shadow'`; the literal `'off'` stays off. **Note:** `'off'` must still be selectable; only the *absence* of a setting defaults to shadow.
  - `policy-review.repository.ts`: SELECT `risk_score`; `groupWarnDecisions` tracks `max_risk` per group (0 when null).
  - Verdict route: `retro_fine` → `ingestApprovalAdjudication(sql, orgId, { actionId: group.sample_id, agentId: null, riskScore: group.max_risk, approved: true, source: 'warn_review' })` then apply the existing `fine` dismissal for the shape; `retro_stop` → same with `approved: false` (label dangerous: pulls the ceiling back, never tightens θ) then dismiss the shape too. Derive the group server-side (`getWarnDecisionsSince` since the review cursor + `groupWarnDecisions`, find `shape.key`); 404 if the shape is no longer in the feed. Response `{ ok: true, adjudicated: true, labeled_total, labeled_live }`.
  - `calibration-feedback.ts`: map `source === 'warn_review'` → `{ weight: 0.5, source: 'warn_review' }` into `applyAdjudication`; the `guard_calibration_events` row keeps `source` as given (check the insert's allowed values — extend the type, no schema change since it is text/jsonb).
  - Controller GET: `relief_ready = state.labeledTotal >= 10 && state.labeledLive >= 3 && state.reliefCeiling >= 0`; expose `labeled_live`, `labeled_total`, `relief_min_labels`, `relief_min_live_labels`, and `events[].source` in recent adjudications.
- [ ] **Step 4: Run** the four calibration test files + `npx vitest run __tests__/unit/risk-calibration-golden.test.js` → PASS. If `calibration-controller.test.ts` drift floors move, **suspect the test vector before loosening a bound** (memory: index-seeded stream).
- [ ] **Step 5: Commit** — `feat(calibration): retrospective warn_review verdicts (weight 0.5, never tighten), live floor 3, shadow by default`

---

### Task A7: Misfire derivation (`deriveMisfires`) on the loosening feed

**Files:**
- Modify: `app/lib/posture/loosening.ts` (add pure `deriveMisfires`), `app/api/policies/loosening/route.ts` (response gains `misfires`)
- Test: `__tests__/unit/loosening-misfires.test.ts`

**Interfaces (produces):**
```ts
export interface Misfire { policy_id: string; policy_name: string; shape_key: string; count: number; window_hours: 24; approvals: number; denials: number; latest_at: string; sample_goal: string | null }
export const MISFIRE_THRESHOLD = 3;
export function deriveMisfires(rows: RequireApprovalRow[], shapeKeyOf: (goal: unknown) => string | null, shortListPolicyIds: Set<string>, nowIso: string): Misfire[];
```
`RequireApprovalRow` = whatever row shape `deriveOverBudgetShapes` (`loosening.ts:664-681`) already consumes (guard_decisions with `policy_id`/matched policy ids, `declared_goal`, `created_at`, plus approval outcome if joined; if outcome is not in the row, set approvals/denials to 0 and label the evidence line "3 holds in 24h").

- [ ] **Step 1: Failing test** — 3 rows same policy+shape within 24h → one misfire; 2 rows → none; rows for a non-short-list policy → none; a row older than 24h is ignored; a shape already in that policy's `shape_exceptions` is excluded (pass the exceptions map as a 5th arg `exceptionsByPolicy: Map<string,string[]>`).
- [ ] **Step 2: Run → FAIL.** Step 3: implement next to `deriveOverBudgetShapes`, same grouping idiom. Step 4: route returns `misfires` computed from the same rows it already loads (short-list ids from `getActivePolicies` + `isShortListLine`). Run → PASS.
- [ ] **Step 5: Commit** — `feat(policies): misfire derivation — 3 holds of one shape in 24h on a Short List line`

---

### Task A8: Summary payload — Short List, suggestions, interruption-budget report

**Files:**
- Modify: `app/lib/policy-modes/summary.ts` (`PolicySummary` + `shortList`, `shortListCap`, `suggestions`, `budgetReport`), `app/api/policies/summary/route.ts` if it needs extra rows (it already has active policies + 30d outcomes)
- Test: `__tests__/unit/policy-summary.route.test.ts` (extend), `__tests__/unit/demo-gap-fixtures.test.ts` (demo fixture for the summary must carry the new keys — see `app/lib/demo/*` for the policies summary fixture)

**Interfaces (produces):**
```ts
export interface ShortListLine { id: string; name: string; tier: 'BLOCK'|'HOLD'|'WATCH'; policy_type: string; scope: string /* plain-English one-liner */; fired30d: number; ungrantable: boolean; shape_exceptions: string[]; active: boolean; seeded: boolean /* name starts with 'Catastrophe Pack — ' */ }
PolicySummary.shortList: ShortListLine[]; PolicySummary.shortListCap: 10;
PolicySummary.suggestions: Array<{ id: 'real_money'; title: 'Real money'; scope: string; rule: { policy_type: 'require_approval'; rules: { action:'require_approval'; action_types: string[11]; ungrantable: true; short_list: true } } }>; // present only when no active policy gates any of the 11 spend types
PolicySummary.budgetReport: { policiesOverBudget: number; shapesOverBudget: number; window_hours: 24; budget: 50; shape_budget: 10 } // from getOverBudgetPolicyIds / getOverBudgetShapeKeys (app/lib/guard/caches.ts:624-636)
```
`scope` = reuse the Sentences-lens describer (find the function the `SentencesLens` in `app/policies/components/Ledger.tsx:~900-1000` uses to turn a rule into a sentence — likely in `app/policies/lib/policyFormModel.js` `buildPolicySummary` or a `describeRule` helper; if it is UI-only, move the pure part into `app/lib/policy-modes/describe.ts` and import it from both).

- [ ] **Step 1: Failing tests**: summary for rows [catastrophe four lines + one warn custom + one require_approval custom] → `shortList.length === 5` (4 seeded + the custom hold), tiers correct, `suggestions` contains `real_money`; adding a require_approval rule with `action_types:['payment']` removes the suggestion; `shortListCap === 10`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Update demo fixture. Typecheck.
- [ ] **Step 5: Commit** — `feat(policies): summary exposes the Short List, suggestions, and the interruption-budget report`

---

### Task A9: Hosted provisioning seeds the Short List

**Files:**
- Modify: `app/lib/repositories/hosted-workspace.repository.ts:105-116` — replace `importPolicyPack(sql, orgId, 'claude-code-starter')` with `seedCatastrophePack(sql, orgId)` (import from `../setup/catastrophe-pack.mjs`; it is plain JS, importable from TS — verify the existing `.mjs` import pattern used by `scripts/auto-migrate.mjs` and mirror whatever TS-side import the repo uses for `.mjs`, or add a `catastrophe-pack.d.ts`). Keep the try/catch: provisioning never fails on seed errors; log prefix `[HOSTED] short-list seeding failed for ...`.
- Modify test: `__tests__/unit/hosted/workspace-provision.test.js` — mock `seedCatastrophePack` instead of `importPolicyPack`; assert it is called once with `(sql, orgId)`; seed throw still returns a provisioned workspace.
- Also: `scripts/auto-migrate.mjs:269-312` — no change (already seeds). `app/lib/doctor/fixes/create-default-policy.mjs` — replace the hardcoded "Doctor: Log All Actions" insert with `seedCatastrophePack(sql, 'org_default')` when the org has **zero** policies (spec §8 item 12); update its test if one exists.

- [ ] Steps: update tests → FAIL → implement → PASS → `git commit -m "feat(hosted): trial orgs are born with the Short List"`.

---

## Phase B — The `/policies` page and the calibration merge

All B tasks: read `.impeccable.md` first; reuse `app/policies/policies.module.css` classes (`.shell .topActions .btn .btnPrimary .btnGhost .btnSm .secHead .secHelp .card .inboxSection .sectionHead .sectionRows`); copy is verbatim from spec §4–§6; tokens only. Tests are `.test.jsx`/`.test.tsx` with `@testing-library/react` per `__tests__/unit/policies-inert-banner-reveal.test.jsx` conventions (mock `fetch` per route).

### Task B1: `ShortListSection` component

**Files:**
- Create: `app/policies/components/ShortListSection.tsx`, `app/policies/lib/shortListClient.ts`
- Test: `__tests__/unit/short-list-section.test.tsx`

**Props:** `{ summary: PolicySummary; onChanged: () => void; onPickFromDecisions: () => void }`.

**Renders (spec §4.3, mock §6.1):**
- `secHead`: "The Short List" · right: `"{n} of 10 lines"`. `secHelp`: "The only rules that can interrupt an unattended run."
- One row per `summary.shortList` (active first, inactive struck-through with "Off"): chip with the word `BLOCK`/`HOLD`/`WATCH` (`aria-label="tier"`; colour via `bg-error-subtle text-error` / `bg-warning-subtle text-warning` / `bg-surface-tertiary text-secondary` — word always present), name, `scope` sentence, `"{fired30d} hits / 30d"`, buttons **Details** (disclosure: policy_type, compiled rules JSON in mono, provenance = seeded/you, shape exceptions list each with date-less "Undo" → PATCH removing it) and **Off** (arm → "Turn off?" → PATCH `{ active: false }`), or **On** when inactive. WATCH rows show **Hold instead** (arm/confirm → PATCH `{ rules: {...rules, action:'require_approval', short_list:true} }`; 409 → cap dialog). Under BLOCK/HOLD ungrantable rows the grey sentence "Ungrantable — no grant, approval pause, interruption budget, or automatic tuning can lift this." BLOCK rows: "Refuses outright. Never waits on you."
- Footer: `"+ Add a line from a decision you have seen. {10-n} slots left."` + button **Pick from recent decisions** (calls `onPickFromDecisions`, which the workbench wires to `ledgerActions.current.openNewRule()` with `prefill` `{ short_list: true }` — B5). If `summary.suggestions` has `real_money`: a card "Suggested — Real money" with scope and **Add to the Short List** (POST `/api/policies` with `suggestion.rule`, `name: 'Hold real-money actions'`, short_list true) — on 409 open the cap dialog.
- Empty list (`shortList.length === 0`): card "Install the Short List" — "Four lines that stop an unattended run: mass destruction, secret-file writes, force-push over main, runaway loops. Everything else stays watched." Button **Install** → POST `/api/policies/import { pack: 'catastrophe-only' }` → `onChanged()`. Dismiss (×) stores `localStorage['dashclaw.shortlist.install.dismissed']='1'` in try/catch.
- **Cap dialog** (`ShortListCapDialog` inside the same file): "The Short List is full (10 of 10). Remove one line to add this one." Lists current lines with a radio; **Remove and add** → PATCH chosen line `{active:false}` then retries the pending write; **Cancel**.
- `shortListClient.ts`: `patchPolicy(id, body)`, `createPolicy(body)`, `installPack('catastrophe-only')` thin wrappers around `fetch` returning `{ ok, status, json }`; `isShortListFull(res)` → `res.status===409 && res.json?.code==='SHORT_LIST_FULL'`.

- [ ] **Step 1: Failing tests**: renders 4 rows with tier words; Off is two-click (first click does not PATCH); "Hold instead" on a WATCH row PATCHes action require_approval + short_list true; 409 opens the cap dialog; empty summary renders the Install card and Install POSTs the pack; suggestion card POSTs the spend rule.
- [ ] **Step 2–4:** FAIL → implement → PASS. Step 5: `git commit -m "feat(policies): Short List section"`.

---

### Task B2: `TriageInbox` — order, silence, retro verdicts, misfire queue

**Files:**
- Modify: `app/policies/components/TriageInbox.tsx` (`SECTION_META` order L564-575; empty state L1043-1054; warn row L428-494; kinds L75-80), `app/policies/lib/contractClient.ts` (`postVerdict` accepts `'retro_fine'|'retro_stop'`), `app/policies/lib/looseningClient.ts` (read `misfires` from the loosening payload) and new `app/policies/lib/misfireClient.ts` (`fetchMisfires()`, `addShapeException(policyId, shapeKey, currentRules)`, `removeShapeException(...)` — both PATCH `/api/policies/:id` with `{ rules: {...rules, shape_exceptions: [...] } }`).
- Test: `__tests__/unit/triage-inbox-retro-misfire.test.tsx`; keep `policies-triage-unscoped-grant.test.jsx` green.

**Changes (spec §4.4):**
1. Order: `loosen` (budget + precedent) → `calibration` → `warn` → `tuning` → `tighten`; `misfire` pinned **first**.
2. Empty inbox renders `null` (no EmptyState card). `secHelp` copy: "Observed patterns become one decision, one click. Verdicts here cost your agent nothing."
3. Warn rows gain the pair `"Would you have wanted these stopped?"` **Yes** (`retro_stop`) / **No** (`retro_fine`) — one click each (no arm; they only write an adjudication + dismiss). Keep the existing split button as secondary actions relabelled **Promote to Hold** (tighten, sends `short_list: true`) and **Stop warning** (always_allow). After a verdict the row shows the resolved strip "Recorded — {n} verdicts so far" with Undo disabled (adjudications are append-only; the strip says so).
4. New kind `misfire` with row copy: `"{shape_key}" was held by {policy_name} {count} times in 24h.` evidence `"{approvals} approvals · {denials} denials"` (or "3 holds" when outcome unknown). Buttons: **Stop asking about "{shape_key}"** (arm → confirm → `addShapeException`) · **Keep asking** (dismiss for 24h via the existing dismiss plumbing) · **Why?** (disclosure: "A shape-scoped exception on this one line. The line keeps enforcing everything else. Undo from the Short List → Details.").
5. `onCount` counts misfires too.

- [ ] **Steps:** failing tests (order; null when empty; Yes posts `retro_stop` with the shape; misfire row arm/confirm PATCHes `shape_exceptions` containing the key) → implement → PASS → `git commit -m "feat(policies): inbox — retro verdicts, misfire queue, friction-first order, silent when empty"`.

---

### Task B3: Stat cards + inert alert + pause line

**Files:**
- Modify: `app/policies/components/PostureHero.tsx` → rename export to `PostureCards` (keep file), `app/policies/components/ApprovalPausePanel.tsx` (+ one line)
- Test: `__tests__/unit/policies-inert-banner-reveal.test.jsx` (update selectors), new assertions in a `posture-cards.test.tsx`.

**Renders (spec §4.1–4.2):** two cards only — **"Interruptions, last 7 days"** (`friction.interrupts_7d`, sub "about {est} of your time"; when `summary.budgetReport.policiesOverBudget + shapesOverBudget > 0` second line: "{n} rules crossed 50 interruptions in 24 hours and are warning instead of asking. They are in the list below.") and **"Pending approvals"** (count + link "Open Approvals inbox" → `/approvals`). Delete the Enforcement, Decisions·30d, Governed agents cards and the friction prose. **Inert banner**: keep, but if any inert rule is a BLOCK or on the Short List it renders as the alert row above the cards (`role="alert"`, `border-error/30 bg-error-subtle`), never collapsible; other inert rules render inside Everything else (B5) as struck-through rows — pass `summary.inert` down. `ApprovalPausePanel` gains the sentence "A pause cannot lift a Short List hold." under its controls.

- [ ] Steps: tests → implement → PASS → `git commit -m "feat(policies): two stat cards; inert Short List lines alert above the fold"`.

---

### Task B4: `CalibrationSection` — the merged controller UI

**Files:**
- Create: `app/policies/components/CalibrationSection.tsx` (port the client logic of `app/calibration/page.jsx` — fetch/POST `/api/calibration/controller`, StatTile, Sparkline, modes, target input, alarms, adjudications — into a section component; `app/calibration/page.jsx` is deleted in B6)
- Test: move `__tests__/unit/calibration.page.test.jsx` → `__tests__/unit/calibration-section.test.jsx` and re-point imports; add label assertions.

**Renders (spec §5.1–5.4, mock §6.2):**
- `secHead` "Calibration" · right: mode label (`Off` / `Preview` / `Fewer interruptions — {theta}` / `Fewer and more`). `secHelp` "What it has learned, and what it still needs from you."
- **Honest sentence card** (three states, copy verbatim from spec §5.1): not ready → "Calibration learns from verdicts, not from traffic. You have given {labeled_total} ({labeled_live} from real approvals, {labeled_total-labeled_live} from the warn rows above). Automatic tuning needs 10 verdicts, 3 of them real approve/deny calls, before it can act." + "Preview mode is on: it is recording what it WOULD do and changing nothing. It can never touch a Short List line, never reach allow, never lift a block." Button **Review the warn groups above** (`href="#needs-your-call"`). Ready+off → "Ready. It would stop asking below risk {theta} and never go past {relief_ceiling}, the riskiest action you approved." Button **Switch on fewer interruptions** (POST `{mode:'relief'}`, one click). On → "...It stops asking below risk {theta}, and it can never touch a Short List line, a block, or reach allow." Link **See what it skipped →** `/decisions?decision=warn`.
- Two StatTiles: **Pausing above risk** (theta; sub "Short List floor: 100") and **False interruptions — last 50** (`observed_window_rate`, with the text ON TARGET / OVER TARGET and "target {target}%"). Both sparklines kept with dashed reference lines. Near-alarm chips line "No agents flagged." / "{n} near the line: …".
- Disclosure **Controller settings** (`CollapsibleSection`, collapsed by default): the four-mode picker with labels `Off / Preview / Fewer interruptions / Fewer and more`, two-step confirm retained on `active` (label "Confirm fewer and more?"), hint under the picker: "Fewer and more is offered once the observed rate holds under target for 7 straight days. It is the only mode that can ADD an interruption." (disable the `active` button unless GET reports `active_eligible: true` — add that boolean to the controller GET in this task: observed rate ≤ target for every event in the last 7 days with ≥ 1 event; otherwise false); **Acceptable false interruptions** `[10] %` + Save with the helper sentence from spec §5.4; **Agents denied far more than chance explains** list with per-row Reset; **What your verdicts taught it** table (30 rows, columns: when · risk · verdict wording "approved — we should not have asked" / "approved" / "denied" · Source: Approval / Warn review · threshold before→after); **Forget everything it learned** (existing reset_state confirm).
- Anchor: wrapper `id="calibration"`; scroll into view on mount when `location.hash === '#calibration'`.

- [ ] Steps: port + tests (renders "Pausing above risk" and never the string "θ"; not-ready sentence shows live/retro counts; relief button POSTs `{mode:'relief'}`; `active` disabled when `active_eligible:false`) → PASS → `git commit -m "feat(policies): calibration section (merged controller UI, plain-language labels)"`.

---

### Task B5: `PolicyWorkbench` assembly, Ledger rename, deletions

**Files:**
- Modify: `app/policies/components/PolicyWorkbench.tsx`, `app/policies/page.tsx` (subtitle), `app/policies/components/Ledger.tsx` (default lens; Tier column; header test button; empty state; inert struck-through rows), `app/policies/components/PolicyAuthoringPanel.tsx`/`PolicyRuleBuilderSection.tsx` (a **"Interrupts unattended runs (Short List)"** checkbox that sets `rules.short_list = true`, plus an **Ungrantable** checkbox shown only when short_list is checked; Generate-with-AI lives inside this editor as a tab/button), `app/policies/components/GeneratePanel.tsx` (opened from the editor), `app/policies/components/PolicyAdvancedImportPanel.tsx` (opened from the Packs menu)
- Delete: `app/policies/components/PresetsShields.tsx`, `app/policies/components/ModeDrawer.tsx`, `app/policies/components/GlossaryStrip.tsx`, `__tests__/unit/mode-drawer.test.tsx`; keep `app/policies/lib/shields.js` and `modesClient.ts` only if imported elsewhere (grep; delete if orphaned — `importMode` API route stays).
- Test: `__tests__/unit/policy-workbench-layout.test.tsx`; keep `policy-prefill.test.jsx` green (prefill now also accepts `short_list`).

**Layout (spec §4, mock §6.1), top to bottom:** `PageLayout` subtitle "A short list of things that stop your agent. Everything else is watched and measured." → top row: **Add a rule** (primary; opens the editor; Generate with AI inside), **Packs** (dropdown: Browse packs → `/policies/packs`; Import pack / YAML → `openImport()`), **Export proof** → inert alert row (B3) → two stat cards (B3) → `ApprovalPausePanel` → `ShortListSection` (B1; `onPickFromDecisions` → `openNewRule({ short_list: true })`) → `TriageInbox` (B2; wrapper `id="needs-your-call"`) → `CalibrationSection` (B4, expanded, `id="calibration"`) → `CollapsibleSection id="policies.ledger"` titled "Everything else — watched, recorded, not interrupting" with header action **Test rules against past actions** (`runTests()`), `count = summary.enforcement.total - summary.shortList.length`, collapsed by default, `keepMounted`; Ledger default lens = `sentences` when rule count < 10 else `table`; Table gains column **Tier** (Short List / Watch via `isShortListLine`); ledger empty state at ≤ 3 rules: "Start from a pack instead of a blank rule" + link `/policies/packs`; inert non-short-list rules struck-through with the grant name → `CollapsibleSection id="policies.external"` "Outside decision provider" (existing copy) last. Remove `GlossaryStrip`, `PresetsShields`, the "Your agents run unchecked until you apply a mode" copy, the `ModeDrawer` import. Pack-install banner (PackGallery) says "Installed {imported} rules in Watch. They record and feed calibration; none of them can interrupt until you promote them." using the `watched` count from A5.

- [ ] Steps: tests (section order by heading text; exactly three top buttons; no "Glossary"; ledger collapsed by default; Packs menu has both entries) → implement → PASS → `npx next build` → `git commit -m "feat(policies): workbench rebuilt around the Short List; modes/shields/glossary removed"`.

---

### Task B6: Delete `/calibration` page; redirect; nav; smoke list

**Files:**
- Delete: `app/calibration/page.jsx` (and the `app/calibration/` dir if empty)
- Modify: `next.config.js:55-79` redirects → add `{ source: '/calibration', destination: '/policies#calibration', permanent: true }`; `app/components/Sidebar.tsx:38` → `{ href: '/policies#calibration', icon: Crosshair, label: 'Tuning' }`; `tests/smoke/pages.js:58` → `{ path: '/policies#calibration', label: 'Calibration (section)' }` or drop the row if the smoke runner can't hash; `contracts/surface-budget.json` appPages 54 → **53**; `app/page.tsx:113-118` href → `/policies#calibration`.
- Test: `npm run surface:check` passes at 53; `__tests__/unit/sidebar*.test.*` if present.

- [ ] Steps: edit → `npm run surface:check` → `npx next build` → `git commit -m "chore(surface): /calibration folded into /policies#calibration (pages 54 → 53)"`.

---

### Task B7: `/connect` receipt card, `/setup` line, decisions context-menu action

**Files:**
- Modify: `app/connect/page.tsx:650-667` and `:773-792` (replace both "Pick your rules" cards), `app/setup/page.tsx:496-499` (one line: "Your Short List is live — review it on /policies. Add a pack when you want more than catastrophe coverage; pack rules start in Watch."), `app/components/context-menu/actionRegistry.tsx:137-173` (`decisionActions` += `{ id:'never-unattended', label:'Never let this happen unattended', icon: ShieldAlert, run: (ctx) => router push /policies?prefill=<encoded> }` where prefill = `{ policy_type:'require_approval', rules:{ action:'require_approval', action_types:[ctx.action_type], target_prefix: ctx.target_prefix ?? undefined, short_list:true }, name:'Hold ' + ctx.action_type + (target? ' on '+target:'') }` — reuse the existing prefill encoder used by `policy-prefill.test.jsx`)
- Create: `app/connect/ShortListReceipt.tsx` (client; fetches `/api/policies/summary`; renders "Your Short List is live" + the four lines read-only with tier chips + "One of these refuses outright. Two hold for your approval. Everything else runs and is recorded." + **Review the Short List** → `/policies` + demoted line "Add a pack when you want more than catastrophe coverage. Pack rules start in Watch." → `/policies/packs`; when `shortList` is empty it renders the Install card copy from B1 with the Install button)
- Test: `__tests__/unit/short-list-receipt.test.tsx`; `__tests__/unit/context-menu-coverage.test.tsx` (add the new action).

- [ ] Steps: tests → implement → PASS → `git commit -m "feat(connect): Short List receipt replaces 'pick your rules'; 'Never let this happen unattended' on decisions"`.

---

## Phase C — Docs, budget, marketing, ship

### Task C1: Documentation and contract sweep (model: sonnet)

**Files:** `THESIS.md:263-276` (pages 54→53 + date; amendment log entry at `:282` with the spec's wording "2026-08-20: 54 → 53 … First entry in this log that moves a ceiling down."), `PROJECT_DETAILS.md:56,58,93` (fold the Calibration row into Policies; "Backs /policies#calibration"), `README.md:257` (link → `/policies#calibration`), `docs/architecture/governance-core-theory.md:221,255,684-685` (paths) + a "UI label ↔ symbol" table after the §"what's implemented" table (θ → "Pausing above risk", α → "Acceptable false interruptions", adjudication → "Verdict from you", relief → "Fewer interruptions", active → "Fewer and more", reliefCeiling → "the riskiest action you approved"), `app/page.tsx:109-118` landing copy (Policies card: "A short list of things that stop your agent — at most ten lines — and everything else watched and measured. Catastrophe-only by default." / Calibration card title "Fewer interruptions, earned": "Starts in preview on day one. Learns from your verdicts — including one-click retrospective calls on things that never interrupted you — and only gets quieter until you say otherwise."; proof-point section `:404-430` keep, drop the θ glyph from copy), `HUMAN-EXPERIENCE.md` (no change unless it names /calibration), `CHANGELOG.md` `[Unreleased]` entry (Added: the Short List, force-push hold, retro verdicts, misfire card; Changed: /calibration → /policies#calibration, Watch tier default, shadow default; Removed: modes/shields/glossary UI), `docs/maintainer-log.md` entry "2026-08-20 — The Short List" (tournament ranking, the three decisions, the deviation "no Undo seed"), `docs/superpowers/specs/...redesign.md` status line → "implemented in vX.Y.Z".
- [ ] Run `npm run doc:counts` (expect no drift; if route/page counts are cited anywhere they self-derive) and `npm run guide:drift:check`. Commit `docs: the Short List — thesis table, theory label map, landing copy, changelog`.

### Task C2: Gates, rendered proof, ship

- [ ] `npm run lint` · `npm run typecheck` · `npx vitest run --maxWorkers=2` (FULL suite; read failures) · `npx next build` · `npm run surface:check` · `npm run route-sql:check` · `npm run openapi:check` (no route changes expected; if the summary/loosening response shapes are in the OpenAPI spec, regenerate per its script).
- [ ] Rendered proof (frontend-verify skill / headless): `/policies` shows the four tier chips and "4 of 10 lines"; Yes/No on a warn row POSTs `retro_*` and the calibration sentence's verdict count increments; a misfire row confirm writes `shape_exceptions` and the exception appears under the line with Undo; `/connect` renders the receipt; `/calibration` 308s to `/policies#calibration` and the section scrolls into view; sidebar "Tuning" lands there. Note results in the maintainer log.
- [ ] Ship via the `dashclaw-ship` skill (version bump — this is a minor: 5.27.0; SDKs unchanged → platform-only publish), then read remote CI.

---

## Self-review (done at plan time)

- **Spec coverage:** §2.1–2.2 → A4; §2.3 → A5; §2.4 → A5/B1; §2.5 → A6/B4; §2.6 → A8/B3; §3 steps 1–7 → A9/B7/B1/B2; §4.1–4.8 → B3/B1/B2/B4/B5; §5 → B4/B6; §7 → all; §8 invariants: 1 (no auto-apply — A6 route only writes adjudications, B4 relief is a click), 2 (seed only at birth — A9), 3/4 (pack unchanged in that respect — A4 tests `allows_normal_file_edit` stays), 5 (only seeded line 2 is ungrantable; real money suggested only — A8/B1), 6 (A5 transform on import + POST + PATCH), 7 (engine unchanged), 8 (A6), 9 (B3), 10 (forecast window — existing TriageInbox copy; B2 keeps it), 11 (B4 sentence), 12 (A9 doctor fix), 13 (C2). §9 decisions: 1 → A1/A2/A4; 2 → A8/B1; 3 → A6; 4 → A5/B1; 5 → B5.
- **Type consistency:** `isShortListLine` / `toWatchTier` / `SHORT_LIST_CAP` from A5 are used in A7, A8, B1, B5; `gitPushPredicateMatches`/`commandTextOf` from A1 used in A2; `ShortListLine` from A8 used in B1/B7; `retro_fine`/`retro_stop` verdict names in A6 and B2; `labeled_live`/`active_eligible` in A6/B4; `misfires` payload in A7/B2.
- **Placeholders:** none remain; UI tasks state copy, props, endpoints, and assertions.
