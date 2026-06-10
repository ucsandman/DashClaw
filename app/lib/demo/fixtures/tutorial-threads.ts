import { isoFromNow, stableId, DEMO_ORG, MS_HOUR, MS_DAY } from './shared-utils';

interface Persona {
  id: string;
  name: string;
}

interface ThreadMessageDef {
  sender: Persona;
  type: string;
  direction: 'inbound' | 'outbound';
  content: string;
  offsetMs: number;
}

interface ThreadDef {
  n: number;
  subject: string;
  participants: Persona[];
  status: string;
  createdDaysAgo: number;
  updatedHoursAgo: number;
  messages: ThreadMessageDef[];
}

/* ------------------------------------------------------------------ */
/*  Persona agents used across tutorial conversations                 */
/* ------------------------------------------------------------------ */
const personas: Record<string, Persona> = {
  newOperator:       { id: 'new-operator',       name: 'New Operator' },
  platformEngineer:  { id: 'platform-engineer',  name: 'Platform Engineer' },
  securityLead:      { id: 'security-lead',      name: 'Security Lead' },
  complianceOfficer: { id: 'compliance-officer',  name: 'Compliance Officer' },
  auditor:           { id: 'auditor',             name: 'Auditor' },
  incidentResponder: { id: 'incident-responder',  name: 'Incident Responder' },
  sdkDeveloper:      { id: 'sdk-developer',       name: 'SDK Developer' },
  teamAdmin:         { id: 'team-admin',           name: 'Team Admin' },
};

const p = personas as {
  newOperator: Persona;
  platformEngineer: Persona;
  securityLead: Persona;
  complianceOfficer: Persona;
  auditor: Persona;
  incidentResponder: Persona;
  sdkDeveloper: Persona;
  teamAdmin: Persona;
};

