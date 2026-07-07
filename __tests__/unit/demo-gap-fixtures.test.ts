import { describe, it, expect } from 'vitest';
import {
  demoSessions, demoSessionDetail, demoSessionEvents, demoSessionActions,
  demoIdentities, demoApiKeys, demoSecrets,
} from '@/lib/demo/demoMiddleware';
import { actions as personaActions } from '@/lib/demo/fixtures/persona-agents';

// Minimal fixtures stub — the gap handlers derive agent ids from fixtures.actions
// (with a built-in fallback) and otherwise return self-contained literals.
const fixtures = { actions: [{ agent_id: 'a1' }, { agent_id: 'a2' }] } as any;
const url = (s = 'http://x/api') => new URL(s);

describe('demo gap-page fixtures — non-empty + correctly shaped', () => {
  it('sessions (/api/sessions)', () => {
    const r = demoSessions(fixtures, url());
    expect(r.sessions.length).toBeGreaterThan(0);
    expect(r.sessions[0]!).toMatchObject({ id: expect.any(String), agent_id: expect.any(String), status: expect.any(String), action_count: expect.any(Number) });
  });
  it('identities (/api/identities)', () => {
    const r = demoIdentities(fixtures);
    expect(r.identities.length).toBeGreaterThan(0);
    expect(r.identities[0]!).toMatchObject({ agent_id: expect.any(String), permission_level: expect.any(String) });
  });
  it('api keys (/api/keys)', () => {
    const r = demoApiKeys();
    expect(r.keys.length).toBeGreaterThan(0);
    expect(r.keys[0]!).toMatchObject({ id: expect.any(String), name: expect.any(String), prefix: expect.any(String) });
  });
  it('secrets (/api/secrets)', () => {
    const r = demoSecrets();
    expect(r.secrets.length).toBeGreaterThan(0);
    expect(r.secrets[0]!).toMatchObject({ id: expect.any(String), name: expect.any(String), rotation_interval_days: expect.any(Number) });
  });
});

describe('demo session detail trio — /api/sessions/:id{,/events,/actions}', () => {
  it('detail resolves every id the LIST handler returns (clicking a row works)', () => {
    const list = demoSessions(fixtures, url('http://x/api/sessions?limit=100'));
    expect(list.sessions.length).toBeGreaterThan(0);
    for (const s of list.sessions) {
      const detail = demoSessionDetail(fixtures, s.id);
      expect(detail?.session).toMatchObject({ id: s.id, agent_id: s.agent_id, status: s.status });
    }
  });
  it('detail carries the aggregate card fields', () => {
    const d = demoSessionDetail(fixtures, 'sess_demo_1') as any;
    expect(d.session).toMatchObject({
      action_count: expect.any(Number),
      total_cost: expect.any(Number),
      max_risk: expect.any(Number),
      event_count: expect.any(Number),
      workspace: expect.any(String),
    });
  });
  it('actions are paginated and total always equals the "# Actions" card', () => {
    const d = demoSessionDetail(fixtures, 'sess_demo_1') as any;
    const page = demoSessionActions(fixtures, 'sess_demo_1', url('http://x/api?limit=3')) as any;
    expect(page.total).toBe(d.session.action_count);
    expect(page.actions.length).toBe(Math.min(3, page.total));
    expect(page.actions[0]).toMatchObject({
      action_id: expect.any(String), action_type: expect.any(String),
      declared_goal: expect.any(String), risk_score: expect.any(Number),
      cost_estimate: expect.any(Number), created_at: expect.any(String),
    });
    // Newest first, like the live route.
    const sorted = [...page.actions].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
    expect(page.actions).toEqual(sorted);
    // offset paging never overlaps page one
    const page2 = demoSessionActions(fixtures, 'sess_demo_1', url('http://x/api?limit=3&offset=3')) as any;
    expect(page2.actions.every((a: any) => !page.actions.some((b: any) => b.action_id === a.action_id))).toBe(true);
  });
  it('events form a lifecycle timeline; blocked sessions surface a blocked event', () => {
    const list = demoSessions(fixtures, url('http://x/api/sessions?limit=100'));
    const blocked = list.sessions.find((s: any) => s.status === 'blocked');
    expect(blocked).toBeTruthy();
    const ev = demoSessionEvents(fixtures, blocked!.id) as any;
    expect(ev.events[0]).toMatchObject({ kind: 'spawning', seq: 1 });
    expect(ev.events.some((e: any) => e.kind === 'blocked' && e.detail)).toBe(true);
  });
  it('unknown session ids return null → middleware 404s like the real route', () => {
    expect(demoSessionDetail(fixtures, 'sess_nope')).toBeNull();
    expect(demoSessionEvents(fixtures, 'sess_nope')).toBeNull();
    expect(demoSessionActions(fixtures, 'sess_nope', url())).toBeNull();
  });
});

describe('persona-agents fixture — webhook event names are real', () => {
  // The webhook route only accepts VALID_EVENT_TYPES; the persona narrative
  // used to advertise fictional dot-namespaced events (action.blocked,
  // guard.escalation, security.signal, agent.offline, action.completed).
  it('no fictional dot-namespaced webhook event names in persona copy', () => {
    const fictional = /action\.(completed|blocked)|guard\.escalation|security\.signal|agent\.offline/;
    for (const a of personaActions as any[]) {
      expect(String(a.output_summary || '')).not.toMatch(fictional);
    }
  });
});
