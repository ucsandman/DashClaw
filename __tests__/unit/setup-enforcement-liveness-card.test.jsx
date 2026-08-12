import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * v8.2 enforcement-liveness /setup card. Mirrors the mocking approach of
 * __tests__/unit/setup.page.test.jsx (mock only the readiness report; every
 * other read — including this card's — must degrade gracefully on its own,
 * same as the live-host canary card it sits next to).
 */
const {
  mockGetReadinessReport, mockProjectReadinessReport, mockGetLatestRun, mockListPerRuntime, mockHeaders,
} = vi.hoisted(() => ({
  mockGetReadinessReport: vi.fn(),
  mockProjectReadinessReport: vi.fn(),
  mockGetLatestRun: vi.fn(),
  mockListPerRuntime: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock('@/lib/readiness.mjs', () => ({
  getReadinessReport: mockGetReadinessReport,
  projectReadinessReport: mockProjectReadinessReport,
}));

// The DB reads are mocked; the rollup is NOT. Using the real
// deriveFleetEnforcementLiveness is the point of these tests — a stubbed
// derivation is exactly what let the seam-masking bug ship green.
vi.mock('@/lib/repositories/enforcement-liveness.repository', async () => {
  const real = await vi.importActual('../../app/lib/enforcement-liveness.ts');
  return {
    getLatestEnforcementLivenessRunForOrg: mockGetLatestRun,
    listLatestEnforcementLivenessRunPerRuntime: mockListPerRuntime,
    deriveFleetEnforcementLiveness: real.deriveFleetEnforcementLiveness,
    ENFORCEMENT_LIVENESS_STALE_MS: 24 * 60 * 60 * 1000,
  };
});

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
    runtime: 'claude-code',
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

// The fleet badge in the card header, as distinct from the per-check "pass"
// rows inside it — asserting on the card's whole textContent cannot tell those
// apart, and the difference is the entire point of the masking test below.
function fleetBadgeText() {
  const card = document.getElementById('enforcement-liveness');
  const header = card?.querySelector('h2')?.closest('div')?.parentElement;
  return header?.querySelector('span')?.textContent?.trim() ?? null;
}

describe('/setup enforcement-liveness card (v8.2)', () => {
  beforeEach(() => {
    mockHeaders.mockResolvedValue(new Map([['cookie', '']]));
    mockGetReadinessReport.mockResolvedValue({ checkedAt: READINESS.checkedAt });
    mockProjectReadinessReport.mockReturnValue(READINESS);
  });

  it('renders holding: pass style + relative-time headline', async () => {
    mockGetLatestRun.mockResolvedValue(baseRun());
    mockListPerRuntime.mockResolvedValue([baseRun()]);

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/enforcement liveness/i)).toBeTruthy();
    expect(screen.getByText(/enforcement held the probe action/i)).toBeTruthy();
    expect(fleetBadgeText()).toBe('pass');
  });

  it('renders stale: warn style + the exact probe command', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    mockGetLatestRun.mockResolvedValue(baseRun({ finished_at: old }));
    mockListPerRuntime.mockResolvedValue([baseRun({ finished_at: old })]);

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/no probe run in the last 24h/i)).toBeTruthy();
    expect(screen.getByText('npm run liveness:probe')).toBeTruthy();
  });

  it('renders broken: fail style + the run detail as the headline', async () => {
    const broken = baseRun({
      verdict: 'executed',
      detail: 'The held action executed against the live database.',
    });
    mockGetLatestRun.mockResolvedValue(broken);
    mockListPerRuntime.mockResolvedValue([broken]);

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/the held action executed against the live database/i)).toBeTruthy();
  });

  // THE REGRESSION. Before drizzle/0072 the card derived from the newest run
  // across all seams, so this exact pair rendered 'pass' while Codex sat dead.
  it('a healthy claude-code seam can no longer mask a broken codex seam', async () => {
    const healthy = baseRun({ id: 'elr_cc', runtime: 'claude-code', verdict: 'held' });
    const dead = baseRun({
      id: 'elr_cx',
      runtime: 'codex',
      verdict: 'executed',
      detail: 'The held action executed on the codex seam.',
    });
    // Newest overall is the HEALTHY one — the masking condition exactly.
    mockGetLatestRun.mockResolvedValue(healthy);
    mockListPerRuntime.mockResolvedValue([healthy, dead]);

    const ui = await SetupPage();
    render(ui);

    // The FLEET badge flips to fail even though the newest run held.
    expect(fleetBadgeText()).toBe('fail');
    // ...and the dead seam is NAMED, not just counted.
    const card = document.getElementById('enforcement-liveness');
    expect(card?.textContent).toContain('codex');
    expect(card?.textContent).toContain('claude-code');
  });

  it('lists every reporting seam with its own state', async () => {
    const healthy = baseRun({ id: 'elr_cc', runtime: 'claude-code' });
    const quiet = baseRun({
      id: 'elr_cx',
      runtime: 'codex',
      finished_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    mockGetLatestRun.mockResolvedValue(healthy);
    mockListPerRuntime.mockResolvedValue([healthy, quiet]);

    const ui = await SetupPage();
    render(ui);

    const card = document.getElementById('enforcement-liveness');
    expect(card?.textContent).toContain('Seams reporting (2)');
    // Worst seam wins the fleet badge: one stale seam makes the fleet stale.
    expect(card?.textContent).toContain('stale');
  });

  it('never crashes /setup when the repository read fails (table not migrated yet)', async () => {
    mockGetLatestRun.mockRejectedValue(new Error('relation "enforcement_liveness_runs" does not exist'));
    mockListPerRuntime.mockRejectedValue(new Error('relation "enforcement_liveness_runs" does not exist'));

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/enforcement liveness/i)).toBeTruthy();
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
  });

  it('renders a "no probe run yet" skip state without crashing', async () => {
    mockGetLatestRun.mockResolvedValue(null);
    mockListPerRuntime.mockResolvedValue([]);

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/no probe run yet/i)).toBeTruthy();
  });
});
