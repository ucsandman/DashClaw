// tests/smoke/pages.js
//
// Static page list for the smoke sweep. Each entry is either a string path
// (treated as a GET-only render check) or an object with richer expectations.
//
// Grouping mirrors the sidebar organization in app/components/Sidebar.js so
// this file stays easy to keep in sync when new pages land.
//
// Dynamic routes use a representative demo fixture id as the concrete path.
// Demo fixture id reference:
//   actionId     → ar_demo_deploy_block_001   (DEMO_TEST_ACTION_ID in demoMiddleware.ts)
//   agentId      → clawdbot                   (DEMO_FALLBACK_AGENT_IDS[0])
//   capabilityId → cap_demo_enrich            (DEMO_REGISTRY_CAPABILITIES[0].capability_id)
//   sessionId    → sess_demo_1                (buildDemoSessionList: id = `sess_demo_${n}`)
//   projectId    → cp_demo_dashclaw           (demoSpend by_project[0].project_id)
//   strategyId   → str_demo_1                 (demoModelStrategies strategies[0].strategy_id)
//   templateId   → demo-template              (workflows array is empty in fixtures; renders empty-state = valid pass)
//   runActionId  → ar_demo_deploy_block_001   (same demo action)
//   pairingId    → demo-pairing               (pairings not seeded; page redirects to /settings)
//   token        → demo-token                 (invite page fetches /api/invite/:token; 404 = graceful empty state)

export const PUBLIC_PAGES = [
  { path: '/', label: 'Landing' },
  { path: '/demo', label: 'Demo redirect' },
  { path: '/connect', label: 'Connect guide' },
  { path: '/self-host', label: 'Self-host guide' },
  { path: '/docs', label: 'SDK docs' },
  { path: '/setup', label: 'Setup readiness' },
  { path: '/approve', label: 'Mobile approvals PWA' },
  { path: '/login', label: 'Login' },
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/downloads', label: 'Downloads' },
  { path: '/practical-systems', label: 'Practical Systems' },
  { path: '/doctor', label: 'Doctor health check' },
  { path: '/audit-log', label: 'Audit log' },
];

export const BLOG_PAGES = [
  { path: '/blog/claude-code-beachhead', label: 'Blog: Claude Code Beachhead' },
  { path: '/blog/codex-parity', label: 'Blog: Codex Parity' },
  { path: '/blog/hermes-plugin', label: 'Blog: Hermes Plugin' },
];

export const GUIDE_PAGES = [
  { path: '/guides/claude-code', label: 'Guide: Claude Code' },
  { path: '/guides/codex', label: 'Guide: Codex' },
  { path: '/guides/crewai', label: 'Guide: CrewAI' },
  { path: '/guides/discord-approvals', label: 'Guide: Discord Approvals' },
  { path: '/guides/hermes', label: 'Guide: Hermes' },
  { path: '/guides/langgraph', label: 'Guide: LangGraph' },
  { path: '/guides/openai-agents-sdk', label: 'Guide: OpenAI Agents SDK' },
  { path: '/guides/openclaw', label: 'Guide: OpenClaw' },
];

export const GOVERN_PAGES = [
  { path: '/mission-control', label: 'Mission Control' },
  { path: '/mission-control/codebase', label: 'Mission Control: Codebase' },
  { path: '/decisions', label: 'Decisions ledger' },
  { path: '/decisions/ar_demo_deploy_block_001', label: 'Decision detail [demo action]' },
  { path: '/approvals', label: 'Approval queue' },
  { path: '/policies', label: 'Policy builder' },
  { path: '/policies/rules', label: 'Policy rules' },
  { path: '/policy-coach', label: 'Policy coach' },
  { path: '/agents', label: 'Fleet' },
  { path: '/agents/clawdbot', label: 'Agent detail [clawdbot]' },
  { path: '/agents/registry', label: 'Agent registry' },
  { path: '/actions/ar_demo_deploy_block_001', label: 'Action detail [demo action]' },
];