/* ------------------------------------------------------------------ */
/*  Thread definitions                                                */
/* ------------------------------------------------------------------ */
const threadDefs: ThreadDef[] = [
  {
    n: 1,
    subject: 'Getting Started with DashClaw',
    participants: [p.newOperator, p.platformEngineer],
    status: 'resolved',
    createdDaysAgo: 14,
    updatedHoursAgo: 312,
    messages: [
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'I just signed up for DashClaw. Where do I start?', offsetMs: 0 },
      { sender: p.platformEngineer, type: 'info',     direction: 'outbound', content: 'Welcome! First, grab your API key from the Team settings page. You\'ll need it for SDK initialization.', offsetMs: 3 * 60000 },
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'Got it. Do I install the SDK in my agent\'s codebase?', offsetMs: 8 * 60000 },
      { sender: p.platformEngineer, type: 'info',     direction: 'outbound', content: 'Exactly — npm install dashclaw for Node, or pip install dashclaw for Python. Then initialize with your base URL and API key.', offsetMs: 12 * 60000 },
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'What should I record first?', offsetMs: 18 * 60000 },
      { sender: p.platformEngineer, type: 'lesson',   direction: 'outbound', content: 'Start with your agent\'s main operations — any action that has side effects, costs money, or involves risk. Use dc.createAction() with an actionType and declaredGoal.', offsetMs: 22 * 60000 },
      { sender: p.newOperator,      type: 'status',   direction: 'inbound',  content: 'This is really helpful, thanks!', offsetMs: 30 * 60000 },
    ],
  },
  {
    n: 2,
    subject: 'Setting Up Your First Guard Policy',
    participants: [p.securityLead, p.newOperator],
    status: 'resolved',
    createdDaysAgo: 13,
    updatedHoursAgo: 290,
    messages: [
      { sender: p.securityLead, type: 'question', direction: 'outbound', content: 'Let\'s set up a guard policy. What\'s your biggest concern?', offsetMs: 0 },
      { sender: p.newOperator,  type: 'info',     direction: 'inbound',  content: 'I want to prevent high-risk actions from running without approval.', offsetMs: 5 * 60000 },
      { sender: p.securityLead, type: 'lesson',   direction: 'outbound', content: 'Perfect — create a risk_threshold policy. Set the threshold to 70. Any action with risk_score >= 70 will require approval.', offsetMs: 9 * 60000 },
      { sender: p.newOperator,  type: 'question', direction: 'inbound',  content: 'What about the guard mode? I see off, warn, and enforce.', offsetMs: 15 * 60000 },
      { sender: p.securityLead, type: 'lesson',   direction: 'outbound', content: 'Start with \'warn\' mode — it logs policy matches but doesn\'t block. Once you\'re confident in your thresholds, switch to \'enforce\'.', offsetMs: 19 * 60000 },
      { sender: p.newOperator,  type: 'question', direction: 'inbound',  content: 'Can I test a policy before deploying it?', offsetMs: 25 * 60000 },
      { sender: p.securityLead, type: 'info',     direction: 'outbound', content: 'Yes! Use the policy test endpoint. Send a test input and see what decision the guard would make without actually enforcing it.', offsetMs: 30 * 60000 },
    ],
  },
  {
    n: 3,
    subject: 'Mapping SOC 2 Controls',
    participants: [p.complianceOfficer, p.auditor],
    status: 'resolved',
    createdDaysAgo: 12,
    updatedHoursAgo: 260,
    messages: [
      { sender: p.complianceOfficer, type: 'question', direction: 'inbound',  content: 'We need to map our DashClaw policies to SOC 2 controls.', offsetMs: 0 },
      { sender: p.auditor,           type: 'info',     direction: 'outbound', content: 'Start with the compliance dashboard. DashClaw supports SOC 2, ISO 27001, NIST AI RMF, EU AI Act, and GDPR.', offsetMs: 4 * 60000 },
      { sender: p.complianceOfficer, type: 'question', direction: 'inbound',  content: 'How does the mapping work?', offsetMs: 10 * 60000 },
      { sender: p.auditor,           type: 'lesson',   direction: 'outbound', content: 'Each guard policy can be linked to framework controls. When the guard enforces a policy, that enforcement becomes evidence for the control.', offsetMs: 15 * 60000 },
      { sender: p.complianceOfficer, type: 'question', direction: 'inbound',  content: 'So guard decisions automatically generate compliance evidence?', offsetMs: 20 * 60000 },
      { sender: p.auditor,           type: 'lesson',   direction: 'outbound', content: 'Exactly. Every block, warn, and approval decision is recorded with timestamps and reasoning — ready for audit.', offsetMs: 24 * 60000 },
      { sender: p.complianceOfficer, type: 'question', direction: 'inbound',  content: 'What about gaps?', offsetMs: 30 * 60000 },
      { sender: p.auditor,           type: 'info',     direction: 'outbound', content: 'The gap analysis view shows controls without policy coverage. Focus on those to improve your compliance posture.', offsetMs: 35 * 60000 },
    ],
  },
  {
    n: 4,
    subject: 'Debugging a Blocked Action',
    participants: [p.incidentResponder, p.securityLead],
    status: 'resolved',
    createdDaysAgo: 11,
    updatedHoursAgo: 240,
    messages: [
      { sender: p.incidentResponder, type: 'question', direction: 'inbound',  content: 'My deploy-bot just got blocked by the guard. How do I investigate?', offsetMs: 0 },
      { sender: p.securityLead,      type: 'info',     direction: 'outbound', content: 'Check the Guard Decisions page. Filter by agent_id to see what policy triggered the block.', offsetMs: 2 * 60000 },
      { sender: p.incidentResponder, type: 'status',   direction: 'inbound',  content: 'I see it — risk_threshold policy blocked it because risk_score was 85.', offsetMs: 7 * 60000 },
      { sender: p.securityLead,      type: 'lesson',   direction: 'outbound', content: 'Look at the decision reasoning. It tells you exactly which policy matched and why.', offsetMs: 10 * 60000 },
      { sender: p.incidentResponder, type: 'question', direction: 'inbound',  content: 'Can I override the block?', offsetMs: 15 * 60000 },
      { sender: p.securityLead,      type: 'info',     direction: 'outbound', content: 'If the action is legitimate, you can approve it from the pending approvals queue. The approval is recorded as evidence.', offsetMs: 18 * 60000 },
    ],
  },
  {
    n: 5,
    subject: 'Integrating the Node SDK',
    participants: [p.sdkDeveloper, p.platformEngineer],
    status: 'resolved',
    createdDaysAgo: 10,
    updatedHoursAgo: 210,
    messages: [
      { sender: p.sdkDeveloper,      type: 'question', direction: 'inbound',  content: 'I\'m adding DashClaw to our Node.js agent. What\'s the setup?', offsetMs: 0 },
      { sender: p.platformEngineer,  type: 'info',     direction: 'outbound', content: 'Install with npm install dashclaw, then initialize: new DashClaw({ baseUrl, apiKey, agentId, agentName }).', offsetMs: 3 * 60000 },
      { sender: p.sdkDeveloper,      type: 'question', direction: 'inbound',  content: 'What about guard mode?', offsetMs: 8 * 60000 },
      { sender: p.platformEngineer,  type: 'lesson',   direction: 'outbound', content: 'Set guardMode to \'warn\' initially. The SDK will call the guard before risky operations and log the result.', offsetMs: 12 * 60000 },
      { sender: p.sdkDeveloper,      type: 'question', direction: 'inbound',  content: 'How do I record actions?', offsetMs: 18 * 60000 },
      { sender: p.platformEngineer,  type: 'lesson',   direction: 'outbound', content: 'Use dc.createAction({ actionType, declaredGoal, riskScore }). After the operation, call dc.updateOutcome(actionId, { status, outputSummary }).', offsetMs: 22 * 60000 },
      { sender: p.sdkDeveloper,      type: 'question', direction: 'inbound',  content: 'What errors should I handle?', offsetMs: 28 * 60000 },
      { sender: p.platformEngineer,  type: 'info',     direction: 'outbound', content: 'Watch for GuardBlockedError (action was blocked by policy) and ApprovalDeniedError (human-in-the-loop denied). Both mean the operation should not proceed.', offsetMs: 32 * 60000 },
    ],
  },
  {
    n: 6,
    subject: 'Setting Up Task Routing',
    participants: [p.platformEngineer, p.teamAdmin],
    status: 'open',
    createdDaysAgo: 9,
    updatedHoursAgo: 48,
    messages: [
      { sender: p.platformEngineer, type: 'question', direction: 'inbound',  content: 'I want to automatically assign tasks to the right agent based on skills.', offsetMs: 0 },
      { sender: p.teamAdmin,        type: 'info',     direction: 'outbound', content: 'Register your agents in the Agent Registry with their capabilities — things like \'code-review\', \'deploy\', \'security-scan\'.', offsetMs: 5 * 60000 },
      { sender: p.platformEngineer, type: 'question', direction: 'inbound',  content: 'Then how do tasks get assigned?', offsetMs: 12 * 60000 },
      { sender: p.teamAdmin,        type: 'lesson',   direction: 'outbound', content: 'Create a task with required_skills and urgency. DashClaw matches it to available agents with matching capabilities.', offsetMs: 16 * 60000 },
      { sender: p.platformEngineer, type: 'question', direction: 'inbound',  content: 'What if no agent has the required skills?', offsetMs: 22 * 60000 },
      { sender: p.teamAdmin,        type: 'info',     direction: 'outbound', content: 'The task stays in the queue as \'pending\'. You\'ll see it in the routing dashboard. You can also set max_concurrent to prevent overloading agents.', offsetMs: 27 * 60000 },
    ],
  },
  {
    n: 7,
    subject: 'Managing Your Team',
    participants: [p.teamAdmin, p.newOperator],
    status: 'resolved',
    createdDaysAgo: 8,
    updatedHoursAgo: 170,
    messages: [
      { sender: p.teamAdmin,   type: 'info',     direction: 'outbound', content: 'Let me show you the team management features.', offsetMs: 0 },
      { sender: p.newOperator, type: 'question', direction: 'inbound',  content: 'How do I add someone to the workspace?', offsetMs: 4 * 60000 },
      { sender: p.teamAdmin,   type: 'info',     direction: 'outbound', content: 'Go to Team settings and send an invite. You can set their role to \'admin\' or \'member\'.', offsetMs: 8 * 60000 },
      { sender: p.newOperator, type: 'question', direction: 'inbound',  content: 'What\'s the difference?', offsetMs: 13 * 60000 },
      { sender: p.teamAdmin,   type: 'lesson',   direction: 'outbound', content: 'Admins can manage team members, change settings, and configure integrations. Members can view the dashboard and manage their own agents.', offsetMs: 17 * 60000 },
      { sender: p.newOperator, type: 'question', direction: 'inbound',  content: 'Can I connect external services?', offsetMs: 22 * 60000 },
      { sender: p.teamAdmin,   type: 'info',     direction: 'outbound', content: 'Yes — the integrations panel supports GitHub OAuth, Slack API, and other providers. Each connection is stored securely.', offsetMs: 26 * 60000 },
    ],
  },
  {
    n: 8,
    subject: 'Understanding Security Signals',
    participants: [p.securityLead, p.incidentResponder],
    status: 'open',
    createdDaysAgo: 7,
    updatedHoursAgo: 24,
    messages: [
      { sender: p.securityLead,      type: 'info',     direction: 'outbound', content: 'DashClaw generates security signals when it detects concerning patterns.', offsetMs: 0 },
      { sender: p.incidentResponder, type: 'question', direction: 'inbound',  content: 'What types of signals are there?', offsetMs: 5 * 60000 },
      { sender: p.securityLead,      type: 'lesson',   direction: 'outbound', content: 'Three main types: high_impact_low_oversight (risky actions without human review), repeated_failures (agents failing the same operation), and stale_loop (unresolved follow-ups that are aging out).', offsetMs: 10 * 60000 },
      { sender: p.incidentResponder, type: 'question', direction: 'inbound',  content: 'How do I respond to a red signal?', offsetMs: 16 * 60000 },
      { sender: p.securityLead,      type: 'action',   direction: 'outbound', content: 'Red signals need immediate attention. Review the agent\'s recent actions, check guard decisions, and consider tightening the guard policy.', offsetMs: 20 * 60000 },
      { sender: p.incidentResponder, type: 'question', direction: 'inbound',  content: 'Can I get notified automatically?', offsetMs: 26 * 60000 },
      { sender: p.securityLead,      type: 'info',     direction: 'outbound', content: 'Set up a webhook with the \'high_impact_low_oversight\' event. DashClaw will POST to your endpoint whenever a red signal fires.', offsetMs: 30 * 60000 },
    ],
  },
  {
    n: 9,
    subject: 'Workspace Best Practices',
    participants: [p.platformEngineer, p.newOperator],
    status: 'resolved',
    createdDaysAgo: 6,
    updatedHoursAgo: 120,
    messages: [
      { sender: p.platformEngineer, type: 'info',     direction: 'outbound', content: 'Your workspace is where agents store context between sessions.', offsetMs: 0 },
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'What should I put in handoffs?', offsetMs: 6 * 60000 },
      { sender: p.platformEngineer, type: 'lesson',   direction: 'outbound', content: 'Three things: summary (what happened), open_tasks (what\'s left), and decisions (key choices made). This gives the next session full context.', offsetMs: 10 * 60000 },
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'What about snippets?', offsetMs: 16 * 60000 },
      { sender: p.platformEngineer, type: 'lesson',   direction: 'outbound', content: 'Save reusable code blocks, config templates, or command sequences. Tag them for easy search. DashClaw tracks use_count so you know what\'s popular.', offsetMs: 20 * 60000 },
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'And memory health?', offsetMs: 25 * 60000 },
      { sender: p.platformEngineer, type: 'info',     direction: 'outbound', content: 'Monitor your agent\'s context window. DashClaw tracks file counts, sizes, duplicates, and staleness. If memory health drops, it\'s time to clean up.', offsetMs: 30 * 60000 },
    ],
  },
  {
    n: 10,
    subject: 'Compliance Evidence Collection',
    participants: [p.complianceOfficer, p.auditor],
    status: 'open',
    createdDaysAgo: 5,
    updatedHoursAgo: 12,
    messages: [
      { sender: p.complianceOfficer, type: 'question', direction: 'inbound',  content: 'How does DashClaw help with audit evidence?', offsetMs: 0 },
      { sender: p.auditor,           type: 'lesson',   direction: 'outbound', content: 'Every guard decision is recorded with timestamp, policy reference, action details, and reasoning. That\'s your evidence trail.', offsetMs: 4 * 60000 },
      { sender: p.complianceOfficer, type: 'question', direction: 'inbound',  content: 'Is that enough for SOC 2?', offsetMs: 10 * 60000 },
      { sender: p.auditor,           type: 'info',     direction: 'outbound', content: 'Guard decisions cover access control and change management controls. Combine with action logs for a complete picture.', offsetMs: 14 * 60000 },
      { sender: p.complianceOfficer, type: 'question', direction: 'inbound',  content: 'How do I generate a report?', offsetMs: 20 * 60000 },
      { sender: p.auditor,           type: 'info',     direction: 'outbound', content: 'The compliance dashboard has a proof report generator. It maps your policies to framework controls and shows coverage with evidence counts.', offsetMs: 25 * 60000 },
    ],
  },
  {
    n: 11,
    subject: 'Webhooks and Automation',
    participants: [p.sdkDeveloper, p.platformEngineer],
    status: 'open',
    createdDaysAgo: 4,
    updatedHoursAgo: 6,
    messages: [
      { sender: p.sdkDeveloper,     type: 'question', direction: 'inbound',  content: 'I want to get notified when specific events happen in DashClaw.', offsetMs: 0 },
      { sender: p.platformEngineer, type: 'info',     direction: 'outbound', content: 'Create a webhook with your endpoint URL and select which events to subscribe to.', offsetMs: 3 * 60000 },
      { sender: p.sdkDeveloper,     type: 'question', direction: 'inbound',  content: 'What events are available?', offsetMs: 9 * 60000 },
      { sender: p.platformEngineer, type: 'lesson',   direction: 'outbound', content: 'You can subscribe to \'all\' events, or specific ones like \'high_impact_low_oversight\', \'repeated_failures\', and \'stale_loop\'.', offsetMs: 13 * 60000 },
      { sender: p.sdkDeveloper,     type: 'question', direction: 'inbound',  content: 'What about delivery reliability?', offsetMs: 19 * 60000 },
      { sender: p.platformEngineer, type: 'info',     direction: 'outbound', content: 'DashClaw tracks delivery attempts with status codes and response times. Failed deliveries are retried automatically.', offsetMs: 23 * 60000 },
    ],
  },
  {
    n: 12,
    subject: 'Learning From Agent Decisions',
    participants: [p.newOperator, p.platformEngineer],
    status: 'open',
    createdDaysAgo: 3,
    updatedHoursAgo: 2,
    messages: [
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'I see a \'Learning\' section in the dashboard. What does it track?', offsetMs: 0 },
      { sender: p.platformEngineer, type: 'info',     direction: 'outbound', content: 'DashClaw records decisions, lessons, and recommendations. Over time, it builds a picture of what works and what doesn\'t.', offsetMs: 4 * 60000 },
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'How do recommendations work?', offsetMs: 10 * 60000 },
      { sender: p.platformEngineer, type: 'lesson',   direction: 'outbound', content: 'Based on past outcomes, DashClaw suggests approaches for specific action types. You can track adoption rates and see if recommendations improve success.', offsetMs: 15 * 60000 },
      { sender: p.newOperator,      type: 'question', direction: 'inbound',  content: 'What about the learning curve?', offsetMs: 21 * 60000 },
      { sender: p.platformEngineer, type: 'lesson',   direction: 'outbound', content: 'Learning episodes track your agents\' performance over time. You\'ll see maturity levels (developing → competent → proficient), velocity, and acceleration.', offsetMs: 26 * 60000 },
      { sender: p.newOperator,      type: 'status',   direction: 'inbound',  content: 'That\'s really useful for knowing when an agent is ready for production.', offsetMs: 32 * 60000 },
      { sender: p.platformEngineer, type: 'info',     direction: 'outbound', content: 'Exactly. When an agent\'s maturity score is high and velocity is positive, it\'s a good sign.', offsetMs: 36 * 60000 },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Build threads and messages arrays                                 */
