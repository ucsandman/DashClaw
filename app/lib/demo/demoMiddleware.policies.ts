import { reliefReady } from '../guard/calibration';
import {
  SHORT_LIST_CAP,
  isShortListLine,
  shortListTier,
  parseRules as parseShortListRules,
} from '../guardrails/short-list';
import { describePolicyScope } from '../policy-modes/contract';
import type { DemoFixtures, AnyRecord } from './demoMiddleware.actions';
import { demoTestEval, demoAgents } from './demoMiddleware.actions';
import { demoAgentIdList } from './demoMiddleware.sessions';

// The guard fixtures keep policies in their seed shape (`type`, `config`,
// boolean `active`); the live API answers in guard_policies column shape
// (`policy_type`, `rules` JSON text, integer `active`). Map here so the
// /policies ledger classifies demo rows exactly like real ones.
function toApiPolicyShape(p: AnyRecord): AnyRecord {
  const { type, config, active, ...rest } = p;
  return {
    ...rest,
    policy_type: p.policy_type ?? type,
    rules: p.rules ?? config ?? '{}',
    active: active === true || active === 1 ? 1 : 0,
    agent_ids: p.agent_ids ?? null,
  };
}

export function demoPolicies(fixtures: DemoFixtures) {
  return { policies: fixtures.policies.map(toApiPolicyShape), lastUpdated: new Date().toISOString() };
}

/** GET /api/approvals/floods — the interruption-budget banner on /approvals.
 *  Without an entry this 403'd through the demo write-block's sibling path and
 *  `ApprovalFloodBanner` swallowed it (`if (!res.ok) return`), so the whole
 *  capability was invisible on the demo deployment — no error, just no banner.
 *
 *  The flood is pinned to the real `require_approval` fixture rather than an
 *  invented id: the banner names the rule and its Pause button targets that id,
 *  so a visitor who clicks through to /policies finds the rule actually there.
 *  Count sits above the per-policy budget because a flood is only a flood when
 *  it exceeds it. The three actions stay honest 403s via the write block —
 *  stateless fixtures can't clear a flood. */
export function demoApprovalFloods(fixtures: DemoFixtures) {
  const budget = { perPolicy: 10, windowMin: 15, fleetWide: 30 };
  const gate = fixtures.policies.find(
    (p: AnyRecord) => (p.policy_type ?? p.type) === 'require_approval' && (p.active === true || p.active === 1)
  );
  if (!gate) return { floods: [], fleet: null, budget };
  return {
    floods: [
      {
        policy_id: gate.id,
        name: gate.name,
        count: budget.perPolicy + 4,
        tripped_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      },
    ],
    // Fleet-wide stays clear: one tripped rule is the honest, legible story,
    // and a second simultaneous alarm would read as noise on a demo surface.
    fleet: null,
    budget,
  };
}

/** GET /api/policies/summary — the posture-hero fixture for the /policies
 *  workbench. Hand-crafted (buildPolicySummary pulls the server-only compiler,
 *  which can't ship in the edge middleware bundle) but derived from the same
 *  guard fixtures as /api/policies, so counts and rule names agree with the
 *  ledger below it and with demoContract's claude-code story. */
