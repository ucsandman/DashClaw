import { getHomepageDemoActions } from '../homepageDemoActions';

// Demo fixtures are dynamically-shaped demo data assembled fresh per request.
// They are an external boundary to this module, so collections are typed loosely.
type AnyRecord = Record<string, any>;

export interface DemoFixtures {
  actions: AnyRecord[];
  assumptions: AnyRecord[];
  guardDecisions?: AnyRecord[];
  guardReads?: AnyRecord[];
  policies: AnyRecord[];
  decisions: AnyRecord[];
  lessons: AnyRecord[];
  recommendations: AnyRecord[];
  metrics: AnyRecord[];
  metricsSummary?: AnyRecord;
  tokensCurrent?: AnyRecord;
  tokensToday?: AnyRecord;
  tokenHistory: AnyRecord[];
  content?: AnyRecord[];
  teamMembers?: AnyRecord[];
  teamInvites?: AnyRecord[];
  activityLogs?: AnyRecord[];
  webhooks: AnyRecord[];
  webhookDeliveries?: Record<string, AnyRecord[]>;
  schedules: AnyRecord[];
  digest?: AnyRecord | null;
  contextPoints?: AnyRecord[];
  contextThreads?: AnyRecord[];
  preferences: Record<string, AnyRecord>;
  policyProofReport?: string;
  policyTestResults?: AnyRecord;
  decisionMetrics?: AnyRecord;
  [key: string]: any;
}

// Deterministic demo data for the 1-Minute Governance Test
const DEMO_TEST_ACTION_ID = 'ar_demo_deploy_block_001';
const demoTestAction: AnyRecord = {
  action_id: DEMO_TEST_ACTION_ID,
  org_id: 'org_demo',
  agent_id: 'openai-deployer-1',
  agent_name: 'OpenAI Deployer',
  action_type: 'deploy',
  declared_goal: 'Deploy latest build to production',
  status: 'failed',
  risk_score: 85,
  confidence: 100,
  timestamp_start: new Date().toISOString(),
  timestamp_end: new Date().toISOString(),
  verified: true,
};
const demoTestEval: AnyRecord = {
  id: `gd_demo_deploy_001`,
  agent_id: 'openai-deployer-1',
  agent_name: 'OpenAI Deployer',
  action_type: 'deploy',
  decision: 'require_approval',
  action_id: DEMO_TEST_ACTION_ID,
  reason: '[Demo mode] Sandbox fixture matched this action — this is not a real policy decision. If you see this from a real agent, your DASHCLAW_BASE_URL is pointed at a demo instance.',
  matched_policies: ['[Demo fixture] Production Guard'],
  risk_score: 85,
  created_at: new Date().toISOString(),
  signals: []
};

// Slim demo agent roster, derived from the demo action fixtures (mirrors the
// real GET /api/agents, which lists distinct agents from action_records). The
// shared agent-filter picker fetches this on every demo page; without it the
// demo dispatch 403s and every sandbox page logs a console error.
export function demoAgents(fixtures: DemoFixtures) {
  const map = new Map<string, AnyRecord>();
  const allActions = [demoTestAction, ...fixtures.actions];
  for (const a of allActions) {
    const prev = map.get(a.agent_id) || { agent_id: a.agent_id, agent_name: a.agent_name, action_count: 0, last_active: null };
    prev.action_count += 1;
    const ts = a.timestamp_start || null;
    if (ts && (!prev.last_active || ts > prev.last_active)) prev.last_active = ts;
    map.set(a.agent_id, prev);
  }
  const agents = Array.from(map.values()).sort((a, b) => (b.last_active || '').localeCompare(a.last_active || ''));
  return { agents, lastUpdated: new Date().toISOString() };
}

