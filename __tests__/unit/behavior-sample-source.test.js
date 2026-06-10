import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeSamples } from '@/lib/behavior/analyzer.js';
import { RULE_KINDS } from '@/lib/behavior/policy-model.js';

const readSamples = vi.fn();
const readDismissals = vi.fn();
const writeDismissal = vi.fn();
const listBehaviorSamples = vi.fn();
const listBehaviorDismissals = vi.fn();
const upsertBehaviorDismissal = vi.fn();
const insertPolicy = vi.fn();

vi.mock('@/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_caller' }));
vi.mock('@/lib/behavior/sample-store.js', () => ({
  readSamples: (...a) => readSamples(...a),
  readDismissals: (...a) => readDismissals(...a),
  writeDismissal: (...a) => writeDismissal(...a),
}));
vi.mock('@/lib/repositories/behavior.repository.js', () => ({
  listBehaviorSamples: (...a) => listBehaviorSamples(...a),
  listBehaviorDismissals: (...a) => listBehaviorDismissals(...a),
  upsertBehaviorDismissal: (...a) => upsertBehaviorDismissal(...a),
}));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  insertPolicy: (...a) => insertPolicy(...a),
}));
vi.mock('@/lib/events.js', () => ({ EVENTS: { POLICY_UPDATED: 'policy.updated' }, publishOrgEvent: vi.fn() }));

const suggestionsRoute = await import('@/api/behavior/suggestions/route.js');
const simulateRoute = await import('@/api/behavior/simulate/route.js');

let n = 0;
const ev = () => `bse_${(n++).toString(16).padStart(4, '0')}`;
const at = (min) => new Date(Date.UTC(2026, 5, 1, 10, min, 0)).toISOString();
const sample = (over = {}) => ({
  event_id: ev(), ts: at(over._min ?? 0), source: 'claude-code',
  agent_id: 'agent-a', tool: 'Read', action_type: 'review', read_paths: [], write_paths: [],
  risk_score: 10, reversible: true, guard_decision: 'allow',
  outcome_status: 'completed', model: null, ...over,
});

function uploadedSamples() {
  n = 0;
  return [
    ...Array.from({ length: 5 }, (_, i) => sample({ read_paths: [`ph_${i}`], _min: i })),
    sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'rm -rf <path>', risk_score: 90, _min: 10 }),
    sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'git push --force', risk_score: 85, _min: 11 }),
    sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'git reset --hard', risk_score: 80, _min: 12 }),
  ];
}

const getReq = () => ({ nextUrl: { searchParams: new URLSearchParams() }, headers: { get: () => null } });
const postReq = (body) => ({ json: async () => body, headers: { get: () => null } });

beforeEach(() => {
  vi.clearAllMocks();
  readSamples.mockResolvedValue([]); // no local samples → DB fallback
  readDismissals.mockResolvedValue([]);
  listBehaviorDismissals.mockResolvedValue([]);
  upsertBehaviorDismissal.mockResolvedValue(undefined);
});

describe('suggestions GET — DB fallback org scoping', () => {
  it('passes the CALLER org into the repository and reports sample_source=uploaded', async () => {
    listBehaviorSamples.mockResolvedValue(uploadedSamples());
    const res = await suggestionsRoute.GET(getReq());
    const json = await res.json();

    expect(listBehaviorSamples).toHaveBeenCalledTimes(1);
    expect(listBehaviorSamples.mock.calls[0][1]).toBe('org_caller'); // never another org
    expect(listBehaviorDismissals.mock.calls[0][1]).toBe('org_caller');
    expect(json.sample_source).toBe('uploaded');
    expect(json.sample_count).toBe(8);
    expect(json.suggestions.length).toBeGreaterThan(0);
  });

  it('prefers local samples (and local dismissals) when they exist', async () => {
    readSamples.mockResolvedValue(uploadedSamples());
    const res = await suggestionsRoute.GET(getReq());
    const json = await res.json();
    expect(json.sample_source).toBe('local');
    expect(listBehaviorSamples).not.toHaveBeenCalled();
    expect(readDismissals).toHaveBeenCalled();
  });
});

describe('suggestions POST dismiss — DB-backed dismissals', () => {
  it('writes the dismissal to the org-scoped table when samples came from the DB', async () => {
    const samples = uploadedSamples();
    listBehaviorSamples.mockResolvedValue(samples);
    const { suggestions } = analyzeSamples(samples);
    const sug = suggestions.find((s) => s.type === RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL);

    const res = await suggestionsRoute.POST(postReq({ action: 'dismiss', suggestion_id: sug.id }));
    expect((await res.json()).dismissed).toBe(true);
    expect(upsertBehaviorDismissal).toHaveBeenCalledTimes(1);
    expect(upsertBehaviorDismissal.mock.calls[0][1]).toBe('org_caller');
    expect(writeDismissal).not.toHaveBeenCalled();
  });
});

describe('simulate POST — DB fallback', () => {
  it('simulates against the caller org uploaded samples and reports provenance', async () => {
    listBehaviorSamples.mockResolvedValue(uploadedSamples());
    const res = await simulateRoute.POST(postReq({
      rule: { kind: RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL, risk_threshold: 70, action: 'require_approval' },
    }));
    const json = await res.json();
    expect(listBehaviorSamples.mock.calls[0][1]).toBe('org_caller');
    expect(json.sample_source).toBe('uploaded');
    expect(json.simulation.total).toBe(8);
  });
});