export function demoPolicySummary(fixtures: DemoFixtures) {
  const active = fixtures.policies
    .map(toApiPolicyShape)
    .filter((p) => p.active === 1);

  // Nominal decision per fixture policy_type — mirrors what the compiler's
  // nominalDecision would answer for these rules.
  const bucketByType: Record<string, 'warn' | 'require_approval' | 'block'> = {
    risk_threshold: 'block',
    require_approval: 'require_approval',
    rate_limit: 'warn',
    block_action_type: 'block',
    non_fabrication: 'require_approval',
    protected_path: 'require_approval',
  };

  // 30d fire counts from the guard-decision fixtures, keyed by policy id.
  const counts = new Map<string, { fired: number; lastFiredAt: string | null }>();
  for (const gd of fixtures.guardDecisions || []) {
    if (!gd.policy_id) continue;
    const c = counts.get(gd.policy_id) || { fired: 0, lastFiredAt: null };
    c.fired += 1;
    if (!c.lastFiredAt || String(gd.created_at) > c.lastFiredAt) c.lastFiredAt = String(gd.created_at);
    counts.set(gd.policy_id, c);
  }

  const enforcement = { total: active.length, warn: 0, require_approval: 0, block: 0 };
  const rules = active.map((p) => {
    const bucket = bucketByType[p.policy_type] || 'warn';
    enforcement[bucket] += 1;
    const c = counts.get(p.id);
    return { id: p.id, name: p.name, bucket, fired30d: c?.fired ?? 0, lastFiredAt: c?.lastFiredAt ?? null };
  });
  const order = { block: 0, require_approval: 1, warn: 2 } as const;
  rules.sort((a, b) => order[a.bucket] - order[b.bucket]);

  // Decision outcomes over the window, straight from the fixtures.
  const decisions30d = { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 };
  for (const gd of fixtures.guardDecisions || []) {
    decisions30d.total += 1;
    const d = gd.decision as keyof typeof decisions30d;
    if (d in decisions30d) decisions30d[d] += 1;
  }

  // Shield states consistent with demoContract: deploys and destructive ops
  // interrupt, high-risk blocks, bursts warn — the rest are available but off.
  const on: Record<string, { fired30d: number; lastFiredAt: string | null }> = {
    deploy_gate: { fired30d: 7, lastFiredAt: new Date(Date.now() - 3_600_000).toISOString() },
    risk_critical: { fired30d: 2, lastFiredAt: new Date(Date.now() - 26_000_000).toISOString() },
    rate_limiter: { fired30d: 0, lastFiredAt: null },
  };
  const shieldCatalog: Array<{ id: string; name: string; description: string }> = [
    { id: 'deploy_gate', name: 'Deploy Gate', description: 'Require approval before any deploy or migration' },
    { id: 'risk_high', name: 'High Risk Review', description: 'Require approval for actions with risk score 70+' },
    { id: 'risk_critical', name: 'Critical Risk Block', description: 'Block actions with risk score 90 or above' },
    { id: 'destructive_block', name: 'Destructive Ops Block', description: 'Block apply, migrate, and sync operations' },
    { id: 'rate_limiter', name: 'Rate Limiter', description: 'Warn when an agent exceeds 30 actions per hour' },
    { id: 'api_review', name: 'API Call Review', description: 'Require approval for all API actions' },
    { id: 'outbound_gate', name: 'Outbound Message Gate', description: 'Require approval before sending messages or posts' },
    { id: 'non_fabrication_guard', name: 'No Fabricated Facts', description: 'Require approval for outbound content that states a fact not traceable to its source-of-truth' },
    { id: 'evidence_required', name: 'Evidence Required', description: 'Require approval when a call is graded from a self-declared intent instead of server-classified evidence' },
  ];
  const shields = shieldCatalog.map((s) => ({
    ...s,
    on: s.id in on,
    fired30d: on[s.id]?.fired30d ?? 0,
    lastFiredAt: on[s.id]?.lastFiredAt ?? null,
  }));

  const mode = { id: 'claude-code', name: 'Claude Code Mode', interruptionLevel: 'low' };
  const pendingApprovals = (fixtures.actions || []).filter((a) => a.status === 'pending_approval').length;

  return {
    governed: true,
    modes: [mode],
    primaryMode: mode,
    enforcement,
    rules,
    shields,
    decisions30d,
    scope: { allAgents: true },
    agents: { total: demoAgents(fixtures).agents.length },
    pendingApprovals,
    // Short List: derived from the SAME predicate the real summary uses, so the
    // demo /policies page cannot show a list the product would not.
    // ALL fixture policies, dormant included — the demo must show an Off line
    // the way the product does (fixtures carry one inactive protected_path).
    shortList: fixtures.policies
      .map(toApiPolicyShape)
      .filter((p) => isShortListLine(p.policy_type, parseShortListRules(p.rules)))
      .map((p) => {
        const r = parseShortListRules(p.rules);
        const c = counts.get(p.id);
        return {
          id: p.id,
          name: p.name,
          tier: shortListTier(p.policy_type, r),
          policy_type: p.policy_type,
          scope: describePolicyScope(p as { id: string; name: string; policy_type: string; rules: string }),
          fired30d: c?.fired ?? 0,
          ungrantable: r.ungrantable === true,
          shape_exceptions: Array.isArray(r.shape_exceptions) ? (r.shape_exceptions as string[]) : [],
          active: p.active === 1,
          seeded: String(p.name).startsWith('Catastrophe Pack — '),
        };
      }),
    // No slice: a legacy org over the cap must look over the cap here too.
    shortListCap: SHORT_LIST_CAP,
    // Empty on purpose: this file compiles into the EDGE middleware, which
    // cannot read the spend-lockdown pack, and re-typing its 11 action types
    // here would be the second hardcoded copy the real route exists to avoid.
    suggestions: [] as Array<never>,
    budgetReport: {
      policiesOverBudget: 0,
      shapesOverBudget: 0,
      window_hours: 24,
      budget: 50,
      shape_budget: 10,
    },
  };
}