export function demoListActions(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const status = sp.get('status') || undefined;
  const actionType = sp.get('action_type') || undefined;
  const riskMinRaw = sp.get('risk_min');
  const riskMin = riskMinRaw ? parseInt(riskMinRaw, 10) : undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  // Combine deterministic demo test action with fixtures
  let items = [demoTestAction, ...fixtures.actions];

  if (agentId) items = items.filter(a => a.agent_id === agentId);
  if (status) items = items.filter(a => a.status === status);
  if (actionType) items = items.filter(a => a.action_type === actionType);
  if (Number.isFinite(riskMin)) items = items.filter(a => (parseInt(a.risk_score, 10) || 0) >= (riskMin as number));

  items.sort((a, b) => (b.timestamp_start || '').localeCompare(a.timestamp_start || ''));

  const total = items.length;
  const paged = items.slice(offset, offset + limit);

  const statsSource = items;
  const stats = {
    total: statsSource.length,
    completed: statsSource.filter(a => a.status === 'completed').length,
    failed: statsSource.filter(a => a.status === 'failed').length,
    running: statsSource.filter(a => a.status === 'running').length,
    high_risk: statsSource.filter(a => (parseInt(a.risk_score, 10) || 0) >= 70).length,
    avg_risk: statsSource.length ? (statsSource.reduce((s, a) => s + (parseInt(a.risk_score, 10) || 0), 0) / statsSource.length) : 0,
    total_cost: statsSource.reduce((s, a) => s + (parseFloat(a.cost_estimate) || 0), 0),
  };

  return { actions: paged, total, stats, lastUpdated: new Date().toISOString() };
}

export function demoCreateAction(fixtures: DemoFixtures, body: AnyRecord) {
  // Use a high-impact blocked story for simulator bot
  const isSimulator = body.agent_id === 'simulator-bot';
  const isDemoAgent = body.agent_id === 'openai-deployer-1';
  const isPipelineAgent = body.agent_id === 'pipeline-agent';

  // ID prefix encodes the demo story so demoActionDetail can reconstruct it
  // on replay without relying on fixture mutation (fixtures are rebuilt fresh
  // per-request, so fixtures.actions.unshift() from this call won't survive).
  const defaultPrefix = isPipelineAgent ? 'act_pipe_' : 'act_sim_';
  const action_id = body.action_id || `${defaultPrefix}${Math.random().toString(36).slice(2, 10)}`;

  const now = new Date().toISOString();
  const action = {
    ...body,
    action_id,
    org_id: 'org_demo',
    agent_name: body.agent_name || body.agent_id || 'refund-support-agent',
    timestamp_start: body.timestamp_start || now,
    status: (isSimulator || isDemoAgent) ? 'failed' : (body.status || 'completed'),
    risk_score: isSimulator ? 92 : (body.risk_score || 0),
    confidence: isSimulator ? 88 : (body.confidence || 100),
    declared_goal: isSimulator ? 'CHARGE: Stripe Customer sub_12345 -- $12,000.00' : (body.declared_goal || 'Send refund confirmation email'),
    verified: true,
  };

  // Persist it in the demo fixtures so the replay page can read it back
  if (fixtures.actions) {
    // Check if it already exists to avoid duplicates
    const exists = fixtures.actions.findIndex(a => a.action_id === action_id);
    if (exists !== -1) {
      fixtures.actions[exists] = { ...fixtures.actions[exists], ...action };
    } else {
      fixtures.actions.unshift(action);
    }
  }

  // Inject a real guard decision for pipeline-agent so replay shows correct policy data
  if (isPipelineAgent && fixtures.guardDecisions) {
    const riskScore = body.risk_score || 94;
    const guardDecision = {
      id: `gd_${action_id}`,
      org_id: 'org_demo',
      action_id,
      agent_id: 'pipeline-agent',
      agent_name: 'Pipeline Agent',
      action_type: body.action_type || 'cleanup',
      decision: 'block',
      risk_score: riskScore,
      reason: `Risk score ${riskScore} exceeds org threshold of 75. Irreversible operations on customer data require explicit approval.`,
      matched_policies: JSON.stringify(['PRODUCTION_DATA_PROTECTION']),
      created_at: now,
      signals: [],
    };
    fixtures.guardDecisions.unshift(guardDecision);
  }

  const isPipelineBlock = isPipelineAgent;
  return {
    action,
    action_id,
    decision: {
      decision: (isSimulator || isDemoAgent || isPipelineBlock) ? 'block' : 'allow',
      reason: isSimulator
        ? 'Risk score 92 exceeds automation threshold for financial operations.'
        : isDemoAgent ? '[Demo mode] Sandbox fixture matched this action — this is not a real policy decision. If you see this from a real agent, your DASHCLAW_BASE_URL is pointed at a demo instance.'
        : isPipelineBlock ? `Risk score ${body.risk_score || 94} exceeds org threshold of 75. Policy PRODUCTION_DATA_PROTECTION enforced.`
        : 'Demo mode simulation auto-permitted.',
      matched_policies: (isSimulator || isDemoAgent) ? ['[Demo fixture] Production Guard'] : isPipelineBlock ? ['PRODUCTION_DATA_PROTECTION'] : []
    },
    security: { clean: true, findings_count: 0 }
  };
}

