import { describe, it, expect } from 'vitest';
import {
  demoSessions, demoIdentities, demoKnowledgeCollections, demoApiKeys, demoSecrets,
  demoModelStrategies, demoReputationLeaderboard, demoPosture, demoPostureFindings, demoSpend,
  demoBehaviorRecorder, demoBehaviorSamples, demoBehaviorSuggestions,
} from '@/lib/demo/demoMiddleware';

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
  it('reputation leaderboard (/api/reputation/leaderboard)', () => {
    const r = demoReputationLeaderboard(fixtures);
    expect(r.leaderboard.length).toBeGreaterThan(0);
    expect(r.leaderboard[0]!).toMatchObject({ agent_id: expect.any(String), reputation_score: expect.any(Number), rank: expect.any(Number) });
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
  it('spend (/api/finops/spend)', () => {
    const r = demoSpend();
    expect(r.fleet_total_usd).toBeGreaterThan(0);
    expect(r.agent.by_day.length).toBeGreaterThan(0);
    expect(r.x402.by_day[0]!).toMatchObject({ date: expect.any(String), spend_usd: expect.any(Number) });
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
