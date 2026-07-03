#!/usr/bin/env node
/**
 * policy-smoke.mjs — live policy-enforcement smoke against a running DashClaw.
 *
 * Proves, over real HTTP with real policies, the claims the docs and the
 * /explain page make about the governance loop. Each check is tagged with the
 * claim id from docs/plans/2026-07-01-explain-claims-audit.md.
 *
 * Usage:
 *   node scripts/policy-smoke.mjs [baseUrl]        # default http://localhost:3000
 *
 * Auth: operator key (x-api-key = DASHCLAW_API_KEY from .env.local) → org_default,
 * admin. Per-org DB keys don't authenticate on local Postgres (middleware
 * resolveApiKey is Neon-HTTP-only — known gap, see the audit doc).
 *
 * Isolation: every policy this script creates is scoped via agent_ids to
 * run-unique smoke agents and uses run-unique action types, so real org
 * traffic is never gated. All created policies are deleted at the end
 * (guard may serve them from cache for up to 30s after — harmless here).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// --- env ---
// When .env.local exists (local dev), its DASHCLAW_API_KEY wins over anything
// inherited from the shell — machine-level DASHCLAW_* vars can point at prod.
// When it doesn't (CI), fall back to the inherited env (the CI job sets it).
const inheritedKey = process.env.DASHCLAW_API_KEY;
for (const k of Object.keys(process.env)) {
  if (k.startsWith('DASHCLAW_')) delete process.env[k];
}
let envFileKey;
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  envFileKey = process.env.DASHCLAW_API_KEY;
} catch {
  console.log('note: no .env.local — using DASHCLAW_API_KEY from the environment (CI mode)');
}

const BASE = process.argv[2] || 'http://localhost:3000';
const KEY = envFileKey || inheritedKey;
if (!KEY) {
  console.error('FATAL: DASHCLAW_API_KEY not found in .env.local or the environment');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const results = [];
const createdPolicyIds = [];

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-api-key': KEY, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* some endpoints return empty */ }
  return { status: res.status, json };
}

async function createPolicy(name, policy_type, rules, agentIds) {
  const { status, json } = await api('POST', '/api/policies', {
    name: `policy-smoke:${name}:${RUN}`,
    policy_type,
    // Natural JSON shapes — the validator normalizes these since 2026-07-01
    // (wire-format tolerance); sending them here live-proves that on every run.
    rules,
    active: true,
    agent_ids: agentIds,
  });
  if (status !== 200 && status !== 201) {
    throw new Error(`policy create ${name} failed: ${status} ${JSON.stringify(json)}`);
  }
  const id = json?.policy?.id || json?.id;
  if (!id) throw new Error(`policy create ${name}: no id in response ${JSON.stringify(json)}`);
  createdPolicyIds.push(id);
  return id;
}