export function demoActionDetail(fixtures: DemoFixtures, actionId: string): AnyRecord | null {
  // Always return the deterministic demo test action so the replay works flawlessly
  if (actionId === DEMO_TEST_ACTION_ID) {
    return {
      action: demoTestAction,
      open_loops: [],
      assumptions: [
        { assumption_id: `asm_demo_1`, action_id: actionId, assumption: 'Demo environment is active', basis: 'Local run', validated: 1 }
      ],
      decision: demoTestEval.decision,
      decision_reason: demoTestEval.reason
    };
  }

  // Check if we dynamically created this action in the current demo session
  const dynamicAction = fixtures.actions.find(a => a.action_id === actionId);
  if (dynamicAction) {
    const open_loops: AnyRecord[] = [];
    const assumptions = fixtures.assumptions.filter(a => a.action_id === actionId);

    // Attempt to match an evaluation (guard check) for this action
    let decision = 'allow';
    let decision_reason = 'Action permitted under default demo policy.';
    if (fixtures.guardDecisions) {
      const evalMatch = fixtures.guardDecisions.find(g => g.action_id === actionId);
      if (evalMatch) {
         decision = evalMatch.decision;
         decision_reason = evalMatch.reason;
      }
    }

    return { action: dynamicAction, open_loops, assumptions, decision, decision_reason };
  }

  // Marketing home demo scenarios. The /decisions ledger prepends three
  // synthetic rows with stable ids (act_demo_home_sync_001,
  // act_demo_home_deploy_001, act_demo_home_block_001) backed by
  // getHomepageDemoActions in app/lib/homepageDemoActions.js. This branch
  // mirrors that data into the detail endpoint so /decisions/<id> and
  // /replay/<id> resolve instead of 404ing. resolution=null because the
  // server cannot read the visitor's localStorage; the deploy entry
  // therefore renders as pending_approval, which is the correct natural
  // state of that scenario.
  if (actionId.startsWith('act_demo_home_')) {
    const homepageActions = getHomepageDemoActions(null);
    const action = homepageActions.find((a: AnyRecord) => a.action_id === actionId);
    if (!action) return null;

    const decisionByStatus: Record<string, string> = {
      completed: 'allow',
      pending_approval: 'require_approval',
      blocked: 'block',
      cancelled: 'block',
    };
    const decision = decisionByStatus[action.status] || 'allow';

    const assumptionByActionId: Record<string, { assumption: string; basis: string; validated: number }> = {
      act_demo_home_sync_001: {
        assumption: 'Hourly metric syncs are reversible and below the risk threshold.',
        basis: 'Risk threshold classifier',
        validated: 1,
      },
      act_demo_home_deploy_001: {
        assumption: 'Production deploys require human approval before execution.',
        basis: 'Production deploy policy',
        validated: 1,
      },
      act_demo_home_block_001: {
        assumption: 'The agent has authorization to drop production tables.',
        basis: 'Production data protection policy',
        validated: 0,
      },
    };
    const asm = assumptionByActionId[actionId] as { assumption: string; basis: string; validated: number };

    return {
      action,
      open_loops: [],
      assumptions: [
        {
          assumption_id: `asm_${action.action_id}_1`,
          action_id: action.action_id,
          assumption: asm.assumption,
          basis: asm.basis,
          validated: asm.validated,
        },
      ],
      decision,
      decision_reason: action.reasoning || action.output_summary || 'Demo scenario from the marketing home page.',
    };
  }

  if (actionId.startsWith('act_pipe_')) {
    const now = new Date().toISOString();
    return {
      action: {
        action_id: actionId,
        org_id: 'org_demo',
        agent_id: 'pipeline-agent',
        agent_name: 'Pipeline Agent',
        action_type: 'cleanup',
        declared_goal: 'Purge customer records from production database',
        reasoning: 'Automated data retention policy enforcement — purging expired customer records.',
        status: 'blocked',
        risk_score: 94,
        confidence: 100,
        reversible: 0,
        systems_touched: '["postgres-prod", "customer-data", "s3-backups"]',
        error_message: 'Blocked by policy: PRODUCTION_DATA_PROTECTION — irreversible operation on customer data',
        output_summary: 'Blocked by policy PRODUCTION_DATA_PROTECTION. Irreversible operation on customer data requires explicit approval.',
        timestamp_start: now,
        timestamp_end: now,
        duration_ms: 180,
        cost_estimate: 0,
        verified: true,
      },
      open_loops: [],
      assumptions: [
        { assumption_id: 'asm_pipe_1', action_id: actionId, assumption: 'Records flagged as expired are eligible for deletion', basis: 'Retention policy engine', validated: 0 },
        { assumption_id: 'asm_pipe_2', action_id: actionId, assumption: 'No active legal holds on target records', basis: 'Compliance system check', validated: 0 },
      ],
      decision: 'block',
      decision_reason: 'Risk score 94 exceeds org threshold of 75. Policy PRODUCTION_DATA_PROTECTION enforced — irreversible operations on customer data require explicit approval.',
    };
  }

  if (actionId.startsWith('act_sim_')) {
    return {
      action: {
        action_id: actionId,
        org_id: 'org_demo',
        agent_id: 'simulator-bot',
        agent_name: 'Simulator Bot',
        action_type: 'deploy',
        declared_goal: 'DEPLOY: production-api rollout',
        reasoning: 'Deploying latest verified build to production environment.',
        status: 'completed',
        risk_score: 15,
        confidence: 98,
        reversible: 1,
        systems_touched: '["production-api", "aws-lambda"]',
        output_summary: 'Deployment successful. Health checks passed across all regions.',
        timestamp_start: new Date().toISOString(),
        timestamp_end: new Date().toISOString(),
        duration_ms: 12400,
        cost_estimate: 0.042,
        verified: true
      },
      open_loops: [],
      assumptions: [
        { assumption_id: 'asm_sim_1', action_id: actionId, assumption: 'Staging environment is healthy', basis: 'Pre-flight check passed', validated: 1 },
        { assumption_id: 'asm_sim_2', action_id: actionId, assumption: 'No active critical alerts', basis: 'Security scanner report', validated: 1 }
      ]
    };
  }

  const action = fixtures.actions.find(a => a.action_id === actionId) || null;
  if (!action) return null;
  const open_loops: AnyRecord[] = [];
  const assumptions = fixtures.assumptions.filter(a => a.action_id === actionId);
  return { action, open_loops, assumptions };
}