/** GET /api/policies/contract — governed claude-code contract fixture.
 *  Sentences are exactly what buildContract() emits for the compiled claude-code pack,
 *  iterating policies in compile.ts order:
 *  policy 1: risk_threshold/block  → block "risk score reaches 100"
 *  policy 2: risk_threshold/warn   → silent "risk score reaches 85"
 *  policy 3: warn_action_type      → silent "message, post, email, calendar, sync, api calls (recorded for review)"
 *  policy 5: require_approval      → interrupt "action is one of: deploy, migrate, workflow_execute"
 *  policy 6: require_approval      → interrupt "action is one of: delete, reset, destroy, drop"
 *  policy 7: protected_path        → interrupt "protected paths change (governance, auth, secrets)"
 *  policy 8: rate_limit/warn       → silent "burst: more than 250 actions in 30 minutes"
 *  policy 9: rate_limit/require_approval → interrupt "runaway loop: more than 650 actions in 60 minutes"
 */
export function demoContract(): import('../policy-modes/contract').ContractView {
  return {
    governed: true,
    mode_id: 'claude-code',
    interrupts: [
      { policy_id: 'gp_demo_interrupt_2', text: 'action is one of: deploy, migrate, workflow_execute', fired_7d: 7 },
      { policy_id: 'gp_demo_interrupt_3', text: 'action is one of: delete, reset, destroy, drop', fired_7d: 3 },
      { policy_id: 'gp_demo_interrupt_4', text: 'protected paths change (governance, auth, secrets)', fired_7d: 1 },
      { policy_id: 'gp_demo_interrupt_5', text: 'runaway loop: more than 650 actions in 60 minutes', fired_7d: 0 },
    ],
    silent: [
      { policy_id: 'gp_demo_silent_1', text: 'risk score reaches 85', fired_7d: 0 },
      { policy_id: 'gp_demo_silent_2', text: 'message, post, email, calendar, sync, api calls (recorded for review)', fired_7d: 18 },
      { policy_id: 'gp_demo_silent_3', text: 'burst: more than 250 actions in 30 minutes', fired_7d: 0 },
    ],
    blocks: [
      { policy_id: 'gp_demo_block_1', text: 'risk score reaches 100', fired_7d: 0 },
    ],
    grants: [
      { policy_id: 'gp_demo_grant_1', label: 'read_file → /workspace/', shape_key: 'read_file::/workspace/', created_at: null },
    ],
    custom: [],
    friction: { interrupts_7d: 11, est_seconds: 220 },
  };
}

