import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * v8.2 enforcement-liveness /setup card. Mirrors the mocking approach of
 * __tests__/unit/setup.page.test.jsx (mock only the readiness report; every
 * other read — including this card's — must degrade gracefully on its own,
 * same as the live-host canary card it sits next to).
 */
const {
  mockGetReadinessReport, mockProjectReadinessReport, mockGetLatestRun, mockDeriveState, mockHeaders,
} = vi.hoisted(() => ({
  mockGetReadinessReport: vi.fn(),
  mockProjectReadinessReport: vi.fn(),
  mockGetLatestRun: vi.fn(),
  mockDeriveState: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock('@/lib/readiness.mjs', () => ({
  getReadinessReport: mockGetReadinessReport,
  projectReadinessReport: mockProjectReadinessReport,
}));

vi.mock('@/lib/repositories/enforcement-liveness.repository', () => ({
  getLatestEnforcementLivenessRunForOrg: mockGetLatestRun,
  deriveEnforcementLivenessState: mockDeriveState,
  ENFORCEMENT_LIVENESS_STALE_MS: 24 * 60 * 60 * 1000,
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

import SetupPage from '@/setup/page.jsx';

afterEach(cleanup);

const READINESS = {
  checkedAt: '2026-07-06T12:00:00.000Z',
  verification: {
    overall: 'ready_unverified',
    label: 'Ready but not fully verified',
    summary: 'Core checks are passing, but deeper validation or operator follow-up is still pending.',
    readiness: 'healthy',
    fullyVerified: false,
  },
  sections: [],
  workflow: [],
  recommendations: [],
};

function baseRun(overrides = {}) {
  const now = Date.now();
  return {
    id: 'elr_1',
    org_id: 'org_default',
    source: 'liveness-probe',
    verdict: 'held',
    detail: 'Held as expected.',
    hook: { installed: true, mode: 'block', timeout_seconds: 5, effective_timer_ms: 5000, overflowed: false, cancelled: false },
    witness: { path: '/tmp/liveness-witness', executed: false },
    decision: 'held',
    checks: [{ id: 'probe', title: 'Probe action did not execute', status: 'pass' }],
    started_at: new Date(now - 60_000).toISOString(),
    finished_at: new Date(now - 30_000).toISOString(),
    created_at: new Date(now - 60_000).toISOString(),
    ...overrides,
  };
}

describe('/setup enforcement-liveness card (v8.2)', () => {
  beforeEach(() => {
    mockHeaders.mockResolvedValue(new Map([['cookie', '']]));
    mockGetReadinessReport.mockResolvedValue({ checkedAt: READINESS.checkedAt });
    mockProjectReadinessReport.mockReturnValue(READINESS);
  });

  it('renders holding: pass style + relative-time headline', async () => {
    mockGetLatestRun.mockResolvedValue(baseRun());
    mockDeriveState.mockReturnValue('holding');

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/enforcement liveness/i)).toBeTruthy();
    expect(screen.getByText(/enforcement held the probe action/i)).toBeTruthy();
    const card = document.getElementById('enforcement-liveness');
    expect(card?.textContent).toContain('pass');
  });

  it('renders stale: warn style + the exact probe command', async () => {
    mockGetLatestRun.mockResolvedValue(baseRun());
    mockDeriveState.mockReturnValue('stale');

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/no probe run in the last 24h/i)).toBeTruthy();
    expect(screen.getByText('npm run liveness:probe')).toBeTruthy();
  });

  it('renders broken: fail style + the run detail as the headline', async () => {
    mockGetLatestRun.mockResolvedValue(baseRun({
      verdict: 'executed',
      detail: 'The held action executed against the live database.',
    }));
    mockDeriveState.mockReturnValue('broken');

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/the held action executed against the live database/i)).toBeTruthy();
  });

  it('never crashes /setup when the repository read fails (table not migrated yet)', async () => {
    mockGetLatestRun.mockRejectedValue(new Error('relation "enforcement_liveness_runs" does not exist'));

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/enforcement liveness/i)).toBeTruthy();
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
  });

  it('renders a "no probe run yet" skip state without crashing', async () => {
    mockGetLatestRun.mockResolvedValue(null);

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/no probe run yet/i)).toBeTruthy();
  });
});