export function demoAssumptions(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const drift = sp.get('drift') === 'true';
  const agentId = sp.get('agent_id') || undefined;
  const actionId = sp.get('action_id') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  let items = fixtures.assumptions.slice();
  if (agentId) items = items.filter(a => a.agent_id === agentId);
  if (actionId) items = items.filter(a => a.action_id === actionId);

  items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const total = items.length;
  const paged = items.slice(offset, offset + limit);

  if (!drift) {
    return { assumptions: paged, total, lastUpdated: new Date().toISOString() };
  }

  const now = Date.now();
  let atRisk = 0;
  for (const asm of paged) {
    if (asm.validated === 1) {
      asm.drift_score = 0;
    } else if (asm.invalidated === 1) {
      asm.drift_score = null;
    } else {
      const createdAt = new Date(asm.created_at).getTime();
      const daysOld = (now - createdAt) / (1000 * 60 * 60 * 24);
      asm.drift_score = Math.min(100, Math.round((daysOld / 30) * 100));
      if (asm.drift_score >= 50) atRisk++;
    }
  }

  return {
    assumptions: paged,
    total,
    drift_summary: {
      total,
      at_risk: atRisk,
      validated: paged.filter(a => a.validated === 1).length,
      invalidated: paged.filter(a => a.invalidated === 1).length,
      unvalidated: paged.filter(a => a.validated === 0 && a.invalidated === 0).length,
    },
    lastUpdated: new Date().toISOString(),
  };
}

export function demoTokens(fixtures: DemoFixtures) {
  return {
    current: fixtures.tokensCurrent,
    today: fixtures.tokensToday,
    history: fixtures.tokenHistory.slice().reverse(),
    timeline: [],
    lastUpdated: new Date().toISOString(),
  };
}

