// tests/smoke/pages.js
//
// Static page list for the smoke sweep. Each entry is either a string path
// (treated as a GET-only render check) or an object with richer expectations.
//
// Grouping mirrors the sidebar organization in app/components/Sidebar.tsx so
// this file stays easy to keep in sync when new pages land. Trimmed to the
// post-v5 surface: the platform-era pages (mission control, fleet, posture,
// spend, drift, scoring, learning, prompts, workflows, code sessions,
// messages, work orders, …) were removed with the v5 cull.
//
// Dynamic routes use a representative demo fixture id as the concrete path:
//   actionId   → ar_demo_deploy_block_001   (DEMO_TEST_ACTION_ID in demoMiddleware.ts)
//   sessionId  → sess_demo_1                (buildDemoSessionList: id = `sess_demo_${n}`)
//   pairingId  → demo-pairing               (pairings not seeded; page redirects to /settings)

export const PUBLIC_PAGES = [
  { path: '/', label: 'Landing' },
  { path: '/demo', label: 'Demo redirect' },
  { path: '/connect', label: 'Connect guide' },
  { path: '/self-host', label: 'Self-host guide' },
  { path: '/docs', label: 'SDK docs' },
  { path: '/setup', label: 'Setup readiness' },
  { path: '/approve', label: 'Mobile approvals PWA' },
  { path: '/proof', label: 'Self-governance proof' },
  { path: '/login', label: 'Login' },
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
  { path: '/guides/platform', label: 'Guide: Complete Platform' },
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
  { path: '/approvals', label: 'Approvals inbox' },
  { path: '/decisions', label: 'Decisions ledger' },
  { path: '/decisions/ar_demo_deploy_block_001', label: 'Decision detail [demo action]' },
  { path: '/actions/ar_demo_deploy_block_001', label: 'Action detail [demo action]' },
  { path: '/replay/ar_demo_deploy_block_001', label: 'Replay [demo action]' },
  { path: '/policies', label: 'Policy builder' },
  { path: '/policies/rules', label: 'Policy rules' },
  { path: '/calibration', label: 'Calibration controller' },
  { path: '/assumptions', label: 'Assumptions' },
];

export const CONFIGURE_PAGES = [
  { path: '/api-keys', label: 'API keys' },
  { path: '/integrations', label: 'Integrations health' },
  { path: '/webhooks', label: 'Webhooks' },
  { path: '/identities', label: 'Agent identities' },
  { path: '/settings', label: 'Settings' },
];

export const SESSION_PAGES = [
  { path: '/sessions', label: 'Sessions lifecycle' },
  { path: '/sessions/sess_demo_1', label: 'Session detail [sess_demo_1]' },
  { path: '/pair/demo-pairing', label: 'Pair redirect [demo-pairing]' },
];

export const ALL_PAGES = [
  ...PUBLIC_PAGES,
  ...BLOG_PAGES,
  ...GUIDE_PAGES,
  ...GOVERN_PAGES,
  ...CONFIGURE_PAGES,
  ...SESSION_PAGES,
];
