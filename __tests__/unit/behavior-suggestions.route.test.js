import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeSamples } from '@/lib/behavior/analyzer.js';
import { RULE_KINDS } from '@/lib/behavior/policy-model.js';

const readSamples = vi.fn();
const readDismissals = vi.fn();
const writeDismissal = vi.fn();
const removeDismissal = vi.fn();
const insertPolicy = vi.fn();
const publishOrgEvent = vi.fn();

vi.mock('@/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1', getUserId: () => 'user_1' }));
vi.mock('@/lib/audit.js', () => ({ logActivity: () => {} }));
vi.mock('@/lib/behavior/sample-store.js', () => ({
  readSamples: (...a) => readSamples(...a),
  readDismissals: (...a) => readDismissals(...a),
  writeDismissal: (...a) => writeDismissal(...a),
  removeDismissal: (...a) => removeDismissal(...a),
}));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  insertPolicy: (...a) => insertPolicy(...a),
}));
vi.mock('@/lib/events.js', () => ({ EVENTS: { POLICY_UPDATED: 'policy.updated' }, publishOrgEvent: (...a) => publishOrgEvent(...a) }));

const { GET, POST } = await import('@/api/behavior/suggestions/route.js');

let n = 0;
const ev = () => `bse_${(n++).toString(16).padStart(4, '0')}`;
const at = (min) => new Date(Date.UTC(2026, 5, 1, 10, min, 0)).toISOString();
const sample = (over = {}) => ({
  schema_version: 1, event_id: ev(), ts: at(over._min ?? 0), source: 'claude-code',
  agent_id: 'agent-a', tool: 'Read', action_type: 'review', read_paths: [], write_paths: [],
  risk_score: 10, reversible: true, guard_decision: 'allow', matched_policies: [],
  outcome_status: 'completed', model: null, ...over,
});
const filler = (count) => Array.from({ length: count }, (_, i) => sample({ tool: 'Read', read_paths: [`f-${i}.js`], _min: i }));
const req = (body) => ({ json: async () => body, nextUrl: { searchParams: new URLSearchParams() } });

function destructiveSamples() {
  n = 0;
  return [
    ...filler(5),
    sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'rm -rf <path>', risk_score: 90, _min: 10 }),
    sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'git push --force', risk_score: 85, _min: 11 }),
    sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'git reset --hard', risk_score: 80, _min: 12 }),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  readDismissals.mockResolvedValue([]);
  writeDismissal.mockResolvedValue([]);
  removeDismissal.mockResolvedValue(null);
  insertPolicy.mockResolvedValue({ id: 'gp_test', active: 0, policy_type: 'risk_threshold' });
});

