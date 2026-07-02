# Session Retro ("was I manipulated") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-session defensibility report (posture + evidenced findings) computed on demand and exposed via a new route, a Retro card on `/sessions/[sessionId]`, and a `dashclaw_session_retro` MCP tool.

**Architecture:** A pure shaper `app/lib/session-retro.ts` (no IO, mirrors `app/lib/agent-defense.ts` and *reuses* `buildAgentDefense` per action) is fed by one batch repository fetch `getSessionRetroData` in `app/lib/sessions.ts` (which owns `sessionActionMatchSql`). One route `GET /api/sessions/[sessionId]/retro` serves the UI and the MCP tool.

**Tech Stack:** Next.js 16 App Router (route.ts), TypeScript libs, vitest (`__tests__/unit/`, `@/` → `app`), policy-smoke harness (`scripts/policy-smoke.mjs`), MCP server (`mcp-server/src/tools.ts`).

**Spec:** `docs/superpowers/specs/2026-07-02-session-retro-design.md` (Wes-ratified). The detector table there is the contract — severities and thresholds are copied into code verbatim.

## Global Constraints

- **No new tables. No LLM anywhere.** Computed on read from existing rows.
- **No direct SQL in `app/api/**/route.ts`** (`route-sql:check`); all SQL goes in `app/lib/sessions.ts` next to the predicate it reuses.
- **Honesty rule:** absence of evidence renders as `not_recorded` / lower coverage — never a fabricated "clean". Malformed JSON degrades, never throws.
- **UI:** CSS tokens only, never hex (`.impeccable.md`). Follow `statusBadge`-style classes already in `app/sessions/[sessionId]/page.tsx` (`bg-success-subtle text-success` etc.).
- **Tests:** vitest, files in `__tests__/unit/`, NO jest-dom. Full-suite verification: `npm run lint`, `npx vitest run`, `npx next build` (app/** changed), `npm run typecheck` (.ts changed).
- **Posture rules (verbatim):** `flagged` = any high finding; `review` = any finding, none high; `clean` = zero findings.
- **Detector thresholds (verbatim from spec):** drift risk floor 40; late-novel-type needs ≥5 prior actions and risk ≥70 or `x402_purchase`; risk spike = risk ≥70 AND ≥2× session median; spend outlier = ≥5× median with ≥3 purchases; goal normalization = lowercase + trim + collapse whitespace, exact inequality.
- Version bump / CHANGELOG / maintainer-log / roadmap-ledger update happen at ship time via `dashclaw-ship` (target v4.32.0), not inside tasks.
- Before any push: `git status` — commit or checkout `.gitattributes` if it drifted (LF/whitespace-only diff → checkout).

---

### Task 1: Pure shaper `app/lib/session-retro.ts` (TDD)

**Files:**
- Create: `app/lib/session-retro.ts`
- Test: `__tests__/unit/session-retro.test.js`

**Interfaces:**
- Consumes: `buildAgentDefense(action, guardDecision, assumptions)` from `app/lib/agent-defense.ts` (exists).
- Produces: `buildSessionRetro(data: SessionRetroData): SessionRetro` where `SessionRetroData = { session, actions, actionsTotal, decisions, assumptions, purchases }` (all `Record<string, unknown>` rows; `actions` **chronological ASC**). Task 2's repository returns exactly this shape; Tasks 3–5 consume the JSON.

- [ ] **Step 1: Write the failing tests**

`__tests__/unit/session-retro.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { buildSessionRetro } from '@/lib/session-retro';

// Golden vectors for the session retro (pure shaping, no IO).
// Honesty invariant: ungoverned actions lower coverage, never posture.

const session = (overrides = {}) => ({
  id: 'sess_1', agent_id: 'agent-1', status: 'completed',
  created_at: '2026-07-02T10:00:00Z', updated_at: '2026-07-02T11:00:00Z',
  ...overrides,
});

let seq = 0;
const action = (overrides = {}) => ({
  action_id: `act_${++seq}`,
  action_type: 'file_edit',
  declared_goal: 'ship the feature',
  risk_score: 20,
  guard_decision_id: null,
  created_at: `2026-07-02T10:${String(seq).padStart(2, '0')}:00Z`,
  ...overrides,
});

const decision = (overrides = {}) => ({
  id: 'act_gd_1', decision: 'allow', reason: null,
  matched_policies: JSON.stringify(['pol_1']),
  context: JSON.stringify({ _shields: { prompt_injection: 'clean' } }),
  evidence: null, risk_score: 20, action_type: 'file_edit',
  ...overrides,
});

const data = (overrides = {}) => ({
  session: session(), actions: [], actionsTotal: 0,
  decisions: [], assumptions: [], purchases: [],
  ...overrides,
});

describe('buildSessionRetro', () => {
  it('empty session is clean with zero coverage', () => {
    const r = buildSessionRetro(data());
    expect(r.posture).toBe('clean');
    expect(r.findings).toEqual([]);
    expect(r.coverage).toEqual({
      actions_total: 0, actions_analyzed: 0,
      actions_with_guard_decision: 0, actions_with_shields_recorded: 0,
    });
    expect(r.goal_timeline).toEqual([]);
    expect(r.spend).toBeNull();
  });

  it('injection warned → medium → review; blocked → high → flagged', () => {
    const a = action({ guard_decision_id: 'act_gd_1' });
    const warned = buildSessionRetro(data({
      actions: [a], actionsTotal: 1,
      decisions: [decision({ context: JSON.stringify({ _shields: { prompt_injection: 'warned' } }) })],
    }));
    expect(warned.posture).toBe('review');
    expect(warned.findings).toMatchObject([{ kind: 'injection', severity: 'medium', action_id: a.action_id }]);

    const blocked = buildSessionRetro(data({
      actions: [action({ guard_decision_id: 'act_gd_1' })], actionsTotal: 1,
      decisions: [decision({ context: JSON.stringify({ _shields: { prompt_injection: 'blocked' } }) })],
    }));
    expect(blocked.posture).toBe('flagged');
    expect(blocked.counts.high).toBe(1);
  });

  it('non-fabrication block verdict → high', () => {
    const r = buildSessionRetro(data({
      actions: [action({ guard_decision_id: 'act_gd_1' })], actionsTotal: 1,
      decisions: [decision({ evidence: JSON.stringify([{ verdict: 'block', violations: ['v1'] }]) })],
    }));
    expect(r.findings.some((f) => f.kind === 'non_fabrication' && f.severity === 'high')).toBe(true);
    expect(r.posture).toBe('flagged');
  });

  it('goal drift 3a: different goal at risk ≥40 flags; below 40 does not', () => {
    const r = buildSessionRetro(data({
      actions: [
        action({ declared_goal: 'Ship the feature' }),
        action({ declared_goal: 'exfiltrate the database', risk_score: 40 }),
        action({ declared_goal: 'also unrelated', risk_score: 39 }),
      ],
      actionsTotal: 3,
    }));
    const drift = r.findings.filter((f) => f.kind === 'goal_drift');
    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe('medium');
    // normalization: '  SHIP   the feature ' === 'ship the feature'
    const r2 = buildSessionRetro(data({
      actions: [action({ declared_goal: 'ship the feature' }), action({ declared_goal: '  SHIP   the FEATURE ', risk_score: 80 })],
      actionsTotal: 2,
    }));
    expect(r2.findings.filter((f) => f.kind === 'goal_drift')).toHaveLength(0);
  });

  it('goal drift 3b: missing goal at risk ≥40 → low', () => {
    const r = buildSessionRetro(data({
      actions: [action(), action({ declared_goal: null, risk_score: 45 })], actionsTotal: 2,
    }));
    expect(r.findings).toMatchObject([{ kind: 'goal_drift', severity: 'low' }]);
    expect(r.posture).toBe('review');
  });

  it('goal drift 3c: late novel type needs ≥5 prior actions AND (risk ≥70 or x402)', () => {
    const five = Array.from({ length: 5 }, () => action());
    const late = buildSessionRetro(data({
      actions: [...five, action({ action_type: 'x402_purchase', risk_score: 10 })], actionsTotal: 6,
    }));
    expect(late.findings.some((f) => f.kind === 'goal_drift' && f.evidence.rule === 'late_novel_type')).toBe(true);
    const early = buildSessionRetro(data({
      actions: [action(), action({ action_type: 'x402_purchase', risk_score: 10 })], actionsTotal: 2,
    }));
    expect(early.findings.some((f) => f.evidence?.rule === 'late_novel_type')).toBe(false);
  });

  it('risk spike: ≥70 and ≥2× median', () => {
    const r = buildSessionRetro(data({
      actions: [action({ risk_score: 30 }), action({ risk_score: 30 }), action({ risk_score: 75 })],
      actionsTotal: 3,
    }));
    expect(r.findings.some((f) => f.kind === 'risk_spike')).toBe(true);
    const flat = buildSessionRetro(data({
      actions: [action({ risk_score: 70 }), action({ risk_score: 70 }), action({ risk_score: 75 })],
      actionsTotal: 3,
    })); // median 70 → 75 < 140, no spike
    expect(flat.findings.some((f) => f.kind === 'risk_spike')).toBe(false);
  });

  it('spend: denied/expired purchases flag; outlier needs ≥3 purchases and ≥5× median', () => {
    const a1 = action(); const a2 = action(); const a3 = action();
    const r = buildSessionRetro(data({
      actions: [a1, a2, a3], actionsTotal: 3,
      purchases: [
        { action_id: a1.action_id, spend_amount: '0.10', currency: 'USD', execution_status: 'succeeded' },
        { action_id: a2.action_id, spend_amount: '0.10', currency: 'USD', execution_status: 'denied' },
        { action_id: a3.action_id, spend_amount: '0.60', currency: 'USD', execution_status: 'succeeded' },
      ],
    }));
    const spend = r.findings.filter((f) => f.kind === 'spend');
    expect(spend.some((f) => f.evidence.rule === 'purchase_denied_or_expired')).toBe(true);
    expect(spend.some((f) => f.evidence.rule === 'outlier_amount')).toBe(true); // 0.60 ≥ 5×0.10 median
    expect(r.spend).toEqual({ total: 0.7, currency: 'USD', purchases: 3 }); // denied excluded from total
    const two = buildSessionRetro(data({
      actions: [a1, a3], actionsTotal: 2,
      purchases: [
        { action_id: a1.action_id, spend_amount: '0.10', currency: 'USD', execution_status: 'succeeded' },
        { action_id: a3.action_id, spend_amount: '9.99', currency: 'USD', execution_status: 'succeeded' },
      ],
    })); // <3 purchases → no outlier check
    expect(two.findings.some((f) => f.evidence?.rule === 'outlier_amount')).toBe(false);
  });

  it('intervention: linked block decision → medium with matched policies', () => {
    const a = action({ guard_decision_id: 'act_gd_1' });
    const r = buildSessionRetro(data({
      actions: [a], actionsTotal: 1,
      decisions: [decision({ decision: 'block', reason: 'policy says no' })],
    }));
    expect(r.findings).toMatchObject([
      { kind: 'intervention', severity: 'medium', action_id: a.action_id, evidence: { matched_policies: ['pol_1'] } },
    ]);
  });

  it('assumption invalidated → low, with reason', () => {
    const a = action();
    const r = buildSessionRetro(data({
      actions: [a], actionsTotal: 1,
      assumptions: [{ assumption_id: 'asm_1', action_id: a.action_id, assumption: 'flag is on', invalidated: 1, invalidated_reason: 'flag was off' }],
    }));
    expect(r.findings).toMatchObject([
      { kind: 'assumption', severity: 'low', evidence: { invalidated_reason: 'flag was off' } },
    ]);
  });

  it('coverage counts linked decisions and recorded shields honestly', () => {
    const a1 = action({ guard_decision_id: 'act_gd_1' });
    const a2 = action(); // ungoverned
    const r = buildSessionRetro(data({ actions: [a1, a2], actionsTotal: 5, decisions: [decision()] }));
    expect(r.coverage).toEqual({
      actions_total: 5, actions_analyzed: 2,
      actions_with_guard_decision: 1, actions_with_shields_recorded: 1,
    });
    expect(r.posture).toBe('clean'); // no findings; coverage carries the caveat
  });

  it('goal timeline lists distinct normalized goals in order with counts', () => {
    const a1 = action({ declared_goal: 'goal one' });
    const a2 = action({ declared_goal: 'Goal One' });
    const a3 = action({ declared_goal: 'goal two', risk_score: 10 });
    const r = buildSessionRetro(data({ actions: [a1, a2, a3], actionsTotal: 3 }));
    expect(r.goal_timeline).toEqual([
      { goal: 'goal one', first_action_id: a1.action_id, action_count: 2 },
      { goal: 'goal two', first_action_id: a3.action_id, action_count: 1 },
    ]);
  });

  it('session block: ended_at only for terminal statuses', () => {
    const done = buildSessionRetro(data());
    expect(done.session).toMatchObject({ id: 'sess_1', status: 'completed', ended_at: '2026-07-02T11:00:00Z' });
    const live = buildSessionRetro(data({ session: session({ status: 'running' }) }));
    expect(live.session.ended_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/unit/session-retro.test.js`
Expected: FAIL — cannot resolve `@/lib/session-retro`.

- [ ] **Step 3: Implement `app/lib/session-retro.ts`**

```ts
/**
 * Session retro — "was I manipulated" (owner roadmap v2.5, Advocate v2b).
 *
 * Pure shaping — no IO. Rolls the per-action agent_defense rollup up across
 * every action attributed to a session and adds the session-level detectors
 * (goal drift, risk spike, spend anomalies) that no single action can see.
 * Spec: docs/superpowers/specs/2026-07-02-session-retro-design.md — the
 * detector table there is the contract; thresholds are copied verbatim.
 *
 * Honesty rule (inherited from agent-defense.ts, carried up a level): an
 * ungoverned action lowers coverage, it never fabricates a "clean". Posture
 * is derived purely from finding severities — no invented score.
 */

import { buildAgentDefense } from './agent-defense';

type Row = Record<string, any>;

export type RetroSeverity = 'low' | 'medium' | 'high';
export type RetroPosture = 'clean' | 'review' | 'flagged';

export interface RetroFinding {
  kind: 'injection' | 'non_fabrication' | 'goal_drift' | 'risk_spike' | 'spend' | 'intervention' | 'assumption';
  severity: RetroSeverity;
  action_id: string | null;
  guard_decision_id: string | null;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface SessionRetroData {
  session: Row;
  actions: Row[]; // chronological ASC — drift/novelty detectors depend on order
  actionsTotal: number;
  decisions: Row[];
  assumptions: Row[];
  purchases: Row[];
}

export interface SessionRetro {
  session: {
    id: string; agent_id: string | null; status: string | null;
    created_at: unknown; ended_at: unknown; action_count: number;
  };
  posture: RetroPosture;
  counts: { high: number; medium: number; low: number };
  coverage: {
    actions_total: number; actions_analyzed: number;
    actions_with_guard_decision: number; actions_with_shields_recorded: number;
  };
  goal_timeline: Array<{ goal: string; first_action_id: string | null; action_count: number }>;
  findings: RetroFinding[];
  spend: { total: number; currency: string | null; purchases: number } | null;
}

// Mirrors TERMINAL_STATUSES in app/lib/sessions.ts (not imported to keep this
// module dependency-free of the DB layer for unit testing).
const TERMINAL = new Set(['finished', 'failed', 'closed', 'completed', 'cancelled']);

const DRIFT_RISK_FLOOR = 40;
const SPIKE_RISK_FLOOR = 70;
const SPIKE_MEDIAN_MULTIPLE = 2;
const LATE_NOVEL_MIN_PRIOR = 5;
const OUTLIER_MEDIAN_MULTIPLE = 5;
const OUTLIER_MIN_PURCHASES = 3;
// Canonical "spend that counted" predicate — matches sumWindowSpend in
// app/lib/repositories/x402.repository.ts.
const SPEND_EXCLUDED = new Set(['failed', 'denied', 'expired']);

function normalizeGoal(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.toLowerCase().trim().replace(/\s+/g, ' ');
  return s.length > 0 ? s : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function riskOf(action: Row): number | null {
  const n = Number(action.risk_score);
  return Number.isFinite(n) ? n : null;
}

export function buildSessionRetro(data: SessionRetroData): SessionRetro {
  const { session, actions, actionsTotal, decisions, assumptions, purchases } = data;

  const decisionsById = new Map<string, Row>();
  for (const d of decisions) if (d?.id) decisionsById.set(String(d.id), d);
  const assumptionsByAction = new Map<string, Row[]>();
  for (const a of assumptions) {
    const key = String(a?.action_id ?? '');
    if (!key) continue;
    const list = assumptionsByAction.get(key) ?? [];
    list.push(a);
    assumptionsByAction.set(key, list);
  }

  const findings: RetroFinding[] = [];
  const add = (f: RetroFinding) => findings.push(f);

  // Session baselines (computed over the analyzed window).
  const riskValues = actions.map(riskOf).filter((n): n is number => n != null);
  const medianRisk = median(riskValues);
  const firstGoal = actions.map((a) => normalizeGoal(a.declared_goal)).find((g) => g != null) ?? null;

  // Per-action detectors, in chronological order.
  const seenTypes = new Set<string>();
  let withDecision = 0;
  let withShields = 0;
  const timeline: SessionRetro['goal_timeline'] = [];
  const timelineIndex = new Map<string, number>();

  actions.forEach((action, index) => {
    const actionId = typeof action.action_id === 'string' ? action.action_id : null;
    const gdId = typeof action.guard_decision_id === 'string' ? action.guard_decision_id : null;
    const linked = gdId ? (decisionsById.get(gdId) ?? null) : null;
    const defense = buildAgentDefense(action, linked, assumptionsByAction.get(actionId ?? '') ?? []);
    const risk = riskOf(action);

    if (defense.decision.linked) withDecision += 1;
    if (defense.shields.prompt_injection.status !== 'not_recorded') withShields += 1;

    // 1 / 1b — injection shield
    const inj = defense.shields.prompt_injection.status;
    if (inj === 'warned' || inj === 'blocked') {
      add({
        kind: 'injection', severity: inj === 'blocked' ? 'high' : 'medium',
        action_id: actionId, guard_decision_id: gdId,
        summary: `prompt-injection shield ${inj} this action`,
        evidence: { shield_status: inj },
      });
    }

    // 2 — non-fabrication block
    if (defense.shields.non_fabrication.evaluated && defense.shields.non_fabrication.verdict === 'block') {
      add({
        kind: 'non_fabrication', severity: 'high',
        action_id: actionId, guard_decision_id: gdId,
        summary: 'non-fabrication shield returned a block verdict',
        evidence: { violations: defense.shields.non_fabrication.violations },
      });
    }

    // 6 — intervention (block decision)
    if (defense.decision.linked && defense.decision.decision === 'block') {
      add({
        kind: 'intervention', severity: 'medium',
        action_id: actionId, guard_decision_id: gdId,
        summary: 'guard blocked this action',
        evidence: { matched_policies: defense.decision.matched_policies, reason: defense.decision.reason },
      });
    }

    // 3a / 3b — goal drift vs the session's first declared goal
    const goal = normalizeGoal(action.declared_goal);
    if (goal == null && risk != null && risk >= DRIFT_RISK_FLOOR) {
      add({
        kind: 'goal_drift', severity: 'low',
        action_id: actionId, guard_decision_id: gdId,
        summary: `no declared goal on an action with risk ${risk}`,
        evidence: { rule: 'missing_declared_goal', risk_score: risk },
      });
    } else if (goal != null && firstGoal != null && goal !== firstGoal && risk != null && risk >= DRIFT_RISK_FLOOR) {
      add({
        kind: 'goal_drift', severity: 'medium',
        action_id: actionId, guard_decision_id: gdId,
        summary: 'acted outside the session\'s initial declared goal',
        evidence: { rule: 'goal_divergence', declared_goal: action.declared_goal, initial_goal: firstGoal, risk_score: risk },
      });
    }

    // 3c — late novel action type
    const type = typeof action.action_type === 'string' ? action.action_type : '';
    if (type && !seenTypes.has(type)) {
      seenTypes.add(type);
      const escalates = (risk != null && risk >= SPIKE_RISK_FLOOR) || type === 'x402_purchase';
      if (index >= LATE_NOVEL_MIN_PRIOR && escalates) {
        add({
          kind: 'goal_drift', severity: 'medium',
          action_id: actionId, guard_decision_id: gdId,
          summary: `first '${type}' of the session appeared after ${index} prior actions`,
          evidence: { rule: 'late_novel_type', action_type: type, prior_actions: index, risk_score: risk },
        });
      }
    }

    // 4 — risk spike vs session median
    if (risk != null && medianRisk != null && risk >= SPIKE_RISK_FLOOR && risk >= SPIKE_MEDIAN_MULTIPLE * medianRisk) {
      add({
        kind: 'risk_spike', severity: 'medium',
        action_id: actionId, guard_decision_id: gdId,
        summary: `risk ${risk} vs session median ${medianRisk}`,
        evidence: { risk_score: risk, session_median: medianRisk },
      });
    }

    // Goal timeline (informational, distinct normalized goals in order).
    if (goal != null) {
      const at = timelineIndex.get(goal);
      if (at == null) {
        timelineIndex.set(goal, timeline.length);
        timeline.push({ goal: String(action.declared_goal).trim(), first_action_id: actionId, action_count: 1 });
      } else {
        timeline[at].action_count += 1;
      }
    }
  });

  // 5a / 5b — spend anomalies
  const amounts = purchases.map((p) => Number(p.spend_amount)).filter((n) => Number.isFinite(n));
  const medianPurchase = median(amounts);
  for (const p of purchases) {
    const amount = Number(p.spend_amount);
    const status = typeof p.execution_status === 'string' ? p.execution_status : null;
    const actionId = typeof p.action_id === 'string' ? p.action_id : null;
    if (status === 'denied' || status === 'expired') {
      add({
        kind: 'spend', severity: 'medium',
        action_id: actionId, guard_decision_id: null,
        summary: `purchase ${status} (${Number.isFinite(amount) ? amount : '?'} ${p.currency ?? ''})`.trim(),
        evidence: { rule: 'purchase_denied_or_expired', execution_status: status, amount: Number.isFinite(amount) ? amount : null },
      });
    }
    if (
      purchases.length >= OUTLIER_MIN_PURCHASES && medianPurchase != null && medianPurchase > 0 &&
      Number.isFinite(amount) && amount >= OUTLIER_MEDIAN_MULTIPLE * medianPurchase
    ) {
      add({
        kind: 'spend', severity: 'medium',
        action_id: actionId, guard_decision_id: null,
        summary: `purchase of ${amount} is ≥${OUTLIER_MEDIAN_MULTIPLE}× the session median (${medianPurchase})`,
        evidence: { rule: 'outlier_amount', amount, session_median: medianPurchase },
      });
    }
  }

  // 7 — assumptions later invalidated (the alibi angle: the agent acted on
  // then-valid information; record when the ground truth shifted).
  for (const a of assumptions) {
    if (a.invalidated === 1 || a.invalidated === true || a.invalidated === '1') {
      add({
        kind: 'assumption', severity: 'low',
        action_id: typeof a.action_id === 'string' ? a.action_id : null, guard_decision_id: null,
        summary: 'an assumption this session acted on was later invalidated',
        evidence: {
          assumption_id: a.assumption_id ?? null, assumption: a.assumption ?? null,
          invalidated_reason: a.invalidated_reason ?? null, invalidated_at: a.invalidated_at ?? null,
        },
      });
    }
  }

  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const posture: RetroPosture = counts.high > 0 ? 'flagged' : findings.length > 0 ? 'review' : 'clean';

  const countedSpend = purchases.filter((p) => !SPEND_EXCLUDED.has(String(p.execution_status)));
  const spendTotal = countedSpend.reduce((sum, p) => sum + (Number(p.spend_amount) || 0), 0);

  return {
    session: {
      id: String(session.id ?? ''),
      agent_id: typeof session.agent_id === 'string' ? session.agent_id : null,
      status: typeof session.status === 'string' ? session.status : null,
      created_at: session.created_at ?? null,
      ended_at: TERMINAL.has(String(session.status)) ? (session.updated_at ?? null) : null,
      action_count: actionsTotal,
    },
    posture,
    counts,
    coverage: {
      actions_total: actionsTotal,
      actions_analyzed: actions.length,
      actions_with_guard_decision: withDecision,
      actions_with_shields_recorded: withShields,
    },
    goal_timeline: timeline,
    findings,
    spend: purchases.length > 0
      ? { total: Math.round(spendTotal * 100) / 100, currency: (countedSpend[0]?.currency ?? purchases[0]?.currency ?? null) as string | null, purchases: purchases.length }
      : null,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run __tests__/unit/session-retro.test.js`
Expected: PASS (all vectors). If the timeline vector fails on raw-vs-normalized goal text, keep the FIRST-SEEN raw goal (trimmed) as the display value — that is what the test pins.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add app/lib/session-retro.ts __tests__/unit/session-retro.test.js
git commit -m "feat(retro): session retro shaper — detectors, posture, coverage (roadmap v2.5)"
```

---

### Task 2: Batch fetch + `GET /api/sessions/[sessionId]/retro`

**Files:**
- Modify: `app/lib/sessions.ts` (append after `getSessionActions`, ~line 421)
- Create: `app/api/sessions/[sessionId]/retro/route.ts`
- Test: `__tests__/unit/session-retro-data.test.js`

**Interfaces:**
- Consumes: `sessionActionMatchSql`, `getSession`, `ensureTables` (module-private, same file); `buildSessionRetro(data)` from Task 1.
- Produces: `getSessionRetroData(sql, sessionId, orgId): Promise<SessionRetroData | null>` — `null` when the session doesn't exist in this org. Route returns `{ retro }` / 404 `{ error: 'Session not found' }`.

- [ ] **Step 1: Write the failing test**

`__tests__/unit/session-retro-data.test.js` — NOTE the repo's sql-mock gotcha: conditional `sql\`\`` fragments consume mock calls; assert on call order loosely, match by SQL text instead.

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionRetroData } from '@/lib/sessions';

// sql mock: tagged-template fn + .query. Routes queries by matching the
// raw SQL text (fragments also arrive here; return [] for them).
function makeSql(handlers) {
  const sql = vi.fn((strings, ..._values) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    for (const [pattern, rows] of handlers) {
      if (text.includes(pattern)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  });
  sql.query = vi.fn(() => Promise.resolve([]));
  return sql;
}

describe('getSessionRetroData', () => {
  beforeEach(() => { globalThis.__dashclaw_sessions_table_checked = true; });

  it('returns null when the session is missing', async () => {
    const sql = makeSql([['FROM agent_sessions', []]]);
    expect(await getSessionRetroData(sql, 'sess_missing', 'org_1')).toBeNull();
  });

  it('returns the batch shape with coerced total', async () => {
    const sql = makeSql([
      ['COUNT(*)::int AS total', [{ total: '2' }]],
      ['ORDER BY ar.created_at ASC', [
        { action_id: 'act_1', guard_decision_id: 'act_gd_1', declared_goal: 'g', risk_score: '20', action_type: 't', created_at: 'x' },
        { action_id: 'act_2', guard_decision_id: null, declared_goal: 'g', risk_score: null, action_type: 't', created_at: 'y' },
      ]],
      ['FROM guard_decisions', [{ id: 'act_gd_1', decision: 'allow' }]],
      ['FROM assumptions', [{ assumption_id: 'asm_1', action_id: 'act_1', invalidated: 0 }]],
      ['FROM x402_purchases', []],
      ['FROM agent_sessions', [{ id: 'sess_1', org_id: 'org_1', agent_id: 'a', status: 'completed' }]],
    ]);
    const data = await getSessionRetroData(sql, 'sess_1', 'org_1');
    expect(data.session.id).toBe('sess_1');
    expect(data.actionsTotal).toBe(2);
    expect(data.actions).toHaveLength(2);
    expect(data.decisions).toHaveLength(1);
    expect(data.assumptions).toHaveLength(1);
    expect(data.purchases).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/unit/session-retro-data.test.js`
Expected: FAIL — `getSessionRetroData` is not exported.

- [ ] **Step 3: Implement `getSessionRetroData` in `app/lib/sessions.ts`**

Append after `getSessionActions` (adjust `getSession` call to match its actual signature in this file — the actions route calls `getSession(sql, sessionId, orgId)`). The return type is Task 1's interface — import it, do NOT redefine it (`SessionRow` satisfies it structurally):

```ts
import type { SessionRetroData } from './session-retro'; // at top of file

// Cap the analyzed window so a runaway session can't balloon the response;
// coverage.actions_analyzed vs actions_total makes any truncation visible.
const RETRO_ACTION_LIMIT = 1000;

/**
 * Batch-fetch everything the session retro composes (roadmap v2.5): the
 * session, its actions (chronological — drift detection depends on order),
 * their FK-linked guard decisions, assumptions, and x402 purchases. One
 * fetch, pure shaping downstream (app/lib/session-retro.ts).
 */
export async function getSessionRetroData(
  sql: SqlClient,
  sessionId: string,
  orgId: string,
): Promise<SessionRetroData | null> {
  await ensureTables(sql);

  const session = await getSession(sql, sessionId, orgId);
  if (!session) return null;

  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM agent_sessions s
    JOIN action_records ar
      ON ar.org_id = s.org_id
     AND ${sessionActionMatchSql(sql)}
    WHERE s.id = ${sessionId} AND s.org_id = ${orgId}
  `;

  const actions = await sql`
    SELECT
      ar.action_id, ar.agent_id, ar.action_type, ar.declared_goal,
      ar.reasoning, ar.authorization_scope, ar.trigger,
      ar.status, ar.outcome_status, ar.risk_score,
      ar.guard_decision_id, ar.created_at
    FROM agent_sessions s
    JOIN action_records ar
      ON ar.org_id = s.org_id
     AND ${sessionActionMatchSql(sql)}
    WHERE s.id = ${sessionId} AND s.org_id = ${orgId}
    ORDER BY ar.created_at ASC
    LIMIT ${RETRO_ACTION_LIMIT}
  `;

  const actionIds = actions.map((a) => a.action_id).filter(Boolean);
  const decisionIds = actions.map((a) => a.guard_decision_id).filter(Boolean);

  const decisions = decisionIds.length
    ? await sql`
        SELECT id, decision, reason, matched_policies, risk_score, context, evidence, action_type
        FROM guard_decisions
        WHERE org_id = ${orgId} AND id = ANY(${decisionIds})
      `
    : [];

  const assumptions = actionIds.length
    ? await sql`
        SELECT assumption_id, action_id, assumption, basis, validated,
               invalidated, invalidated_reason, invalidated_at, created_at
        FROM assumptions
        WHERE org_id = ${orgId} AND action_id = ANY(${actionIds})
      `
    : [];

  const purchases = actionIds.length
    ? await sql`
        SELECT action_id, spend_amount, currency, execution_status, provider_id, created_at
        FROM x402_purchases
        WHERE org_id = ${orgId} AND action_id = ANY(${actionIds})
      `
    : [];

  return {
    session,
    actions,
    actionsTotal: Number(countRows[0]?.total) || 0,
    decisions,
    assumptions,
    purchases,
  };
}
```

If `ar.trigger` errors in the build (`trigger` is a keyword in some positions), quote it: `ar."trigger"`.

- [ ] **Step 4: Create the route**

`app/api/sessions/[sessionId]/retro/route.ts` (mirrors the sibling `actions/route.ts` exactly):

```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getSessionRetroData } from '../../../../lib/sessions';
import { buildSessionRetro } from '../../../../lib/session-retro';

// Per-session defensibility retro (roadmap v2.5) — posture + evidenced
// findings composed on read; no rows are written.
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const data = await getSessionRetroData(sql, sessionId, orgId);
    if (!data) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ retro: buildSessionRetro(data) });
  } catch (error) {
    console.error('Session retro error:', error);
    return NextResponse.json({ error: 'Failed to build session retro' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run __tests__/unit/session-retro-data.test.js __tests__/unit/session-retro.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Live check against local dev**

With `npm run dev` running and a real session id from `/sessions` (or create one: `POST /api/sessions {"agent_id":"retro-dev"}` with your API key):

Run: `curl -s -H "Authorization: Bearer $DASHCLAW_API_KEY" http://localhost:3000/api/sessions/<sess_id>/retro`
Expected: `{"retro":{"posture":...,"coverage":...}}`; unknown id → 404.

- [ ] **Step 7: Commit**

```bash
git add app/lib/sessions.ts "app/api/sessions/[sessionId]/retro/route.ts" __tests__/unit/session-retro-data.test.js
git commit -m "feat(retro): batch fetch + GET /api/sessions/[sessionId]/retro"
```

---

### Task 3: Retro card on the session detail page

**Files:**
- Create: `app/components/SessionRetroCard.tsx`
- Modify: `app/sessions/[sessionId]/page.tsx` (fetchData Promise.all ~line 70; render below the events/actions cards)

**Interfaces:**
- Consumes: `GET /api/sessions/${sessionId}/retro` (Task 2). Component prop: `retro: SessionRetro-shaped object | null`.
- Produces: the human surface — click path `/sessions` → session row → Retro card. Findings link to `/actions/${action_id}`.

- [ ] **Step 1: Create `app/components/SessionRetroCard.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { Card, CardContent } from './ui/Card';

// Session retro ("was I manipulated", roadmap v2.5). Pure presentation over
// GET /api/sessions/[id]/retro — posture chip, honest coverage line, goal
// timeline, findings grouped by kind. Tokens only, no hex.

const postureStyle: Record<string, { chip: string; Icon: typeof ShieldCheck; label: string }> = {
  clean: { chip: 'bg-success-subtle text-success', Icon: ShieldCheck, label: 'Clean' },
  review: { chip: 'bg-warning-subtle text-warning', Icon: ShieldAlert, label: 'Review' },
  flagged: { chip: 'bg-error-subtle text-error', Icon: ShieldX, label: 'Flagged' },
};

const severityStyle: Record<string, string> = {
  high: 'bg-error-subtle text-error',
  medium: 'bg-warning-subtle text-warning',
  low: 'bg-zinc-500/20 text-secondary',
};

const kindLabel: Record<string, string> = {
  injection: 'Injected content',
  non_fabrication: 'Fabrication',
  goal_drift: 'Goal drift',
  risk_spike: 'Risk spike',
  spend: 'Spend',
  intervention: 'Interventions',
  assumption: 'Invalidated assumptions',
};

export default function SessionRetroCard({ retro }: { retro: any | null }) {
  if (!retro) return null;
  const posture = postureStyle[retro.posture] ?? postureStyle.review;
  const { Icon } = posture;
  const cov = retro.coverage || {};
  const ungoverned = Math.max(0, (cov.actions_analyzed ?? 0) - (cov.actions_with_guard_decision ?? 0));

  const grouped: Record<string, any[]> = {};
  for (const f of retro.findings || []) (grouped[f.kind] ??= []).push(f);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-secondary">Session retro — was I manipulated?</h2>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${posture.chip}`}>
            <Icon className="h-3.5 w-3.5" />
            {posture.label}
          </span>
        </div>

        {/* Honesty line: a mostly-ungoverned session must not read as exonerated. */}
        <p className="text-xs text-secondary">
          {cov.actions_with_guard_decision ?? 0} of {cov.actions_analyzed ?? 0} actions had a linked guard
          decision{ungoverned > 0 ? ` — ${ungoverned} ungoverned (posture applies to observed data only)` : ''}.
          {(cov.actions_total ?? 0) > (cov.actions_analyzed ?? 0)
            ? ` Analyzed the first ${cov.actions_analyzed} of ${cov.actions_total} actions.` : ''}
        </p>

        {(retro.goal_timeline || []).length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-secondary">Goal timeline</h3>
            <ol className="space-y-0.5 text-sm">
              {retro.goal_timeline.map((g: any, i: number) => (
                <li key={`${g.goal}-${i}`} className="text-primary">
                  {g.goal} <span className="text-xs text-secondary">({g.action_count} action{g.action_count === 1 ? '' : 's'})</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {(retro.findings || []).length === 0 ? (
          <p className="text-sm text-secondary">No findings across the observed actions.</p>
        ) : (
          Object.entries(grouped).map(([kind, list]) => (
            <div key={kind}>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-secondary">
                {kindLabel[kind] ?? kind} ({list.length})
              </h3>
              <ul className="space-y-1">
                {list.map((f, i) => (
                  <li key={`${f.action_id}-${i}`} className="flex items-start gap-2 text-sm">
                    <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${severityStyle[f.severity] ?? severityStyle.low}`}>
                      {f.severity}
                    </span>
                    <span className="text-primary">
                      {f.summary}
                      {f.action_id && (
                        <Link href={`/actions/${f.action_id}`} className="ml-1.5 text-xs text-info hover:underline">
                          view action →
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}

        {retro.spend && (
          <p className="text-xs text-secondary">
            Session spend: ${Number(retro.spend.total).toFixed(2)} across {retro.spend.purchases} purchase{retro.spend.purchases === 1 ? '' : 's'}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

Check `app/components/ui/Card.tsx` for the actual `CardContent` API before relying on `className` passthrough; adjust to match how the page's other cards compose.

- [ ] **Step 2: Wire into `app/sessions/[sessionId]/page.tsx`**

Add state + fetch (the retro joins the existing `Promise.all`):

```tsx
const [retro, setRetro] = useState<any>(null);
```

In `fetchData`, extend the `Promise.all`:

```tsx
const [sessionRes, eventsRes, actionsRes, retroRes] = await Promise.all([
  fetch(`/api/sessions/${sessionId}`),
  fetch(`/api/sessions/${sessionId}/events`),
  fetch(`/api/sessions/${sessionId}/actions?limit=${ACTIONS_PAGE_SIZE}`),
  fetch(`/api/sessions/${sessionId}/retro`),
]);
```

and after the existing `if (actionsRes.ok)` block:

```tsx
if (retroRes.ok) {
  const rData = await retroRes.json();
  setRetro(rData.retro || null);
}
```

Import and render the card in the page body (place it directly after the session summary card, before the actions list — the retro is the "so what" of the session):

```tsx
import SessionRetroCard from '../../components/SessionRetroCard';
// …in the JSX:
<SessionRetroCard retro={retro} />
```

- [ ] **Step 3: Verify rendered (feature-visibility gate)**

Use the frontend-verify skill against local dev: `/sessions` → open a session with actions → the Retro card renders with a posture chip and coverage line; zero console errors. If no seeded session exists, create one via `POST /api/sessions` + two `POST /api/actions` with differing goals (risk 50) and confirm a `review` posture with a goal-drift finding renders.

- [ ] **Step 4: Gates + commit**

Run: `npm run lint && npm run typecheck && npx next build` (app/** changed → build required)
Expected: all pass, no new warnings.

```bash
git add app/components/SessionRetroCard.tsx "app/sessions/[sessionId]/page.tsx"
git commit -m "feat(retro): session retro card on /sessions/[id] — posture, coverage, findings"
```

---

### Task 4: MCP tool `dashclaw_session_retro`

**Files:**
- Modify: `mcp-server/src/tools.ts` (tool def after `dashclaw_session_end` ~line 190; handler after the `dashclaw_session_end` handler ~line 847)
- Modify: `__tests__/unit/mcp-tools.test.js` (pinned tool list/count)

**Interfaces:**
- Consumes: `GET /api/sessions/{id}/retro` (Task 2); module-scoped `activeSessionId` and `client` (exist).
- Produces: MCP tool returning the retro JSON string; an agent calls it after `dashclaw_session_end` (or anytime) to read its own defensibility report.

- [ ] **Step 1: Add the tool definition** (immediately after the `dashclaw_session_end` def):

```ts
{
  name: 'dashclaw_session_retro',
  description:
    'Fetch the per-session defensibility retro ("was I manipulated?"): injected-content flags, ' +
    'actions outside the declared goal, spend anomalies, and shield hits, composed into a ' +
    'clean/review/flagged posture with evidenced findings. Read-only. Call after ' +
    'dashclaw_session_end (or anytime) to review your own session; defaults to the active session.',
  inputSchema: {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'Session ID (sess_*). Defaults to the session started by dashclaw_session_start.' },
    },
  },
},
```

- [ ] **Step 2: Add the handler** (after the `dashclaw_session_end` handler):

```ts
async dashclaw_session_retro(input: any) {
  // Read BEFORE dashclaw_session_end clears it, or pass session_id explicitly.
  const sessionId = input.session_id ?? activeSessionId;
  if (!sessionId) {
    return JSON.stringify({
      error: 'No session_id given and no active session. Pass session_id (sess_*) or call dashclaw_session_start first.',
    });
  }
  const result = await client.get(`/api/sessions/${sessionId}/retro`, {}, { timeout: 15000 });
  return JSON.stringify(result);
},
```

NOTE: `dashclaw_session_end` clears `activeSessionId` — the description already tells agents to pass `session_id` explicitly post-end. If a `lastSessionId` fallback already exists in the file, use it; do not invent one.

- [ ] **Step 3: Update the pinned MCP tool test**

Open `__tests__/unit/mcp-tools.test.js`, find the tool-name list / count assertion, add `dashclaw_session_retro` (and increment any count).

- [ ] **Step 4: Rebuild the MCP server + run tests**

Check `mcp-server/package.json` for the build script, then from `mcp-server/`: `npm run build` (regenerates `mcp-server/lib/*`). Then from the repo root:

Run: `npx vitest run __tests__/unit/mcp-tools.test.js`
Expected: PASS with the new tool listed. Also run the mcp-server's own test suite if `mcp-server/package.json` defines one.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/tools.ts mcp-server/lib __tests__/unit/mcp-tools.test.js
git commit -m "feat(mcp): dashclaw_session_retro — agent-readable session defensibility retro"
```

---

### Task 5: Policy smoke scenario (O1–O4)

**Files:**
- Modify: `scripts/policy-smoke.mjs` (insert a new block after the N1–N5 block ~line 803, before cleanup)

**Interfaces:**
- Consumes: harness helpers `api(method, path, body)`, `createPolicy(name, policy_type, rules, agentIds)`, `check(claim, name, pass, detail)`, `agentFor(tag)`, `RUN` (all exist); route from Task 2.
- Produces: smoke count grows 72 → 76.

- [ ] **Step 1: Add the scenario block**

Before writing it, grep the file for an existing `block_action_type` policy creation and copy its exact `rules` shape into `createPolicy` below (do not guess the key):

```js
  // ── Advocate v2b: session retro (O1–O4) ─────────────────────────────────
  {
    console.log('\nAdvocate v2b: session retro...');
    const agent = agentFor('retro');
    const sess = await api('POST', '/api/sessions', { agent_id: agent, workspace: 'smoke' });
    const sessId = sess.json?.session?.id;

    // Baseline action posted WITHOUT session_id — same agent inside the
    // session window, so it must be attributed via the legacy fallback arm
    // of sessionActionMatchSql (spec: repository proof incl. legacy-window rows).
    await api('POST', '/api/actions', {
      agent_id: agent, action_type: `smoke.retro.base.${RUN}`,
      declared_goal: `retro baseline goal ${RUN}`, risk_score: 20,
    });
    await api('POST', '/api/actions', {
      agent_id: agent, action_type: `smoke.retro.drift.${RUN}`,
      declared_goal: `entirely different goal ${RUN}`, session_id: sessId, risk_score: 50,
    });

    // A blocked, guarded, session-stamped action → intervention finding.
    const blockType = `smoke.retro.blocked.${RUN}`;
    await createPolicy(`smoke retro block ${RUN}`, 'block_action_type',
      { action_type: blockType } /* ← mirror the existing block_action_type rules shape */, [agent]);
    await api('POST', '/api/guard?record=true', {
      agent_id: agent, action_type: blockType,
      declared_goal: `retro baseline goal ${RUN}`, session_id: sessId,
    });

    const retroRes = await api('GET', `/api/sessions/${sessId}/retro`);
    const retro = retroRes.json?.retro || {};
    const kinds = (retro.findings || []).map((f) => f.kind);
    check('O1', 'session retro 200s with review posture',
      retroRes.status === 200 && retro.posture === 'review',
      `status=${retroRes.status} posture=${retro.posture} kinds=${kinds.join(',')}`);
    check('O2', 'retro carries a goal_drift finding with its action id',
      (retro.findings || []).some((f) => f.kind === 'goal_drift' && !!f.action_id),
      `findings=${JSON.stringify(retro.findings)?.slice(0, 300)}`);
    check('O3', 'retro carries an intervention finding from the blocked guard',
      kinds.includes('intervention'),
      `kinds=${kinds.join(',')}`);
    check('O4', 'coverage is honest: some actions ungoverned',
      (retro.coverage?.actions_total ?? 0) >= 3 &&
      (retro.coverage?.actions_with_guard_decision ?? 0) >= 1 &&
      retro.coverage.actions_with_guard_decision < retro.coverage.actions_total,
      `coverage=${JSON.stringify(retro.coverage)}`);
  }
```

If `POST /api/guard?record=true` on a `block` decision does NOT create a linked action record (verify live), replace O3's seed with a third plain action and change O3 to assert `kinds` length ≥ 1 with `goal_drift` only — but first check `app/api/guard/route.ts` for the record-on-block behavior; the FK linkage shipped in v4.25.0 and blocks are recorded there.

- [ ] **Step 2: Run the smoke against local dev**

Kill anything on :3000 first (two dev servers fight one `.next` lock → phantom 500s). Then with `npm run dev` running: `node scripts/policy-smoke.mjs`
Expected: `76 checks, 76 passed, 0 failed` (72 existing + O1–O4).

- [ ] **Step 3: Commit**

```bash
git add scripts/policy-smoke.mjs
git commit -m "test(smoke): O1-O4 session retro — posture, drift, intervention, honest coverage"
```

---

### Task 6: Docs + counts truth pass

**Files:**
- Modify: `app/docs/page.tsx` (MCP tools listing — `dashclaw_session_end` appears there; add the retro tool beside it)
- Modify: hand-curated MCP tool lists: `mcp-server/README.md`, `plugins/dashclaw/skills/dashclaw-governance/references/governance-patterns.md`, `plugins/dashclaw/skills/dashclaw-platform-intelligence/references/api-surface.md` (the `public/downloads/*` and `.agents/*` mirrors regenerate via the pre-commit livingcode refresh — edit the plugin sources, not the mirrors)
- Modify: any file where the MCP tool COUNT is cited (find with the grep below)

**Interfaces:**
- Consumes: the shipped tool + route names from Tasks 2 and 4. Produces: truthful docs; `scripts/check-doc-counts.mjs --strict` passes.

- [ ] **Step 1: Find every cited MCP tool count and route count**

Run: `node scripts/check-doc-counts.mjs --strict`
and: `grep -rn "dashclaw_session_end" README.md PROJECT_DETAILS.md docs/ app/docs/ mcp-server/README.md plugins/ sdk/README.md sdk-python/README.md`
Update each list/count the new tool and route affect (tool count +1, session routes +1). The spec's advocate positioning line: add one sentence about the session retro to the advocate/docs section that v4.25.0 added (find it: `grep -rn "agent_defense" app/docs/ docs/`).

- [ ] **Step 2: Re-run the counts check**

Run: `node scripts/check-doc-counts.mjs --strict`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(retro): session retro across docs, MCP tool lists, counts"
```

(The pre-commit hook will regenerate livingcode/API-inventory artifacts and stage them — that is expected; let it.)

---

### Task 7: Full gates, live proof, hand off to ship

**Files:** none new.

- [ ] **Step 1: Full verification gates**

Run (and READ the output):
- `npm run lint`
- `npx vitest run` (FULL suite — never targeted at this stage)
- `npm run typecheck`
- `npx next build`
- `node scripts/policy-smoke.mjs` against local dev (expect 76/76)

- [ ] **Step 2: Live proof checklist (spec acceptance)**

- Retro card rendered on a real `/sessions/[id]` page (frontend-verify, from Task 3).
- `GET /api/sessions/<id>/retro` returns the report; 404 on a foreign/unknown id.
- `dashclaw_session_retro` listed by the MCP server and returns the report for a live session (use the local MCP config).

- [ ] **Step 3: Hand off to ship**

Ship via the `dashclaw-ship` skill (version → v4.32.0; CHANGELOG + `docs/maintainer-log.md` entries; roadmap ledger v2.5 → DONE with a one-line summary; preship-sweep first). SDK sources did NOT change → no SDK publish (conditional-publish rule).
