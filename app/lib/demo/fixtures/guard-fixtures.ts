import { lcg, pick, int, isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

const rnd = lcg(0x60A8D001);

/* ---------- agent pool (realistic + tutorial mix) ---------- */

interface PoolAgent {
  id: string;
  name: string;
}

const agentPool: PoolAgent[] = [
  { id: 'deploy-bot',           name: 'deploy-bot' },
  { id: 'security-scanner',     name: 'security-scanner' },
  { id: 'code-reviewer',        name: 'code-reviewer' },
  { id: 'data-analyst',         name: 'data-analyst' },
  { id: 'migration-assistant',  name: 'migration-assistant' },
  { id: 'test-runner',          name: 'test-runner' },
  { id: 'refactor-agent',       name: 'refactor-agent' },
  { id: 'api-monitor',          name: 'api-monitor' },
  { id: 'release-manager',      name: 'release-manager' },
  { id: 'db-optimizer',         name: 'db-optimizer' },
  { id: 'day-3-guard-policies', name: 'Day 3: Guard Policies' },
  { id: 'day-2-recording-actions', name: 'Day 2: Recording Actions' },
];

const agentIds = agentPool.map((a) => a.id);

/* ---------- 6 guard policies ---------- */

interface GuardPolicy {
  id: string;
  org_id: string;
  name: string;
  type: string;
  config: string;
  active: boolean;
  description?: string;
  created_at: string;
}

const policies: GuardPolicy[] = [
  {
    id: stableId('pol_demo', 0),
    org_id: DEMO_ORG,
    name: 'PRODUCTION_DATA_PROTECTION',
    type: 'risk_threshold',
    config: JSON.stringify({ threshold: 75, reversible: false, systems: ['customer-data', 'postgres-prod'] }),
    active: true,
    description: 'Irreversible operations on customer data require explicit approval. Blocks any action with risk score > 75.',
    created_at: isoFromNow(45 * MS_DAY),
  },
  {
    id: stableId('pol_demo', 1),
    org_id: DEMO_ORG,
    name: 'High Risk Action Gate',
    type: 'risk_threshold',
    config: JSON.stringify({ threshold: 70 }),
    active: true,
    created_at: isoFromNow(30 * MS_DAY),
  },
  {
    id: stableId('pol_demo', 2),
    org_id: DEMO_ORG,
    name: 'Production Deploy Approval',
    type: 'require_approval',
    config: JSON.stringify({ action_types: ['deploy'], environments: ['production'] }),
    active: true,
    created_at: isoFromNow(28 * MS_DAY),
  },
  {
    id: stableId('pol_demo', 3),
    org_id: DEMO_ORG,
    name: 'Action Rate Limiter',
    type: 'rate_limit',
    config: JSON.stringify({ max_actions: 100, window_minutes: 60 }),
    active: true,
    created_at: isoFromNow(25 * MS_DAY),
  },
  {
    id: stableId('pol_demo', 4),
    org_id: DEMO_ORG,
    name: 'Block Dangerous Operations',
    type: 'block_action_type',
    config: JSON.stringify({ blocked_types: ['delete_database', 'wipe_storage'] }),
    active: true,
    created_at: isoFromNow(22 * MS_DAY),
  },
  {
    id: stableId('pol_demo', 5),
    org_id: DEMO_ORG,
    name: 'Content Safety Filter',
    type: 'semantic_content',
    config: JSON.stringify({ check_content: true, categories: ['pii', 'credentials', 'harmful'] }),
    active: true,
    created_at: isoFromNow(18 * MS_DAY),
  },
  {
    id: stableId('pol_demo', 6),
    org_id: DEMO_ORG,
    name: 'Budget Protection',
    type: 'cost_ceiling',
    config: JSON.stringify({ max_cost_per_action: 1.00, max_daily_cost: 50.00 }),
    active: false,
    created_at: isoFromNow(12 * MS_DAY),
  },
];

const policyIds = policies.map((p) => p.id);

/* ---------- reasoning templates ---------- */

function reasoningFor(decision: string, riskScore: number, agent: PoolAgent, policy: GuardPolicy): string {
  switch (decision) {
    case 'allow':
      return `Action risk score (${riskScore}) is below the threshold (70). No policies matched. Action proceeds normally.`;
    case 'block':
      return `Action type '${pickBlockedType(agent)}' is on the blocklist (policy: ${policy.name}). This action cannot proceed.`;
    case 'warn':
      return `Action risk score (${riskScore}) is approaching the threshold (70). Logged for review but not blocked. Consider lowering risk or adjusting the threshold.`;
    case 'require_approval':
      return `Deploy to production requires human approval (policy: ${policy.name}). Action queued for operator review.`;
    default:
      return 'Decision recorded.';
  }
}

function pickBlockedType(agent: PoolAgent): string {
  const blockedTypes = ['delete_database', 'wipe_storage', 'drop_table', 'purge_logs', 'reset_credentials'];
  const idx = Math.abs(hashStr(agent.id)) % blockedTypes.length;
  // Modulo keeps the index in-bounds for the non-empty array.
  return blockedTypes[idx] as string;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/* ---------- metadata templates ---------- */

function metadataFor(decision: string, riskScore: number, policy: GuardPolicy, agent: PoolAgent): string {
  const base = { evaluated_by: 'guard-engine-v2', policy_type: policy.type, policy_name: policy.name };
  switch (decision) {
    case 'allow':
      return JSON.stringify({ ...base, matched_policies: 0, risk_threshold: 70, actual_risk: riskScore });
    case 'block':
      return JSON.stringify({ ...base, blocked_type: pickBlockedType(agent), enforcement: 'hard_block', escalation: false });
    case 'warn':
      return JSON.stringify({ ...base, risk_threshold: 70, actual_risk: riskScore, margin: 70 - riskScore, review_recommended: true });
    case 'require_approval':
      return JSON.stringify({ ...base, approval_channel: 'ops-team', timeout_minutes: 30, environment: 'production' });
    default:
      return JSON.stringify(base);
  }
}

/* ---------- decision distribution ---------- */

// Target: ~15 allow, ~8 block, ~7 warn, ~5 require_approval = 35 total
const decisionSlots: string[] = [
  ...Array(15).fill('allow'),
  ...Array(8).fill('block'),
  ...Array(7).fill('warn'),
  ...Array(5).fill('require_approval'),
];

// Shuffle using our RNG for deterministic ordering
for (let i = decisionSlots.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [decisionSlots[i], decisionSlots[j]] = [decisionSlots[j] as string, decisionSlots[i] as string];
}

/* ---------- policy selection by decision type ---------- */

function policyForDecision(decision: string): GuardPolicy {
  switch (decision) {
    case 'allow':
      return pick(rnd, policies.filter((p) => p.active));
    case 'block':
      return policies[3] as GuardPolicy; // Block Dangerous Operations
    case 'warn':
      return policies[0] as GuardPolicy; // High Risk Action Gate (risk approaching threshold)
    case 'require_approval':
      return policies[1] as GuardPolicy; // Production Deploy Approval
    default:
      return pick(rnd, policies);
  }
}

/* ---------- risk score ranges by decision ---------- */

function riskScoreForDecision(decision: string): number {
  switch (decision) {
    case 'allow':
      return int(rnd, 10, 45);
    case 'block':
      return int(rnd, 75, 95);
    case 'warn':
      return int(rnd, 55, 69);
    case 'require_approval':
      return int(rnd, 60, 85);
    default:
      return int(rnd, 10, 95);
  }
}

/* ---------- 35 guard decisions spread across 24 hours ---------- */

const guardDecisions = decisionSlots.map((decision, i) => {
  const agent = pick(rnd, agentPool);
  const policy = policyForDecision(decision);
  const riskScore = riskScoreForDecision(decision);
  // Spread across 24 hours: each slot gets roughly 24/35 ~= 0.69 hours apart
  const hoursAgo = ((35 - i) / 35) * 24;

  return {
    id: stableId('gd_demo', i + 1),
    org_id: DEMO_ORG,
    action_id: stableId('act_real', int(rnd, 1, 120)),
    agent_id: agent.id,
    agent_name: agent.name,
    policy_id: policy.id,
    decision,
    risk_score: riskScore,
    reasoning: reasoningFor(decision, riskScore, agent, policy),
    metadata: metadataFor(decision, riskScore, policy, agent),
    created_at: isoFromNow(hoursAgo * MS_HOUR),
  };
});

export { policies, guardDecisions };
