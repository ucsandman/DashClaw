import { lcg, pick, int, isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

const rnd = lcg(0xBAC00001);

const agentDefs = [
  { id: 'cache-manager',     name: 'cache-manager' },
  { id: 'backup-agent',      name: 'backup-agent' },
  { id: 'health-checker',    name: 'health-checker' },
  { id: 'cert-rotator',      name: 'cert-rotator' },
  { id: 'cleanup-bot',       name: 'cleanup-bot' },
  { id: 'schema-validator',  name: 'schema-validator' },
  { id: 'alert-dispatcher',  name: 'alert-dispatcher' },
  { id: 'quota-monitor',     name: 'quota-monitor' },
  { id: 'env-sync',          name: 'env-sync' },
  { id: 'audit-logger',      name: 'audit-logger' },
];

const agents = agentDefs.map(({ id, name }) => ({
  agent_id: id,
  agent_name: name,
}));

const actionTypePool = ['monitor', 'sync', 'fix', 'review', 'deploy'];
const goalPool = ['routine check', 'scheduled maintenance', 'periodic sync', 'health verification'];
const reasoningPool = ['Scheduled task.', 'Automated maintenance.', 'Periodic check.'];
const scopePool = ['read-only', 'staging'];
const triggerPool = ['schedule', 'signal'];
const systemPool = ['infra', 'data', 'ops', 'security'];
const outputPool = ['OK', 'Clean', 'Synced', 'Verified'];

let actionIndex = 0;
const actions: Record<string, unknown>[] = [];

for (const agent of agents) {
  const actionCount = int(rnd, 2, 4);
  for (let j = 0; j < actionCount; j++) {
    actionIndex++;
    const action_type = pick(rnd, actionTypePool);
    const status = pick(rnd, ['completed', 'completed', 'completed', 'running']);
    const minutesAgo = int(rnd, 10, 1400);
    const timestamp_start = isoFromNow(minutesAgo * 60 * 1000);
    const durationMs = int(rnd, 1_000, 120_000);
    const timestamp_end = status === 'completed'
      ? isoFromNow((minutesAgo * 60 * 1000) - durationMs)
      : null;

    actions.push({
      org_id: DEMO_ORG,
      action_id: stableId('act_bg', actionIndex),
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      swarm_id: null,
      parent_action_id: null,
      action_type,
      declared_goal: `${action_type}: ${pick(rnd, goalPool)}`,
      reasoning: pick(rnd, reasoningPool),
      authorization_scope: pick(rnd, scopePool),
      trigger: pick(rnd, triggerPool),
      systems_touched: JSON.stringify([pick(rnd, systemPool)]),
      input_summary: null,
      status,
      reversible: 1,
      risk_score: int(rnd, 5, 40),
      confidence: int(rnd, 60, 90),
      recommendation_id: null,
      recommendation_applied: 0,
      recommendation_override_reason: null,
      output_summary: status === 'completed' ? pick(rnd, outputPool) : null,
      side_effects: JSON.stringify([]),
      artifacts_created: JSON.stringify([]),
      error_message: null,
      timestamp_start,
      timestamp_end,
      duration_ms: status === 'completed' ? durationMs : null,
      cost_estimate: Math.round((0.001 + rnd() * 0.02) * 10000) / 10000,
      tokens_in: int(rnd, 50, 500),
      tokens_out: int(rnd, 30, 300),
      signature: null,
      verified: true,
    });
  }
}

export { agents, actions };
