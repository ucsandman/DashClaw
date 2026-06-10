import { describe, it, expect } from 'vitest';
import {
  demoSessions, demoSessionDetail, demoSessionEvents, demoSessionActions,
  demoIdentities, demoKnowledgeCollections, demoApiKeys, demoSecrets,
  demoModelStrategies, demoReputationLeaderboard, demoReputationSummary, demoReputationEvents,
  demoPosture, demoPostureFindings, demoSpend, demoX402Purchases,
  demoBehaviorRecorder, demoBehaviorSamples, demoBehaviorSuggestions,
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
  it('knowledge collections (/api/knowledge/collections)', () => {
    const r = demoKnowledgeCollections();
    expect(r.collections.length).toBeGreaterThan(0);
    expect(r.collections[0]!).toMatchObject({ collection_id: expect.any(String), name: expect.any(String), ingestion_status: expect.any(String), doc_count: expect.any(Number) });
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
  it('model strategies (/api/model-strategies)', () => {
    const r = demoModelStrategies();
    expect(r.strategies.length).toBeGreaterThan(0);
    expect(r.strategies[0]!.config.primary).toMatchObject({ provider: expect.any(String), model: expect.any(String) });
  });
  it('reputation leaderboard (/api/reputation/leaderboard) — snapshotToVector shape', () => {
    const r = demoReputationLeaderboard(fixtures);
    expect(r.leaderboard.length).toBeGreaterThan(0);
    const v = r.leaderboard[0]! as any;
    // /reputation renders reliability as a 0..1 fraction and risk as a 0-100
    // integer on a separate axis — the old fixture's 0-100 reputation_score
    // shape rendered as "100%" reliability for every agent.
    expect(v).toMatchObject({ agent_id: expect.any(String), reliability_score: expect.any(Number), risk_score: expect.any(Number), total_events: expect.any(Number) });
    expect(v.reliability_score).toBeGreaterThan(0);
    expect(v.reliability_score).toBeLessThanOrEqual(1);
    expect(v.risk_score).toBeGreaterThanOrEqual(0);
    expect(v.breakdown?.dimensions?.length).toBeGreaterThan(0);
  });
  it('reputation summary (/api/reputation/agents/:id/summary)', () => {
    const r = demoReputationSummary(fixtures, 'a1') as any;
    expect(r.agent_id).toBe('a1');
    expect(r.summary).toMatchObject({ reliability_score: expect.any(Number), completion_rate: expect.any(Number), is_active: true });
    expect(r.summary.breakdown?.normalized_weights).toBeTruthy();
  });
  it('reputation events (/api/reputation/agents/:id/events) — paginated, newest first', () => {
    const r = demoReputationEvents(fixtures, 'a1', url('http://x/api?limit=5')) as any;
    expect(r.events.length).toBe(5);
    expect(r.pagination).toMatchObject({ limit: 5, offset: 0, count: 5 });
    expect(r.events[0]).toMatchObject({ id: expect.any(String), event_type: expect.any(String), occurred_at: expect.any(String) });
    expect(r.events[0].occurred_at >= r.events[1].occurred_at).toBe(true);
  });
  it('posture (/api/posture) — full PostureResponse shape', () => {
    const r = demoPosture();
    expect(r.dimensions.length).toBe(6);
    expect(r).toMatchObject({ score: expect.any(Number), status: expect.any(String) });
    expect(r.snapshots.length).toBeGreaterThan(0);
    expect(r.summary).toMatchObject({ totalUnits: expect.any(Number), openFindings: expect.any(Number) });
  });
  it('posture findings (/api/posture/findings)', () => {
    const r = demoPostureFindings();
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings[0]!).toMatchObject({ key: expect.any(String), dimension: expect.any(String), severity: expect.any(String) });
  });
  it('spend (/api/finops/spend) — period-aware fleet lens', () => {
    const r = demoSpend(url('http://x/api/finops/spend')) as any;
    expect(r.period).toBe('30d');
    expect(r.fleet_total_usd).toBeGreaterThan(0);
    expect(r.agent.by_day.length).toBe(30);
    expect(r.x402.by_day[0]!).toMatchObject({ date: expect.any(String), spend_usd: expect.any(Number) });
    // Totals always equal the sum of the rendered series (chart and headline agree).
    const agentSum = r.agent.by_day.reduce((s: number, d: any) => s + d.cost_usd, 0);
    expect(r.agent.total_cost_usd).toBeCloseTo(agentSum, 2);

    const seven = demoSpend(url('http://x/api/finops/spend?period=7d')) as any;
    expect(seven.period).toBe('7d');
    expect(seven.agent.by_day.length).toBe(7);
    expect(seven.fleet_total_usd).toBeLessThan(r.fleet_total_usd);

    const ninety = demoSpend(url('http://x/api/finops/spend?period=90d')) as any;
    expect(ninety.agent.by_day.length).toBe(90);

    // Invalid periods fall back to 30d like the real route.
    expect((demoSpend(url('http://x/api/finops/spend?period=1y')) as any).period).toBe('30d');

    // Agent-filtered view is a slice of fleet spend, not the full totals.
    const filtered = demoSpend(url('http://x/api/finops/spend?period=30d&agent_id=a1')) as any;
    expect(filtered.fleet_total_usd).toBeLessThan(r.fleet_total_usd);
  });
  it('spend (/api/finops/spend?lens=claude-code) — code-sessions shape for /spend/code', () => {
    const r = demoSpend(url('http://x/api/finops/spend?lens=claude-code&period=7d')) as any;
    expect(r.lens).toBe('claude_code');
    expect(r.code_total_usd).toBeGreaterThan(0);
    expect(r.code_sessions.by_day.length).toBe(7);
    expect(r.code_sessions.by_day[0]).toMatchObject({ date: expect.any(String), cost_usd: expect.any(Number), session_count: expect.any(Number) });
    expect(r.code_sessions.by_project[0]).toMatchObject({ project_id: expect.any(String), project_name: expect.any(String), cost_usd: expect.any(Number) });
    expect(r.code_sessions.total_cache_savings_usd).toBeGreaterThan(0);
  });
  it('x402 purchases (/api/x402/purchases) — provider_name join + agent filter', () => {
    const all = demoX402Purchases(url('http://x/api/x402/purchases'));
    expect(all.purchases.length).toBeGreaterThan(0);
    expect(all.purchases[0]!).toMatchObject({
      action_id: expect.any(String), provider_name: expect.any(String),
      spend_amount: expect.any(Number), currency: expect.any(String),
      execution_status: expect.any(String), created_at: expect.any(String),
    });
    // ?agent_id= excludes other agents AND unattributed (agent_id null) rows,
    // mirroring listPurchases' documented behavior.
    const filtered = demoX402Purchases(url('http://x/api/x402/purchases?agent_id=clawdbot'));
    expect(filtered.purchases.length).toBeGreaterThan(0);
    expect(filtered.purchases.every((p: any) => p.agent_id === 'clawdbot')).toBe(true);
  });
  it('behavior recorder (/api/behavior/recorder)', () => {
    expect(demoBehaviorRecorder()).toMatchObject({ enabled: true, effective: true });
  });
  it('behavior samples (/api/behavior/samples) — status + ?list records', () => {
    const status = demoBehaviorSamples(fixtures, url('http://x/api/behavior/samples')) as any;
    expect(status.sample_count).toBeGreaterThan(0);
    const list = demoBehaviorSamples(fixtures, url('http://x/api/behavior/samples?list=10')) as any;
    expect(list.samples.length).toBeGreaterThan(0);
    expect(list.samples[0]).toMatchObject({ event_id: expect.any(String), tool: expect.any(String), outcome_status: expect.any(String) });
  });
  it('behavior suggestions (/api/behavior/suggestions) — policy-coach showcase', () => {
    const r = demoBehaviorSuggestions(fixtures);
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.agents.length).toBeGreaterThan(0);
    expect(r.suggestions[0]!).toMatchObject({ id: expect.any(String), type: expect.any(String), confidence: expect.any(Number) });
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
