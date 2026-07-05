/** GET /api/hosted/funnel — hosted-mode gate + aggregate passthrough (v4.6). */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIsHostedMode, mockGetTrialFunnel } = vi.hoisted(() => ({
  mockIsHostedMode: vi.fn(),
  mockGetTrialFunnel: vi.fn(),
}));
vi.mock('@/lib/hosted/flag', () => ({ isHostedMode: mockIsHostedMode }));
vi.mock('@/lib/repositories/hosted-workspace.repository', () => ({ getTrialFunnel: mockGetTrialFunnel }));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));

import { GET } from '../../app/api/hosted/funnel/route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/hosted/funnel', () => {
  it('404s when hosted mode is off', async () => {
    mockIsHostedMode.mockReturnValue(false);
    const res = await GET();
    expect(res.status).toBe(404);
    expect(mockGetTrialFunnel).not.toHaveBeenCalled();
  });

  it('returns the aggregate funnel when hosted mode is on', async () => {
    mockIsHostedMode.mockReturnValue(true);
    mockGetTrialFunnel.mockResolvedValue({
      computedAt: 'x',
      funnel: { minted: 0, keyUsed: 0, firstAction: 0, retainedWeek1: 0, week1Eligible: 0, week1Pending: 0 },
      medianHoursToFirstAction: null,
      cohorts: [],
      source: { live: 0, archived: 0, truthfulSince: null },
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hosted).toBe(true);
    expect(body.funnel.minted).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(/org_/);
  });
});
