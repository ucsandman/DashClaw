import { describe, it, expect, vi, beforeEach } from 'vitest';

// Dispatch-level pins for the demo handlers added in the P20 gap-closing pass:
// the session detail trio, reputation summary/events, x402 purchases, and the
// period-aware finops spend handler.
// Mirrors the mocking setup of middleware.test.js (env-forced DASHCLAW_MODE=demo).
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
const sqlMock = vi.fn(async () => []);
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { getToken } = await import('next-auth/jwt');
const { middleware } = await import('../../middleware.js');

function req(pathname: string, { method = 'GET', body, ip = '10.9.8.7' }: { method?: string; body?: unknown; ip?: string } = {}) {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers({ host: 'localhost:3000' }),
    cookies: { get: () => undefined },
    ip,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as any;
}

describe('demo-mode dispatch — P20 gap handlers', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    (getToken as any).mockReset();
    (getToken as any).mockResolvedValue(null);
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-1234567890');
    vi.stubEnv('DASHCLAW_MODE', 'demo');
  });

  it('GET /api/sessions/:id resolves an id from the demo sessions list', async () => {
    const list = await middleware(req('/api/sessions?limit=100'));
    const { sessions } = await list.json();
    expect(sessions.length).toBeGreaterThan(0);

    const res = await middleware(req(`/api/sessions/${sessions[0].id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe(sessions[0].id);
    expect(body.session.action_count).toEqual(expect.any(Number));
  });

  it('GET /api/sessions/:id/events and /actions serve the detail page', async () => {
    const ev = await middleware(req('/api/sessions/sess_demo_1/events'));
    expect(ev.status).toBe(200);
    expect(Array.isArray((await ev.json()).events)).toBe(true);

    const acts = await middleware(req('/api/sessions/sess_demo_1/actions?limit=5'));
    expect(acts.status).toBe(200);
    const body = await acts.json();
    expect(Array.isArray(body.actions)).toBe(true);
    expect(body.total).toEqual(expect.any(Number));
  });

  it('unknown session id → 404 (matches the real route, not the 403 fallback)', async () => {
    const res = await middleware(req('/api/sessions/sess_does_not_exist'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Session not found');
  });

  it('GET /api/reputation/agents/:id/summary and /events are demo-served', async () => {
    const sum = await middleware(req('/api/reputation/agents/clawdbot/summary'));
    expect(sum.status).toBe(200);
    const sumBody = await sum.json();
    expect(sumBody.summary.reliability_score).toEqual(expect.any(Number));

    const ev = await middleware(req('/api/reputation/agents/clawdbot/events'));
    expect(ev.status).toBe(200);
    const evBody = await ev.json();
    expect(evBody.events.length).toBeGreaterThan(0);
    expect(evBody.pagination).toBeTruthy();
  });

  it('GET /api/x402/purchases returns provider-joined demo rows (was 403)', async () => {
    const res = await middleware(req('/api/x402/purchases'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.purchases.length).toBeGreaterThan(0);
    expect(body.purchases[0].provider_name).toEqual(expect.any(String));
  });

  it('GET /api/finops/spend honors ?period= (7d/30d/90d buttons live in demo)', async () => {
    const seven = await (await middleware(req('/api/finops/spend?period=7d'))).json();
    const ninety = await (await middleware(req('/api/finops/spend?period=90d'))).json();
    expect(seven.agent.by_day.length).toBe(7);
    expect(ninety.agent.by_day.length).toBe(90);
    expect(ninety.fleet_total_usd).toBeGreaterThan(seven.fleet_total_usd);
  });

  it('GET /api/finops/spend?lens=claude-code returns the code-sessions shape', async () => {
    const res = await middleware(req('/api/finops/spend?lens=claude-code&period=7d'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lens).toBe('claude_code');
    expect(body.code_sessions.by_day.length).toBe(7);
  });

  it('PATCH /api/sessions/:id stays an allowed simulation? No — sessions PATCH is write-blocked', async () => {
    // isDemoSimulationRequest only exempts /api/guard, /api/actions(+subpaths),
    // /api/assumptions. Sessions PATCH falls to the write block, and the detail
    // page surfaces the message via its inline error banner.
    const res = await middleware(req('/api/sessions/sess_demo_1', { method: 'PATCH', body: { status: 'finished' } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Demo mode: write APIs are disabled.');
  });

  it('GET /api/policies/contract returns a governed claude-code contract with correct sentences', async () => {
    const res = await middleware(req('/api/policies/contract'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.governed).toBe(true);
    expect(body.mode_id).toBe('claude-code');
    expect(body.interrupts.length).toBe(5);
    expect(body.silent.length).toBe(3);
    expect(body.blocks.length).toBe(2);
    expect(body.grants.length).toBeGreaterThanOrEqual(1);
    // x402 interrupt carries editable + rules
    expect(body.interrupts[0]).toMatchObject({
      policy_id: expect.any(String),
      text: 'paid spend reaches $5.00',
      fired_7d: expect.any(Number),
      editable: { param: 'approval_threshold', value: 5 },
    });
    expect(body.interrupts[0].rules).toBeDefined();
    // require_approval sentences use real claude-code action_types
    expect(body.interrupts[1].text).toBe('action is one of: deploy, migrate, workflow_execute');
    expect(body.interrupts[2].text).toBe('action is one of: delete, reset, destroy, drop');
    // protected_path and runaway rate_limit (policies 7 and 9 in compile.ts)
    expect(body.interrupts[3].text).toBe('protected paths change (governance, auth, secrets)');
    expect(body.interrupts[4].text).toBe('runaway loop: more than 650 actions in 60 minutes');
    // silent: risk-85 warn (policy 2) first, then comms warn (policy 4), then burst (policy 8)
    expect(body.silent[0].text).toBe('risk score reaches 85');
    expect(body.silent[1].text).toBe('message, post, email, calendar, sync, api calls (recorded for review)');
    expect(body.silent[2].text).toBe('burst: more than 250 actions in 30 minutes');
    // blocks: risk-100 + x402 max
    expect(body.blocks[0].text).toBe('risk score reaches 100');
    expect(body.blocks[1]).toMatchObject({
      text: 'paid spend exceeds $25.00',
      editable: { param: 'max_spend_usd', value: 25 },
    });
    expect(body.blocks[1].rules).toBeDefined();
    // friction: sum of interrupt fired_7d (2+7+3+1+0=13) × 20s
    expect(body.friction.interrupts_7d).toBe(13);
    expect(body.friction.est_seconds).toBe(260);
  });

  it('GET /api/policies/review returns warn groups and recent interrupts', async () => {
    const res = await middleware(req('/api/policies/review'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups.length).toBeGreaterThanOrEqual(2);
    expect(body.interrupts.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.cursor).toBe('string');
    expect(body.groups[0]).toMatchObject({
      shape: { action_type: expect.any(String), key: expect.any(String), label: expect.any(String) },
      count: expect.any(Number),
      latest_at: expect.any(String),
      sample_id: expect.any(String),
    });
    expect(body.interrupts[0]).toMatchObject({ id: expect.any(String), action_type: expect.any(String), decision: expect.any(String) });
  });

  it('POST /api/policies/review/verdict returns ok:true without hitting the write-block', async () => {
    const res = await middleware(req('/api/policies/review/verdict', {
      method: 'POST',
      body: { verdict: 'fine', shape: { action_type: 'bash' } },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.demo).toBe(true);
  });
});
