import { lcg, pick, int, isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

const rnd = lcg(0xDA010001);

const agents = [
  { agent_id: 'day-1-what-is-dashclaw',      agent_name: 'Day 1: What is DashClaw?' },
  { agent_id: 'day-1-install-sdk',            agent_name: 'Day 1: Install the SDK' },
  { agent_id: 'day-1-first-agent',            agent_name: 'Day 1: Your First Agent' },
  { agent_id: 'day-2-recording-actions',      agent_name: 'Day 2: Recording Actions' },
  { agent_id: 'day-2-outcomes-and-costs',      agent_name: 'Day 2: Outcomes & Costs' },
  { agent_id: 'day-3-guard-policies',         agent_name: 'Day 3: Guard Policies' },
  { agent_id: 'month-1-production-mastery',   agent_name: 'Month 1: Production Mastery' },
];

interface JourneyStep {
  action_type: string;
  declared_goal: string;
  output_summary: string;
  reasoning: string;
  metadata: string;
  risk_score: number;
  cost_estimate: number;
  tokens_in: number;
  tokens_out: number;
  status: string;
}

/* ---------- step definitions per agent ---------- */

const stepsByAgent: JourneyStep[][] = [
  // 0 — day-1-what-is-dashclaw (5 actions)
  [
    {
      action_type: 'tutorial',
      declared_goal: 'Learn what DashClaw is and how it helps govern AI agents',
      output_summary: 'DashClaw is a control plane for AI agents. It records what your agents do, enforces policies before risky actions execute, and provides compliance mapping so you can prove governance to auditors and stakeholders.',
      reasoning: 'Understanding the platform at a high level is the essential first step before diving into setup.',
      metadata: JSON.stringify({ concept: 'decision-infrastructure', analogy: 'DashClaw is to AI agents what an API gateway is to microservices — a single point of control.' }),
      risk_score: 5,
      cost_estimate: 0.002,
      tokens_in: 320,
      tokens_out: 480,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Understand the core concepts: Actions, Guards, and Policies',
      output_summary: 'Actions are recorded operations — every decision an agent makes becomes an action with a risk score, cost, and outcome. Guards evaluate actions against policies before they execute. Policies define your rules: risk thresholds, rate limits, blocklists, and approval requirements.',
      reasoning: 'These three concepts are the foundation of everything in DashClaw; all other features build on them.',
      metadata: JSON.stringify({ actions: 'Immutable decision records', guards: 'Real-time policy enforcement', policies: 'Declarative rules your team controls' }),
      risk_score: 5,
      cost_estimate: 0.002,
      tokens_in: 350,
      tokens_out: 520,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Learn how agents connect to DashClaw via API',
      output_summary: 'Agents use the DashClaw SDK to send actions to the platform via REST API. Each agent gets a unique agent_id and authenticates with an API key sent in the x-api-key header. The SDK handles serialization, retries, and error reporting automatically.',
      reasoning: 'Knowing the connection model helps you understand the data flow before writing any code.',
      metadata: JSON.stringify({ example: 'const dc = new DashClaw({ baseUrl: process.env.DASHCLAW_BASE_URL, apiKey: process.env.DASHCLAW_API_KEY, agentId: \'my-agent\' }); await dc.actions.record({ action_type: "deploy", declared_goal: "Ship v2.1" });' }),
      risk_score: 8,
      cost_estimate: 0.003,
      tokens_in: 400,
      tokens_out: 550,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Explore the dashboard and demo mode',
      output_summary: 'The dashboard shows all agent activity in real time — actions, guard decisions, compliance status, and security signals. Demo mode lets you explore every feature without configuring a database or OAuth. Toggle DASHCLAW_MODE=demo to try it locally.',
      reasoning: 'Hands-on exploration builds intuition faster than reading documentation alone.',
      metadata: JSON.stringify({ env: 'DASHCLAW_MODE=demo', url: 'http://localhost:3000/dashboard' }),
      risk_score: 5,
      cost_estimate: 0.002,
      tokens_in: 280,
      tokens_out: 410,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Preview the learning journey for the rest of the week',
      output_summary: 'Day 1 covers setup and your first agent. Day 2 teaches action recording, outcomes, and cost tracking. Day 3 introduces guard policies. Week 1 and beyond cover workspaces, compliance mapping, team routing, and production hardening.',
      reasoning: 'A clear roadmap keeps learners motivated and sets expectations for what comes next.',
      metadata: JSON.stringify({ milestones: { day1: 'Setup + first agent', day2: 'Recording + costs', day3: 'Guard policies', week1: 'Workspaces', week2: 'Compliance', week3: 'Routing', month1: 'Production' } }),
      risk_score: 5,
      cost_estimate: 0.001,
      tokens_in: 250,
      tokens_out: 380,
      status: 'completed',
    },
  ],

  // 1 — day-1-install-sdk (5 actions)
  [
    {
      action_type: 'setup',
      declared_goal: 'Install the DashClaw Node SDK',
      output_summary: 'Run npm install @dashclaw/sdk to add the SDK to your project. The package includes TypeScript types, automatic retry logic, and built-in request signing. It requires Node 18 or later.',
      reasoning: 'The SDK is the primary interface between your agent code and DashClaw; installing it is step one.',
      metadata: JSON.stringify({ command: 'npm install @dashclaw/sdk', node: '>=18', types: 'included' }),
      risk_score: 10,
      cost_estimate: 0.003,
      tokens_in: 300,
      tokens_out: 420,
      status: 'completed',
    },
    {
      action_type: 'setup',
      declared_goal: 'Configure environment variables for local development',
      output_summary: 'Create a .env file with DASHCLAW_API_KEY, DATABASE_URL, NEXTAUTH_URL, and NEXTAUTH_SECRET. Copy .env.example as a starting point. Never commit .env to version control — .gitignore already excludes it.',
      reasoning: 'Environment variables keep secrets out of source code and let you switch between environments cleanly.',
      metadata: JSON.stringify({ file: '.env.example', required: ['DASHCLAW_API_KEY', 'DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_SECRET'] }),
      risk_score: 15,
      cost_estimate: 0.002,
      tokens_in: 350,
      tokens_out: 500,
      status: 'completed',
    },
    {
      action_type: 'setup',
      declared_goal: 'Initialize the DashClaw client in your application',
      output_summary: 'Import the SDK and create a client instance with your API key. The client is reusable — create it once at startup and pass it to your agent functions. It automatically detects the DashClaw endpoint from DASHCLAW_BASE_URL or defaults to localhost:3000.',
      reasoning: 'A single shared client instance avoids redundant connections and ensures consistent configuration.',
      metadata: JSON.stringify({ code: "import { DashClaw } from 'dashclaw';\nconst dc = new DashClaw({ baseUrl: process.env.DASHCLAW_BASE_URL, apiKey: process.env.DASHCLAW_API_KEY, agentId: 'my-agent' });" }),
      risk_score: 12,
      cost_estimate: 0.003,
      tokens_in: 380,
      tokens_out: 460,
      status: 'completed',
    },
    {
      action_type: 'setup',
      declared_goal: 'Verify the SDK connection with a health check',
      output_summary: 'Call dc.health() to verify your SDK can reach the DashClaw API. A successful response returns { status: "ok", version: "..." }. If it fails, check your DASHCLAW_URL and API key. The health endpoint does not require authentication.',
      reasoning: 'Verifying connectivity early prevents confusing errors later when you start recording actions.',
      metadata: JSON.stringify({ code: 'const health = await dc.health();\nconsole.log(health); // { status: "ok" }' }),
      risk_score: 8,
      cost_estimate: 0.002,
      tokens_in: 260,
      tokens_out: 350,
      status: 'completed',
    },
    {
      action_type: 'setup',
      declared_goal: 'Install the Python SDK (optional alternative)',
      output_summary: 'If your agents run Python, install dashclaw-sdk via pip. The Python SDK mirrors the Node SDK API using snake_case naming. Both SDKs support the same features — choose the one that matches your agent runtime.',
      reasoning: 'Many AI agent frameworks use Python; offering both SDKs ensures DashClaw fits any tech stack.',
      metadata: JSON.stringify({ command: 'pip install dashclaw-sdk', naming: 'snake_case', parity: 'full' }),
      risk_score: 10,
      cost_estimate: 0.002,
      tokens_in: 290,
      tokens_out: 400,
      status: 'completed',
    },
  ],

  // 2 — day-1-first-agent (5 actions)
  [
    {
      action_type: 'setup',
      declared_goal: 'Register your first agent with DashClaw',
      output_summary: 'Every agent needs a unique agent_id. Register it by calling dc.agents.register({ agent_id: "my-first-agent", agent_name: "My First Agent" }). DashClaw creates the agent record and returns a confirmation with the org_id and creation timestamp.',
      reasoning: 'Agent registration establishes identity, which is required before any actions can be recorded.',
      metadata: JSON.stringify({ code: 'await dc.agents.register({ agent_id: "my-first-agent", agent_name: "My First Agent" });' }),
      risk_score: 15,
      cost_estimate: 0.004,
      tokens_in: 400,
      tokens_out: 520,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Understand the agent lifecycle in DashClaw',
      output_summary: 'An agent moves through states: registered, active, idle, and offline. DashClaw tracks presence automatically based on API activity. Agents that have not sent an action in 15 minutes are marked idle; after 1 hour, offline. Fleet presence shows all agents at a glance.',
      reasoning: 'Understanding lifecycle states helps operators monitor fleet health and detect stuck agents.',
      metadata: JSON.stringify({ states: ['registered', 'active', 'idle', 'offline'], idle_threshold: '15min', offline_threshold: '1h' }),
      risk_score: 8,
      cost_estimate: 0.002,
      tokens_in: 350,
      tokens_out: 480,
      status: 'completed',
    },
    {
      action_type: 'setup',
      declared_goal: 'Record your first action',
      output_summary: 'Call dc.actions.record() with an action_type, declared_goal, and systems_touched. DashClaw assigns a unique action_id, calculates a risk score, runs guard policy evaluation, and stores the complete decision record. You will see it immediately in the dashboard.',
      reasoning: 'Recording an action is the fundamental operation — everything else in DashClaw builds on this.',
      metadata: JSON.stringify({ code: 'await dc.actions.record({\n  action_type: "research",\n  declared_goal: "Analyze Q4 metrics",\n  systems_touched: ["analytics"]\n});' }),
      risk_score: 18,
      cost_estimate: 0.005,
      tokens_in: 450,
      tokens_out: 600,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Read back your recorded action from the API',
      output_summary: 'Use dc.actions.list() to fetch recent actions or dc.actions.get(actionId) for a specific one. The response includes every field: timestamps, risk score, guard decision, cost estimate, token usage, and output summary. This is how operators audit what agents did.',
      reasoning: 'Reading actions back confirms the recording worked and introduces the query API used for dashboards.',
      metadata: JSON.stringify({ code: 'const actions = await dc.actions.list({ limit: 10 });\nconsole.log(actions[0].declared_goal);' }),
      risk_score: 8,
      cost_estimate: 0.003,
      tokens_in: 320,
      tokens_out: 440,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'View your agent and action in the dashboard',
      output_summary: 'Open the dashboard at /dashboard. Your agent appears in the fleet list, and your action shows up in the action feed with its risk score, status, and timing. Click any action to see its full detail view including reasoning, guard decision, and metadata.',
      reasoning: 'The dashboard is where operators spend most of their time; seeing your data there makes the system feel real.',
      metadata: JSON.stringify({ url: '/dashboard', sections: ['fleet-presence', 'action-feed', 'action-detail'] }),
      risk_score: 5,
      cost_estimate: 0.002,
      tokens_in: 280,
      tokens_out: 390,
      status: 'completed',
    },
  ],

  // 3 — day-2-recording-actions (6 actions)
  [
    {
      action_type: 'tutorial',
      declared_goal: 'Understand the full action schema',
      output_summary: 'An action has 30+ fields organized into identity (agent_id, action_id), intent (declared_goal, reasoning, action_type), context (systems_touched, trigger, authorization_scope), risk (risk_score, confidence, reversible), outcome (status, output_summary, error_message), and cost (cost_estimate, tokens_in, tokens_out). You only need to provide a few — DashClaw fills in the rest.',
      reasoning: 'Knowing the full schema helps you decide which optional fields add value for your use case.',
      metadata: JSON.stringify({ required: ['action_type', 'declared_goal'], recommended: ['systems_touched', 'reasoning', 'trigger'] }),
      risk_score: 8,
      cost_estimate: 0.003,
      tokens_in: 500,
      tokens_out: 700,
      status: 'completed',
    },
    {
      action_type: 'configure',
      declared_goal: 'Add reasoning and trigger fields to your actions',
      output_summary: 'The reasoning field explains why your agent chose this action — it is invaluable during audits. The trigger field records what initiated the action: schedule, signal, operator, or handoff. Both fields are optional but strongly recommended for production agents.',
      reasoning: 'Reasoning captures decision context that would otherwise be lost when reviewing historical actions.',
      metadata: JSON.stringify({ code: 'await dc.actions.record({\n  action_type: "deploy",\n  declared_goal: "Ship hotfix for auth timeout",\n  reasoning: "Error rate spiked 3x in the last 10 minutes",\n  trigger: "signal"\n});' }),
      risk_score: 12,
      cost_estimate: 0.004,
      tokens_in: 420,
      tokens_out: 560,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Learn about action statuses and transitions',
      output_summary: 'Actions move through statuses: pending, running, completed, failed, cancelled, or pending_approval. Your agent sets the initial status and updates it as work progresses. The guard can override status to pending_approval if a policy requires human review before execution.',
      reasoning: 'Status tracking enables real-time dashboards and lets operators intervene on in-progress actions.',
      metadata: JSON.stringify({ statuses: ['pending', 'running', 'completed', 'failed', 'cancelled', 'pending_approval'], guard_override: 'pending_approval' }),
      risk_score: 10,
      cost_estimate: 0.003,
      tokens_in: 380,
      tokens_out: 510,
      status: 'completed',
    },
    {
      action_type: 'configure',
      declared_goal: 'Record parent-child action relationships',
      output_summary: 'Set parent_action_id to link sub-tasks to their parent action. This creates a tree of decisions that shows how a high-level goal decomposes into steps. The dashboard renders these as nested views so operators can drill into complex workflows.',
      reasoning: 'Hierarchical actions capture the full decision tree, which is critical for debugging multi-step agent workflows.',
      metadata: JSON.stringify({ code: 'const parent = await dc.actions.record({ action_type: "deploy", declared_goal: "Release v3.0" });\nawait dc.actions.record({ action_type: "test", declared_goal: "Run integration suite", parent_action_id: parent.action_id });' }),
      risk_score: 15,
      cost_estimate: 0.005,
      tokens_in: 480,
      tokens_out: 620,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Use systems_touched for impact tracking',
      output_summary: 'The systems_touched field is a JSON array listing which systems the action affects. DashClaw uses this for blast radius analysis — if an agent touches payments and auth in one action, that gets a higher risk score. Be specific: ["stripe-api", "user-auth"] is better than ["backend"].',
      reasoning: 'Accurate systems_touched data powers risk scoring and helps operators understand cross-system impact.',
      metadata: JSON.stringify({ good: ['stripe-api', 'user-auth', 'postgres-primary'], bad: ['backend', 'stuff', 'misc'] }),
      risk_score: 10,
      cost_estimate: 0.003,
      tokens_in: 360,
      tokens_out: 490,
      status: 'completed',
    },
    {
      action_type: 'configure',
      declared_goal: 'Record side effects and artifacts',
      output_summary: 'Use side_effects to list unintended consequences like cache invalidation or service restarts. Use artifacts_created to track outputs like reports or config files. Both are JSON arrays. These fields help operators understand the full impact of an action beyond its declared goal.',
      reasoning: 'Side effects and artifacts complete the action record and prevent surprises during incident review.',
      metadata: JSON.stringify({ code: 'await dc.actions.record({\n  action_type: "deploy",\n  declared_goal: "Update config",\n  side_effects: ["cache_invalidation", "restart_worker"],\n  artifacts_created: ["config.json", "deploy-log.txt"]\n});' }),
      risk_score: 18,
      cost_estimate: 0.004,
      tokens_in: 410,
      tokens_out: 540,
      status: 'running',
    },
  ],

  // 4 — day-2-outcomes-and-costs (5 actions)
  [
    {
      action_type: 'configure',
      declared_goal: 'Set up output_summary for completed actions',
      output_summary: 'When an action completes, update it with an output_summary describing the result. Keep it concise — 1-3 sentences. Good summaries make the dashboard scannable and help operators quickly assess whether an agent succeeded without reading logs.',
      reasoning: 'Output summaries are the first thing operators read when reviewing agent activity; quality here saves time.',
      metadata: JSON.stringify({ good: 'Deployed v2.1.3 to staging. All 47 integration tests passed. No config changes required.', bad: 'Done.' }), // version-hardcode-allowed
      risk_score: 10,
      cost_estimate: 0.003,
      tokens_in: 350,
      tokens_out: 460,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Handle failed actions and error messages',
      output_summary: 'When an action fails, set status to "failed" and populate error_message with a clear description. DashClaw tracks failure rates per agent and per action_type. Repeated failures trigger security signals that alert operators to investigate.',
      reasoning: 'Proper error recording enables failure analysis and helps the learning system recommend improvements.',
      metadata: JSON.stringify({ code: 'await dc.actions.update(actionId, {\n  status: "failed",\n  error_message: "Timeout after 30s waiting for database connection"\n});' }),
      risk_score: 15,
      cost_estimate: 0.004,
      tokens_in: 400,
      tokens_out: 530,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Review cost analytics on the dashboard',
      output_summary: 'The dashboard cost analytics panel shows spend by agent, by action_type, and over time. Use it to identify which agents cost the most, which action types are expensive, and whether costs are trending up or down. Set budget alerts to get notified before overspending.',
      reasoning: 'Visibility into cost trends helps teams make informed decisions about agent optimization and scaling.',
      metadata: JSON.stringify({ panels: ['spend-by-agent', 'spend-by-type', 'cost-trend', 'budget-alerts'] }),
      risk_score: 8,
      cost_estimate: 0.002,
      tokens_in: 310,
      tokens_out: 430,
      status: 'running',
    },
  ],

  // 5 — day-3-guard-policies (6 actions)
  [
    {
      action_type: 'tutorial',
      declared_goal: 'Understand what guard policies do',
      output_summary: 'Guard policies are rules that DashClaw evaluates against every action before it executes. A policy can allow, block, warn, or require approval. Policies check conditions like risk score thresholds, action types, target systems, cost limits, and time-of-day restrictions.',
      reasoning: 'Guard policies are DashClaw\'s core safety mechanism — they prevent agents from taking harmful actions.',
      metadata: JSON.stringify({ decisions: ['allow', 'block', 'warn', 'require_approval'], evaluation: 'pre-execution' }),
      risk_score: 10,
      cost_estimate: 0.003,
      tokens_in: 420,
      tokens_out: 580,
      status: 'completed',
    },
    {
      action_type: 'configure',
      declared_goal: 'Create your first guard policy',
      output_summary: 'Create a policy that blocks actions with risk_score above 80. Call dc.policies.create() with a name, description, and conditions array. Each condition specifies a field, operator, and value. Multiple conditions are AND-ed together by default.',
      reasoning: 'Hands-on policy creation builds confidence and demonstrates the declarative policy model.',
      metadata: JSON.stringify({ code: 'await dc.policies.create({\n  name: "block-high-risk",\n  description: "Block actions with risk above 80",\n  decision: "block",\n  conditions: [{ field: "risk_score", operator: "gt", value: 80 }]\n});' }),
      risk_score: 35,
      cost_estimate: 0.005,
      tokens_in: 480,
      tokens_out: 650,
      status: 'completed',
    },
    {
      action_type: 'configure',
      declared_goal: 'Create an approval policy for production deploys',
      output_summary: 'Create a policy that requires human approval for deploy actions targeting production systems. This ensures no agent can push to production without operator sign-off. Approval requests appear in the dashboard with full context for the reviewer.',
      reasoning: 'Approval gates on production actions are the most common policy pattern for enterprise teams.',
      metadata: JSON.stringify({ code: 'await dc.policies.create({\n  name: "approve-prod-deploys",\n  decision: "require_approval",\n  conditions: [\n    { field: "action_type", operator: "eq", value: "deploy" },\n    { field: "systems_touched", operator: "contains", value: "production" }\n  ]\n});' }),
      risk_score: 40,
      cost_estimate: 0.006,
      tokens_in: 520,
      tokens_out: 700,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Understand guard decision records',
      output_summary: 'Every guard evaluation produces a decision record: which policy matched, what decision was made, the reasoning, and a timestamp. Decision records are immutable and auditable. The security dashboard shows all guard decisions with filtering by agent, policy, and decision type.',
      reasoning: 'Immutable decision records create an audit trail that proves your governance is actually enforced.',
      metadata: JSON.stringify({ fields: ['policy_id', 'decision', 'reasoning', 'action_id', 'timestamp'], immutable: true }),
      risk_score: 8,
      cost_estimate: 0.003,
      tokens_in: 370,
      tokens_out: 500,
      status: 'completed',
    },
    {
      action_type: 'configure',
      declared_goal: 'Set up a cost-based guard policy',
      output_summary: 'Create a policy that warns when cost_estimate exceeds $0.50 and blocks above $2.00. Layering warn and block thresholds gives operators visibility into expensive operations while still preventing budget blowouts automatically.',
      reasoning: 'Cost-based policies prevent runaway agent spending and are easy to tune as you learn your cost profile.',
      metadata: JSON.stringify({ policies: [
        { name: 'warn-high-cost', decision: 'warn', condition: 'cost_estimate > 0.50' },
        { name: 'block-extreme-cost', decision: 'block', condition: 'cost_estimate > 2.00' }
      ] }),
      risk_score: 30,
      cost_estimate: 0.005,
      tokens_in: 440,
      tokens_out: 590,
      status: 'completed',
    },
    {
      action_type: 'tutorial',
      declared_goal: 'Test your policies with a dry-run action',
      output_summary: 'Send an action with authorization_scope set to "dry-run" to test how your policies respond without actually executing anything. DashClaw evaluates all policies and returns the guard decision, but does not persist the action or trigger side effects. Use this to validate policies before deploying them.',
      reasoning: 'Dry-run testing prevents policy misconfigurations from blocking legitimate agent work in production.',
      metadata: JSON.stringify({ code: 'const result = await dc.actions.record({\n  action_type: "deploy",\n  declared_goal: "Test policy",\n  authorization_scope: "dry-run",\n  risk_score: 90\n});\nconsole.log(result.guard_decision); // "block"' }),
      risk_score: 12,
      cost_estimate: 0.003,
      tokens_in: 400,
      tokens_out: 540,
      status: 'pending',
    },
  ],

  // 6 — month-1-production-mastery (2 actions)
  [
    {
      action_type: 'configure',
      declared_goal: 'Harden your DashClaw deployment for production',
      output_summary: 'Enable ENFORCE_AGENT_SIGNATURES to require cryptographic signing on all agent actions. Set DASHCLAW_CLOSED_ENROLLMENT to prevent unregistered agents from connecting. Optionally set DASHCLAW_GUARD_FALLBACK=block to deny (rather than the default require_approval) actions the guard cannot evaluate. These settings form the production security baseline.',
      reasoning: 'Production hardening prevents unauthorized agents and ensures fail-closed behavior under system stress.',
      metadata: JSON.stringify({ env: {
        ENFORCE_AGENT_SIGNATURES: 'true',
        DASHCLAW_CLOSED_ENROLLMENT: 'true',
        DASHCLAW_GUARD_FALLBACK: 'block'
      } }),
      risk_score: 45,
      cost_estimate: 0.008,
      tokens_in: 500,
      tokens_out: 680,
      status: 'completed',
    },
    {
      action_type: 'configure',
      declared_goal: 'Set up rate limiting to protect the API',
      output_summary: 'Configure DASHCLAW_RATE_LIMIT_MAX and DASHCLAW_RATE_LIMIT_WINDOW_MS to throttle API requests. Start with 100 requests per 60 seconds per org and adjust based on your fleet size. If you run behind a reverse proxy, set TRUST_PROXY=true so rate limiting uses the real client IP.',
      reasoning: 'Rate limiting prevents a misbehaving agent from overwhelming the API and affecting other agents.',
      metadata: JSON.stringify({ env: { DASHCLAW_RATE_LIMIT_MAX: '100', DASHCLAW_RATE_LIMIT_WINDOW_MS: '60000', TRUST_PROXY: 'true' } }),
      risk_score: 40,
      cost_estimate: 0.006,
      tokens_in: 420,
      tokens_out: 570,
      status: 'completed',
    },
  ],
];

/* ---------- build actions from step definitions ---------- */

let actionCounter = 0;
const actions: Record<string, unknown>[] = [];

for (let agentIdx = 0; agentIdx < agents.length; agentIdx++) {
  const agent = agents[agentIdx]!;
  const steps = stepsByAgent[agentIdx]!;
  // Spread agents across a timeline: earlier agents = further in the past
  const baseMs = (agents.length - agentIdx) * MS_DAY + agentIdx * MS_HOUR * 3;

  for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
    actionCounter++;
    const step = steps[stepIdx]!;
    const msAgo = baseMs - stepIdx * MS_HOUR;
    const durationMs = int(rnd, 5000, 30000);

    actions.push({
      org_id: DEMO_ORG,
      action_id: stableId('act_journey', actionCounter),
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      swarm_id: null,
      parent_action_id: null,
      action_type: step.action_type,
      declared_goal: step.declared_goal,
      reasoning: step.reasoning,
      authorization_scope: 'read-only',
      trigger: 'operator',
      systems_touched: JSON.stringify(['dashclaw']),
      input_summary: null,
      status: step.status,
      reversible: 1,
      risk_score: step.risk_score,
      confidence: int(rnd, 75, 95),
      recommendation_id: null,
      recommendation_applied: 0,
      recommendation_override_reason: null,
      output_summary: step.output_summary,
      side_effects: JSON.stringify([]),
      artifacts_created: JSON.stringify([]),
      error_message: null,
      timestamp_start: isoFromNow(msAgo),
      timestamp_end: step.status === 'running' ? null : isoFromNow(msAgo - durationMs),
      duration_ms: step.status === 'running' ? null : durationMs,
      cost_estimate: step.cost_estimate,
      tokens_in: step.tokens_in,
      tokens_out: step.tokens_out,
      signature: null,
      verified: true,
    });
  }
}

export { agents, actions };
