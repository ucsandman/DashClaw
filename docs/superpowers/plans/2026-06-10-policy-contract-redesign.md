# Policy Contract Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `claude-code` policy mode genuinely low-interruption (interrupts only for money + destruction + secrets), add an `allow_grant` noise-reduction mechanism, and rebuild `/policies` as a "contract" page: editable plain-English interruption contract on top, a verdict-driven review feed below.

**Spec:** `docs/superpowers/specs/2026-06-10-policy-contract-redesign-design.md`

**Architecture:** Two new guard policy types (`warn_action_type`, `allow_grant`) extend the existing 13. Grants run as a post-pass after `runLocalPolicies` and downgrade `warn`/`require_approval` → `allow` (never `block`). A shared shape lib (`app/lib/policy-shapes.ts`) powers both grant matching and review-feed grouping. The contract renderer is data-driven from policy rows. New routes use repositories only (route-sql gate). Review state (cursor + dismissed shapes) lives in the existing `settings` key/value table.

**Tech Stack:** Next.js 16 App Router, TypeScript, vitest (repo-root `__tests__/unit/`), Neon Postgres via repositories, Tailwind + CSS tokens (`.impeccable.md` rules apply to all UI).

**Conventions that bind every task:**
- Tests live in `__tests__/unit/`, use `vi.hoisted` mock pattern, `@/` → `app`. NO jest-dom — assert via container queries. Mock `next/navigation` in render tests.
- No direct SQL in `app/api/**/route.ts` — repositories only (`app/lib/repositories/`).
- UI: tokens only (`text-primary`, `bg-surface-secondary`, `border-border`, `text-brand`…), never hex. Brand orange only for "needs you" cues. `tabular-nums` on counts. lucide-react icons only.
- After any changed `.ts` file run `npm run typecheck` before the final push (vitest transpiles without type-checking).
- Commit after each task. Do NOT stage unrelated files (many stray `gate-*.log` files exist in the tree — use explicit paths with `git add`).

---

### Task 1: New policy types — types + validation

**Files:**
- Modify: `app/lib/types/governance.ts:21-34` (GuardPolicyType union) and the `GuardPolicy` discriminated union just below (~lines 38-62)
- Modify: `app/lib/validate.js:293` (POLICY_TYPES) and `app/lib/validate.js:355-474` (POLICY_TYPE_VALIDATORS)
- Test: `__tests__/unit/validate-policy-new-types.test.js` (create)

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/unit/validate-policy-new-types.test.js
import { describe, expect, it } from 'vitest';
import { validatePolicy } from '@/lib/validate.js';

const base = (policy_type, rules) => ({
  name: 'T',
  policy_type,
  rules: JSON.stringify(rules),
});

describe('validatePolicy — warn_action_type', () => {
  it('accepts a valid action_types array', () => {
    const r = validatePolicy(base('warn_action_type', { action_types: ['api', 'sync'] }));
    expect(r.valid).toBe(true);
  });
  it('rejects a missing action_types array', () => {
    const r = validatePolicy(base('warn_action_type', {}));
    expect(r.valid).toBe(false);
  });
});

