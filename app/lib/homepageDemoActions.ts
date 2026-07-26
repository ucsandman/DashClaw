/**
 * Shared definition of the three governance scenarios shown on the
 * marketing home page LiveDemo (app/components/LiveDemo.js). The
 * /decisions ledger page prepends these as the first three entries in
 * demo mode so visitors who clicked through the home page see the
 * exact same scenarios in the dashboard, word-for-word.
 *
 * The "Deploy to production" entry reflects the visitor's local
 * Approve / Deny click on the home page. The resolution lives in
 * localStorage keyed by HOMEPAGE_RESOLUTION_KEY.
 */

export const HOMEPAGE_RESOLUTION_KEY = 'dashclaw:demo:homepage-resolution';

export interface HomepagePreset {
  id: 'allow' | 'review' | 'block';
  label: string;
  agentId: string;
  actionType: string;
  riskScore: number;
  declaredGoal: string;
}

export type HomepageResolution = 'allow' | 'deny' | null;

export interface HomepageDemoAction {
  action_id: string;
  org_id: string;
  agent_id: string;
  agent_name: string;
  action_type: string;
  declared_goal: string;
  reasoning: string;
  authorization_scope: string;
  status: string;
  outcome_status: string;
  risk_score: number;
  confidence: number;
  reversible: number;
  verified: boolean;
  cost_estimate: number;
  tokens_in: number;
  tokens_out: number;
  duration_ms: number;
  output_summary: string;
  timestamp_start: string;
  timestamp_end: string | null;
  error_message?: string | null;
  _homepage_demo: boolean;
}

// Match LiveDemo PRESETS exactly. If you edit one side, edit both.
// These agentIds are pinned in SYNTHETIC_AGENT_LIKE_PATTERNS / _RE
// (app/lib/calibration-mining.js): on session-authenticated instances the
// demo writes real guard rows, and analytics must not count them as agent
// traffic. Renaming a preset id here requires adding the new id there.
export const HOMEPAGE_PRESETS: HomepagePreset[] = [
  {
    id: 'allow',
    label: 'Sync user metrics',
    agentId: 'analytics-agent',
    actionType: 'sync_metrics',
    riskScore: 25,
    declaredGoal:
      'Sync hourly product metrics from the warehouse to the analytics dashboard.',
  },
  {
    id: 'review',
    label: 'Deploy to production',
    agentId: 'openai-deployer-1',
    actionType: 'deploy',
    riskScore: 85,
    declaredGoal:
      'Deploy auth-service v2.1 to production with new session token rotation.',
  },
  {
    id: 'block',
    label: 'Drop production users table',
    agentId: 'rogue-agent',
    actionType: 'delete_database',
    riskScore: 92,
    declaredGoal:
      'Drop the production users table to free storage on the primary cluster.',
  },
];

const STABLE_ACTION_IDS = {
  allow: 'act_demo_home_sync_001',
  review: 'act_demo_home_deploy_001',
  block: 'act_demo_home_block_001',
};

/**
 * Returns one fully-formed action object per homepage preset, shaped
 * to match the /api/actions response and ready to drop straight into
 * the decisions ledger renderer.
 *
 * @param resolution
 *   The visitor's local choice on the require_approval card.
 *   - null: pending_approval
 *   - 'allow': completed (the approver let it through)
 *   - 'deny': cancelled (the approver blocked it)
 */