/** GET /api/policies/review — warn groups + recent interrupts fixture. */
export function demoReview() {
  const now = new Date();
  const iso = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();
  return {
    groups: [
      {
        shape: { action_type: 'bash', target_prefix: null, key: 'bash::', label: 'bash' },
        count: 18,
        latest_at: iso(3_600_000),
        sample_id: 'gd_demo_warn_1',
        sample_goal: 'Run unit test suite',
        max_risk: 28,
      },
      {
        shape: { action_type: 'write_file', target_prefix: 'src/', key: 'write_file::src/', label: 'write_file → src/' },
        count: 7,
        latest_at: iso(7_200_000),
        sample_id: 'gd_demo_warn_2',
        sample_goal: 'Refactor authentication module',
        max_risk: 44,
      },
    ],
    interrupts: [
      {
        id: 'gd_demo_int_1', agent_id: 'clawdbot', agent_name: 'ClawdBot',
        action_type: 'bash', decision: 'require_approval', reason: 'Matched require_approval policy',
        risk_score: 72, created_at: iso(1_800_000),
      },
    ],
    cursor: iso(7 * 86_400_000),
  };
}

export function demoPolicySimulate(fixtures: DemoFixtures, body: AnyRecord) {
  // Pack-mode dry run (Pack Gallery): mirror the pack-shaped payload of
  // POST /api/policies/simulate { pack } so the gallery drawer renders fully.
  if (typeof body.pack === 'string' && body.pack) {
    return {
      pack: body.pack,
      summary: { total: 124, matches: 15, block: 2, warn: 5, require_approval: 8, allow: 109 },
      per_policy: [
        { name: 'Hold external actions', policy_type: 'require_approval', matches: 8, block: 0, warn: 0, require_approval: 8 },
        { name: 'Block mass-destructive operations', policy_type: 'risk_threshold', matches: 2, block: 2, warn: 0, require_approval: 0 },
        { name: 'Rate-warn runaway agents', policy_type: 'rate_limit', matches: 5, block: 0, warn: 5, require_approval: 0 },
      ],
      matches: [
        { action_id: 'ar_demo_sim_1', goal: 'deploy production hotfix', agent_name: 'deploy-bot', timestamp: new Date().toISOString(), original_status: 'completed', simulated_action: 'require_approval', simulated_reason: 'Action type "deploy" requires approval', matched_policy: 'Hold external actions' },
        { action_id: 'ar_demo_sim_2', goal: 'delete cloud formation stack', agent_name: 'infra-bot', timestamp: new Date().toISOString(), original_status: 'completed', simulated_action: 'block', simulated_reason: 'Risk score 100 >= threshold 100', matched_policy: 'Block mass-destructive operations' },
        { action_id: 'ar_demo_sim_3', goal: 'email vendor about invoice', agent_name: 'ops-bot', timestamp: new Date().toISOString(), original_status: 'completed', simulated_action: 'require_approval', simulated_reason: 'Action type "email" requires approval', matched_policy: 'Hold external actions' },
      ],
      matches_truncated: false,
      sample_size: 124,
      window_days: typeof body.days === 'number' ? body.days : 30,
    };
  }
  return {
    summary: { total: 124, block: 2, warn: 5, require_approval: 8 },
    matches: [
      { goal: 'deploy production hotfix', agent_name: 'deploy-bot', timestamp: new Date().toISOString(), simulated_action: 'require_approval' },
      { goal: 'delete cloud formation stack', agent_name: 'infra-bot', timestamp: new Date().toISOString(), simulated_action: 'block' }
    ]
  };
}