describe('validatePolicy — allow_grant', () => {
  it('accepts action_type with target_prefix', () => {
    const r = validatePolicy(base('allow_grant', { action_type: 'api', target_prefix: 'stripe.com' }));
    expect(r.valid).toBe(true);
  });
  it('accepts action_type without target_prefix', () => {
    const r = validatePolicy(base('allow_grant', { action_type: 'sync' }));
    expect(r.valid).toBe(true);
  });
  it('rejects missing action_type', () => {
    const r = validatePolicy(base('allow_grant', { target_prefix: 'x' }));
    expect(r.valid).toBe(false);
  });
  it('rejects empty target_prefix', () => {
    const r = validatePolicy(base('allow_grant', { action_type: 'api', target_prefix: '' }));
    expect(r.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run __tests__/unit/validate-policy-new-types.test.js`) with "policy_type must be one of …".

- [ ] **Step 3: Implement**

In `app/lib/types/governance.ts`, extend the union:

```typescript
export type GuardPolicyType =
  | 'risk_threshold'
  | 'require_approval'
  | 'block_action_type'
  | 'warn_action_type'
  | 'allow_grant'
  | 'protected_path'
  | 'rate_limit'
  | 'webhook_check'
  | 'non_fabrication'
  | 'behavioral_anomaly'
  | 'semantic_check'
  | 'permission_escalation'
  | 'green_contract'
  | 'branch_freshness'
  | 'x402_spend_limit';
```

Read lines 38-62 of `governance.ts` (the `GuardPolicy` discriminated union). Add two members following the existing per-type shape pattern exactly (match how `require_approval` is declared there):

```typescript
| { policy_type: 'warn_action_type'; rules: { action_types: string[] } }
| { policy_type: 'allow_grant'; rules: { action_type: string; target_prefix?: string } }
```
(Adapt to the union's actual member shape — if members are named interfaces, create `WarnActionTypePolicy` / `AllowGrantPolicy` in the same style.)

In `app/lib/validate.js`:
1. Line 293, add `'warn_action_type', 'allow_grant'` to `POLICY_TYPES`.
2. In `POLICY_TYPE_VALIDATORS`, add:

```javascript
  warn_action_type: (rules, addError, policyType) => validateActionTypesRequired(rules, addError, policyType),
  allow_grant: (rules, addError) => {
    if (!isNonEmptyString(rules.action_type)) {
      addError('allow_grant policy requires rules.action_type string');
    }
    if (rules.target_prefix !== undefined && (
      typeof rules.target_prefix !== 'string' || rules.target_prefix.length === 0 || rules.target_prefix.length > 256
    )) {
      addError('allow_grant rules.target_prefix must be a non-empty string (<=256 chars)');
    }
  },
```

- [ ] **Step 4: Run test — expect PASS.** Also run `npx vitest run __tests__/unit/policies.route.test.js __tests__/unit/policy-modes-compile.test.ts` to confirm no regression.

- [ ] **Step 5: Commit** — `git add app/lib/types/governance.ts app/lib/validate.js __tests__/unit/validate-policy-new-types.test.js && git commit -m "feat(guard): add warn_action_type + allow_grant policy types (validation + types)"`

---

### Task 2: Shape lib — `app/lib/policy-shapes.ts`

The single source of truth for "action shape": grant matching AND review-feed grouping use it.

**Files:**
- Create: `app/lib/policy-shapes.ts`
- Test: `__tests__/unit/policy-shapes.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/unit/policy-shapes.test.ts
import { describe, expect, it } from 'vitest';
import {
  normalizeTarget,
  shapeKey,
  grantMatches,
  extractDecisionShape,
} from '@/lib/policy-shapes';

describe('normalizeTarget', () => {
  it('reduces a URL to its host', () => {
    expect(normalizeTarget('https://api.stripe.com/v1/charges')).toBe('api.stripe.com');
  });
  it('keeps a path as-is (trimmed)', () => {
    expect(normalizeTarget(' sdk/index.ts ')).toBe('sdk/index.ts');
  });
  it('returns null for empty input', () => {
    expect(normalizeTarget('')).toBeNull();
    expect(normalizeTarget(undefined)).toBeNull();
  });
});

describe('shapeKey', () => {
  it('combines action_type and target prefix', () => {
    expect(shapeKey('api', 'api.stripe.com')).toBe('api::api.stripe.com');
  });
  it('handles null target', () => {
    expect(shapeKey('sync', null)).toBe('sync::');
  });
});

describe('grantMatches', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    action_type: 'api',
    target: 'https://api.stripe.com/v1/charges',
    ...over,
  });
  it('matches on action_type alone when no target_prefix', () => {
    expect(grantMatches({ action_type: 'api' }, ctx())).toBe(true);
  });
  it('does not match a different action_type', () => {
    expect(grantMatches({ action_type: 'sync' }, ctx())).toBe(false);
  });
  it('matches when normalized target starts with target_prefix', () => {
    expect(grantMatches({ action_type: 'api', target_prefix: 'api.stripe.com' }, ctx())).toBe(true);
  });
  it('does not match a different host', () => {
    expect(grantMatches({ action_type: 'api', target_prefix: 'github.com' }, ctx())).toBe(false);
  });
  it('matches write_paths candidates by prefix', () => {
    expect(grantMatches(
      { action_type: 'write', target_prefix: 'sdk/' },
      { action_type: 'write', write_paths: ['sdk/index.ts'] },
    )).toBe(true);
  });
  it('does not match when context has no target candidates but grant has a prefix', () => {
    expect(grantMatches({ action_type: 'api', target_prefix: 'api.stripe.com' }, { action_type: 'api' })).toBe(false);
  });
});

describe('extractDecisionShape', () => {
  it('extracts shape from a guard_decisions row with URL target in context', () => {
    const s = extractDecisionShape({
      action_type: 'api',
      context: JSON.stringify({ target: 'https://api.stripe.com/v1/charges' }),
    });
    expect(s).toEqual({
      action_type: 'api',
      target_prefix: 'api.stripe.com',
      key: 'api::api.stripe.com',
      label: 'api → api.stripe.com',
    });
  });
  it('groups path targets by first two segments', () => {
    const s = extractDecisionShape({
      action_type: 'write',
      context: JSON.stringify({ target: 'sdk/lib/deep/file.ts' }),
    });
    expect(s.target_prefix).toBe('sdk/lib/');
    expect(s.key).toBe('write::sdk/lib/');
  });
  it('handles missing/invalid context', () => {
    const s = extractDecisionShape({ action_type: 'sync', context: 'not json' });
    expect(s).toEqual({ action_type: 'sync', target_prefix: null, key: 'sync::', label: 'sync' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found).

- [ ] **Step 3: Implement**

```typescript
// app/lib/policy-shapes.ts
// Action "shapes" — the shared coordinate system for allow_grant matching and
// review-feed grouping. A shape is (action_type, normalized target prefix):
// URLs normalize to their host; file paths group by their first two segments.

export interface ActionShape {
  action_type: string;
  target_prefix: string | null;
  /** Stable grouping key: `${action_type}::${target_prefix ?? ''}` */
  key: string;
  /** Human label for the review feed, e.g. "api → api.stripe.com". */
  label: string;
}

/** URL → host; anything else → trimmed string; empty → null. */
export function normalizeTarget(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    try {
      return new URL(t).host || null;
    } catch {
      return t;
    }
  }
  return t;
}

export function shapeKey(actionType: string, targetPrefix: string | null): string {
  return `${actionType}::${targetPrefix ?? ''}`;
}

/** Path → first two segments (with trailing slash) so deep trees group sanely. */
function pathPrefix(p: string): string {
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return `${parts[0]}/${parts[1]}/`;
}

/** Reduce a normalized target to its grouping prefix (hosts stay whole, paths shorten). */
export function targetPrefixOf(normalized: string | null): string | null {
  if (!normalized) return null;
  return normalized.includes('/') ? pathPrefix(normalized) : normalized;
}

interface GrantRules {
  action_type?: unknown;
  target_prefix?: unknown;
}

interface GrantContext {
  action_type?: unknown;
  target?: unknown;
  write_paths?: unknown;
}

/** Does an allow_grant's shape match this guard context? */
export function grantMatches(rules: GrantRules, context: GrantContext): boolean {
  if (typeof rules.action_type !== 'string' || rules.action_type !== context.action_type) {
    return false;
  }
  if (rules.target_prefix === undefined || rules.target_prefix === null) return true;
  const prefix = String(rules.target_prefix);
  const candidates: string[] = [];
  const t = normalizeTarget(typeof context.target === 'string' ? context.target : null);
  if (t) candidates.push(t);
  if (Array.isArray(context.write_paths)) {
    for (const p of context.write_paths) {
      const n = normalizeTarget(typeof p === 'string' ? p : null);
      if (n) candidates.push(n);
    }
  }
  return candidates.some((c) => c === prefix || c.startsWith(prefix));
}

/** Shape of a stored guard_decisions row (action_type column + context JSON text). */
export function extractDecisionShape(row: { action_type?: unknown; context?: unknown }): ActionShape {
  const actionType = typeof row.action_type === 'string' && row.action_type ? row.action_type : 'unknown';
  let target: string | null = null;
  if (typeof row.context === 'string' && row.context) {
    try {
      const ctx = JSON.parse(row.context) as { target?: unknown };
      target = normalizeTarget(typeof ctx.target === 'string' ? ctx.target : null);
    } catch {
      target = null;
    }
  }
  const prefix = targetPrefixOf(target);
  return {
    action_type: actionType,
    target_prefix: prefix,
    key: shapeKey(actionType, prefix),
    label: prefix ? `${actionType} → ${prefix}` : actionType,
  };
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git add app/lib/policy-shapes.ts __tests__/unit/policy-shapes.test.ts && git commit -m "feat(guard): action shape lib for grants + review grouping"`

---

### Task 3: Guard engine — `warn_action_type` evaluator + `allow_grant` post-pass

**Files:**
- Modify: `app/lib/guard.ts` (evaluator map ~line 1218; post-pass after `runLocalPolicies` call inside `evaluateGuard` ~lines 841-908)
- Test: `__tests__/unit/guard-allow-grant.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Copy the mock prelude verbatim from `__tests__/unit/policy-modes-compile.test.ts:1-30` (the `vi.hoisted` block and the six `vi.mock` calls for webhooks/llm/embeddings/security/predictive-risk/settings.repository), then:

```typescript
// __tests__/unit/guard-allow-grant.test.ts  (after the copied mock prelude)
import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

let orgN = 0;
const freshOrg = () => `org_grant_${++orgN}`;

function rows(policies: Array<{ policy_type: string; rules: Record<string, unknown>; name?: string }>) {
  return policies.map((p, i) => ({
    id: `gp_t_${i}`,
    name: p.name ?? `P${i}`,
    policy_type: p.policy_type,
    rules: JSON.stringify(p.rules),
    agent_ids: null,
  }));
}

const CTX = {
  agent_id: 'agent_1',
  action_type: 'api',
  declared_goal: 'call stripe',
  target: 'https://api.stripe.com/v1/charges',
};

describe('warn_action_type evaluator', () => {
  beforeEach(() => __resetGuardCaches());
  it('warns (does not gate) on a matching action type', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'warn_action_type', rules: { action_types: ['api'] } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('warn');
  });
});

describe('allow_grant post-pass', () => {
  beforeEach(() => __resetGuardCaches());

  it('downgrades warn → allow when a grant matches', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'warn_action_type', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api', target_prefix: 'api.stripe.com' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
  });

  it('downgrades require_approval → allow when a grant matches', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
  });

  it('NEVER downgrades block', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'block_action_type', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('block');
  });

  it('does not downgrade when the grant shape does not match', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api', target_prefix: 'github.com' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
  });
});
```

NOTE: `createSqlMock` taggedResponses may need additional empty responses for follow-up queries (rate-limit counts, decision persist). Look at how `policy-modes-compile.test.ts` drives `evaluateGuard` and mirror its sql-mock setup exactly — including any `?record=` / persist behavior. If `evaluateGuard` has a different arity (check its signature at `app/lib/guard.ts:~841`), adapt the call, not the assertions.

- [ ] **Step 2: Run — expect FAIL** (`warn_action_type` unknown → decision allow; grants ignored).

- [ ] **Step 3: Implement in `app/lib/guard.ts`:**

(a) In `POLICY_EVALUATORS` (~line 1229, next to `require_approval`):

```typescript
  warn_action_type: ({ rules, context }) =>
    matchActionType(rules, context, 'warn', (t) => `Action type "${t}" recorded for review`),
  allow_grant: () => null, // grants run as a post-pass, not as a raising evaluator
```

(b) Add the post-pass function near `runLocalPolicies` (after line 479):

```typescript
import { grantMatches } from './policy-shapes';  // add to imports at top

/**
 * allow_grant post-pass: a matching grant downgrades warn / require_approval
 * to allow. It can NEVER override block — blocks are absolute.
 */
function applyAllowGrants(policies: PolicyRow[], context: GuardEvalContext, acc: GuardAccumulator): void {
  if (acc.highestDecision !== 'warn' && acc.highestDecision !== 'require_approval') return;
  for (const policy of policies) {
    if (policy.policy_type !== 'allow_grant') continue;
    let rules: PolicyRules;
    try {
      rules = JSON.parse(policy.rules);
    } catch {
      continue;
    }
    if (grantMatches(rules as { action_type?: unknown; target_prefix?: unknown }, context)) {
      acc.warnings.push(`${policy.name}: grant downgraded ${acc.highestDecision} to allow`);
      acc.matchedPolicies.push(policy.id);
      acc.highestDecision = 'allow';
      acc.reasons.length = 0; // gating reasons no longer apply
      return;
    }
  }
}
```

(c) In `evaluateGuard`, find the call `await runLocalPolicies(policies, deps, adjustedRiskScore, acc)` (~within lines 841-908) and insert immediately after it:

```typescript
applyAllowGrants(policies, context, acc);
```

IMPORTANT: if there are later phases that can still raise the decision after `runLocalPolicies` (e.g. webhook_check escalation, x402 outcome phases), read the surrounding flow and place `applyAllowGrants` after the LAST point where warn/require_approval can be raised by org policies, but BEFORE the decision is persisted/finalized (`persistGuardDecision` / `buildGuardResult`). State in the commit message where it landed and why.

- [ ] **Step 4: Run the new test — expect PASS. Then run the full guard-adjacent suites:** `npx vitest run __tests__/unit/policy-modes-compile.test.ts __tests__/unit/guard-allow-grant.test.ts` plus any `guard*.test.*` files.

- [ ] **Step 5: Commit** — `git add app/lib/guard.ts __tests__/unit/guard-allow-grant.test.ts && git commit -m "feat(guard): warn_action_type evaluator + allow_grant downgrade post-pass"`

---

### Task 4: Recompile the claude-code mode + catalog copy

**Files:**
- Modify: `app/lib/policy-modes/compile.ts` (claude-code builder lines 111-137; header comment line 5 "13 live" → 15; `nominalDecision` lines 318-336)
- Modify: `app/lib/policy-modes/catalog.ts` (claude-code entry lines 42-78)
- Modify: `__tests__/unit/policy-modes-compile.test.ts` (expected multiset + rule values)
- Check/modify: the mode-preview friction simulation (grep `block_action_type` under `app/lib/policy-modes/` and `app/api/policies/modes/preview/` — wherever deterministic types are simulated, add `warn_action_type` → warn)

- [ ] **Step 1: Update the compile test FIRST** (it pins exact rule values). In `policy-modes-compile.test.ts`, the claude-code multiset becomes:

```typescript
    expect(counts).toEqual({
      risk_threshold: 2,
      x402_spend_limit: 1,
      warn_action_type: 1,
      require_approval: 2,
      protected_path: 1,
      rate_limit: 2,
    });
```

Read the rest of that test file: it likely asserts exact rule values (e.g. `approval_threshold: 0.01`). Update every claude-code expectation to the new pack (below). If the file has behavioral assertions like "api action requires approval under claude-code", flip them to "api action warns under claude-code".

- [ ] **Step 2: Run — expect FAIL** (old pack still compiled).

- [ ] **Step 3: Replace the claude-code builder in `compile.ts`:**

```typescript
  // ── Claude Code Mode — the must-work vertical slice ──
  // "Won't interrupt normal coding": interrupts are reserved for money,
  // destruction, and secrets. External comms / sync / API calls are RECORDED
  // (warn) for the /policies review feed, not gated. Destructive shell is
  // caught by risk scoring of the declared goal (threshold 100/85).
  'claude-code': () => {
    const m = 'claude-code';
    return [
      mk(m, 'Block extreme-risk actions', 'risk_threshold', { threshold: 100, action: 'block' }),
      mk(m, 'Warn on high-risk actions', 'risk_threshold', { threshold: 85, action: 'warn' }),
      mk(m, 'Gate paid (x402) spend', 'x402_spend_limit', { approval_threshold: 5.0, max_spend_usd: 25.0 }),
      mk(m, 'Record external comms / sync / API calls', 'warn_action_type', {
        action_types: ['message', 'post', 'email', 'calendar', 'sync', 'api'],
      }),
      mk(m, 'Pause before deploy / migrate / workflow', 'require_approval', {
        action_types: ['deploy', 'migrate', 'workflow_execute'],
      }),
      mk(m, 'Pause before destructive ops', 'require_approval', {
        action_types: ['delete', 'reset', 'destroy', 'drop'],
      }),
      mk(m, 'Protect governance / auth / secrets paths', 'protected_path', {
        paths: GOVERNANCE_PROTECTED_PATHS,
        action: 'require_approval',
      }),
      mk(m, 'Warn on action bursts', 'rate_limit', { max_actions: 250, window_minutes: 30, action: 'warn' }),
      mk(m, 'Pause on runaway loops', 'rate_limit', {
        max_actions: 650,
        window_minutes: 60,
        action: 'require_approval',
      }),
    ];
  },
```

In `nominalDecision`, add before the default case:

```typescript
    case 'warn_action_type':
      return 'warn';
    case 'allow_grant':
      return 'allow' as DecisionType;
```
(If `DecisionType` already includes `'allow'` — it does, per `governance.ts:16` — drop the cast.)

Update the file-header comment "13 live GuardPolicyType values" → "15 live GuardPolicyType values".

- [ ] **Step 4: Update the catalog entry** in `catalog.ts` (claude-code, lines 42-78):

```typescript
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code Mode',
    description: 'Fast local coding and building. Interrupts only for money, destruction, and secrets.',
    purpose: 'Let a coding agent read, edit, run bash, test, lint, and build without interruption — pausing only for paid spend, deploys, migrations, destructive ops, and protected paths. Everything else is recorded for review on /policies.',
    interruptionLevel: 'low',
    uxPromise: "Won't interrupt normal coding.",
    allows: [
      'Reading files',
      'Editing files',
      'Running bash commands',
      'Running tests',
      'Linting',
      'Local builds',
    ],
    warns: [
      'External messages, posts, email, calendar',
      'State sync and outbound API calls',
      'High-risk actions (risk score ≥ 85)',
      'Bursts over 250 actions in 30 minutes',
    ],
    requiresApproval: [
      'Paid (x402) spend at or above $5.00',
      'Deploys, migrations, workflow execution',
      'Explicit destructive ops (delete / reset / destroy / drop)',
      'Edits to governance, auth, secrets, and policy paths',
      'Runaway loops (650+ actions in 60 minutes)',
    ],
    blocks: [
      'Extreme-risk actions (risk score ≥ 100)',
      'Paid (x402) spend above $25.00',
    ],
    toolVisibilityNotes: [
      'DashClaw governs only the actions your agent reports through the SDK or hooks. Routine reads, edits, and bash that are not reported are neither recorded nor gated.',
      'Destructive shell commands are caught by risk scoring of the declared goal (e.g. "rm -rf", "drop table", "truncate"), not by a dedicated "destructive" action type — so the routine `cleanup`/`build`/`test` types stay un-gated.',
      'Recorded (warn) actions land in the /policies review feed, where a one-click grant can silence a recurring shape permanently.',
    ],
  },
```

- [ ] **Step 5: Preview simulation.** Grep `app/lib/policy-modes/` and `app/api/policies/modes/preview/` for the list of deterministically-simulated policy types (it includes `block_action_type` / `require_approval` / `risk_threshold` / `protected_path` / `x402_spend_limit`). Add `warn_action_type` mapping to a `warn` outcome so the mode-preview friction summary stays honest.

- [ ] **Step 6: Run — expect PASS:** `npx vitest run __tests__/unit/policy-modes-compile.test.ts`. Also run any `policy-modes*` and `policies-modes*` test files.

- [ ] **Step 7: Commit** — `git add app/lib/policy-modes/ __tests__/unit/policy-modes-compile.test.ts <preview-sim file> && git commit -m "feat(policy-modes): claude-code mode keeps its low-interruption promise"`

---

### Task 5: Review-state settings keys

**Files:**
- Modify: `app/lib/repositories/settings.repository.ts` (`VALID_SETTING_KEYS`, lines 8-76)

- [ ] **Step 1:** Add two keys to `VALID_SETTING_KEYS`, following the existing entry style (read the file first — entries may carry category metadata):
  - `policy_review_cursor` — ISO timestamp; everything before it counts as reviewed.
  - `policy_review_dismissed` — JSON object `{ "<shapeKey>": "<ISO timestamp>" }` of per-shape dismissals.

- [ ] **Step 2:** If `settings.repository` has a unit test pinning the key list, update it. Run `npx vitest run __tests__/unit/settings*.test.*` (if present).

- [ ] **Step 3: Commit** — `git add app/lib/repositories/settings.repository.ts <test if changed> && git commit -m "feat(settings): policy review cursor + dismissed-shape keys"`

---

### Task 6: Review repository — warn groups + interrupts

**Files:**
- Create: `app/lib/repositories/policy-review.repository.ts`
- Test: `__tests__/unit/policy-review-repository.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/unit/policy-review-repository.test.ts
import { describe, expect, it, vi } from 'vitest';
import { groupWarnDecisions } from '@/lib/repositories/policy-review.repository';

const warn = (actionType: string, target: string, createdAt: string, id = Math.random().toString(36).slice(2)) => ({
  id,
  action_type: actionType,
  context: JSON.stringify({ target }),
  created_at: createdAt,
  decision: 'warn',
});

describe('groupWarnDecisions', () => {
  it('groups rows by shape with counts and latest timestamp', () => {
    const rows = [
      warn('api', 'https://api.stripe.com/v1/a', '2026-06-10T01:00:00Z'),
      warn('api', 'https://api.stripe.com/v1/b', '2026-06-10T02:00:00Z'),
      warn('sync', 'https://hub.example.com/x', '2026-06-10T03:00:00Z'),
    ];
    const groups = groupWarnDecisions(rows, {});
    expect(groups).toHaveLength(2);
    const api = groups.find((g) => g.shape.key === 'api::api.stripe.com')!;
    expect(api.count).toBe(2);
    expect(api.latest_at).toBe('2026-06-10T02:00:00Z');
    expect(api.sample_id).toBeTruthy();
  });

  it('excludes groups dismissed after their latest decision', () => {
    const rows = [warn('api', 'https://api.stripe.com/v1/a', '2026-06-10T01:00:00Z')];
    const groups = groupWarnDecisions(rows, { 'api::api.stripe.com': '2026-06-10T05:00:00Z' });
    expect(groups).toHaveLength(0);
  });

  it('keeps a dismissed group when newer decisions arrived after dismissal', () => {
    const rows = [warn('api', 'https://api.stripe.com/v1/a', '2026-06-10T06:00:00Z')];
    const groups = groupWarnDecisions(rows, { 'api::api.stripe.com': '2026-06-10T05:00:00Z' });
    expect(groups).toHaveLength(1);
  });

  it('sorts groups by count descending', () => {
    const rows = [
      warn('sync', 'https://a.example.com/x', '2026-06-10T01:00:00Z'),
      warn('api', 'https://b.example.com/x', '2026-06-10T01:00:00Z'),
      warn('api', 'https://b.example.com/y', '2026-06-10T02:00:00Z'),
    ];
    const groups = groupWarnDecisions(rows, {});
    expect(groups[0].shape.action_type).toBe('api');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```typescript
// app/lib/repositories/policy-review.repository.ts
// Review-feed data access: warn decisions grouped by shape + recent interrupts.
// Pure grouping logic is exported separately so it can be unit-tested without SQL.

import { extractDecisionShape, type ActionShape } from '../policy-shapes';

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;

const WARN_SCAN_LIMIT = 500;

export interface WarnGroup {
  shape: ActionShape;
  count: number;
  latest_at: string;
  sample_id: string;
  sample_goal: string | null;
}

export async function getWarnDecisionsSince(
  sql: SqlTag,
  orgId: string,
  sinceIso: string,
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT id, action_type, context, reason, created_at
    FROM guard_decisions
    WHERE org_id = ${orgId} AND decision = 'warn' AND created_at > ${sinceIso}
    ORDER BY created_at DESC
    LIMIT ${WARN_SCAN_LIMIT}
  `;
}

export async function getRecentInterrupts(
  sql: SqlTag,
  orgId: string,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT id, agent_id, agent_name, action_type, decision, reason, risk_score, created_at
    FROM guard_decisions
    WHERE org_id = ${orgId} AND decision IN ('require_approval', 'block')
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

/** Pure: group warn rows by shape, drop shapes dismissed after their latest row. */
export function groupWarnDecisions(
  rows: Array<Record<string, unknown>>,
  dismissed: Record<string, string>,
): WarnGroup[] {
  const groups = new Map<string, WarnGroup>();
  for (const row of rows) {
    const shape = extractDecisionShape(row);
    const createdAt = String(row.created_at ?? '');
    const existing = groups.get(shape.key);
    if (existing) {
      existing.count += 1;
      if (createdAt > existing.latest_at) existing.latest_at = createdAt;
    } else {
      let goal: string | null = null;
      if (typeof row.context === 'string') {
        try {
          const ctx = JSON.parse(row.context) as { declared_goal?: unknown };
          if (typeof ctx.declared_goal === 'string') goal = ctx.declared_goal;
        } catch { /* sample goal is best-effort */ }
      }
      groups.set(shape.key, {
        shape,
        count: 1,
        latest_at: createdAt,
        sample_id: String(row.id ?? ''),
        sample_goal: goal,
      });
    }
  }
  return [...groups.values()]
    .filter((g) => {
      const dismissedAt = dismissed[g.shape.key];
      return !dismissedAt || g.latest_at > dismissedAt;
    })
    .sort((a, b) => b.count - a.count);
}
```

Note: `created_at` from Postgres comes back as a Date or string depending on driver — coerce with `String(...)` as above, and in the route convert via `new Date(v).toISOString()` if comparisons misbehave. The dismissal comparison must compare ISO strings of the same format.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git add app/lib/repositories/policy-review.repository.ts __tests__/unit/policy-review-repository.test.ts && git commit -m "feat(policies): review repository — warn grouping + interrupts"`

---

### Task 7: Contract renderer — `app/lib/policy-modes/contract.ts`

**Files:**
- Create: `app/lib/policy-modes/contract.ts`
- Test: `__tests__/unit/policy-contract.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/unit/policy-contract.test.ts
import { describe, expect, it } from 'vitest';
import { buildContract } from '@/lib/policy-modes/contract';
import { compileMode } from '@/lib/policy-modes';

function asRows(modeId: string) {
  return compileMode(modeId).map((p, i) => ({
    id: `gp_${i}`,
    name: p.name,
    policy_type: p.policy_type,
    rules: JSON.stringify(p.rules),
    active: 1,
  }));
}

describe('buildContract', () => {
  it('renders the claude-code pack into interrupt/silent/block sentences', () => {
    const c = buildContract(asRows('claude-code'), { gp_2: 3 });
    expect(c.governed).toBe(true);
    expect(c.mode_id).toBe('claude-code');
    // x402 approval threshold is an editable interrupt sentence
    const spend = c.interrupts.find((s) => s.editable?.param === 'approval_threshold')!;
    expect(spend.text).toContain('$5.00');
    expect(spend.fired_7d).toBe(3);
    // deploy/migrate + destructive + protected paths + runaway loop are interrupts
    expect(c.interrupts.length).toBeGreaterThanOrEqual(4);
    // warn_action_type + risk-warn + burst are silent
    expect(c.silent.some((s) => s.text.toLowerCase().includes('api'))).toBe(true);
    // block tier carries risk-100 and max-spend
    expect(c.blocks.some((s) => s.editable?.param === 'max_spend_usd')).toBe(true);
  });

  it('separates grants and custom rules', () => {
    const rows = [
      ...asRows('claude-code'),
      { id: 'gp_g', name: '[Grant] api → stripe', policy_type: 'allow_grant', rules: JSON.stringify({ action_type: 'api', target_prefix: 'api.stripe.com' }), active: 1 },
      { id: 'gp_c', name: 'My custom rule', policy_type: 'semantic_check', rules: JSON.stringify({ instruction: 'no PII' }), active: 1 },
    ];
    const c = buildContract(rows, {});
    expect(c.grants).toHaveLength(1);
    expect(c.grants[0].label).toBe('api → api.stripe.com');
    expect(c.custom).toHaveLength(1);
  });

  it('reports ungoverned when no active policies', () => {
    expect(buildContract([], {}).governed).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```typescript
// app/lib/policy-modes/contract.ts
// Renders active guard policies into the /policies "interruption contract":
// plain-English sentences, grouped by tier, with live fire counts and editable
// params. Data-driven from policy rows — unknown types fall into `custom`.

import { shapeKey } from '../policy-shapes';

export interface ContractSentence {
  policy_id: string;
  text: string;
  fired_7d: number;
  editable?: { param: 'approval_threshold' | 'max_spend_usd'; value: number };
  /** Full parsed rules, present only on editable sentences (PATCH needs complete rules). */
  rules?: Record<string, unknown>;
}

export interface ContractGrant {
  policy_id: string;
  label: string;
  shape_key: string;
}

export interface ContractView {
  governed: boolean;
  mode_id: string | null;
  interrupts: ContractSentence[];
  silent: ContractSentence[];
  blocks: ContractSentence[];
  grants: ContractGrant[];
  custom: Array<{ policy_id: string; name: string; policy_type: string }>;
  friction: { interrupts_7d: number; est_seconds: number };
}

interface PolicyRowLike {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  active?: number;
}

const SECONDS_PER_INTERRUPT = 20;

const usd = (n: number) => `$${n.toFixed(2)}`;
const listTypes = (ts: unknown) => (Array.isArray(ts) ? ts.join(', ') : '');

export function buildContract(
  rows: PolicyRowLike[],
  fireCounts: Record<string, number>,
): ContractView {
  const active = rows.filter((r) => r.active === undefined || Number(r.active) === 1);
  const view: ContractView = {
    governed: active.length > 0,
    mode_id: null,
    interrupts: [],
    silent: [],
    blocks: [],
    grants: [],
    custom: [],
    friction: { interrupts_7d: 0, est_seconds: 0 },
  };

  for (const row of active) {
    let rules: Record<string, unknown>;
    try {
      rules = JSON.parse(row.rules) as Record<string, unknown>;
    } catch {
      view.custom.push({ policy_id: row.id, name: row.name, policy_type: row.policy_type });
      continue;
    }
    if (typeof rules._mode === 'string' && !view.mode_id) view.mode_id = rules._mode;
    const fired = fireCounts[row.id] ?? 0;
    const s = (text: string, editable?: ContractSentence['editable']): ContractSentence => ({
      policy_id: row.id,
      text,
      fired_7d: fired,
      ...(editable ? { editable } : {}),
    });

    switch (row.policy_type) {
      case 'x402_spend_limit': {
        const approve = Number(rules.approval_threshold ?? 0);
        const max = Number(rules.max_spend_usd ?? 0);
        view.interrupts.push({ ...s(`paid spend reaches ${usd(approve)}`, { param: 'approval_threshold', value: approve }), rules });
        view.blocks.push({ ...s(`paid spend exceeds ${usd(max)}`, { param: 'max_spend_usd', value: max }), rules });
        break;
      }
      case 'require_approval':
        view.interrupts.push(s(`action is one of: ${listTypes(rules.action_types)}`));
        break;
      case 'protected_path':
        if ((rules.action ?? 'require_approval') === 'require_approval') {
          view.interrupts.push(s('protected paths change (governance, auth, secrets)'));
        } else {
          view.silent.push(s('protected paths change (recorded)'));
        }
        break;
      case 'rate_limit': {
        const txt = `more than ${rules.max_actions} actions in ${rules.window_minutes} minutes`;
        if (rules.action === 'require_approval') view.interrupts.push(s(`runaway loop: ${txt}`));
        else if (rules.action === 'block') view.blocks.push(s(txt));
        else view.silent.push(s(`burst: ${txt}`));
        break;
      }
      case 'risk_threshold': {
        const txt = `risk score reaches ${rules.threshold}`;
        if (rules.action === 'block') view.blocks.push(s(txt));
        else if (rules.action === 'require_approval') view.interrupts.push(s(txt));
        else view.silent.push(s(txt));
        break;
      }
      case 'warn_action_type':
        view.silent.push(s(`${listTypes(rules.action_types)} calls (recorded for review)`));
        break;
      case 'block_action_type':
        view.blocks.push(s(`action is one of: ${listTypes(rules.action_types)}`));
        break;
      case 'allow_grant': {
        const at = String(rules.action_type ?? '');
        const tp = rules.target_prefix == null ? null : String(rules.target_prefix);
        view.grants.push({
          policy_id: row.id,
          label: tp ? `${at} → ${tp}` : at,
          shape_key: shapeKey(at, tp),
        });
        break;
      }
      default:
        view.custom.push({ policy_id: row.id, name: row.name, policy_type: row.policy_type });
    }
  }

  const interrupts7d = view.interrupts.reduce((sum, x) => sum + x.fired_7d, 0);
  view.friction = { interrupts_7d: interrupts7d, est_seconds: interrupts7d * SECONDS_PER_INTERRUPT };
  return view;
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git add app/lib/policy-modes/contract.ts __tests__/unit/policy-contract.test.ts && git commit -m "feat(policies): contract renderer — policies to plain-English sentences"`

---

### Task 8: API routes — contract, review, verdict

**Files:**
- Create: `app/api/policies/contract/route.ts`
- Create: `app/api/policies/review/route.ts`
- Create: `app/api/policies/review/verdict/route.ts`
- Tests: `__tests__/unit/policies-contract.route.test.ts`, `__tests__/unit/policies-review.route.test.ts` (create)

Pattern source: copy the mock prelude of `__tests__/unit/policies.route.test.js:1-25` (mock `@/lib/db.js`, events; auth via `x-org-id` / role headers — check how `getOrgRole` reads role in `app/lib/org` and how existing tests set admin). For repository-using routes, mock the repository modules instead of raw sql where simpler.

- [ ] **Step 1: Write failing route tests** — minimum coverage:
  - `GET /api/policies/contract` → 200 with `{ governed, interrupts, silent, blocks, grants, custom, friction }` (mock `getActivePolicies` + `getDecisionCountsByPolicy`); 500 on repo error.
  - `GET /api/policies/review` → 200 with `{ groups, interrupts, cursor }`; default cursor = 7 days back when no setting exists.
  - `POST /api/policies/review/verdict` → 403 non-admin; `always_allow` calls `insertPolicy` with `policy_type: 'allow_grant'` and correct rules; `tighten` with a host shape creates `require_approval` `{action_types:[...]}`; `tighten` with a path shape (`target_prefix` containing `/`) creates `protected_path` with `paths: ['<prefix>**']`; `fine` upserts the dismissed map; `mark_all_reviewed` sets the cursor; invalid verdict → 400.

- [ ] **Step 2: Run — expect FAIL (modules missing).**

- [ ] **Step 3: Implement the three routes.**

```typescript
// app/api/policies/contract/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { getActivePolicies, getDecisionCountsByPolicy } from '../../../lib/repositories/guardrails.repository';
import { buildContract } from '../../../lib/policy-modes/contract';

/** GET /api/policies/contract — the interruption contract for the org. */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const [active, counts] = await Promise.all([
      getActivePolicies(sql, orgId),
      getDecisionCountsByPolicy(sql, orgId, 7).catch(() => ({})),
    ]);
    const contract = buildContract(
      active as Array<{ id: string; name: string; policy_type: string; rules: string; active?: number }>,
      counts as Record<string, number>,
    );
    return NextResponse.json(contract);
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_CONTRACT GET');
  }
}
```

Verify `getDecisionCountsByPolicy(sql, orgId, days)` returns `Record<policyId, count>` (read its body in `guardrails.repository.ts`); if the shape differs (e.g. array of rows), adapt in the route, not the renderer.

```typescript
// app/api/policies/review/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import {
  getWarnDecisionsSince,
  getRecentInterrupts,
  groupWarnDecisions,
} from '../../../lib/repositories/policy-review.repository';
import { getSettings } from '../../../lib/repositories/settings.repository';

const DEFAULT_WINDOW_DAYS = 7;

/** GET /api/policies/review — warn groups since the review cursor + recent interrupts. */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();

    const settings = await getSettings(sql, orgId).catch(() => []);
    const byKey = new Map(
      (settings as Array<{ key: string; value: string | null }>).map((s) => [s.key, s.value]),
    );
    const cursor =
      byKey.get('policy_review_cursor') ||
      new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();
    let dismissed: Record<string, string> = {};
    try {
      dismissed = JSON.parse(byKey.get('policy_review_dismissed') || '{}');
    } catch { /* corrupt setting → treat as none dismissed */ }

    const [warnRows, interrupts] = await Promise.all([
      getWarnDecisionsSince(sql, orgId, cursor),
      getRecentInterrupts(sql, orgId, 20),
    ]);

    return NextResponse.json({
      groups: groupWarnDecisions(warnRows, dismissed),
      interrupts,
      cursor,
    });
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_REVIEW GET');
  }
}
```

NOTE: `getSettings` signature must be verified in `settings.repository.ts` (it may take a category or keys filter). Same for the upsert used below — find the exported upsert (the one that enforces `VALID_SETTING_KEYS`) and use its real name/signature.

```typescript
// app/api/policies/review/verdict/route.ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getOrgId, getOrgRole } from '../../../../lib/org';
import { getSql } from '../../../../lib/db';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { insertPolicy } from '../../../../lib/repositories/guardrails.repository';
import { getSettings, upsertSetting } from '../../../../lib/repositories/settings.repository';
import { shapeKey } from '../../../../lib/policy-shapes';

const VERDICTS = ['fine', 'always_allow', 'tighten', 'mark_all_reviewed'] as const;
type Verdict = (typeof VERDICTS)[number];

const gpId = () => `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

/**
 * POST /api/policies/review/verdict — act on a review-feed group (admin only).
 * Body: { verdict, shape?: { action_type, target_prefix? } }
 *  - fine:            dismiss the shape (review state only)
 *  - always_allow:    create an allow_grant for the shape
 *  - tighten:         create require_approval (host/type shapes) or protected_path (path shapes)
 *  - mark_all_reviewed: advance the org review cursor to now
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    const verdict = body.verdict as Verdict;
    if (!VERDICTS.includes(verdict)) {
      return NextResponse.json({ error: `verdict must be one of: ${VERDICTS.join(', ')}` }, { status: 400 });
    }
    const sql = getSql();
    const now = new Date().toISOString();

    if (verdict === 'mark_all_reviewed') {
      await upsertSetting(sql, orgId, 'policy_review_cursor', now);
      return NextResponse.json({ ok: true, cursor: now });
    }

    const shape = body.shape as { action_type?: string; target_prefix?: string | null } | undefined;
    if (!shape || typeof shape.action_type !== 'string' || !shape.action_type) {
      return NextResponse.json({ error: 'shape.action_type is required' }, { status: 400 });
    }
    const prefix = typeof shape.target_prefix === 'string' && shape.target_prefix ? shape.target_prefix : null;
    const key = shapeKey(shape.action_type, prefix);
    const label = prefix ? `${shape.action_type} → ${prefix}` : shape.action_type;

    if (verdict === 'fine') {
      const settings = await getSettings(sql, orgId).catch(() => []);
      const row = (settings as Array<{ key: string; value: string | null }>).find(
        (s) => s.key === 'policy_review_dismissed',
      );
      let dismissed: Record<string, string> = {};
      try {
        dismissed = JSON.parse(row?.value || '{}');
      } catch { /* reset corrupt map */ }
      dismissed[key] = now;
      await upsertSetting(sql, orgId, 'policy_review_dismissed', JSON.stringify(dismissed));
      return NextResponse.json({ ok: true, dismissed: key });
    }

    if (verdict === 'always_allow') {
      const policy = await insertPolicy(sql, orgId, {
        id: gpId(),
        name: `[Grant] ${label}`,
        policyType: 'allow_grant',
        rules: JSON.stringify({ action_type: shape.action_type, ...(prefix ? { target_prefix: prefix } : {}), _grant: true }),
      });
      return NextResponse.json({ ok: true, policy }, { status: 201 });
    }

    // tighten: path shapes become protected_path; host/type shapes become require_approval
    const isPath = !!prefix && prefix.includes('/');
    const policy = await insertPolicy(sql, orgId, {
      id: gpId(),
      name: `[Tightened] ${label}`,
      policyType: isPath ? 'protected_path' : 'require_approval',
      rules: isPath
        ? JSON.stringify({ paths: [`${prefix}**`], action: 'require_approval', _tightened: true })
        : JSON.stringify({ action_types: [shape.action_type], _tightened: true }),
    });
    return NextResponse.json({ ok: true, policy }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === '23505' || (err as Error).message?.includes('guard_policies_org_name_unique')) {
      return NextResponse.json({ error: 'A rule for this shape already exists' }, { status: 409 });
    }
    return apiErrorResponse(err, 'POLICY_REVIEW_VERDICT POST');
  }
}
```

(`insertPolicy` already calls `invalidateGuardPolicyCache` — no extra invalidation needed. Verify `InsertPolicyData` allows omitting `agentIds`/`active` — it defaults `active = 1`.)

- [ ] **Step 4: Run route tests — expect PASS.**
- [ ] **Step 5: Commit** — `git add app/api/policies/contract app/api/policies/review __tests__/unit/policies-contract.route.test.ts __tests__/unit/policies-review.route.test.ts && git commit -m "feat(api): /api/policies/contract + /review + /review/verdict"`

---

### Task 9: Demo middleware handlers

**Files:**
- Modify: `middleware.js` (route table ~line 1060; `handleDemoPolicySimulations` ~line 1177)

- [ ] **Step 1:** Read the `demoFixtureRoute` + `demoPolicies` fixture pattern around `middleware.js:1060` and the demo fixtures module it pulls from. Add demo GET handlers for `/api/policies/contract` and `/api/policies/review` returning static fixtures shaped exactly like the real responses (a governed claude-code contract with 3 interrupt sentences / 2 silent / 1 grant, and a review payload with 2 warn groups + 1 interrupt). Follow the existing fixture style (same file the other demo policy fixtures live in).
- [ ] **Step 2:** In `handleDemoPolicySimulations`, add:

```javascript
  if (pathname === '/api/policies/review/verdict') {
    return demoJson(request, { ok: true, demo: true });
  }
```

(POST interception must stay BEFORE the demo write-block — this function already runs pre-write-block; keep the new branch inside it.)
- [ ] **Step 3:** If a demo-routes unit test pins the route table (grep `__tests__/unit/` for `demoFixtureRoute` or `handleDemoPolicySimulations`), update it. Run those tests.
- [ ] **Step 4: Commit** — `git add middleware.js <fixtures file> <tests> && git commit -m "feat(demo): demo handlers for policy contract + review routes"`

---

### Task 10: UI — client lib, ContractPanel, ReviewFeed, cockpit rebuild

Read `.impeccable.md` before this task. Calm instrument panel; orange only for "needs you"; tokens only; `tabular-nums` on counts; lucide icons 14-20px inline.

**Files:**
- Create: `app/policies/lib/contractClient.ts`
- Create: `app/policies/components/ContractPanel.tsx`
- Create: `app/policies/components/ReviewFeed.tsx`
- Modify: `app/policies/components/PolicyCockpit.tsx`
- Tests: `__tests__/unit/contract-panel.test.tsx`, `__tests__/unit/review-feed.test.tsx` (create)

- [ ] **Step 1: Client lib**

```typescript
// app/policies/lib/contractClient.ts
// Browser client for the contract + review endpoints.
import type { ContractView } from '../../lib/policy-modes/contract';
import type { WarnGroup } from '../../lib/repositories/policy-review.repository';

export type { ContractView, WarnGroup };

export interface ReviewPayload {
  groups: WarnGroup[];
  interrupts: Array<Record<string, unknown>>;
  cursor: string;
}

export type ReviewVerdict = 'fine' | 'always_allow' | 'tighten' | 'mark_all_reviewed';

export async function fetchContract(): Promise<ContractView> {
  const res = await fetch('/api/policies/contract');
  if (!res.ok) throw new Error(`Failed to load contract (${res.status})`);
  return res.json();
}

export async function fetchReview(): Promise<ReviewPayload> {
  const res = await fetch('/api/policies/review');
  if (!res.ok) throw new Error(`Failed to load review feed (${res.status})`);
  return res.json();
}

export async function postVerdict(
  verdict: ReviewVerdict,
  shape?: { action_type: string; target_prefix: string | null },
): Promise<void> {
  const res = await fetch('/api/policies/review/verdict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verdict, ...(shape ? { shape } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Verdict failed (${res.status})`);
  }
}

