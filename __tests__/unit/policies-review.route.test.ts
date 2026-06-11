import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

/** helpers.js returns a duck-typed request object; route handlers expect Request. */
function makeRequest(
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return rawRequest(url, opts) as unknown as Request;
}

const {
  mockSql,
  mockGetWarnDecisionsSince,
  mockGetRecentInterrupts,
  mockGroupWarnDecisions,
  mockGetSettings,
  mockUpsertSetting,
  mockInsertPolicy,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetWarnDecisionsSince: vi.fn(),
  mockGetRecentInterrupts: vi.fn(),
  mockGroupWarnDecisions: vi.fn(),
  mockGetSettings: vi.fn(),
  mockUpsertSetting: vi.fn(),
  mockInsertPolicy: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/policy-review.repository.js', () => ({
  getWarnDecisionsSince: mockGetWarnDecisionsSince,
  getRecentInterrupts: mockGetRecentInterrupts,
  groupWarnDecisions: mockGroupWarnDecisions,
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: mockGetSettings,
  upsertSetting: mockUpsertSetting,
}));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  insertPolicy: mockInsertPolicy,
}));

import { GET } from '@/api/policies/review/route.js';
import { POST } from '@/api/policies/review/verdict/route.js';

// ---------------------------------------------------------------------------
// GET /api/policies/review
// ---------------------------------------------------------------------------

