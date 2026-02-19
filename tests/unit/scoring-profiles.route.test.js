import { describe, it, expect, vi } from 'vitest';

// -- Mocks (hoisted) ---------------------------------------------------

const mocks = vi.hoisted(() => ({
  getSql: vi.fn(() => 'mock-sql'),
  getOrgId: vi.fn(() => 'org_test123'),
  createProfile: vi.fn(),
  listProfiles: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  scoreAction: vi.fn(),
  batchScoreActions: vi.fn(),
  listProfileScores: vi.fn(),
  getProfileScoreStats: vi.fn(),
  createRiskTemplate: vi.fn(),
  listRiskTemplates: vi.fn(),
  updateRiskTemplate: vi.fn(),
  deleteRiskTemplate: vi.fn(),
  autoCalibrate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ getSql: mocks.getSql }));
vi.mock('@/lib/org', () => ({ getOrgId: mocks.getOrgId }));
vi.mock('@/lib/scoringProfiles', () => ({
  createProfile: mocks.createProfile,
  listProfiles: mocks.listProfiles,
  getProfile: mocks.getProfile,
  updateProfile: mocks.updateProfile,
  deleteProfile: mocks.deleteProfile,
  addDimension: vi.fn(),
  scoreAction: mocks.scoreAction,
  batchScoreActions: mocks.batchScoreActions,
  listProfileScores: mocks.listProfileScores,
  getProfileScoreStats: mocks.getProfileScoreStats,
  createRiskTemplate: mocks.createRiskTemplate,
  listRiskTemplates: mocks.listRiskTemplates,
  updateRiskTemplate: mocks.updateRiskTemplate,
  deleteRiskTemplate: mocks.deleteRiskTemplate,
  autoCalibrate: mocks.autoCalibrate,
}));

function makeRequest(url, options = {}) {
  return new Request(`http://localhost:3000${url}`, options);
}

// -- Profile Routes ----------------------------------------------------

describe('GET /api/scoring/profiles', () => {
  it('returns profiles list', async () => {
    const { GET } = await import('@/api/scoring/profiles/route');
    mocks.listProfiles.mockResolvedValue([
      { id: 'sp_001', name: 'Deploy Quality', status: 'active', dimensions: [] },
    ]);

    const res = await GET(makeRequest('/api/scoring/profiles'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.profiles).toHaveLength(1);
    expect(data.profiles[0].name).toBe('Deploy Quality');
  });
});

describe('POST /api/scoring/profiles', () => {
  it('creates a profile', async () => {
    const { POST } = await import('@/api/scoring/profiles/route');
    mocks.createProfile.mockResolvedValue({
      id: 'sp_new', name: 'Test Profile', status: 'active',
    });

    const res = await POST(makeRequest('/api/scoring/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Profile', composite_method: 'weighted_average' }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.id).toBe('sp_new');
  });

  it('rejects missing name', async () => {
    const { POST } = await import('@/api/scoring/profiles/route');

    const res = await POST(makeRequest('/api/scoring/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ composite_method: 'minimum' }),
    }));

    expect(res.status).toBe(400);
  });
});

// -- Profile CRUD Routes -----------------------------------------------

describe('GET /api/scoring/profiles/:id', () => {
  it('returns profile by id', async () => {
    const { GET } = await import('@/api/scoring/profiles/[profileId]/route');
    mocks.getProfile.mockResolvedValue({
      id: 'sp_001', name: 'Deploy Quality', dimensions: [],
    });

    const res = await GET(
      makeRequest('/api/scoring/profiles/sp_001'),
      { params: Promise.resolve({ profileId: 'sp_001' }) }
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.name).toBe('Deploy Quality');
  });

  it('returns 404 for missing profile', async () => {
    const { GET } = await import('@/api/scoring/profiles/[profileId]/route');
    mocks.getProfile.mockResolvedValue(null);

    const res = await GET(
      makeRequest('/api/scoring/profiles/sp_missing'),
      { params: Promise.resolve({ profileId: 'sp_missing' }) }
    );

    expect(res.status).toBe(404);
  });
});

// -- Score Route -------------------------------------------------------

describe('POST /api/scoring/score', () => {
  it('scores a single action', async () => {
    const { POST } = await import('@/api/scoring/score/route');
    mocks.scoreAction.mockResolvedValue({
      id: 'ps_001', composite_score: 82.5, dimensions: [],
    });

    const res = await POST(makeRequest('/api/scoring/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_id: 'sp_001',
        action: { duration_ms: 25000, cost_estimate: 0.01, confidence: 0.95 },
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.composite_score).toBe(82.5);
  });

  it('batch scores multiple actions', async () => {
    const { POST } = await import('@/api/scoring/score/route');
    mocks.batchScoreActions.mockResolvedValue({
      results: [{ composite_score: 80 }, { composite_score: 60 }],
      summary: { total: 2, scored: 2, avg_score: 70 },
    });

    const res = await POST(makeRequest('/api/scoring/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_id: 'sp_001',
        actions: [
          { duration_ms: 20000 },
          { duration_ms: 80000 },
        ],
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summary.avg_score).toBe(70);
  });

  it('rejects missing profile_id', async () => {
    const { POST } = await import('@/api/scoring/score/route');

    const res = await POST(makeRequest('/api/scoring/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: { duration_ms: 5000 } }),
    }));

    expect(res.status).toBe(400);
  });
});

// -- Risk Template Routes ----------------------------------------------

describe('POST /api/scoring/risk-templates', () => {
  it('creates a risk template', async () => {
    const { POST } = await import('@/api/scoring/risk-templates/route');
    mocks.createRiskTemplate.mockResolvedValue({
      id: 'rt_001', name: 'Prod Safety', base_risk: 20, rules: [],
    });

    const res = await POST(makeRequest('/api/scoring/risk-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Prod Safety',
        base_risk: 20,
        rules: [{ condition: "metadata.environment == 'production'", add: 25 }],
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.name).toBe('Prod Safety');
  });
});

// -- Calibrate Route ---------------------------------------------------

describe('POST /api/scoring/calibrate', () => {
  it('returns calibration suggestions', async () => {
    const { POST } = await import('@/api/scoring/calibrate/route');
    mocks.autoCalibrate.mockResolvedValue({
      status: 'ok',
      count: 500,
      suggestions: [
        {
          metric: 'duration_ms',
          sample_size: 480,
          distribution: { p10: 1200, p25: 3000, p50: 8000, p75: 20000, p90: 45000, min: 500, max: 120000 },
          suggested_scale: [
            { label: 'excellent', operator: 'lte', value: 3000, score: 100 },
            { label: 'good', operator: 'lte', value: 8000, score: 75 },
            { label: 'acceptable', operator: 'lte', value: 20000, score: 50 },
            { label: 'poor', operator: 'gt', value: 20000, score: 20 },
          ],
          suggested_weight: 0.2,
        },
      ],
    });

    const res = await POST(makeRequest('/api/scoring/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookback_days: 30 }),
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.suggestions).toHaveLength(1);
    expect(data.suggestions[0].metric).toBe('duration_ms');
    expect(data.suggestions[0].suggested_scale).toHaveLength(4);
  });

  it('handles insufficient data', async () => {
    const { POST } = await import('@/api/scoring/calibrate/route');
    mocks.autoCalibrate.mockResolvedValue({
      status: 'insufficient_data',
      message: 'Need at least 10 actions, found 3',
      count: 3,
      suggestions: [],
    });

    const res = await POST(makeRequest('/api/scoring/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_type: 'rare_action' }),
    }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe('insufficient_data');
    expect(data.suggestions).toHaveLength(0);
  });
});
