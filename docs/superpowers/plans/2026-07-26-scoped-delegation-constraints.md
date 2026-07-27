# Scoped Delegation Constraints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A new guard policy type, `delegation_constraint`, makes a composed subagent's effective authority a provable subset of its parent's — risk ceiling, action-type allow/block lists, path scope, spawn depth, optional verified-identity requirement — enforced server-side on every guard call from a `parent:child` identity. RFC: `docs/rfcs/2026-07-06-scoped-delegation-grants.md` (invariants bind; incidentals reconciled below).

**Architecture:** It's a policy type, not a subsystem: one evaluator in `POLICY_EVALUATOR_MAP` (the 15th — the RFC's "18th" predates the v5.0.0 cull), one validator in `validate.js`, UI via the existing /policies rails (type picker, rule-builder branch, shield, ledger describer), one SDK convenience wrapper per language. **NO new tables, NO new routes, NO migration, NO hook changes** — assert this stayed true at review.

**Post-cull reconciliations (recorded, binding for this plan):**
- `/agents/[agentId]` and `/swarm` no longer exist. The RFC's Delegation-panel surface is replaced by /policies alone: the Subagent Constraint shield + a rule-builder branch whose parent/child pickers are SEEDED from observed composed identities (`GET /api/agents` roster — ids containing `:`). The "seeded from reality, zero identifier typing" invariant survives; the culled page does not come back.
- Risk-ceiling ordering: **option (a) at full strength** — `runLocalPolicies` receives `adjustedRiskScore` AFTER predictive folding (evaluate.ts:943→965), passed to evaluators as `effectiveRiskScore`. No dedicated pass needed. Document in the evaluator comment.
- Open question 3: provenance-mode callers (base agent_id + `intel.subagent`) are OUT of v1 scope — the evaluator keys on the composed `agent_id` string only ('distinct' is the default hook mode since fleet-identities v2.2). Documented in the evaluator comment and runtime-api.

## Global Constraints

- **Tighten-only:** the evaluator only raises (`require_approval` or `block` via escalate_action); no grant path exists in this type. Non-composed callers (no `:` in agent_id) are a hard no-op — zero behavior change for single-agent fleets.
- **Reuse, never duplicate:** path matching uses `matchesProtectedPath` from `app/lib/guard/protected-path.ts` and the same candidate extraction as `protected_path` (`context.target` + `context.write_paths`). A second glob matcher is a plan violation.
- **applyResult prefixes `${policy.name}: ${reason}`** — evaluator reasons carry only the specifics, no policy-name duplication.
- Three files move together for the new type: `app/lib/validate.js` (POLICY_TYPES + POLICY_TYPE_VALIDATORS), `app/lib/guard/policy.ts` (POLICY_EVALUATORS), the `GuardPolicyType` union in `app/lib/types`.
- Surface budget (same commit as the surfaces, Task 6): guardPolicyTypes 14→15, sdkNodeMethods 36→37, sdkPythonMethods 56→57 + THESIS ceilings table + amendment log.
- Count citations that move: policy types 14→15 and shields 9→10 wherever `check-doc-counts` gates them; SDK 36/56→37/57 (parity docs, READMEs, guide JSON method_count fields).
- Risk scores are 0–100. No co-author footers on commits. `.launch/` stays untouched.

---

### Task 1: The evaluator + type union + unit matrix

**Files:**
- Modify: `app/lib/guard/policy.ts` (POLICY_EVALUATORS — insert `delegation_constraint` after `require_evidence`)
- Modify: the `GuardPolicyType` union (find it: `grep -rn "GuardPolicyType" app/lib/types*` — referenced by `app/lib/policy-modes/compile.ts:12`)
- Test: `__tests__/unit/guard-delegation-constraint.test.js`

**Interfaces:**
- Produces: evaluator keyed `delegation_constraint` with the exact rules schema from the RFC; matches composed agent_ids; returns `{ action: rules.escalate_action || 'require_approval', reason }` on violation, null otherwise.

- [ ] **Step 1: Write the failing test matrix** (style of `__tests__/unit/behavior-guard-protected-path.test.js` — direct `evaluatePolicy` calls, null sql):