function check(claim, name, pass, detail) {
  results.push({ claim, name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  [${claim}] ${name}${pass ? '' : ` — ${detail}`}`);
}

function agentFor(tag) { return `smoke-${tag}-${RUN}`; }

// ---------------------------------------------------------------- checks ---
async function main() {
  console.log(`policy-smoke run ${RUN} against ${BASE}\n`);

  // Sanity: server up + auth works
  {
    const { status } = await api('POST', '/api/guard', {
      action_type: 'smoke.ping', declared_goal: `smoke ping ${RUN}`, agent_id: agentFor('ping'),
    });
    if (status === 401) { console.error('FATAL: 401 — operator key rejected. Is DASHCLAW_API_KEY in the server env too?'); process.exit(1); }
    if (status >= 500) { console.error(`FATAL: server error ${status}`); process.exit(1); }
  }

  // A1: decision vocabulary
  {
    const { json } = await api('POST', '/api/guard', {
      action_type: 'smoke.read', declared_goal: `read a harmless smoke value ${RUN}`, agent_id: agentFor('a1'),
    });
    check('A1', 'guard returns one of the four decisions',
      ['allow', 'warn', 'block', 'require_approval'].includes(json?.decision),
      `decision=${json?.decision}`);
  }

  // A3: effective risk = max(server, agent); both fields returned
  {
    const agent = agentFor('a3');
    const hi = await api('POST', '/api/guard', {
      action_type: 'smoke.read', declared_goal: `read with inflated client risk ${RUN}`,
      agent_id: agent, risk_score: 95,
    });
    const lo = await api('POST', '/api/guard', {
      action_type: 'deploy', declared_goal: `deploy to production with lowballed client risk ${RUN}`,
      agent_id: agent, risk_score: 1, systems_touched: ['production'], reversible: false,
    });
    check('A3', 'agent-inflated risk is honored (max wins upward)',
      hi.json?.risk_score >= 95 && hi.json?.agent_risk_score === 95,
      `risk=${hi.json?.risk_score} agent=${hi.json?.agent_risk_score}`);
    check('A3', 'agent-lowballed risk cannot mask server risk',
      lo.json?.risk_score > 1,
      `risk=${lo.json?.risk_score} (server should exceed the lowballed 1)`);
  }

  // B1: block_action_type blocks matching type, ignores others (scoped to smoke agent)
  {
    const agent = agentFor('b1');
    const pid = await createPolicy('block-type', 'block_action_type',
      { action_types: [`smoke.blocked.${RUN}`] }, [agent]);
    const hit = await api('POST', '/api/guard', {
      action_type: `smoke.blocked.${RUN}`, declared_goal: `attempt the blocked type ${RUN}`, agent_id: agent,
    });
    const miss = await api('POST', '/api/guard', {
      action_type: 'smoke.read', declared_goal: `attempt an unrelated type ${RUN}`, agent_id: agent,
    });
    check('B1', 'block_action_type → block with policy matched',
      hit.json?.decision === 'block' && (hit.json?.matched_policies || []).includes(pid),
      `decision=${hit.json?.decision} matched=${JSON.stringify(hit.json?.matched_policies)}`);
    check('B1', 'non-matching action type not blocked by that policy',
      !(miss.json?.matched_policies || []).includes(pid),
      `matched=${JSON.stringify(miss.json?.matched_policies)}`);
  }

  // B3: risk_threshold with action require_approval
  {
    const agent = agentFor('b3');
    const pid = await createPolicy('risk-approval', 'risk_threshold',
      { threshold: 60, action: 'require_approval' }, [agent]);
    const above = await api('POST', '/api/guard', {
      action_type: 'smoke.risky', declared_goal: `risky smoke action ${RUN}`, agent_id: agent, risk_score: 75,
    });
    const below = await api('POST', '/api/guard', {
      action_type: 'smoke.read', declared_goal: `calm smoke action ${RUN}`, agent_id: agent, risk_score: 5,
    });
    check('B3', 'risk ≥ threshold → require_approval',
      above.json?.decision === 'require_approval' && (above.json?.matched_policies || []).includes(pid),
      `decision=${above.json?.decision}`);
    check('B3', 'risk below threshold → policy not matched',
      !(below.json?.matched_policies || []).includes(pid),
      `decision=${below.json?.decision} matched=${JSON.stringify(below.json?.matched_policies)}`);
  }

  // B2: x402 spend cap — the real one (x402_purchase only)
  {
    const agent = agentFor('b2');
    await createPolicy('spend-cap', 'x402_spend_limit',
      { approval_threshold: 5, max_spend_usd: 25 }, [agent]);
    const purchase = (goal, cost) => api('POST', '/api/x402/purchases', {
      agent_id: agent, provider: 'smoke-provider', declared_goal: goal, cost_estimate: cost,
      purchase_reason: 'policy smoke check', context_gap: 'verifying spend gates live', expected_value: 'proof the cap works',
    });
    const under = await purchase(`tiny paid call ${RUN}`, 3);
    const mid = await purchase(`medium paid call ${RUN}`, 10);
    const over = await purchase(`huge paid call ${RUN}`, 100);
    const decisionOf = (r) => {
      for (const g of [r.json?.guard, r.json?.decision, r.json?.guard_decision]) {
        if (typeof g === 'string') return g;
        if (g && typeof g.decision === 'string') return g.decision;
      }
      // fall back to the recorded action's status as decision evidence
      const st = r.json?.action?.status;
      return st === 'pending_approval' ? 'require_approval' : st === 'blocked' ? 'block' : undefined;
    };
    check('B2', 'x402 spend $3 under $5 threshold → not gated',
      under.status < 400 && decisionOf(under) !== 'require_approval' && decisionOf(under) !== 'block',
      `status=${under.status} decision=${decisionOf(under)} body=${JSON.stringify(under.json)?.slice(0, 200)}`);
    check('B2', 'x402 spend $10 ≥ $5 threshold → require_approval',
      decisionOf(mid) === 'require_approval',
      `status=${mid.status} decision=${decisionOf(mid)} body=${JSON.stringify(mid.json)?.slice(0, 200)}`);
    check('B2', 'x402 spend $100 > $25 cap → block',
      decisionOf(over) === 'block' || over.status === 403,
      `status=${over.status} decision=${decisionOf(over)} body=${JSON.stringify(over.json)?.slice(0, 200)}`);

    // B2-NEG: the /explain playground overpromise probe — a generic payment
    // action with a cost_estimate is NOT gated by the spend policy.
    const generic = await api('POST', '/api/guard', {
      action_type: 'payment.create', declared_goal: `pay a generic vendor invoice ${RUN}`,
      agent_id: agent, cost_estimate: 10000,
    });
    check('B2-NEG', 'generic payment.create with cost_estimate is NOT spend-gated (documents the x402-only scope)',
      generic.json?.decision !== undefined &&
      !(generic.json?.matched_policies || []).some((id) => createdPolicyIds.includes(id)),
      `decision=${generic.json?.decision} matched=${JSON.stringify(generic.json?.matched_policies)}`);
  }

  // B6: cumulative x402 budget — spend accrues across purchases until the
  // window budget interrupts (owner roadmap item 2). Agent-scoped with a
  // per-run agent so prior runs' purchases in the shared smoke org are
  // invisible to the sum and the sequence is deterministic from $0.
  {
    const agent = agentFor('b6');
    await createPolicy('spend-budget', 'x402_spend_limit',
      { budget_approval_threshold: 10, budget_usd: 20, budget_scope: 'agent' }, [agent]);
    const purchase = (goal, cost) => api('POST', '/api/x402/purchases', {
      agent_id: agent, provider: 'smoke-provider', declared_goal: goal, cost_estimate: cost,
      purchase_reason: 'policy smoke check', context_gap: 'verifying the cumulative budget live', expected_value: 'proof the budget gate works',
    });
    const decisionOf = (r) => {
      for (const g of [r.json?.guard, r.json?.decision, r.json?.guard_decision]) {
        if (typeof g === 'string') return g;
        if (g && typeof g.decision === 'string') return g.decision;
      }
      const st = r.json?.action?.status;
      return st === 'pending_approval' ? 'require_approval' : st === 'blocked' ? 'block' : undefined;
    };
    const p1 = await purchase(`budget purchase 1 ${RUN}`, 4);   // window sum 4
    const p2 = await purchase(`budget purchase 2 ${RUN}`, 4);   // window sum 8
    const p3 = await purchase(`budget purchase 3 ${RUN}`, 4);   // 8 + 4 = 12 ≥ 10 → approval
    const p4 = await purchase(`budget purchase 4 ${RUN}`, 10);  // 12 + 10 = 22 > 20 → block
    check('B6', 'purchases under the window budget are not gated ($4, then $8 cumulative)',
      p1.status < 400 && decisionOf(p1) !== 'require_approval' && decisionOf(p1) !== 'block' &&
      p2.status < 400 && decisionOf(p2) !== 'require_approval' && decisionOf(p2) !== 'block',
      `p1=${p1.status}/${decisionOf(p1)} p2=${p2.status}/${decisionOf(p2)} body=${JSON.stringify(p2.json)?.slice(0, 200)}`);
    check('B6', 'cumulative spend $12 ≥ $10 budget approval threshold → require_approval (each purchase alone is only $4)',
      decisionOf(p3) === 'require_approval',
      `status=${p3.status} decision=${decisionOf(p3)} body=${JSON.stringify(p3.json)?.slice(0, 200)}`);
    check('B6', 'cumulative spend $22 > $20 window budget → block',
      decisionOf(p4) === 'block' || p4.status === 403,
      `status=${p4.status} decision=${decisionOf(p4)} body=${JSON.stringify(p4.json)?.slice(0, 200)}`);
    check('B6', 'budget block carries the cumulative-spend evidence in its reason',
      JSON.stringify(p4.json || {}).includes('Cumulative x402 spend'),
      `body=${JSON.stringify(p4.json)?.slice(0, 300)}`);
  }

  // L1–L3: agent identity family (roadmap v2.2). Composed sub-agent ids
  // (<parent>:<type>, DASHCLAW_SUBAGENT_IDENTITY=distinct — the default since
  // v2.2) inherit the parent's targeted policies, and agent-scoped x402
  // budgets bind the whole identity family, so a sub-agent can neither dodge
  // its parent's rules nor escape the family budget.
  {
    const parent = agentFor('fam');
    const child = `${parent}:explore`;
    const pid = await createPolicy('family-block', 'block_action_type',
      { action_types: [`smoke.family.${RUN}`] }, [parent]);
    const viaChild = await api('POST', '/api/guard', {
      action_type: `smoke.family.${RUN}`, declared_goal: `family-targeted action via sub-agent ${RUN}`, agent_id: child,
    });
    check('L1', 'policy targeted at the parent applies to its composed sub-agent id',
      viaChild.json?.decision === 'block' && (viaChild.json?.matched_policies || []).includes(pid),
      `decision=${viaChild.json?.decision} matched=${JSON.stringify(viaChild.json?.matched_policies)}`);
    const unrelated = await api('POST', '/api/guard', {
      action_type: `smoke.family.${RUN}`, declared_goal: `same action via an unrelated sub-agent ${RUN}`,
      agent_id: `${agentFor('fam-other')}:explore`,
    });
    check('L2', 'the targeted policy does not leak to unrelated composed ids',
      !(unrelated.json?.matched_policies || []).includes(pid),
      `matched=${JSON.stringify(unrelated.json?.matched_policies)}`);

    // L3: family budget — the parent's agent-scoped budget counts sub-agent
    // spend. Parent spends $4 (allowed), then the CHILD's $4 purchase breaches
    // the $7 family budget even though the child alone has spent nothing.
    // Purchases stay under $5 so the shared smoke org's org-wide per-purchase
    // gates (same reason B6 uses $4) never shadow the family-budget signal.
    const famAgent = agentFor('fam-budget');
    const famChild = `${famAgent}:worker`;
    await createPolicy('family-budget', 'x402_spend_limit',
      { budget_usd: 7, budget_scope: 'agent' }, [famAgent]);
    const famPurchase = (agentId, goal, cost) => api('POST', '/api/x402/purchases', {
      agent_id: agentId, provider: 'smoke-provider', declared_goal: goal, cost_estimate: cost,
      purchase_reason: 'policy smoke check', context_gap: 'verifying the family budget live', expected_value: 'proof sub-agents cannot escape the family budget',
    });
    const famDecision = (r) => {
      for (const g of [r.json?.guard, r.json?.decision, r.json?.guard_decision]) {
        if (typeof g === 'string') return g;
        if (g && typeof g.decision === 'string') return g.decision;
      }
      const st = r.json?.action?.status;
      return st === 'pending_approval' ? 'require_approval' : st === 'blocked' ? 'block' : undefined;
    };
    const f1 = await famPurchase(famAgent, `family budget purchase by parent ${RUN}`, 4);  // family sum 4
    const f2 = await famPurchase(famChild, `family budget purchase by sub-agent ${RUN}`, 4); // 4 + 4 = 8 > 7 → block
    check('L3', 'parent purchase under the family budget is not gated',
      f1.status < 400 && famDecision(f1) !== 'block' && famDecision(f1) !== 'require_approval',
      `status=${f1.status} decision=${famDecision(f1)} body=${JSON.stringify(f1.json)?.slice(0, 200)}`);
    check('L3', "sub-agent purchase breaching the family budget is blocked (composed id counted into the parent's window)",
      famDecision(f2) === 'block' || f2.status === 403,
      `status=${f2.status} decision=${famDecision(f2)} body=${JSON.stringify(f2.json)?.slice(0, 200)}`);
    check('L3', 'the family-budget block names the family base agent in its reason',
      JSON.stringify(f2.json || {}).includes(`agent ${famAgent}`),
      `body=${JSON.stringify(f2.json)?.slice(0, 300)}`);
  }

  // C1 + C2: /api/actions runs guard internally
  {
    const agent = agentFor('b1'); // reuse the block policy's agent + type
    const blocked = await api('POST', '/api/actions', {
      agent_id: agent, action_type: `smoke.blocked.${RUN}`, declared_goal: `record the blocked type ${RUN}`,
    });
    check('C1', 'recording a policy-blocked action → 403 + blocked record',
      blocked.status === 403 && (blocked.json?.action?.status === 'blocked' || blocked.json?.status === 'blocked'),
      `status=${blocked.status} body=${JSON.stringify(blocked.json)?.slice(0, 200)}`);

    const approvalAgent = agentFor('b3'); // reuse risk_threshold(require_approval) agent
    const pending = await api('POST', '/api/actions', {
      agent_id: approvalAgent, action_type: 'smoke.risky',
      declared_goal: `risky recorded action ${RUN}`, risk_score: 75,
    });
    const pendingStatus = pending.json?.action?.status || pending.json?.status;
    check('C2', 'approval-required action recorded as pending_approval',
      pendingStatus === 'pending_approval',
      `status=${pending.status} action.status=${pendingStatus}`);

    // F1: approve it via the approvals route → status becomes running
    const actionId = pending.json?.action_id || pending.json?.action?.action_id || pending.json?.action?.id;
    if (actionId) {
      const approved = await api('POST', `/api/approvals/${actionId}`, { decision: 'allow', reasoning: 'policy smoke' });
      const after = await api('GET', `/api/actions/${actionId}`);
      const afterStatus = after.json?.action?.status || after.json?.status;
      check('F1', 'human approval flips pending_approval → running',
        approved.status < 400 && afterStatus === 'running',
        `approve=${approved.status} after=${afterStatus}`);

      // A6: identical agent + declared_goal re-guarded within 15 min → allow via operator approval
      const reguard = await api('POST', '/api/guard', {
        agent_id: approvalAgent, action_type: 'smoke.risky',
        declared_goal: `risky recorded action ${RUN}`, risk_score: 75,
      });
      check('A6', 'operator approval downgrades identical re-ask to allow (builtin:operator_approval)',
        reguard.json?.decision === 'allow' &&
        (reguard.json?.matched_policies || []).includes('builtin:operator_approval'),
        `decision=${reguard.json?.decision} matched=${JSON.stringify(reguard.json?.matched_policies)}`);

      // D1-D3: outcome finality on the approved action
      const noErr = await api('POST', `/api/actions/${actionId}/outcome`, { status: 'failed', summary: 'x' });
      check('D3', 'failed outcome without error_message → 400',
        noErr.status === 400, `status=${noErr.status}`);
      const noProg = await api('POST', `/api/actions/${actionId}/outcome`, { status: 'partial', summary: 'x' });
      check('D3', 'partial outcome without progress → 400',
        noProg.status === 400, `status=${noProg.status}`);
      const done = await api('POST', `/api/actions/${actionId}/outcome`, { status: 'completed', summary: `smoke done ${RUN}` });
      check('D1', 'completed outcome accepted', done.status < 400, `status=${done.status}`);
      const again = await api('POST', `/api/actions/${actionId}/outcome`, { status: 'completed', summary: 'second write' });
      check('D2', 'second terminal outcome → 409 outcome already set',
        again.status === 409, `status=${again.status} body=${JSON.stringify(again.json)?.slice(0, 120)}`);

      // E1: assumptions — valid + unknown parent
      const asOk = await api('POST', '/api/assumptions', {
        action_id: actionId, assumption: `smoke assumption ${RUN}`, basis: 'policy smoke run',
      });
      check('E1', 'assumption on real action accepted with asm_ id',
        (asOk.json?.assumption_id || '').startsWith('asm_'), `status=${asOk.status}`);
    } else {
      check('F1', 'approval flow', false, 'no action_id returned for pending action');
    }
    const asMissing = await api('POST', '/api/assumptions', {
      action_id: 'act_does_not_exist', assumption: 'x', basis: 'y',
    });
    check('E1', 'assumption on unknown action → 404', asMissing.status === 404, `status=${asMissing.status}`);
  }

  // A5: blocks are absolute — approval on identical goal never downgrades block
  {
    const agent = agentFor('a5');
    await createPolicy('absolute-block', 'block_action_type',
      { action_types: [`smoke.absolute.${RUN}`] }, [agent]);
    // guard → block (twice; the second simulates "retry after someone approved something")
    const first = await api('POST', '/api/guard', {
      agent_id: agent, action_type: `smoke.absolute.${RUN}`, declared_goal: `absolutely blocked ${RUN}`,
    });
    const second = await api('POST', '/api/guard', {
      agent_id: agent, action_type: `smoke.absolute.${RUN}`, declared_goal: `absolutely blocked ${RUN}`,
    });
    check('A5', 'block is returned and stays block on identical re-ask',
      first.json?.decision === 'block' && second.json?.decision === 'block',
      `first=${first.json?.decision} second=${second.json?.decision}`);
  }

  // C3: idempotent replay
  {
    const agent = agentFor('c3');
    const key = `smoke-idem-${RUN}`;
    const one = await api('POST', '/api/actions', {
      agent_id: agent, action_type: 'smoke.idem', declared_goal: `idempotent write ${RUN}`, idempotency_key: key,
    });
    const two = await api('POST', '/api/actions', {
      agent_id: agent, action_type: 'smoke.idem', declared_goal: `idempotent write ${RUN}`, idempotency_key: key,
    });
    const id1 = one.json?.action_id || one.json?.action?.action_id;
    const id2 = two.json?.action_id || two.json?.action?.action_id;
    check('C3', 'same idempotency_key replays the same action',
      Boolean(id1) && id1 === id2 && two.json?.idempotent_replay === true,
      `id1=${id1} id2=${id2} replay=${two.json?.idempotent_replay}`);
  }

  // B5: PATCH deactivation takes effect immediately (cache invalidated on write)
  {
    const agent = agentFor('b5');
    const pid = await createPolicy('toggle', 'block_action_type',
      { action_types: [`smoke.toggle.${RUN}`] }, [agent]);
    const before = await api('POST', '/api/guard', {
      agent_id: agent, action_type: `smoke.toggle.${RUN}`, declared_goal: `toggle probe 1 ${RUN}`,
    });
    const patch = await api('PATCH', '/api/policies', { id: pid, active: false });
    const after = await api('POST', '/api/guard', {
      agent_id: agent, action_type: `smoke.toggle.${RUN}`, declared_goal: `toggle probe 2 ${RUN}`,
    });
    check('B5', 'deactivating a policy takes effect on the next guard call',
      before.json?.decision === 'block' && patch.status < 400 && after.json?.decision !== 'block',
      `before=${before.json?.decision} patch=${patch.status} after=${after.json?.decision}`);
  }

  // B5b: DELETE takes effect immediately too (regression check for the 2026-07-01 fix)
  {
    const agent = agentFor('b5del');
    const pid = await createPolicy('delete-invalidation', 'block_action_type',
      { action_types: [`smoke.del.${RUN}`] }, [agent]);
    const before = await api('POST', '/api/guard', {
      agent_id: agent, action_type: `smoke.del.${RUN}`, declared_goal: `delete probe 1 ${RUN}`,
    });
    const del = await api('DELETE', `/api/policies?id=${encodeURIComponent(pid)}`);
    if (del.status < 400) createdPolicyIds.splice(createdPolicyIds.indexOf(pid), 1);
    const after = await api('POST', '/api/guard', {
      agent_id: agent, action_type: `smoke.del.${RUN}`, declared_goal: `delete probe 2 ${RUN}`,
    });
    check('B5', 'deleting a policy takes effect on the next guard call',
      before.json?.decision === 'block' && del.status < 400 && after.json?.decision !== 'block',
      `before=${before.json?.decision} delete=${del.status} after=${after.json?.decision}`);
  }

  // T1: policy-tuning proposal loop (owner roadmap item 1)
  // Spec: docs/superpowers/specs/2026-07-01-policy-tuning-proposal-loop.md
  {
    const agent = agentFor('t1');
    const pid = await createPolicy('tuning-loop', 'risk_threshold',
      { threshold: 60, action: 'require_approval' }, [agent]);

    // Drive 3 require_approval interruptions and approve each. declared_goal
    // must be unique per iteration — an identical goal would trigger the
    // builtin operator-approval grant after the first approval (see A6
    // above) and downgrade subsequent guard calls to allow, starving the
    // tuning evidence of require_approval fires.
    for (let i = 1; i <= 3; i++) {
      const guarded = await api('POST', '/api/guard?record=true', {
        action_type: 'smoke.tuning', declared_goal: `tuning smoke action ${RUN} #${i}`,
        agent_id: agent, risk_score: 75,
      });
      const actionId = guarded.json?.action_id || guarded.json?.action?.action_id;
      check('T1', `guard call #${i} → require_approval matched by the tuning policy`,
        guarded.json?.decision === 'require_approval' &&
        (guarded.json?.matched_policies || []).includes(pid) && Boolean(actionId),
        `decision=${guarded.json?.decision} matched=${JSON.stringify(guarded.json?.matched_policies)} action_id=${actionId}`);

      if (actionId) {
        const approved = await api('POST', `/api/approvals/${actionId}`, { decision: 'allow' });
        check('T1', `guard call #${i} → approval accepted`, approved.status < 400, `status=${approved.status}`);
      } else {
        check('T1', `guard call #${i} → approval accepted`, false, 'no action_id to approve');
      }
    }

    // Stats + proposal derivation with small seeded thresholds.
    const proposalsUrl = `/api/policies/proposals?days=30&min_fired=3&min_resolved=3`;
    const first = await api('GET', proposalsUrl);
    const statsRow = (first.json?.policies || []).find((p) => p.policy_id === pid);
    check('T1', 'stats row shows fired.require_approval=3 and approved=3',
      statsRow?.fired?.require_approval === 3 && statsRow?.approvals?.approved === 3,
      `stats=${JSON.stringify(statsRow)}`);

    const proposal = (first.json?.proposals || []).find(
      (p) => p.policy_id === pid && p.rule === 'raise_risk_threshold');
    check('T1', 'raise_risk_threshold proposal with patch.rules.threshold=70',
      proposal?.patch?.rules?.threshold === 70,
      `proposal=${JSON.stringify(proposal)}`);

    // Nothing auto-applies: the live policy's rules are untouched.
    const policiesAfterProposal = await api('GET', '/api/policies');
    const liveAfterProposal = (policiesAfterProposal.json?.policies || []).find((p) => p.id === pid);
    const rulesAfterProposal = typeof liveAfterProposal?.rules === 'string'
      ? JSON.parse(liveAfterProposal.rules) : liveAfterProposal?.rules;
    check('T1', 'nothing auto-applies: policy threshold still 60 after GET proposals',
      rulesAfterProposal?.threshold === 60,
      `rules=${JSON.stringify(rulesAfterProposal)}`);

    if (proposal) {
      // Dismiss.
      const dismiss = await api('POST', '/api/policies/proposals', {
        action: 'dismiss', proposal_id: proposal.id, reason: `smoke dismiss ${RUN}`,
      });
      check('T1', 'dismiss proposal → 200', dismiss.status < 400, `status=${dismiss.status}`);

      const afterDismiss = await api('GET', proposalsUrl);
      const stillThere = (afterDismiss.json?.proposals || []).some((p) => p.id === proposal.id);
      check('T1', 'dismissed proposal no longer returned; dismissed_count ≥ 1',
        !stillThere && (afterDismiss.json?.dismissed_count || 0) >= 1,
        `stillThere=${stillThere} dismissed_count=${afterDismiss.json?.dismissed_count}`);

      // Undismiss.
      const undismiss = await api('POST', '/api/policies/proposals', {
        action: 'undismiss', proposal_id: proposal.id,
      });
      check('T1', 'undismiss proposal → 200', undismiss.status < 400, `status=${undismiss.status}`);

      const afterUndismiss = await api('GET', proposalsUrl);
      const backAgain = (afterUndismiss.json?.proposals || []).some((p) => p.id === proposal.id);
      check('T1', 'undismissed proposal reappears', backAgain,
        `proposals=${JSON.stringify((afterUndismiss.json?.proposals || []).map((p) => p.id))}`);

      // Accept: PATCH the policy with the proposal's patch.
      const accept = await api('PATCH', '/api/policies', { id: pid, rules: proposal.patch.rules });
      check('T1', 'accept proposal via PATCH /api/policies → 200', accept.status < 400, `status=${accept.status}`);

      const afterAccept = await api('GET', proposalsUrl);
      const raiseStillProposed = (afterAccept.json?.proposals || []).some(
        (p) => p.policy_id === pid && p.rule === 'raise_risk_threshold');
      const statsAfterAccept = (afterAccept.json?.policies || []).find((p) => p.policy_id === pid);
      check('T1', 'accept resets the evidence window: no raise proposal and fired.require_approval=0',
        !raiseStillProposed && statsAfterAccept?.fired?.require_approval === 0,
        `raiseStillProposed=${raiseStillProposed} stats=${JSON.stringify(statsAfterAccept)}`);
    } else {
      check('T1', 'dismiss/accept round-trip', false, 'no raise_risk_threshold proposal to exercise');
    }
  }

  // H: agent's-advocate rollup (owner roadmap item 4)
  // Spec: docs/superpowers/specs/2026-07-02-agents-advocate-surface.md
  {
    const agent = agentFor('h');
    const guarded = await api('POST', '/api/guard?record=true', {
      action_type: 'smoke.advocate', declared_goal: `advocate smoke action ${RUN}`,
      agent_id: agent,
    });
    const actionId = guarded.json?.action_id || guarded.json?.action?.action_id;
    check('H1', 'guarded+recorded action created for the defense rollup',
      Boolean(actionId), `decision=${guarded.json?.decision} action_id=${actionId}`);

    if (actionId) {
      const detail = await api('GET', `/api/actions/${actionId}`);
      const defense = detail.json?.agent_defense;
      check('H1', 'GET /api/actions/:id carries the agent_defense rollup',
        Boolean(defense?.declared) && Boolean(defense?.shields),
        `keys=${JSON.stringify(Object.keys(defense || {}))}`);

      check('H2', 'defense decision is FK-linked to the exact guard decision',
        defense?.decision?.linked === true &&
        Boolean(defense?.decision?.id) &&
        defense?.decision?.id === detail.json?.action?.guard_decision_id,
        `defense.decision.id=${defense?.decision?.id} action.guard_decision_id=${detail.json?.action?.guard_decision_id}`);

      check('H3', 'prompt-injection shield outcome persisted as clean',
        defense?.shields?.prompt_injection?.status === 'clean',
        `status=${defense?.shields?.prompt_injection?.status}`);

      const asm = await api('POST', '/api/assumptions', {
        action_id: actionId, assumption: `advocate alibi ${RUN}`, basis: 'policy smoke run',
      });
      const after = await api('GET', `/api/actions/${actionId}`);
      check('H4', 'recorded assumption appears in the alibi counts',
        asm.status < 400 && (after.json?.agent_defense?.assumed?.total || 0) >= 1,
        `asm=${asm.status} assumed=${JSON.stringify(after.json?.agent_defense?.assumed)}`);
    } else {
      check('H2', 'defense decision FK link', false, 'no action_id from guard?record=true');
      check('H3', 'prompt-injection shield persisted', false, 'no action_id from guard?record=true');
      check('H4', 'alibi counts', false, 'no action_id from guard?record=true');
    }
  }

  // I: effective-risk escalation observability (owner roadmap item 5)
  // Spec: docs/superpowers/specs/2026-07-02-effective-risk-escalation-observability.md
  // Pins "every interruption is explainable in one glance": the FK-linked
  // action detail must expose the full risk composition, not just the score.
  {
    const agent = agentFor('i');
    const guarded = await api('POST', '/api/guard?record=true', {
      action_type: 'smoke.breakdown', declared_goal: `risk composition smoke ${RUN}`,
      agent_id: agent, risk_score: 33,
    });
    const actionId = guarded.json?.action_id || guarded.json?.action?.action_id;
    check('I1', 'guarded+recorded action created for the breakdown check',
      Boolean(actionId), `decision=${guarded.json?.decision} action_id=${actionId}`);

    if (actionId) {
      const detail = await api('GET', `/api/actions/${actionId}`);
      const b = detail.json?.guard_decision?.risk_breakdown;
      check('I1', 'GET /api/actions/:id exposes the risk composition on the FK path',
        b != null && b.base != null && b.server_total != null && b.effective != null && b.final != null,
        `keys=${JSON.stringify(Object.keys(b || {}))}`);

      const expectedEffective = Math.max(b?.server_total ?? 0, b?.template?.score ?? 0, b?.client_reported ?? 0);
      check('I2', 'breakdown terms reproduce the persisted composition',
        b?.client_reported === 33 && b?.effective === expectedEffective,
        `client_reported=${b?.client_reported} effective=${b?.effective} expected=${expectedEffective}`);
    } else {
      check('I1', 'risk composition on the FK path', false, 'no action_id from guard?record=true');
      check('I2', 'breakdown terms reproduce composition', false, 'no action_id from guard?record=true');
    }

    // Regression pin: the legacy list path 500ed on TEXT context columns
    // (context->'_risk_breakdown', 42883) — unit tests mock sql and can't
    // catch operator/column-type mismatches; only a live query proves this.
    const list = await api('GET', `/api/guard?agent_id=${encodeURIComponent(agent)}&limit=5`);
    const listed = (list.json?.decisions || []).find((d) => d.action_type === 'smoke.breakdown');
    check('I3', 'legacy guard list returns 200 and lifts risk_breakdown per row',
      list.status === 200 && listed?.risk_breakdown?.final != null && listed?.context === undefined,
      `status=${list.status} breakdown_final=${listed?.risk_breakdown?.final} context_leaked=${listed?.context !== undefined}`);
  }

  // J: /api/guard days param (owner roadmap item 6 — June-deferral triage)
  // Spec: docs/superpowers/specs/2026-07-02-june-deferral-triage.md
  // Pins the windowed-count contract: ?days=N windows rows AND `total`, so
  // ?decision=block&days=7 is a true weekly denied count.
  {
    const agent = agentFor('i'); // reuse the I-block agent — it has fresh decisions
    const windowed = await api('GET', `/api/guard?agent_id=${encodeURIComponent(agent)}&days=1&limit=1`);
    check('J1', 'guard list accepts days and returns a windowed total',
      windowed.status === 200 && Number(windowed.json?.total) >= 1,
      `status=${windowed.status} total=${windowed.json?.total}`);

    const unwindowed = await api('GET', `/api/guard?agent_id=${encodeURIComponent(agent)}&limit=1`);
    const deniedWeek = await api('GET', `/api/guard?agent_id=${encodeURIComponent(agent)}&decision=block&days=7&limit=1`);
    check('J2', 'windowed total never exceeds the un-windowed total; clean agent has 0 weekly denials',
      Number(unwindowed.json?.total) >= Number(windowed.json?.total) && Number(deniedWeek.json?.total) === 0,
      `unwindowed=${unwindowed.json?.total} windowed=${windowed.json?.total} denied7d=${deniedWeek.json?.total}`);
  }

  // K: guard-deadline degradation visibility (owner roadmap v2.1)
  // Spec: docs/plans/2026-07-02-guard-deadline-noise.md
  // Pins the surface contract: the proposals GET carries an org-wide
  // `degradation` summary (rate shown next to the proposals it was excluded
  // from), shaped for the /policies cockpit strip.
  {
    const proposals = await api('GET', '/api/policies/proposals?days=7');
    const deg = proposals.json?.degradation;
    check('K1', 'proposals GET exposes the degradation summary block',
      proposals.status === 200 && deg != null && deg.window_days === 7
        && Number.isFinite(Number(deg.total)) && Number.isFinite(Number(deg.degraded))
        && typeof deg.rate === 'number' && Array.isArray(deg.by_day),
      `status=${proposals.status} degradation=${JSON.stringify(deg)?.slice(0, 120)}`);
    check('K2', 'degradation counts are internally consistent (degraded ≤ total; rate matches)',
      deg != null && Number(deg.degraded) <= Number(deg.total)
        && (Number(deg.total) === 0 ? deg.rate === 0 : Math.abs(deg.rate - Number(deg.degraded) / Number(deg.total)) < 1e-9),
      `total=${deg?.total} degraded=${deg?.degraded} rate=${deg?.rate}`);
  }

  // M: approvals lifecycle hygiene (owner roadmap v2.3)
  // Spec: docs/plans/2026-07-02-approvals-lifecycle-hygiene.md
  // A pending approval whose client stopped waiting must expire, render as
  // expired, and refuse to "release" anything. Time cannot be faked over
  // HTTP, so the past-the-window state is SEEDED by backdating
  // approval_expires_at via direct SQL (DATABASE_URL — same .env.local / CI
  // env the server reads); everything else is proven over real HTTP.
  {
    const agent = agentFor('m');
    await createPolicy('lifecycle', 'risk_threshold',
      { threshold: 60, action: 'require_approval' }, [agent]);

    let seedSql = null;
    try {
      if (process.env.DATABASE_URL) {
        const { createSqlFromEnv } = await import(new URL('./_db.mjs', import.meta.url));
        seedSql = createSqlFromEnv();
      }
    } catch { /* reported via the failed checks below */ }

    const guarded = await api('POST', '/api/guard?record=true', {
      action_type: 'smoke.lifecycle', declared_goal: `expiring approval ${RUN}`,
      agent_id: agent, risk_score: 75, approval_wait_seconds: 30,
    });
    const actionId = guarded.json?.action_id;
    const detail = actionId ? await api('GET', `/api/actions/${actionId}`) : { json: {} };
    const act = detail.json?.action || {};
    // Measured against this script's clock, NOT created_at — created_at is a
    // no-timezone column whose serialized form parses as local time.
    const stampDelta = (new Date(act.approval_expires_at).getTime() - Date.now()) / 1000;
    check('M1', 'pending approval carries expiry = declared wait (30s) + retry grace (900s)',
      guarded.json?.decision === 'require_approval' && Number.isFinite(stampDelta)
        && stampDelta > 900 - 60 && stampDelta <= 930 + 15,
      `decision=${guarded.json?.decision} expires_at=${act.approval_expires_at} delta=${stampDelta}`);

    if (actionId && seedSql) {
      await seedSql`UPDATE action_records SET approval_expires_at = NOW() - interval '2 minutes' WHERE action_id = ${actionId}`;
      // The pending-approval list runs the lazy sweep — the exact request
      // /approvals makes on load.
      await api('GET', `/api/actions?status=pending_approval&agent_id=${encodeURIComponent(agent)}&limit=5`);
      const after = await api('GET', `/api/actions/${actionId}`);
      const st = after.json?.action?.status;
      check('M2', 'a pending approval past its window flips to expired on the queue read',
        st === 'expired' && /expired/i.test(after.json?.action?.error_message || ''),
        `status=${st} error=${after.json?.action?.error_message}`);

      const approve = await api('POST', `/api/approvals/${actionId}`, { decision: 'allow', reasoning: 'too late' });
      check('M3', 'approving an expired record returns a truthful 410 (releases nothing)',
        approve.status === 410 && approve.json?.code === 'APPROVAL_EXPIRED',
        `status=${approve.status} body=${JSON.stringify(approve.json)?.slice(0, 200)}`);
      const still = await api('GET', `/api/actions/${actionId}`);
      check('M3', 'expired record stays expired after the approval attempt',
        still.json?.action?.status === 'expired', `status=${still.json?.action?.status}`);

      // x402 ride-along: an expired purchase approval must release its
      // reserved budget row (execution_status pending → expired).
      const purchase = await api('POST', '/api/x402/purchases', {
        agent_id: agent, provider: 'smoke-provider', declared_goal: `expiring purchase ${RUN}`,
        cost_estimate: 3, risk_score: 75, approval_wait_seconds: 30,
        purchase_reason: 'lifecycle smoke', context_gap: 'expiry ride-along',
        expected_value: 'proof that an expired purchase approval releases its reserved budget',
      });
      const pActionId = purchase.json?.action?.action_id || purchase.json?.action_id;
      if (pActionId && purchase.json?.action?.status === 'pending_approval') {
        await seedSql`UPDATE action_records SET approval_expires_at = NOW() - interval '2 minutes' WHERE action_id = ${pActionId}`;
        await api('GET', `/api/actions?status=pending_approval&agent_id=${encodeURIComponent(agent)}&limit=5`);
        const plist = await api('GET', `/api/x402/purchases?agent_id=${encodeURIComponent(agent)}`);
        const prow = (plist.json?.purchases || []).find((p) => p.action_id === pActionId);
        check('M4', "expired x402 approval reconciles the purchase to execution_status='expired'",
          prow?.execution_status === 'expired', `purchase=${JSON.stringify(prow)?.slice(0, 200)}`);
      } else {
        check('M4', 'x402 expiry ride-along', false,
          `purchase not pending: status=${purchase.json?.action?.status} body=${JSON.stringify(purchase.json)?.slice(0, 200)}`);
      }
    } else {
      const why = actionId ? 'DATABASE_URL unavailable for the seeded backdate' : 'no action_id from guard?record=true';
      check('M2', 'expiry flip on queue read', false, why);
      check('M3', 'truthful 410 on expired', false, why);
      check('M3', 'expired stays expired', false, why);
      check('M4', 'x402 expiry ride-along', false, why);
    }
    // postgres.js keeps a live TCP pool that would hold the process open;
    // Neon's HTTP driver has no end() — hence the guarded call.
    if (typeof seedSql?.end === 'function') await seedSql.end().catch(() => {});
  }

  // ── Advocate v2a: assumption-invalidation notifications (N1–N5) ─────────
  {
    console.log('\nAdvocate v2a: assumption-invalidation notifications...');
    const agent = `smoke-asm-${RUN}`;
    const act = await api('POST', '/api/actions', {
      agent_id: agent, action_type: `smoke.assumption.${RUN}`,
      declared_goal: `assumption invalidation scenario ${RUN}`,
    });
    const actionId = act.json?.action?.action_id || act.json?.action_id;
    const asm = await api('POST', '/api/assumptions', {
      action_id: actionId, assumption: `the flag is enabled (${RUN})`, basis: 'smoke seed',
    });
    const asmRow = asm.json?.assumption || asm.json || {};
    const asmId = asmRow.assumption_id || asm.json?.assumption_id;

    const inv = await api('PATCH', `/api/assumptions/${asmId}`, {
      validated: false, invalidated_reason: `operator says the flag is OFF (${RUN})`,
    });
    check('N1', 'operator invalidation 200s and reports notification.message_id',
      inv.status === 200 && !!inv.json?.notification?.message_id,
      `status=${inv.status} body=${JSON.stringify(inv.json)?.slice(0, 200)}`);

    const inbox = await api('GET', `/api/messages?agent_id=${agent}&type=assumption_invalidated&unread=true`);
    const msgs = inbox.json?.messages || [];
    check('N2', 'invalidation lands as one unread inbox message with doc_ref',
      msgs.length === 1 && msgs[0]?.doc_ref === asmId,
      `count=${msgs.length} doc_ref=${msgs[0]?.doc_ref} expected=${asmId}`);

    const g1 = await api('POST', '/api/guard', {
      agent_id: agent, action_type: `smoke.assumption.next.${RUN}`,
      declared_goal: `act after invalidation ${RUN}`,
    });
    const alerts = g1.json?.assumption_alerts || [];
    check('N3', 'guard response carries assumption_alerts until acked',
      alerts.length >= 1 && alerts[0]?.assumption_id === asmId,
      `alerts=${JSON.stringify(alerts)?.slice(0, 200)}`);

    await api('PATCH', '/api/messages', {
      message_ids: [alerts[0]?.message_id].filter(Boolean), action: 'read', agent_id: agent,
    });
    const g2 = await api('POST', '/api/guard', {
      agent_id: agent, action_type: `smoke.assumption.after.${RUN}`,
      declared_goal: `act after ack ${RUN}`,
    });
    check('N4', 'after ack, guard response carries no assumption_alerts',
      !(g2.json?.assumption_alerts?.length),
      `alerts=${JSON.stringify(g2.json?.assumption_alerts)?.slice(0, 200)}`);

    const list = await api('GET', `/api/assumptions?agent_id=${agent}`);
    const row = (list.json?.assumptions || []).find((r) => r.assumption_id === asmId);
    check('N5', '/api/assumptions exposes notification_status=acknowledged',
      row?.notification_status === 'acknowledged',
      `row=${JSON.stringify(row)?.slice(0, 200)}`);
  }

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
    // guard?record=true never records a blocked action ("the hook never
    // records a blocked action — the guard_decisions audit row already
    // captures the block", app/api/guard/route.ts recordRunningAction), so
    // link it the way action_records.guard_decision_id is actually meant to
    // be populated for a block: guard first for the decision_id, then POST
    // /api/actions with that guard_decision_id (server validates it resolves
    // to a real same-org guard decision — drizzle/0035 FK linkage).
    const blockType = `smoke.retro.blocked.${RUN}`;
    await createPolicy(`smoke retro block ${RUN}`, 'block_action_type',
      { action_types: [blockType] }, [agent]);
    const blocked = await api('POST', '/api/guard', {
      agent_id: agent, action_type: blockType,
      declared_goal: `retro baseline goal ${RUN}`,
    });
    await api('POST', '/api/actions', {
      agent_id: agent, action_type: blockType,
      declared_goal: `retro baseline goal ${RUN}`, session_id: sessId,
      guard_decision_id: blocked.json?.decision_id,
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

  // ── Calibration proposals human surface (P1–P5, roadmap v2.6b) ──────────
  // Pins the ratification record end-to-end: judgment is a button (POST),
  // the maintainer queue is ?status=ratified, mark_forged closes the loop,
  // undo cleans up. Uses a run-unique cv_ id that never mines from real
  // traffic, so it exercises the orphan-snapshot path deliberately.
  {
    console.log('\nCalibration proposals surface...');
    const pid = 'cv_' + Date.now().toString(16).padStart(16, '0').slice(0, 16);
    const name = `smoke-calibration-${RUN}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const snapshot = {
      rule: 'repeated_approvals',
      suggested_label: 'benign',
      suggested_name: name,
      evidence_tier: 'human_approved',
      count: 3,
      risk_min: 40,
      risk_max: 60,
      provenance: `policy-smoke ${RUN}: synthetic ratification-record check`,
      ratify_command: null,
      needs_manual_context: true,
      representative: { action_type: `smoke.calibration.${RUN}` },
    };

    const ratify = await api('POST', '/api/calibration/proposals', {
      action: 'ratify', proposal_id: pid, proposal: snapshot,
    });
    check('P1', 'ratify records the human judgment',
      ratify.status === 200 && ratify.json?.ok === true,
      `status=${ratify.status} ${JSON.stringify(ratify.json)?.slice(0, 200)}`);

    const queue = await api('GET', '/api/calibration/proposals?status=ratified');
    const row = (queue.json?.proposals || []).find((p) => p.candidate_id === pid);
    // decided_by is null for operator-key callers (no user identity on that
    // auth path) — pin the decision record itself, not the actor.
    check('P2', 'ratified proposal surfaces in the maintainer queue with its decision record',
      !!row && row.from_snapshot === true && row.decision?.decision === 'ratified'
        && !!row.decision?.decided_at,
      `row=${JSON.stringify(row)?.slice(0, 200)}`);

    const forged = await api('POST', '/api/calibration/proposals', {
      action: 'mark_forged', proposal_id: pid, vector_name: name,
    });
    const queueAfter = await api('GET', '/api/calibration/proposals?status=ratified');
    const stillQueued = (queueAfter.json?.proposals || []).some((p) => p.candidate_id === pid);
    check('P3', 'mark_forged closes the loop and leaves the ratified queue',
      forged.status === 200 && forged.json?.forged === true && !stillQueued,
      `status=${forged.status} stillQueued=${stillQueued}`);

    const undo = await api('POST', '/api/calibration/proposals', {
      action: 'undo', proposal_id: pid,
    });
    check('P4', 'undo removes the judgment (smoke cleanup)',
      undo.status === 200 && undo.json?.removed === true,
      `status=${undo.status}`);

    const gone = await api('GET', '/api/calibration/proposals?status=ratified');
    check('P5', 'undone proposal is gone from every queue',
      !(gone.json?.proposals || []).some((p) => p.candidate_id === pid),
      `queue=${(gone.json?.proposals || []).length} rows`);
  }

  // ── Presence heartbeat (Q1, drizzle/0041 regression pin) ────────────────
  // On fresh schemas the presence upsert silently failed for every agent
  // (missing updated_at column + no unique (org_id, agent_id) behind the
  // ON CONFLICT) — the write is best-effort, so nothing surfaced it. The
  // discriminator: an agent known only from action_records reads
  // reported_status='unknown'; a landed heartbeat reads 'online' with a
  // last_heartbeat_at stamp.
  {
    console.log('\nPresence heartbeat...');
    const agent = agentFor('presence');
    await api('POST', '/api/actions', {
      agent_id: agent, action_type: `smoke.presence.${RUN}`,
      declared_goal: `presence heartbeat ${RUN}`, risk_score: 5,
    });
    let row = null;
    for (let attempt = 0; attempt < 3 && !row?.last_heartbeat_at; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 500));
      const res = await api('GET', '/api/agents');
      row = (res.json?.agents || []).find((a) => a.agent_id === agent) || null;
    }
    check('Q1', 'action submit lands an implicit presence heartbeat (agent_presence upsert works)',
      !!row && row.reported_status === 'online' && !!row.last_heartbeat_at,
      `row=${JSON.stringify(row)?.slice(0, 200)}`);
  }

  // ------------------------------------------------------------- cleanup ---
  console.log('\ncleanup: deleting smoke policies...');
  for (const id of createdPolicyIds) {
    const del = await api('DELETE', `/api/policies?id=${encodeURIComponent(id)}`);
    if (del.status >= 400) console.log(`  warn: DELETE ${id} → ${del.status} (delete manually from /policies)`);
  }

  // -------------------------------------------------------------- report ---
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  [${f.claim}] ${f.name} — ${f.detail}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
