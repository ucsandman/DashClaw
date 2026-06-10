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
        declared_goal: 'First login — navigating the dashboard',
        reasoning: 'New operators need a mental map of DashClaw before they can use it effectively.',
        output_summary:
          'The dashboard is organized into sidebar sections: Actions (decision feed), Guard (policy enforcement), Workspace (per-agent context), Security (signals and findings), Compliance (framework mapping), and Routing (task assignment). The top bar shows your org, active agent count, and a quick-filter dropdown. Start by scanning the action feed to see what your agents have been doing, then check Guard Decisions to understand how policies are shaping behavior.',
      },
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
        declared_goal: 'Checking agent health via fleet presence',
        reasoning: 'Knowing which agents are active, idle, or offline prevents surprises.',
        output_summary:
          'Fleet presence on the Routing page shows each registered agent with a status indicator: green (active — reported in the last 5 minutes), yellow (idle — last seen within an hour), or gray (offline). Click an agent to see its last action, uptime, and error rate. If an agent shows offline unexpectedly, check its host process and API key validity.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Setting up your first webhook notification',
        reasoning: 'Operators need to know when important events happen without staring at the dashboard.',
        output_summary:
          'Navigate to Settings > Webhooks and click "Add webhook." Enter your endpoint URL (e.g., a Slack incoming-webhook URL), choose which events to subscribe to (action.blocked, guard.escalation, security.signal are good starting choices), and save. DashClaw will POST a JSON payload to your URL whenever the event fires. Use the "Test" button to send a sample payload and verify delivery.',
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
        action_type: 'review',
        declared_goal: 'Reviewing security signals for the past 24 hours',
        reasoning: 'Security signals surface patterns that individual actions might not reveal — clustering, anomalies, and repeat failures.',
        output_summary:
          'The Security dashboard groups signals by severity: red (immediate attention — e.g., repeated high-risk actions from an unverified agent), amber (investigate soon — e.g., unusual action volume spike), and informational (trend data). Each signal links to the triggering actions. Start with red signals, verify whether the agent is legitimate, then check amber signals for emerging patterns. Dismiss informational signals only after confirming they are expected.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Switching guard from warn mode to enforce mode',
        reasoning: 'Enforce mode blocks policy violations instead of just logging them — essential for production security posture.',
        output_summary:
          'In Guard > Policies, each policy has a mode toggle: "warn" logs violations but allows the action, "enforce" blocks the action and returns a denial to the agent. Switch gradually: start with your highest-confidence policies (e.g., cost-cap, known-dangerous-action blocklist) and monitor the block rate for 24 hours before enabling enforce on risk-threshold policies. Check the Guard Decisions feed for false positives before expanding enforcement.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Setting up agent pairing for key exchange',
        reasoning: 'Agent pairing ensures that only trusted agents can submit actions — prevents impersonation.',
        output_summary:
          'Agent pairing uses a key-exchange flow: the agent generates a keypair, registers its public key via the /api/agents/pair endpoint, and an operator approves the pairing in the dashboard. Once paired, the agent signs every action payload with its private key. DashClaw verifies the signature before processing. Unpaired agents are rejected when DASHCLAW_CLOSED_ENROLLMENT is enabled. Review pending pairing requests under Security > Agent Pairing.',
      },
      {
        action_type: 'review',
        declared_goal: 'Auditing high-risk actions from the last week',
        reasoning: 'Periodic review of high-risk actions catches policy gaps and validates that guard decisions were correct.',
        output_summary:
          'Filter the action feed by risk_score >= 70 and date range = last 7 days. For each action, verify: (1) the guard decision was appropriate — was it allowed when it should have been blocked? (2) the output_summary matches the declared_goal — did the agent do what it said it would? (3) the cost and token usage are within expected bounds. Flag any action where the guard allowed a risk_score > 80 without an escalation policy — this indicates a policy gap.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Enabling signature enforcement across all agents',
        reasoning: 'Signature enforcement is the strongest agent identity guarantee DashClaw offers.',
        output_summary:
          'Set the environment variable ENFORCE_AGENT_SIGNATURES=true and restart the DashClaw server. Once enabled, every action submission must include a valid signature in the request payload. Actions from agents without registered keypairs are rejected with a 403. Before enabling, verify all production agents have completed the pairing flow — check Security > Agent Pairing for any agents in "pending" or "unregistered" state. Roll out during a maintenance window to avoid disrupting active agents.',
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
      {
        action_type: 'workflow',
        declared_goal: 'Mapping guard policies to SOC 2 controls',
        reasoning: 'Compliance frameworks require demonstrating that controls are implemented — guard policies are the primary control mechanism.',
        output_summary:
          'In Compliance > Framework Mapping, select SOC 2 Type II and click "Map Controls." Each control (e.g., CC6.1 — Logical Access) can be linked to one or more guard policies that enforce it. For CC6.1, map your agent-authentication policy and your authorization-scope policy. DashClaw calculates coverage percentage automatically. Aim for 100% coverage on critical controls before your audit window opens.',
      },
      {
        action_type: 'review',
        declared_goal: 'Running gap analysis across all mapped frameworks',
        reasoning: 'Gap analysis identifies controls without policy coverage — these are audit risks.',
        output_summary:
          'Navigate to Compliance > Gap Analysis. The report shows each framework control with its coverage status: covered (linked to an enforcing policy), partial (linked to a warn-mode policy), or uncovered (no policy mapped). Export the report as CSV for your audit team. Focus on uncovered controls first — either create new policies to cover them or document compensating controls in the evidence section.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Collecting evidence for quarterly compliance review',
        reasoning: 'Evidence collection must be systematic and traceable — ad hoc gathering fails audits.',
        output_summary:
          'For each mapped control, click "Evidence" to see auto-collected artifacts: guard decision logs, policy change history, action audit trail, and agent pairing records. DashClaw timestamps and hashes each evidence artifact for tamper detection. Supplement with manual evidence (screenshots, meeting notes) using the "Upload" button. The evidence package can be exported as a ZIP for external auditors.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Setting up ISO 27001 framework alongside existing SOC 2 mapping',
        reasoning: 'Many organizations maintain multiple compliance frameworks — DashClaw supports parallel mapping.',
        output_summary:
          'In Compliance > Frameworks, click "Add Framework" and select ISO 27001:2022. DashClaw pre-loads the Annex A controls. Many ISO 27001 controls overlap with SOC 2 — the system suggests mappings based on your existing policy links. Review each suggestion, accept or modify, then run gap analysis on the new framework. Shared policies count toward both frameworks, reducing duplicate work.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Generating a compliance report for executive review',
        reasoning: 'Executives need a summary view — control coverage, risk posture, and trend over time.',
        output_summary:
          'Navigate to Compliance > Reports and click "Generate." Select the framework(s), date range, and detail level (executive summary or full detail). The executive summary shows overall coverage percentage, top gaps, trend graph (coverage over last 6 months), and a risk heat map. The full report includes per-control evidence and policy details. Export as PDF for board presentations or share the live link with stakeholders.',
      },
      {
        action_type: 'review',
        declared_goal: 'Verifying control effectiveness after a policy change',
        reasoning: 'Policy changes can affect compliance coverage — verification ensures no regressions.',
        output_summary:
          'After any policy modification, check Compliance > Framework Mapping for coverage changes. The system highlights controls whose coverage status changed (e.g., a policy moved from enforce to warn drops coverage from "covered" to "partial"). Review the guard decision log for the 24 hours after the change to confirm the policy is triggering as expected. Document the verification in the control\'s evidence section.',
      },
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
        declared_goal: 'Integrating DashClaw SDK into an existing agent codebase',
        reasoning: 'Platform engineers own the integration layer — SDK setup is the foundation for all agent instrumentation.',
        output_summary:
          'Install the SDK with npm install dashclaw, then initialize with: const dc = new DashClaw({ baseUrl: process.env.DASHCLAW_BASE_URL, apiKey: process.env.DASHCLAW_API_KEY, agentId: \'my-agent\' }). Wrap your agent\'s main action loop with dc.recordAction({ declaredGoal, actionType, reasoning }) to start recording decisions. The SDK handles batching, retries, and signature generation automatically. Verify integration by checking the action feed in the dashboard.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Setting up webhook endpoints for CI/CD pipeline integration',
        reasoning: 'Webhooks connect DashClaw events to deployment pipelines, alerting, and external tooling.',
        output_summary:
          'Register a webhook via POST /api/webhooks with the target URL and event list. Supported events: action.completed, action.blocked, guard.escalation, security.signal, agent.offline. Each webhook delivery includes an HMAC signature in the X-DashClaw-Signature header — verify this in your receiver to prevent spoofing. Set up a dead-letter queue for failed deliveries. Monitor webhook health in Settings > Webhooks > Delivery Log.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Building a multi-step workflow for automated deploys',
        reasoning: 'Workflows chain actions into repeatable sequences with guard checks at each step.',
        output_summary:
          'Define a workflow in the Workflows section with steps: (1) run pre-deploy checks (action_type: review), (2) execute deployment (action_type: workflow), (3) verify health (action_type: review). Each step is a separate recorded action with its own guard evaluation. If any step is blocked, the workflow halts and notifies the operator. Use the workflow_id field to link steps together for tracing. Trigger workflows via POST /api/workflows/run or on a cron schedule.',
      },
      {
        action_type: 'configure',
        declared_goal: 'Configuring task routing rules for multi-agent teams',
        reasoning: 'Task routing ensures the right agent handles each task based on capabilities and availability.',
        output_summary:
          'In Routing > Rules, define routing criteria: agent capabilities (e.g., "can-deploy", "security-review"), current load (active task count), and priority levels. Tasks submitted via POST /api/routing/tasks are matched to the best available agent. If no agent matches, the task enters a pending queue. Set up fallback rules for when primary agents are offline. Monitor routing efficiency in the Routing dashboard — look for tasks stuck in pending state.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Monitoring API usage patterns and rate limits',
        reasoning: 'Understanding API consumption prevents hitting rate limits and helps capacity planning.',
        output_summary:
          'The API usage view in Settings shows requests per endpoint, error rates, and p95 latency over time. Rate limits are configured via DASHCLAW_RATE_LIMIT_MAX (requests per window) and DASHCLAW_RATE_LIMIT_WINDOW_MS (window size in milliseconds). When an agent approaches the limit, the SDK receives 429 responses with a Retry-After header. Set up a webhook on rate-limit events to alert your team before agents are throttled.',
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
      {
        action_type: 'workflow',
        declared_goal: 'Initializing the Node SDK with proper error handling',
        reasoning: 'Correct initialization prevents silent failures and ensures actions are recorded reliably.',
        output_summary:
          'Import the SDK and initialize with explicit error handling: const dc = new DashClaw({ baseUrl: process.env.DASHCLAW_BASE_URL, apiKey: process.env.DASHCLAW_API_KEY, agentId: \'my-agent\', onError: (err) => logger.error("DashClaw SDK error", err) }). The onError callback fires for network failures, auth errors, and malformed payloads. Never swallow these errors — they indicate instrumentation gaps. The SDK validates the API key on first use and caches the result. If initialization fails, all subsequent calls return gracefully without throwing, but actions are not recorded.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Recording actions with the Python SDK',
        reasoning: 'Python agents need the same instrumentation — the Python SDK mirrors the Node API in snake_case.',
        output_summary:
          'Install with pip install dashclaw. Initialize: dc = DashClaw(base_url=os.environ["DASHCLAW_BASE_URL"], api_key=os.environ["DASHCLAW_API_KEY"], agent_id="my-agent"). Record actions: dc.record_action(declared_goal="Analyze dataset", action_type="workflow", reasoning="Quarterly metrics require updated analysis"). The Python SDK uses snake_case for all methods and parameters. Async support is available via dc_async = AsyncDashClaw(...) for asyncio-based agents. Both sync and async clients share the same method signatures.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Using guard check before executing a risky operation',
        reasoning: 'Pre-flight guard checks let agents ask for permission before acting — preventing wasted work on actions that would be blocked.',
        output_summary:
          'Call dc.guardCheck({ declaredGoal, actionType, riskEstimate }) before executing the action. The response includes verdict (allow/block/warn/escalate) and the triggering policy. If blocked, skip the action and log the reason. If escalate, wait for operator approval via the returned escalation_id. This pattern is critical for high-risk operations like production deployments, data deletions, or external API calls where rollback is expensive.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Handling SDK retry behavior and timeouts',
        reasoning: 'Network issues should not cause agents to lose action records — retry configuration matters.',
        output_summary:
          'The SDK retries failed requests up to 3 times with exponential backoff (1s, 2s, 4s). Configure with: new DashClaw({ maxRetries: 5, timeoutMs: 10000 }). On timeout, the SDK queues the action locally and retries on the next call. If all retries fail, the onError callback fires with a RetryExhaustedError. For high-throughput agents, enable batch mode: new DashClaw({ batchSize: 10, flushIntervalMs: 5000 }) to reduce HTTP overhead.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Listing and filtering actions programmatically via SDK',
        reasoning: 'Agents that review their own history need efficient query patterns.',
        output_summary:
          'Use dc.listActions({ agentId: "my-agent", status: "completed", limit: 50, since: "2025-01-01T00:00:00Z" }) to fetch filtered action history. The response includes pagination cursors — pass cursor to the next call for subsequent pages. For the Python SDK: dc.list_actions(agent_id="my-agent", status="completed", limit=50). Both SDKs return the same JSON structure. Avoid fetching all actions without filters — use status, agent_id, or date range to keep response sizes manageable.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Implementing workspace context threads in agent code',
        reasoning: 'Context threads give agents persistent memory across sessions — essential for multi-turn workflows.',
        output_summary:
          'Create a thread: const thread = await dc.createContextThread({ title: "Deploy tracker", agentId: "deploy-bot" }). Add observations: await dc.addThreadEntry(thread.thread_id, { content: "Deployed v2.3.1 to staging", entryType: "observation" }). Retrieve context: const entries = await dc.getThreadEntries(thread.thread_id). Threads persist across agent restarts and sessions. Use them for decision journals, assumption logs, and handoff context. Thread IDs use the ct_ prefix — do not confuse with message threads (mt_ prefix).', // version-hardcode-allowed
      },
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
          'Set DASHCLAW_GUARD_FALLBACK=block in the environment and restart. In fail-closed mode, any action that the guard cannot evaluate (LLM unavailable, policy engine timeout, malformed payload) is automatically blocked instead of defaulting to allow. This is the safest posture during an incident but will increase block rates — warn your team before enabling. Revert to DASHCLAW_GUARD_FALLBACK=allow after the incident is resolved and verified.',
      },
    ],
  },
  {
    id: 'auditor',
    name: 'Persona: Auditor',
    description: 'Compliance review, evidence gathering, control verification, audit reports',
    riskRange: [10, 30],
    actions: [
      {
        action_type: 'review',
        declared_goal: 'Verifying control implementation for SOC 2 audit',
        reasoning: 'Auditors must independently verify that stated controls are actually implemented and enforced.',
        output_summary:
          'For each control in the compliance mapping, verify three things: (1) a guard policy exists that enforces the control, (2) the policy is in enforce mode (not just warn), and (3) there are recent guard decisions showing the policy has been evaluated. Controls mapped to warn-mode policies are only partially effective — note these as observations. Controls with no recent guard decisions may indicate dead policies — verify the triggering conditions are still relevant.',
      },
      {
        action_type: 'review',
        declared_goal: 'Examining the evidence chain for a specific compliance control',
        reasoning: 'Evidence must be complete, timestamped, and traceable — gaps undermine the entire audit.',
        output_summary:
          'Click into the control and select the Evidence tab. Each evidence artifact shows: type (auto-collected log, manual upload, policy snapshot), timestamp, hash (SHA-256 for tamper detection), and the user who uploaded it (if manual). Verify the evidence covers the full audit period — look for gaps longer than 30 days. Cross-reference guard decision logs with the evidence to confirm consistency. Flag any evidence that appears backdated or was uploaded in bulk near the audit deadline.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Generating an audit trail export for external review',
        reasoning: 'External auditors need a self-contained export they can review offline.',
        output_summary:
          'In Compliance > Reports, select "Audit Trail Export" and configure the scope: framework(s), date range, and whether to include raw action data or summaries only. The export includes: control-to-policy mappings, evidence artifacts, guard decision logs, policy change history, and agent registration records. The package is a ZIP containing JSON data files and a human-readable HTML summary. All files include cryptographic hashes for integrity verification.',
      },
      {
        action_type: 'review',
        declared_goal: 'Assessing policy change history for unauthorized modifications',
        reasoning: 'Unauthorized policy changes can weaken security controls — auditors must verify change authorization.',
        output_summary:
          'Navigate to Settings > Audit Log and filter by event type "policy.updated" and "policy.created." Each entry shows who made the change, when, what was modified (old value vs. new value), and from which IP address. Compare against your change management records — every policy change should have a corresponding approved change request. Flag any changes made outside business hours, by non-admin users, or without a matching change request.',
      },
      {
        action_type: 'review',
        declared_goal: 'Validating agent identity and enrollment controls',
        reasoning: 'Agent identity is the foundation of action attribution — weak identity controls undermine the entire audit trail.',
        output_summary:
          'Check Security > Agent Pairing for the list of registered agents. Verify: (1) all production agents are paired with valid keys, (2) no "pending" agents have been waiting more than 7 days (these may be unauthorized registration attempts), (3) DASHCLAW_CLOSED_ENROLLMENT is enabled in production (prevents unregistered agents from submitting actions). Cross-reference the agent list with your asset inventory — every agent should be accounted for. Report any agents that appear in DashClaw but not in the inventory.',
      },
      {
        action_type: 'workflow',
        declared_goal: 'Preparing the final audit report with findings and recommendations',
        reasoning: 'The audit report synthesizes all findings into actionable conclusions for management.',
        output_summary:
          'Compile findings into three categories: (1) conformities — controls that are properly implemented and evidenced, (2) observations — controls that work but could be strengthened (e.g., warn-mode policies that should be enforce), (3) non-conformities — controls that are missing, ineffective, or unevidenced. For each non-conformity, include the control reference, what was expected, what was found, and a recommended remediation. Export the compliance report from DashClaw as supporting documentation and attach it to your audit deliverable.',
      },
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
