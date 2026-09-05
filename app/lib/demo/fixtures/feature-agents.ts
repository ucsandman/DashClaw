import { lcg, pick, int, isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

const rnd = lcg(0xFEA00001);

/* ------------------------------------------------------------------ */
/*  Agent definitions – 9 feature deep-dive tutorial agents           */
/* ------------------------------------------------------------------ */

interface AgentDef {
  id: string;
  name: string;
}

interface AgentStep {
  declared_goal: string;
  reasoning: string;
  output_summary: string;
  risk_score: number;
}

const agentDefs: AgentDef[] = [
  // Actions area
  { id: 'actions-basics',          name: 'Tutorial: Action Basics' },
  { id: 'actions-risk-scoring',    name: 'Tutorial: Risk Scoring' },
  // Guard area
  { id: 'guard-policies',          name: 'Tutorial: Guard Policies' },
  { id: 'guard-decisions',         name: 'Tutorial: Guard Decisions' },
  { id: 'guard-semantic-rules',    name: 'Tutorial: Semantic Guard Rules' },
  // Security area
  { id: 'security-signals',        name: 'Tutorial: Security Signals' },
  { id: 'security-agent-pairing',  name: 'Tutorial: Agent Pairing' },
  { id: 'security-signatures',     name: 'Tutorial: Agent Signatures' },
  // Automation area
  { id: 'webhooks-setup',          name: 'Tutorial: Webhooks' },
];

const agents = agentDefs.map(d => ({
  agent_id: d.id,
  agent_name: d.name,
}));

/* ------------------------------------------------------------------ */
/*  Per-agent action step definitions                                 */
/* ------------------------------------------------------------------ */

const stepsByAgent: Record<string, AgentStep[]> = {
  /* ── Actions area ─────────────────────────────────────────────── */
  'actions-basics': [
    {
      declared_goal: 'Understand what an action is and when it gets recorded',
      reasoning: 'Actions are the atomic unit of agent observability in DashClaw',
      output_summary: 'An action represents a single decision or operation performed by an agent. Every action is recorded with an action_type (deploy, research, security, etc.), a declared_goal describing intent, and a risk_score from 0-100. Actions are the foundation of all DashClaw tracking.',
      risk_score: 5,
    },
    {
      declared_goal: 'Learn the core action fields: action_type, declared_goal, and risk_score',
      reasoning: 'These three fields are required on every action and drive guard evaluation',
      output_summary: 'action_type categorizes the operation (deploy, research, build, review, etc.). declared_goal is a human-readable string explaining intent. risk_score is a 0-100 integer reflecting potential impact. Together these fields let the guard evaluate whether to allow, block, or escalate.',
      risk_score: 8,
    },
    {
      declared_goal: 'Create an action using the Node SDK',
      reasoning: 'The SDK is the primary way agents record actions programmatically',
      output_summary: 'Use dc.createAction({ action_type: "deploy", declared_goal: "Release v2.1 to staging", risk_score: 35, systems_touched: ["api"], authorization_scope: "staging" }). The response includes the action_id, guard decision, and timestamp. Store the action_id to update status later.',
      risk_score: 10,
    },
    {
      declared_goal: 'List and filter actions using query parameters',
      reasoning: 'Operators need to find specific actions quickly across large histories',
      output_summary: 'GET /api/actions supports filtering by agent_id, action_type, status, and date range. Use dc.listActions({ agent_id: "my-agent", status: "completed", limit: 50 }). Results are sorted by timestamp_start descending. Pagination uses cursor-based offsets.',
      risk_score: 5,
    },
  ],

  'actions-risk-scoring': [
    {
      declared_goal: 'Understand the 0-100 risk scoring scale',
      reasoning: 'Risk scores drive guard decisions and operator alerting',
      output_summary: 'Risk scores range from 0 (no-op, read-only) to 100 (irreversible production change). Scores 0-25 are low risk, 26-50 medium, 51-75 high, and 76-100 critical. The guard uses risk thresholds in policies to decide whether to allow, warn, or block an action.',
      risk_score: 5,
    },
    {
      declared_goal: 'Learn what factors drive risk: irreversibility, environment, data modification',
      reasoning: 'Accurate risk assessment prevents both false alarms and missed dangers',
      output_summary: 'Three primary factors drive risk: irreversibility (can the action be undone?), environment (staging vs production), and data scope (read vs write vs delete). A reversible staging read is 5-10. An irreversible production data deletion is 85-100. Set reversible: 0 for destructive operations.',
      risk_score: 12,
    },
    {
      declared_goal: 'Apply risk templates for common action types',
      reasoning: 'Templates prevent agents from under- or over-estimating risk',
      output_summary: 'Risk templates provide baseline scores by action type. deploy-staging: 30, deploy-production: 65, database-migration: 75, read-only-query: 5, cache-invalidation: 40. Agents can adjust from the baseline but must justify deviations in the reasoning field.',
      risk_score: 15,
    },
    {
      declared_goal: 'Configure risk thresholds in guard policies',
      reasoning: 'Risk thresholds are the primary mechanism for automated action governance',
      output_summary: 'Create a risk_threshold policy: dc.createPolicy({ policy_type: "risk_threshold", config: { threshold: 60, action: "require_approval" } }). Actions with risk_score >= 60 will require operator approval. You can set multiple tiers: warn at 40, require approval at 60, block at 85.',
      risk_score: 20,
    },
  ],


  /* ── Guard area ───────────────────────────────────────────────── */
  'guard-policies': [
    {
      declared_goal: 'Understand the four policy types: risk_threshold, require_approval, rate_limit, block_action_type',
      reasoning: 'Policies are the building blocks of guard enforcement',
      output_summary: 'DashClaw supports four policy types. risk_threshold blocks or warns when risk_score exceeds a value. require_approval forces operator review for matching actions. rate_limit caps action frequency or cost per window. block_action_type prevents specific action types entirely.',
      risk_score: 10,
    },
    {
      declared_goal: 'Create a guard policy using the SDK',
      reasoning: 'Programmatic policy management enables infrastructure-as-code for governance',
      output_summary: 'Use dc.createPolicy({ name: "Block high-risk deploys", policy_type: "risk_threshold", config: { threshold: 70, action: "block" }, enabled: true }). The policy takes effect immediately. All new actions will be evaluated against it. Use dc.listPolicies() to verify.',
      risk_score: 15,
    },
    {
      declared_goal: 'Switch between guard modes: off, warn, and enforce',
      reasoning: 'Guard modes let you roll out governance incrementally',
      output_summary: 'Guard mode controls enforcement behavior. "off" disables all policy checks. "warn" evaluates policies but only logs decisions without blocking. "enforce" blocks or requires approval per policy rules. Start with warn mode to audit before enforcing. Set via the dashboard or API.',
      risk_score: 20,
    },
    {
      declared_goal: 'Manage policy lifecycle: enable, disable, update, and delete',
      reasoning: 'Policies evolve as teams learn what governance works for them',
      output_summary: 'Toggle policies with dc.updatePolicy(policyId, { enabled: false }) without deleting them. Update thresholds with dc.updatePolicy(policyId, { config: { threshold: 80 } }). Delete with dc.deletePolicy(policyId). Disabled policies are preserved for audit history.',
      risk_score: 10,
    },
    {
      declared_goal: 'Layer multiple policies for defense in depth',
      reasoning: 'Single policies have blind spots; layered policies catch more edge cases',
      output_summary: 'Combine policies for layered governance: a rate_limit to cap volume, a risk_threshold to catch dangerous actions, a require_approval for production deploys, and a block_action_type for forbidden operations. The guard evaluates all active policies and applies the strictest result.',
      risk_score: 18,
    },
  ],

  'guard-decisions': [
    {
      declared_goal: 'Understand guard decision types: allow, block, warn, require_approval',
      reasoning: 'Guard decisions are the output of policy evaluation',
      output_summary: 'When the guard evaluates an action, it produces one of four decisions. "allow" lets the action proceed. "block" stops it entirely. "warn" permits the action but logs a warning. "require_approval" pauses the action until an operator approves or rejects it.',
      risk_score: 5,
    },
    {
      declared_goal: 'Read the reasoning field on guard decisions',
      reasoning: 'Decision reasoning provides transparency into why the guard acted',
      output_summary: 'Every guard decision includes a reasoning string explaining which policy triggered and why. Example: "Blocked: risk_score 82 exceeds threshold 70 (policy: Block high-risk deploys)". This field is crucial for debugging unexpected blocks and for compliance evidence.',
      risk_score: 8,
    },
    {
      declared_goal: 'View guard decision history for an agent or action',
      reasoning: 'Decision history is the audit trail for governance compliance',
      output_summary: 'GET /api/guard/decisions returns the decision log with filtering by agent_id, decision type, and date range. Each entry shows the action_id, policies evaluated, decision result, and reasoning. Use dc.listGuardDecisions({ agent_id: "my-agent" }) from the SDK.',
      risk_score: 5,
    },
    {
      declared_goal: 'Handle pending approvals as an operator',
      reasoning: 'Timely approval handling prevents agent workflow bottlenecks',
      output_summary: 'Actions with status "pending_approval" appear in the approval queue. Operators approve with dc.approveAction(actionId) or reject with dc.rejectAction(actionId, { reason: "Too risky for current change window" }). The agent is notified and can proceed or abort.',
      risk_score: 15,
    },
  ],

  'guard-semantic-rules': [
    {
      declared_goal: 'Understand content-based guard checks beyond numeric rules',
      reasoning: 'Semantic guards catch risks that simple thresholds miss',
      output_summary: 'Semantic guard rules evaluate the content of declared_goal, reasoning, and output_summary using an LLM. They catch risks like "agent is attempting to access production credentials" even if the risk_score is low. This adds a natural-language safety layer on top of numeric policies.',
      risk_score: 15,
    },
    {
      declared_goal: 'Learn how LLM-powered evaluation works in the guard',
      reasoning: 'Understanding the evaluation pipeline helps write effective semantic rules',
      output_summary: 'The semantic guard sends the action fields to an LLM with a system prompt defining what to flag. The LLM returns allow/block/warn with reasoning. Latency is typically 1-3 seconds. The evaluation result is cached for identical action content to reduce costs.',
      risk_score: 20,
    },
    {
      declared_goal: 'Configure the DASHCLAW_GUARD_FALLBACK setting',
      reasoning: 'Fallback behavior determines safety posture when the LLM is unavailable',
      output_summary: 'Set DASHCLAW_GUARD_FALLBACK to control behavior when the guard cannot complete an evaluation (semantic LLM unreachable, webhook timeout, deadline exceeded). Default is "require_approval" — degraded actions wait for a human. "block" is the strictest posture; "allow" fails open and skips the check (escape hatch, not recommended). Per-policy on_timeout/fallback rules override the global.',
      risk_score: 25,
    },
    {
      declared_goal: 'Write effective semantic guard rule prompts',
      reasoning: 'Well-crafted prompts reduce false positives and false negatives',
      output_summary: 'Semantic rules work best when they are specific and include examples. Instead of "block dangerous actions", write "block actions that modify database schemas in production without a migration plan in the reasoning field". Include 2-3 positive and negative examples to calibrate the LLM.',
      risk_score: 18,
    },
  ],

  /* ── Security area ────────────────────────────────────────────── */
  'security-signals': [
    {
      declared_goal: 'Understand red and amber security signal types',
      reasoning: 'Security signals are the early warning system for agent problems',
      output_summary: 'Red signals indicate immediate concerns: high_impact_low_oversight (risky action with no approval), repeated_failures (agent failing the same action repeatedly), data_exfiltration_pattern (unusual data access). Amber signals are warnings: elevated_risk_trend, unusual_hours_activity, stale_loop (agent stuck in a retry loop).',
      risk_score: 15,
    },
    {
      declared_goal: 'Configure signal detection thresholds',
      reasoning: 'Proper thresholds reduce alert fatigue while catching real issues',
      output_summary: 'Each signal type has configurable thresholds. repeated_failures triggers after 3 consecutive failures by default (adjustable 2-10). stale_loop triggers when an agent retries the same action 5+ times in 10 minutes. high_impact_low_oversight triggers for risk_score >= 70 with no approval policy.',
      risk_score: 20,
    },
    {
      declared_goal: 'Respond to active security signals',
      reasoning: 'Timely response to signals prevents escalation',
      output_summary: 'When a signal fires, review the triggering actions in the security dashboard. For high_impact_low_oversight: create an approval policy for the action type. For repeated_failures: check agent logs and fix the root cause. For stale_loop: manually cancel the stuck action and investigate.',
      risk_score: 25,
    },
    {
      declared_goal: 'Set up signal notifications via webhooks',
      reasoning: 'Signals are only useful if operators see them promptly',
      output_summary: 'Subscribe to signal events: dc.createWebhook({ event: "security.signal.red", url: "https://alerts.example/security" }). Red signals should page on-call. Amber signals can go to a Slack channel. Include the signal_type and agent_id in webhook payloads for routing.',
      risk_score: 18,
    },
  ],

  'security-agent-pairing': [
    {
      declared_goal: 'Understand the agent key exchange flow',
      reasoning: 'Agent pairing establishes cryptographic identity for signature verification',
      output_summary: 'Agent pairing uses a key exchange flow: the agent generates an RSASSA-PKCS1-v1_5 key pair, sends the public key to DashClaw via dc.pairAgent({ agent_id: "my-agent", public_key: publicKeyPem }), and DashClaw stores it. All subsequent actions from this agent can be signature-verified.',
      risk_score: 20,
    },
    {
      declared_goal: 'Learn the RSASSA-PKCS1-v1_5 signing algorithm',
      reasoning: 'Understanding the algorithm helps debug signature verification failures',
      output_summary: 'DashClaw uses RSASSA-PKCS1-v1_5 with SHA-256 for agent signatures. The agent signs a canonical string of action fields (action_id + declared_goal + timestamp_start) with its private key. The signature is a base64-encoded string attached to the action. DashClaw verifies using the stored public key.',
      risk_score: 25,
    },
    {
      declared_goal: 'Handle pairing expiry and key rotation',
      reasoning: 'Key rotation is essential for long-lived agent deployments',
      output_summary: 'Agent pairings expire after 90 days by default. Before expiry, rotate keys with dc.rotatePairing({ agent_id: "my-agent", new_public_key: newKeyPem }). Both old and new keys are valid during a 24-hour grace period. Expired pairings cause signature verification failures.',
      risk_score: 30,
    },
    {
      declared_goal: 'Troubleshoot pairing failures',
      reasoning: 'Pairing failures block agent onboarding and must be resolved quickly',
      output_summary: 'Common pairing failures: key format error (must be PEM-encoded SPKI), agent_id mismatch (case-sensitive), and duplicate pairing (agent already paired). Check dc.getPairingStatus(agentId) for status details. Re-pair with force: true to replace an existing pairing.',
      risk_score: 15,
    },
  ],

  'security-signatures': [
    {
      declared_goal: 'Enable ENFORCE_AGENT_SIGNATURES for production',
      reasoning: 'Signature enforcement prevents unauthorized agents from recording actions',
      output_summary: 'Set ENFORCE_AGENT_SIGNATURES=true in your environment. When enabled, every action must include a valid signature field. Actions without signatures or with invalid signatures are rejected with a 403 error. This is enabled by default in production and disabled in development.',
      risk_score: 30,
    },
    {
      declared_goal: 'Sign an action before submission',
      reasoning: 'Signing proves the action originated from the claimed agent',
      output_summary: 'Build the canonical string: `${action_id}|${declared_goal}|${timestamp_start}`. Sign with the agent private key using RSASSA-PKCS1-v1_5 SHA-256. Attach as the signature field. The SDK handles this automatically when configured: dc.configure({ privateKey: keyPem, signActions: true }).',
      risk_score: 20,
    },
    {
      declared_goal: 'Verify signatures in the guard pipeline',
      reasoning: 'Signature verification is the first step in the guard evaluation chain',
      output_summary: 'Signature verification happens before policy evaluation. If ENFORCE_AGENT_SIGNATURES is true and the signature is missing or invalid, the action is rejected immediately — no policies are evaluated. The guard decision log shows "rejected: invalid_signature" for failed verifications.',
      risk_score: 25,
    },
    {
      declared_goal: 'Debug signature verification failures',
      reasoning: 'Signature failures are the most common agent integration issue in production',
      output_summary: 'Check these in order: 1) Is the agent paired? (dc.getPairingStatus). 2) Is the canonical string format correct? (action_id|declared_goal|timestamp_start). 3) Is the private key the same one paired? 4) Has the pairing expired? The guard decision reasoning includes the specific failure cause.',
      risk_score: 15,
    },
  ],

  /* ── Automation area ──────────────────────────────────────────── */
  'webhooks-setup': [
    {
      declared_goal: 'Handle webhook retries and failure scenarios',
      reasoning: 'Reliable webhook handling prevents missed events',
      output_summary: 'DashClaw retries failed webhook deliveries 3 times. After all retries fail, the webhook is marked "degraded" but not disabled. Implement idempotency in your handler using the delivery_id to prevent duplicate processing. Respond with 200 within 10 seconds to acknowledge receipt.',
      risk_score: 18,
    },
    {
      declared_goal: 'Secure webhook endpoints with signature verification',
      reasoning: 'Signature verification prevents spoofed webhook deliveries',
      output_summary: 'DashClaw signs webhook payloads using HMAC-SHA256 with your webhook secret. The signature is in the X-DashClaw-Signature header. Verify by computing HMAC-SHA256(secret, raw_body) and comparing with timing-safe equality. Reject requests with invalid or missing signatures.',
      risk_score: 20,
    },
  ],

};

/* ------------------------------------------------------------------ */
/*  Build actions array from step definitions                         */
/* ------------------------------------------------------------------ */

let actionCounter = 0;
const actions: Record<string, unknown>[] = [];

for (const agentDef of agentDefs) {
  const steps = stepsByAgent[agentDef.id] ?? [];
  const agentActions = steps.map((step, stepIdx) => {
    actionCounter += 1;
    const n = actionCounter;

    const msAgo = int(rnd, 1, 14) * MS_DAY + int(rnd, 0, 23) * MS_HOUR;
    const duration = int(rnd, 4_000, 90_000);
    const tokensIn = int(rnd, 200, 1200);
    const tokensOut = int(rnd, 100, 800);
    const cost = Math.round((0.002 + rnd() * 0.05) * 10000) / 10000;
    const riskScore = step.risk_score || int(rnd, 5, 40);

    // Most completed, a few running/pending for realism
    let status = 'completed';
    if (n % 19 === 0) status = 'running';
    else if (n % 23 === 0) status = 'pending';

    return {
      org_id: DEMO_ORG,
      action_id: stableId('act_feat', n),
      agent_id: agentDef.id,
      agent_name: agentDef.name,
      swarm_id: null,
      parent_action_id: null,
      action_type: 'tutorial',
      declared_goal: step.declared_goal,
      reasoning: step.reasoning,
      authorization_scope: 'read-only',
      trigger: 'operator',
      systems_touched: JSON.stringify(['dashclaw']),
      input_summary: null,
      status,
      reversible: 1,
      risk_score: riskScore,
      confidence: int(rnd, 70, 95),
      recommendation_id: null,
      recommendation_applied: 0,
      recommendation_override_reason: null,
      output_summary: status === 'completed' ? step.output_summary : null,
      side_effects: JSON.stringify([]),
      artifacts_created: JSON.stringify([]),
      error_message: null,
      timestamp_start: isoFromNow(msAgo),
      timestamp_end: status === 'running' || status === 'pending' ? null : isoFromNow(msAgo - duration),
      duration_ms: status === 'running' || status === 'pending' ? null : duration,
      cost_estimate: cost,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      signature: null,
      verified: true,
    };
  });

  actions.push(...agentActions);
}

export { agents, actions };
