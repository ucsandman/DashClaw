import { getHomepageDemoActions } from '../homepageDemoActions';

// Demo fixtures are dynamically-shaped demo data assembled fresh per request.
// They are an external boundary to this module, so collections are typed loosely.
type AnyRecord = Record<string, any>;

export interface DemoFixtures {
  actions: AnyRecord[];
  loops: AnyRecord[];
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
  messages: AnyRecord[];
  messageThreads: AnyRecord[];
  content?: AnyRecord[];
  teamMembers?: AnyRecord[];
  teamInvites?: AnyRecord[];
  activityLogs?: AnyRecord[];
  webhooks: AnyRecord[];
  webhookDeliveries?: Record<string, AnyRecord[]>;
  workflows: AnyRecord[];
  schedules: AnyRecord[];
  digest?: AnyRecord | null;
  contextPoints?: AnyRecord[];
  contextThreads?: AnyRecord[];
  handoffs?: AnyRecord[];
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

export function demoAgentConnections(fixtures: DemoFixtures, url: URL) {
  const agentId = url.searchParams.get('agent_id');
  const now = new Date().toISOString();

  // Default static connections for demo
  const staticConnections = [
    { id: 'conn_demo_1', agent_id: 'deploy-bot', type: 'github', status: 'active', updated_at: now },
    { id: 'conn_demo_2', agent_id: 'deploy-bot', type: 'aws', status: 'active', updated_at: now },
    { id: 'conn_demo_3', agent_id: 'security-scanner', type: 'snyk', status: 'active', updated_at: now },
    { id: 'conn_demo_4', agent_id: 'security-scanner', type: 'github', status: 'active', updated_at: now },
    { id: 'conn_demo_5', agent_id: 'code-reviewer', type: 'github', status: 'active', updated_at: now },
    { id: 'conn_demo_6', agent_id: 'data-analyst', type: 'snowflake', status: 'active', updated_at: now },
    { id: 'conn_demo_7', agent_id: 'api-monitor', type: 'datadog', status: 'active', updated_at: now },
  ];

  let connections = staticConnections;
  if (agentId) {
    connections = staticConnections.filter(c => c.agent_id === agentId);
    // If no specific connections defined for this agent, give them a generic one so the UI isn't empty
    if (connections.length === 0) {
      connections = [{ id: `conn_gen_${agentId}`, agent_id: agentId, type: 'api_key', status: 'active', updated_at: now }];
    }
  }

  return { connections, total: connections.length, lastUpdated: now };
}

export function demoAgents(fixtures: DemoFixtures) {
  const map = new Map<string, AnyRecord>();
  // Include our synthetic demo test action
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

export function demoAgentDetail(fixtures: DemoFixtures, agentId: string) {
  const list = demoAgents(fixtures).agents;
  const agent = list.find(a => a.agent_id === agentId);

  // If not found in the list, but they just created an action, provide a fallback profile
  const baseAgent = agent || {
    agent_id: agentId,
    agent_name: agentId === 'refund-support-agent' ? 'Refund Support Agent' : agentId,
    action_count: 1,
    last_active: new Date().toISOString()
  };

  return {
    agent: {
      ...baseAgent,
      governed: true,
      verified: true,
      connections: [
        { id: 'conn_demo_1', type: 'github', status: 'active', updated_at: new Date().toISOString() },
        { id: 'conn_demo_2', type: 'aws', status: 'active', updated_at: new Date().toISOString() }
      ],
      capabilities: ['deployment', 'research', 'code-review'],
      risk_profile: 'Standard',
      enforced_policies_count: fixtures.policies.length,
    }
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
    const open_loops = fixtures.loops
      .filter(l => l.action_id === actionId)
      .map(({ agent_id, agent_name, declared_goal, action_type, ...rest }) => rest);
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
  const open_loops = fixtures.loops
    .filter(l => l.action_id === actionId)
    .map(({ agent_id, agent_name, declared_goal, action_type, ...rest }) => rest);
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

// Demo lessons in the LIVE consolidation shape (consolidateLessons output) —
// the demo used to fake rows from the dead `lessons` table, advertising a
// surface real installs could never populate.
export function demoConsolidatedLessons(fixtures: DemoFixtures) {
  const lessons = (fixtures.recommendations || []).slice(0, 6).map((rec: any) => ({
    action_type: rec.action_type,
    confidence: rec.confidence ?? 70,
    success_rate: rec.success_rate ?? 80,
    hints: {
      risk_cap: rec.action_type === 'deploy' ? 60 : undefined,
      prefer_reversible: rec.action_type === 'deploy' ? true : undefined,
      confidence_floor: undefined,
      expected_duration: undefined,
      expected_cost: undefined,
    },
    guidance: `${rec.agent_id} succeeds at ${rec.action_type} when actions stay inside the learned envelope.`,
    sample_size: rec.sample_size ?? 12,
  }));
  return { lessons, drift_warnings: [], agent_id: null };
}

export function demoLearning(fixtures: DemoFixtures, url: URL) {
  const agentId = url.searchParams.get('agent_id');
  const decisions = agentId ? fixtures.decisions.filter(d => d.agent_id === agentId) : fixtures.decisions;
  const { lessons, drift_warnings } = demoConsolidatedLessons(fixtures);

  const successCount = decisions.filter(d => d.outcome === 'success').length;
  const totalWithOutcome = decisions.filter(d => d.outcome && d.outcome !== 'pending').length;
  const successRate = totalWithOutcome > 0 ? Math.round((successCount / totalWithOutcome) * 100) : 0;

  const stats = {
    totalDecisions: decisions.length,
    totalLessons: lessons.length,
    successRate,
    totalWithOutcome,
    patterns: lessons.filter(l => Number(l.confidence) >= 80).length,
  };

  return { decisions: decisions.slice(0, 20), lessons, drift_warnings, stats, lastUpdated: new Date().toISOString() };
}

export function demoLearningRecommendations(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const actionType = sp.get('action_type') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const includeInactive = sp.get('include_inactive') === 'true';

  let recs = fixtures.recommendations.slice();
  if (agentId) recs = recs.filter(r => r.agent_id === agentId);
  if (actionType) recs = recs.filter(r => r.action_type === actionType);
  if (!includeInactive) recs = recs.filter(r => r.active);

  return {
    recommendations: recs.slice(0, limit),
    metrics: undefined,
    lookback_days: 30,
    total: Math.min(limit, recs.length),
    lastUpdated: new Date().toISOString(),
  };
}

export function demoLearningRecommendationMetrics(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const actionType = sp.get('action_type') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '100', 10), 200);

  let metrics = fixtures.metrics.slice();
  if (agentId) metrics = metrics.filter(m => m.agent_id === agentId);
  if (actionType) metrics = metrics.filter(m => m.action_type === actionType);

  return {
    metrics: metrics.slice(0, limit),
    summary: fixtures.metricsSummary,
    lookback_days: 30,
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
 *  policy 3: x402_spend_limit      → interrupt "paid spend reaches $5.00" (editable)
 *                                  + block "paid spend exceeds $25.00" (editable)
 *  policy 4: warn_action_type      → silent "message, post, email, calendar, sync, api calls (recorded for review)"
 *  policy 5: require_approval      → interrupt "action is one of: deploy, migrate, workflow_execute"
 *  policy 6: require_approval      → interrupt "action is one of: delete, reset, destroy, drop"
 *  policy 7: protected_path        → interrupt "protected paths change (governance, auth, secrets)"
 *  policy 8: rate_limit/warn       → silent "burst: more than 250 actions in 30 minutes"
 *  policy 9: rate_limit/require_approval → interrupt "runaway loop: more than 650 actions in 60 minutes"
 */
export function demoContract(): import('../policy-modes/contract').ContractView {
  const x402Rules = { approval_threshold: 5.0, max_spend_usd: 25.0, _mode: 'claude-code' };
  return {
    governed: true,
    mode_id: 'claude-code',
    interrupts: [
      {
        policy_id: 'gp_demo_interrupt_1',
        text: 'paid spend reaches $5.00',
        fired_7d: 2,
        editable: { param: 'approval_threshold', value: 5.0 },
        rules: x402Rules,
      },
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
      {
        policy_id: 'gp_demo_block_2',
        text: 'paid spend exceeds $25.00',
        fired_7d: 0,
        editable: { param: 'max_spend_usd', value: 25.0 },
        rules: x402Rules,
      },
    ],
    grants: [
      { policy_id: 'gp_demo_grant_1', label: 'read_file → /workspace/', shape_key: 'read_file::/workspace/', created_at: null },
    ],
    custom: [],
    friction: { interrupts_7d: 13, est_seconds: 260 },
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

export function demoMessages(fixtures: DemoFixtures, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const msgs = fixtures.messages.slice();
  const total = msgs.length;
  const paged = msgs.slice(offset, offset + limit);
  const agents = new Set<string>();
  const threads = new Set<string>();
  msgs.forEach(m => { if (m.agent_id) agents.add(m.agent_id); if (m.thread_id) threads.add(m.thread_id); });
  const stats = { total_messages: total, unique_agents: agents.size, active_threads: threads.size };
  return { messages: paged, total, stats, lastUpdated: new Date().toISOString() };
}

export function demoMessageThreads(fixtures: DemoFixtures, url: URL) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const threadList = fixtures.messageThreads.slice();
  const total = threadList.length;
  const paged = threadList.slice(offset, offset + limit);
  return { threads: paged, total, lastUpdated: new Date().toISOString() };
}

export function demoMessageDocs(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  let docs = fixtures.messages.filter(m => Array.isArray(m.docs) && m.docs.length > 0).flatMap(m => m.docs);
  const total = docs.length;
  const paged = docs.slice(offset, offset + limit);
  return { docs: paged, total, lastUpdated: new Date().toISOString() };
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

export function demoTeam(fixtures: DemoFixtures) {
  return { team: fixtures.teamMembers || [], lastUpdated: new Date().toISOString() };
}

export function demoTeamInvites(fixtures: DemoFixtures) {
  return { invites: fixtures.teamInvites || [], lastUpdated: new Date().toISOString() };
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

export function demoWorkflows(fixtures: DemoFixtures, url: URL) {
  const items = fixtures.workflows.slice();
  const stats = {
    total: items.length,
    active: items.filter(w => w.status === 'active').length,
    paused: items.filter(w => w.status === 'paused').length,
  };
  return { workflows: items, stats, lastUpdated: new Date().toISOString() };
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

export function demoHandoffs(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  const items = (fixtures.handoffs || []).slice();
  const total = items.length;
  const paged = items.slice(offset, offset + limit);
  const pending = items.filter(h => h.status === 'pending').length;
  return { handoffs: paged, total, stats: { pending }, lastUpdated: new Date().toISOString() };
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

export function demoSwarmGraph(fixtures: DemoFixtures, url: URL) {
  const nodes: AnyRecord[] = [];
  const links: AnyRecord[] = [];
  const agentMap = new Map<string, AnyRecord>();

  for (const a of fixtures.actions) {
    if (!agentMap.has(a.agent_id)) {
      agentMap.set(a.agent_id, {
        id: a.agent_id,
        name: a.agent_name || a.agent_id,
        group: 1,
        label: a.agent_name || a.agent_id,
        val: 1,
        risk: (parseInt(a.risk_score, 10) || 0),
        actions: 1,
        cost: (parseFloat(a.cost_estimate) || 0)
      });
    } else {
      const node = agentMap.get(a.agent_id) as AnyRecord;
      node.val += 0.5;
      node.actions += 1;
      node.risk = Math.max(node.risk, (parseInt(a.risk_score, 10) || 0));
      node.cost += (parseFloat(a.cost_estimate) || 0);
    }
  }

  const interactions = [
    { source: 'agent_3', target: 'agent_2', value: 5 },
    { source: 'agent_4', target: 'agent_2', value: 3 },
    { source: 'agent_2', target: 'agent_1', value: 8 },
  ];

  for (const agent of agentMap.values()) {
    nodes.push(agent);
  }

  for (const link of interactions) {
    if (agentMap.has(link.source) && agentMap.has(link.target)) {
      links.push(link);
    }
  }

  return {
    nodes,
    links,
    total_agents: nodes.length,
    total_links: links.length,
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

export function demoKnowledgeCollections() {
  const names = ['Governance Playbook', 'Security Runbooks', 'API Contracts', 'Incident Postmortems'];
  const sources = ['manual', 'github', 'manual', 'url'];
  const docCounts = [12, 34, 8, 19];
  const collections = [1, 2, 3, 4].map((n) => ({
    collection_id: `col_demo_${n}`,
    name: names[n - 1],
    ingestion_status: 'ready',
    source_type: sources[n - 1],
    doc_count: docCounts[n - 1],
    created_at: `2026-05-1${n}T12:00:00.000Z`,
    last_synced_at: `2026-06-0${n}T12:00:00.000Z`,
    tags: ['governance'],
  }));
  return { collections, lastUpdated: new Date().toISOString() };
}

export function demoApiKeys() {
  const keys = [
    { id: 'key_demo_1', name: 'CI Pipeline', prefix: 'dk_live_', revoked_at: null, created_at: '2026-04-01T00:00:00.000Z', last_used_at: '2026-06-07T08:00:00.000Z' },
    { id: 'key_demo_2', name: 'Local Dev', prefix: 'dk_test_', revoked_at: null, created_at: '2026-05-12T00:00:00.000Z', last_used_at: '2026-06-05T14:00:00.000Z' },
    { id: 'key_demo_3', name: 'Retired Key', prefix: 'dk_live_', revoked_at: '2026-05-20T00:00:00.000Z', created_at: '2026-03-01T00:00:00.000Z', last_used_at: '2026-05-19T00:00:00.000Z' },
  ];
  return { keys, lastUpdated: new Date().toISOString() };
}

export function demoSecrets() {
  const secrets = [
    { id: 'sec_demo_1', name: 'STRIPE_API_KEY', next_rotation_due: '2026-07-01T00:00:00.000Z', rotation_interval_days: 90, last_rotated_at: '2026-04-02T00:00:00.000Z' },
    { id: 'sec_demo_2', name: 'OPENAI_API_KEY', next_rotation_due: '2026-06-15T00:00:00.000Z', rotation_interval_days: 30, last_rotated_at: '2026-05-16T00:00:00.000Z' },
    { id: 'sec_demo_3', name: 'GITHUB_TOKEN', next_rotation_due: null, rotation_interval_days: 180, last_rotated_at: null },
  ];
  return { secrets, lastUpdated: new Date().toISOString() };
}

export function demoModelStrategies() {
  const strategies = [
    { strategy_id: 'str_demo_1', name: 'Cost-optimized', description: 'Cheap model first, escalate on failure', config: { primary: { provider: 'anthropic', model: 'claude-haiku-4-5' }, fallback: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }] } },
    { strategy_id: 'str_demo_2', name: 'Quality-first', description: 'Frontier model for heavy reasoning', config: { primary: { provider: 'anthropic', model: 'claude-opus-4-8' }, fallback: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }] } },
  ];
  return { strategies, lastUpdated: new Date().toISOString() };
}

// ── Reputation (demo) ────────────────────────────────────────────────────────
// Vectors mirror snapshotToVector (reputation.repository): blend scores are
// 0..1, risk_score is a SEPARATE 0-100 axis, and the provenance breakdown is a
// sibling. Weights/ceiling match app/lib/reputation.ts so the "How this is
// derived" panel shows a believable derivation.

const DEMO_REPUTATION_WEIGHTS = { outcome: 0.45, approval: 0.2, policy_violation: 0.25, quality: 0.1 };
const DEMO_REPUTATION_CEILING_RATE = 0.1;

function buildDemoReputationVector(agentId: string, i: number): AnyRecord {
  const completion = Number((0.96 - i * 0.06).toFixed(3));
  const approval = Number((0.94 - i * 0.05).toFixed(3));
  const quality = Number((0.9 - i * 0.04).toFixed(3));
  const violationRate = Number((0.005 + i * 0.01).toFixed(3));
  const violationScore = Number((1 - Math.min(1, violationRate / DEMO_REPUTATION_CEILING_RATE)).toFixed(3));
  const totalEvents = 180 - i * 25;
  const reliability = Number((
    completion * DEMO_REPUTATION_WEIGHTS.outcome +
    approval * DEMO_REPUTATION_WEIGHTS.approval +
    violationScore * DEMO_REPUTATION_WEIGHTS.policy_violation +
    quality * DEMO_REPUTATION_WEIGHTS.quality
  ).toFixed(4));
  const risk = 8 + i * 9;
  const dim = (key: string, eventCount: number, smoothed: number, weight: number | null) => ({
    key,
    event_count: eventCount,
    smoothed,
    contribution: weight == null ? null : Number((smoothed * weight).toFixed(4)),
  });
  return {
    agent_id: agentId,
    reliability_score: reliability,
    completion_rate: completion,
    policy_violation_rate: violationRate,
    approval_adherence: approval,
    quality_score: quality,
    risk_score: risk,
    volume_weight: Number(Math.min(1, totalEvents / 200).toFixed(3)),
    confidence: Number((0.9 - i * 0.08).toFixed(3)),
    total_events: totalEvents,
    last_event_at: `2026-06-0${(i % 7) + 1}T09:00:00.000Z`,
    computed_at: '2026-06-07T12:00:00.000Z',
    breakdown: {
      dimensions: [
        dim('outcome', Math.round(totalEvents * 0.5), completion, DEMO_REPUTATION_WEIGHTS.outcome),
        dim('approval', Math.round(totalEvents * 0.2), approval, DEMO_REPUTATION_WEIGHTS.approval),
        dim('policy_violation', Math.round(totalEvents * 0.1), violationScore, DEMO_REPUTATION_WEIGHTS.policy_violation),
        dim('quality', Math.round(totalEvents * 0.1), quality, DEMO_REPUTATION_WEIGHTS.quality),
        dim('risk', Math.round(totalEvents * 0.1), risk, null),
      ],
      normalized_weights: { ...DEMO_REPUTATION_WEIGHTS },
      reliability_unrounded: reliability,
      violation_penalty: { rate: violationRate, ceiling_rate: DEMO_REPUTATION_CEILING_RATE, penalty: Number(Math.min(1, violationRate / DEMO_REPUTATION_CEILING_RATE).toFixed(3)) },
      half_life_days: 90,
      lookback_days: 365,
      note: 'Risk is tracked separately (decay-weighted mean of per-action risk scores) and is not folded into reliability.',
    },
  };
}

export function demoReputationLeaderboard(fixtures: DemoFixtures) {
  const leaderboard = demoAgentIdList(fixtures).map((agentId, i) => buildDemoReputationVector(agentId, i));
  return { leaderboard, lastUpdated: new Date().toISOString() };
}

// Mirrors GET /api/reputation/agents/:id/summary. Unknown agents get a
// synthesized vector instead of a 404 — same leniency as demoAgentDetail.
export function demoReputationSummary(fixtures: DemoFixtures, agentId: string) {
  const ids = demoAgentIdList(fixtures);
  const i = ids.indexOf(agentId);
  const vector = buildDemoReputationVector(agentId, i === -1 ? 1 : i);
  return { agent_id: agentId, summary: { ...vector, is_active: true } };
}

const DEMO_REPUTATION_EVENT_TYPES = ['outcome', 'approval', 'quality', 'risk', 'policy_violation'];

// Mirrors GET /api/reputation/agents/:id/events (paginated, newest first).
export function demoReputationEvents(fixtures: DemoFixtures, agentId: string, url: URL) {
  const sp = url.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0);
  const all = Array.from({ length: 12 }, (_, i) => {
    const event_type = DEMO_REPUTATION_EVENT_TYPES[i % DEMO_REPUTATION_EVENT_TYPES.length];
    const ts = `2026-06-0${7 - (i % 7)}T0${i % 10}:30:00.000Z`;
    return {
      id: `re_demo_${i + 1}`,
      agent_id: agentId,
      source_agent_id: null,
      event_type,
      weight: 1,
      value: event_type === 'risk' ? 20 + ((i * 7) % 60) : event_type === 'policy_violation' ? 0 : 1,
      action_id: `ar_demo_rep_${i + 1}`,
      occurred_at: ts,
      metadata: null,
      created_at: ts,
    };
  }).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const events = all.slice(offset, offset + limit);
  return { agent_id: agentId, events, pagination: { limit, offset, count: events.length } };
}

export function demoPosture() {
  const dimensions = [
    { dimension: 'identity', score: 88, weight: 0.2 },
    { dimension: 'enforcement', score: 76, weight: 0.2 },
    { dimension: 'spend', score: 64, weight: 0.15 },
    { dimension: 'auditability', score: 95, weight: 0.15 },
    { dimension: 'approval', score: 82, weight: 0.15 },
    { dimension: 'data_protection', score: 71, weight: 0.15 },
  ];
  const snapshots = [82, 80, 79, 81, 83].map((score, i) => ({ score, createdAt: `2026-06-0${i + 1}T00:00:00.000Z` }));
  return {
    score: 81,
    status: 'needs_attention',
    cappedBy: null,
    dimensions,
    summary: {
      totalUnits: 6,
      coveredUnits: 4,
      openFindings: 2,
      pointsRecoverable: 14,
      acceptedRisk: { count: 1, lastActor: 'demo-operator', lastAt: '2026-06-06T00:00:00.000Z' },
    },
    snapshots,
    snapshotTs: '2026-06-07T00:00:00.000Z',
  };
}

export function demoPostureFindings() {
  const findings = [
    { key: 'spend_no_cap', dimension: 'spend', severity: 'high', title: 'No spend cap on 2 agents', evidence: { observedCount: 2, exampleActionIds: ['act_demo_1', 'act_demo_2'] }, scoreDelta: -8, fix: { type: 'policy', policyType: 'spend_cap', deepLink: '/policies' }, status: 'open' },
    { key: 'data_protection_paths', dimension: 'data_protection', severity: 'medium', title: 'Protected paths not gated', evidence: { observedCount: 3, exampleActionIds: ['act_demo_3'] }, scoreDelta: -6, fix: { type: 'policy', policyType: 'protected_path_approval', deepLink: '/policies' }, status: 'open' },
  ];
  const riskAccepted = [
    {
      key: 'noisy_monitor_type',
      dimension: 'auditability',
      severity: 'low',
      title: 'Action type "monitor" is not fully governed',
      evidence: { observedCount: 41, exampleActionIds: [] },
      scoreDelta: 1,
      fix: { type: 'policy', policyType: 'risk_threshold', deepLink: '/policies' },
      status: 'accepted_risk',
      statusMeta: { actor: 'demo-operator', note: 'Read-only monitoring; accepted.', updatedAt: '2026-06-06T00:00:00.000Z' },
    },
  ];
  return { findings, riskAccepted, counts: { open: 2, drafted: 0, resolved: 0, snoozed: 0, accepted_risk: 1 } };
}

// Period-aware spend rollup mirroring GET /api/finops/spend: the 7d/30d/90d
// buttons resize the by_day series (and totals follow), and ?lens=claude-code
// returns the code-sessions shape /spend/code renders. Dates are anchored to a
// fixed day so the payload stays deterministic.
const DEMO_SPEND_PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DEMO_SPEND_ANCHOR_MS = Date.parse('2026-06-07T00:00:00.000Z');

function demoSpendDates(days: number): string[] {
  return Array.from({ length: days }, (_, i) =>
    new Date(DEMO_SPEND_ANCHOR_MS - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function demoSpend(url: URL) {
  const sp = url.searchParams;
  const rawPeriod = sp.get('period') || '30d';
  const period = DEMO_SPEND_PERIOD_DAYS[rawPeriod] ? rawPeriod : '30d';
  const dates = demoSpendDates(DEMO_SPEND_PERIOD_DAYS[period] ?? 30);

  if ((sp.get('lens') || 'fleet') === 'claude-code') {
    const by_day = dates.map((date, i) => ({
      date,
      cost_usd: Number((1.2 + (i % 5) * 0.6).toFixed(2)),
      session_count: 1 + (i % 3),
    }));
    const total_cost_usd = Number(by_day.reduce((s, d) => s + d.cost_usd, 0).toFixed(2));
    const session_count = by_day.reduce((s, d) => s + d.session_count, 0);
    return {
      lens: 'claude_code',
      period,
      code_total_usd: total_cost_usd,
      code_sessions: {
        period,
        total_cost_usd,
        total_cache_savings_usd: Number((total_cost_usd * 0.55).toFixed(2)),
        session_count,
        by_day,
        by_project: [
          { project_id: 'cp_demo_dashclaw', project_name: 'dashclaw', cost_usd: Number((total_cost_usd * 0.7).toFixed(2)), session_count: Math.ceil(session_count * 0.7) },
          { project_id: 'cp_demo_docs', project_name: 'docs-site', cost_usd: Number((total_cost_usd * 0.3).toFixed(2)), session_count: Math.floor(session_count * 0.3) },
        ],
      },
    };
  }

  // The fleet lens supports ?agent_id= — a filtered view shows a slice of
  // fleet spend, never the full totals under an agent label.
  const scale = sp.get('agent_id') ? 0.4 : 1;
  const by_day = dates.map((date, i) => ({ date, cost_usd: Number(((3.1 + (i % 7) * 0.8) * scale).toFixed(2)) }));
  const x402_by_day = dates.map((date, i) => ({ date, spend_usd: Number(((0.4 + (i % 5) * 0.2) * scale).toFixed(2)) }));
  const total_cost_usd = Number(by_day.reduce((s, d) => s + d.cost_usd, 0).toFixed(2));
  const total_spend_usd = Number(x402_by_day.reduce((s, d) => s + d.spend_usd, 0).toFixed(2));
  return {
    lens: 'fleet',
    period,
    fleet_total_usd: Number((total_cost_usd + total_spend_usd).toFixed(2)),
    agent: { total_cost_usd, by_day },
    x402: { total_spend_usd, by_day: x402_by_day },
    unpriced: { action_count: 0 },
  };
}

// ── x402 purchases (demo) ────────────────────────────────────────────────────
// Shape of GET /api/x402/purchases (listPurchases): purchase rows with the
// provider_name join the /spend/x402 table renders. One row is deliberately
// unattributed (agent_id null) to demo the documented filtering caveat.
const DEMO_X402_PURCHASES: AnyRecord[] = [
  { action_id: 'act_demo_x402_001', agent_id: 'clawdbot', provider_id: 'xp_demo_search', provider_name: 'Exa Search', endpoint_id: 'xe_demo_search_v1', spend_amount: 0.05, currency: 'USDC', payment_method: 'x402', execution_status: 'succeeded', purchase_reason: 'Needed fresh market data beyond the training cutoff for the weekly briefing.', created_at: '2026-06-07T09:12:00.000Z' },
  { action_id: 'act_demo_x402_002', agent_id: 'deploy-runner', provider_id: 'xp_demo_enrich', provider_name: 'Acme Enrichment API', endpoint_id: 'xe_demo_enrich_v1', spend_amount: 0.25, currency: 'USDC', payment_method: 'x402', execution_status: 'pending', purchase_reason: 'Enrich the new signup cohort before routing to sales.', created_at: '2026-06-06T16:40:00.000Z' },
  { action_id: 'act_demo_x402_003', agent_id: 'clawdbot', provider_id: 'xp_demo_scrape', provider_name: 'Firecrawl Scrape', endpoint_id: 'xe_demo_scrape_v1', spend_amount: 0.1, currency: 'USDC', payment_method: 'x402', execution_status: 'failed', failure_reason: 'Provider returned 502; payment not settled.', purchase_reason: 'Capture competitor pricing page for the weekly diff.', created_at: '2026-06-05T11:05:00.000Z' },
  { action_id: 'act_demo_x402_004', agent_id: null, provider_id: 'xp_demo_search', provider_name: 'Exa Search', endpoint_id: 'xe_demo_search_v1', spend_amount: 0.05, currency: 'USDC', payment_method: 'x402', execution_status: 'succeeded', purchase_reason: 'Recorded before agent attribution was enabled.', created_at: '2026-06-04T10:00:00.000Z' },
];

export function demoX402Purchases(url: URL) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id');
  const providerId = sp.get('provider_id');
  let purchases = DEMO_X402_PURCHASES;
  if (agentId) purchases = purchases.filter((p) => p.agent_id === agentId);
  if (providerId) purchases = purchases.filter((p) => p.provider_id === providerId);
  return { purchases };
}

// Shape of GET /api/x402/budget: one entry per active x402_spend_limit policy
// with a budget tier. The org meter sits deliberately in the warning band
// (over the approval threshold, under the hard budget) so the demo shows a
// hot meter; the agent-scoped entry demos per-family bars.
const DEMO_X402_BUDGET_FAMILIES: AnyRecord[] = [
  { agent_id: 'clawdbot', window_spend_usd: 7.2 },
  { agent_id: 'deploy-runner', window_spend_usd: 2.4 },
];

export function demoX402Budget(url: URL) {
  const rawAgent = url.searchParams.get('agent_id');
  const family = rawAgent ? rawAgent.split(':')[0] : null;
  const families = family
    ? [{ agent_id: family, window_spend_usd: Number(DEMO_X402_BUDGET_FAMILIES.find((f) => f.agent_id === family)?.window_spend_usd ?? 0) }]
    : DEMO_X402_BUDGET_FAMILIES;
  const windowStart = new Date(Date.now() - 30 * 86400000).toISOString();
  return {
    budgets: [
      {
        policy_id: 'pol_demo_x402_budget_org', policy_name: 'Paid capability spend (org)', agent_ids: [],
        budget_usd: 25, budget_approval_threshold: 20, budget_window_days: 30, budget_scope: 'org',
        window_start: windowStart, window_spend_usd: 21.4,
      },
      {
        policy_id: 'pol_demo_x402_budget_agent', policy_name: 'Per-agent x402 budget', agent_ids: [],
        budget_usd: 10, budget_approval_threshold: 8, budget_window_days: 30, budget_scope: 'agent',
        window_start: windowStart, families,
      },
    ],
  };
}

export function demoBehaviorRecorder() {
  return { enabled: true, until: '2026-06-30T00:00:00.000Z', effective: true };
}

const DEMO_BEHAVIOR_SAMPLES = [
  { event_id: 'bse_demo_1', ts: '2026-06-07T09:00:00.000Z', agent_id: 'deploy-runner', agent_name: 'deploy-runner', tool: 'Bash', action_type: 'shell', command_shape: 'git push --force <path>', read_paths: [], write_paths: [], risk_score: 80, guard_decision: 'require_approval', outcome_status: 'completed' },
  { event_id: 'bse_demo_2', ts: '2026-06-07T08:40:00.000Z', agent_id: 'clawdbot', agent_name: 'clawdbot', tool: 'Edit', action_type: 'file_write', command_shape: null, read_paths: [], write_paths: ['.env'], risk_score: 60, guard_decision: 'warn', outcome_status: 'completed' },
  { event_id: 'bse_demo_3', ts: '2026-06-07T08:10:00.000Z', agent_id: 'clawdbot', agent_name: 'clawdbot', tool: 'Read', action_type: 'file_read', command_shape: null, read_paths: ['app/lib/config.ts'], write_paths: [], risk_score: 10, guard_decision: 'allow', outcome_status: 'completed' },
  { event_id: 'bse_demo_4', ts: '2026-06-06T18:00:00.000Z', agent_id: 'deploy-runner', agent_name: 'deploy-runner', tool: 'Bash', action_type: 'shell', command_shape: 'rm -rf <path>', read_paths: [], write_paths: [], risk_score: 95, guard_decision: 'block', outcome_status: 'blocked' },
  { event_id: 'bse_demo_5', ts: '2026-06-06T17:30:00.000Z', agent_id: 'data-pipeline', agent_name: 'data-pipeline', tool: 'Bash', action_type: 'shell', command_shape: 'curl <url>', read_paths: [], write_paths: [], risk_score: 35, guard_decision: 'allow', outcome_status: 'completed' },
  { event_id: 'bse_demo_6', ts: '2026-06-06T16:00:00.000Z', agent_id: 'clawdbot', agent_name: 'clawdbot', tool: 'Bash', action_type: 'shell', command_shape: 'npm test', read_paths: [], write_paths: [], risk_score: 5, guard_decision: 'allow', outcome_status: 'running' },
];

export function demoBehaviorSamples(_fixtures: DemoFixtures, url: URL) {
  const list = url.searchParams.get('list');
  if (list !== null) {
    const n = Math.min(Math.max(parseInt(list, 10) || 25, 1), 200);
    const samples = DEMO_BEHAVIOR_SAMPLES.slice(0, n);
    return { samples, count: samples.length };
  }
  return {
    recorder_enabled: true,
    dir: '.dashclaw/behavior-samples',
    sample_count: 23,
    agent_count: 3,
    agents: [
      { agent_id: 'clawdbot', count: 14 },
      { agent_id: 'deploy-runner', count: 6 },
      { agent_id: 'data-pipeline', count: 3 },
    ],
    oldest_ts: '2026-06-01T00:00:00.000Z',
    newest_ts: '2026-06-07T09:00:00.000Z',
    by_day: { '2026-06-07': 11, '2026-06-06': 12 },
    ready: true,
    min_samples: 8,
  };
}

export function demoBehaviorSuggestions(_fixtures: DemoFixtures) {
  const suggestions = [
    { id: 'sug_demo_1', type: 'destructive_command_approval', agent_id: 'deploy-runner', severity: 'high', confidence: 88, enforceable: true, advisory: false, false_positive_risk: 'low', target: 'deploy-runner', expected_effect: 'Route destructive shell commands (rm -rf, git push --force) to human approval.', matching_sample_size: 6, sample_size: 9, evidence_examples: [{ event_id: 'bse_demo_1', command_shape: 'git push --force <path>', outcome_status: 'completed', risk_score: 80 }], rule: { action: 'require_approval', risk_threshold: 70 } },
    { id: 'sug_demo_2', type: 'protected_path_approval', agent_id: 'clawdbot', severity: 'medium', confidence: 74, enforceable: true, advisory: false, false_positive_risk: 'medium', target: 'clawdbot', expected_effect: 'Require approval before writing to protected config paths (.env, config/**).', matching_sample_size: 4, sample_size: 14, evidence_examples: [{ event_id: 'bse_demo_2', write_path: '.env', outcome_status: 'completed', risk_score: 60 }], rule: { action: 'require_approval', paths: ['.env', 'config/**'] } },
  ];
  const agents = [
    { agent_id: 'clawdbot', sample_size: 14, destructive_commands: 2, protected_touches: 4, failed: 1, models: ['claude-opus-4-8'], safe_envelope: { tools: ['Read', 'Grep', 'Edit'] }, last_ts: '2026-06-07T09:00:00.000Z' },
    { agent_id: 'deploy-runner', sample_size: 9, destructive_commands: 6, protected_touches: 0, failed: 2, models: ['claude-sonnet-4-6'], safe_envelope: { tools: ['Bash'] }, last_ts: '2026-06-06T18:00:00.000Z' },
  ];
  return { suggestions, agents, sample_count: 23 };
}

// ── Agent Registry (demo) ────────────────────────────────────────────────────
// Canned registry so the hosted demo shows the page populated instead of the
// 403-fallback empty state. One realistic provider + capability + history.

const DEMO_REGISTRY_AGENT: AnyRecord = {
  entry_id: 'ra_demo_001',
  name: 'Acme Enrichment API',
  slug: 'acme-enrichment-api',
  endpoint: 'https://api.acme.example',
  auth_type: 'bearer',
  risk_class: 'medium',
  default_budget_usd: 2,
  status: 'active',
  created_at: '2026-06-01T12:00:00.000Z',
  updated_at: '2026-06-07T09:00:00.000Z',
};

const DEMO_REGISTRY_CAPABILITIES: AnyRecord[] = [
  { capability_id: 'cap_demo_enrich', name: 'enrich_company', risk_level: 'medium' },
];

const DEMO_REGISTRY_INVOCATIONS: AnyRecord[] = [
  { id: 'inv_demo_1', action_id: 'ar_demo_invoke_001', capability_id: 'cap_demo_enrich', caller_agent_id: 'clawdbot', created_at: '2026-06-07T08:55:00.000Z' },
  { id: 'inv_demo_2', action_id: 'ar_demo_invoke_002', capability_id: 'cap_demo_enrich', caller_agent_id: 'deploy-runner', created_at: '2026-06-06T17:20:00.000Z' },
];

export function demoRegistryList(url: URL) {
  const status = url.searchParams.get('status');
  const agents = status && DEMO_REGISTRY_AGENT.status !== status ? [] : [DEMO_REGISTRY_AGENT];
  return { registered_agents: agents };
}

export function demoRegistryDetail() {
  return {
    registered_agent: DEMO_REGISTRY_AGENT,
    capabilities: DEMO_REGISTRY_CAPABILITIES,
    invocations: DEMO_REGISTRY_INVOCATIONS,
  };
}

export function demoRegistryCapabilities() {
  return { capabilities: DEMO_REGISTRY_CAPABILITIES };
}

export function demoRegistryInvoke() {
  return {
    success: true,
    action_id: 'ar_demo_invoke_001',
    result: { enriched: true, company: 'Acme Corp', confidence: 0.92 },
  };
}

// ── Work Orders (demo) ────────────────────────────────────────────────────────

const DEMO_WORK_ORDER_TYPES = [
  {
    id: 'wot_demo_1', type: 'research_brief', version: '1.0', status: 'active',
    display_name: 'Research Brief', description: 'Structured research synthesis: topic in, sourced findings out.',
    default_max_cost_usd: '0.50', default_timeout_seconds: 600,
    input_schema: { type: 'object', required: ['topic'], properties: { topic: { type: 'string' } } },
    output_schema: { type: 'object', required: ['title', 'summary', 'findings'], properties: { title: { type: 'string' }, summary: { type: 'string' }, findings: { type: 'array', items: { type: 'string' } } } },
    created_at: '2026-06-01T12:00:00.000Z', updated_at: '2026-06-01T12:00:00.000Z',
  },
];

const DEMO_WORK_ORDERS = [
  {
    id: 'wo_demo_completed', type: 'research_brief', type_version: '1.0', status: 'completed',
    input: { topic: 'Agent-to-agent payment protocols' }, input_hash: 'sha256:demo-input',
    max_cost_usd: '0.25', timeout_seconds: 600, requested_by: 'orchestrator-1', claimed_by: 'research-worker-1',
    guard_decision: { decision: 'allow', decision_id: 'act_gd_demo1', risk_score: 12, matched_policies: [] },
    created_at: '2026-06-10T14:00:00.000Z', claimed_at: '2026-06-10T14:00:04.000Z', completed_at: '2026-06-10T14:02:31.000Z',
  },
  {
    id: 'wo_demo_pending', type: 'research_brief', type_version: '1.0', status: 'pending_approval',
    input: { topic: 'Production deploy risk assessment' }, input_hash: 'sha256:demo-input-2',
    max_cost_usd: '5.00', timeout_seconds: 1200, requested_by: 'orchestrator-1', claimed_by: null,
    guard_decision: { decision: 'require_approval', decision_id: 'act_gd_demo2', risk_score: 72, matched_policies: ['spend-ceiling'] },
    created_at: '2026-06-11T09:30:00.000Z', claimed_at: null, completed_at: null,
  },
  {
    id: 'wo_demo_queued', type: 'research_brief', type_version: '1.0', status: 'queued',
    input: { topic: 'Competitor receipt formats' }, input_hash: 'sha256:demo-input-3',
    max_cost_usd: '0.40', timeout_seconds: 600, requested_by: 'orchestrator-2', claimed_by: null,
    guard_decision: { decision: 'allow', decision_id: 'act_gd_demo3', risk_score: 8, matched_policies: [] },
    created_at: '2026-06-11T10:10:00.000Z', claimed_at: null, completed_at: null,
  },
];

const DEMO_WORK_ORDER_RECEIPT = {
  receipt: {
    receipt_version: '1.0', work_order_id: 'wo_demo_completed', type: 'research_brief', type_version: '1.0',
    status: 'completed', input_hash: 'sha256:demo-input', output_hash: 'sha256:demo-output',
    budget: { max_cost_usd: 0.25, timeout_seconds: 600 },
    cost: { input_tokens: 4200, output_tokens: 1800, total_usd: 0.11 },
    over_budget: false, worker: 'research-worker-1', requested_by: 'orchestrator-1',
    lifecycle: { created_at: '2026-06-10T14:00:00.000Z', claimed_at: '2026-06-10T14:00:04.000Z', completed_at: '2026-06-10T14:02:31.000Z' },
    error: null,
    governance: { mode: 'governed', guard_decision_id: 'act_gd_demo1', audit_record_id: 'act_demo_audit', matched_policies: [] },
  },
  receipt_hash: 'sha256:demo-receipt-hash',
};

export function demoListWorkOrders(url: URL) {
  const status = url.searchParams.get('status') || undefined;
  const type = url.searchParams.get('type') || undefined;
  const agent = url.searchParams.get('agent') || undefined;
  let items = [...DEMO_WORK_ORDERS];
  if (status) items = items.filter((o) => o.status === status);
  if (type) items = items.filter((o) => o.type === type);
  if (agent) items = items.filter((o) => o.requested_by === agent || o.claimed_by === agent);
  return { work_orders: items, total: items.length };
}

export function demoGetWorkOrder(workOrderId: string) {
  const order = DEMO_WORK_ORDERS.find((o) => o.id === workOrderId) || null;
  if (!order) return { error: 'work_order_not_found', code: 'work_order_not_found' };
  return { work_order: order, receipt: order.status === 'completed' ? DEMO_WORK_ORDER_RECEIPT : null };
}

export function demoListWorkOrderTypes() {
  return { types: DEMO_WORK_ORDER_TYPES, total: DEMO_WORK_ORDER_TYPES.length };
}