export function demoPolicyProof(fixtures: DemoFixtures, format: string) {
  const reportText = fixtures.policyProofReport || `# Compliance Proof Report

**Organization:** org_demo
**Generated:** ${new Date().toISOString()}
**Report Type:** Policy Enforcement Proof

---

## Frameworks Assessed

| Framework | Coverage | Controls | Covered | Partial | Gap |
|-----------|----------|----------|---------|---------|-----|
| SOC 2 Type II | 79% | 12 | 8 | 3 | 1 |
| ISO 27001 | 73% | 15 | 9 | 4 | 2 |
| NIST AI RMF | 60% | 10 | 4 | 4 | 2 |
| EU AI Act | 50% | 8 | 3 | 2 | 3 |
| GDPR | 70% | 10 | 5 | 3 | 2 |

## Enforcement Evidence

- **Guard Decisions Recorded:** 847
- **Actions Blocked:** 23
- **Approval Requests Generated:** 56
- **Total Actions Observed:** 12,340

## Policy Test Summary

- **Total Policies Tested:** 6
- **Total Test Cases:** 15
- **Passed:** 14
- **Failed:** 1

The failing test (pt_15) involves the After-Hours Escalation policy: high-risk deploys during off-hours should block but currently route to approval. Remediation is recommended.

## Recommendations

1. Investigate After-Hours Escalation policy threshold logic (test pt_15)
2. Add data classification policy to close ISO 27001 A.8.2 gap
3. Implement breach notification workflow for GDPR ART-33 compliance
4. Define SLA thresholds to address SOC 2 A1.1 availability gap
5. Integrate bias detection tooling for NIST AI RMF MEASURE-2

---
*Generated by DashClaw Policy Engine*`;

  if (format === 'json') {
    return { report: JSON.stringify({ status: 'compliant', policies: (fixtures.policies || []).length, generated_at: new Date().toISOString() }) };
  }
  return { report: reportText };
}

export function demoPolicyTest(fixtures: DemoFixtures) {
  if (fixtures.policyTestResults) return fixtures.policyTestResults;

  const policies = fixtures.policies || [];
  const results = policies.map((p, i) => ({
    policyId: p.id,
    policyName: p.name,
    failCount: i === 0 ? 1 : 0, // Simulate one failure for the first policy
    tests: [
      { name: 'Allow normal operation', passed: true },
      { name: i === 0 ? 'Enforce after-hours block' : 'Block prohibited pattern', passed: i !== 0, message: i === 0 ? 'Expected block but got require_approval' : undefined }
    ]
  }));

  const totalTests = results.reduce((sum, r) => sum + r.tests.length, 0);
  const failed = results.reduce((sum, r) => sum + r.failCount, 0);

  return {
    totalPolicies: policies.length,
    totalTests,
    passed: totalTests - failed,
    failed,
    results
  };
}

export function demoGuard(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const policyId = sp.get('policy_id') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  if (agentId === 'simulator-bot') {
    return {
      evaluations: [
        {
          id: 'gd_sim_1',
          agent_id: 'simulator-bot',
          action_type: 'deploy',
          decision: 'allow',
          reason: 'Simulation allowed: deployment policies satisfied.',
          matched_policies: '["Production Deployment Guard", "System Posture Check"]',
          created_at: new Date().toISOString()
        }
      ],
      total: 1,
      stats: { total: 1, blocks: 0, permits: 1 },
      lastUpdated: new Date().toISOString()
    };
  }

  if (agentId === 'pipeline-agent') {
    const now = new Date().toISOString();
    const decision = {
      id: 'gd_pipe_1',
      agent_id: 'pipeline-agent',
      agent_name: 'Pipeline Agent',
      action_type: 'cleanup',
      decision: 'block',
      risk_score: 94,
      reason: 'Risk score 94 exceeds org threshold of 75. Irreversible operations on customer data require explicit approval.',
      matched_policies: '["PRODUCTION_DATA_PROTECTION"]',
      created_at: now,
      signals: [],
    };
    return {
      decisions: [decision],
      evaluations: [decision],
      total: 1,
      stats: { total: 1, blocks: 1, permits: 0 },
      lastUpdated: now,
    };
  }

  // Combine static fixtures with the deterministic demo evaluation
  let reads = [demoTestEval, ...(fixtures.guardReads || fixtures.guardDecisions || [])];

  if (agentId) reads = reads.filter(r => r.agent_id === agentId);
  if (policyId) reads = reads.filter(r => r.policy_id === policyId);

  const total = reads.length;
  const paged = reads.slice(offset, offset + limit);
  const blocks = reads.filter(r => r.decision === 'block').length;
  const stats = { total, blocks, permits: total - blocks };

  return { decisions: paged, evaluations: paged, total, stats, lastUpdated: new Date().toISOString() };
}