export function demoPolicies(fixtures: DemoFixtures) {
  return { policies: fixtures.policies, lastUpdated: new Date().toISOString() };
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
      },
      {
        shape: { action_type: 'write_file', target_prefix: 'src/', key: 'write_file::src/', label: 'write_file → src/' },
        count: 7,
        latest_at: iso(7_200_000),
        sample_id: 'gd_demo_warn_2',
        sample_goal: 'Refactor authentication module',
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

export function demoContent(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  const items = (fixtures.content || []).slice();
  const total = items.length;
  const paged = items.slice(offset, offset + limit);
  const docs = items.filter(i => i.type === 'document').length;
  const snippets = items.filter(i => i.type === 'snippet').length;
  const pages = items.filter(i => i.type === 'dashboard_page').length;
  const stats = { total_items: total, documents: docs, snippets, pages, storage_bytes: 4200000 };

  return { items: paged, total, stats, lastUpdated: new Date().toISOString() };
}

export function demoActivity(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  const items = (fixtures.activityLogs || []).slice();
  const total = items.length;
  const paged = items.slice(offset, offset + limit);
  return { events: paged, total, lastUpdated: new Date().toISOString() };
}

export function demoWebhooks(fixtures: DemoFixtures) {
  const items = fixtures.webhooks.slice();
  const stats = {
    total: items.length,
    active: items.filter(w => w.status === 'active').length,
    failing: items.filter(w => w.status === 'failing').length,
  };
  return { webhooks: items, stats, lastUpdated: new Date().toISOString() };
}

export function demoWebhookDeliveries(fixtures: DemoFixtures, webhookId: string) {
  const d = (fixtures.webhookDeliveries && fixtures.webhookDeliveries[webhookId]) || [];
  return { deliveries: d, total: d.length };
}

export function demoSchedules(fixtures: DemoFixtures) {
  return { schedules: fixtures.schedules, lastUpdated: new Date().toISOString() };
}

export function demoDigest(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const since = sp.get('since') || undefined;
  return { digest: fixtures.digest || null, lastUpdated: new Date().toISOString() };
}

export function demoContextPoints(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  const items = (fixtures.contextPoints || []).slice();
  const total = items.length;
  const paged = items.slice(offset, offset + limit);
  return { points: paged, total, lastUpdated: new Date().toISOString() };
}

export function demoContextThreads(fixtures: DemoFixtures, url: URL) {
  const items = (fixtures.contextThreads || []).slice();
  const active = items.filter(t => t.status === 'active').length;
  return { threads: items, total: items.length, stats: { total: items.length, active }, lastUpdated: new Date().toISOString() };
}

export function demoContextThreadDetail(fixtures: DemoFixtures, threadId: string) {
  const t = (fixtures.contextThreads || []).find(th => th.id === threadId);
  if (!t) return null;
  const pts = (fixtures.contextPoints || []).filter(p => p.thread_id === threadId);
  return { thread: t, points: pts };
}

export function demoSnippets(fixtures: DemoFixtures, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const items = (fixtures.content || []).filter(i => i.type === 'snippet').slice(0, limit);
  return { snippets: items, total: items.length };
}

export function demoPreferences(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const scope = sp.get('scope') || 'user';
  if (scope !== 'user' && scope !== 'org') return { error: 'Invalid scope' };
  return { scope, preferences: fixtures.preferences[scope] || {}, lastUpdated: new Date().toISOString() };
}

export function demoActionTrace(fixtures: DemoFixtures, actionId: string) {
  const detail = demoActionDetail(fixtures, actionId);
  if (!detail) return null;

  const { action, assumptions, open_loops } = detail;
  const loops = open_loops || [];

  return {
    action,
    trace: {
      assumptions: {
        total: assumptions.length,
        validated: assumptions.filter((a: AnyRecord) => a.validated === 1).length,
        invalidated: assumptions.filter((a: AnyRecord) => a.invalidated === 1).length,
        unvalidated: assumptions.filter((a: AnyRecord) => a.validated === 0 && a.invalidated === 0).length,
        items: assumptions
      },
      loops: {
        total: loops.length,
        open: loops.filter((l: AnyRecord) => l.status === 'open').length,
        resolved: loops.filter((l: AnyRecord) => l.status === 'resolved').length,
        cancelled: loops.filter((l: AnyRecord) => l.status === 'cancelled').length,
        items: loops
      },
      parent_chain: [],
      sub_actions: [],
      related_actions: [],
      root_cause_indicators: []
    }
  };
}

export function demoDecisionMetrics(fixtures: DemoFixtures) {
  return {
    ...fixtures.decisionMetrics,
    lastUpdated: new Date().toISOString()
  };
}

// ── Sitewide-interactions-v2 demo handlers (gap pages) ───────────────────────
// Deterministic, READ-ONLY fixtures so no page renders empty in demo mode. Data
// values use fixed timestamps (no Date.now()/random) so tests stay stable; only
// the non-asserted `lastUpdated` metadata uses the live clock, matching the
// existing demo handlers above.

const DEMO_FALLBACK_AGENT_IDS = ['clawdbot', 'refund-support-agent', 'deploy-runner', 'data-pipeline'];

function demoAgentIdList(fixtures: DemoFixtures): string[] {
  const ids = Array.from(new Set((fixtures.actions || []).map((a) => a.agent_id).filter(Boolean)));
  return ids.length ? ids.slice(0, 6) : DEMO_FALLBACK_AGENT_IDS;
}

const DEMO_SESSION_STATUSES = ['running', 'completed', 'completed', 'blocked', 'failed'];

// Single source for the demo session set: the list route, the detail trio
// (/api/sessions/:id{,/events,/actions}) and their aggregates all derive from
// this builder, so clicking any list row resolves on the detail page.
function buildDemoSessionList(fixtures: DemoFixtures): AnyRecord[] {
  return demoAgentIdList(fixtures).flatMap((agentId, i) =>
    [0, 1].map((j) => {
      const n = i * 2 + j + 1;
      const day = (n % 7) + 1;
      const min = n % 6;
      const status = DEMO_SESSION_STATUSES[n % DEMO_SESSION_STATUSES.length];
      return {
        id: `sess_demo_${n}`,
        agent_id: agentId,
        agent_name: agentId,
        status,
        workspace: 'demo-governance-workspace',
        branch: n % 2 === 0 ? 'main' : `feat/demo-task-${n}`,
        blocked_reason: status === 'blocked'
          ? 'Guard requires approval: deploy touches production configuration.'
          : null,
        action_count: 3 + ((n * 7) % 18),
        created_at: `2026-06-0${day}T08:0${min}:00.000Z`,
        updated_at: `2026-06-0${day}T09:1${min}:00.000Z`,
        last_activity: `2026-06-0${day}T09:1${min}:00.000Z`,
      };
    }),
  );
}

export function demoSessions(fixtures: DemoFixtures, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);
  const agentId = url.searchParams.get('agent_id');
  let sessions = buildDemoSessionList(fixtures);
  if (agentId) sessions = sessions.filter((s) => s.agent_id === agentId);
  return { sessions: sessions.slice(0, limit), lastUpdated: new Date().toISOString() };
}