```js
import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';

const policy = { id: 'p_dc', name: 'DC', policy_type: 'delegation_constraint' };
const ev = (rules, context, risk = 0) => evaluatePolicy(policy, rules, context, null, 'org_1', risk);

describe('delegation_constraint evaluator', () => {
  const base = { parent: 'claude-code', child_types: ['*'], escalate_action: 'require_approval' };

  it('is a hard no-op for non-composed callers', async () => {
    expect(await ev({ ...base, max_risk_score: 0 }, { agent_id: 'claude-code', action_type: 'deploy' }, 99)).toBeNull();
  });

  it('parent mismatch → no-op; wildcard parent matches', async () => {
    expect(await ev({ ...base, max_risk_score: 0 }, { agent_id: 'codex:explore' }, 50)).toBeNull();
    expect(await ev({ ...base, parent: '*', max_risk_score: 0 }, { agent_id: 'codex:explore' }, 50)).not.toBeNull();
  });

  it('child_types filters; * matches any', async () => {
    const r = { ...base, child_types: ['explore'], max_risk_score: 0 };
    expect(await ev(r, { agent_id: 'claude-code:explore' }, 50)).not.toBeNull();
    expect(await ev(r, { agent_id: 'claude-code:builder' }, 50)).toBeNull();
  });

  it('depth: a:b passes max_depth 1, a:b:c trips it', async () => {
    const r = { ...base, max_depth: 1 };
    expect(await ev(r, { agent_id: 'claude-code:explore' }, 0)).toBeNull();
    const hit = await ev(r, { agent_id: 'claude-code:explore:sub' }, 0);
    expect(hit.action).toBe('require_approval');
    expect(hit.reason).toMatch(/depth/i);
  });

  it('risk ceiling: at boundary passes, above trips', async () => {
    const r = { ...base, max_risk_score: 60 };
    expect(await ev(r, { agent_id: 'claude-code:explore' }, 60)).toBeNull();
    expect((await ev(r, { agent_id: 'claude-code:explore' }, 61)).reason).toMatch(/risk/i);
  });

  it('blocked_action_types and allowed_action_types', async () => {
    expect((await ev({ ...base, blocked_action_types: ['deploy'] }, { agent_id: 'claude-code:x', action_type: 'deploy' }, 0)).reason).toMatch(/deploy/);
    expect(await ev({ ...base, allowed_action_types: ['read'] }, { agent_id: 'claude-code:x', action_type: 'read' }, 0)).toBeNull();
    expect((await ev({ ...base, allowed_action_types: ['read'] }, { agent_id: 'claude-code:x', action_type: 'write' }, 0)).reason).toMatch(/write/);
  });

  it('blocked_path_globs uses protected_path semantics on target + write_paths', async () => {
    const r = { ...base, blocked_path_globs: ['**/.env*', 'prod/**'] };
    expect((await ev(r, { agent_id: 'claude-code:x', target: 'apps/web/.env.local' }, 0)).reason).toMatch(/\.env/);
    expect((await ev(r, { agent_id: 'claude-code:x', write_paths: ['prod/deploy.sh'] }, 0)).reason).toMatch(/prod/);
    expect(await ev(r, { agent_id: 'claude-code:x', target: 'docs/readme.md' }, 0)).toBeNull();
  });

  it('require_verified_parent fails closed on unverified', async () => {
    const r = { ...base, require_verified_parent: true };
    expect((await ev(r, { agent_id: 'claude-code:x', verification_status: 'unverified' }, 0)).reason).toMatch(/verif/i);
    expect(await ev(r, { agent_id: 'claude-code:x', verification_status: 'verified' }, 0)).toBeNull();
  });

  it('escalate_action block is honored; default is require_approval', async () => {
    expect((await ev({ ...base, escalate_action: 'block', max_risk_score: 0 }, { agent_id: 'claude-code:x' }, 1)).action).toBe('block');
    expect((await ev({ parent: '*', child_types: ['*'], max_risk_score: 0 }, { agent_id: 'a:b' }, 1)).action).toBe('require_approval');
  });

  it('constrains a composed id that has no identity row (base-fallback cannot defeat it)', async () => {
    // Pure string matching — no sql involved at all; the null sql client IS the proof.
    expect(await ev({ ...base, max_risk_score: 0 }, { agent_id: 'claude-code:unpaired-family' }, 50)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL** (`npx vitest run __tests__/unit/guard-delegation-constraint.test.js` — evaluator missing → evaluatePolicy returns null).
- [ ] **Step 3: Implement.** In `app/lib/guard/policy.ts`, add after the `require_evidence` entry (keep the 2-space key indent — the surface-budget counter regexes it):

```ts
  // Scoped delegation constraints (governed-autonomy feature 2, RFC
  // 2026-07-06): a composed subagent's authority is a provable subset of its
  // parent's. Fires ONLY on composed identities (agent_id containing the
  // reserved ':' delimiter) — plain parents and provenance-mode callers
  // (base id + intel.subagent) are out of scope by design, so this is a
  // hard no-op for every existing single-agent fleet. Tighten-only: it can
  // escalate to require_approval or block, never grant. effectiveRiskScore
  // arrives POST-predictive (evaluate.ts passes the final adjusted score to
  // runLocalPolicies), so the risk ceiling checks the same number the
  // decision itself is judged on. Matching is on the id STRING — an
  // unpaired composed id (no agent_identities row) is still constrained;
  // the base-fallback identity lookup cannot defeat attenuation.
  delegation_constraint: ({ rules, context, effectiveRiskScore }) => {
    const agentId = typeof context.agent_id === 'string' ? context.agent_id : '';
    const sep = agentId.indexOf(':');
    if (sep <= 0) return null; // non-composed caller — no-op
    const parent = agentId.slice(0, sep);
    const childSegments = agentId.slice(sep + 1).split(':').filter(Boolean);

    const ruleParent = typeof rules.parent === 'string' ? rules.parent : '*';
    if (ruleParent !== '*' && ruleParent !== parent) return null;
    const childTypes = Array.isArray(rules.child_types) ? rules.child_types : ['*'];
    const childMatch = childTypes.includes('*') || childSegments.some((s) => childTypes.includes(s));
    if (!childMatch) return null;

    const escalate = rules.escalate_action === 'block' ? 'block' : 'require_approval';

    if (typeof rules.max_depth === 'number' && childSegments.length > rules.max_depth) {
      return { action: escalate, reason: `spawn depth ${childSegments.length} exceeds max_depth ${rules.max_depth} for ${agentId}` };
    }
    if (typeof rules.max_risk_score === 'number') {
      const risk = effectiveRiskScore != null
        ? effectiveRiskScore
        : Math.max(0, Math.min(Number(context.risk_score) || 0, 100));
      if (risk > rules.max_risk_score) {
        return { action: escalate, reason: `risk ${risk} exceeds the delegated ceiling ${rules.max_risk_score} for ${agentId}` };
      }
    }
    const actionType = typeof context.action_type === 'string' ? context.action_type : '';
    if (Array.isArray(rules.blocked_action_types) && actionType && rules.blocked_action_types.includes(actionType)) {
      return { action: escalate, reason: `action type "${actionType}" is outside ${agentId}'s delegated authority (blocked)` };
    }
    if (Array.isArray(rules.allowed_action_types) && actionType && !rules.allowed_action_types.includes(actionType)) {
      return { action: escalate, reason: `action type "${actionType}" is outside ${agentId}'s delegated allowlist` };
    }
    if (Array.isArray(rules.blocked_path_globs) && rules.blocked_path_globs.length > 0) {
      const candidates: string[] = [];
      if (typeof context.target === 'string' && context.target) candidates.push(context.target);
      if (Array.isArray(context.write_paths)) candidates.push(...(context.write_paths as string[]));
      const hit = candidates.find((p) => matchesProtectedPath(p, rules.blocked_path_globs));
      if (hit) {
        return { action: escalate, reason: `path ${hit} is outside ${agentId}'s delegated scope` };
      }
    }
    if (rules.require_verified_parent === true) {
      const status = typeof context.verification_status === 'string' ? context.verification_status : 'unverified';
      if (status !== 'verified') {
        return { action: escalate, reason: `unverified caller identity (${status}) — this constraint requires a verified parent` };
      }
    }
    return null;
  },
