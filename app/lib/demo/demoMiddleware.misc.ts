import type { DemoFixtures } from './demoMiddleware.actions';

export function demoActivity(fixtures: DemoFixtures, url: URL) {
  const sp = url.searchParams;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);

  const items = (fixtures.activityLogs || []).slice();
  const total = items.length;
  const paged = items.slice(offset, offset + limit);
  return { events: paged, total, lastUpdated: new Date().toISOString() };
}

export function demoWebhooks(fixtures: DemoFixtures) {
  const items = fixtures.webhooks.slice();
  const stats = {
    total: items.length,
    active: items.filter(w => w.status === 'active').length,
    failing: items.filter(w => w.status === 'failing').length,
  };
  return { webhooks: items, stats, lastUpdated: new Date().toISOString() };
}

export function demoWebhookDeliveries(fixtures: DemoFixtures, webhookId: string) {
  const d = (fixtures.webhookDeliveries && fixtures.webhookDeliveries[webhookId]) || [];
  return { deliveries: d, total: d.length };
}

/** GET /api/doctor — read-only diagnostics snapshot. All green plus one
 *  honest warn explaining that these are fixture diagnostics; auto-fixes stay
 *  demo-blocked (POST /api/doctor/fix is a write). */
export function demoDoctor() {
  const pass = (id: string, category: string, title: string, message: string) => (
    { id, category, status: 'pass', title, message, fix: null }
  );
  const checks = [
    pass('db_reachable', 'database', 'Database reachable', 'Connected and answering queries.'),
    pass('schema_current', 'database', 'Schema up to date', 'All migrations applied.'),
    pass('api_keys', 'auth', 'API keys configured', '2 active keys; last used 1h ago.'),
    pass('guard_policies', 'governance', 'Guard policies active', '6 active policies governing all agents.'),
    pass('approvals_flow', 'governance', 'Approval loop healthy', 'Pending interruptions resolve in under 4 minutes on average.'),
    pass('webhooks', 'integrations', 'Webhook deliveries healthy', 'Last 50 deliveries succeeded.'),
    pass('mcp_server', 'integrations', 'MCP server reachable', 'Tool calls answering within 120ms.'),
    {
      id: 'demo_mode',
      category: 'runtime',
      status: 'warn',
      title: 'Demo instance',
      message: 'These diagnostics describe the simulated demo workspace, not a real deployment. Deploy your own DashClaw instance to run live checks and one-click fixes.',
      fix: null,
    },
  ];
  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: 0,
  };
  return { status: 'healthy', mode: 'demo', summary, checks, lastUpdated: new Date().toISOString() };
}


/**
 * GET /api/usage — read-only metering panel (G4). Deterministic counts; the
 * fixed lastUpdated follows the fixture convention (no live data values).
 */
/**
 * GET /api/team/invites — seats panel (v5.13). Deterministic members +
 * invites; demo writes stay blocked (POST/DELETE fall through to the demo
 * write-block), so the page renders read-only.
 */
export function demoTeam() {
  return {
    org: { id: 'org_demo', name: 'Demo workspace', slug: 'demo', plan: 'free' },
    members: [
      { id: 'usr_demo_1', email: 'ava@demo.dashclaw.io', name: 'Ava Operator', image: null, role: 'admin', created_at: '2026-06-01T00:00:00.000Z', last_login_at: '2026-08-08T00:00:00.000Z' },
      { id: 'usr_demo_2', email: 'sam@demo.dashclaw.io', name: 'Sam Reviewer', image: null, role: 'member', created_at: '2026-07-12T00:00:00.000Z', last_login_at: '2026-08-05T00:00:00.000Z' },
    ],
    invites: [
      { id: 'inv_demo_1', email: 'jordan@demo.dashclaw.io', role: 'member', createdAt: '2026-08-01T00:00:00.000Z', expiresAt: '2026-08-15T00:00:00.000Z', expired: false },
    ],
  };
}

export function demoUsage() {
  return {
    org_id: 'org_demo',
    period: '2026-08',
    governed_actions: 1284,
    blocked_actions: 37,
    seats: { users: 3, active_api_keys: 5 },
    plan: 'free',
    hosted_mode: false,
    trial: null,
    history: [
      { period: '2026-08', governed_actions: 1284, blocked_actions: 37 },
      { period: '2026-07', governed_actions: 2210, blocked_actions: 64 },
      { period: '2026-06', governed_actions: 1930, blocked_actions: 41 },
    ],
    lastUpdated: '2026-08-09T00:00:00.000Z',
  };
}