const DEMO_SESSION_ACTION_TYPES = ['review', 'deploy', 'file_write', 'shell', 'api_call', 'research'];
const DEMO_SESSION_GOALS = [
  'Review open pull request for the payments service',
  'Deploy staging build after green test run',
  'Update retry policy in the webhook dispatcher',
  'Run the integration test suite',
  'Sync customer metrics to the warehouse',
  'Summarize incident timeline for the postmortem',
];

// Deterministic per-session action ledger. Generates exactly
// session.action_count rows so the "# Actions" card, the paginated list total,
// and the aggregates always agree — mirroring the live route's invariant.
function buildDemoSessionActions(session: AnyRecord): AnyRecord[] {
  const n = parseInt(String(session.id).replace(/\D+/g, ''), 10) || 1;
  const count = Number(session.action_count) || 0;
  const day = (n % 7) + 1;
  return Array.from({ length: count }, (_, i) => {
    const failed = session.status === 'failed' && i === 0;
    const blocked = session.status === 'blocked' && i === 0;
    const status = failed ? 'failed' : blocked ? 'blocked' : 'completed';
    return {
      action_id: `ar_demo_sess_${n}_${i + 1}`,
      agent_id: session.agent_id,
      action_type: DEMO_SESSION_ACTION_TYPES[(n + i) % DEMO_SESSION_ACTION_TYPES.length],
      declared_goal: DEMO_SESSION_GOALS[(n + i) % DEMO_SESSION_GOALS.length],
      status,
      outcome_status: status,
      risk_score: (n * 13 + i * 17) % 100,
      cost_estimate: Number((((n * 7 + i * 3) % 40) / 100).toFixed(2)),
      created_at: `2026-06-0${day}T08:${String(10 + ((i * 2) % 50)).padStart(2, '0')}:00.000Z`,
    };
  });
}