```

Add `delegation_constraint` to the `GuardPolicyType` union in `app/lib/types`.

- [ ] **Step 4: Run — PASS** the new file, then `npx vitest run __tests__/unit/guard-engine.test.js` (no regressions) and `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(guard): delegation_constraint policy type — authority attenuation for composed subagents`

---

### Task 2: Write validation + route tests

**Files:**
- Modify: `app/lib/validate.js` (POLICY_TYPES array + POLICY_TYPE_VALIDATORS entry)
- Test: extend the existing policy-validation test file (find it: `grep -rln "protected_path policy requires" __tests__/`)

- [ ] **Step 1: Failing tests:** valid full rules pass; `escalate_action: 'allow'` rejected; `max_risk_score: 101` and `-1` rejected; `blocked_path_globs` with a non-string rejected; `child_types: []` rejected (must be non-empty when present); unknown-type behavior unchanged.
- [ ] **Step 2: Implement** — add `'delegation_constraint'` to `POLICY_TYPES` and:

```js
  delegation_constraint: (rules, addError) => {
    // Authority attenuation for composed subagents (parent:child ids). All
    // fields optional except the matcher pair; only present checks enforce.
    if (rules.parent !== undefined && (typeof rules.parent !== 'string' || rules.parent.length === 0 || rules.parent.length > 128)) {
      addError('delegation_constraint rules.parent must be a non-empty string (<=128 chars) or omitted (treated as "*")');
    }
    if (rules.child_types !== undefined && (!Array.isArray(rules.child_types) || rules.child_types.length === 0
      || !rules.child_types.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 64))) {
      addError('delegation_constraint rules.child_types must be a non-empty array of strings (<=64 chars) when present');
    }
    if (rules.max_risk_score !== undefined && (typeof rules.max_risk_score !== 'number' || rules.max_risk_score < 0 || rules.max_risk_score > 100)) {
      addError('delegation_constraint rules.max_risk_score must be a number 0-100');
    }
    for (const key of ['allowed_action_types', 'blocked_action_types']) {
      if (rules[key] !== undefined && rules[key] !== null
        && (!Array.isArray(rules[key]) || !rules[key].every((t) => typeof t === 'string' && t.length > 0 && t.length <= 128))) {
        addError(`delegation_constraint rules.${key} must be null or an array of non-empty strings`);
      }
    }
    if (rules.blocked_path_globs !== undefined
      && (!Array.isArray(rules.blocked_path_globs) || !rules.blocked_path_globs.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 256))) {
      addError('delegation_constraint rules.blocked_path_globs must be an array of non-empty glob strings (<=256 chars)');
    }
    if (rules.max_depth !== undefined && (!Number.isInteger(rules.max_depth) || rules.max_depth < 1 || rules.max_depth > 8)) {
      addError('delegation_constraint rules.max_depth must be an integer 1-8');
    }
    if (rules.escalate_action !== undefined && !['require_approval', 'block'].includes(rules.escalate_action)) {
      addError('delegation_constraint rules.escalate_action must be require_approval or block (attenuation only tightens)');
    }
    if (rules.require_verified_parent !== undefined && typeof rules.require_verified_parent !== 'boolean') {
      addError('delegation_constraint rules.require_verified_parent must be a boolean');
    }
  },
