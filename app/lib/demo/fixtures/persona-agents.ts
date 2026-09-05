import { lcg, pick, int, isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

const rnd = lcg(0x50455253_0001);

/* ── persona definitions ────────────────────────────────────────────── */

interface PersonaAction {
  action_type: string;
  declared_goal: string;
  reasoning: string;
  output_summary: string;
}

interface Persona {
  id: string;
  name: string;
  description: string;
  riskRange: [number, number];
  actions: PersonaAction[];
}

const PERSONAS: Persona[] = [
  {
    id: 'new-operator',
    name: 'Persona: New Operator',
    description: 'Getting oriented, basic workflows, first-time user experience',
    riskRange: [5, 20],
    actions: [
      {
        action_type: 'workflow',
        declared_goal: 'Understanding the action feed',
        reasoning: 'The action feed is the primary view operators interact with — understanding it is essential.',
        output_summary:
          'Every action in the feed shows the agent name, action type, risk score badge, status (completed/running/blocked/failed), and a timestamp. You can filter by agent, status, or action type using the dropdowns above the table. Click any row to expand the full record: declared goal, reasoning, output summary, cost, and token usage. High-risk actions (score > 70) show an amber or red badge — review these first.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Reading guard decisions',
        reasoning: 'Guard decisions determine whether agent actions proceed — new operators must know how to interpret them.',
        output_summary:
          'Guard decisions come in four verdicts: allow (action proceeds normally), warn (action proceeds but is flagged), block (action is stopped), and escalate (action is held for operator approval). Each decision shows the policy that triggered it, the risk score at evaluation time, and a short rationale. If you see frequent blocks, check whether the policy thresholds are too strict or the agent is genuinely misbehaving.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Setting up your first webhook notification',
        reasoning: 'Operators need to know when important events happen without staring at the dashboard.',
        output_summary:
          'Navigate to Settings > Webhooks and click "Add webhook." Enter your endpoint URL (e.g., a Slack incoming-webhook URL), choose which events to subscribe to (approval_pending, repeated_failures, drift_alert are good starting choices), and save. DashClaw will POST a JSON payload to your URL whenever the event fires. Use the "Test" button to send a sample payload and verify delivery.',
      },
    ],
  },
  {
    id: 'security-lead',
    name: 'Persona: Security Lead',
    description: 'Guard policies, security signals, agent pairing, signature enforcement',
    riskRange: [40, 85],
    actions: [
      {
        action_type: 'configure',
        declared_goal: 'Switching guard from warn mode to enforce mode',
        reasoning: 'Enforce mode blocks policy violations instead of just logging them — essential for production security posture.',
        output_summary:
          'In Guard > Policies, each policy has a mode toggle: "warn" logs violations but allows the action, "enforce" blocks the action and returns a denial to the agent. Switch gradually: start with your highest-confidence policies (e.g., cost-cap, known-dangerous-action blocklist) and monitor the block rate for 24 hours before enabling enforce on risk-threshold policies. Check the Guard Decisions feed for false positives before expanding enforcement.',
      },
      {
        action_type: 'review',
        declared_goal: 'Auditing high-risk actions from the last week',
        reasoning: 'Periodic review of high-risk actions catches policy gaps and validates that guard decisions were correct.',
        output_summary:
          'Filter the action feed by risk_score >= 70 and date range = last 7 days. For each action, verify: (1) the guard decision was appropriate — was it allowed when it should have been blocked? (2) the output_summary matches the declared_goal — did the agent do what it said it would? (3) the cost and token usage are within expected bounds. Flag any action where the guard allowed a risk_score > 80 without an escalation policy — this indicates a policy gap.',
      },
      {
        action_type: 'investigate',
        declared_goal: 'Investigating a cluster of blocked actions from a single agent',
        reasoning: 'Repeated blocks from one agent may indicate misconfiguration, a compromised key, or a genuine attack.',
        output_summary:
          'Pull the agent\'s action history for the past 48 hours and group by guard verdict. If all blocks cite the same policy, the agent likely needs its configuration updated (e.g., it is targeting a resource outside its authorization scope). If blocks cite different policies, the agent may be probing boundaries — escalate to incident response. Check the agent\'s pairing status and last successful action to rule out key rotation issues.',
      },
    ],
  },
  {
    id: 'compliance-officer',
    name: 'Persona: Compliance Officer',
    description: 'Framework mapping, controls, evidence collection, gap analysis, reports',
    riskRange: [15, 45],
    actions: [
    ],
  },
  {
    id: 'platform-engineer',
    name: 'Persona: Platform Engineer',
    description: 'SDK integration, webhooks, workflows, task routing, API usage',
    riskRange: [20, 55],
    actions: [
      {
        action_type: 'configure',
        declared_goal: 'Setting up webhook endpoints for CI/CD pipeline integration',
        reasoning: 'Webhooks connect DashClaw events to deployment pipelines, alerting, and external tooling.',
        output_summary:
          'Register a webhook via POST /api/webhooks with the target URL and event list. Supported events: autonomy_spike, high_impact_low_oversight, repeated_failures, stale_loop, assumption_drift, stale_assumption, stale_running_action, drift_alert, approval_pending, approval_granted, approval_denied — or "all" to subscribe to everything. Each webhook delivery includes an HMAC signature in the X-DashClaw-Signature header — verify this in your receiver to prevent spoofing. Set up a dead-letter queue for failed deliveries. Monitor webhook health in Settings > Webhooks > Delivery Log.',
      },
      {
        action_type: 'investigate',
        declared_goal: 'Debugging a failing webhook delivery',
        reasoning: 'Webhook failures can silently break downstream integrations — proactive debugging prevents incidents.',
        output_summary:
          'Check Settings > Webhooks > Delivery Log for the failing endpoint. Common causes: (1) endpoint returned 5xx — check the receiving service health, (2) connection timeout — the endpoint took more than 10 seconds to respond, (3) SSL certificate error — the endpoint\'s cert may have expired. DashClaw retries failed deliveries 3 times with exponential backoff. If all retries fail, the webhook is marked degraded. Fix the endpoint, then click "Retry" on the failed deliveries to replay them.',
      },
    ],
  },
  {
    id: 'team-admin',
    name: 'Persona: Team Admin',
    description: 'Team management, invites, roles, integration settings, org configuration',
    riskRange: [10, 35],
    actions: [
      {
        action_type: 'configure',
        declared_goal: 'Inviting team members and assigning roles',
        reasoning: 'Access control starts with proper role assignment — the wrong role can expose sensitive data or block workflows.',
        output_summary:
          'Navigate to Settings > Team and click "Invite." Enter the email address and select a role: viewer (read-only access to dashboards), operator (can approve escalations, manage agents), or admin (full configuration access including policies and integrations). Invites expire after 7 days. Pending invites appear in the Team list with a clock icon. Revoke unused invites to maintain a clean access list.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Setting up GitHub OAuth for team authentication',
        reasoning: 'OAuth simplifies onboarding and ties DashClaw access to existing identity infrastructure.',
        output_summary:
          'In your GitHub organization settings, create a new OAuth App with the callback URL http://your-dashclaw-host/api/auth/callback/github. Copy the Client ID into GITHUB_ID and the Client Secret into GITHUB_SECRET in your environment. Restart DashClaw. Team members can now sign in with their GitHub accounts. Their org membership is checked on each login — removing someone from the GitHub org revokes their DashClaw access automatically.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Reviewing and updating org-wide configuration settings',
        reasoning: 'Org configuration controls default behavior for all agents and operators — misconfigurations affect everyone.',
        output_summary:
          'Settings > Organization shows global defaults: default guard mode (warn vs. enforce), rate limit thresholds, signature requirements, and enrollment mode (open vs. closed). Changes to these settings take effect immediately for all new actions. Review each setting quarterly. Use the audit log (Settings > Audit Log) to see who changed what and when. Revert accidental changes by restoring the previous value — DashClaw does not auto-rollback configuration changes.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Configuring Google OAuth as a secondary login provider',
        reasoning: 'Supporting multiple OAuth providers accommodates teams that span organizations.',
        output_summary:
          'Create OAuth credentials in the Google Cloud Console with the authorized redirect URI http://your-dashclaw-host/api/auth/callback/google. Set GOOGLE_ID and GOOGLE_SECRET in your environment and restart. The login page will show both GitHub and Google buttons. Users who sign in with Google are created as new accounts — they do not auto-link to existing GitHub-authenticated accounts unless the email matches. Verify by signing in with a test Google account.',
      },
      {
        action_type: 'review',
        declared_goal: 'Auditing team access and removing stale accounts',
        reasoning: 'Stale accounts are a security risk — regular access reviews are a compliance requirement.',
        output_summary:
          'In Settings > Team, sort by "Last active" to find accounts that haven\'t logged in recently. Accounts inactive for more than 90 days should be reviewed — contact the person or their manager before removing. To remove, click the account and select "Revoke access." Revoked users lose all access immediately but their historical actions remain in the audit trail. Export the team list as CSV for your quarterly access review documentation.',
      },
    ],
  },
  {
    id: 'sdk-developer',
    name: 'Persona: SDK Developer',
    description: 'Node/Python SDK patterns, client initialization, error handling, method usage',
    riskRange: [10, 40],
    actions: [
    ],
  },
  {
    id: 'incident-responder',
    name: 'Persona: Incident Responder',
    description: 'Debugging blocked actions, analyzing guard decisions, security signal response',
    riskRange: [50, 90],
    actions: [
      {
        action_type: 'investigate',
        declared_goal: 'Triaging a blocked production deployment action',
        reasoning: 'Blocked deploys need immediate attention — the responder must determine if the block is correct or a false positive.',
        output_summary:
          'Open the blocked action in the action feed and examine the guard decision. Check which policy triggered the block and whether the risk score is accurate. If the block is a false positive (e.g., the policy threshold is too aggressive for this agent\'s normal operations), create a policy exception for the specific agent and action type. If the block is legitimate, investigate why the agent attempted a high-risk deploy — check its recent context threads for decision reasoning.',
      },
      {
        action_type: 'investigate',
        declared_goal: 'Analyzing a spike in security signals from an agent cluster',
        reasoning: 'Signal spikes from multiple agents can indicate a coordinated issue — compromised credentials, infrastructure problems, or a cascading failure.',
        output_summary:
          'Filter security signals by the affected time window and sort by agent. If multiple agents from the same swarm are triggering signals, check the shared configuration — a bad deployment or config push could be the root cause. If agents from different swarms are affected, check the infrastructure layer — API latency, database connectivity, or a rate-limit cascade. Cross-reference with the webhook delivery log to see if downstream systems are also failing.',
      },
      {
        action_type: 'investigate',
        declared_goal: 'Reconstructing the timeline of a guard escalation chain',
        reasoning: 'Escalation chains show how an incident evolved — understanding the sequence prevents recurrence.',
        output_summary:
          'In Guard Decisions, filter by verdict = "escalate" and the incident time window. Order by timestamp to see the sequence. Each escalation references the action that triggered it and the operator who resolved it. Map the chain: which action escalated first, how long until operator response, what was the resolution (approve, deny, modify policy). Document gaps — if an escalation sat unresolved for more than 30 minutes, the notification setup needs improvement.',
      },
      {
        action_type: 'review',
        declared_goal: 'Post-incident review of guard decision accuracy',
        reasoning: 'After an incident, every guard decision during the window needs validation to catch missed threats or false blocks.',
        output_summary:
          'Export all guard decisions from the incident window (start time minus 1 hour through resolution). Categorize each decision: correct-allow (action was safe and was allowed), correct-block (action was dangerous and was blocked), false-positive (safe action was blocked), false-negative (dangerous action was allowed). False negatives are the highest priority — they indicate policy gaps. Create new policies or tighten thresholds to close each gap. Document findings in the incident post-mortem.',
      },
      {
        action_type: 'investigate',
        declared_goal: 'Identifying the root cause of repeated agent authentication failures',
        reasoning: 'Auth failures prevent agents from recording actions — this creates blind spots in the decision audit trail.',
        output_summary:
          'Check the agent\'s API key status in Settings > API Keys. Common causes: (1) key was rotated but the agent config was not updated, (2) key was scoped to a different org_id than the agent is sending, (3) key expired (if expiration is configured). Verify by checking the agent\'s request headers against the registered key. If the key is correct, check whether DASHCLAW_CLOSED_ENROLLMENT is enabled and the agent has not completed pairing. Restore auth by issuing a new key or completing the pairing flow.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Configuring guard fail-closed mode during an active incident',
        reasoning: 'During incidents, fail-closed mode ensures unknown or unclassified actions are blocked rather than allowed.',
        output_summary:
          'Set DASHCLAW_GUARD_FALLBACK=block in the environment and restart. Any action the guard cannot evaluate (LLM unavailable, policy timeout, evaluation deadline exceeded) is then blocked outright instead of the default require_approval degradation. This is the strictest posture during an incident but will increase block rates — warn your team before enabling. Unset the variable after the incident to return to the require_approval default; DASHCLAW_GUARD_FALLBACK=allow restores fail-open and is not recommended.',
      },
    ],
  },
  {
    id: 'auditor',
    name: 'Persona: Auditor',
    description: 'Compliance review, evidence gathering, control verification, audit reports',
    riskRange: [10, 30],
    actions: [
    ],
  },
];

/* ── build agents and actions ───────────────────────────────────────── */

let actionCounter = 0;

const agents = PERSONAS.map((p) => ({
  agent_id: p.id,
  agent_name: p.name,
  description: p.description,
}));

const actions = PERSONAS.flatMap((persona) => {
  const [riskMin, riskMax] = persona.riskRange;

  return persona.actions.map((a) => {
    actionCounter += 1;
    const status = actionCounter % 7 === 0 ? 'running' : 'completed';
    const risk_score = int(rnd, riskMin, riskMax);
    const duration = int(rnd, 800, 18000);
    const msAgo = int(rnd, 1, 72) * MS_HOUR + int(rnd, 0, 59) * 60_000;
    const tokens_in = int(rnd, 200, 4000);
    const tokens_out = int(rnd, 100, 3000);
    const cost_estimate = parseFloat(((tokens_in + tokens_out) * 0.000004).toFixed(6));

    return {
      org_id: DEMO_ORG,
      action_id: stableId('act_persona', actionCounter),
      agent_id: persona.id,
      agent_name: persona.name,
      swarm_id: null,
      parent_action_id: null,
      action_type: a.action_type,
      declared_goal: a.declared_goal,
      reasoning: a.reasoning,
      authorization_scope: pick(rnd, ['read-only', 'staging', 'limited-prod']),
      trigger: 'operator',
      systems_touched: JSON.stringify(['dashclaw']),
      input_summary: null,
      status,
      reversible: 1,
      risk_score,
      confidence: int(rnd, 65, 95),
      recommendation_id: null,
      recommendation_applied: 0,
      recommendation_override_reason: null,
      output_summary: a.output_summary,
      side_effects: JSON.stringify([]),
      artifacts_created: JSON.stringify([]),
      error_message: null,
      timestamp_start: isoFromNow(msAgo),
      timestamp_end: status === 'running' ? null : isoFromNow(msAgo - duration),
      duration_ms: status === 'running' ? null : duration,
      cost_estimate,
      tokens_in,
      tokens_out,
      signature: null,
      verified: true,
    };
  });
});

export { agents, actions };
