import { describe, it, expect, vi, beforeEach } from 'vitest';

// Dispatch-level pins for the demo handlers added in the P20 gap-closing pass:
// the session detail trio and the policies contract handler.
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
    expect(body.interrupts.length).toBe(4);
    expect(body.silent.length).toBe(3);
    expect(body.blocks.length).toBe(1);
    expect(body.grants.length).toBeGreaterThanOrEqual(1);
    // require_approval sentences use real claude-code action_types
    expect(body.interrupts[0].text).toBe('action is one of: deploy, migrate, workflow_execute');
    expect(body.interrupts[1].text).toBe('action is one of: delete, reset, destroy, drop');
    // protected_path and runaway rate_limit
    expect(body.interrupts[2].text).toBe('protected paths change (governance, auth, secrets)');
    expect(body.interrupts[3].text).toBe('runaway loop: more than 650 actions in 60 minutes');
    // silent: risk-85 warn first, then comms warn, then burst
    expect(body.silent[0].text).toBe('risk score reaches 85');
    expect(body.silent[1].text).toBe('message, post, email, calendar, sync, api calls (recorded for review)');
    expect(body.silent[2].text).toBe('burst: more than 250 actions in 30 minutes');
    // blocks: risk-100
    expect(body.blocks[0].text).toBe('risk score reaches 100');
    // friction: sum of interrupt fired_7d (7+3+1+0=11) × 20s
    expect(body.friction.interrupts_7d).toBe(11);
    expect(body.friction.est_seconds).toBe(220);
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

  // v5.4.0 follow-up: the /approvals plans card fetches ?status=<s> then a
  // detail per plan — before these entries the demo showed no plans at all.
  it('GET /api/plans?status=pending serves the demo pending plan; detail carries complete steps', async () => {
    const list = await middleware(req('/api/plans?status=pending&limit=20'));
    expect(list.status).toBe(200);
    const { plans } = await list.json();
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe('pending');

    const detail = await middleware(req(`/api/plans/${plans[0].plan_id}`));
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.plan.plan_id).toBe(plans[0].plan_id);
    expect(body.steps.length).toBeGreaterThan(0);
    // Complete rows — a missing field wedges PlanReviewCard on skeletons.
    expect(body.steps[0]).toMatchObject({
      step_id: expect.any(String), seq: 1, action_type: expect.any(String),
      step_goal: expect.any(String), preview_decision: expect.any(String),
      preview_risk_score: expect.any(Number), grant_status: expect.any(String),
    });
  });

  it('GET /api/plans?status=approved serves the live demo plan; verdict POST answers a demo 403', async () => {
    const list = await middleware(req('/api/plans?status=approved&limit=20'));
    const { plans } = await list.json();
    expect(plans).toHaveLength(1);
    expect(plans[0].expires_at).toEqual(expect.any(String));

    const verdict = await middleware(req(`/api/plans/${plans[0].plan_id}`, { method: 'POST', body: { verdict: 'revoke' } }));
    expect(verdict.status).toBe(403);
    const body = await verdict.json();
    expect(body.error).toMatch(/demo/i);
  });
});