export function getHomepageDemoActions(resolution: HomepageResolution): HomepageDemoAction[] {
  const now = Date.now();
  const minute = 60_000;

  const allow = HOMEPAGE_PRESETS[0] as HomepagePreset;
  const review = HOMEPAGE_PRESETS[1] as HomepagePreset;
  const block = HOMEPAGE_PRESETS[2] as HomepagePreset;

  let reviewStatus = 'pending_approval';
  let reviewOutcome = 'pending';
  let reviewOutputSummary =
    'Awaiting human approval. The agent is paused on the production_deploy policy.';
  let reviewErrorMessage: string | null = null;
  if (resolution === 'allow') {
    reviewStatus = 'completed';
    reviewOutcome = 'completed';
    reviewOutputSummary =
      'Approved by you on the home page. Action would unblock the agent within about a second and the approval would be recorded in the audit trail.';
    reviewErrorMessage = null;
  } else if (resolution === 'deny') {
    reviewStatus = 'cancelled';
    reviewOutcome = 'failed';
    reviewOutputSummary =
      'Denied by you on the home page. The agent received ApprovalDeniedError and did not touch the real system.';
    reviewErrorMessage = 'Operator denied the action via the home page demo.';
  }

  return [
    {
      action_id: STABLE_ACTION_IDS.allow,
      org_id: 'org_demo',
      agent_id: allow.agentId,
      agent_name: allow.agentId,
      action_type: allow.actionType,
      declared_goal: allow.declaredGoal,
      reasoning:
        'Routine hourly sync. Below the risk threshold and reversible, no human review required.',
      authorization_scope: 'warehouse-read, dashboard-write',
      status: 'completed',
      outcome_status: 'completed',
      risk_score: allow.riskScore,
      confidence: 100,
      reversible: 1,
      verified: true,
      cost_estimate: 0,
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: 1200,
      output_summary: 'Synced 4 metric tables to the analytics dashboard.',
      timestamp_start: new Date(now - 3 * minute).toISOString(),
      timestamp_end: new Date(now - 3 * minute + 1200).toISOString(),
      _homepage_demo: true,
    },
    {
      action_id: STABLE_ACTION_IDS.review,
      org_id: 'org_demo',
      agent_id: review.agentId,
      agent_name: review.agentId,
      action_type: review.actionType,
      declared_goal: review.declaredGoal,
      reasoning:
        'High-risk production action. [Demo fixture] Production Guard policy requires explicit human approval before the deploy command is executed.',
      authorization_scope: 'ci-pipeline, production-deploy',
      status: reviewStatus,
      outcome_status: reviewOutcome,
      risk_score: review.riskScore,
      confidence: 92,
      reversible: 0,
      verified: true,
      cost_estimate: 0,
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: resolution == null ? 0 : 2400,
      output_summary: reviewOutputSummary,
      error_message: reviewErrorMessage,
      timestamp_start: new Date(now - 2 * minute).toISOString(),
      timestamp_end:
        resolution == null ? null : new Date(now - 2 * minute + 2400).toISOString(),
      _homepage_demo: true,
    },
    {
      action_id: STABLE_ACTION_IDS.block,
      org_id: 'org_demo',
      agent_id: block.agentId,
      agent_name: block.agentId,
      action_type: block.actionType,
      declared_goal: block.declaredGoal,
      reasoning:
        'Irreversible destructive action on customer data. Risk score 92 exceeds the org threshold of 75 and matches PRODUCTION_DATA_PROTECTION.',
      authorization_scope: 'denied',
      status: 'blocked',
      outcome_status: 'failed',
      risk_score: block.riskScore,
      confidence: 100,
      reversible: 0,
      verified: true,
      cost_estimate: 0,
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: 180,
      output_summary:
        'Blocked by [Demo fixture] Production Guard. Irreversible delete on production data requires explicit approval.',
      error_message:
        'Blocked by policy PRODUCTION_DATA_PROTECTION. Irreversible operation on customer data requires explicit approval.',
      timestamp_start: new Date(now - 1 * minute).toISOString(),
      timestamp_end: new Date(now - 1 * minute + 180).toISOString(),
      _homepage_demo: true,
    },
  ];
}

/**
 * Read the visitor's last homepage Approve / Deny click. Returns
 * 'allow' | 'deny' | null. Safe to call from server-rendered code
 * (returns null when window is unavailable).
 */
export function readHomepageResolution(): HomepageResolution {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(HOMEPAGE_RESOLUTION_KEY);
    if (value === 'allow' || value === 'deny') return value;
  } catch {
    // localStorage may be blocked (Safari private mode, etc).
  }
  return null;
}

/**
 * Persist the visitor's homepage Approve / Deny click. No-op outside
 * the browser or when storage is unavailable.
 */
export function writeHomepageResolution(value: HomepageResolution): void {
  if (typeof window === 'undefined') return;
  if (value !== 'allow' && value !== 'deny') return;
  try {
    window.localStorage.setItem(HOMEPAGE_RESOLUTION_KEY, value);
  } catch {
    // ignore
  }
}