```

- [ ] **Step 3: Run green + typecheck. Commit** — `feat(policies): delegation_constraint write validation`

---

### Task 3: Mode-pack starter + compile pin

**Files:**
- Modify: `app/lib/policy-modes/compile.ts` (claude-code builder — append one `mk()`)
- Test: whichever test pins mode compilation (`grep -rln "claude-code" __tests__/unit/*mode*` / policy-modes-compile tests — extend the pinned list)

- [ ] Append to the claude-code mode array:

```ts
      mk(m, 'Constrain subagents', 'delegation_constraint', {
        parent: '*',
        child_types: ['*'],
        max_risk_score: 60,
        escalate_action: 'require_approval',
      }),
```

- [ ] Update the compile test pins (count/list), run green, commit — `feat(modes): claude-code mode ships an observe-grade subagent constraint`

---

### Task 4: /policies UI — picker, rule-builder branch, ledger describer, shield, observed-family seeding

**Files:**
- Modify: `app/policies/lib/policyFormModel.js` (POLICY_TYPE_OPTIONS entry + POLICY_TYPE_HANDLERS entry)
- Modify: `app/policies/components/PolicyRuleBuilderSection.tsx` (new `form.type === 'delegation_constraint'` branch)
- Modify: `app/policies/components/Ledger.tsx` (describeRule case)
- Modify: `app/policies/lib/shields.js` (10th shield)

**Interfaces:** the rule-builder branch fetches `GET /api/agents` once and offers observed composed ids (`agent_id.includes(':')`) as one-click prefills for parent/child_type (split on first ':'); free-text entry remains available. Read `.impeccable.md` first; tokens only; no orange.

- [ ] POLICY_TYPE_OPTIONS: `{ value: 'delegation_constraint', label: 'Subagent Constraint', desc: 'Cap what a spawned subagent may do — risk ceiling, action types, paths, depth' }`
- [ ] POLICY_TYPE_HANDLERS entry (compile + summary) following the file's per-type pattern; summary like `Constrain ${parent}:${child_types} to risk ≤ N`.
- [ ] Rule-builder branch: fields for parent (text + observed-family prefill chips), child types (comma/line list), max risk (number 0-100), blocked/allowed action types (line lists), blocked path globs (textarea like protected_path's), max depth (number), escalate action (select require_approval|block), require verified parent (checkbox). Explanatory microcopy: fires only for composed `parent:child` identities.
- [ ] Ledger describeRule case: `Constrain <Code>{parent}:{child_types.join('|')}</Code> — risk ≤ N{, no deploy…}` (concise).
- [ ] shields.js entry:

```js
  {
    id: 'subagent_constraint',
    name: 'Subagent Constraint',
    description: 'Escalate when any spawned subagent exceeds risk 60',
    icon: 'GitFork',
    policyType: 'delegation_constraint',
    defaultRules: { parent: '*', child_types: ['*'], max_risk_score: 60, escalate_action: 'require_approval' },
  },
```

(Verify `GitFork` exists in the icon map the gallery uses; else pick a present lucide icon.)
- [ ] Gates: `npm run lint && npx next build && npm run typecheck`. Note: shields count 9→10 — doc updates happen in Task 6; if check-doc-counts pins shields and fails HERE, that confirms Task 6's list.
- [ ] Commit — `feat(policies-ui): Subagent Constraint — type, builder with observed-family prefill, shield, ledger describer`

---

### Task 5: SDK convenience wrappers + smoke section AG

**Files:**
- Modify: `sdk/dashclaw.js` (+`createDelegationConstraint`), `sdk-python/dashclaw/client.py` (+`create_delegation_constraint`)
- Modify: `scripts/policy-smoke.mjs` (section AG before cleanup)
- Test: extend `__tests__/unit/sdk-plans.test.js`-style harness (new small file `__tests__/unit/sdk-delegation.test.js`) + python test

- [ ] Node (2-space class-method indent):

```js
  /**
   * POST /api/policies — Create a delegation_constraint policy: cap what a
   * composed subagent (parent:child identity) may do. Thin wrapper over the
   * policy-create endpoint so attenuation has a first-class verb.
   * @param {object} rules - { parent?, child_types?, max_risk_score?, allowed_action_types?, blocked_action_types?, blocked_path_globs?, max_depth?, escalate_action?, require_verified_parent? }
   * @param {object} [opts] - { name?, agent_ids? }
   */
  async createDelegationConstraint(rules, opts = {}) {
    return this._post('/api/policies', {
      name: opts.name || 'Delegation constraint',
      policy_type: 'delegation_constraint',
      rules,
      active: true,
      ...(opts.agent_ids ? { agent_ids: opts.agent_ids } : {}),
    });
  }
