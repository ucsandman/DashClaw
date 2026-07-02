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
