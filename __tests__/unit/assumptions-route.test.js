import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// --- Mocks ---

const mockSqlInstance = vi.fn();
const mockGetOrgId = vi.fn(() => 'org_test');
const mockScanSensitiveData = vi.fn((v) => ({ clean: true, redacted: v, findings: [] }));
const mockValidateAssumption = vi.fn();
const mockListAssumptions = vi.fn();
const mockCreateAssumption = vi.fn();
const mockGetDriftCounts = vi.fn();
const mockHasAction = vi.fn();

vi.mock('../../app/lib/db.js', () => ({ getSql: () => mockSqlInstance }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: (...a) => mockGetOrgId(...a) }));
vi.mock('../../app/lib/security.js', () => ({
  scanSensitiveData: (...a) => mockScanSensitiveData(...a),
  redactAny: function redactAny(value, findings) {
    if (typeof value === 'string') {
      const scan = mockScanSensitiveData(value);
      if (!scan.clean) findings.push(...scan.findings);
      return scan.redacted;
    }
    if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
      return out;
    }
    return value;
  },
}));
vi.mock('../../app/lib/validate.js', () => ({
  validateAssumption: (...a) => mockValidateAssumption(...a),
}));
vi.mock('../../app/lib/repositories/assumptions.repository.js', () => ({
  listAssumptions: (...a) => mockListAssumptions(...a),
  createAssumption: (...a) => mockCreateAssumption(...a),
  getAssumptionsDriftCounts: (...a) => mockGetDriftCounts(...a),
}));
vi.mock('../../app/lib/repositories/actions.repository.js', () => ({
  hasAction: (...a) => mockHasAction(...a),
}));

const { GET, POST } = await import('../../app/api/assumptions/route.js');

// --- Helpers ---

function getReq(params = '') {
  return makeRequest(`http://localhost:3000/api/assumptions${params}`, {
    headers: { 'x-api-key': 'oc_live_test' },
  });
}

function postReq(body) {
  return makeRequest('http://localhost:3000/api/assumptions', {
    headers: { 'x-api-key': 'oc_live_test' },
    body,
  });
}

// --- GET tests ---

describe('GET /api/assumptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists assumptions with default params', async () => {
    mockListAssumptions.mockResolvedValueOnce({
      assumptions: [{ assumption_id: 'asm_1', assumption: 'User will confirm' }],
      total: 1,
    });

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.assumptions).toHaveLength(1);
    expect(data.total).toBe(1);
    expect(data.lastUpdated).toBeDefined();

    expect(mockListAssumptions).toHaveBeenCalledWith(
      expect.anything(), 'org_test',
      expect.objectContaining({ validated: null, stale: null, action_id: null, agent_id: null })
    );
  });

  it('passes filter params through to repository', async () => {
    mockListAssumptions.mockResolvedValueOnce({ assumptions: [], total: 0 });

    await GET(getReq('?validated=true&action_id=act_1&agent_id=agent_1&limit=10&offset=5'));

    expect(mockListAssumptions).toHaveBeenCalledWith(
      expect.anything(), 'org_test',
      expect.objectContaining({
        validated: 'true',
        action_id: 'act_1',
        agent_id: 'agent_1',
        limit: '10',
        offset: '5',
      })
    );
  });

  it('returns drift scoring when drift=true', async () => {
    const now = Date.now();
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();

    mockListAssumptions.mockResolvedValueOnce({
      assumptions: [
        { assumption_id: 'asm_1', validated: 1, invalidated: 0, created_at: fiveDaysAgo },
        { assumption_id: 'asm_2', validated: 0, invalidated: 0, created_at: twentyDaysAgo },
        { assumption_id: 'asm_3', validated: 0, invalidated: 1, created_at: fiveDaysAgo },
      ],
      total: 3,
    });
    mockGetDriftCounts.mockResolvedValueOnce({
      total: 3, at_risk: 1, validated: 1, invalidated: 1, unvalidated: 1,
    });

    const res = await GET(getReq('?drift=true'));
    const data = await res.json();

    expect(data.drift_summary).toBeDefined();
    expect(data.drift_summary.total).toBe(3);
    expect(data.drift_summary.validated).toBe(1);
    expect(data.drift_summary.invalidated).toBe(1);
    expect(data.drift_summary.unvalidated).toBe(1);

    // The aggregate runs under the same filters as the list call.
    expect(mockGetDriftCounts).toHaveBeenCalledWith(
      expect.anything(), 'org_test',
      expect.objectContaining({ validated: null, stale: null, action_id: null, agent_id: null })
    );

    // Validated assumption should have drift_score 0
    expect(data.assumptions[0].drift_score).toBe(0);
    // Invalidated assumption should have drift_score null
    expect(data.assumptions[2].drift_score).toBeNull();
    // Unvalidated 20-day-old assumption should have drift_score ~67
    expect(data.assumptions[1].drift_score).toBeGreaterThan(50);
    expect(data.assumptions[1].drift_score).toBeLessThanOrEqual(100);
  });

  it('returns at_risk count for unvalidated assumptions with drift >= 50', async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    mockListAssumptions.mockResolvedValueOnce({
      assumptions: [
        { assumption_id: 'asm_old', validated: 0, invalidated: 0, created_at: thirtyOneDaysAgo },
      ],
      total: 1,
    });
    mockGetDriftCounts.mockResolvedValueOnce({
      total: 1, at_risk: 1, validated: 0, invalidated: 0, unvalidated: 1,
    });

    const res = await GET(getReq('?drift=true'));
    const data = await res.json();

    expect(data.drift_summary.at_risk).toBe(1);
    // 31 days old → capped at 100
    expect(data.assumptions[0].drift_score).toBe(100);
  });

  it('drift_summary reflects the whole table, not the returned page', async () => {
    // 2 rows on the page, 450 in the table — the summary must come from the
    // whole-table aggregate (the old page-derived counts understated all
    // tiles once the table outgrew the 200-row page cap).
    const recent = new Date().toISOString();
    mockListAssumptions.mockResolvedValueOnce({
      assumptions: [
        { assumption_id: 'asm_1', validated: 0, invalidated: 0, created_at: recent },
        { assumption_id: 'asm_2', validated: 1, invalidated: 0, created_at: recent },
      ],
      total: 450,
    });
    mockGetDriftCounts.mockResolvedValueOnce({
      total: 450, at_risk: 120, validated: 200, invalidated: 30, unvalidated: 220,
    });

    const res = await GET(getReq('?drift=true&limit=2'));
    const data = await res.json();

    expect(data.assumptions).toHaveLength(2);
    expect(data.total).toBe(450);
    expect(data.drift_summary).toEqual({
      total: 450, at_risk: 120, validated: 200, invalidated: 30, unvalidated: 220,
    });
  });

  it('returns 500 on error with safe defaults', async () => {
    mockListAssumptions.mockRejectedValueOnce(new Error('DB down'));

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
    expect(data.assumptions).toEqual([]);
  });
});

