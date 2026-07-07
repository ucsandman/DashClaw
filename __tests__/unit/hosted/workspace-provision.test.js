import { describe, it, expect, vi, beforeEach } from 'vitest';

// Starter-pack seeding runs inside provisionHostedWorkspace. Mock it with a
// benign default so the existing call-count invariants hold; individual tests
// swap in the REAL implementation (captured below) or a failure.
const { mockImportPolicyPack, importPackHolder } = vi.hoisted(() => ({
  mockImportPolicyPack: vi.fn(),
  importPackHolder: {},
}));
vi.mock('../../../app/lib/guardrails/import-pack.js', async (importOriginal) => {
  const actual = await importOriginal();
  importPackHolder.actual = actual.importPolicyPack;
  return { ...actual, importPolicyPack: (...a) => mockImportPolicyPack(...a) };
});
import {
  provisionHostedWorkspace,
  getHostedWorkspace,
  deleteHostedWorkspace,
  findExpiredWorkspaces,
} from '../../../app/lib/repositories/hosted-workspace.repository.js';

function createSqlMock() {
  return vi.fn();
}

describe('hosted-workspace repository', () => {
  let sql;
  beforeEach(() => {
    sql = createSqlMock();
    mockImportPolicyPack.mockReset();
    mockImportPolicyPack.mockResolvedValue({ imported: [], skipped: [], errors: [] });
  });

  it('provisionHostedWorkspace creates org + api_key and returns plaintext key once', async () => {
    sql.mockResolvedValueOnce([]); // org insert
    sql.mockResolvedValueOnce([]); // api_key insert
    const res = await provisionHostedWorkspace(sql, {
      trialDays: 30,
      trialActionCap: 10000,
      label: 'trial',
    });
    expect(res.orgId).toMatch(/^org_/);
    expect(res.apiKey).toMatch(/^oc_live_[0-9a-f]{32}$/);
    expect(res.keyPrefix).toMatch(/^oc_live_/);
    expect(res.expiresAt).toBeTypeOf('string');
    expect(sql.mock.calls.length).toBe(2);
    // Starter policy pack seeded for the new workspace.
    expect(mockImportPolicyPack).toHaveBeenCalledWith(sql, res.orgId, 'claude-code-starter');
  });

  it('provisioned trial workspace gets the claude-code-starter policies (count + names match the pack yml)', async () => {
    // Run the REAL importer against an sql mock that answers the guard_policies
    // reads/inserts; everything else (org/key inserts) returns [].
    mockImportPolicyPack.mockImplementation((...a) => importPackHolder.actual(...a));
    const insertedPolicies = [];
    sql.mockImplementation(async (strings, ...values) => {
      const text = strings.join(' ');
      if (text.includes('SELECT id FROM guard_policies')) return []; // no name conflicts
      if (text.includes('INSERT INTO guard_policies')) {
        // insertPolicy values order: id, orgId, name, policyType, rules, active, agentIds, ts, ts
        insertedPolicies.push({ id: values[0], name: values[2], policy_type: values[3], active: 1 });
        return [insertedPolicies[insertedPolicies.length - 1]];
      }
      return [];
    });

    const res = await provisionHostedWorkspace(sql, { trialDays: 30, trialActionCap: 10000 });
    expect(res.apiKey).toMatch(/^oc_live_/);

    // The real pack yml defines exactly these four policies.
    expect(insertedPolicies.map((p) => p.name)).toEqual([
      'Claude Code Starter — Block Mass-Destructive Operations',
      'Claude Code Starter — Require Approval for Network Calls',
      'Claude Code Starter — Require Approval for Package Installs',
      'Claude Code Starter — Rate-Limit Runaway Agents',
    ]);
  });

  it('seeding failure still returns a successful provision response and logs an error', async () => {
    mockImportPolicyPack.mockRejectedValue(new Error('pack file unreadable'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      sql.mockResolvedValue([]);
      const res = await provisionHostedWorkspace(sql, { trialDays: 30, trialActionCap: 10000 });
      expect(res.orgId).toMatch(/^org_/);
      expect(res.apiKey).toMatch(/^oc_live_/);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining(`starter-pack seeding failed for ${res.orgId}`),
        'pack file unreadable',
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it('provisionHostedWorkspace propagates errors from inserts', async () => {
    sql.mockRejectedValueOnce(new Error('db down'));
    await expect(
      provisionHostedWorkspace(sql, { trialDays: 30, trialActionCap: 10000 }),
    ).rejects.toThrow(/db down/);
  });

  it('provisionHostedWorkspace cleans up org when api_key insert fails (3-call invariant)', async () => {
    sql.mockResolvedValueOnce([]); // org INSERT succeeds
    sql.mockRejectedValueOnce(new Error('key fail')); // api_key INSERT fails
    sql.mockResolvedValueOnce([]); // best-effort DELETE cleanup
    await expect(
      provisionHostedWorkspace(sql, { trialDays: 30, trialActionCap: 10000 }),
    ).rejects.toThrow(/key fail/);
    expect(sql.mock.calls.length).toBe(3);
  });

  it('getHostedWorkspace returns null when not found', async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getHostedWorkspace(sql, 'org_missing')).toBeNull();
  });

  it('getHostedWorkspace returns workspace when found', async () => {
    sql.mockResolvedValueOnce([{
      id: 'org_abc',
      name: 'Trial',
      hosted_mode: true,
      trial_ends_at: '2026-05-18T00:00:00Z',
      trial_action_cap: 10000,
      trial_actions_used: 42,
    }]);
    const res = await getHostedWorkspace(sql, 'org_abc');
    expect(res).toEqual({
      orgId: 'org_abc',
      name: 'Trial',
      hostedMode: true,
      trialEndsAt: '2026-05-18T00:00:00Z',
      trialActionCap: 10000,
      trialActionsUsed: 42,
    });
  });

  it('deleteHostedWorkspace refuses to delete non-hosted orgs', async () => {
    sql.mockResolvedValueOnce([{ hosted_mode: false }]);
    await expect(deleteHostedWorkspace(sql, 'org_real')).rejects.toThrow(/not a hosted/);
  });

  it('deleteHostedWorkspace deletes catalog-discovered child rows before the org (FK 23503 regression)', async () => {
    sql.mockResolvedValueOnce([{ hosted_mode: true }]); // existence check
    sql.mockResolvedValueOnce([]); // api_keys revoke
    // v4.6: snapshotTrialFunnelFacts calls queryLiveTrialFacts
    sql.mockResolvedValueOnce([
      {
        org_id: 'org_x',
        minted_at_ms: Date.now() - 86400000, // 1 day ago
        key_used: true,
        first_action_at_ms: Date.now() - 86400000,
        last_action_at_ms: Date.now(),
        action_count: 5,
      },
    ]); // queryLiveTrialFacts SELECT
    sql.mockResolvedValueOnce([]); // v6.4: raw-source select before the freeze
    sql.mockResolvedValueOnce([]); // INSERT into hosted_trial_snapshots
    sql.mockResolvedValueOnce([
      { table_name: 'api_keys', column_name: 'org_id' },
      { table_name: 'action_records', column_name: 'org_id' },
      { table_name: 'bad;table', column_name: 'org_id' }, // unsafe ident must be skipped
    ]); // FK catalog discovery
    sql.mockResolvedValueOnce([]); // org delete
    sql.query = vi.fn().mockResolvedValue([]);

    const res = await deleteHostedWorkspace(sql, 'org_x');
    expect(res).toEqual({ deleted: true });
    expect(sql.query.mock.calls.map((c) => c[0])).toEqual([
      'DELETE FROM "api_keys" WHERE "org_id" = $1',
      'DELETE FROM "action_records" WHERE "org_id" = $1',
    ]);
    expect(sql.query).toHaveBeenCalledWith(expect.any(String), ['org_x']);
    // Org delete is the last tagged-template call.
    const lastSql = sql.mock.calls[sql.mock.calls.length - 1][0].join(' ');
    expect(lastSql).toContain('DELETE FROM organizations');
  });

  it('deleteHostedWorkspace retries child deletes blocked by FK ordering', async () => {
    sql.mockResolvedValueOnce([{ hosted_mode: true }]);
    sql.mockResolvedValueOnce([]); // revoke
    // v4.6: snapshotTrialFunnelFacts calls queryLiveTrialFacts
    sql.mockResolvedValueOnce([
      {
        org_id: 'org_x',
        minted_at_ms: Date.now() - 86400000,
        key_used: true,
        first_action_at_ms: Date.now() - 86400000,
        last_action_at_ms: Date.now(),
        action_count: 3,
      },
    ]); // queryLiveTrialFacts SELECT
    sql.mockResolvedValueOnce([]); // v6.4: raw-source select before the freeze
    sql.mockResolvedValueOnce([]); // INSERT into hosted_trial_snapshots
    sql.mockResolvedValueOnce([
      { table_name: 'action_records', column_name: 'org_id' },
      { table_name: 'action_embeddings', column_name: 'org_id' },
    ]);
    sql.mockResolvedValueOnce([]); // org delete
    // action_records fails while action_embeddings still references it, then
    // succeeds on the second pass.
    sql.query = vi.fn()
      .mockRejectedValueOnce(new Error('violates foreign key constraint'))
      .mockResolvedValue([]);

    const res = await deleteHostedWorkspace(sql, 'org_x');
    expect(res).toEqual({ deleted: true });
    expect(sql.query.mock.calls.map((c) => c[0])).toEqual([
      'DELETE FROM "action_records" WHERE "org_id" = $1',
      'DELETE FROM "action_embeddings" WHERE "org_id" = $1',
      'DELETE FROM "action_records" WHERE "org_id" = $1',
    ]);
  });

  it('findExpiredWorkspaces returns orgs past trialEndsAt', async () => {
    sql.mockResolvedValueOnce([{ id: 'org_old' }, { id: 'org_older' }]);
    const res = await findExpiredWorkspaces(sql, { now: new Date('2026-06-01T00:00:00Z') });
    expect(res).toEqual(['org_old', 'org_older']);
  });
});

// Route-level tests — use globalThis.__dashclaw_sql to intercept getSql() calls.
// getSql() checks globalThis.__dashclaw_sql first (db.js line 35), so we inject
// the mock there rather than mocking the neon module (which would affect the
// entire file and risk breaking the repo tests above).

const { POST, _resetLimiterForTests } = await import('../../../app/api/hosted/workspaces/route.js');

function makeRequest({ body = {}, ip = '1.1.1.1' } = {}) {
  return new Request('http://localhost:3000/api/hosted/workspaces', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/hosted/workspaces', () => {
  const originalEnv = { ...process.env };
  const routeSqlMock = vi.fn();

  beforeEach(() => {
    process.env = { ...originalEnv };
    routeSqlMock.mockReset();
    mockImportPolicyPack.mockReset();
    mockImportPolicyPack.mockResolvedValue({ imported: [], skipped: [], errors: [] });
    // Reset module-level rate-limiter singleton so prior tests' counters
    // and max-setting don't leak across cases.
    _resetLimiterForTests();
    // Inject mock into getSql() via the globalThis cache (db.js line 35)
    globalThis.__dashclaw_sql = routeSqlMock;
  });

  afterEach(() => {
    delete globalThis.__dashclaw_sql;
  });

  it('returns 404 when DASHCLAW_HOSTED is unset', async () => {
    delete process.env.DASHCLAW_HOSTED;
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
  });

  it('returns 400 when turnstile token missing in production', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const res = await POST(makeRequest({ body: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/turnstile/i);
  });

  it('returns 200 + api key when happy path (turnstile bypassed in dev)', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    delete process.env.TURNSTILE_SECRET_KEY;
    // Calls: countActiveTrials SELECT, org insert, key insert
    routeSqlMock.mockResolvedValueOnce([{ count: 0 }]); // countActiveTrials → under cap
    routeSqlMock.mockResolvedValueOnce([]);              // org insert
    routeSqlMock.mockResolvedValueOnce([]);              // key insert
    const res = await POST(makeRequest({ body: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      workspace_id: expect.stringMatching(/^org_/),
      api_key: expect.stringMatching(/^oc_live_/),
      endpoint: expect.any(String),
      expires_at: expect.any(String),
    });
  });

  it('returns 429 when IP rate-limited', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    process.env.HOSTED_PROVISION_MAX_PER_IP_PER_DAY = '1';
    // The route's clientIp helper now requires TRUST_PROXY to honor
    // x-forwarded-for (matches middleware.js — prevents IP spoofing on
    // self-host without a controlled reverse proxy). Production sets this
    // implicitly via the VERCEL env var; tests have to set it explicitly.
    process.env.TRUST_PROXY = 'true';
    delete process.env.TURNSTILE_SECRET_KEY;
    // Calls for first POST: countActiveTrials SELECT, org insert, key insert
    routeSqlMock.mockResolvedValueOnce([{ count: 0 }]); // countActiveTrials → under cap
    routeSqlMock.mockResolvedValueOnce([]);              // org insert
    routeSqlMock.mockResolvedValueOnce([]);              // key insert
    await POST(makeRequest({ ip: '9.9.9.9' })); // first — ok
    // Second POST is rate-limited before reaching the DB; no DB mocks needed
    const res = await POST(makeRequest({ ip: '9.9.9.9' })); // second — blocked
    expect(res.status).toBe(429);
  });

  it('returns 503 trials-full when active trials >= cap, without provisioning', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    process.env.HOSTED_MAX_ACTIVE_TRIALS = '1';
    delete process.env.TURNSTILE_SECRET_KEY;            // dev bypass
    routeSqlMock.mockResolvedValueOnce([{ count: 1 }]); // countActiveTrials SELECT → active = 1
    const res = await POST(makeRequest({ body: {} }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.full).toBe(true);
    // provisioning never ran: only the count query was issued (no org/key INSERT)
    expect(routeSqlMock.mock.calls.length).toBe(1);
  });
});