```

(Verify the policies POST body shape against `createPolicy` in policy-smoke — natural JSON rules are accepted since 2026-07-01.)
- [ ] Python mirror `create_delegation_constraint(rules, name=None, agent_ids=None)` via `_request('/api/policies', 'POST', json=...)`.
- [ ] Tests: payload shape assertions both languages. `npm run sdk:count` → Node 37, Python 57 (report actuals).
- [ ] Smoke AG (self-contained, own agent tags, createPolicy cleanup rails):

```js
  // ---------------------------------------------------------------- AG ----
  // Scoped delegation constraints (governed-autonomy feature 2). Live proof:
  // a composed child trips the constraint; the bare parent does not.
  console.log('\nAG. scoped delegation constraints...');
  {
    const parent = agentFor('dc');
    const child = `${parent}:explore`;
    const pid = await createPolicy('dc-ceiling', 'delegation_constraint',
      { parent, child_types: ['*'], max_risk_score: 40, escalate_action: 'require_approval' }, [parent, child]);
    const childHigh = await api('POST', '/api/guard', {
      action_type: 'smoke.risky', declared_goal: `dc child high ${RUN}`, agent_id: child, risk_score: 75,
    });
    check('AG1', 'composed child above ceiling → require_approval + constraint matched',
      childHigh.json?.decision === 'require_approval' && (childHigh.json?.matched_policies || []).includes(pid),
      `decision=${childHigh.json?.decision}`);
    const childLow = await api('POST', '/api/guard', {
      action_type: 'smoke.read', declared_goal: `dc child low ${RUN}`, agent_id: child, risk_score: 5,
    });
    check('AG2', 'composed child under ceiling → constraint not matched',
      !(childLow.json?.matched_policies || []).includes(pid),
      `decision=${childLow.json?.decision}`);
    const parentHigh = await api('POST', '/api/guard', {
      action_type: 'smoke.risky', declared_goal: `dc parent high ${RUN}`, agent_id: parent, risk_score: 75,
    });
    check('AG3', 'bare parent is never affected (no-op for non-composed)',
      !(parentHigh.json?.matched_policies || []).includes(pid),
      `decision=${parentHigh.json?.decision} matched=${JSON.stringify(parentHigh.json?.matched_policies)}`);
    const deep = await api('POST', '/api/guard', {
      action_type: 'smoke.read', declared_goal: `dc deep ${RUN}`, agent_id: `${child}:sub`, risk_score: 5,
    });
    // depth check needs its own policy (max_depth 1):
    const pid2 = await createPolicy('dc-depth', 'delegation_constraint',
      { parent, child_types: ['*'], max_depth: 1, escalate_action: 'block' }, [parent, child, `${child}:sub`]);
    const deep2 = await api('POST', '/api/guard', {
      action_type: 'smoke.read', declared_goal: `dc deep2 ${RUN}`, agent_id: `${child}:sub`, risk_score: 5,
    });
    check('AG4', 'depth 2 with max_depth 1 → block',
      deep2.json?.decision === 'block' && (deep2.json?.matched_policies || []).includes(pid2),
      `decision=${deep2.json?.decision}`);
    void deep; // first deep call predates pid2 — not asserted
  }