/** Update a single editable threshold on a policy (spend approve/block). */
export async function patchPolicyParam(
  policyId: string,
  currentRules: Record<string, unknown>,
  param: 'approval_threshold' | 'max_spend_usd',
  value: number,
): Promise<void> {
  const res = await fetch('/api/policies', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: policyId, rules: { ...currentRules, [param]: value } }),
  });
  if (!res.ok) throw new Error(`Failed to update threshold (${res.status})`);
}
```

NOTE on `patchPolicyParam`: the PATCH route validates full rules, so the caller must send the complete rules object. Task 7's renderer already populates `rules` on editable sentences for exactly this reason — pass `sentence.rules` through.

- [ ] **Step 2: Render tests (failing first).** Follow repo conventions — container queries, no jest-dom, mock `next/navigation`:

```tsx
// __tests__/unit/review-feed.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import ReviewFeed from '@/policies/components/ReviewFeed';

const group = {
  shape: { action_type: 'api', target_prefix: 'api.stripe.com', key: 'api::api.stripe.com', label: 'api → api.stripe.com' },
  count: 23,
  latest_at: '2026-06-10T02:00:00Z',
  sample_id: 'gd_1',
  sample_goal: 'call stripe',
};

describe('ReviewFeed', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders warn groups with counts and verdict buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes('/review')
          ? { groups: [group], interrupts: [], cursor: '2026-06-03T00:00:00Z' }
          : {},
    })));
    const { container } = render(<ReviewFeed />);
    await waitFor(() => {
      expect(container.textContent).toContain('api → api.stripe.com');
      expect(container.textContent).toContain('23');
    });
    expect(container.querySelectorAll('button').length).toBeGreaterThanOrEqual(3);
  });

  it('posts an always_allow verdict and removes the group', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) };
      return {
        ok: true,
        json: async () => ({ groups: [group], interrupts: [], cursor: '2026-06-03T00:00:00Z' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<ReviewFeed />);
    await waitFor(() => expect(container.textContent).toContain('api → api.stripe.com'));
    fireEvent.click(getByText(/always allow/i));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
        verdict: 'always_allow',
        shape: { action_type: 'api' },
      });
    });
  });

  it('shows the empty state when nothing needs review', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ groups: [], interrupts: [], cursor: '2026-06-03T00:00:00Z' }),
    })));
    const { container } = render(<ReviewFeed />);
    await waitFor(() => expect(container.textContent).toMatch(/nothing to review/i));
  });
});
```

```tsx
// __tests__/unit/contract-panel.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import ContractPanel from '@/policies/components/ContractPanel';