export function demoGuardPost(fixtures: DemoFixtures, body: AnyRecord) {
  const agentId = body.agent_id;
  const riskScore = body.risk_score || 0;

  // Deterministic block for the 1-Minute Governance Test
  const isDemoAgent = agentId === 'openai-deployer-1';
  const isPipelineAgent = agentId === 'pipeline-agent';

  if (isDemoAgent) {
    return demoTestEval;
  }

  if (isPipelineAgent) {
    return {
      id: `gd_demo_${Math.random().toString(36).slice(2, 10)}`,
      agent_id: agentId,
      agent_name: 'Pipeline Agent',
      action_type: body.action_type || 'cleanup',
      decision: 'block',
      reason: `Risk score ${riskScore} exceeds org threshold of 75. Irreversible operations on customer data require explicit approval.`,
      matched_policies: JSON.stringify(['PRODUCTION_DATA_PROTECTION']),
      risk_score: riskScore,
      created_at: new Date().toISOString(),
      signals: [],
    };
  }

  // Mirror the pipeline-agent threshold so unknown demo agents hitting a
  // high-risk action get a consistent "block at 75" experience. Previously
  // this reference `shouldBlock` was undeclared, throwing ReferenceError
  // on every demo call from unrecognised agents.
  const shouldBlock = riskScore >= 75;
  const evaluation = {
    id: `gd_demo_${Math.random().toString(36).slice(2, 10)}`,
    agent_id: agentId,
    agent_name: 'Unknown Agent',
    action_type: body.action_type || 'unknown',
    decision: shouldBlock ? 'block' : 'allow',
    action_id: `ar_demo_${Math.random().toString(36).slice(2, 10)}`,
    reason: shouldBlock
      ? '[Demo mode] Sandbox fixture matched this action — this is not a real policy decision. If you see this from a real agent, your DASHCLAW_BASE_URL is pointed at a demo instance.'
      : 'Action permitted under default demo policy.',
    matched_policies: shouldBlock ? ['[Demo fixture] Production Guard'] : [],
    risk_score: riskScore,
    created_at: new Date().toISOString(),
    signals: []
  };

  return evaluation;
}

// Triage-inbox proposal queues (/policies "Needs your call"). Empty-but-
// COMPLETE payloads: every field the typed clients declare must be present —
// TriageInbox dereferences e.g. `payload.policies.length` synchronously after
// Promise.allSettled, so a missing field throws mid-load and leaves the
// section on skeletons forever (2026-07-08 live bug).
export function demoTuningProposals() {
  return { window_days: 14, policies: [], proposals: [], dismissed_count: 0 };
}
export function demoTighteningProposals() {
  return {
    window_days: 14, min_observed: 12, synthetic_included: false,
    inputs: { decisions: 35 }, proposals: [], counts: { pending: 0, ratified: 0, dismissed: 0 },
  };
}
export function demoLooseningProposals() {
  return {
    window_days: 14, min_fired: 3, min_resolved: 3, synthetic_included: false,
    inputs: { outcome_rows: 35 }, proposals: [], counts: { pending: 0, ratified: 0, dismissed: 0 },
  };
}
export function demoCalibrationProposals() {
  return {
    window_days: 14,
    inputs: { decisions: 35, decisions_truncated_at_limit: false, uploaded_samples: 0, synthetic_excluded: 0 },
    proposals: [],
  };
}

