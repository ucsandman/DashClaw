# Governance Posture Score + Remediation Loop — Implementation Plan

> ⚠️ **SUPERSEDED (2026-06-12).** This plan is stale relative to `main` @ v4.17.1 — much of Tasks 8–20 shipped in later 4.x releases. **Do not execute from this document.** The audited re-baseline (per-task dispositions + the only remaining executable backlog) lives at `docs/plans/2026-06-12-posture-score-rebaseline.md`. The spec (`docs/superpowers/specs/2026-06-05-governance-posture-score-design.md`) remains the design source of truth.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a gaming-resistant org-wide governance posture score (0–100) with a prioritized, human-gated remediation loop, surfaced via `/posture` page + `/api/posture` + CLI + MCP.

**Architecture:** A pure, deterministic score engine (`app/lib/posture/`) computes risk-weighted *proven* coverage over governable units (capabilities + observed action types), presents it across six dimensions, and adjusts for live behavioral signal with hard incident caps. Findings derived from gaps become inactive policy *drafts* on resolve — a human activates enforcement; the score only rises once a policy is active and proven to fire. Built by aggregating existing primitives (doctor scan engine, Policy Coach analyzer/simulator, guard policy types, action/decision ledgers).

**Tech Stack:** TypeScript (strict), Next.js App Router, Drizzle/raw-SQL repositories, Vitest, the existing guard/simulator evaluator, MCP server, `dashclaw` CLI.

**Source spec:** `docs/superpowers/specs/2026-06-05-governance-posture-score-design.md` (read it first).

---

## ⚠️ Execution preconditions (read before starting)