const contract = {
  governed: true,
  mode_id: 'claude-code',
  interrupts: [
    { policy_id: 'gp_x', text: 'paid spend reaches $5.00', fired_7d: 1, editable: { param: 'approval_threshold', value: 5 }, rules: { approval_threshold: 5, max_spend_usd: 25 } },
    { policy_id: 'gp_d', text: 'action is one of: deploy, migrate, workflow_execute', fired_7d: 0 },
  ],
  silent: [{ policy_id: 'gp_w', text: 'message, post, email, calendar, sync, api calls (recorded for review)', fired_7d: 23 }],
  blocks: [{ policy_id: 'gp_x', text: 'paid spend exceeds $25.00', fired_7d: 0, editable: { param: 'max_spend_usd', value: 25 }, rules: { approval_threshold: 5, max_spend_usd: 25 } }],
  grants: [{ policy_id: 'gp_g', label: 'api → api.stripe.com', shape_key: 'api::api.stripe.com' }],
  custom: [],
  friction: { interrupts_7d: 2, est_seconds: 40 },
};

describe('ContractPanel', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('renders interrupt sentences with fire counts and the friction line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => contract })));
    const { container } = render(<ContractPanel onChangeMode={() => {}} onContractChanged={() => {}} />);
    await waitFor(() => {
      expect(container.textContent).toContain('paid spend reaches $5.00');
      expect(container.textContent).toContain('Interrupt me only when');
      expect(container.textContent).toMatch(/2 interrupts/);
    });
  });

  it('renders grants as removable lines', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => contract })));
    const { container } = render(<ContractPanel onChangeMode={() => {}} onContractChanged={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain('api → api.stripe.com'));
  });
});
```

- [ ] **Step 3: Run — expect FAIL. Then implement the components.**

`ReviewFeed.tsx` requirements (implement fully; structure below is binding, classNames are guidance to match existing cockpit components):
- `'use client'`; loads `fetchReview()` on mount; loading skeleton (reuse `Skeleton` like PolicyCockpit), error state with Retry (match the cockpit's error pattern: `text-tertiary` message + `text-brand` retry button).
- Section header: tiny uppercase mono label `TO REVIEW` + `· {totalCount} recorded since {date}` (`text-tertiary`, `tabular-nums`).
- Each group row: `▸ {count}× {label}` (count in `tabular-nums text-secondary`), `sample_goal` as a muted second line if present, and three verdict buttons: `Fine` (ghost), `Always allow` (ghost), `Tighten` (ghost with `text-status-warning`). Buttons call `postVerdict(...)` with the group's shape, optimistically remove the row, restore on error with an inline error line (mutations → inline, per the repo error-handling pattern).
- "Mark all reviewed" text button in the header → `postVerdict('mark_all_reviewed')` → refetch.
- Below groups: `INTERRUPTED YOU ({n})` section listing `interrupts` rows: decision badge (require_approval → `text-status-warning`, block → `text-status-error`), action_type, agent label, relative time. Read-only.
- Empty state: "Nothing to review — your agents stayed inside the contract." (`text-tertiary`, calm, no decoration).

`ContractPanel.tsx` requirements:
- Props: `{ onChangeMode: () => void; onContractChanged: () => void }`. Loads `fetchContract()` on mount; exposes refetch after edits.
- Header row: tiny uppercase mono label `YOUR INTERRUPTION CONTRACT`; right side a quiet button `mode: {mode_id} ▾` calling `onChangeMode` (this is how ModeDrawer opens).
- "Interrupt me only when:" list — each sentence `· {text}` with right-aligned `fired {n}× this wk` (`tabular-nums text-tertiary`; when `fired_7d > 0` use `text-secondary`). Editable sentences render the dollar amount as an inline `<select>` of sensible steps (`$1, $5, $10, $25, $50` for approve; `$10, $25, $50, $100` for block) wired to `patchPolicyParam(policy_id, rules, param, value)` then refetch + `onContractChanged()`.
- "Hard stops:" sub-list for `blocks` (same row treatment).
- Line: "Everything else is recorded silently below." (`text-tertiary`) followed by the silent sentences in a collapsed `Disclosure` (reuse `app/policies/components/Disclosure.tsx`) titled `Recorded silently ({n})`.
- Grants: `Never bother me about:` list, each with a `✕` button → `DELETE /api/policies?id={policy_id}` → refetch. Only render when grants exist.
- Custom rules: collapsed `Disclosure` `+ {n} custom rules` listing name + policy_type, linking to `/policies/rules`.
- Friction line: `Friction this week: {interrupts_7d} interrupts · ~{est_seconds}s of your time` — `text-tertiary`, `tabular-nums`. This is evidence, not alarm: no orange unless `interrupts_7d > 0` is NOT a "needs you" state — keep it neutral always.
- Ungoverned (`governed: false`): render nothing — the cockpit's existing ungoverned empty state handles it.

- [ ] **Step 4: Rebuild `PolicyCockpit.tsx`.** Keep: loading skeleton, error+Retry, the ungoverned empty state, `ModeDrawer` + `drawerOpen` state, the `policyHighlight` deep-link param (pass it to ReviewFeed or drop into ContractPanel's custom list — keep the param read, pass as `highlight` to ContractPanel and render a `border-active` ring on the matching custom rule). Replace the governed branch body:

```tsx
  return (
    <div className="max-w-3xl space-y-8">
      <ContractPanel onChangeMode={() => setDrawerOpen(true)} onContractChanged={load} />
      <ReviewFeed />
      <ModeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onApplied={load} />
    </div>
  );