/** GET /api/calibration/controller — a shadow-mode controller snapshot with a
 *  believable adjudication history: θ easing down from its 80 start as
 *  approvals accumulate, a handful of denials, one standing agent alarm.
 *  Numbers mirror CALIBRATION_DEFAULTS (gamma 2, p0 0.25, alarm at e ≥ 20,
 *  θ floor 20) without importing the server-side calibration module. */
export function demoCalibrationController(fixtures: DemoFixtures) {
  const agentIds = demoAgentIdList(fixtures);
  const now = Date.now();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();

  // 40 deterministic adjudications, oldest last (route returns newest-first).
  // Pattern: mostly approved (benign), every 9th denied, two false
  // interruptions (approved actions the guard had interrupted → loss).
  const events: AnyRecord[] = [];
  let theta = 80;
  for (let i = 39; i >= 0; i--) {
    const denied = i % 9 === 4;
    const loss = !denied && (i === 31 || i === 12);
    const thetaBefore = theta;
    theta = Math.max(20, Math.min(102, theta + (loss ? 2 : denied ? 0 : -0.4)));
    events.unshift({
      action_id: `act_cal_demo_${i + 1}`,
      agent_id: agentIds[i % agentIds.length],
      risk_score: 45 + ((i * 13) % 50),
      label: denied ? 'denied' : 'benign',
      loss: loss ? 1 : 0,
      theta_before: thetaBefore,
      theta_after: theta,
      created_at: iso(i * 5 + 2),
    });
  }

  const denied = events.filter((e) => e.label === 'denied').length;
  const lossSum = events.reduce((s, e) => s + e.loss, 0);

  // Demote-arm bound, folded oldest → newest with applyAdjudication's exact
  // rule: a benign verdict extends relief to that score, a denial pulls it
  // below. Derived rather than hardcoded so the fixture cannot claim a bound
  // its own adjudication history does not support.
  let reliefCeiling = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const score = Number(events[i]!.risk_score);
    reliefCeiling = events[i]!.label === 'benign'
      ? Math.max(reliefCeiling, score)
      : Math.min(reliefCeiling, score - 1);
  }

  return {
    settings: { mode: 'shadow', target_rate: 0.1 },
    state: {
      theta,
      labeled_total: events.length,
      labeled_live: events.length,
      labeled_benign: events.length - denied,
      labeled_denied: denied,
      loss_sum: lossSum,
      observed_rate: lossSum / events.length,
      observed_window_rate: lossSum / events.length,
      observed_window: events.length,
      relief_ceiling: reliefCeiling,
      // Same predicate the real route answers with — a fixture that promised
      // relief the engine would refuse is exactly the demo gap this guards.
      relief_ready: reliefReady({
        labeledTotal: events.length,
        labeledLive: events.length,
        reliefCeiling,
      }),
    },
    defaults: { gamma: 2, alarm_at: 20, p0: 0.25, theta_floor: 20, relief_min_labels: 10, relief_min_live_labels: 3 },
    alarms: [
      { agent_id: agentIds[0] ?? 'clawdbot', e: 24.6, n: 12, denied: 7, alarmed_at: iso(6) },
      { agent_id: agentIds[1 % agentIds.length] ?? 'deploy-runner', e: 3.4, n: 9, denied: 3, alarmed_at: null },
      { agent_id: agentIds[2 % agentIds.length] ?? 'data-pipeline', e: 1.1, n: 14, denied: 3, alarmed_at: null },
    ],
    events,
    risk_threshold_policies: fixtures.policies
      .filter((p) => (p.policy_type ?? p.type) === 'risk_threshold' && (p.active === true || p.active === 1))
      .map((p) => {
        let rules: AnyRecord = {};
        try { rules = JSON.parse(String(p.rules ?? p.config ?? '{}')); } catch { /* fixture always parses */ }
        return { id: p.id, name: p.name, threshold: Number(rules.threshold) || 80, action: typeof rules.action === 'string' ? rules.action : 'block' };
      })
      .sort((a, b) => a.threshold - b.threshold),
  };
}