1. **The JS→TS migration on `refactor/typescript-migration` must have landed.** This plan adds new TS modules that import existing ones (the guard/simulator evaluator, repositories, route auth wrapper, MCP/CLI registration). Those modules' exact paths/extensions and signatures are in flux during the migration — start only once they're stable.
2. **Phase 1 is fully concrete** (pure model code + tests). **Phases 2–5 specify files, interfaces, test intentions, verification commands, and the live file to pattern-match** — fill the framework-coupled scaffolding code against the *then-current* conventions, because hardcoding it now would be stale and unverifiable. This is deliberate, not a placeholder gap.
3. **Confirm at start (5-min recon, the spec's open items):**
   - `app/lib/behavior/` simulator/policy-model export names + signature for "replay an action through candidate/active policies" → this becomes the `replay` function injected into the engine.
   - The route auth/org-context wrapper used by `app/api/**/route.ts` (how `orgId` + the `sql` tag reach a handler).
   - The repository unit-test harness (the `sql` tagged-template mock) — mirror `__tests__` for `capabilities.repository`.
   - Whether new tables go in the Drizzle schema (`schema.*`) + a `drizzle/*.sql` migration (standard path) — the legacy `capabilities` table is raw-SQL-only; **new posture tables should follow the standard Drizzle+migration path**, not the legacy exception.

---

## File Structure

**Create (all TypeScript):**

| File | Responsibility |
|------|----------------|
| `app/lib/posture/types.ts` | Shared types: `Dimension`, `RiskLevel`, `GovernableUnit`, `CoverageResult`, `PostureScore`, `PostureFinding`, `PostureFix`. |
| `app/lib/posture/model.ts` | **Pure** score engine — weights, coverage grading, aggregation, dimension roll-up, behavioral adjustment, incident cap. No I/O. |
| `app/lib/posture/findings.ts` | **Pure** gap → prioritized `PostureFinding[]` (deterministic keys, ordering, fix payloads). No I/O. |
| `app/lib/posture/signals.ts` | I/O boundary — gathers units + coverage + behavioral signal from repositories/evaluator and feeds `model.ts`/`findings.ts`. |
| `app/lib/repositories/posture.repository.ts` | Reads for signals; reads/writes `posture_findings_state` + `posture_snapshots`; creates inactive policy drafts (reuse Policy Coach's insert-inactive path). |
| `app/api/posture/route.ts` | `GET` → score + dimension breakdown (+ optional snapshot write). |
| `app/api/posture/findings/route.ts` | `GET` → prioritized next-queue (filter by status/dimension). |
| `app/api/posture/findings/[key]/resolve/route.ts` | `POST` → `create_draft` \| `snooze` \| `accept_risk`. |
| `app/api/posture/scan/route.ts` | `POST` → recompute + persist a `posture_snapshots` row. |
| `app/posture/page.tsx` | Operator surface (token-first, dark, calm; honors `.impeccable.md`). |
| `drizzle/00XX_posture.sql` + schema entry | `posture_findings_state`, `posture_snapshots`. |

**Tests (mirror existing locations/conventions):**
- `__tests__/.../posture-model.test.ts` (pure, the bulk of value)
- `__tests__/.../posture-findings.test.ts`
- `__tests__/.../posture.repository.test.ts`
- `__tests__/.../api-posture.test.ts`

**Touch (later, at the §Phase-5 ship pass — not core):** docs surfaces, OpenAPI, api-inventory, SDK READMEs, PROJECT_DETAILS, version bump.

---

## Phase 1 — The score engine (pure, no UI, fully concrete)

> Prove the score can't be gamed before building any UX on it. Everything here is pure TS — no DB, no framework — so it is unit-testable in isolation and stable across the migration.

### Task 1: Types

**Files:**
- Create: `app/lib/posture/types.ts`

- [ ] **Step 1: Write the types**

```ts
export type Dimension =
  | 'identity' | 'enforcement' | 'spend' | 'auditability' | 'approval' | 'data_protection';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Decision = 'allow' | 'warn' | 'require_approval' | 'block';

export interface GovernableUnit {
  key: string;                 // capability slug, or `action_type:<type>`
  surfaceType: 'capability' | 'action_type';
  riskLevel: RiskLevel;        // capability.risk_level, or bucketed action_records.risk_score
  reversible: boolean;         // from action_records; default true when unknown
  hasSpendExposure: boolean;   // pricing_json non-empty | source_type external_marketplace | x402 provider
  requiresApproval: boolean;   // capability.requires_approval — DECLARED intent, not coverage
  observedCount: number;       // from action_records
  dimension: Dimension;        // primary dimension this unit maps to
}

export interface CoverageResult { grade: 0 | 0.5 | 1; hasFiringPolicy: boolean; infraOk: boolean; }

export interface Incident { unitKey: string; actionId: string; riskLevel: RiskLevel; ts: string; }

export interface Adjustments {
  incidents: Incident[];                 // ungoverned high-risk actions that fired (trailing window)
  approvalFollowThrough: number;         // 0..1 resolved/(resolved+abandoned); 1 when none
  coachOpenGapUnitKeys: string[];        // high-confidence un-adopted Policy Coach suggestions
}

export interface DimensionScore { dimension: Dimension; score: number; weight: number; }
export interface PostureScore {
  score: number;                         // 0-100, integer
  status: 'healthy' | 'needs_attention' | 'at_risk';
  dimensions: DimensionScore[];
  cappedBy: 'incident' | null;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/lib/posture/types.ts
git commit -m "feat(posture): add posture engine types"
```

### Task 2: Risk weighting (pure)

**Files:**
- Create: `app/lib/posture/model.ts`
- Test: `__tests__/unit/posture-model.test.ts` (mirror an existing `__tests__/unit/*.test.ts`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { riskFactor, bucketRiskScore, unitWeight } from '../../app/lib/posture/model';
import type { GovernableUnit } from '../../app/lib/posture/types';

const unit = (over: Partial<GovernableUnit> = {}): GovernableUnit => ({
  key: 'cap:deploy', surfaceType: 'capability', riskLevel: 'high', reversible: false,
  hasSpendExposure: false, requiresApproval: true, observedCount: 10, dimension: 'enforcement', ...over,
});

describe('risk weighting', () => {
  it('maps risk_level to escalating multipliers', () => {
    expect(riskFactor('low')).toBe(1);
    expect(riskFactor('medium')).toBe(3);
    expect(riskFactor('high')).toBe(8);
    expect(riskFactor('critical')).toBe(16);
  });
  it('buckets a numeric risk_score into the four tiers', () => {
    expect(bucketRiskScore(10)).toBe('low');
    expect(bucketRiskScore(40)).toBe('medium');
    expect(bucketRiskScore(60)).toBe('high');
    expect(bucketRiskScore(90)).toBe('critical');
  });
  it('dampens frequency (log) so frequency cannot dominate risk', () => {
    const rare = unitWeight(unit({ observedCount: 1 }));
    const frequent = unitWeight(unit({ observedCount: 1000 }));
    expect(frequent).toBeGreaterThan(rare);
    expect(frequent).toBeLessThan(rare * 5); // ~4x at most from 1→1000 via 1+log10
  });
  it('irreversible + spend exposure increase weight', () => {
    expect(unitWeight(unit({ reversible: true }))).toBeLessThan(unitWeight(unit({ reversible: false })));
    expect(unitWeight(unit({ hasSpendExposure: false })))
      .toBeLessThan(unitWeight(unit({ hasSpendExposure: true })));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/unit/posture-model.test.ts`
Expected: FAIL — `riskFactor is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/posture/model.ts
import type { RiskLevel, GovernableUnit } from './types';

const RISK_MULTIPLIER: Record<RiskLevel, number> = { low: 1, medium: 3, high: 8, critical: 16 };

export function riskFactor(level: RiskLevel): number { return RISK_MULTIPLIER[level]; }

export function bucketRiskScore(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function frequencyFactor(count: number): number {
  return 1 + Math.log10(1 + Math.max(0, count));
}

export function unitWeight(u: GovernableUnit): number {
  const reversibility = u.reversible ? 1 : 2;
  const spend = u.hasSpendExposure ? 2 : 1;
  return riskFactor(u.riskLevel) * reversibility * spend * frequencyFactor(u.observedCount);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/unit/posture-model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/posture/model.ts __tests__/unit/posture-model.test.ts
git commit -m "feat(posture): risk-weighted unit weighting"
```

### Task 3: Coverage grading (pure, evaluator injected)

**Files:**
- Modify: `app/lib/posture/model.ts`
- Test: `__tests__/unit/posture-model.test.ts`

The engine never calls the guard directly — it takes an injected `replay(unitKey) => Decision` (wired to the real shared evaluator in `signals.ts`) plus an `infraOk` predicate. This keeps grading pure and is the anti-gaming core: coverage requires a policy that *changes the decision*, not one that merely exists.

- [ ] **Step 1: Write the failing test**

```ts
import { gradeCoverage } from '../../app/lib/posture/model';

describe('coverage grading', () => {
  const u = unit(); // high-risk, requiresApproval
  it('a non-firing (allow) policy earns ZERO coverage — toothless/allow is not coverage', () => {
    expect(gradeCoverage(u, () => 'allow', () => true).grade).toBe(0);
  });
  it('warn that fires is partial; block/require_approval that fires is full', () => {
    expect(gradeCoverage(u, () => 'warn', () => true).grade).toBe(0.5);
    expect(gradeCoverage(u, () => 'require_approval', () => true).grade).toBe(1);
    expect(gradeCoverage(u, () => 'block', () => true).grade).toBe(1);
  });
  it('declared requires_approval is intent, not coverage — no firing policy ⇒ grade 0', () => {
    expect(gradeCoverage(unit({ requiresApproval: true }), () => 'allow', () => true).grade).toBe(0);
  });
  it('missing required infra caps grade even when a policy fires', () => {
    expect(gradeCoverage(u, () => 'block', () => false).grade).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/unit/posture-model.test.ts` → FAIL (`gradeCoverage` undefined).

- [ ] **Step 3: Implement**

```ts
// append to model.ts
import type { CoverageResult, Decision } from './types';

const GRADE: Record<Decision, 0 | 0.5 | 1> = { allow: 0, warn: 0.5, require_approval: 1, block: 1 };

export function gradeCoverage(
  u: GovernableUnit,
  replay: (unitKey: string) => Decision,
  infraOk: (u: GovernableUnit) => boolean,
): CoverageResult {
  const decision = replay(u.key);
  const baseGrade = GRADE[decision];
  const ok = infraOk(u);
  const grade = ok ? baseGrade : 0;
  return { grade, hasFiringPolicy: baseGrade > 0, infraOk: ok };
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(posture): proven-coverage grading with injected evaluator`.

### Task 4: Score aggregation + dimension roll-up (pure)

**Files:** Modify `app/lib/posture/model.ts`; Test same file.

- [ ] **Step 1: Failing test**

```ts
import { computeScore } from '../../app/lib/posture/model';

describe('score aggregation', () => {
  const units: GovernableUnit[] = [
    unit({ key: 'a', riskLevel: 'critical', dimension: 'enforcement' }),
    unit({ key: 'b', riskLevel: 'low', dimension: 'spend', observedCount: 1 }),
  ];
  const noAdj = { incidents: [], approvalFollowThrough: 1, coachOpenGapUnitKeys: [] };

  it('is risk-weighted: covering the critical unit scores far above covering the low one', () => {
    const coverCritical = computeScore(units, { a: 1, b: 0 }, noAdj).score;
    const coverLow = computeScore(units, { a: 0, b: 1 }, noAdj).score;
    expect(coverCritical).toBeGreaterThan(coverLow);
  });
  it('duplicate policies on one unit credit once (coverage is per-unit map)', () => {
    const once = computeScore(units, { a: 1, b: 1 }, noAdj).score;
    // a second policy on `a` cannot exceed grade 1 for that unit
    const dup = computeScore(units, { a: 1, b: 1 }, noAdj).score;
    expect(dup).toBe(once);
  });
  it('emits a 0-100 score and per-dimension breakdown', () => {
    const r = computeScore(units, { a: 1, b: 1 }, noAdj);
    expect(r.score).toBe(100);
    expect(r.dimensions.map((d) => d.dimension)).toEqual(
      expect.arrayContaining(['enforcement', 'spend']),
    );
  });
  it('is deterministic', () => {
    expect(computeScore(units, { a: 0.5, b: 1 }, noAdj))
      .toEqual(computeScore(units, { a: 0.5, b: 1 }, noAdj));
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**

```ts
// append to model.ts
import type { Adjustments, Dimension, DimensionScore, PostureScore } from './types';

const DIMENSIONS: Dimension[] = ['identity','enforcement','spend','auditability','approval','data_protection'];

export function computeScore(
  units: GovernableUnit[],
  coverageByKey: Record<string, number>, // unitKey -> grade 0..1 (per-unit, deduped by construction)
  adj: Adjustments,
): PostureScore {
  const byDim = new Map<Dimension, { covered: number; total: number }>();
  for (const d of DIMENSIONS) byDim.set(d, { covered: 0, total: 0 });

  for (const u of units) {
    const w = unitWeight(u);
    let grade = coverageByKey[u.key] ?? 0;
    if (adj.coachOpenGapUnitKeys.includes(u.key)) grade = Math.min(grade, 0.5); // observed uncovered risk
    const bucket = byDim.get(u.dimension)!;
    bucket.total += w;
    bucket.covered += grade * w;
  }

  const dimensions: DimensionScore[] = DIMENSIONS.map((d) => {
    const { covered, total } = byDim.get(d)!;
    return { dimension: d, score: total === 0 ? 100 : Math.round((covered / total) * 100), weight: total };
  });

  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const rawCovered = DIMENSIONS.reduce((s, d) => s + byDim.get(d)!.covered, 0);
  let score = totalWeight === 0 ? 100 : Math.round((rawCovered / totalWeight) * 100);

  // approval follow-through nudges the approval dimension's contribution
  score = Math.round(score * (0.9 + 0.1 * clamp01(adj.approvalFollowThrough)));

  const capped = applyIncidentCap(score, adj);
  const status: PostureScore['status'] =
    capped.score >= 85 ? 'healthy' : capped.score >= 60 ? 'needs_attention' : 'at_risk';
  return { score: capped.score, status, dimensions, cappedBy: capped.cappedBy };
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

export function applyIncidentCap(score: number, adj: Adjustments): { score: number; cappedBy: 'incident' | null } {
  const hasHighIncident = adj.incidents.some((i) => i.riskLevel === 'high' || i.riskLevel === 'critical');
  if (hasHighIncident) return { score: Math.min(score, 60), cappedBy: 'incident' };
  return { score, cappedBy: null };
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(posture): risk-weighted score + dimension roll-up`.

### Task 5: Incident cap + anti-gaming property suite

**Files:** Test `__tests__/unit/posture-model.test.ts` (add the §4.4 properties as explicit tests).

- [ ] **Step 1: Write the anti-gaming tests** (each maps to a row of spec §4.4)

```ts
describe('anti-gaming properties (spec §4.4)', () => {
  const noAdj = { incidents: [], approvalFollowThrough: 1, coachOpenGapUnitKeys: [] };
  const crit = unit({ key: 'x', riskLevel: 'critical', dimension: 'enforcement', observedCount: 50 });

  it('toothless allow policy → 0 gain', () => {
    const grade = gradeCoverage(crit, () => 'allow', () => true).grade;
    expect(computeScore([crit], { x: grade }, noAdj).score).toBe(0);
  });
  it('low-traffic gaming is negligible vs the real risk mass', () => {
    const real = unit({ key: 'r', riskLevel: 'critical', observedCount: 500, dimension: 'enforcement' });
    const decoy = unit({ key: 'd', riskLevel: 'low', observedCount: 0, dimension: 'enforcement' });
    const gamed = computeScore([real, decoy], { r: 0, d: 1 }, noAdj).score;
    expect(gamed).toBeLessThan(15);
  });
  it('cannot sit high while leaking: an ungoverned high-risk incident caps the score ≤ 60', () => {
    const adj = { incidents: [{ unitKey: 'x', actionId: 'act_1', riskLevel: 'high' as const, ts: 't' }],
      approvalFollowThrough: 1, coachOpenGapUnitKeys: [] };
    expect(computeScore([crit], { x: 1 }, adj).cappedBy).toBe('incident');
    expect(computeScore([crit], { x: 1 }, adj).score).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run __tests__/unit/posture-model.test.ts` → PASS (cap logic already implemented in Task 4; if any property fails, fix `model.ts` until all pass).
- [ ] **Step 3: Commit** — `test(posture): anti-gaming property suite`.

### Task 6: Findings derivation (pure)

**Files:** Create `app/lib/posture/findings.ts`; Test `__tests__/unit/posture-findings.test.ts`.

- [ ] **Step 1: Failing test** — assert: deterministic `key` (stable across runs for same gap); ordering by `scoreDelta` desc then severity; a `requires_approval` capability with no firing policy yields a `create_policy_draft` fix; coverage==1 units produce no finding.

```ts
import { deriveFindings } from '../../app/lib/posture/findings';
// build units + coverageByKey, assert findings[0].key is stable and fix.type === 'create_policy_draft', etc.
```

- [ ] **Step 2–4:** Implement `deriveFindings(units, coverageByKey, adj): PostureFinding[]`:
  - finding only for `grade < 1` units (and for each incident / coach gap).
  - `key = stableHash(dimension + ':' + unit.key + ':' + fixType)` (use a deterministic hash; **no `Date.now()`/random** — the key must be reproducible, like Policy Coach suggestion ids).
  - `scoreDelta` = points recovered if grade→1 (recompute marginal contribution via `unitWeight`/total).
  - `severity` from recoverable weight + incident status.
  - `fix`: capability/action gap → `create_policy_draft` (policyType + rules prefilled, e.g. `risk_threshold` or `protected_path` or `x402_spend_limit`); unbound identity → `bind_identity`; redaction/approval-channel → `enable_setting`; incident → `review_incident`; coach gap → `adopt_coach_suggestion`.
  - sort by `scoreDelta` desc, tie-break severity rank, tie-break `observedCount` desc.
- [ ] **Step 5: Commit** — `feat(posture): deterministic findings derivation`.

### Task 7: Signals (I/O boundary) + `GET /api/posture`

**Files:** Create `app/lib/posture/signals.ts`, `app/lib/repositories/posture.repository.ts`, `app/api/posture/route.ts`; Test `__tests__/.../posture.repository.test.ts`, `__tests__/.../api-posture.test.ts`.

> **Scaffolding phase — fill against live conventions confirmed in precondition #3.** Pattern-match `app/lib/repositories/capabilities.repository.ts` (raw-SQL `sql: SqlTag`, shape fns) and an existing `app/api/**/route.ts` (org/auth wrapper).

- [ ] **Step 1:** Repo reads (mirror capabilities.repository test harness): `getCapabilityUnits(sql, orgId)`, `getObservedActionUnits(sql, orgId)`, `getActivePolicies(sql, orgId)`, `getRecentDecisions(sql, orgId, sinceTs)`, `getIdentityBoundAgents(sql, orgId)`, `getX402SpendSurfaces(sql, orgId)` (reuse `x402.repository.ts`/`finops.repository.ts`). Write tests against the mock `sql` first.
- [ ] **Step 2:** `signals.ts`: `buildUnits(...)` (merge capability + observed-action units, dedupe by key, fill `GovernableUnit`); `buildReplay(activePolicies)` → wraps the **shared evaluator** (confirmed in precondition #3) into `(unitKey) => Decision`; `buildAdjustments(decisions, approvals, coach)`. Assemble and call `computeScore` + `deriveFindings`.
- [ ] **Step 3:** `GET /api/posture` route → `{ score, status, dimensions, summary, snapshotTs }`. Test the route returns the engine output shape; assert **no direct SQL in the route** (`npm run route-sql:check`).
- [ ] **Step 4:** Run `npx vitest run` (targeted files), then full `npx vitest run`.
- [ ] **Step 5: Commit** — `feat(posture): signals + GET /api/posture`.

**Phase 1 gate:** `npm run lint && npx vitest run && npx next build && npm run route-sql:check` all green.

---

## Phase 2 — Findings + loop API + storage

> Scaffolding phase. Concrete on files/interfaces/tests/verify; fill handler/repo bodies against live conventions.

- [ ] **Task 8 — Migration + schema.** Add `posture_findings_state(org_id, finding_key, status, note, actor, created_at, updated_at, PK(org_id,finding_key))` and `posture_snapshots(id, org_id, score numeric, dimensions jsonb, created_at)` to the Drizzle schema **and** `drizzle/00XX_posture.sql` (next number). **Do not run** until execution time; then `npm run db:migrate`. Test: a repo round-trip against the mock `sql`. Coerce `Number(score)` on read (Neon returns numeric as string). Commit.
- [ ] **Task 9 — Finding-state repo.** `getFindingState(sql, orgId, key)`, `setFindingState(sql, orgId, key, status, actor, note)`, `listFindingStates(sql, orgId)`, `insertSnapshot(sql, orgId, score, dimensions)`, `listSnapshots(sql, orgId, limit)`. Merge stored state onto derived findings in `signals.ts` (a `resolved`/`snoozed`/`accepted_risk` finding drops from the open queue). Tests for the merge (a snoozed key never appears as `open`). Commit.
- [ ] **Task 10 — `GET /api/posture/findings`.** Returns prioritized open findings; `?status=`/`?dimension=` filters; includes the "risk accepted" set when asked. Test shapes. Commit.
- [ ] **Task 11 — `POST /api/posture/findings/[key]/resolve`.** Body `{ action: 'create_draft'|'snooze'|'accept_risk', note? }`. `create_draft` → insert an **inactive** `guard_policies` row via the **existing Policy-Coach insert-inactive path** and set finding state `drafted` (NOT `resolved`). **Critical test:** after `create_draft`, the score from `GET /api/posture` is **unchanged** (drafting ≠ coverage); only activating the policy (separately, at `/policies`) and rescanning raises it. `snooze`/`accept_risk` persist state + actor + note. Commit.
- [ ] **Task 12 — `POST /api/posture/scan`.** Recompute + `insertSnapshot`. Test it writes one row and returns the score. Commit.

**Phase 2 gate:** full `npx vitest run` + `npx next build` + `route-sql:check` green.

---

## Phase 3 — `/posture` page

> UI phase. **Read `.impeccable.md` first.** Token-first (no hardcoded hex — use `app/globals.css` tokens / Tailwind theme), dark-only, orange as signal only, calm-under-pressure, `lucide-react`, `.tabular-nums` on numbers, tiny uppercase mono meta-labels. Hold against the four anti-references. Page is `.tsx` (parses under the TS/Vitest loader — supersedes the old "pages must be .jsx" note now that the loader is TS).

- [ ] **Task 13 — Page shell + data load.** `app/posture/page.tsx` fetches `/api/posture` + `/api/posture/findings`. Render the score hero (big tabular number + status word + 30-day sparkline from snapshots + "X points recoverable"). Component test (mirror an existing page test) asserting score + status render. Commit.
- [ ] **Task 14 — Dimension row.** Six dimension cards (0–100 + tiny bar); orange tick only on dimensions needing attention (signal-not-noise). Test: a weak dimension gets the attention treatment, a strong one does not. Commit.
- [ ] **Task 15 — Next queue + resolve flow.** Ordered findings list (severity chip, title, `+Δ`, evidence count, "Review fix →"). "Review fix" opens a draft preview reusing the Policy-Coach simulate summary, then "Create draft" → `POST .../resolve`. Collapsed "Risk accepted" section below. Test: list order matches `scoreDelta`; resolve calls the endpoint; **the on-page score does not move on draft creation** (mirrors the Phase-2 honesty property in the UI). Commit.

**Phase 3 gate:** full `npx vitest run` + `npx next build` green.

---

## Phase 4 — CLI + MCP

> Scaffolding phase. Pattern-match an existing CLI command and an existing MCP tool registration (confirm exact registration site at execution time).

- [ ] **Task 16 — CLI.** `dashclaw posture` (score + dimensions + top findings), `dashclaw next` (single top open finding + its fix instruction), `dashclaw posture resolve <key>` (**draft-only**). Mirror an existing `cli/` command + its test. Commit.
- [ ] **Task 17 — MCP.** `dashclaw_posture` (score+breakdown+findings) and `dashclaw_posture_next` (top finding). Resolve via MCP is **draft-only** — an agent can prepare a fix but can never self-activate enforcement (matches the consumer-connector ban). Mirror an existing MCP tool + its test. Commit.

**Phase 4 gate:** full `npx vitest run` green.

---

## Phase 5 — Ship pass (post-merge accuracy + release)

> Use the `dashclaw-ship` skill — this is the publish tail, not optional (it's a recurring lesson). New routes + new SDK/MCP/CLI surfaces touch many derived docs.

- [ ] **Task 18 — Derived artifacts.** `npm run openapi:generate`, `npm run api:inventory:generate`, livingcode refresh (pre-commit hook regenerates; verify with `openapi:check` + `api:inventory:check`). Commit.
- [ ] **Task 19 — Hand-authored docs.** Per the SDK Documentation Checklist: `app/docs/page.js→.tsx`(if migrated), `sdk/README.md`, `sdk-python/README.md`, `docs/sdk-parity.md`, `docs/api-inventory.md`, `PROJECT_DETAILS.md` — add the posture routes + (if SDK methods added) reconcile counts via `npm run sdk:count`. Commit.
- [ ] **Task 20 — Version bump + release.** `npm run version:set <x.y.z>` (platform + both SDKs in lockstep) → `npm install` (sync lockfile) → `npm run version:sync:check`. Owner publishes with `npm run release:sdks`. Commit.

**Final gate:** `npm run lint && npx vitest run && npx next build && npm run route-sql:check && npm run openapi:check && npm run api:inventory:check && npm run version:check` — all green, READ the output.

---

## Self-Review (run against the spec)

- **Spec coverage:** §4 engine → Tasks 2–5; §5 findings/loop → Tasks 6, 10–12; §6 architecture/files → Tasks 1, 7–12; §6.1 storage → Task 8; §7 UI → Tasks 13–15; CLI/MCP → Tasks 16–17; §8 phasing → phase structure; §9 testing → tests in every task + gates; §10 reuse → preconditions + Task 7. No uncovered spec section.
- **Honesty property is tested in 3 places** (Phase-2 Task 11 API, Phase-3 Task 15 UI, and the engine's `gradeCoverage`): drafting never raises the score; only an active, proven-firing policy does.
- **Determinism / stable keys** asserted in Tasks 4 and 6 (no `Date.now()`/random in `model.ts`/`findings.ts`).
- **Deliberate detail split:** Phase 1 is full concrete code (pure, stable). Phases 2–5 specify files/interfaces/tests/verify + the live file to mirror, with scaffolding bodies filled at execution time — because route/repo/MCP/CLI conventions are mid-migration and hardcoding them now would be stale and unverifiable. This is an intentional, flagged decision, not a placeholder omission.
