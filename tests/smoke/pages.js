// tests/smoke/pages.js
//
// Static page list for the smoke sweep. Each entry is either a string path
// (treated as a GET-only render check) or an object with richer expectations.
//
// Grouping mirrors the sidebar organization in app/components/Sidebar.js so
// this file stays easy to keep in sync when new pages land.

export const PUBLIC_PAGES = [
  { path: '/', label: 'Landing' },
  { path: '/demo', label: 'Demo redirect' },
  { path: '/connect', label: 'Connect guide' },
  { path: '/self-host', label: 'Self-host guide' },
  { path: '/docs', label: 'SDK docs' },
  { path: '/setup', label: 'Setup readiness' },
  { path: '/approve', label: 'Mobile approvals PWA' },
];

export const GOVERN_PAGES = [
  { path: '/mission-control', label: 'Mission Control' },
  { path: '/decisions', label: 'Decisions ledger' },
  { path: '/approvals', label: 'Approval queue' },
  { path: '/policies', label: 'Policy builder' },
  { path: '/agents', label: 'Fleet' },
];

export const OBSERVE_PAGES = [
  { path: '/security', label: 'Security' },
  { path: '/analytics', label: 'Analytics dashboard' },
  { path: '/activity', label: 'Activity log' },
  { path: '/compliance', label: 'Compliance mapping' },
  { path: '/compliance/exports', label: 'Compliance exports' },
];

export const CONFIGURE_PAGES = [
  { path: '/api-keys', label: 'API keys' },
  { path: '/integrations', label: 'Integrations health' },
  { path: '/webhooks', label: 'Webhooks' },
  { path: '/identities', label: 'Agent identities' },
  { path: '/settings', label: 'Settings' },
];

export const LABS_PAGES = [
  { path: '/assumptions', label: 'Assumptions' },
  { path: '/sessions', label: 'Sessions lifecycle' },
  { path: '/drift', label: 'Drift detection' },
  { path: '/learning', label: 'Learning loop' },
  { path: '/prompts', label: 'Prompt registry' },
  { path: '/workflows', label: 'Workflow templates' },
  { path: '/model-strategies', label: 'Model strategies' },
  { path: '/knowledge', label: 'Knowledge collections' },
  { path: '/capabilities', label: 'Capability registry' },
];

export const ALL_PAGES = [
  ...PUBLIC_PAGES,
  ...GOVERN_PAGES,
  ...OBSERVE_PAGES,
  ...CONFIGURE_PAGES,
  ...LABS_PAGES,
];
