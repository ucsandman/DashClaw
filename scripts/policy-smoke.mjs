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
 * Auth: operator key (x-api-key = DASHCLAW_API_KEY) selected from explicit
 * process configuration or, when unset, the canonical repository env loader.
 * Per-org database keys resolve through hosted Neon HTTP and the self-hosted
 * internal key-resolution path.
 *
 * Isolation: every policy this script creates is scoped via agent_ids to
 * run-unique smoke agents and uses run-unique action types, so real org
 * traffic is never gated. All created policies are deleted at the end
 * (guard may serve them from cache for up to 30s after — harmless here).
 */

import './_load-env.mjs';
import { randomUUID } from 'node:crypto';

// --- env ---
// Explicit process/CI configuration wins. The canonical loader fills unset
// values from repository env files unless DASHCLAW_ENV_FILE_DISABLE=1.

const BASE = process.argv[2] || 'http://localhost:3000';
const KEY = process.env.DASHCLAW_API_KEY;
if (!KEY) {
  console.error('FATAL: DASHCLAW_API_KEY is not configured');
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

function withExecutionClaims(payload) {
  const caps = Array.isArray(payload.client_capabilities) ? payload.client_capabilities : [];
  return { ...payload, client_capabilities: [...new Set([...caps, 'execution_claims'])] };
}

// Protocol 1 separates read-only authority selection from the one durable
// permission boundary. Two evaluations may select the same grant; only the
// exact recorded action's PATCH claim consumes it and wins execution.
async function exerciseExecutionClaim(payload) {
  const request = withExecutionClaims(payload);
  const selected = await api('POST', '/api/guard', request);
  const recorded = await api('POST', '/api/guard?record=true', request);
  const actionId = recorded.json?.action_id;
  const attemptId = randomUUID();
  const claimBody = {
    claim_execution: true,
    attempt_id: attemptId,
    agent_id: request.agent_id,
    ...(request.act === undefined ? {} : { act: request.act }),
  };
  const claimed = actionId
    ? await api('PATCH', `/api/actions/${actionId}`, claimBody)
    : { status: 0, json: null };
  const duplicate = actionId
    ? await api('PATCH', `/api/actions/${actionId}`, { ...claimBody, attempt_id: randomUUID() })
    : { status: 0, json: null };
  const afterClaim = await api('POST', '/api/guard', request);
  return { selected, recorded, actionId, attemptId, claimed, duplicate, afterClaim };
}

// Since v5.27.0 (the Short List), POST /api/policies stores an interrupting
// rule in Watch (warn) unless the caller opts in with rules.short_list: true,
// and caps opted-in active lines at 10 per org (the seeded catastrophe pack
// holds 4 of those slots). Every interrupting smoke policy therefore opts in
// at its call site AND is retired (deactivated) at the end of its section via
// retirePolicy() so concurrent smoke lines never approach the cap. The gate
// itself is pinned live by the SL checks below section B1.
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

// Free the policy's Short List slot the moment its section is done. The final
// cleanup loop still DELETEs the row; this only keeps the concurrent active
// count under SHORT_LIST_CAP across the run.
async function retirePolicy(pid) {
  const { status } = await api('PATCH', '/api/policies', { id: pid, active: false });
  if (status >= 400) console.log(`  warn: retire ${pid} → ${status}`);
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

  // RS1: held -> approved -> resumed (the catastrophe pack's flagship loop).
  // Pins the SERVER side of the resume contract the pretool poll consumes: a
  // protected_path Write to `.env` is held for approval; approving it flips the
  // action out of pending_approval (approved_by set / status running) so the
  // paused tool call is released. Runs FIRST, before any other section creates
  // a smoke policy — a later-created block/require_approval smoke policy can
  // still be active here (agent-scoped policies are isolated by agent_ids, but
  // this keeps the check honest against the pristine pack-only state rather
  // than depending on every other section's cleanup) — so this proves the
  // pack's own policy fires, not a leftover smoke policy racing it.
  {
    const agent = agentFor('rs1');
    const pid = await createPolicy('hold-secret-writes', 'protected_path',
      { action: 'require_approval', short_list: true, paths: ['**/.env', '**/*.key', '**/secrets/**'] }, [agent]);

    const guarded = await api('POST', '/api/guard?record=true', {
      action_type: 'security', declared_goal: `Write: .env ${RUN}`,
      target: '.env', agent_id: agent,
    });
    const actionId = guarded.json?.action_id || guarded.json?.action?.action_id;
    check('RS1', 'secret-file Write is held for approval with an action_id',
      guarded.json?.decision === 'require_approval' &&
      (guarded.json?.matched_policies || []).includes(pid) && Boolean(actionId),
      `decision=${guarded.json?.decision} matched=${JSON.stringify(guarded.json?.matched_policies)} action_id=${actionId}`);

    if (actionId) {
      const approved = await api('POST', `/api/approvals/${actionId}`, { decision: 'allow' });
      check('RS1', 'approval accepted (POST /api/approvals returns 2xx)',
        approved.status >= 200 && approved.status < 300, `status=${approved.status}`);

      const after = await api('GET', `/api/actions/${actionId}`);
      const st = after.json?.action?.status;
      check('RS1', 'action left pending_approval (approved_by set / status running) so the paused tool call resumes',
        st !== 'pending_approval' && (Boolean(after.json?.action?.approved_by) || st === 'running' || st === 'approved'),
        `status=${st} approved_by=${after.json?.action?.approved_by}`);
    } else {
      check('RS1', 'approval accepted (POST /api/approvals returns 2xx)', false, 'no action_id to approve');
      check('RS1', 'action left pending_approval so the paused tool call resumes', false, 'no action_id to poll');
    }
    await retirePolicy(pid);
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
  // pidB1/pidB3 are hoisted: C1/C2/F1/A6 and the AE act-binding section below
  // reuse these agents+policies, so the slots are retired after AE, not here.
  let pidB1;
  let pidB3;
  {
    const agent = agentFor('b1');
    const pid = pidB1 = await createPolicy('block-type', 'block_action_type',
      { action_types: [`smoke.blocked.${RUN}`], short_list: true }, [agent]);
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

  // SL: the Short List admission gate itself (v5.27.0). A bare interrupting
  // create — no rules.short_list opt-in — must land in Watch: it still fires
  // and is matched, but the decision is warn, never block. And a type with no
  // Watch tier (delegation_constraint) must be refused outright with a 409
  // NO_WATCH_TIER, never stored with a demotion flag its evaluator ignores.
  {
    const agent = agentFor('sl');
    const pid = await createPolicy('watch-demoted', 'block_action_type',
      { action_types: [`smoke.sl.${RUN}`] }, [agent]); // deliberately NO short_list
    const demoted = await api('POST', '/api/guard', {
      action_type: `smoke.sl.${RUN}`, declared_goal: `bare interrupting create lands watched ${RUN}`, agent_id: agent,
    });
    check('SL1', 'bare interrupting create is demoted to Watch: fires as warn, never block',
      demoted.json?.decision === 'warn' && (demoted.json?.matched_policies || []).includes(pid),
      `decision=${demoted.json?.decision} matched=${JSON.stringify(demoted.json?.matched_policies)}`);

    const refused = await api('POST', '/api/policies', {
      name: `policy-smoke:no-watch-tier:${RUN}`, policy_type: 'delegation_constraint',
      rules: { parent: agent, child_types: ['*'], max_risk_score: 40, escalate_action: 'require_approval' },
      active: true, agent_ids: [agent],
    });
    check('SL2', 'no-watch-tier type without opt-in → 409 NO_WATCH_TIER',
      refused.status === 409 && refused.json?.code === 'NO_WATCH_TIER',
      `status=${refused.status} body=${JSON.stringify(refused.json)?.slice(0, 160)}`);
  }

  // B3: risk_threshold with action require_approval
  {
    const agent = agentFor('b3');
    const pid = pidB3 = await createPolicy('risk-approval', 'risk_threshold',
      { threshold: 60, action: 'require_approval', short_list: true }, [agent]);
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

  // L1–L2: agent identity family (roadmap v2.2). Composed sub-agent ids
  // (<parent>:<type>, DASHCLAW_SUBAGENT_IDENTITY=distinct — the default since
  // v2.2) inherit the parent's targeted policies, so a sub-agent cannot dodge
  // its parent's rules.
  {
    const parent = agentFor('fam');
    const child = `${parent}:explore`;
    const pid = await createPolicy('family-block', 'block_action_type',
      { action_types: [`smoke.family.${RUN}`], short_list: true }, [parent]);
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
    await retirePolicy(pid);
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
      client_capabilities: ['execution_claims'],
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

      // A6: evaluation selects the approval without consuming it. The exact
      // recorded retry consumes it only when protocol 1 claims execution.
      const execution = await exerciseExecutionClaim({
        agent_id: approvalAgent, action_type: 'smoke.risky',
        declared_goal: `risky recorded action ${RUN}`, risk_score: 75,
      });
      const selectedPolicies = execution.selected.json?.matched_policies || [];
      const recordedPolicies = execution.recorded.json?.matched_policies || [];
      check('A6', 'operator approval is selected twice without consumption before execution claim',
        execution.selected.json?.decision === 'allow'
          && selectedPolicies.includes('builtin:operator_approval')
          && execution.recorded.json?.decision === 'allow'
          && recordedPolicies.includes('builtin:operator_approval')
          && execution.recorded.json?.recorded === true
          && execution.recorded.json?.execution_claim_required === true
          && execution.recorded.json?.claim_protocol === 1,
        `selected=${execution.selected.json?.decision}/${JSON.stringify(selectedPolicies)} recorded=${execution.recorded.json?.decision}/${JSON.stringify(recordedPolicies)} action_id=${execution.actionId}`);
      check('A6', 'exact protocol-1 action claim succeeds and echoes its attempt',
        execution.claimed.status === 200 && execution.claimed.json?.claimed === true
          && execution.claimed.json?.action_id === execution.actionId
          && execution.claimed.json?.attempt_id === execution.attemptId,
        `status=${execution.claimed.status} body=${JSON.stringify(execution.claimed.json)?.slice(0, 200)}`);
      check('A6', 'a second execution claim conflicts',
        execution.duplicate.status === 409 && execution.duplicate.json?.code === 'EXECUTION_CLAIM_CONFLICT',
        `status=${execution.duplicate.status} body=${JSON.stringify(execution.duplicate.json)?.slice(0, 160)}`);
      check('A6', 'the claimed attempt consumes the operator grant',
        execution.afterClaim.json?.decision === 'require_approval',
        `decision=${execution.afterClaim.json?.decision} matched=${JSON.stringify(execution.afterClaim.json?.matched_policies)}`);

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

  // AE: act-content grant binding (drizzle/0056) — an approval for act X is
  // selectable only by a retry presenting the SAME act; its execution claim
  // consumes the grant. A different act with the same tuple re-queues.
  // Both acts are benign echoes so the evidence fold never swaps the
  // action_type — this family isolates the HASH binding, nothing else.
  {
    const agent = agentFor('b3'); // reuse risk_threshold(require_approval) agent
    const goal = `act-bound risky action ${RUN}`;
    const actX = { kind: 'shell', command: `echo deploy-artifact-${RUN}` };
    const actY = { kind: 'shell', command: `echo tampered-payload-${RUN}` };

    const pending = await api('POST', '/api/actions', {
      agent_id: agent, action_type: 'smoke.risky', declared_goal: goal, risk_score: 75, act: actX,
      client_capabilities: ['execution_claims'],
    });
    const pendingStatus = pending.json?.action?.status || pending.json?.status;
    const actionId = pending.json?.action_id || pending.json?.action?.action_id;
    check('AE', 'act-carrying action pends with act_content_hash stamped',
      pendingStatus === 'pending_approval' && !!pending.json?.action?.act_content_hash,
      `status=${pendingStatus} hash=${pending.json?.action?.act_content_hash || 'MISSING'}`);

    if (actionId) {
      const approved = await api('POST', `/api/approvals/${actionId}`, { decision: 'allow', reasoning: 'policy smoke (act binding)' });
      // Different act, same tuple → the grant must NOT cover it. The same-act
      // evaluations and claim below prove this refused attempt left it usable.
      const wrongAct = await api('POST', '/api/guard', {
        agent_id: agent, action_type: 'smoke.risky', declared_goal: goal, risk_score: 75, act: actY,
        client_capabilities: ['execution_claims'],
      });
      check('AE', 'approval for act X does NOT cover a retry with act Y (same goal tuple)',
        approved.status < 400 && wrongAct.json?.decision === 'require_approval',
        `approve=${approved.status} decision=${wrongAct.json?.decision}`);
      // Same act can be selected repeatedly, then the exact recorded retry's
      // protocol-1 claim consumes the act-bound grant.
      const execution = await exerciseExecutionClaim({
        agent_id: agent, action_type: 'smoke.risky', declared_goal: goal, risk_score: 75, act: actX,
      });
      check('AE', 'same-act approval is selected twice without consumption before claim',
        execution.selected.json?.decision === 'allow'
          && (execution.selected.json?.matched_policies || []).includes('builtin:operator_approval')
          && (execution.selected.json?.warnings || []).join(' ').includes('act-bound')
          && execution.recorded.json?.decision === 'allow'
          && execution.recorded.json?.recorded === true
          && execution.recorded.json?.claim_protocol === 1,
        `selected=${execution.selected.json?.decision} recorded=${execution.recorded.json?.decision} warnings=${JSON.stringify(execution.selected.json?.warnings)?.slice(0, 160)}`);
      check('AE', 'same-act protocol-1 claim succeeds with the exact act and attempt',
        execution.claimed.status === 200 && execution.claimed.json?.claimed === true
          && execution.claimed.json?.attempt_id === execution.attemptId,
        `status=${execution.claimed.status} body=${JSON.stringify(execution.claimed.json)?.slice(0, 180)}`);
      check('AE', 'second same-act execution claim conflicts',
        execution.duplicate.status === 409 && execution.duplicate.json?.code === 'EXECUTION_CLAIM_CONFLICT',
        `status=${execution.duplicate.status} body=${JSON.stringify(execution.duplicate.json)?.slice(0, 160)}`);
      check('AE', 'successful claim consumes the act-bound operator grant',
        execution.afterClaim.json?.decision === 'require_approval',
        `decision=${execution.afterClaim.json?.decision}`);
    } else {
      check('AE', 'act binding flow', false, 'no action_id returned for act-stamped pending action');
    }
    // b1/b3 reuse ends here — free their Short List slots.
    await retirePolicy(pidB1);
    await retirePolicy(pidB3);
  }

  // A5: blocks are absolute — approval on identical goal never downgrades block
  {
    const agent = agentFor('a5');
    const pid = await createPolicy('absolute-block', 'block_action_type',
      { action_types: [`smoke.absolute.${RUN}`], short_list: true }, [agent]);
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
    await retirePolicy(pid);
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
      { action_types: [`smoke.toggle.${RUN}`], short_list: true }, [agent]);
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
      { action_types: [`smoke.del.${RUN}`], short_list: true }, [agent]);
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
      { threshold: 60, action: 'require_approval', short_list: true }, [agent]);

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
    // include_synthetic=1: smoke traffic is excluded from tuning evidence by
    // default since the v4.5 ride-along fix (same toggle as tightening's).
    const proposalsUrl = `/api/policies/proposals?days=30&min_fired=3&min_resolved=3&include_synthetic=1`;
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
    await retirePolicy(pid);
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
    const lifecyclePid = await createPolicy('lifecycle', 'risk_threshold',
      { threshold: 60, action: 'require_approval', short_list: true }, [agent]);

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
    } else {
      const why = actionId ? 'DATABASE_URL unavailable for the seeded backdate' : 'no action_id from guard?record=true';
      check('M2', 'expiry flip on queue read', false, why);
      check('M3', 'truthful 410 on expired', false, why);
      check('M3', 'expired stays expired', false, why);
    }
    // postgres.js keeps a live TCP pool that would hold the process open;
    // Neon's HTTP driver has no end() — hence the guarded call.
    if (typeof seedSql?.end === 'function') await seedSql.end().catch(() => {});
    await retirePolicy(lifecyclePid);
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

    // POST /api/actions now always evaluates guard and stamps its decision.
    // Seed one explicit legacy row with no decision so coverage keeps testing
    // the real mixed-history denominator instead of relying on obsolete route
    // behavior. This uses only the configured disposable/local database.
    let legacySeeded = false;
    let retroSql = null;
    try {
      if (process.env.DATABASE_URL) {
        const { createSqlFromEnv } = await import(new URL('./_db.mjs', import.meta.url));
        retroSql = createSqlFromEnv();
        const legacyActionId = `act_retro_legacy_${RUN}`;
        const rows = await retroSql`
          INSERT INTO action_records (
            org_id, action_id, agent_id, action_type, declared_goal,
            status, outcome_status, session_id, guard_decision_id
          ) VALUES (
            ${process.env.DASHCLAW_API_KEY_ORG || 'org_default'}, ${legacyActionId}, ${agent},
            ${`smoke.retro.legacy.${RUN}`}, ${`retro legacy unguarded ${RUN}`},
            'running', 'pending', ${sessId || null}, NULL
          )
          RETURNING action_id
        `;
        legacySeeded = rows[0]?.action_id === legacyActionId;
      }
    } catch (err) {
      console.log(`  warn: retro legacy fixture unavailable: ${err.message}`);
    } finally {
      if (typeof retroSql?.end === 'function') await retroSql.end().catch(() => {});
    }

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
    const retroPid = await createPolicy(`smoke retro block ${RUN}`, 'block_action_type',
      { action_types: [blockType], short_list: true }, [agent]);
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
      legacySeeded && (retro.coverage?.actions_total ?? 0) >= 4 &&
      (retro.coverage?.actions_with_guard_decision ?? 0) >= 1 &&
      retro.coverage.actions_with_guard_decision < retro.coverage.actions_total,
      `legacy_seeded=${legacySeeded} coverage=${JSON.stringify(retro.coverage)}`);
    await retirePolicy(retroPid);
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

  // S: findings become proposals — tightening direction (roadmap v3.2).
  // Seed an ungoverned high-risk pattern, prove it mines into the expected
  // proposal (via the smoke-only ?include_synthetic=1 path), prove the default
  // GET never sees it (v3.1's bar holds), then the full ratify round-trip:
  // policy created → same call now interrupted → pattern retires → undo.
  {
    console.log('\nTightening proposals (findings → proposals)...');
    const agent = agentFor('tighten');
    const type = `smoke.tighten.${RUN}`;

    // Pick a client risk in [50, 74] strictly below every ACTIVE org-wide
    // risk_threshold policy's threshold, so the seeded calls genuinely reach
    // allow (a firing policy would make them governed — no pattern).
    const pol = await api('GET', '/api/policies');
    const orgWideThresholds = (pol.json?.policies || [])
      .filter((p) => {
        if (!p.active || p.policy_type !== 'risk_threshold') return false;
        if (!p.agent_ids || p.agent_ids === 'null' || p.agent_ids === '[]') return true;
        try { const scoped = JSON.parse(p.agent_ids); return !Array.isArray(scoped) || scoped.length === 0; } catch { return true; }
      })
      .map((p) => { try { const r = typeof p.rules === 'string' ? JSON.parse(p.rules) : p.rules; return Number(r?.threshold); } catch { return NaN; } })
      .filter(Number.isFinite);
    const ceiling = Math.min(74, ...orgWideThresholds.map((t) => t - 1));

    if (ceiling < 50) {
      // Org gates everything >= 50: nothing CAN reach allow ungoverned here —
      // which is itself the governed state this feature exists to produce.
      check('S1', `tightening seed skipped truthfully — org already gates risk >= ${ceiling + 1}`, true, `ceiling=${ceiling}`);
    } else {
      const risk = ceiling;
      const seedDecisions = [];
      let effectiveRisk = risk;
      for (let i = 0; i < 3; i++) {
        const g = await api('POST', '/api/guard', {
          action_type: type, declared_goal: `read a routine smoke value nobody governs ${i} ${RUN}`,
          agent_id: agent, risk_score: risk,
        });
        seedDecisions.push(g.json?.decision);
        effectiveRisk = Math.max(effectiveRisk, Number(g.json?.risk_score) || 0);
      }
      check('S1', 'seeded high-risk pattern reaches allow ungoverned (3× same action_type)',
        seedDecisions.every((d) => d === 'allow'),
        `decisions=${seedDecisions.join(',')} client_risk=${risk} effective=${effectiveRisk}`);

      const expectedLevel = effectiveRisk >= 75 ? 'critical' : 'high';

      // S2: the pattern mines into the expected proposal (smoke-only synthetic path)
      const tp = await api('GET', '/api/policies/tightening?include_synthetic=1&min_observed=3&days=1');
      const found = (tp.json?.proposals || []).find((p) => p.action_type === type);
      check('S2', 'seeded pattern produces the expected tightening proposal with evidence + patch',
        tp.status === 200 && !!found
          && found.risk_level === expectedLevel
          && found.evidence?.observed_count >= 3
          && found.patch?.policy_type === 'require_approval'
          && Array.isArray(found.patch?.rules?.action_types) && found.patch.rules.action_types.includes(type)
          && /^tp_[a-f0-9]{16}$/.test(found.id),
        `status=${tp.status} found=${!!found} level=${found?.risk_level} count=${found?.evidence?.observed_count}`);

      // S3: the DEFAULT GET never mines synthetic traffic (v3.1's own bar)
      const tpDefault = await api('GET', '/api/policies/tightening?days=1');
      const defaultBlob = JSON.stringify(tpDefault.json?.proposals || []);
      check('S3', 'default tightening GET excludes synthetic traffic entirely',
        tpDefault.status === 200 && !defaultBlob.includes(type) && !defaultBlob.includes(`"${agent}"`),
        `status=${tpDefault.status} leaked=${defaultBlob.includes(type)}`);

      if (found) {
        // S4: ratify creates the ACTIVE require_approval policy server-side and
        // the very same call is now interrupted — the round-trip proven live.
        const rat = await api('POST', '/api/policies/tightening', {
          action: 'ratify', proposal_id: found.id,
          proposal: { rule: found.rule, action_type: found.action_type, risk_level: found.risk_level },
        });
        const ratPolicyId = rat.json?.policy?.id || null;
        if (ratPolicyId) createdPolicyIds.push(ratPolicyId);
        const g2 = await api('POST', '/api/guard', {
          action_type: type, declared_goal: `same call after ratify ${RUN}`,
          agent_id: agent, risk_score: risk,
        });
        check('S4', 'ratify creates the require_approval policy and the same call is now interrupted',
          rat.status === 200 && !!ratPolicyId && g2.json?.decision === 'require_approval',
          `status=${rat.status} policy=${ratPolicyId} decision=${g2.json?.decision}`);

        // S5: the governed pattern retires from the queue (suppressed by its
        // own policy, not by bookkeeping) and undo removes only the judgment.
        const tp2 = await api('GET', '/api/policies/tightening?include_synthetic=1&min_observed=3&days=1');
        const stillMined = (tp2.json?.proposals || []).some((p) => p.action_type === type);
        const undo = await api('POST', '/api/policies/tightening', { action: 'undo', proposal_id: found.id });
        check('S5', 'ratified pattern retires (its policy governs it); undo removes the judgment, keeps the policy',
          !stillMined && undo.status === 200 && undo.json?.policy_kept === ratPolicyId,
          `stillMined=${stillMined} undo=${undo.status} kept=${undo.json?.policy_kept}`);
      } else {
        check('S4', 'ratify round-trip', false, 'no proposal from S2 to ratify');
        check('S5', 'retire + undo', false, 'no proposal from S2');
      }
    }
  }

  // U: approval-flood guard closeout (owner roadmap v3.5)
  // Spec revision: docs/superpowers/specs/2026-07-04-approval-flood-guard-revision.md
  // Detection ships since v4.15.0; these checks pin the v3.5 additions: the
  // synthetic exclusion (smoke traffic can never trip a real flood) with a
  // positive control via the ephemeral ?include_synthetic=1 view, and the
  // bulk-resolution mechanics with truthful counts.
  {
    const agent = agentFor('u');
    const floodType = `smoke.flood.${RUN}`;
    const pid = await createPolicy('flood-guard', 'require_approval',
      { action_types: [floodType], short_list: true }, [agent]);

    // Read the org's effective budget so the burst provably exceeds it.
    const budgetView = await api('GET', '/api/approvals/floods');
    const perPolicy = budgetView.json?.budget?.perPolicy ?? 10;
    const burst = perPolicy + 2;

    let interrupted = 0;
    for (let i = 1; i <= burst; i++) {
      const guarded = await api('POST', '/api/guard?record=true', {
        action_type: floodType, declared_goal: `flood smoke action ${RUN} #${i}`,
        agent_id: agent,
      });
      if (guarded.json?.decision === 'require_approval'
        && (guarded.json?.matched_policies || []).includes(pid)) interrupted++;
    }
    check('U1', `burst of ${burst} guard calls all interrupted by the flood policy (budget ${perPolicy})`,
      interrupted === burst, `interrupted=${interrupted}/${burst}`);

    // Positive control: the ephemeral diagnostic view (synthetic included,
    // nothing persisted) sees the burst as a would-trip — proving the
    // detector isn't just silent.
    const diagnostic = await api('GET', '/api/approvals/floods?include_synthetic=1');
    const wouldTrip = (diagnostic.json?.floods || []).find((f) => f.policy_id === pid);
    check('U2', 'diagnostic view (include_synthetic=1) would-trip the smoke policy with a truthful count',
      diagnostic.json?.synthetic_included === true && Number(wouldTrip?.count) >= burst,
      `floods=${JSON.stringify(diagnostic.json?.floods)}`);

    // The real flood view excludes the synthetic burst (v3.1 shared
    // predicate): smoke traffic never trips a flood, suppresses a real
    // per-action ping, or mints the red approval_flood signal.
    const realView = await api('GET', '/api/approvals/floods');
    const leaked = (realView.json?.floods || []).some((f) => f.policy_id === pid);
    check('U3', 'real flood view excludes the synthetic burst (no smoke-minted flood)',
      realView.status === 200 && !leaked, `floods=${JSON.stringify(realView.json?.floods)}`);

    // Bulk resolution (admin, capped, audited) reports truthful counts and
    // resolves the whole pending burst in one call.
    const bulk = await api('POST', '/api/approvals/bulk', {
      decision: 'deny', filter: { policy_id: pid },
    });
    check('U4', `bulk deny resolves the pending burst with truthful counts ({matched,resolved,failed})`,
      bulk.status === 200 && bulk.json?.matched === burst
      && bulk.json?.resolved === burst && bulk.json?.failed === 0,
      `status=${bulk.status} body=${JSON.stringify(bulk.json)}`);
    await retirePolicy(pid);
  }

  // V1–V3: coverage truth (roadmap v4.2) — the record knows what it missed.
  // A degraded expected-vs-recorded report renders sub-threshold math in the
  // diagnostic view; the real view never consumes synthetic evidence.
  {
    const degraded = agentFor('v-degraded');
    const healthy = agentFor('v-healthy');

    const post = await api('POST', '/api/coverage', {
      agent_id: degraded, harness: 'policy-smoke', harness_session_id: `smoke-${RUN}`,
      expected: 40, recorded: 8,
    });
    const postOk = post.status === 201 || post.status === 200;
    await api('POST', '/api/coverage', {
      agent_id: healthy, harness: 'policy-smoke', harness_session_id: `smoke-${RUN}`,
      expected: 30, recorded: 30,
    });
    check('V1', 'coverage report accepted (a dropped event stream is reportable evidence)',
      postOk, `status=${post.status} body=${JSON.stringify(post.json)}`);

    // Diagnostic view: the deliberately dropped stream is detected within the
    // same session — 8/40 = 20%, far below the 90% posture bar — and the
    // healthy control reads 100%, not null and not degraded.
    const diag = await api('GET', '/api/coverage?include_synthetic=1');
    const dRow = (diag.json?.coverage || []).find((c) => c.agentId === degraded);
    const hRow = (diag.json?.coverage || []).find((c) => c.agentId === healthy);
    check('V2', 'diagnostic view detects the dropped stream (20%) and clears the healthy control (100%)',
      diag.json?.synthetic_included === true && dRow?.recordPct === 20 && hRow?.recordPct === 100,
      `degraded=${JSON.stringify(dRow)} healthy=${JSON.stringify(hRow)}`);

    // Real view: synthetic evidence is excluded (shared v3.1/v4.1 predicate) —
    // smoke traffic never mints a coverage number or a posture finding.
    const real = await api('GET', '/api/coverage');
    const leaked = (real.json?.coverage || []).some((c) => c.agentId === degraded || c.agentId === healthy);
    check('V3', 'real coverage view excludes the synthetic reports (no smoke-minted coverage)',
      real.status === 200 && !leaked, `coverage=${JSON.stringify((real.json?.coverage || []).map((c) => c.agentId))}`);
  }

  // W1–W4: fleet attribution (roadmap v4.3) — a fan-out reads as one governed
  // unit with per-leaf lineage, joined from persisted evidence (never guessed).
  {
    const parent = agentFor('w-parent');
    const child = `${parent}:explore`;
    const hsid = `smoke-fanout-${RUN}`;
    const spawnUuid = `a-smoke-${RUN}`;

    // Parent spawn (orchestration) + composed child leaf, one harness session.
    const spawn = await api('POST', '/api/actions', {
      agent_id: parent, action_type: 'orchestration',
      declared_goal: `spawn a smoke subagent ${RUN}`, status: 'running',
      harness_session_id: hsid,
    });
    const spawnId = spawn.json?.action?.action_id || spawn.json?.action_id;
    const leaf = await api('POST', '/api/actions', {
      agent_id: child, action_type: 'smoke.read',
      declared_goal: `leaf work inside the smoke subagent ${RUN}`, status: 'completed',
      harness_session_id: hsid, subagent_uuid: spawnUuid,
    });
    check('W1', 'lineage fields persist on record (harness_session_id + subagent_uuid accepted)',
      Boolean(spawnId) && (leaf.status === 200 || leaf.status === 201),
      `spawn=${spawn.status} id=${spawnId} leaf=${leaf.status}`);

    // The spawn's PostToolUse patch carries the spawned agent uuid; only this
    // one outcome_metadata key persists (into outcome_progress jsonb).
    const patch = await api('PATCH', `/api/actions/${spawnId}`, {
      status: 'completed', output_summary: `spawn done ${RUN}`,
      outcome_metadata: { spawned_agent_uuid: spawnUuid, exit_code: 0 },
    });
    check('W2', 'spawn patch persists spawned_agent_uuid (lineage stamp survives the outcome whitelist)',
      patch.status === 200, `status=${patch.status}`);

    // Diagnostic view: the fan-out is one unit — both agents, the spawn, and
    // the leaf LINKED to it via the read-time join.
    const diag = await api('GET', '/api/agents/fanouts?include_synthetic=1&window_hours=1');
    const unit = (diag.json?.fanouts || []).find((f) => f.harness_session_id === hsid);
    check('W3', 'fan-out reads as one unit with per-leaf lineage (join populated)',
      diag.json?.synthetic_included === true && unit?.agent_count === 2
      && unit?.spawn_count === 1 && Number(unit?.linked_leaf_count) === 1
      && unit?.parent_agent_id === parent,
      `unit=${JSON.stringify(unit)}`);

    // Real view: synthetic fan-outs are invisible (shared predicate holds).
    const real = await api('GET', '/api/agents/fanouts');
    const leaked = (real.json?.fanouts || []).some((f) => f.harness_session_id === hsid);
    check('W4', 'real fan-out view excludes the synthetic session (no smoke-minted fan-out)',
      real.status === 200 && !leaked,
      `sessions=${JSON.stringify((real.json?.fanouts || []).map((f) => f.harness_session_id))}`);
  }

  // X1–X3: Judgment spine — agent_allowlist enforcement (roadmap v4.4).
  // Spec: docs/superpowers/specs/2026-07-04-one-judgment-spine.md (verdict 3).
  // NOTE ON LETTERING: the task that produced this section asked for B1/B2 —
  // B is already the claim-id namespace for block_action_type/x402 checks
  // above, so reusing it here would make FAILED output ambiguous. X is the
  // next unused letter in this file's own sequence (…T,U,V,W).
  console.log('\nJudgment spine (allowlist enforcement)...');
  {
    const agent = agentFor('allowlist');
    const allowedType = `smoke.allowed.${RUN}`;
    const unlistedType = `smoke.unlisted.${RUN}`;
    const pid = await createPolicy('agent-allowlist', 'agent_allowlist',
      { allowed_action_types: [allowedType], action: 'warn' }, [agent]);

    const allowed = await api('POST', '/api/guard', {
      action_type: allowedType, declared_goal: `call inside the allowlisted envelope ${RUN}`, agent_id: agent,
    });
    check('X1', 'agent_allowlist: action type inside the envelope → allow, policy not matched',
      allowed.json?.decision === 'allow' && !(allowed.json?.matched_policies || []).includes(pid),
      `decision=${allowed.json?.decision} matched=${JSON.stringify(allowed.json?.matched_policies)}`);

    const unlisted = await api('POST', '/api/guard', {
      action_type: unlistedType, declared_goal: `call outside the allowlisted envelope ${RUN}`, agent_id: agent,
    });
    check('X2', 'agent_allowlist: novel action type → warn with policy matched',
      unlisted.json?.decision === 'warn' && (unlisted.json?.matched_policies || []).includes(pid),
      `decision=${unlisted.json?.decision} matched=${JSON.stringify(unlisted.json?.matched_policies)}`);
    // Warn-level reasons ride in signals (guard.ts applyResult routes warn to
    // acc.warnings, never top-level reason — same as warn_action_type).
    const signals = Array.isArray(unlisted.json?.signals) ? unlisted.json.signals : [];
    check('X3', 'agent_allowlist: warn signal names the allowlist violation',
      signals.some((s) => typeof s === 'string' && s.includes('outside the agent')),
      `signals=${JSON.stringify(signals)}`);

    // Policy cleanup happens in the centralized loop below (pid is already in
    // createdPolicyIds from createPolicy), matching every other section's
    // convention — no separate try/finally needed here.
  }

  // Z: loosening direction — proposals that relax (roadmap v4.5).
  // Spec: docs/superpowers/specs/2026-07-05-loosening-direction.md
  // The tightening mirror, live: seed an over-interrupting envelope policy
  // (one type always approved, one never fired), prove it mines into a
  // carve-out proposal (smoke-only synthetic path), prove the default GET
  // never sees it, then the full ratify round-trip: policy relaxed → the
  // carved type flows free while the sibling stays governed → pattern
  // retires (its own updated_at reset) → undo keeps the relaxation.
  {
    console.log('\nLoosening proposals (proposals that relax)...');
    const agent = agentFor('loosen');
    const carveType = `smoke.loosen.carve.${RUN}`;
    const keepType = `smoke.loosen.keep.${RUN}`;
    const pid = await createPolicy('loosening-loop', 'require_approval',
      { action_types: [carveType, keepType], short_list: true }, [agent]);

    // Drive 3 interruptions on the carve type and approve each — unique
    // declared_goal per iteration (identical goals would trigger the builtin
    // operator-approval grant after the first approval, see T1).
    let seeded = 0;
    for (let i = 1; i <= 3; i++) {
      const guarded = await api('POST', '/api/guard?record=true', {
        action_type: carveType, declared_goal: `loosening smoke action ${RUN} #${i}`,
        agent_id: agent,
      });
      const actionId = guarded.json?.action_id || guarded.json?.action?.action_id;
      const interrupted = guarded.json?.decision === 'require_approval'
        && (guarded.json?.matched_policies || []).includes(pid);
      if (interrupted && actionId) {
        const approved = await api('POST', `/api/approvals/${actionId}`, { decision: 'allow' });
        if (approved.status < 400) seeded++;
      }
    }
    check('Z1', 'seeded 3 interruptions on the carve type, all approved', seeded === 3, `seeded=${seeded}/3`);

    // Z1 (mine): the always-approved envelope type mines into a carve-out
    // proposal via the smoke-only synthetic path.
    const looseningUrl = `/api/policies/loosening?include_synthetic=1&min_fired=3&min_resolved=3&days=7`;
    const lp = await api('GET', looseningUrl);
    const found = (lp.json?.proposals || []).find((p) => p.policy_id === pid);
    check('Z1', 'carve-out proposal mines with evidence + surgical patch',
      lp.status === 200 && !!found
        && found.rule === 'relax_policy_scope'
        && found.action_type === carveType
        && found.evidence?.fired >= 3
        && found.evidence?.approvals?.approved === 3
        && found.evidence?.override_rate === 1
        && Array.isArray(found.patch?.rules?.action_types)
        && !found.patch.rules.action_types.includes(carveType)
        && found.patch.rules.action_types.includes(keepType)
        && /^lp_[a-f0-9]{16}$/.test(found.id),
      `status=${lp.status} found=${!!found} rule=${found?.rule} fired=${found?.evidence?.fired} approved=${found?.evidence?.approvals?.approved}`);

    // Z2: the DEFAULT GET never mines synthetic traffic (S3's bar, mirrored) —
    // and the tuning proposals GET holds the same bar since the v4.5
    // ride-along fix.
    const lpDefault = await api('GET', '/api/policies/loosening?days=7');
    const defaultBlob = JSON.stringify(lpDefault.json?.proposals || []);
    // The tuning GET lists every active policy; the exclusion strips the
    // EVIDENCE — the smoke policy's stats row must read zero fires.
    const tuningDefault = await api('GET', '/api/policies/proposals?days=30&min_fired=3&min_resolved=3');
    const tuningStatsRow = (tuningDefault.json?.policies || []).find((p) => p.policy_id === pid);
    check('Z2', 'default loosening + tuning GETs exclude synthetic evidence entirely',
      lpDefault.status === 200 && !defaultBlob.includes(carveType) && !defaultBlob.includes(`"${agent}"`)
        && tuningDefault.status === 200
        && (tuningStatsRow?.fired?.total ?? 0) === 0 && (tuningStatsRow?.approvals?.approved ?? 0) === 0,
      `loosening_leak=${defaultBlob.includes(carveType)} tuning_fired=${tuningStatsRow?.fired?.total} tuning_approved=${tuningStatsRow?.approvals?.approved}`);

    if (found) {
      // Z3: ratify relaxes the policy server-side; the carved type flows
      // free while the sibling type stays governed — the interrupt-volume
      // drop proven live and surgical.
      const rat = await api('POST', '/api/policies/loosening', {
        action: 'ratify', proposal_id: found.id,
        proposal: { rule: found.rule, policy_id: found.policy_id, action_type: found.action_type },
      });
      const carveAfter = await api('POST', '/api/guard', {
        action_type: carveType, declared_goal: `carved type after ratify ${RUN}`, agent_id: agent,
      });
      const keepAfter = await api('POST', '/api/guard', {
        action_type: keepType, declared_goal: `sibling type after ratify ${RUN}`, agent_id: agent,
      });
      check('Z3', 'ratify relaxes the policy: carved type → allow, sibling type still interrupted',
        rat.status === 200
          && carveAfter.json?.decision === 'allow'
          && keepAfter.json?.decision === 'require_approval'
          && (keepAfter.json?.matched_policies || []).includes(pid),
        `status=${rat.status} carve=${carveAfter.json?.decision} keep=${keepAfter.json?.decision}`);

      // Z4: the ratified pattern retires (the policy's updated_at bump reset
      // its evidence window — self-suppression through the policy, not
      // bookkeeping); undo removes only the judgment and KEEPS the change.
      const lp2 = await api('GET', looseningUrl);
      const stillMined = (lp2.json?.proposals || []).some((p) => p.id === found.id && p.status === 'pending');
      const undo = await api('POST', '/api/policies/loosening', { action: 'undo', proposal_id: found.id });
      const polAfterUndo = await api('GET', '/api/policies');
      const liveRow = (polAfterUndo.json?.policies || []).find((p) => p.id === pid);
      let liveTypes = [];
      try {
        const r = typeof liveRow?.rules === 'string' ? JSON.parse(liveRow.rules) : liveRow?.rules;
        liveTypes = Array.isArray(r?.action_types) ? r.action_types : [];
      } catch { /* leave empty */ }
      check('Z4', 'ratified pattern retires; undo removes the judgment, keeps the relaxation (change_kept)',
        !stillMined && undo.status === 200 && undo.json?.change_kept === pid
          && !liveTypes.includes(carveType) && liveTypes.includes(keepType),
        `stillMined=${stillMined} undo=${undo.status} kept=${undo.json?.change_kept} types=${JSON.stringify(liveTypes)}`);

      // Z5: integrity — a tampered snapshot (wrong action_type for the id)
      // is refused; dismiss without a reason is refused.
      const tampered = await api('POST', '/api/policies/loosening', {
        action: 'ratify', proposal_id: found.id,
        proposal: { rule: found.rule, policy_id: found.policy_id, action_type: keepType },
      });
      const noReason = await api('POST', '/api/policies/loosening', {
        action: 'dismiss', proposal_id: found.id,
        proposal: { rule: found.rule, policy_id: found.policy_id, action_type: found.action_type },
      });
      check('Z5', 'tampered snapshot → 400; dismiss without reason → 400',
        tampered.status === 400 && noReason.status === 400,
        `tampered=${tampered.status} noReason=${noReason.status}`);
    } else {
      check('Z3', 'ratify round-trip', false, 'no proposal from Z1 to ratify');
      check('Z4', 'retire + undo change_kept', false, 'no proposal from Z1');
      check('Z5', 'integrity checks', false, 'no proposal from Z1');
    }
    await retirePolicy(pid);
  }

  // ---------------------------------------------------------------- AA ----
  // v4.6 funnel truth. Hosted-off instances must 404 the funnel (the gate);
  // hosted-on instances must serve the aggregate shape with no org ids.
  // The funnel MATH is pinned by vitest, not smoke: flipping DASHCLAW_HOSTED
  // means restarting the server mid-run (v4.4 precedent for non-live-smokeable).
  console.log('\nAA. v4.6 funnel truth...');
  {
    const cap = await api('GET', '/api/hosted/capacity');
    const fun = await api('GET', '/api/hosted/funnel');
    if (cap.status === 404) {
      check('AA1', 'hosted off: GET /api/hosted/funnel is gated (404)',
        fun.status === 404, `capacity=${cap.status} funnel=${fun.status}`);
    } else {
      check('AA1', 'hosted on: funnel serves aggregate shape with no org ids',
        fun.status === 200
          && fun.json?.hosted === true
          && typeof fun.json?.funnel?.minted === 'number'
          && typeof fun.json?.annotations?.returned === 'number' // v5.3 sharpened distinctions
          && Array.isArray(fun.json?.annotations?.bySource) // v6.4 reach attribution
          && typeof fun.json?.annotations?.graduated === 'number' // v7.2 graduation
          && !JSON.stringify(fun.json).includes('org_'),
        `funnel=${fun.status} minted=${fun.json?.funnel?.minted}`);
    }
  }

  // ---------------------------------------------------------------- AB ----
  // v5.1 a way back in. On a hosted-off instance (this smoke run) the trial
  // session surface must be mechanically inert: the mint route 404s, and a
  // forged dashclaw-trial-session cookie on a page request is just an
  // unknown cookie — plain /login redirect, never a trial-expired state.
  // The hosted-ON contract (cookie minting, org-scoped page render,
  // expired-org redirect, cap envelope) is pinned by vitest
  // (trial-session-middleware.test.js, trial-session-routes.test.ts):
  // flipping DASHCLAW_HOSTED means restarting the server mid-run
  // (v4.4/v4.6 precedent for non-live-smokeable).
  console.log('\nAB. v5.1 a way back in...');
  {
    const cap = await api('GET', '/api/hosted/capacity');
    if (cap.status === 404) {
      const mint = await api('POST', '/api/hosted/workspaces', {});
      check('AB1', 'hosted off: POST /api/hosted/workspaces is gated (404)',
        mint.status === 404, `mint=${mint.status}`);
      const page = await fetch(`${BASE}/decisions`, {
        redirect: 'manual',
        headers: { cookie: 'dashclaw-trial-session=forged.trial.cookie' },
      });
      const loc = page.headers.get('location') || '';
      check('AB2', 'hosted off: forged trial cookie on a page → plain /login redirect',
        page.status >= 300 && page.status < 400
          && loc.includes('/login') && !loc.includes('trial=expired'),
        `status=${page.status} location=${loc}`);
    } else {
      // Hosted instance: the mint route is live (Turnstile-gated) — assert
      // only that a forged/garbage trial cookie never grants a page render.
      const page = await fetch(`${BASE}/decisions`, {
        redirect: 'manual',
        headers: { cookie: 'dashclaw-trial-session=forged.trial.cookie' },
      });
      const loc = page.headers.get('location') || '';
      check('AB2', 'hosted on: forged trial cookie never renders a page (redirected out)',
        page.status >= 300 && page.status < 400 && loc.length > 0,
        `status=${page.status} location=${loc}`);
    }
  }

  // ---------------------------------------------------------------- AC ----
  // v5.2 first governed action in the browser. The guided card renders only
  // for a live trial session on a hosted instance, so on a hosted-off run
  // /connect must contain no first-action panel marker (mechanically inert).
  // The hosted-ON contract (card renders in the trial branch, one
  // POST /api/guard?record=true, ledger deep link, funnel-visible defaults)
  // is pinned by vitest (first-governed-action.test.jsx): flipping
  // DASHCLAW_HOSTED means restarting the server mid-run (v4.4/v4.6/v5.1
  // precedent for non-live-smokeable).
  console.log('\nAC. v5.2 first governed action in the browser...');
  {
    const cap = await api('GET', '/api/hosted/capacity');
    if (cap.status === 404) {
      const page = await fetch(`${BASE}/connect`);
      const html = await page.text();
      check('AC1', 'hosted off: /connect renders no first-action panel',
        page.status === 200 && !html.includes('id="first-action"'),
        `status=${page.status} marker=${html.includes('id="first-action"')}`);
    } else {
      // Hosted instance: an anonymous request (no trial cookie) must not see
      // the guided card either — it only renders inside the trial branch.
      const page = await fetch(`${BASE}/connect`);
      const html = await page.text();
      check('AC1', 'hosted on: anonymous /connect renders no first-action panel',
        page.status === 200 && !html.includes('id="first-action"'),
        `status=${page.status} marker=${html.includes('id="first-action"')}`);
    }
  }

  // ---------------------------------------------------------------- AD ----
  // Evidence-first guard (v4.63.0): the server classifies the caller-attached
  // act and folds its derived risk in (evidence only RAISES), and the
  // require_evidence switch escalates declared-only calls.
  console.log('\nAD. evidence-first guard...');
  {
    // A declared-benign call whose ACT is destructive classifies high + mismatch.
    const { status, json } = await api('POST', '/api/guard', {
      action_type: 'read',
      declared_goal: `evidence mismatch ${RUN}`,
      agent_id: agentFor('evidence'),
      act: { kind: 'shell', command: 'rm -rf /prod-data' },
    });
    check('AD1', 'evidence: a destructive act under a benign declared type grades high + flags mismatch',
      status === 200 && json?.intent_source === 'evidence' && json?.evidence_mismatch === true && (json?.risk_score ?? 0) >= 80,
      `status=${status} intent_source=${json?.intent_source} mismatch=${json?.evidence_mismatch} risk=${json?.risk_score}`);

    // Evidence Required switch: a declared-only deploy (no act) must escalate.
    const evidencePid = await createPolicy('evidence-required', 'require_evidence',
      { action_types: ['deploy'], enforcement: 'require_approval', short_list: true }, [agentFor('evidence-req')]);
    const declaredOnly = await api('POST', '/api/guard', {
      action_type: 'deploy',
      declared_goal: `evidence required ${RUN}`,
      agent_id: agentFor('evidence-req'),
    });
    check('AD2', 'require_evidence: a declared-only deploy escalates to require_approval',
      declaredOnly.status === 200 && declaredOnly.json?.decision === 'require_approval' && declaredOnly.json?.intent_source === 'declared',
      `status=${declaredOnly.status} decision=${declaredOnly.json?.decision} intent_source=${declaredOnly.json?.intent_source}`);

    // The same call WITH an act (evidence-graded) is not escalated by the switch.
    const withEvidence = await api('POST', '/api/guard', {
      action_type: 'deploy',
      declared_goal: `evidence graded ${RUN}`,
      agent_id: agentFor('evidence-req'),
      act: { kind: 'shell', command: 'vercel deploy --prod' },
    });
    check('AD3', 'require_evidence: an evidence-graded deploy is NOT escalated by the switch',
      withEvidence.status === 200 && withEvidence.json?.intent_source === 'evidence' && withEvidence.json?.decision !== 'require_approval',
      `status=${withEvidence.status} decision=${withEvidence.json?.decision} intent_source=${withEvidence.json?.intent_source}`);
    await retirePolicy(evidencePid);
  }

  // ---------------------------------------------------------------- AE ----
  // v7.2 graduation path: the workspace carry-out. Full-org export is NOT
  // smoked here — the operator org's action_records are unbounded and the
  // bundle would be arbitrarily large; the export contract (shape, deny-list,
  // graduation stamp) is pinned by vitest (workspace-bundle-repository,
  // workspace-routes) and the v7.2 live proof ran it end to end on a
  // trial-sized org. Smoke pins what must hold on every live instance: the
  // routes are auth-gated, validation is loud, and import is idempotent.
  console.log('\nAE. v7.2 graduation path (workspace carry-out)...');
  {
    const anon = await fetch(`${BASE}/api/workspace/export`);
    check('AE1', 'workspace export: unauthenticated → 401',
      anon.status === 401, `status=${anon.status}`);

    const bad = await api('POST', '/api/workspace/import', { format: 'not-a-bundle' });
    check('AE2', 'workspace import: malformed bundle → 400, loudly',
      bad.status === 400 && typeof bad.json?.error === 'string',
      `status=${bad.status} error=${bad.json?.error}`);

    // An INACTIVE policy so the import never affects this org's guard.
    const policyId = `gp_smoke_import_${RUN}`;
    const bundle = {
      format: 'dashclaw-workspace-bundle',
      version: 1,
      exported_at: new Date().toISOString(),
      org: { id: 'org_smoke_source', name: 'smoke' },
      counts: { guard_policies: 1 },
      tables: {
        guard_policies: [{
          id: policyId,
          name: `smoke import ${RUN}`,
          policy_type: 'block_action_type',
          rules: '{"action_types":[]}',
          active: 0,
        }],
      },
    };
    const first = await api('POST', '/api/workspace/import', bundle);
    check('AE3', 'workspace import: a new row imports into the caller org',
      first.status === 201 && first.json?.imported === 1,
      `status=${first.status} imported=${first.json?.imported}`);
    const second = await api('POST', '/api/workspace/import', bundle);
    check('AE4', 'workspace import: re-importing the same bundle is a no-op (idempotent)',
      second.status === 201 && second.json?.imported === 0 && second.json?.skipped === 1,
      `status=${second.status} imported=${second.json?.imported} skipped=${second.json?.skipped}`);
    createdPolicyIds.push(policyId); // ride the standard cleanup
  }

  // ---------------------------------------------------------------- AF ----
  // Preflight plan authorization (governed-autonomy feature 1). Live proof:
  // submit -> approve -> repeated evaluation selects the grant without
  // consuming it -> the recorded attempt claims execution and consumes it ->
  // the second claim conflicts and later evaluation interrupts again.
  //
  // Self-contained: rather than relying on the org's ambient Production
  // Safety template to land require_approval for risk 90 (not guaranteed on
  // every live instance), this creates a temporary agent-scoped
  // risk_threshold policy the same way section B3 does, so AF3/AF4 hold
  // regardless of what else is configured on the org. It rides the standard
  // createPolicy() cleanup — no extra bookkeeping needed.
  console.log('\nAF. preflight plan authorization...');
  {
    const agent = agentFor('plan');
    const afPid = await createPolicy('af-preflight', 'risk_threshold',
      { threshold: 60, action: 'require_approval', short_list: true }, [agent]);
    const goal = `plan-smoke deploy ${RUN}`;
    const submit = await api('POST', '/api/plans', {
      agent_id: agent,
      declared_goal: `plan-smoke mission ${RUN}`,
      ttl_minutes: 10,
      steps: [{ action_type: 'deploy', step_goal: goal }],
    });
    check('AF1', 'plan submits with a preview verdict on the step',
      submit.status === 201 && submit.json?.plan?.plan_id?.startsWith('pa_')
        && typeof submit.json?.steps?.[0]?.preview_decision === 'string',
      `status=${submit.status} preview=${submit.json?.steps?.[0]?.preview_decision}`);

    const planId = submit.json?.plan?.plan_id;
    const approve = await api('POST', `/api/plans/${planId}`, { verdict: 'approve' });
    check('AF2', 'operator approves the plan (expires_at set)',
      approve.status === 200 && approve.json?.plan?.status === 'approved' && !!approve.json?.plan?.expires_at,
      `status=${approve.status} plan=${approve.json?.plan?.status}`);

    const execution = await exerciseExecutionClaim({
      agent_id: agent, action_type: 'deploy', declared_goal: goal, risk_score: 90,
    });
    check('AF3', 'matching plan authority is selected twice without consumption before claim',
      execution.selected.json?.decision === 'allow'
        && (execution.selected.json?.matched_policies || []).includes('builtin:plan_grant')
        && execution.recorded.json?.decision === 'allow'
        && (execution.recorded.json?.matched_policies || []).includes('builtin:plan_grant')
        && execution.recorded.json?.recorded === true
        && execution.recorded.json?.claim_protocol === 1,
      `selected=${execution.selected.json?.decision} recorded=${execution.recorded.json?.decision} matched=${JSON.stringify(execution.recorded.json?.matched_policies)} action_id=${execution.actionId}`);
    check('AF3', 'matching plan attempt claims execution with the exact nonce',
      execution.claimed.status === 200 && execution.claimed.json?.claimed === true
        && execution.claimed.json?.attempt_id === execution.attemptId,
      `status=${execution.claimed.status} body=${JSON.stringify(execution.claimed.json)?.slice(0, 180)}`);
    check('AF3', 'second plan execution claim conflicts',
      execution.duplicate.status === 409 && execution.duplicate.json?.code === 'EXECUTION_CLAIM_CONFLICT',
      `status=${execution.duplicate.status} body=${JSON.stringify(execution.duplicate.json)?.slice(0, 160)}`);
    check('AF4', 'identical evaluation interrupts after the claim consumes the single-use grant',
      execution.afterClaim.json?.decision === 'require_approval',
      `decision=${execution.afterClaim.json?.decision}`);

    const revoked = await api('POST', `/api/plans/${planId}`, { verdict: 'revoke' });
    check('AF5', 'revoke kills the plan',
      revoked.status === 200 && revoked.json?.plan?.status === 'revoked',
      `status=${revoked.status} plan=${revoked.json?.plan?.status}`);

    // AF6-AF8: act-bound proof. A separate plan/agent/policy so this is
    // fully independent of AF1-AF5's declared-goal-bound step above.
    const actAgent = agentFor('plan-act');
    const afActPid = await createPolicy('af-preflight-act', 'risk_threshold',
      { threshold: 60, action: 'require_approval', short_list: true }, [actAgent]);
    const actGoal = `plan-smoke act-bound deploy ${RUN}`;
    const actCommand = `echo af-act-${RUN}`;
    const actSubmit = await api('POST', '/api/plans', {
      agent_id: actAgent,
      declared_goal: `plan-smoke act-bound mission ${RUN}`,
      ttl_minutes: 10,
      steps: [{ action_type: 'shell', step_goal: actGoal, act: { kind: 'shell', command: actCommand } }],
    });
    const actPlanId = actSubmit.json?.plan?.plan_id;
    await api('POST', `/api/plans/${actPlanId}`, { verdict: 'approve' });

    // The mismatched evaluation runs before consumption, so AF7 proves the
    // act binding rather than merely observing an already-used grant.
    const otherAct = await api('POST', '/api/guard', {
      agent_id: actAgent, action_type: 'shell', declared_goal: actGoal, risk_score: 90,
      act: { kind: 'shell', command: `echo af-other-${RUN}` },
      client_capabilities: ['execution_claims'],
    });
    const actExecution = await exerciseExecutionClaim({
      agent_id: actAgent, action_type: 'shell', declared_goal: actGoal, risk_score: 90,
      act: { kind: 'shell', command: actCommand },
    });
    check('AF7', 'act-bound grant: a DIFFERENT act does not match (require_approval, no grant)',
      otherAct.json?.decision === 'require_approval',
      `decision=${otherAct.json?.decision}`);
    check('AF6', 'act-bound plan authority is selected twice before the exact claim',
      actExecution.selected.json?.decision === 'allow'
        && (actExecution.selected.json?.matched_policies || []).includes('builtin:plan_grant')
        && actExecution.recorded.json?.decision === 'allow'
        && actExecution.recorded.json?.recorded === true
        && actExecution.recorded.json?.claim_protocol === 1,
      `selected=${actExecution.selected.json?.decision} recorded=${actExecution.recorded.json?.decision} matched=${JSON.stringify(actExecution.recorded.json?.matched_policies)}`);
    check('AF6', 'exact-act plan attempt claims execution with the exact nonce',
      actExecution.claimed.status === 200 && actExecution.claimed.json?.claimed === true
        && actExecution.claimed.json?.attempt_id === actExecution.attemptId,
      `status=${actExecution.claimed.status} body=${JSON.stringify(actExecution.claimed.json)?.slice(0, 180)}`);
    check('AF6', 'second exact-act plan claim conflicts',
      actExecution.duplicate.status === 409 && actExecution.duplicate.json?.code === 'EXECUTION_CLAIM_CONFLICT',
      `status=${actExecution.duplicate.status} body=${JSON.stringify(actExecution.duplicate.json)?.slice(0, 160)}`);
    check('AF6', 'successful exact-act claim consumes the plan grant',
      actExecution.afterClaim.json?.decision === 'require_approval',
      `decision=${actExecution.afterClaim.json?.decision}`);

    const actRevoked = await api('POST', `/api/plans/${actPlanId}`, { verdict: 'revoke' });
    check('AF8', 'revoke kills the act-bound plan',
      actRevoked.status === 200 && actRevoked.json?.plan?.status === 'revoked',
      `status=${actRevoked.status} plan=${actRevoked.json?.plan?.status}`);
    await retirePolicy(afPid);
    await retirePolicy(afActPid);
  }

  // ---------------------------------------------------------------- AG ----
  // Scoped delegation constraints (governed-autonomy feature 2). Live proof:
  // a composed child trips the constraint; the bare parent does not.
  console.log('\nAG. scoped delegation constraints...');
  {
    const parent = agentFor('dc');
    const child = `${parent}:explore`;
    // delegation_constraint has NO Watch tier (see SL2): the opt-in is mandatory.
    const pid = await createPolicy('dc-ceiling', 'delegation_constraint',
      { parent, child_types: ['*'], max_risk_score: 40, escalate_action: 'require_approval', short_list: true }, [parent, child]);
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
      { parent, child_types: ['*'], max_depth: 1, escalate_action: 'block', short_list: true }, [parent, child, `${child}:sub`]);
    const deep2 = await api('POST', '/api/guard', {
      action_type: 'smoke.read', declared_goal: `dc deep2 ${RUN}`, agent_id: `${child}:sub`, risk_score: 5,
    });
    check('AG4', 'depth 2 with max_depth 1 → block',
      deep2.json?.decision === 'block' && (deep2.json?.matched_policies || []).includes(pid2),
      `decision=${deep2.json?.decision}`);
    void deep; // first deep call predates pid2 — not asserted
    await retirePolicy(pid);
    await retirePolicy(pid2);
  }

  // ---------------------------------------------------------------- AH ----
  // Live containment verdict + promotion proof (governed-autonomy feature 3,
  // RFC docs/rfcs/2026-07-06-containment-verdicts.md). Task-14 brief called
  // this "section AG", but by the time this task ran the AG letter was
  // already claimed by the shipped delegation-constraint proof directly
  // above (v5.5.0, commit e8ef18ff) — lettered AH instead so no section
  // header or claim id collides; see .superpowers/sdd/task-14-report.md.
  //
  // Self-contained the same way AF is: a temporary agent-scoped
  // risk_threshold policy with a containment band ([contain_above,
  // threshold)) so this holds regardless of what else is configured on the
  // org. Rides the standard createPolicy() cleanup.
  //
  // Proves, end to end: risk-band containment negotiates allow_contained to
  // a contained result when the caller advertises support; the identical
  // call without that advertisement downgrades to require_approval (skew
  // only tightens); an http act is never containable even in-band with
  // capabilities; the agent-side awaiting_promotion flip + operator promote
  // verdict actually mint a covering grant; repeated evaluation selects it
  // read-only, then the SAME canonical merge retry claims execution exactly
  // once and consumes it (act-content-hash bound).
  console.log('\nAH. live containment verdict + promotion proof...');
  {
    const agent = agentFor('contain');
    const pid = await createPolicy('ah-containment', 'risk_threshold',
      { threshold: 80, action: 'require_approval', contain_above: 40, short_list: true }, [agent]);
    check('AH1', 'agent-scoped risk_threshold policy with a containment band created',
      Boolean(pid), `policy_id=${pid}`);

    const fileAct = { kind: 'file', file: { path: 'src/containment-smoke.ts', content_excerpt: 'x' } };

    const withCaps = await api('POST', '/api/guard', {
      agent_id: agent, action_type: 'smoke.write', declared_goal: `containment file write ${RUN}`,
      risk_score: 60, act: fileAct, client_capabilities: ['allow_contained'],
    });
    check('AH2', 'file act in the containment band + capability advertised → allow_contained, negotiated contained',
      withCaps.json?.decision === 'allow_contained' && withCaps.json?.containment?.status === 'contained',
      `decision=${withCaps.json?.decision} containment=${JSON.stringify(withCaps.json?.containment)}`);

    const withoutCaps = await api('POST', '/api/guard', {
      agent_id: agent, action_type: 'smoke.write', declared_goal: `containment file write no-cap ${RUN}`,
      risk_score: 60, act: fileAct,
    });
    check('AH3', 'same call without client_capabilities → downgraded to require_approval (skew only tightens)',
      withoutCaps.json?.decision === 'require_approval'
        && withoutCaps.json?.risk_breakdown?._containment?.downgraded_to_interrupt === true,
      `decision=${withoutCaps.json?.decision} _containment=${JSON.stringify(withoutCaps.json?.risk_breakdown?._containment)}`);

    const httpAct = await api('POST', '/api/guard', {
      agent_id: agent, action_type: 'smoke.http', declared_goal: `containment http call ${RUN}`,
      risk_score: 60, act: { kind: 'http', request: { url: 'https://example.com/x', method: 'POST' } },
      client_capabilities: ['allow_contained'],
    });
    // Asserts the containment-eligibility claim itself (never negotiated to
    // allow_contained/contained), not the raw final decision: an org can have
    // its own ambient allow_grant policy for this call's (evidence-derived)
    // action type — e.g. a "Claude Code Mode" preset grant on api-classified
    // acts — that legitimately downgrades an UNRELATED require_approval to
    // allow after containment eligibility has already been decided. That
    // grant's downgrade doesn't touch containment, and applyResult always
    // pushes a matching policy's id to matched_policies before any later
    // grant runs, so pid's presence here is unaffected by it either way.
    // Adjacent to, but NOT the same as, AF's ambient-config note above: AF
    // defends against an ambient policy RAISING a decision (a template's own
    // risk_threshold could independently land require_approval); this is the
    // opposite direction — an ambient allow_grant policy DOWNGRADING a
    // decision after the fact (evaluate.ts's applyAllowGrants, ~line 301).
    // The RFC's actual "never containable" claim still requires proving the
    // require_approval fallback fired, not just waving off any non-contained
    // outcome — so a bare 'allow' with no explanation must still fail. If the
    // final decision is 'allow', a matching warning must document an actual
    // grant downgrade (the literal string emitted at evaluate.ts:301 is
    // `${policy.name}: grant downgraded ${prior decision} to allow` — matched
    // here via /downgraded|grant/i rather than an exact string, since the
    // policy name and prior-decision fragments vary run to run). Any other
    // unexplained outcome (a silent allow, a block, anything but
    // require_approval or an explained allow) fails this check.
    const httpMatched = JSON.stringify(httpAct.json?.matched_policies || []);
    const httpWarnings = Array.isArray(httpAct.json?.warnings) ? httpAct.json.warnings : [];
    const httpDecision = httpAct.json?.decision;
    const explainedDowngrade = httpDecision === 'allow'
      && httpWarnings.some((w) => typeof w === 'string' && /downgraded|grant/i.test(w));
    check('AH4', 'http act in band → never eligible for containment, and any final decision is require_approval or an explained grant downgrade (never a silent allow)',
      httpDecision !== 'allow_contained' && httpAct.json?.containment === undefined
        && httpMatched.includes(pid)
        && (httpDecision === 'require_approval' || explainedDowngrade),
      `decision=${httpDecision} containment=${JSON.stringify(httpAct.json?.containment)} matched=${httpMatched} warnings=${JSON.stringify(httpWarnings)}`);

    // AH5: drive the lifecycle for real — record the contained action
    // (?record=true), flip it to awaiting_promotion with a containment_ref,
    // then the operator's promote verdict. Three checks under one claim id,
    // same idiom as RS1's held→approved→resumed proof above.
    const recorded = await api('POST', '/api/guard?record=true', {
      agent_id: agent, action_type: 'smoke.write', declared_goal: `containment lifecycle write ${RUN}`,
      risk_score: 60, act: fileAct, client_capabilities: ['allow_contained'],
      harness_session_id: `smoke-${RUN}`,
    });
    const containedActionId = recorded.json?.action_id;
    // v5.6.1: the merge target is stamped server-side at record time (derived
    // from harness_session_id) and returned in the guard response — the flip
    // below must ADOPT it, exactly as the real hook does. A made-up client
    // ref now fails the flip's WHERE gate with a 409 by design.
    const containmentRef = recorded.json?.containment?.ref;
    check('AH5', 'guard record=true creates the contained action row with a server-stamped containment ref',
      recorded.json?.recorded === true && recorded.json?.decision === 'allow_contained'
        && Boolean(containedActionId)
        && typeof containmentRef === 'string' && /^dashclaw\/contained-[A-Za-z0-9-]{1,64}$/.test(containmentRef),
      `recorded=${recorded.json?.recorded} decision=${recorded.json?.decision} action_id=${containedActionId} ref=${containmentRef}`);

    // The flip requires an attributable agent identity (v5.6.0, IMPORTANT 5)
    // and the server-stamped ref (v5.6.1) — both part of the claim.
    const patched = containedActionId && containmentRef
      ? await api('PATCH', `/api/actions/${containedActionId}`, {
          agent_id: agent,
          containment_status: 'awaiting_promotion', containment_ref: containmentRef,
        })
      : { status: 0, json: null };
    check('AH5', 'agent-bound PATCH flips the action to awaiting_promotion, keeping the stamped containment_ref',
      patched.status === 200 && patched.json?.action?.containment_status === 'awaiting_promotion'
        && patched.json?.action?.containment_ref === containmentRef,
      `status=${patched.status} containment_status=${patched.json?.action?.containment_status} ref=${patched.json?.action?.containment_ref}`);

    // Evidence binding (v5.6.0 final fix wave): promotion requires a reviewed
    // patch artifact whose content.ref matches the stamped merge target —
    // no artifact → 409 CONTAINMENT_NO_EVIDENCE, mismatched ref → 409
    // CONTAINMENT_REF_MISMATCH. Capture the diff the way the PostToolUse hook
    // does, so the promote below proves the evidence-bound path end to end.
    const evidence = containedActionId && containmentRef
      ? await api('POST', '/api/artifacts', {
          artifact_type: 'patch',
          name: `containment diff ${RUN}`,
          source_action_id: containedActionId,
          source_agent_id: agent,
          content_json: {
            ref: containmentRef,
            stat: ' src/containment-smoke.ts | 1 +',
            diff: '--- a/src/containment-smoke.ts\n+++ b/src/containment-smoke.ts\n@@ -0,0 +1 @@\n+x',
          },
        })
      : { status: 0, json: null };
    check('AH5', 'captured diff artifact binds the reviewed evidence to the stamped ref',
      evidence.status === 201 && Boolean(evidence.json?.artifact?.artifact_id),
      `status=${evidence.status} artifact_id=${evidence.json?.artifact?.artifact_id}`);

    const promoted = containedActionId
      ? await api('POST', `/api/actions/${containedActionId}/containment`, { verdict: 'promote' })
      : { status: 0, json: null };
    const promotionActionId = promoted.json?.promotion_action_id;
    check('AH5', 'operator promote verdict succeeds and mints a promotion_action_id',
      promoted.status === 200 && Boolean(promotionActionId),
      `status=${promoted.status} promotion_action_id=${promotionActionId}`);

    // AH6-AH8: the canonical merge retry the promote verdict expects —
    // same agent_id as the contained action, declared_goal built by
    // buildPromotionGoal(containedActionId), act built by
    // buildPromotionAct(containmentRef). Evaluation selects the grant without
    // consuming it; only the recorded retry's protocol-1 execution claim
    // consumes it, same shape as AF6-AF8's plan-grant proof above.
    const mergeGoal = `containment promote ${containedActionId}`;
    const mergeAct = { kind: 'shell', command: `git merge --no-ff ${containmentRef}` };

    // Exercise the mutated act before consumption, so the check proves the
    // content-hash binding itself.
    const mergeMutated = await api('POST', '/api/guard', {
      agent_id: agent, action_type: 'containment_promote', declared_goal: mergeGoal,
      act: { kind: 'shell', command: 'git merge --no-ff other-branch' },
      client_capabilities: ['execution_claims'],
    });
    const mergeExecution = await exerciseExecutionClaim({
      agent_id: agent, action_type: 'containment_promote', declared_goal: mergeGoal, act: mergeAct,
    });
    const mergeSelected = JSON.stringify(mergeExecution.selected.json?.matched_policies || []);
    const mergeRecorded = JSON.stringify(mergeExecution.recorded.json?.matched_policies || []);
    check('AH6', 'canonical merge authority is selected twice without consumption before claim',
      mergeExecution.selected.json?.decision === 'allow'
        && mergeSelected.includes('builtin:containment_promote')
        && mergeSelected.includes('builtin:operator_approval')
        && mergeExecution.recorded.json?.decision === 'allow'
        && mergeRecorded.includes('builtin:containment_promote')
        && mergeRecorded.includes('builtin:operator_approval')
        && mergeExecution.recorded.json?.recorded === true
        && mergeExecution.recorded.json?.claim_protocol === 1,
      `selected=${mergeExecution.selected.json?.decision}/${mergeSelected} recorded=${mergeExecution.recorded.json?.decision}/${mergeRecorded} action_id=${mergeExecution.actionId}`);
    check('AH6', 'canonical merge attempt claims execution with exact act and nonce',
      mergeExecution.claimed.status === 200 && mergeExecution.claimed.json?.claimed === true
        && mergeExecution.claimed.json?.attempt_id === mergeExecution.attemptId,
      `status=${mergeExecution.claimed.status} body=${JSON.stringify(mergeExecution.claimed.json)?.slice(0, 180)}`);
    check('AH7', 'second canonical merge claim conflicts and the grant stays consumed',
      mergeExecution.duplicate.status === 409
        && mergeExecution.duplicate.json?.code === 'EXECUTION_CLAIM_CONFLICT'
        && mergeExecution.afterClaim.json?.decision === 'require_approval',
      `claim_status=${mergeExecution.duplicate.status} decision=${mergeExecution.afterClaim.json?.decision}`);
    check('AH8', 'mutated merge act is never covered by the grant (act-content-hash bind)',
      mergeMutated.json?.decision === 'require_approval',
      `decision=${mergeMutated.json?.decision}`);
    await retirePolicy(pid);
  }

  // DV: plan deviation events (RFC 2026-08-11-plan-deviation-events).
  // Live loop: submit plan → approve → execute a SUBSTITUTED act (same type +
  // goal, different payload) → deviation recorded and the deviation_response
  // policy raises require_approval → off-plan type warns → operator resolves.
  {
    const agent = agentFor('dv');
    await createPolicy('deviation-response', 'deviation_response',
      { on_kind: { act_substitution: 'require_approval', unplanned_action: 'warn' }, short_list: true }, [agent]);

    const declaredAct = { kind: 'shell', command: `echo deploy-staging-${RUN}` };
    const submitted = await api('POST', '/api/plans', {
      agent_id: agent,
      declared_goal: `dv smoke plan ${RUN}`,
      steps: [{ action_type: 'smoke.dv_deploy', step_goal: `dv deploy step ${RUN}`, act: declaredAct }],
      ttl_minutes: 30,
    });
    const planId = submitted.json?.plan?.plan_id;
    check('DV1', 'plan submits and previews', submitted.status === 201 && Boolean(planId),
      `status=${submitted.status} plan=${planId}`);

    const approved = planId
      ? await api('POST', `/api/plans/${planId}`, { verdict: 'approve' })
      : { status: 0, json: null };
    check('DV1', 'operator approves the plan', approved.status === 200,
      `status=${approved.status}`);

    // Substituted act: same declared intent, different actual payload — the
    // kind a path-based gate cannot express (RFC §5).
    const substituted = await api('POST', '/api/guard', {
      agent_id: agent, action_type: 'smoke.dv_deploy', declared_goal: `dv deploy step ${RUN}`,
      act: { kind: 'shell', command: `echo deploy-production-${RUN}` },
    });
    const subSignals = JSON.stringify(substituted.json?.signals || substituted.json?.warnings || []);
    check('DV2', 'substituted act → act_substitution deviation raised to require_approval',
      substituted.json?.decision === 'require_approval' && subSignals.includes('act_substitution'),
      `decision=${substituted.json?.decision} signals=${subSignals}`);

    const offPlan = await api('POST', '/api/guard', {
      agent_id: agent, action_type: 'smoke.dv_unplanned', declared_goal: `dv off-plan action ${RUN}`,
    });
    const offSignals = JSON.stringify(offPlan.json?.signals || offPlan.json?.warnings || []);
    check('DV3', 'off-plan action → unplanned_action deviation warns (never blocks)',
      offPlan.json?.decision === 'warn' && offSignals.includes('unplanned_action'),
      `decision=${offPlan.json?.decision} signals=${offSignals}`);

    const detail = planId ? await api('GET', `/api/plans/${planId}`) : { status: 0, json: null };
    const deviations = detail.json?.deviations || [];
    check('DV4', 'GET /api/plans/:id carries the recorded deviations',
      deviations.length >= 2 && deviations.every((d) => d.status === 'open'),
      `count=${deviations.length}`);

    const target = deviations.find((d) => d.kind === 'act_substitution');
    const resolvedRes = target && planId
      ? await api('POST', `/api/plans/${planId}`, {
          verdict: 'resolve_deviation', deviation_id: target.deviation_id, resolution: 'acknowledged',
        })
      : { status: 0, json: null };
    check('DV4', 'operator resolve flips the deviation to acknowledged',
      resolvedRes.status === 200 && resolvedRes.json?.deviation?.status === 'acknowledged',
      `status=${resolvedRes.status} deviation_status=${resolvedRes.json?.deviation?.status}`);

    if (planId) await api('POST', `/api/plans/${planId}`, { verdict: 'revoke' });
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