```

The cockpit still calls `fetchSummary()` to decide `governed` / ungoverned (keep that logic and the shields data for Step 5). Remove the `RecentDigest` fetch of `/api/guard/decisions` (ReviewFeed owns activity now).

- [ ] **Step 5: Shields → "Add protection".** Move the shield toggle UI into ContractPanel as a collapsed `Disclosure` titled `Add protection` listing the SHIELDS toggles — port `handleShieldToggle` from the cockpit (it can live in ContractPanel, reusing `SHIELDS`, `matchShieldsToPolicies`, `buildShieldPayload` from `../lib/shields`); after a toggle, refetch the contract (active shields now appear as contract sentences via their compiled types). Then delete the now-unused imports in PolicyCockpit.

- [ ] **Step 6: Retire dead components.** `grep -r "PostureHeader\|EnforcementSummary\|RecentDigest\|ShieldList" app/ __tests__/` — for each file with zero remaining imports, `git rm` it. If something else imports one (e.g. rules page), leave that file and note it in the commit message.

- [ ] **Step 7: Run the FULL suite** (`npx vitest run`) — new-hook-in-shared-component breakage shows up in unrelated render tests (known repo gotcha). Fix any fallout.

- [ ] **Step 8: Commit** — `git add app/policies __tests__/unit/contract-panel.test.tsx __tests__/unit/review-feed.test.tsx && git commit -m "feat(policies): contract page — interruption contract + review feed"` (include deletions).

---

### Task 11: Docs, counts, and gates

- [ ] **Step 1:** Grep for the stale counts and fix in the same commit:
  - `grep -rn "13 policy types\|13 live\|thirteen" README.md PROJECT_DETAILS.md docs/ app/lib/policy-modes/` → update to 15.
  - Grep docs for descriptions of claude-code mode behavior (`"every 10\|0.01\|spend at or above"` in README/PROJECT_DETAILS/docs) → align with the new pack ($5 approve / $25 block, comms warn-not-gate).
  - `npm run check-doc-counts -- --strict` if that script alias exists (`node scripts/check-doc-counts.mjs --strict`) — fix anything it flags.
- [ ] **Step 2:** Run the gates and READ output: `npm run lint`, `npm run typecheck`, `npx vitest run` (full), `npx next build` (app/** changed). Use the dashclaw-gate-runner agent to keep logs out of the main thread.
- [ ] **Step 3: Commit** docs/count fixes.

**Out of scope (per spec §7):** approval dedupe, trust ramp, push digests, batching. Shipping (version bump, livingcode refresh, doc regeneration, deploy) is owned by the `/dashclaw-ship` skill after this plan completes.