describe('POST /api/behavior/suggestions adopt', () => {
  it('creates an INACTIVE guard-policy draft for an enforceable suggestion', async () => {
    const samples = destructiveSamples();
    readSamples.mockResolvedValue(samples);
    const { suggestions } = analyzeSamples(samples);
    const sug = suggestions.find((s) => s.type === RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL);

    const res = await POST(req({ action: 'adopt', suggestion_id: sug.id, acknowledged_simulation: true }));
    const json = await res.json();

    expect(res.status ?? 200).toBe(200);
    expect(json.adopted).toBe(true);
    expect(json.advisory).toBe(false);
    expect(insertPolicy).toHaveBeenCalledTimes(1);
    const [, orgId, arg] = insertPolicy.mock.calls[0];
    expect(orgId).toBe('org_1');
    expect(arg.active).toBe(0); // never auto-enforced
    expect(arg.policyType).toBe('risk_threshold');
  });

  it('refuses to adopt without simulation acknowledgement', async () => {
    const samples = destructiveSamples();
    readSamples.mockResolvedValue(samples);
    const { suggestions } = analyzeSamples(samples);
    const sug = suggestions.find((s) => s.type === RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL);

    const res = await POST(req({ action: 'adopt', suggestion_id: sug.id }));
    expect(res.status).toBe(400);
    expect(insertPolicy).not.toHaveBeenCalled();
  });

  it('records an accepted advisory (no guard policy) for advisory suggestions', async () => {
    n = 0;
    const samples = [
      ...filler(8),
      sample({ tool: 'Read', read_paths: ['hot.js'], _min: 20 }),
      sample({ tool: 'Read', read_paths: ['hot.js'], _min: 21 }),
      sample({ tool: 'Read', read_paths: ['hot.js'], _min: 22 }),
    ];
    readSamples.mockResolvedValue(samples);
    const { suggestions } = analyzeSamples(samples);
    const sug = suggestions.find((s) => s.type === RULE_KINDS.REPEATED_RELOAD_WARN);

    const res = await POST(req({ action: 'adopt', suggestion_id: sug.id, acknowledged_simulation: true }));
    const json = await res.json();
    expect(json.adopted).toBe(true);
    expect(json.advisory).toBe(true);
    expect(insertPolicy).not.toHaveBeenCalled();
    expect(writeDismissal).toHaveBeenCalledTimes(1);
    expect(writeDismissal.mock.calls[0][0].status).toBe('accepted_advisory');
  });

  it('returns 404 for an unknown suggestion id', async () => {
    readSamples.mockResolvedValue(destructiveSamples());
    const res = await POST(req({ action: 'adopt', suggestion_id: 'bsg_deadbeef', acknowledged_simulation: true }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/behavior/suggestions dismiss', () => {
  it('writes a dismissal record', async () => {
    const samples = destructiveSamples();
    readSamples.mockResolvedValue(samples);
    const { suggestions } = analyzeSamples(samples);
    const sug = suggestions.find((s) => s.type === RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL);

    const res = await POST(req({ action: 'dismiss', suggestion_id: sug.id, reason: 'noisy', suppress_similar: true }));
    const json = await res.json();
    expect(json.dismissed).toBe(true);
    expect(writeDismissal).toHaveBeenCalledTimes(1);
    const record = writeDismissal.mock.calls[0][0];
    expect(record.status).toBe('dismissed');
    expect(record.suppress_similar).toBe(true);
    expect(insertPolicy).not.toHaveBeenCalled();
  });
});

describe('POST /api/behavior/suggestions adopt-enforceable suppression (v4.4)', () => {
  it('writes a status=adopted suppression row carrying the created draft policy_id', async () => {
    const samples = destructiveSamples();
    readSamples.mockResolvedValue(samples);
    const { suggestions } = analyzeSamples(samples);
    const sug = suggestions.find((s) => s.type === RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL);

    const res = await POST(req({ action: 'adopt', suggestion_id: sug.id, acknowledged_simulation: true }));
    const json = await res.json();
    expect(json.adopted).toBe(true);
    expect(insertPolicy).toHaveBeenCalledTimes(1);
    // The suppression row is written through the same local writeDismissal path.
    expect(writeDismissal).toHaveBeenCalledTimes(1);
    const rec = writeDismissal.mock.calls[0][0];
    expect(rec.status).toBe('adopted');
    expect(rec.signature).toBe(sug.id);
    expect(rec.suppress_similar).toBe(true);
    // policy_id points at the draft the adoption created (the internally-generated id).
    const insertedId = insertPolicy.mock.calls[0][2].id;
    expect(rec.policy_id).toBe(insertedId);
    expect(rec.policy_id).toMatch(/^gp_/);
  });

  it('an adopted suggestion no longer appears as pending on GET', async () => {
    const samples = destructiveSamples();
    readSamples.mockResolvedValue(samples);
    const { suggestions } = analyzeSamples(samples);
    const sug = suggestions.find((s) => s.type === RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL);
    // Simulate the persisted adopted row the adopt path writes.
    readDismissals.mockResolvedValue([
      { signature: sug.id, agent_id: sug.agent_id, type: sug.type, status: 'adopted', suppress_similar: true, policy_id: 'gp_x' },
    ]);

    const res = await GET(req({}));
    const json = await res.json();
    expect(json.suggestions.find((s) => s.id === sug.id)).toBeUndefined();
    expect(json.dismissed).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/behavior/suggestions undo (v4.4)', () => {
  it('removes a recorded dismissal by signature and echoes policy_kept: null', async () => {
    readSamples.mockResolvedValue(destructiveSamples());
    removeDismissal.mockResolvedValue({ signature: 'bsg_x', status: 'dismissed', policy_id: null });

    const res = await POST(req({ action: 'undo', suggestion_id: 'bsg_x' }));
    const json = await res.json();
    expect(json).toEqual({ ok: true, suggestion_id: 'bsg_x', removed: true, policy_kept: null });
    expect(removeDismissal).toHaveBeenCalledWith('bsg_x');
  });

  it('returns 404 when nothing was recorded for the signature', async () => {
    readSamples.mockResolvedValue(destructiveSamples());
    removeDismissal.mockResolvedValue(null);

    const res = await POST(req({ action: 'undo', suggestion_id: 'bsg_missing' }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });

  it('undo of an adoption echoes policy_kept and never deletes the draft policy', async () => {
    readSamples.mockResolvedValue(destructiveSamples());
    removeDismissal.mockResolvedValue({ signature: 'bsg_x', status: 'adopted', policy_id: 'gp_kept' });

    const res = await POST(req({ action: 'undo', suggestion_id: 'bsg_x' }));
    const json = await res.json();
    expect(json.removed).toBe(true);
    expect(json.policy_kept).toBe('gp_kept');
    // insertPolicy is the only policy mutation this route can make — undo never touches it.
    expect(insertPolicy).not.toHaveBeenCalled();
  });
});