// --- POST tests ---

describe('POST /api/assumptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an assumption successfully (201)', async () => {
    mockValidateAssumption.mockReturnValueOnce({
      valid: true,
      data: { action_id: 'act_1', assumption: 'User will approve', basis: 'Past behavior' },
      errors: [],
    });
    mockHasAction.mockResolvedValueOnce(true);
    const created = { assumption_id: 'asm_gen', action_id: 'act_1', assumption: 'User will approve' };
    mockCreateAssumption.mockResolvedValueOnce(created);

    const res = await POST(postReq({
      action_id: 'act_1',
      assumption: 'User will approve',
      basis: 'Past behavior',
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.assumption).toBeDefined();
    expect(data.assumption_id).toBe('asm_gen');
    expect(data.security.clean).toBe(true);
  });

  it('auto-generates assumption_id when not provided', async () => {
    mockValidateAssumption.mockReturnValueOnce({
      valid: true,
      data: { action_id: 'act_1', assumption: 'Test' },
      errors: [],
    });
    mockHasAction.mockResolvedValueOnce(true);
    mockCreateAssumption.mockImplementationOnce(async (sql, orgId, data) => ({
      ...data,
    }));

    const res = await POST(postReq({ action_id: 'act_1', assumption: 'Test' }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.assumption_id).toMatch(/^asm_/);
  });

  it('returns 400 when validation fails', async () => {
    mockValidateAssumption.mockReturnValueOnce({
      valid: false,
      data: {},
      errors: ['assumption is required'],
    });

    const res = await POST(postReq({ action_id: 'act_1' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/validation/i);
    expect(data.details).toContain('assumption is required');
  });

  it('returns 404 when parent action does not exist', async () => {
    mockValidateAssumption.mockReturnValueOnce({
      valid: true,
      data: { action_id: 'act_nonexistent', assumption: 'Test' },
      errors: [],
    });
    mockHasAction.mockResolvedValueOnce(false);

    const res = await POST(postReq({ action_id: 'act_nonexistent', assumption: 'Test' }));
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/parent action not found/i);
  });

  it('returns 409 on duplicate assumption_id', async () => {
    mockValidateAssumption.mockReturnValueOnce({
      valid: true,
      data: { action_id: 'act_1', assumption: 'Test', assumption_id: 'asm_dup' },
      errors: [],
    });
    mockHasAction.mockResolvedValueOnce(true);
    mockCreateAssumption.mockRejectedValueOnce(new Error('unique constraint violation'));

    const res = await POST(postReq({ action_id: 'act_1', assumption: 'Test', assumption_id: 'asm_dup' }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/already exists/i);
  });

  it('redacts sensitive data before storing', async () => {
    mockValidateAssumption.mockReturnValueOnce({
      valid: true,
      data: { action_id: 'act_1', assumption: 'Key is sk-1234', basis: 'Found in env' },
      errors: [],
    });
    mockHasAction.mockResolvedValueOnce(true);
    mockScanSensitiveData
      .mockReturnValueOnce({ clean: false, redacted: 'Key is [REDACTED]', findings: [{ severity: 'critical', category: 'api_key' }] })
      .mockReturnValueOnce({ clean: true, redacted: 'Found in env', findings: [] });
    mockCreateAssumption.mockImplementationOnce(async (sql, orgId, data) => ({ ...data }));

    const res = await POST(postReq({ action_id: 'act_1', assumption: 'Key is sk-1234', basis: 'Found in env' }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.security.clean).toBe(false);
    expect(data.security.findings_count).toBe(1);
    expect(data.security.critical_count).toBe(1);
  });

  it('returns 500 on unexpected error', async () => {
    mockValidateAssumption.mockReturnValueOnce({
      valid: true,
      data: { action_id: 'act_1', assumption: 'Test' },
      errors: [],
    });
    mockHasAction.mockRejectedValueOnce(new Error('connection lost'));

    const res = await POST(postReq({ action_id: 'act_1', assumption: 'Test' }));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
  });
});