describe('GET /api/policies/review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockGetSettings.mockResolvedValue([]);
    mockGetWarnDecisionsSince.mockResolvedValue([]);
    mockGetRecentInterrupts.mockResolvedValue([]);
    mockGroupWarnDecisions.mockReturnValue([]);
  });

  it('returns 200 with { groups, interrupts, cursor }', async () => {
    const groups = [{ shape: { key: 'bash::' }, count: 2, latest_at: '2026-06-10T00:00:00Z' }];
    const interrupts = [{ id: 'gd_1', decision: 'block' }];
    mockGroupWarnDecisions.mockReturnValue(groups);
    mockGetRecentInterrupts.mockResolvedValue(interrupts);

    const res = await GET(
      makeRequest('http://localhost/api/policies/review', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('groups');
    expect(data).toHaveProperty('interrupts');
    expect(data).toHaveProperty('cursor');
    expect(data.groups).toEqual(groups);
    expect(data.interrupts).toEqual(interrupts);
  });

  it('uses default cursor (7 days back) when no setting exists', async () => {
    mockGetSettings.mockResolvedValue([]);

    const before = Date.now();
    const res = await GET(
      makeRequest('http://localhost/api/policies/review', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    const after = Date.now();

    expect(res.status).toBe(200);
    const data = await res.json();
    const cursorMs = new Date(data.cursor).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    // cursor should be approximately 7 days before now
    expect(cursorMs).toBeGreaterThanOrEqual(before - sevenDaysMs - 1000);
    expect(cursorMs).toBeLessThanOrEqual(after - sevenDaysMs + 1000);
  });

  it('uses stored policy_review_cursor when present', async () => {
    const storedCursor = '2026-05-01T00:00:00Z';
    mockGetSettings
      .mockResolvedValueOnce([{ key: 'policy_review_cursor', value: storedCursor }])
      .mockResolvedValueOnce([]);

    const res = await GET(
      makeRequest('http://localhost/api/policies/review', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    const data = await res.json();
    expect(data.cursor).toBe(storedCursor);
  });

  it('passes cursor to getWarnDecisionsSince', async () => {
    const storedCursor = '2026-05-15T00:00:00Z';
    mockGetSettings
      .mockResolvedValueOnce([{ key: 'policy_review_cursor', value: storedCursor }])
      .mockResolvedValueOnce([]);

    await GET(
      makeRequest('http://localhost/api/policies/review', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    expect(mockGetWarnDecisionsSince).toHaveBeenCalledWith(mockSql, 'org_1', storedCursor);
  });

  it('treats corrupt dismissed setting as empty', async () => {
    mockGetSettings
      .mockResolvedValueOnce([{ key: 'policy_review_cursor', value: null }])
      .mockResolvedValueOnce([{ key: 'policy_review_dismissed', value: 'not-json{{{' }]);

    const res = await GET(
      makeRequest('http://localhost/api/policies/review', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    expect(res.status).toBe(200);
    // groupWarnDecisions should be called with empty dismissed map
    expect(mockGroupWarnDecisions).toHaveBeenCalledWith(expect.anything(), {});
  });

  it('returns 500 on repository error', async () => {
    mockGetSettings.mockRejectedValue(new Error('settings db fail'));
    const res = await GET(
      makeRequest('http://localhost/api/policies/review', {
        headers: { 'x-org-id': 'org_1' },
      }),
    );
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/policies/review/verdict
// ---------------------------------------------------------------------------

describe('POST /api/policies/review/verdict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockGetSettings.mockResolvedValue([]);
    mockUpsertSetting.mockResolvedValue(undefined);
    mockInsertPolicy.mockResolvedValue({ id: 'gp_new' });
  });

  it('returns 403 for non-admin', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
        body: { verdict: 'fine', shape: { action_type: 'bash' } },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid verdict', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'nonsense', shape: { action_type: 'bash' } },
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('verdict must be one of');
  });

  it('mark_all_reviewed upserts the cursor and returns { ok, cursor }', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'mark_all_reviewed' },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.cursor).toBeTruthy();
    expect(mockUpsertSetting).toHaveBeenCalledWith(
      mockSql,
      'org_1',
      expect.objectContaining({ key: 'policy_review_cursor' }),
    );
  });

  it('always_allow calls insertPolicy with policy_type allow_grant', async () => {
    mockInsertPolicy.mockResolvedValue({ id: 'gp_allow_1', policy_type: 'allow_grant' });

    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'always_allow', shape: { action_type: 'bash' } },
      }),
    );

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mockInsertPolicy).toHaveBeenCalledWith(
      mockSql,
      'org_1',
      expect.objectContaining({ policyType: 'allow_grant' }),
    );
    // rules should include action_type
    const call = mockInsertPolicy.mock.calls[0]![2];
    const rules = JSON.parse(call.rules as string);
    expect(rules.action_type).toBe('bash');
    expect(rules._grant).toBe(true);
  });

  it('always_allow with target_prefix includes prefix in rules', async () => {
    mockInsertPolicy.mockResolvedValue({ id: 'gp_allow_2' });

    await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'always_allow', shape: { action_type: 'api_call', target_prefix: 'stripe.com' } },
      }),
    );

    const call = mockInsertPolicy.mock.calls[0]![2];
    const rules = JSON.parse(call.rules as string);
    expect(rules.action_type).toBe('api_call');
    expect(rules.target_prefix).toBe('stripe.com');
  });

  it('tighten with a host shape creates require_approval with action_types', async () => {
    mockInsertPolicy.mockResolvedValue({ id: 'gp_tighten_1' });

    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'tighten', shape: { action_type: 'bash', target_prefix: 'stripe.com' } },
      }),
    );

    expect(res.status).toBe(201);
    expect(mockInsertPolicy).toHaveBeenCalledWith(
      mockSql,
      'org_1',
      expect.objectContaining({ policyType: 'require_approval' }),
    );
    const call = mockInsertPolicy.mock.calls[0]![2];
    const rules = JSON.parse(call.rules as string);
    expect(rules.action_types).toContain('bash');
    expect(rules._tightened).toBe(true);
  });

  it('tighten with a path shape (target_prefix containing /) creates protected_path', async () => {
    mockInsertPolicy.mockResolvedValue({ id: 'gp_tighten_path' });

    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'tighten', shape: { action_type: 'write_file', target_prefix: 'app/secrets/' } },
      }),
    );

    expect(res.status).toBe(201);
    expect(mockInsertPolicy).toHaveBeenCalledWith(
      mockSql,
      'org_1',
      expect.objectContaining({ policyType: 'protected_path' }),
    );
    const call = mockInsertPolicy.mock.calls[0]![2];
    const rules = JSON.parse(call.rules as string);
    expect(rules.paths).toContain('app/secrets/**');
    expect(rules._tightened).toBe(true);
  });

  it('fine upserts dismissed map with the shape key', async () => {
    // Return existing dismissed map
    mockGetSettings.mockResolvedValue([
      { key: 'policy_review_dismissed', value: JSON.stringify({ 'old_action::': '2026-01-01T00:00:00Z' }) },
    ]);

    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'fine', shape: { action_type: 'bash' } },
      }),
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.dismissed).toBe('bash::');
    expect(mockUpsertSetting).toHaveBeenCalledWith(
      mockSql,
      'org_1',
      expect.objectContaining({ key: 'policy_review_dismissed' }),
    );
    // The new dismissed map should include the new key
    const upsertCall = mockUpsertSetting.mock.calls[0]![2];
    const dismissedMap = JSON.parse(upsertCall.value as string);
    expect(dismissedMap['bash::']).toBeTruthy();
    // Should preserve existing entries
    expect(dismissedMap['old_action::']).toBe('2026-01-01T00:00:00Z');
  });

  it('fine with no existing dismissed map starts fresh', async () => {
    mockGetSettings.mockResolvedValue([]);

    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'fine', shape: { action_type: 'api_call', target_prefix: 'stripe.com' } },
      }),
    );

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertSetting.mock.calls[0]![2];
    const dismissedMap = JSON.parse(upsertCall.value as string);
    expect(dismissedMap['api_call::stripe.com']).toBeTruthy();
  });

  it('returns 400 when shape is missing for non-mark_all_reviewed verdicts', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'always_allow' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when shape.action_type exceeds 128 characters', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'always_allow', shape: { action_type: 'a'.repeat(129) } },
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('128');
    expect(mockInsertPolicy).not.toHaveBeenCalled();
  });

  it('returns 400 when shape.target_prefix exceeds 256 characters', async () => {
    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: {
          verdict: 'tighten',
          shape: { action_type: 'api_call', target_prefix: 'h'.repeat(257) },
        },
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('256');
    expect(mockInsertPolicy).not.toHaveBeenCalled();
  });

  it('returns 409 on duplicate policy name conflict', async () => {
    mockInsertPolicy.mockRejectedValue(
      Object.assign(new Error('guard_policies_org_name_unique'), { code: '23505' }),
    );

    const res = await POST(
      makeRequest('http://localhost/api/policies/review/verdict', {
        headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
        body: { verdict: 'always_allow', shape: { action_type: 'bash' } },
      }),
    );
    expect(res.status).toBe(409);
  });
});
