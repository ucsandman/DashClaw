import { lcg, pick, int, isoFromNow, isoInFuture, stableId, DEMO_ORG, BASE_NOW, MS_MINUTE, MS_HOUR, MS_DAY } from './fixtures/shared-utils';
import { agents as journeyAgents, actions as journeyActions } from './fixtures/journey-agents';
import { agents as featureAgents, actions as featureActions } from './fixtures/feature-agents';
import { agents as personaAgents, actions as personaActions } from './fixtures/persona-agents';
import { agents as realisticAgents, actions as realisticActions } from './fixtures/realistic-agents';
import { agents as backgroundAgents, actions as backgroundActions } from './fixtures/background-agents';
import { assumptions as tutorialAssumptions } from './fixtures/tutorial-assumptions';
import { policies as guardPolicies, guardDecisions as guardDecisionsData } from './fixtures/guard-fixtures';
import { complianceData } from './fixtures/compliance-fixtures';

// No module-level cache: returning the same object by reference let
// mutating callers (e.g. demoCreateAction) permanently alter the
// fixtures for the lifetime of the process, causing unbounded growth
// and cross-request corruption under concurrent demo traffic. The
// LCG-seeded builder is deterministic and cheap, so building fresh on
// each call gives every caller their own isolated copy.

function buildFixtures(): Record<string, unknown> {
  const rnd = lcg(0xD15C1A57);

  // ── Governance Core: Agents and Actions ──
  const agents = [
    ...journeyAgents,
    ...featureAgents,
    ...personaAgents,
    ...realisticAgents,
    ...backgroundAgents,
  ];

  const actions = [
    ...journeyActions,
    ...featureActions,
    ...personaActions,
    ...realisticActions,
    ...backgroundActions,
  ];

  // ── Governance Primitives: Assumptions ──
  const assumptions = tutorialAssumptions;

  // ── Governance Decisions ──
  const decisions = Array.from({ length: 18 }).map((_, i) => {
    const agent = pick(rnd, agents);
    const outcome = pick(rnd, ['success', 'failure', 'pending']);
    const minutesAgo = 30 + i * 17;
    return {
      id: stableId('dec_demo', i + 1),
      org_id: DEMO_ORG,
      agent_id: agent.agent_id,
      decision: pick(rnd, [
        'Require pairing approvals for verified agents.',
        'Throttle risky actions behind HITL.',
        'Prefer read-only scopes for integrations by default.',
        'Policy block: risk score exceeded threshold.',
        'Decision allowed: context verified by operator.',
      ]),
      context: pick(rnd, [
        'Production environment access requested.',
        'High risk score detected (85).',
        'Auditability is mandatory for this scope.',
        '',
      ]),
      reasoning: null,
      outcome,
      confidence: int(rnd, 45, 95),
      timestamp: isoFromNow(minutesAgo * 60 * 1000),
      tags: pick(rnd, ['security', 'governance', 'reliability', 'compliance']),
    };
  });

  // ── Governance Lessons ──
  const lessons = Array.from({ length: 10 }).map((_, i) => ({
    id: stableId('les_demo', i + 1),
    org_id: DEMO_ORG,
    lesson: pick(rnd, [
      'Pairing beats manual key upload for beginners.',
      'Bulk approvals are essential for 50+ agents.',
      'Explicit risk scoring prevents autonomy spikes.',
      'Decision evidence must be immutable.',
    ]),
    confidence: int(rnd, 65, 96),
    times_validated: int(rnd, 0, 12),
    source_decisions: null,
    timestamp: isoFromNow((12 + i * 29) * 60 * 1000),
  }));

  // ── PRUNED: Tier 4 Legacy Arrays ──
  const goals: unknown[] = [];
  const contacts: unknown[] = [];
  const interactions: unknown[] = [];
  const events: unknown[] = [];
  const ideas: unknown[] = [];
  const tokenHistory: unknown[] = [];
  const tokensCurrent = null;
  const tokensToday = { estimatedCost: 0 };
  const content: unknown[] = [];
  const contextPoints: unknown[] = [];
  const contextThreads: unknown[] = [];
  const contextEntries: unknown[] = [];
  const snippets: unknown[] = [];
  const preferences = { preferences: [], recent_moods: [], top_approaches: [] };
  const executions: unknown[] = [];
  const schedules: unknown[] = [];
  const webhooks: unknown[] = [];
  const webhookDeliveries = {};
  const activityLogs: unknown[] = [];

  // ── Governance Setup and Infrastructure ──
  const policies = guardPolicies;
  const guardDecisions = guardDecisionsData;

  const teamOrg = {
    id: DEMO_ORG,
    name: 'Demo Governance Workspace',
    plan: 'open_source',
    created_at: isoFromNow(60 * 24 * 60 * 60 * 1000),
  };

  const teamMembers = [
    { id: 'demo_user', org_id: DEMO_ORG, email: 'viewer@example.com', name: 'Demo Viewer', image: null, role: 'admin', created_at: isoFromNow(60 * 24 * 60 * 60 * 1000) },
  ];

  const teamInvites: unknown[] = [];

  const usage = {
    actions_count: 220,
    agents_count: agents.length,
    members_count: teamMembers.length,
    keys_count: 1,
  };

  const settings = [
    { org_id: DEMO_ORG, key: 'demo_mode', value: 'true', encrypted: 0 },
    { org_id: DEMO_ORG, key: 'governance_runtime', value: 'v2', encrypted: 0 },
  ];

  const memory = {
    health: { score: 92, status: 'healthy', issues: [] },
    entities: [
      { name: 'DashClaw v2', type: 'system', mentions: 45 },
      { name: 'Guard Policy', type: 'concept', mentions: 32 },
      { name: 'Evidence Ledger', type: 'concept', mentions: 28 },
    ],
    topics: ['governance', 'security', 'compliance', 'reliability'],
  };

  const recommendations = Array.from({ length: 6 }).map((_, i) => ({
    id: stableId('lrec', i + 1),
    org_id: DEMO_ORG,
    action_type: pick(rnd, ['deploy', 'security', 'monitor']),
    recommendation: pick(rnd, [
      'Increase risk score for prod deploys.',
      'Require approval for all security scans.',
      'Enable read-only enforcement for this agent.',
    ]),
    basis: 'Observed variance in manual risk scoring.',
    confidence: int(rnd, 70, 95),
    active: true,
    created_at: isoFromNow(int(rnd, 1, 10) * 24 * MS_HOUR),
  }));

  const metrics: unknown[] = [];
  const metricsSummary = {
    total_actions: 220,
    avg_risk: 42,
    blocks_count: 12,
    approvals_count: 8,
  };

  const securityStatus = {
    active_signals: 4,
    high_risk_actions: 12,
    unscoped_actions: 8,
    invalid_assumptions: 2,
  };

  const decisionMetrics = {
    total: 142,
    completed: 118,
    failed: 12,
    cancelled: 6,
    approval: 6,
    change_percent: 18,
  };

  const signals = [
    { severity: 'red', type: 'autonomy_spike', agent_id: 'deploy-bot', created_at: isoFromNow(MS_HOUR) },
    { severity: 'amber', type: 'stale_action', agent_id: 'security-scanner', created_at: isoFromNow(2 * MS_HOUR) },
  ];

  const routingHealth = { status: 'healthy' };
  const routingStats = { total_tasks: 0, completed: 0, pending: 0 };
  const routingAgents: unknown[] = [];
  const routingTasks: unknown[] = [];

  const complianceFrameworks = complianceData.frameworks;
  const complianceMap = complianceData.map;
  const complianceGaps = complianceData.gaps;
  const complianceEvidence = complianceData.evidence;

  const policyTestResults = { passed: 12, failed: 0 };
  const policyProofReport = { org_id: DEMO_ORG, status: 'valid', verified_at: isoFromNow(0) };

  const feedbackEntries: unknown[] = [];
  const feedbackStats = { total_entries: 0, avg_sentiment: 0 };

  return {
    agents,
    actions,
    assumptions,
    decisions,
    lessons,
    goals,
    contacts,
    interactions,
    events,
    ideas,
    tokenHistory,
    tokensCurrent,
    tokensToday,
    content,
    policies,
    guardDecisions,
    contextPoints,
    contextThreads,
    contextEntries,
    snippets,
    preferences,
    executions,
    schedules,
    webhooks,
    webhookDeliveries,
    activityLogs,
    teamOrg,
    teamMembers,
    teamInvites,
    usage,
    settings,
    memory,
    signals,
    decisionMetrics,
    recommendations,
    metrics,
    metricsSummary,
    securityStatus,
    routingHealth,
    routingStats,
    routingAgents,
    routingTasks,
    complianceFrameworks,
    complianceMap,
    complianceGaps,
    complianceEvidence,
    policyTestResults,
    policyProofReport,
    feedbackEntries,
    feedbackStats,
  };
}

export function getDemoFixtures(): Record<string, unknown> {
  return buildFixtures();
}
