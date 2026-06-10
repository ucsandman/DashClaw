import { isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

interface TutorialHandoff {
  id: string;
  org_id: string;
  agent_id: string;
  agent_name: string;
  session_date: string;
  summary: string;
  open_tasks: string;
  decisions: string;
  created_at: string;
}

const handoffs: TutorialHandoff[] = [
  // ── Progressive journey agents (10) ──────────────────────────────

  {
    id: stableId('ho_tutorial', 1),
    org_id: DEMO_ORG,
    agent_id: 'day-1-what-is-dashclaw',
    agent_name: 'Day 1 — What Is DashClaw',
    session_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Today you learned: DashClaw is a decision infrastructure platform for AI agents. It records actions, enforces policies via the guard, tracks assumptions, and provides compliance mapping. Key concepts covered: actions, agents, guard, org context, API keys.',
    open_tasks: JSON.stringify([
      'Install the SDK',
      'Get your API key from Team settings',
      'Register your first agent',
    ]),
    decisions: JSON.stringify([
      'DashClaw is infrastructure, not a framework — your agents connect to it via SDK',
    ]),
    created_at: isoFromNow(30 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 2),
    org_id: DEMO_ORG,
    agent_id: 'day-1-install-sdk',
    agent_name: 'Day 1 — Install the SDK',
    session_date: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'SDK installed and configured. You set up the DashClaw client with baseUrl, apiKey, agentId, and agentName. Environment variables configured in .env.',
    open_tasks: JSON.stringify([
      'Record your first action',
      'Try the guard in warn mode',
      'Explore the dashboard',
    ]),
    decisions: JSON.stringify([
      'Using environment variables for configuration',
      'Starting with guardMode: warn',
    ]),
    created_at: isoFromNow(29 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 3),
    org_id: DEMO_ORG,
    agent_id: 'day-1-first-agent',
    agent_name: 'Day 1 — First Agent',
    session_date: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Your first agent is connected to DashClaw. You registered it with an agentId and agentName, and verified connectivity with a test action.',
    open_tasks: JSON.stringify([
      'Add action recording to main operations',
      'Set up risk scores',
      'Try different action types',
    ]),
    decisions: JSON.stringify([
      'Agent ID follows the naming convention: lowercase-with-dashes',
    ]),
    created_at: isoFromNow(28 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 4),
    org_id: DEMO_ORG,
    agent_id: 'day-2-recording-actions',
    agent_name: 'Day 2 — Recording Actions',
    session_date: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'You learned to record actions with createAction(). Each action has an actionType, declaredGoal, riskScore, and optional metadata. Actions are the foundation of DashClaw\'s decision tracking.',
    open_tasks: JSON.stringify([
      'Add outcome tracking with updateOutcome()',
      'Set meaningful risk scores',
      'Review actions in the dashboard',
    ]),
    decisions: JSON.stringify([
      'Record every significant operation as an action',
      'Use descriptive declaredGoal values',
    ]),
    created_at: isoFromNow(27 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 5),
    org_id: DEMO_ORG,
    agent_id: 'day-2-outcomes-and-costs',
    agent_name: 'Day 2 — Outcomes and Costs',
    session_date: new Date(Date.now() - 26 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Outcome tracking configured. You\'re now recording cost_estimate, tokens_in, tokens_out, and output_summary for completed actions. The token budget chart is populated.',
    open_tasks: JSON.stringify([
      'Set up guard policies',
      'Monitor daily costs',
      'Check token budget trends',
    ]),
    decisions: JSON.stringify([
      'Track cost per action for budget awareness',
      'Include token counts for LLM operations',
    ]),
    created_at: isoFromNow(26 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 6),
    org_id: DEMO_ORG,
    agent_id: 'day-3-guard-policies',
    agent_name: 'Day 3 — Guard Policies',
    session_date: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Guard policies are active. You created a risk_threshold policy (threshold: 70) and tested it. Guard mode set to \'warn\' for initial tuning.',
    open_tasks: JSON.stringify([
      'Monitor guard decisions for false positives',
      'Consider switching to enforce mode',
      'Add more policy types',
    ]),
    decisions: JSON.stringify([
      'Start with warn mode before enforce',
      'Risk threshold of 70 balances safety and productivity',
    ]),
    created_at: isoFromNow(25 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 7),
    org_id: DEMO_ORG,
    agent_id: 'week-1-workspace-setup',
    agent_name: 'Week 1 — Workspace Setup',
    session_date: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Workspace configured with handoffs, snippets, and memory monitoring. Your agents now preserve context between sessions and share reusable templates.',
    open_tasks: JSON.stringify([
      'Set up context threads for ongoing discussions',
      'Configure agent preferences',
      'Monitor memory health',
    ]),
    decisions: JSON.stringify([
      'Use handoffs at every session boundary',
      'Tag snippets for discoverability',
    ]),
    created_at: isoFromNow(21 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 8),
    org_id: DEMO_ORG,
    agent_id: 'week-2-compliance-mapping',
    agent_name: 'Week 2 — Compliance Mapping',
    session_date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Compliance frameworks mapped. SOC 2 and ISO 27001 controls linked to guard policies. Evidence collection is automatic from guard decisions.',
    open_tasks: JSON.stringify([
      'Review gap analysis for uncovered controls',
      'Generate a proof report',
      'Add evidence for manual controls',
    ]),
    decisions: JSON.stringify([
      'Guard decisions serve as primary evidence source',
      'Focus on high-priority gaps first',
    ]),
    created_at: isoFromNow(14 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 9),
    org_id: DEMO_ORG,
    agent_id: 'week-3-team-and-routing',
    agent_name: 'Week 3 — Team and Routing',
    session_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Team management and task routing configured. Team members have roles, agents are in the registry with capabilities, and tasks route automatically.',
    open_tasks: JSON.stringify([
      'Optimize routing with urgency levels',
      'Monitor agent health and load',
      'Set up team notifications',
    ]),
    decisions: JSON.stringify([
      'Use capability-based routing over manual assignment',
      'Set max_concurrent to prevent agent overload',
    ]),
    created_at: isoFromNow(7 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 10),
    org_id: DEMO_ORG,
    agent_id: 'month-1-production-mastery',
    agent_name: 'Month 1 — Production Mastery',
    session_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Production-ready. Guard in enforce mode, compliance mapped, routing active, webhooks configured, learning analytics tracking agent improvement.',
    open_tasks: JSON.stringify([
      'Review learning curves monthly',
      'Tune policies based on false positive rate',
      'Scale to additional agents',
    ]),
    decisions: JSON.stringify([
      'Enforce mode is safe when thresholds are well-tuned',
      'Monthly reviews keep policies current',
    ]),
    created_at: isoFromNow(1 * MS_DAY),
  },

  // ── Persona agents (8) ──────────────────────────────────────────

  {
    id: stableId('ho_tutorial', 11),
    org_id: DEMO_ORG,
    agent_id: 'new-operator',
    agent_name: 'New Operator',
    session_date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Completed onboarding. Comfortable navigating the dashboard, reading action feeds, and understanding guard decisions.',
    open_tasks: JSON.stringify([
      'Explore workspace features',
      'Try creating a handoff',
      'Review security signals',
    ]),
    decisions: JSON.stringify([
      'Dashboard layout set to Operations Focus',
      'Agent filter helps focus on specific agents',
    ]),
    created_at: isoFromNow(20 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 12),
    org_id: DEMO_ORG,
    agent_id: 'security-lead',
    agent_name: 'Security Lead',
    session_date: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Security posture established. Guard enforce mode active, agent pairing configured, signature enforcement enabled, security signals monitored.',
    open_tasks: JSON.stringify([
      'Set up webhook alerts for red signals',
      'Review pairing expiry schedule',
      'Audit high-risk action patterns',
    ]),
    decisions: JSON.stringify([
      'Enforce agent signatures in production',
      'Red signals trigger immediate review',
    ]),
    created_at: isoFromNow(18 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 13),
    org_id: DEMO_ORG,
    agent_id: 'compliance-officer',
    agent_name: 'Compliance Officer',
    session_date: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Compliance mapping complete for SOC 2 and ISO 27001. Evidence collection automated, gap analysis reviewed, proof report ready for auditors.',
    open_tasks: JSON.stringify([
      'Map remaining frameworks (NIST, EU AI Act)',
      'Schedule quarterly compliance reviews',
      'Document manual evidence',
    ]),
    decisions: JSON.stringify([
      'Automated evidence preferred over manual',
      'Gap analysis drives policy priorities',
    ]),
    created_at: isoFromNow(16 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 14),
    org_id: DEMO_ORG,
    agent_id: 'platform-engineer',
    agent_name: 'Platform Engineer',
    session_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Platform integration complete. SDK integrated, webhooks active, workflows defined, task routing operational.',
    open_tasks: JSON.stringify([
      'Optimize webhook reliability',
      'Add error handling for edge cases',
      'Monitor learning analytics',
    ]),
    decisions: JSON.stringify([
      'Use SDK error types for graceful failure handling',
      'Webhooks for real-time notifications',
    ]),
    created_at: isoFromNow(15 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 15),
    org_id: DEMO_ORG,
    agent_id: 'team-admin',
    agent_name: 'Team Admin',
    session_date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Team setup complete. Members invited, roles assigned, integrations configured, API keys managed.',
    open_tasks: JSON.stringify([
      'Review access patterns monthly',
      'Rotate API keys quarterly',
      'Monitor team activity logs',
    ]),
    decisions: JSON.stringify([
      'Least-privilege roles by default',
      'Integration credentials stored securely',
    ]),
    created_at: isoFromNow(12 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 16),
    org_id: DEMO_ORG,
    agent_id: 'sdk-developer',
    agent_name: 'SDK Developer',
    session_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'SDK integration patterns established. Node and Python clients working, error handling in place, action recording comprehensive.',
    open_tasks: JSON.stringify([
      'Add guard checks to risky operations',
      'Implement assumption tracking',
      'Set up handoff automation',
    ]),
    decisions: JSON.stringify([
      'Wrap all significant operations with createAction/updateOutcome',
      'Handle GuardBlockedError gracefully',
    ]),
    created_at: isoFromNow(10 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 17),
    org_id: DEMO_ORG,
    agent_id: 'incident-responder',
    agent_name: 'Incident Responder',
    session_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Incident response playbook established. Can trace blocked actions, analyze guard decisions, and respond to security signals.',
    open_tasks: JSON.stringify([
      'Create runbook for common incidents',
      'Set up PagerDuty webhook',
      'Practice signal triage',
    ]),
    decisions: JSON.stringify([
      'Always check guard decision reasoning first',
      'Escalate red signals within 15 minutes',
    ]),
    created_at: isoFromNow(5 * MS_DAY),
  },

  {
    id: stableId('ho_tutorial', 18),
    org_id: DEMO_ORG,
    agent_id: 'auditor',
    agent_name: 'Auditor',
    session_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    summary:
      'Audit framework ready. Evidence trails verified, compliance reports generated, control coverage validated.',
    open_tasks: JSON.stringify([
      'Schedule next audit cycle',
      'Verify evidence completeness',
      'Review policy effectiveness',
    ]),
    decisions: JSON.stringify([
      'Guard decision logs are primary evidence',
      'Quarterly audit cadence recommended',
    ]),
    created_at: isoFromNow(3 * MS_DAY),
  },
];

export { handoffs };
