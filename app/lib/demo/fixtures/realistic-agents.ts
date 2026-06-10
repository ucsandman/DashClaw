import { lcg, pick, int, isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

const rnd = lcg(0xBEA10001);

const agentDefs = [
  { id: 'deploy-bot', name: 'deploy-bot' },
  { id: 'code-reviewer', name: 'code-reviewer' },
  { id: 'security-scanner', name: 'security-scanner' },
  { id: 'docs-writer', name: 'docs-writer' },
  { id: 'test-runner', name: 'test-runner' },
  { id: 'data-analyst', name: 'data-analyst' },
  { id: 'refactor-agent', name: 'refactor-agent' },
  { id: 'migration-assistant', name: 'migration-assistant' },
  { id: 'api-monitor', name: 'api-monitor' },
  { id: 'dependency-checker', name: 'dependency-checker' },
  { id: 'perf-profiler', name: 'perf-profiler' },
  { id: 'release-manager', name: 'release-manager' },
  { id: 'db-optimizer', name: 'db-optimizer' },
  { id: 'log-analyzer', name: 'log-analyzer' },
  { id: 'config-validator', name: 'config-validator' },
];

const actionTypes = ['deploy', 'research', 'security', 'message', 'build', 'review', 'monitor', 'fix', 'sync', 'test'];
const statuses = ['completed', 'running', 'failed', 'pending', 'pending_approval', 'cancelled'];
const systems = ['api', 'payments', 'auth', 'infra', 'docs', 'frontend', 'data', 'security', 'ops'];
const goals = ['stability', 'latency', 'release', 'audit', 'rollout', 'alerting', 'handoff', 'migration'];
const reasons = [
  'Routine maintenance window.',
  'Triggered by anomaly detection signal.',
  'Requested by operator for reliability.',
  'Rolling out a safe incremental change.',
  'Investigating elevated error rate.',
];
const scopes = ['read-only', 'staging', 'limited-prod', 'dry-run'];
const triggers = ['schedule', 'signal', 'operator', 'handoff'];
const outputSummaries = ['OK', 'Deployed', 'Patched', 'Verified', 'Completed'];
const errorMessages = ['Timeout', 'Permission denied', 'Dependency failure'];

const agents = agentDefs.map((def) => ({
  org_id: DEMO_ORG,
  agent_id: def.id,
  agent_name: def.name,
}));

let actionCounter = 0;
const actions: Record<string, unknown>[] = [];

for (const agent of agentDefs) {
  const count = int(rnd, 6, 10);
  for (let i = 0; i < count; i++) {
    actionCounter++;
    const action_type = pick(rnd, actionTypes);
    const system = pick(rnd, systems);
    const risk = int(rnd, 5, 99);

    // First 4 actions globally are forced to pending_approval
    let status;
    if (actionCounter <= 4) {
      status = 'pending_approval';
    } else {
      status = pick(rnd, statuses);
    }

    const timestamp_start_ago = int(rnd, 1, 72) * MS_HOUR + int(rnd, 0, 59) * 60000;
    const duration_ms = int(rnd, 800, 180000);
    const timestamp_start = isoFromNow(timestamp_start_ago);
    const timestamp_end = (status === 'completed' || status === 'failed')
      ? isoFromNow(timestamp_start_ago - duration_ms)
      : null;

    actions.push({
      org_id: DEMO_ORG,
      action_id: stableId('act_real', actionCounter),
      agent_id: agent.id,
      agent_name: agent.name,
      swarm_id: null,
      parent_action_id: null,
      action_type,
      declared_goal: `${action_type.toUpperCase()}: ${system} ${pick(rnd, goals)}`,
      reasoning: pick(rnd, reasons),
      authorization_scope: risk >= 70 ? null : pick(rnd, scopes),
      trigger: pick(rnd, triggers),
      systems_touched: JSON.stringify([system]),
      input_summary: null,
      status,
      reversible: risk >= 85 ? 0 : 1,
      risk_score: risk,
      confidence: int(rnd, 40, 95),
      recommendation_id: rnd() > 0.7 ? stableId('lrec', int(rnd, 1, 12)) : null,
      recommendation_applied: rnd() > 0.65 ? 1 : 0,
      recommendation_override_reason: null,
      output_summary: status === 'completed' ? pick(rnd, outputSummaries) : null,
      side_effects: JSON.stringify(rnd() > 0.8 ? ['cache_invalidation', 'restart_service'] : []),
      artifacts_created: JSON.stringify(rnd() > 0.85 ? ['report.md', 'trace.json'] : []),
      error_message: status === 'failed' ? pick(rnd, errorMessages) : null,
      timestamp_start,
      timestamp_end,
      duration_ms,
      cost_estimate: Math.round((0.005 + rnd() * 0.35) * 10000) / 10000,
      tokens_in: int(rnd, 120, 2500),
      tokens_out: int(rnd, 60, 1800),
      signature: null,
      verified: rnd() > 0.25,
    });
  }
}

export { agents, actions };