export const OBSERVE_PAGES = [
  { path: '/security', label: 'Security' },
  { path: '/analytics', label: 'Analytics dashboard' },
  { path: '/activity', label: 'Activity log' },
  { path: '/compliance', label: 'Compliance mapping' },
  { path: '/compliance/exports', label: 'Compliance exports' },
  { path: '/posture', label: 'Posture score' },
  { path: '/reputation', label: 'Reputation leaderboard' },
  { path: '/scoring', label: 'Scoring profiles' },
  { path: '/evaluations', label: 'Evaluations' },
  { path: '/quality', label: 'Quality' },
  { path: '/swarm', label: 'Swarm graph' },
];

export const CONFIGURE_PAGES = [
  { path: '/api-keys', label: 'API keys' },
  { path: '/integrations', label: 'Integrations health' },
  { path: '/webhooks', label: 'Webhooks' },
  { path: '/identities', label: 'Agent identities' },
  { path: '/settings', label: 'Settings' },
  { path: '/team', label: 'Team' },
  { path: '/secrets', label: 'Managed secrets' },
  { path: '/widget', label: 'Widget / PiP' },
  { path: '/invite/demo-token', label: 'Invite accept [demo-token]' },
];

export const LABS_PAGES = [
  { path: '/assumptions', label: 'Assumptions' },
  { path: '/sessions', label: 'Sessions lifecycle' },
  { path: '/sessions/sess_demo_1', label: 'Session detail [sess_demo_1]' },
  { path: '/drift', label: 'Drift detection' },
  { path: '/learning', label: 'Learning loop' },
  { path: '/learning/analytics', label: 'Learning analytics' },
  { path: '/prompts', label: 'Prompt registry' },
  { path: '/workflows', label: 'Workflow templates' },
  { path: '/workflows/new', label: 'New workflow' },
  { path: '/workflows/demo-template', label: 'Workflow detail [demo-template]' },
  { path: '/workflows/demo-template/runs/ar_demo_deploy_block_001', label: 'Workflow run detail [demo-template/demo-action]' },
  { path: '/workflows/strategies', label: 'Model strategies' },  // was /model-strategies
  { path: '/workflows/strategies/new', label: 'New model strategy' },
  { path: '/workflows/strategies/str_demo_1', label: 'Model strategy detail [str_demo_1]' },
  { path: '/capabilities', label: 'Capability registry' },
  { path: '/capabilities/new', label: 'New capability' },
  { path: '/capabilities/cap_demo_enrich', label: 'Capability detail [cap_demo_enrich]' },
  { path: '/capabilities/cap_demo_enrich/edit', label: 'Capability edit [cap_demo_enrich]' },
  { path: '/replay/ar_demo_deploy_block_001', label: 'Replay [demo action]' },
  { path: '/pair/demo-pairing', label: 'Pair redirect [demo-pairing]' },
];

export const SPEND_PAGES = [
  { path: '/spend', label: 'Spend overview' },
  { path: '/spend/code', label: 'Spend: code sessions' },
  { path: '/spend/x402', label: 'Spend: x402 purchases' },
];

export const CODE_SESSION_PAGES = [
  { path: '/code-sessions', label: 'Code sessions' },
  { path: '/code-sessions/cp_demo_dashclaw', label: 'Code session project [cp_demo_dashclaw]' },
  { path: '/code-sessions/cp_demo_dashclaw/sess_demo_1', label: 'Code session detail [cp_demo_dashclaw/sess_demo_1]' },
];

export const MESSAGES_PAGES = [
  { path: '/messages', label: 'Messages' },
];

export const WORK_ORDER_PAGES = [
  { path: '/work-orders', label: 'Work orders' },
];

export const USAGE_PAGES = [
  { path: '/usage', label: 'Usage' },
];

export const ALL_PAGES = [
  ...PUBLIC_PAGES,
  ...BLOG_PAGES,
  ...GUIDE_PAGES,
  ...GOVERN_PAGES,
  ...OBSERVE_PAGES,
  ...CONFIGURE_PAGES,
  ...LABS_PAGES,
  ...SPEND_PAGES,
  ...CODE_SESSION_PAGES,
  ...MESSAGES_PAGES,
  ...WORK_ORDER_PAGES,
  ...USAGE_PAGES,
];