/* ------------------------------------------------------------------ */
const threads: Array<Record<string, unknown>> = [];
const messages: Array<Record<string, unknown>> = [];
let msgCounter = 0;

for (const def of threadDefs) {
  const thread = {
    id: stableId('mt_tutorial', def.n),
    org_id: DEMO_ORG,
    subject: def.subject,
    participants: JSON.stringify(def.participants.map((a) => a.id)),
    status: def.status,
    created_at: isoFromNow(def.createdDaysAgo * MS_DAY),
    updated_at: isoFromNow(def.updatedHoursAgo * MS_HOUR),
  };
  threads.push(thread);

  for (const msg of def.messages) {
    msgCounter++;
    messages.push({
      id: stableId('msg_tutorial', msgCounter),
      org_id: DEMO_ORG,
      thread_id: thread.id,
      sender_id: msg.sender.id,
      sender_name: msg.sender.name,
      type: msg.type,
      content: msg.content,
      direction: msg.direction,
      created_at: isoFromNow(def.createdDaysAgo * MS_DAY - msg.offsetMs),
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Shared docs                                                       */
/* ------------------------------------------------------------------ */
const sharedDocs = [
  {
    id: stableId('sd_tutorial', 1),
    org_id: DEMO_ORG,
    title: 'DashClaw Quick Start Guide',
    content: [
      '# DashClaw Quick Start Guide',
      '',
      '## 1. Get Your API Key',
      'Navigate to **Team > Settings** and copy your API key.',
      '',
      '## 2. Install the SDK',
      '```bash',
      '# Node.js',
      'npm install dashclaw',
      '',
      '# Python',
      'pip install dashclaw',
      '```',
      '',
      '## 3. Initialize',
      '```javascript',
      'const dc = new DashClaw({',
      '  baseUrl: "https://your-dashclaw.vercel.app",',
      '  apiKey: process.env.DASHCLAW_API_KEY,',
      '  agentId: "my-agent",',
      '  agentName: "My Agent",',
      '});',
      '```',
      '',
      '## 4. Record Your First Action',
      '```javascript',
      'const action = await dc.createAction({',
      '  actionType: "deploy",',
      '  declaredGoal: "Deploy v2.1 to staging",',
      '  riskScore: 45,',
      '});',
      '```',
      '',
      '## 5. Update the Outcome',
      '```javascript',
      'await dc.updateOutcome(action.id, {',
      '  status: "completed",',
      '  outputSummary: "Deployed successfully to staging",',
      '});',
      '```',
      '',
      '## Next Steps',
      '- Set up a guard policy to enforce risk thresholds',
      '- Configure webhooks for real-time alerts',
      '- Map your policies to compliance frameworks',
    ].join('\n'),
    version: 1,
    created_by: p.platformEngineer.id,
    created_at: isoFromNow(14 * MS_DAY),
    updated_at: isoFromNow(280 * MS_HOUR),
  },
  {
    id: stableId('sd_tutorial', 2),
    org_id: DEMO_ORG,
    title: 'Guard Policy Reference',
    content: [
      '# Guard Policy Reference',
      '',
      '## Policy Types',
      '',
      '### risk_threshold',
      'Blocks or warns when an action\'s `risk_score` exceeds the configured threshold.',
      '- **threshold** (number): Score boundary (0-100)',
      '- **mode**: `off` | `warn` | `enforce`',
      '',
      '### action_type_block',
      'Prevents specific action types from executing.',
      '- **blocked_types** (string[]): Action types to block',
      '- **mode**: `off` | `warn` | `enforce`',
      '',
      '### scope_restriction',
      'Limits actions to approved scopes.',
      '- **allowed_scopes** (string[]): Permitted scope values',
      '- **mode**: `off` | `warn` | `enforce`',
      '',
      '## Guard Modes',
      '',
      '| Mode | Behavior |',
      '|------|----------|',
      '| `off` | Policy inactive, no evaluation |',
      '| `warn` | Evaluates and logs, does not block |',
      '| `enforce` | Evaluates and blocks on match |',
      '',
      '## Testing a Policy',
      'Use `POST /api/guard/test` with a sample input to preview the decision without enforcement.',
      '',
      '## Best Practices',
      '- Start with `warn` mode to understand traffic patterns',
      '- Review guard decisions weekly before switching to `enforce`',
      '- Link policies to compliance controls for automatic evidence',
    ].join('\n'),
    version: 1,
    created_by: p.securityLead.id,
    created_at: isoFromNow(13 * MS_DAY),
    updated_at: isoFromNow(250 * MS_HOUR),
  },
  {
    id: stableId('sd_tutorial', 3),
    org_id: DEMO_ORG,
    title: 'SDK Method Cheat Sheet',
    content: [
      '# SDK Method Cheat Sheet',
      '',
      '## Action Recording',
      '',
      '| Node.js | Python | Description |',
      '|---------|--------|-------------|',
      '| `dc.createAction(opts)` | `dc.create_action(**opts)` | Record a new action |',
      '| `dc.updateOutcome(id, opts)` | `dc.update_outcome(id, **opts)` | Update action result |',
      '| `dc.listActions(filters)` | `dc.list_actions(**filters)` | Query actions |',
      '',
      '## Guard',
      '',
      '| Node.js | Python | Description |',
      '|---------|--------|-------------|',
      '| `dc.evaluateGuard(input)` | `dc.evaluate_guard(input)` | Check guard policy |',
      '| `dc.listGuardDecisions()` | `dc.list_guard_decisions()` | Query decisions |',
      '',
      '## Workspace',
      '',
      '| Node.js | Python | Description |',
      '|---------|--------|-------------|',
      '| `dc.getDigest()` | `dc.get_digest()` | Get agent digest |',
      '| `dc.createHandoff(opts)` | `dc.create_handoff(**opts)` | Create a handoff |',
      '| `dc.saveSnippet(opts)` | `dc.save_snippet(**opts)` | Save a snippet |',
      '',
      '## Messages',
      '',
      '| Node.js | Python | Description |',
      '|---------|--------|-------------|',
      '| `dc.sendMessage(threadId, opts)` | `dc.send_message(thread_id, **opts)` | Send a message |',
      '',
      '## Security',
      '',
      '| Node.js | Python | Description |',
      '|---------|--------|-------------|',
      '| `dc.getSignals()` | `dc.get_signals()` | Get security signals |',
      '| `dc.listFindings()` | `dc.list_findings()` | List security findings |',
    ].join('\n'),
    version: 1,
    created_by: p.sdkDeveloper.id,
    created_at: isoFromNow(10 * MS_DAY),
    updated_at: isoFromNow(200 * MS_HOUR),
  },
  {
    id: stableId('sd_tutorial', 4),
    org_id: DEMO_ORG,
    title: 'Compliance Mapping Guide',
    content: [
      '# Compliance Mapping Guide',
      '',
      '## Supported Frameworks',
      '',
      '| Framework | Controls | Focus Area |',
      '|-----------|----------|------------|',
      '| SOC 2 Type II | CC1-CC9, A1, PI1 | Trust service criteria |',
      '| ISO 27001 | Annex A controls | Information security |',
      '| NIST AI RMF | MAP, MEASURE, MANAGE, GOVERN | AI risk management |',
      '| EU AI Act | Articles 9-15 | High-risk AI systems |',
      '| GDPR | Articles 5, 25, 32, 35 | Data protection |',
      '',
      '## How Mapping Works',
      '',
      '1. **Define policies** — Create guard policies in DashClaw',
      '2. **Link to controls** — Map each policy to the framework controls it satisfies',
      '3. **Enforce** — Switch to enforce mode to generate evidence',
      '4. **Collect evidence** — Guard decisions are automatically captured',
      '5. **Report** — Generate proof reports for auditors',
      '',
      '## Gap Analysis',
      '',
      'The compliance dashboard highlights:',
      '- **Covered controls**: Have at least one linked policy in enforce mode',
      '- **Partial controls**: Have linked policies but in warn mode only',
      '- **Uncovered controls**: No linked policies — these are gaps',
      '',
      '## Tips',
      '- Start with SOC 2 CC6 (logical access) — guard policies map directly',
      '- Use action logs alongside guard decisions for CC8 (change management)',
      '- Review gap analysis monthly to track coverage improvements',
    ].join('\n'),
    version: 1,
    created_by: p.complianceOfficer.id,
    created_at: isoFromNow(8 * MS_DAY),
    updated_at: isoFromNow(150 * MS_HOUR),
  },
  {
    id: stableId('sd_tutorial', 5),
    org_id: DEMO_ORG,
    title: 'Troubleshooting Common Issues',
    content: [
      '# Troubleshooting Common Issues',
      '',
      '## "Action was blocked by guard"',
      '**Cause**: A guard policy in enforce mode matched the action.',
      '**Fix**: Check Guard Decisions for the policy that triggered. Either lower the risk_score on your action or adjust the policy threshold.',
      '',
      '## "401 Unauthorized" on API calls',
      '**Cause**: Missing or invalid API key.',
      '**Fix**: Ensure your `x-api-key` header contains a valid DashClaw API key. Check Team > Settings for your current key.',
      '',
      '## "Agent not found" when creating actions',
      '**Cause**: The agent_id hasn\'t been registered yet.',
      '**Fix**: DashClaw auto-registers agents on first action if `DASHCLAW_CLOSED_ENROLLMENT` is not set. If closed enrollment is enabled, register the agent first via the Agent Registry.',
      '',
      '## Webhook not delivering',
      '**Cause**: Endpoint unreachable or returning non-2xx status.',
      '**Fix**: Check the webhook delivery log for status codes and error details. Ensure your endpoint is publicly accessible and returns 200.',
      '',
      '## Guard decisions not appearing as compliance evidence',
      '**Cause**: Policy is not linked to a framework control.',
      '**Fix**: Open the policy in the compliance dashboard and map it to the relevant controls. Only linked policies generate evidence.',
      '',
      '## "Rate limited" errors',
      '**Cause**: Too many API requests in the configured window.',
      '**Fix**: Reduce request frequency or increase `DASHCLAW_RATE_LIMIT_MAX`. For development, set `DASHCLAW_DISABLE_RATE_LIMIT=true`.',
      '',
      '## High memory health warnings',
      '**Cause**: Agent workspace has accumulated stale or duplicate context.',
      '**Fix**: Review the workspace memory panel. Archive old handoffs, remove duplicate snippets, and prune stale context entries.',
    ].join('\n'),
    version: 1,
    created_by: p.platformEngineer.id,
    created_at: isoFromNow(5 * MS_DAY),
    updated_at: isoFromNow(72 * MS_HOUR),
  },
];

export { threads, messages, sharedDocs };
