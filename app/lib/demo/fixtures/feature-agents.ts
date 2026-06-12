import { lcg, pick, int, isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

const rnd = lcg(0xFEA00001);

/* ------------------------------------------------------------------ */
/*  Agent definitions – 28 feature deep-dive tutorial agents          */
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
  { id: 'actions-cost-tracking',   name: 'Tutorial: Cost Tracking' },
  // Guard area
  { id: 'guard-policies',          name: 'Tutorial: Guard Policies' },
  { id: 'guard-decisions',         name: 'Tutorial: Guard Decisions' },
  { id: 'guard-semantic-rules',    name: 'Tutorial: Semantic Guard Rules' },
  // Workspace area
  { id: 'workspace-handoffs',      name: 'Tutorial: Handoffs' },
  { id: 'workspace-snippets',      name: 'Tutorial: Snippets' },
  { id: 'workspace-memory',        name: 'Tutorial: Memory Management' },
  { id: 'workspace-preferences',   name: 'Tutorial: Agent Preferences' },
  { id: 'workspace-context-threads', name: 'Tutorial: Context Threads' },
  // Compliance area
  { id: 'compliance-frameworks',   name: 'Tutorial: Compliance Frameworks' },
  { id: 'compliance-controls',     name: 'Tutorial: Framework Controls' },
  { id: 'compliance-evidence',     name: 'Tutorial: Evidence Collection' },
  { id: 'compliance-gap-analysis', name: 'Tutorial: Gap Analysis' },
  // Security area
  { id: 'security-signals',        name: 'Tutorial: Security Signals' },
  { id: 'security-agent-pairing',  name: 'Tutorial: Agent Pairing' },
  { id: 'security-signatures',     name: 'Tutorial: Agent Signatures' },
  // Routing area
  { id: 'routing-agent-registry',  name: 'Tutorial: Agent Registry' },
  { id: 'routing-task-queue',      name: 'Tutorial: Task Queue' },
  { id: 'routing-health',          name: 'Tutorial: Health Monitoring' },
  // Learning area
  { id: 'learning-decisions',      name: 'Tutorial: Decision Tracking' },
  { id: 'learning-recommendations', name: 'Tutorial: Recommendations' },
  { id: 'learning-episodes',       name: 'Tutorial: Learning Episodes' },
  // Messaging area
  { id: 'messaging-threads',       name: 'Tutorial: Message Threads' },
  { id: 'messaging-shared-docs',   name: 'Tutorial: Shared Documents' },
  // Automation area
  { id: 'webhooks-setup',          name: 'Tutorial: Webhooks' },
  { id: 'workflows-and-schedules', name: 'Tutorial: Workflows & Schedules' },
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

  'actions-cost-tracking': [
    {
      declared_goal: 'Record cost and token usage on actions',
      reasoning: 'Cost tracking enables budget enforcement and spend visibility',
      output_summary: 'Every action records cost_estimate (USD), tokens_in (prompt tokens), and tokens_out (completion tokens). Set these when creating or completing an action: dc.updateAction(actionId, { cost_estimate: 0.0142, tokens_in: 850, tokens_out: 320, status: "completed" }).',
      risk_score: 5,
    },
    {
      declared_goal: 'Monitor token budgets and set spending limits',
      reasoning: 'Runaway token usage is the most common agent cost problem',
      output_summary: 'The token budget view aggregates tokens_in and tokens_out across all agents by day. Set a daily budget with a rate_limit policy targeting cost: dc.createPolicy({ policy_type: "rate_limit", config: { metric: "daily_cost", limit: 5.00 } }). The guard will block actions once the budget is exhausted.',
      risk_score: 10,
    },
    {
      declared_goal: 'View daily cost aggregation and trends',
      reasoning: 'Cost trends reveal optimization opportunities and anomalies',
      output_summary: 'GET /api/actions/costs returns daily aggregated cost data including total_cost, total_tokens_in, total_tokens_out, and action_count grouped by date and agent. Use this to identify which agents are most expensive and whether costs are trending up or down over time.',
      risk_score: 8,
    },
    {
      declared_goal: 'Set up cost alerts and anomaly detection',
      reasoning: 'Proactive cost alerts prevent budget overruns',
      output_summary: 'Combine cost tracking with webhooks for alerts. Subscribe to the action.cost_exceeded event: dc.createWebhook({ event: "action.cost_exceeded", url: "https://your-alerting.example/hook" }). The webhook fires when any single action exceeds a configured cost threshold.',
      risk_score: 12,
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

  /* ── Workspace area ───────────────────────────────────────────── */
  'workspace-handoffs': [
    {
      declared_goal: 'Understand session boundaries and why handoffs matter',
      reasoning: 'Handoffs preserve context across agent session boundaries',
      output_summary: 'A handoff captures the state of an agent session for the next session to pick up. Without handoffs, agents lose context between runs. Each handoff includes a summary of what happened, open tasks that remain, and key decisions that were made during the session.',
      risk_score: 5,
    },
    {
      declared_goal: 'Learn the handoff fields: summary, openTasks, decisions',
      reasoning: 'Each field serves a distinct purpose in context transfer',
      output_summary: 'summary is a free-text recap of the session. openTasks is an array of items the next session should address. decisions is an array of choices made and their rationale. Example: { summary: "Deployed v2.1, found 3 flaky tests", openTasks: ["Fix test_auth_flow"], decisions: ["Skipped migration, deferred to next sprint"] }.',
      risk_score: 8,
    },
    {
      declared_goal: 'Create a handoff using the SDK',
      reasoning: 'Programmatic handoff creation ensures nothing is lost between sessions',
      output_summary: 'Use dc.createHandoff({ agent_id: "my-agent", summary: "Completed security audit of auth module", openTasks: ["Review rate limiting config", "Update CSP headers"], decisions: ["Kept existing session TTL of 24h"] }). The handoff is timestamped and linked to the agent workspace.',
      risk_score: 10,
    },
    {
      declared_goal: 'Retrieve and act on previous handoffs in a new session',
      reasoning: 'Consuming handoffs is how agents maintain continuity',
      output_summary: 'At session start, call dc.listHandoffs({ agent_id: "my-agent", limit: 1 }) to get the most recent handoff. Parse openTasks to build your session agenda. Reference decisions to avoid re-litigating settled choices. The digest view also surfaces the latest handoff automatically.',
      risk_score: 5,
    },
  ],

  'workspace-snippets': [
    {
      declared_goal: 'Save a code snippet for reuse across sessions',
      reasoning: 'Snippets prevent agents from regenerating common code patterns',
      output_summary: 'Use dc.createSnippet({ agent_id: "my-agent", title: "Postgres health check", content: "SELECT 1 AS ok;", language: "sql", tags: ["health", "postgres"] }). The snippet is stored with a sn_ prefixed ID and can be retrieved by tag or title in future sessions.',
      risk_score: 5,
    },
    {
      declared_goal: 'Tag and organize snippets for fast retrieval',
      reasoning: 'Good tagging makes snippets discoverable across large collections',
      output_summary: 'Tags are string arrays attached to each snippet. Use consistent naming: prefixed tags like "lang:sql", "scope:infra", "team:platform". Filter snippets with dc.listSnippets({ tags: ["lang:sql"] }). The use_count field tracks how often each snippet is referenced.',
      risk_score: 8,
    },
    {
      declared_goal: 'Track snippet usage with the use_count field',
      reasoning: 'Usage tracking reveals which snippets are valuable vs unused',
      output_summary: 'Each time a snippet is referenced, call dc.incrementSnippetUse(snippetId) to bump use_count. Sort by use_count descending to find your most valuable snippets. Snippets with use_count of 0 after 30 days are candidates for cleanup.',
      risk_score: 5,
    },
    {
      declared_goal: 'Share snippets across multiple agents in a workspace',
      reasoning: 'Shared snippets reduce duplication and promote consistency',
      output_summary: 'Snippets are scoped to the organization, not individual agents. Any agent in the same org can retrieve snippets created by another agent. Use tags like "shared:true" to mark snippets intended for cross-agent use. The workspace snippets tab shows all org-level snippets.',
      risk_score: 10,
    },
  ],

  'workspace-memory': [
    {
      declared_goal: 'Understand memory health: file count, line count, size, duplicates',
      reasoning: 'Memory health directly affects agent performance and context utilization',
      output_summary: 'Memory health tracks four metrics: total files in the agent context, total lines across those files, aggregate size in bytes, and duplicate content ratio. A healthy agent has fewer than 50 context files, under 10,000 lines, and a duplicate ratio below 5%.',
      risk_score: 8,
    },
    {
      declared_goal: 'Detect and resolve duplicate content in agent memory',
      reasoning: 'Duplicates waste context window tokens and cause inconsistent behavior',
      output_summary: 'DashClaw scans agent context files for duplicate paragraphs and code blocks. The memory health endpoint returns a duplicates array with file pairs and similarity scores. Resolve duplicates by consolidating into a single source file and removing redundant copies.',
      risk_score: 15,
    },
    {
      declared_goal: 'Monitor staleness and refresh stale context',
      reasoning: 'Stale context leads to outdated assumptions and incorrect decisions',
      output_summary: 'Each context file tracks last_modified and last_referenced timestamps. Files not referenced in 7+ days are flagged as stale. The memory health score penalizes staleness. Refresh stale files by re-ingesting current data or archiving files that are no longer relevant.',
      risk_score: 12,
    },
    {
      declared_goal: 'Optimize the memory health score',
      reasoning: 'A high memory health score correlates with better agent decision quality',
      output_summary: 'The memory health score (0-100) combines freshness (40%), duplicate ratio (30%), and size efficiency (30%). Improve it by removing stale files, deduplicating content, and keeping total context under recommended limits. Scores above 80 indicate a well-maintained agent context.',
      risk_score: 10,
    },
  ],

  'workspace-preferences': [
    {
      declared_goal: 'Record agent observations and behavioral patterns',
      reasoning: 'Tracking preferences helps operators understand agent tendencies',
      output_summary: 'Agent preferences capture observed behaviors: communication style, risk tolerance, preferred tools, and common patterns. Use dc.updatePreferences(agentId, { observations: ["Prefers incremental deploys", "Asks for confirmation on destructive ops"] }) to record them.',
      risk_score: 5,
    },
    {
      declared_goal: 'Track agent mood and approach across sessions',
      reasoning: 'Mood and approach tracking reveals agent consistency and drift',
      output_summary: 'The preferences object includes mood (cautious, confident, uncertain) and approach (methodical, exploratory, conservative) fields. These are operator-assigned labels that help teams calibrate expectations. Update after each session based on observed behavior.',
      risk_score: 8,
    },
    {
      declared_goal: 'Use preferences to customize agent behavior',
      reasoning: 'Preferences feed into context-aware prompting and policy evaluation',
      output_summary: 'Agents can read their own preferences with dc.getPreferences(agentId) at session start. Use them to adjust behavior: if mood is "cautious", increase risk_score estimates by 10%. If approach is "conservative", prefer reversible operations. Preferences are suggestions, not hard constraints.',
      risk_score: 10,
    },
  ],

  'workspace-context-threads': [
    {
      declared_goal: 'Create a context thread for organizing related observations',
      reasoning: 'Context threads group related information for focused retrieval',
      output_summary: 'Use dc.createContextThread({ agent_id: "my-agent", title: "Auth module security review", description: "Observations from reviewing the authentication system" }). The thread gets a ct_ prefixed ID. Add entries to build a threaded discussion around a topic.',
      risk_score: 5,
    },
    {
      declared_goal: 'Add entries with importance scores to a context thread',
      reasoning: 'Importance scores help agents prioritize which context to load',
      output_summary: 'Add entries with dc.addContextEntry(threadId, { content: "Rate limiting uses fixed window, not sliding", importance: 8 }). Importance ranges from 1 (nice-to-know) to 10 (critical). When loading context, agents can filter by importance >= 7 to get only essential information.',
      risk_score: 8,
    },
    {
      declared_goal: 'Retrieve and filter context thread entries',
      reasoning: 'Efficient retrieval prevents context window bloat',
      output_summary: 'Use dc.getContextThread(threadId) to get the full thread with all entries. Filter with dc.listContextEntries(threadId, { min_importance: 5 }) for only significant entries. Threads are sorted by creation date. Use this to build focused context windows for specific tasks.',
      risk_score: 10,
    },
    {
      declared_goal: 'Link context threads to actions and handoffs',
      reasoning: 'Cross-referencing threads with actions creates a knowledge graph',
      output_summary: 'Reference context thread IDs in action reasoning or handoff summaries to create traceability. Example: reasoning: "Based on findings in ct_042, the rate limiter needs migration". This lets operators trace decisions back to the observations that informed them.',
      risk_score: 12,
    },
    {
      declared_goal: 'Archive and manage old context threads',
      reasoning: 'Archiving prevents stale context from polluting active workspaces',
      output_summary: 'Archive completed threads with dc.updateContextThread(threadId, { status: "archived" }). Archived threads are excluded from default queries but remain searchable. Review active threads weekly and archive those related to completed work. This keeps the workspace focused.',
      risk_score: 8,
    },
  ],

  /* ── Compliance area ──────────────────────────────────────────── */
  'compliance-frameworks': [
    {
      declared_goal: 'View supported compliance frameworks in DashClaw',
      reasoning: 'Framework awareness is the first step toward compliance mapping',
      output_summary: 'DashClaw supports five compliance frameworks: SOC 2 Type II (trust service criteria), ISO 27001 (information security management), NIST AI RMF (AI risk management), EU AI Act (European AI regulation), and GDPR (data protection). Each framework has pre-loaded controls.',
      risk_score: 5,
    },
    {
      declared_goal: 'Understand how DashClaw maps guard policies to framework controls',
      reasoning: 'Automatic mapping reduces the manual burden of compliance tracking',
      output_summary: 'DashClaw automatically links guard policies to relevant framework controls. A risk_threshold policy maps to SOC 2 CC7.2 (risk management) and NIST AI RMF GOVERN-1. A rate_limit policy maps to SOC 2 CC6.1 (access controls). View mappings in the compliance dashboard.',
      risk_score: 10,
    },
    {
      declared_goal: 'Generate a compliance report for auditors',
      reasoning: 'Auditors need formatted evidence of control implementation',
      output_summary: 'Use dc.generateComplianceReport({ framework: "soc2" }) to produce a report showing all controls, their coverage status, mapped policies, and evidence. The report includes timestamps, policy configurations, and guard decision samples as evidence of active enforcement.',
      risk_score: 15,
    },
  ],

  'compliance-controls': [
    {
      declared_goal: 'List controls for a specific framework',
      reasoning: 'Understanding individual controls is essential for gap remediation',
      output_summary: 'Use dc.listControls({ framework: "soc2" }) to get all controls. Each control has a control_id (e.g., "CC6.1"), title, description, and status (covered, partial, gap). SOC 2 has ~60 controls, ISO 27001 has ~114 controls from Annex A, and NIST AI RMF has ~70 subcategories.',
      risk_score: 5,
    },
    {
      declared_goal: 'Understand control status: covered, partial, and gap',
      reasoning: 'Status tells you where compliance effort is still needed',
      output_summary: '"covered" means the control has at least one active policy and evidence. "partial" means a policy exists but evidence is incomplete or the policy does not fully address the control. "gap" means no policy or evidence exists. Aim for zero gaps and minimal partials.',
      risk_score: 8,
    },
    {
      declared_goal: 'Map a guard policy to a specific control',
      reasoning: 'Explicit mapping ensures policies serve dual duty as compliance evidence',
      output_summary: 'Use dc.mapPolicyToControl({ policy_id: "pol_001", control_id: "CC7.2", framework: "soc2" }) to create an explicit mapping. The compliance dashboard updates automatically. One policy can map to multiple controls across different frameworks.',
      risk_score: 12,
    },
    {
      declared_goal: 'Track control coverage over time',
      reasoning: 'Coverage trends show whether compliance posture is improving or degrading',
      output_summary: 'The compliance dashboard shows coverage percentage per framework over time. DashClaw snapshots coverage daily. A drop in coverage (e.g., a policy was disabled) triggers a compliance_coverage_decreased event that can fire a webhook alert.',
      risk_score: 10,
    },
  ],

  'compliance-evidence': [
    {
      declared_goal: 'Understand how evidence is collected automatically',
      reasoning: 'Automatic evidence collection dramatically reduces audit preparation time',
      output_summary: 'DashClaw automatically generates compliance evidence from guard decisions. Every time the guard evaluates an action against a policy mapped to a control, the decision becomes evidence. Evidence includes the timestamp, action details, policy evaluated, and decision result.',
      risk_score: 5,
    },
    {
      declared_goal: 'Add manual evidence for controls without automated mapping',
      reasoning: 'Some controls require evidence from outside the DashClaw system',
      output_summary: 'Use dc.addEvidence({ control_id: "CC1.1", framework: "soc2", type: "manual", description: "Annual security training completed", url: "https://training.example/cert/2025" }). Manual evidence supplements automated evidence for controls that require human processes.',
      risk_score: 10,
    },
    {
      declared_goal: 'Review evidence quality and completeness',
      reasoning: 'Auditors evaluate evidence quality, not just existence',
      output_summary: 'Evidence quality depends on recency, specificity, and volume. A control with 100 guard decisions from the last 30 days is stronger than one with 2 decisions from 6 months ago. The compliance dashboard highlights controls with stale or thin evidence.',
      risk_score: 12,
    },
    {
      declared_goal: 'Export evidence for external audit tools',
      reasoning: 'Many organizations use dedicated GRC platforms for audit management',
      output_summary: 'Use dc.exportEvidence({ framework: "soc2", format: "json" }) to export all evidence for a framework. The export includes control mappings, policy snapshots, guard decision logs, and timestamps. CSV format is also available for spreadsheet-based audit workflows.',
      risk_score: 8,
    },
  ],

  'compliance-gap-analysis': [
    {
      declared_goal: 'Run a gap analysis across all frameworks',
      reasoning: 'Gap analysis identifies exactly where compliance effort is needed',
      output_summary: 'The gap analysis view shows all controls with status "gap" across every active framework. Each gap includes the control description, what would satisfy it, and suggested remediation. Use dc.getGapAnalysis({ framework: "soc2" }) to get gaps for a specific framework.',
      risk_score: 10,
    },
    {
      declared_goal: 'Understand remediation paths for common gaps',
      reasoning: 'Clear remediation paths accelerate compliance achievement',
      output_summary: 'DashClaw suggests remediation for each gap. For access control gaps: create a risk_threshold policy. For monitoring gaps: enable security signals. For incident response gaps: configure webhooks for block decisions. Each suggestion includes the specific policy config to create.',
      risk_score: 15,
    },
    {
      declared_goal: 'Track coverage percentages and improvement over time',
      reasoning: 'Coverage metrics make compliance progress measurable',
      output_summary: 'Coverage percentage = (covered_controls + 0.5 * partial_controls) / total_controls. Track this weekly. A healthy trajectory shows steady improvement. The compliance dashboard charts coverage over time per framework. Target 90%+ for frameworks you are actively certifying against.',
      risk_score: 8,
    },
    {
      declared_goal: 'Prioritize gaps by business impact and remediation effort',
      reasoning: 'Not all gaps are equally important or equally easy to fix',
      output_summary: 'Prioritize gaps that block certification (e.g., SOC 2 CC6.1 access control is mandatory) and gaps with easy remediation (creating a single policy vs building a new process). The gap analysis view includes an effort estimate (low/medium/high) and criticality rating for each gap.',
      risk_score: 12,
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

  /* ── Routing area ─────────────────────────────────────────────── */
  'routing-agent-registry': [
    {
      declared_goal: 'Register an agent in the routing system',
      reasoning: 'Registration makes agents available for task assignment',
      output_summary: 'Use dc.registerAgent({ agent_id: "my-agent", capabilities: ["code-review", "testing", "deployment"], status: "active", max_concurrent: 3 }). The agent appears in the registry and can receive tasks matching its capabilities. Status can be active, idle, or offline.',
      risk_score: 10,
    },
    {
      declared_goal: 'Define agent capabilities for skill-based routing',
      reasoning: 'Capabilities determine which tasks an agent is eligible to handle',
      output_summary: 'Capabilities are string arrays describing what an agent can do. Use consistent naming: "code-review", "security-audit", "deploy-staging", "data-analysis". Tasks specify required_skills that must match agent capabilities. An agent only receives tasks it is capable of handling.',
      risk_score: 8,
    },
    {
      declared_goal: 'Update agent status and availability',
      reasoning: 'Accurate status prevents routing tasks to unavailable agents',
      output_summary: 'Update with dc.updateAgentStatus(agentId, { status: "idle", current_load: 0 }). Status values: "active" (currently working), "idle" (available for tasks), "offline" (not accepting tasks). The router skips offline agents and prefers idle agents over active ones.',
      risk_score: 10,
    },
    {
      declared_goal: 'Set max_concurrent to control agent workload',
      reasoning: 'Concurrent task limits prevent agent overload and quality degradation',
      output_summary: 'max_concurrent defines how many tasks an agent can handle simultaneously. Set it based on agent capacity: 1 for serial agents, 3-5 for parallel agents. The router will not assign new tasks when current_load >= max_concurrent. Monitor current_load to tune this value.',
      risk_score: 12,
    },
  ],

  'routing-task-queue': [
    {
      declared_goal: 'Create a task and add it to the queue',
      reasoning: 'Tasks are the unit of work that gets routed to agents',
      output_summary: 'Use dc.createTask({ title: "Review PR #42", required_skills: ["code-review"], urgency: "high", description: "Security-sensitive authentication changes" }). The task enters the queue with status "pending". The router will assign it to the best matching available agent.',
      risk_score: 10,
    },
    {
      declared_goal: 'Understand urgency levels and their effect on routing',
      reasoning: 'Urgency determines task priority in the queue',
      output_summary: 'Four urgency levels: "critical" (immediate, preempts other work), "high" (next available slot), "medium" (standard queue order), "low" (best-effort, only when idle). Critical tasks can interrupt active agents if configured. The router processes higher urgency tasks first.',
      risk_score: 8,
    },
    {
      declared_goal: 'Monitor task assignment and completion',
      reasoning: 'Queue monitoring prevents tasks from getting stuck',
      output_summary: 'Use dc.listTasks({ status: "pending" }) to see unassigned tasks. Tasks stuck in pending for longer than expected may need capability adjustment or more agents. dc.getTask(taskId) shows assignment history, current assignee, and time-in-queue metrics.',
      risk_score: 12,
    },
    {
      declared_goal: 'Handle task reassignment and escalation',
      reasoning: 'Tasks sometimes need to move to a different agent or escalate',
      output_summary: 'Reassign with dc.reassignTask(taskId, { agent_id: "other-agent", reason: "Original agent offline" }). Escalate urgency with dc.updateTask(taskId, { urgency: "critical" }). Failed tasks can be retried with dc.retryTask(taskId). Each state change is logged for audit.',
      risk_score: 15,
    },
    {
      declared_goal: 'Configure routing rules for automatic assignment',
      reasoning: 'Automated routing reduces operator overhead for routine tasks',
      output_summary: 'Routing rules match tasks to agents by required_skills, urgency, and agent availability. The router prefers agents with fewer current tasks and higher skill match. Round-robin breaks ties. Configure with dc.setRoutingConfig({ prefer_idle: true, max_queue_depth: 10 }).',
      risk_score: 18,
    },
  ],

  'routing-health': [
    {
      declared_goal: 'Monitor agent health checks and heartbeats',
      reasoning: 'Health monitoring prevents routing tasks to unhealthy agents',
      output_summary: 'Agents send heartbeats via dc.heartbeat({ agent_id: "my-agent", current_load: 2, status: "active" }). Agents that miss 3 consecutive heartbeats (default 30s interval) are marked offline. The health dashboard shows last_heartbeat, current_load, and uptime for each agent.',
      risk_score: 10,
    },
    {
      declared_goal: 'Configure health check intervals and thresholds',
      reasoning: 'Proper health check config balances responsiveness with overhead',
      output_summary: 'Set heartbeat interval with dc.configure({ heartbeatInterval: 30000 }). Configure failure threshold (missed heartbeats before offline) with the routing config. Shorter intervals detect failures faster but increase network overhead. 30s interval with 3-miss threshold is the recommended default.',
      risk_score: 12,
    },
    {
      declared_goal: 'Use health data for load balancing decisions',
      reasoning: 'Load-aware routing prevents hot spots and improves throughput',
      output_summary: 'The router uses current_load / max_concurrent as the load factor. Agents with load factor < 0.5 are preferred. When all agents are above 0.8 load factor, the router queues tasks instead of overloading agents. Monitor fleet-wide load factor on the routing dashboard.',
      risk_score: 15,
    },
    {
      declared_goal: 'Set up health alerts for fleet-wide issues',
      reasoning: 'Fleet health degradation requires operator intervention',
      output_summary: 'Subscribe to fleet health events: dc.createWebhook({ event: "routing.agent_offline", url: "https://alerts.example/routing" }). Also monitor routing.queue_depth_exceeded (too many pending tasks) and routing.no_capable_agent (task has skills no agent provides). These signal capacity or configuration issues.',
      risk_score: 18,
    },
  ],

  /* ── Learning area ────────────────────────────────────────────── */
  'learning-decisions': [
    {
      declared_goal: 'Record a decision with confidence and outcome',
      reasoning: 'Decision tracking builds an institutional memory of what worked',
      output_summary: 'Use dc.recordDecision({ agent_id: "my-agent", decision: "Chose blue-green deployment over rolling update", confidence: 75, outcome: "success", tags: ["deployment", "strategy"] }). Decisions are searchable by tag and outcome, building a knowledge base of what approaches work.',
      risk_score: 8,
    },
    {
      declared_goal: 'Track decision confidence and calibration over time',
      reasoning: 'Well-calibrated confidence scores make agent recommendations trustworthy',
      output_summary: 'Compare stated confidence against actual outcomes. An agent that says 90% confidence but succeeds only 60% of the time is overconfident. The learning dashboard shows calibration curves: expected success rate vs actual success rate at each confidence level.',
      risk_score: 10,
    },
    {
      declared_goal: 'Query decision history by tags and outcomes',
      reasoning: 'Historical decisions inform future strategy choices',
      output_summary: 'Use dc.listDecisions({ tags: ["deployment"], outcome: "success" }) to find what worked. Filter by time range to see recent patterns. Cross-reference with action risk_scores to understand which decisions correlate with higher or lower risk outcomes.',
      risk_score: 5,
    },
    {
      declared_goal: 'Link decisions to actions for full traceability',
      reasoning: 'Decision-to-action linking creates an auditable decision chain',
      output_summary: 'Include action_id when recording decisions: dc.recordDecision({ action_id: "act_042", decision: "Approved migration", confidence: 85 }). This links the strategic decision to the operational action. The workspace digest surfaces linked decisions alongside their actions.',
      risk_score: 12,
    },
  ],

  'learning-recommendations': [
    {
      declared_goal: 'Understand how recommendations are generated from action history',
      reasoning: 'Recommendations turn historical data into actionable guidance',
      output_summary: 'DashClaw generates recommendations by analyzing action patterns. If deploy actions with risk_score > 50 fail 40% of the time, a recommendation suggests lowering the threshold or adding an approval step. Recommendations include a confidence score and the data that supports them.',
      risk_score: 10,
    },
    {
      declared_goal: 'Apply or override a recommendation on an action',
      reasoning: 'Recommendations are suggestions, not mandates — agents decide whether to follow them',
      output_summary: 'When creating an action, include recommendation_id and recommendation_applied: 1 to indicate you followed a recommendation. Set recommendation_applied: 0 and recommendation_override_reason: "Not applicable to this context" to document why you diverged. Both paths are tracked.',
      risk_score: 8,
    },
    {
      declared_goal: 'Track recommendation adoption rates across agents',
      reasoning: 'Adoption rates reveal whether recommendations are useful or ignored',
      output_summary: 'The learning dashboard shows recommendation adoption rate: (applied / total_offered) * 100. High adoption (>70%) suggests recommendations are relevant. Low adoption (<30%) suggests they need recalibration. Track per-agent and per-recommendation-type for granular insights.',
      risk_score: 12,
    },
    {
      declared_goal: 'Provide feedback on recommendation quality',
      reasoning: 'Feedback loops improve recommendation accuracy over time',
      output_summary: 'After completing an action where you applied a recommendation, record whether it helped: dc.feedbackOnRecommendation(recId, { helpful: true, notes: "Reduced deployment failures by catching config drift" }). This feedback refines future recommendations for similar scenarios.',
      risk_score: 10,
    },
  ],

  'learning-episodes': [
    {
      declared_goal: 'Track agent learning curves over time',
      reasoning: 'Learning curves show whether agents are improving at their tasks',
      output_summary: 'A learning episode captures an agent improvement arc: initial performance baseline, training or adjustment period, and post-change performance. Track metrics like failure rate, average risk_score accuracy, and task completion time. The learning dashboard charts these curves.',
      risk_score: 10,
    },
    {
      declared_goal: 'Measure agent maturity with velocity and acceleration metrics',
      reasoning: 'Velocity and acceleration quantify how fast agents are improving',
      output_summary: 'Learning velocity measures improvement rate: (current_performance - baseline) / time. Learning acceleration measures whether improvement is speeding up or slowing down. Positive acceleration means the agent is learning faster. Plateaus (zero acceleration) may signal the need for new training data.',
      risk_score: 12,
    },
    {
      declared_goal: 'Compare learning episodes across agents',
      reasoning: 'Cross-agent comparison identifies best practices and struggling agents',
      output_summary: 'The learning dashboard compares episodes across agents for the same task type. If Agent A reaches 90% accuracy in 2 days but Agent B takes 2 weeks, investigate what Agent A does differently. Cross-agent comparison drives fleet-wide improvement strategies.',
      risk_score: 8,
    },
    {
      declared_goal: 'Set learning milestones and track progress',
      reasoning: 'Milestones make abstract improvement goals concrete and measurable',
      output_summary: 'Define milestones like "achieve 95% deploy success rate" or "reduce average risk_score estimation error below 10 points". Track progress with dc.setLearningMilestone({ agent_id: "my-agent", metric: "deploy_success_rate", target: 0.95 }). The dashboard shows progress toward each milestone.',
      risk_score: 10,
    },
  ],

  /* ── Messaging area ───────────────────────────────────────────── */
  'messaging-threads': [
    {
      declared_goal: 'Create a message thread between agents and operators',
      reasoning: 'Threaded messaging organizes agent-operator communication',
      output_summary: 'Use dc.createMessageThread({ title: "Deploy v3.0 coordination", participants: ["agent-deploy", "agent-test", "operator-1"] }). The thread gets an mt_ prefixed ID. All participants can post messages. Threads keep deploy discussions separate from security discussions.',
      risk_score: 5,
    },
    {
      declared_goal: 'Post messages with different types: info, action, question, status, lesson',
      reasoning: 'Message types enable filtering and prioritization',
      output_summary: 'Use dc.postMessage(threadId, { type: "question", content: "Should we proceed with the migration tonight?" }). Types: "info" (FYI), "action" (something that happened), "question" (needs response), "status" (progress update), "lesson" (learned something). Filter by type to find questions needing answers.',
      risk_score: 8,
    },
    {
      declared_goal: 'Manage thread participants and permissions',
      reasoning: 'Participant management controls who sees and contributes to discussions',
      output_summary: 'Add participants with dc.addThreadParticipant(threadId, { participant_id: "agent-security" }). Remove with dc.removeThreadParticipant(threadId, participantId). Only participants can read and post to a thread. The thread creator can manage participants.',
      risk_score: 10,
    },
    {
      declared_goal: 'Search and filter messages across threads',
      reasoning: 'Cross-thread search finds relevant information regardless of where it was posted',
      output_summary: 'Use dc.searchMessages({ query: "migration", type: "question", date_from: "2025-01-01" }) to find messages across all threads the caller has access to. Results include the thread context so you can follow the full conversation. Useful for finding past decisions and discussions.',
      risk_score: 5,
    },
  ],

  'messaging-shared-docs': [
    {
      declared_goal: 'Create a shared document in a message thread',
      reasoning: 'Shared documents enable collaborative editing within agent workflows',
      output_summary: 'Use dc.createSharedDoc(threadId, { title: "Runbook: Database Migration", content: "## Steps\\n1. Take snapshot...", format: "markdown" }). The document is attached to the thread and versioned. All thread participants can view and edit it.',
      risk_score: 8,
    },
    {
      declared_goal: 'Track document versions and changes',
      reasoning: 'Version tracking provides accountability and rollback capability',
      output_summary: 'Every edit creates a new version. Use dc.getDocVersions(docId) to list all versions with timestamps and author IDs. Compare versions with dc.diffDocVersions(docId, { from: 1, to: 3 }) to see what changed. Restore a previous version with dc.restoreDocVersion(docId, versionNumber).',
      risk_score: 10,
    },
    {
      declared_goal: 'Collaborate on documents across agents',
      reasoning: 'Multi-agent document editing builds shared understanding',
      output_summary: 'Multiple agents can edit the same document. Use dc.updateSharedDoc(docId, { content: updatedContent }) to save changes. Last-write-wins for concurrent edits. For critical documents, use message thread coordination to avoid conflicts. Document edits are logged in the thread as "action" type messages.',
      risk_score: 12,
    },
  ],

  /* ── Automation area ──────────────────────────────────────────── */
  'webhooks-setup': [
    {
      declared_goal: 'Subscribe to DashClaw events via webhooks',
      reasoning: 'Webhooks enable real-time integration with external systems',
      output_summary: 'Use dc.createWebhook({ event: "action.completed", url: "https://your-service.example/hook", secret: "whsec_..." }). Supported events: action.completed, action.blocked, guard.decision, security.signal.red, security.signal.amber, compliance.coverage_changed. The secret is used for payload signature verification.',
      risk_score: 15,
    },
    {
      declared_goal: 'Verify webhook delivery and inspect payloads',
      reasoning: 'Delivery verification ensures your integrations are receiving events',
      output_summary: 'Use dc.listWebhookDeliveries(webhookId) to see delivery history. Each entry shows HTTP status code, response time, payload sent, and any error. Failed deliveries (non-2xx) are retried up to 3 times with exponential backoff (1min, 5min, 30min).',
      risk_score: 10,
    },
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
    {
      declared_goal: 'Manage webhook lifecycle: enable, disable, delete',
      reasoning: 'Webhook management prevents unnecessary traffic and stale integrations',
      output_summary: 'Disable temporarily with dc.updateWebhook(webhookId, { enabled: false }). Re-enable with enabled: true. Delete with dc.deleteWebhook(webhookId). List all with dc.listWebhooks(). Disabled webhooks are preserved for audit. Clean up webhooks when decommissioning integrations.',
      risk_score: 8,
    },
  ],

  'workflows-and-schedules': [
    {
      declared_goal: 'Define a workflow with chained steps',
      reasoning: 'Workflows automate multi-step agent operations',
      output_summary: 'Use dc.createWorkflow({ name: "Daily Digest", steps: [{ action_type: "research", agent_id: "agent-research" }, { action_type: "build", agent_id: "agent-writer" }, { action_type: "review", agent_id: "agent-reviewer" }] }). Steps execute in order. Each step can pass output to the next step as input.',
      risk_score: 15,
    },
    {
      declared_goal: 'Schedule workflows with cron expressions',
      reasoning: 'Scheduled workflows enable hands-off recurring operations',
      output_summary: 'Attach a schedule with dc.scheduleWorkflow(workflowId, { cron: "0 9 * * 1-5", timezone: "America/Los_Angeles" }). This runs the workflow at 9 AM Pacific on weekdays. Standard cron syntax with timezone support. Use dc.listSchedules() to see all active schedules.',
      risk_score: 18,
    },
    {
      declared_goal: 'Monitor workflow execution and handle step failures',
      reasoning: 'Execution monitoring prevents silent workflow failures',
      output_summary: 'Use dc.getWorkflowExecution(executionId) to see step-by-step progress. Each step shows status (pending/running/completed/failed), duration, and output. On step failure, the workflow pauses. Configure on_failure: "skip" to continue, "abort" to stop, or "retry" to retry the failed step.',
      risk_score: 20,
    },
    {
      declared_goal: 'Track workflow execution history and performance',
      reasoning: 'Execution history reveals reliability trends and bottlenecks',
      output_summary: 'Use dc.listWorkflowExecutions(workflowId) to see all runs. Each execution shows total duration, per-step timing, success/failure status, and trigger (scheduled vs manual). Identify slow steps and failure patterns. The workflow dashboard charts success rate and duration over time.',
      risk_score: 10,
    },
    {
      declared_goal: 'Trigger workflows manually or from events',
      reasoning: 'Event-driven workflows respond to real-time conditions',
      output_summary: 'Trigger manually with dc.runWorkflow(workflowId, { input: { pr_number: 42 } }). Trigger from events by combining webhooks with workflows: configure a webhook to call your trigger endpoint on action.blocked, which then runs an escalation workflow. This enables reactive automation.',
      risk_score: 22,
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