function buildDemoSessionEvents(session: AnyRecord): AnyRecord[] {
  const base = String(session.created_at).slice(0, 11); // '2026-06-0XT'
  const events: AnyRecord[] = [
    { id: `se_${session.id}_1`, seq: 1, session_id: session.id, kind: 'spawning', detail: null, created_at: `${base}08:00:00.000Z` },
    { id: `se_${session.id}_2`, seq: 2, session_id: session.id, kind: 'running', detail: 'Agent checked in and began the work loop.', created_at: `${base}08:01:00.000Z` },
  ];
  if (session.status === 'blocked') {
    events.push({ id: `se_${session.id}_3`, seq: 3, session_id: session.id, kind: 'blocked', detail: session.blocked_reason, created_at: `${base}08:45:00.000Z` });
  } else if (session.status === 'failed') {
    events.push({ id: `se_${session.id}_3`, seq: 3, session_id: session.id, kind: 'failed', detail: 'Terminal command exited non-zero twice; session halted for operator review.', created_at: `${base}09:05:00.000Z` });
  } else if (session.status === 'completed') {
    events.push({ id: `se_${session.id}_3`, seq: 3, session_id: session.id, kind: 'completed', detail: 'Completed the governed task list: actions recorded, assumptions logged, no policy violations.', created_at: `${base}09:10:00.000Z` });
  }
  return events;
}

export function demoSessionDetail(fixtures: DemoFixtures, sessionId: string) {
  const session = buildDemoSessionList(fixtures).find((s) => s.id === sessionId);
  if (!session) return null;
  const actions = buildDemoSessionActions(session);
  const events = buildDemoSessionEvents(session);
  return {
    session: {
      ...session,
      total_cost: Number(actions.reduce((sum, a) => sum + (Number(a.cost_estimate) || 0), 0).toFixed(2)),
      max_risk: actions.reduce((m, a) => Math.max(m, Number(a.risk_score) || 0), 0),
      event_count: events.length,
      last_action_at: session.last_activity,
    },
  };
}

export function demoSessionEvents(fixtures: DemoFixtures, sessionId: string) {
  const session = buildDemoSessionList(fixtures).find((s) => s.id === sessionId);
  if (!session) return null;
  return { events: buildDemoSessionEvents(session) };
}

// Paginated, newest-first — same contract as GET /api/sessions/:id/actions.
export function demoSessionActions(fixtures: DemoFixtures, sessionId: string, url: URL) {
  const session = buildDemoSessionList(fixtures).find((s) => s.id === sessionId);
  if (!session) return null;
  const sp = url.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0);
  const all = buildDemoSessionActions(session)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { actions: all.slice(offset, offset + limit), total: all.length };
}

export function demoIdentities(fixtures: DemoFixtures) {
  const levels = ['admin', 'readwrite', 'readonly'];
  const identities = demoAgentIdList(fixtures).map((agentId, i) => ({
    agent_id: agentId,
    agent_name: agentId,
    permission_level: levels[i % levels.length],
    verified: true,
    fingerprint: `fp_demo_${i + 1}`,
    last_seen: `2026-06-0${(i % 7) + 1}T10:00:00.000Z`,
    created_at: `2026-05-2${i % 9}T10:00:00.000Z`,
  }));
  return { identities, lastUpdated: new Date().toISOString() };
}

export function demoApiKeys() {
  const keys = [
    { id: 'key_demo_1', name: 'CI Pipeline', prefix: 'dk_live_', revoked_at: null, created_at: '2026-04-01T00:00:00.000Z', last_used_at: '2026-06-07T08:00:00.000Z' },
    { id: 'key_demo_2', name: 'Local Dev', prefix: 'dk_test_', revoked_at: null, created_at: '2026-05-12T00:00:00.000Z', last_used_at: '2026-06-05T14:00:00.000Z' },
    { id: 'key_demo_3', name: 'Retired Key', prefix: 'dk_live_', revoked_at: '2026-05-20T00:00:00.000Z', created_at: '2026-03-01T00:00:00.000Z', last_used_at: '2026-05-19T00:00:00.000Z' },
  ];
  return { keys, lastUpdated: new Date().toISOString() };
}

