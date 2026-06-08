import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSettings = vi.fn();
const upsertSetting = vi.fn();

vi.mock('@/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: (...a) => getSettings(...a),
  upsertSetting: (...a) => upsertSetting(...a),
}));

const { GET, POST } = await import('@/api/behavior/insights/route.js');

const req = (body) => ({ json: async () => body, headers: { get: () => null } });

beforeEach(() => {
  vi.clearAllMocks();
  upsertSetting.mockResolvedValue(undefined);
});

describe('POST /api/behavior/insights', () => {
  it('stores only allowlisted fields and never raw behavior', async () => {
    const res = await POST(req({
      sample_count: 100,
      agent_count: 2,
      host_label: 'MY-PC',
      window_days: 7,
      oldest_ts: '2026-06-01T00:00:00Z',
      newest_ts: '2026-06-08T00:00:00Z',
      signals: {
        destructive_commands: 5, protected_path_writes: 3, failed_actions: 2,
        high_risk_actions: 9, blocked: 1, approvals: 0, EVIL: 'leak',
      },
      agents: [{ agent_id: 'claude-code', count: 80, destructive: 5, protected_writes: 3, failed: 2, tools: 7 }],
      // Raw behavioral fields that MUST NOT survive the allowlist rebuild:
      command_shape: 'rm -rf /secret/path',
      read_paths: ['/home/me/.env'],
      declared_goal: 'delete prod database',
      secret: 'sk-ant-abc123',
    }));
    const json = await res.json();

    expect(res.status ?? 200).toBe(200);
    expect(json.ok).toBe(true);
    expect(upsertSetting).toHaveBeenCalledTimes(1);
    const [, orgId, arg] = upsertSetting.mock.calls[0];
    expect(orgId).toBe('org_1');
    expect(arg.key).toBe('BEHAVIOR_INSIGHTS_SNAPSHOT');

    const stored = JSON.parse(arg.value);
    expect(stored.sample_count).toBe(100);
    expect(stored.signals.destructive_commands).toBe(5);
    expect(stored.signals).not.toHaveProperty('EVIL');
    expect(stored.agents[0].agent_id).toBe('claude-code');
    expect(stored.pushed_at).toBeTruthy(); // server-stamped, not client-supplied

    // The serialized value must carry no raw behavioral detail.
    expect(arg.value).not.toContain('rm -rf');
    expect(arg.value).not.toContain('.env');
    expect(arg.value).not.toContain('delete prod');
    expect(arg.value).not.toContain('sk-ant');
  });

  it('clamps negative and non-numeric values to safe integers', async () => {
    const res = await POST(req({
      sample_count: -5,
      agents: [{ agent_id: 'a', count: 'NaN', destructive: -3, tools: 999999 }],
      signals: { high_risk_actions: 1 },
    }));
    expect((await res.json()).ok).toBe(true);
    const stored = JSON.parse(upsertSetting.mock.calls[0][2].value);
    expect(stored.sample_count).toBe(0);
    expect(stored.agents[0].count).toBe(0);
    expect(stored.agents[0].destructive).toBe(0);
    expect(stored.agents[0].tools).toBe(10000); // upper clamp
  });

  it('rejects an empty snapshot (no samples, no agents)', async () => {
    const res = await POST(req({ sample_count: 0, agents: [] }));
    expect(res.status).toBe(400);
    expect(upsertSetting).not.toHaveBeenCalled();
  });

  it('rejects a non-object body', async () => {
    const res = await POST({ json: async () => null, headers: { get: () => null } });
    expect(res.status).toBe(400);
    expect(upsertSetting).not.toHaveBeenCalled();
  });

  it('caps the agents list to 25', async () => {
    const agents = Array.from({ length: 40 }, (_, i) => ({ agent_id: `a-${i}`, count: 40 - i }));
    const res = await POST(req({ sample_count: 100, agents }));
    expect((await res.json()).ok).toBe(true);
    const stored = JSON.parse(upsertSetting.mock.calls[0][2].value);
    expect(stored.agents.length).toBe(25);
  });
});

describe('GET /api/behavior/insights', () => {
  it('returns the stored snapshot', async () => {
    getSettings.mockResolvedValue([{ key: 'BEHAVIOR_INSIGHTS_SNAPSHOT', value: JSON.stringify({ schema_version: 1, sample_count: 42 }) }]);
    const res = await GET(req());
    expect((await res.json()).snapshot.sample_count).toBe(42);
  });

  it('returns null when nothing is stored', async () => {
    getSettings.mockResolvedValue([]);
    const res = await GET(req());
    expect((await res.json()).snapshot).toBe(null);
  });

  it('returns null on corrupt stored JSON', async () => {
    getSettings.mockResolvedValue([{ key: 'BEHAVIOR_INSIGHTS_SNAPSHOT', value: '{not json' }]);
    const res = await GET(req());
    expect((await res.json()).snapshot).toBe(null);
  });
});