```

CAVEAT for the implementer: verify how `createPolicy`'s `agent_ids` scoping interacts with composed ids (does policy targeting match composed ids exactly, or does base-fallback apply? read `loadApplicablePolicies`). If per-agent scoping would exclude the composed child, create the policies org-wide (no agent_ids) — the constraint's own parent matching provides the scoping; adjust AG3's assertion accordingly (parent still unaffected because the evaluator no-ops on non-composed ids, not because of policy targeting).
- [ ] Live-prove AG (server up per fixwave-report ops notes — start `node_modules/.bin/next` directly, NOT npx), full smoke tally, no new failures vs the 7 known.
- [ ] Commit — `feat(sdk+smoke): delegation-constraint convenience wrappers + live attenuation proof`

---

### Task 6: Budget amendment + counts + docs + marketing

**Files:** `contracts/surface-budget.json`, `THESIS.md`, `docs/architecture/runtime-api.md`, `docs/sdk-parity.md`, `sdk/README.md`, `sdk-python/README.md`, README/PROJECT_DETAILS/app pages where policy-type or shield counts are cited, `public/guides/platform-guide-data.json` method_count fields, `app/page.tsx` + `app/self-host/page.tsx` marketing.

- [ ] Budget: guardPolicyTypes 14→15 (reason: delegation_constraint — governed-autonomy feature 2, RFC 2026-07-06: composed-subagent authority attenuation; a policy type, not a subsystem — no tables, no routes); sdkNodeMethods 36→37, sdkPythonMethods 56→57 (+1 convenience wrapper each). THESIS ceilings table + amendment log entry (dated 2026-07-26, cites the RFC and the no-new-surface economy).
- [ ] Counts sweep: run `node scripts/check-doc-counts.mjs --strict` and fix EVERY failure; then grep stragglers: `grep -rn "14 policy\|14 guard\|9 shields\|nine shields\|36 methods\|56 methods" README.md PROJECT_DETAILS.md docs/ app/ sdk*/README.md --include=*.md --include=*.tsx --include=*.js | grep -v node_modules` — reconcile every real citation (history files excluded). Also the guide JSON `method_count` fields (36→37, 56→57) — keep `guide:drift:check` green (no new routes, so no entries needed).
- [ ] runtime-api.md: policy-type table row + a worked example (the AG1 scenario) + one paragraph: fires only on composed ids; provenance-mode callers documented out of v1.
- [ ] SDK READMEs + sdk-parity: the new wrapper in the method groups/tables (37/57 counts).
- [ ] Marketing: `app/page.tsx` — extend the Policies SUPPORT_SURFACES card desc with subagent constraints ("cap what spawned subagents may do"); `app/self-host/page.tsx` Governance list gains: `'Scoped delegation constraints -- cap a spawned subagent\'s risk, action types, paths, and depth; attenuation only tightens'`.
- [ ] Gates: doc-counts --strict, guide:drift:check, surface:check all green. Commit — `docs(delegation): budget amendment + counts + runtime-api + marketing`

---

### Task 7: Rendered proof + full gates

- [ ] frontend-verify `/policies`: the Subagent Constraint shield renders in the gallery; toggling it creates the policy (row appears in the ledger with the describeRule text); the rule-builder branch renders for type delegation_constraint with the observed-family prefill (seed one composed-id action first via POST /api/actions or guard so /api/agents returns a composed id). Screenshot to `.superpowers/sdd/delegation-rendered-proof.png`.
- [ ] Full gates: `npm run lint && npx vitest run && npx next build && npm run typecheck && node scripts/check-doc-counts.mjs --strict && npm run surface:check && npm run guide:drift:check && npm run route-sql:check`. ALL green, read.
- [ ] Commit anything outstanding.

---

### Task 8: Preship sweep + ship (main session, not a subagent)

- Run dashclaw-preship-sweep (scope: the branch; security focus: the evaluator's no-op boundary for non-composed callers, the tighten-only property, glob reuse, validation completeness). Remediate NO-GOs.
- dashclaw-ship: version 5.5.0 (minor — new policy type + SDK methods), CHANGELOG, maintainer log, merge to main, push, tag, GitHub release. SDK source changes again → release:sdks owed (mcp-server unchanged this time — no MCP bump).

## Self-review notes
- The RFC's `/agents/[agentId]` Delegation panel + `/swarm` badge are reconciled out (culled pages); the seeding invariant lands in the rule-builder prefill. Recorded for the ship summary.
- Ordering option (a) is full-strength post-calibration refactor — no dedicated pass.
- `agent_ids` policy-scoping interaction with composed ids is flagged as an explicit build-time verification in Task 5 (loadApplicablePolicies read).
- Policy-type count changes are mechanical (14→15) but the shields count (9→10) and SDK counts (37/57) also move — Task 6 sweeps all three.
