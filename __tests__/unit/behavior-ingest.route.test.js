import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSettings = vi.fn();
const upsertBehaviorSamples = vi.fn();
const pruneBehaviorSamples = vi.fn();

vi.mock('@/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: (...a) => getSettings(...a),
}));
vi.mock('@/lib/repositories/behavior.repository.js', () => ({
  upsertBehaviorSamples: (...a) => upsertBehaviorSamples(...a),
  pruneBehaviorSamples: (...a) => pruneBehaviorSamples(...a),
}));

const { POST } = await import('@/api/behavior/samples/ingest/route.js');

const req = (body) => ({
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { get: () => null },
});

const validSample = (over = {}) => ({
  event_id: 'bse_0001',
  ts: '2026-06-09T10:00:00.000Z',
  agent_id: 'claude-code',
  tool: 'Bash',
  command_shape: 'git push --force',
  bash_intent: 'destructive',
  risk_score: 85,
  guard_decision: 'allow',
  reversible: false,
  outcome_status: 'completed',
  read_paths: ['ph_a1b2c3d4e5f6'],
  write_paths: ['ph_ffeeddccbbaa'],
  write_path_groups: ['auth'],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue([{ key: 'BEHAVIOR_UPLOAD_ENABLED', value: 'true' }]);
  upsertBehaviorSamples.mockResolvedValue(1);
  pruneBehaviorSamples.mockResolvedValue(0);
});

describe('POST /api/behavior/samples/ingest — allowlist rebuild', () => {
  it('a hostile sample with extra fields stores NONE of them', async () => {
    const res = await POST(req({
      samples: [validSample({
        // Fields that must NEVER reach the DB:
        declared_goal: 'delete prod database',
        project: 'secret-client-project',
        agent_name: 'Wes Personal Agent',
        matched_policies: [{ id: 'gp_1', name: 'leaky' }],
        intel: { bash: { command_preview: 'rm -rf /home/wes' } },
        raw_command: 'curl -H "Authorization: Bearer sk-ant-abc123"',
        EVIL: 'smuggled',
      })],
    }));
    const json = await res.json();
    expect(res.status ?? 200).toBe(200);
    expect(json.ingested).toBe(1);
    expect(upsertBehaviorSamples).toHaveBeenCalledTimes(1);

    const [, orgId, rows] = upsertBehaviorSamples.mock.calls[0];
    expect(orgId).toBe('org_1');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Allowlisted fields survive.
    expect(row.event_id).toBe('bse_0001');
    expect(row.agent_id).toBe('claude-code');
    expect(row.command_shape).toBe('git push --force');
    expect(row.risk_score).toBe(85);
    expect(row.read_path_hashes).toEqual(['ph_a1b2c3d4e5f6']);
    expect(row.write_path_groups).toEqual(['auth']);
    expect(row.finalized).toBe(1); // completed ⇒ final
    // Hostile fields can never reach the repository.
    for (const k of ['declared_goal', 'project', 'agent_name', 'matched_policies', 'intel', 'raw_command', 'EVIL', 'read_paths', 'write_paths']) {
      expect(row).not.toHaveProperty(k);
    }
    expect(JSON.stringify(row)).not.toContain('sk-ant');
    expect(JSON.stringify(row)).not.toContain('delete prod');
    expect(JSON.stringify(row)).not.toContain('secret-client-project');
  });

  it('filters write_path_groups to the canonical group labels', async () => {
    await POST(req({ samples: [validSample({ write_path_groups: ['auth', 'NOT_A_GROUP', '/etc/passwd', 'secrets'] })] }));
    const row = upsertBehaviorSamples.mock.calls[0][2][0];
    expect(row.write_path_groups).toEqual(['auth', 'secrets']);
  });

  it('drops raw (un-hashed) path entries — server enforces the ph_ token format', async () => {
    await POST(req({ samples: [validSample({
      read_paths: ['app/api/auth/route.ts', 'ph_a1b2c3d4e5f6', '../../etc/passwd'],
      write_paths: ['C:/Users/wes/.env'],
      session_hash: 'not-a-hash',
    })] }));
    const row = upsertBehaviorSamples.mock.calls[0][2][0];
    expect(row.read_path_hashes).toEqual(['ph_a1b2c3d4e5f6']);
    expect(row.write_path_hashes).toEqual([]);
    expect(row.session_hash).toBeNull();
  });

  it('drops rows missing identity (event_id / agent_id / parseable ts)', async () => {
    const res = await POST(req({ samples: [{ tool: 'Bash' }, validSample()] }));
    const json = await res.json();
    expect(json.ingested).toBe(1);
    expect(upsertBehaviorSamples.mock.calls[0][2]).toHaveLength(1);
  });

  it('marks a running record as non-finalized', async () => {
    await POST(req({ samples: [validSample({ outcome_status: 'running' })] }));
    expect(upsertBehaviorSamples.mock.calls[0][2][0].finalized).toBe(0);
  });
});

describe('POST /api/behavior/samples/ingest — limits and gating', () => {
  it('rejects a batch of more than 500 samples', async () => {
    const samples = Array.from({ length: 501 }, (_, i) => validSample({ event_id: `bse_${i}` }));
    const res = await POST(req({ samples }));
    expect(res.status).toBe(400);
    expect(upsertBehaviorSamples).not.toHaveBeenCalled();
  });

  it('rejects a payload over ~1MB', async () => {
    const res = await POST(req('x'.repeat(1_000_001)));
    expect(res.status).toBe(413);
    expect(upsertBehaviorSamples).not.toHaveBeenCalled();
  });

  it('refuses when the org has not opted in (BEHAVIOR_UPLOAD_ENABLED unset)', async () => {
    getSettings.mockResolvedValue([]);
    const res = await POST(req({ samples: [validSample()] }));
    expect(res.status).toBe(403);
    expect(upsertBehaviorSamples).not.toHaveBeenCalled();
  });

  it('rejects an empty or malformed body', async () => {
    expect((await POST(req({ nope: true }))).status).toBe(400);
    expect((await POST(req({ samples: [] }))).status).toBe(400);
    expect((await POST(req('{not json'))).status).toBe(400);
    expect(upsertBehaviorSamples).not.toHaveBeenCalled();
  });
});
