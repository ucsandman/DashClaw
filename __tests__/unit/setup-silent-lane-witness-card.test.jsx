import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * v8.3 silent-lane witness /setup panel. Mirrors the mocking approach of
 * setup-enforcement-liveness-card.test.jsx: mock only the readiness report
 * and this panel's own repository — every other read on the page must
 * degrade gracefully on its own, same convention as its neighbors.
 */
const {
  mockGetReadinessReport, mockProjectReadinessReport, mockGetAgentLaneWitness, mockHeaders,
} = vi.hoisted(() => ({
  mockGetReadinessReport: vi.fn(),
  mockProjectReadinessReport: vi.fn(),
  mockGetAgentLaneWitness: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock('@/lib/readiness.mjs', () => ({
  getReadinessReport: mockGetReadinessReport,
  projectReadinessReport: mockProjectReadinessReport,
}));

vi.mock('@/lib/repositories/silent-lane-witness.repository', async () => {
  const actual = await vi.importActual('@/lib/repositories/silent-lane-witness.repository');
  return {
    ...actual,
    getAgentLaneWitness: mockGetAgentLaneWitness,
  };
});

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

import SetupPage from '@/setup/page.jsx';

afterEach(cleanup);

const READINESS = {
  checkedAt: '2026-08-06T12:00:00.000Z',
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

function minutesAgo(mins) {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

describe('/setup silent-lane-witness panel (v8.3)', () => {
  it('renders a recorded-ungoverned row with its activity source and no witness (MoltFire shape)', async () => {
    mockHeaders.mockResolvedValue(new Map([['cookie', '']]));
    mockGetReadinessReport.mockResolvedValue({ checkedAt: READINESS.checkedAt });
    mockProjectReadinessReport.mockReturnValue(READINESS);
    mockGetAgentLaneWitness.mockResolvedValue([
      { agentId: 'moltfire', lastActivityAt: minutesAgo(2), lastActivitySource: 'codex-notify', lastWitnessAt: null },
    ]);

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/silent-lane witness/i)).toBeTruthy();
    expect(screen.getByText('moltfire')).toBeTruthy();
    expect(screen.getByText(/recorded, ungoverned/i)).toBeTruthy();
    expect(screen.getByText(/codex-notify/i)).toBeTruthy();
    expect(screen.getByText(/none in this window/i)).toBeTruthy();
  });

  it('renders a governed row when a witness landed in the window', async () => {
    mockHeaders.mockResolvedValue(new Map([['cookie', '']]));
    mockGetReadinessReport.mockResolvedValue({ checkedAt: READINESS.checkedAt });
    mockProjectReadinessReport.mockReturnValue(READINESS);
    mockGetAgentLaneWitness.mockResolvedValue([
      { agentId: 'watched-agent', lastActivityAt: minutesAgo(5), lastActivitySource: 'codex-notify', lastWitnessAt: minutesAgo(1) },
    ]);

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText('watched-agent')).toBeTruthy();
    const card = document.getElementById('silent-lane-witness');
    expect(card?.textContent).toContain('governed');
    expect(card?.textContent).not.toContain('recorded, ungoverned');
  });

  it('renders the calm empty state when no agent has activity or witness in the window', async () => {
    mockHeaders.mockResolvedValue(new Map([['cookie', '']]));
    mockGetReadinessReport.mockResolvedValue({ checkedAt: READINESS.checkedAt });
    mockProjectReadinessReport.mockReturnValue(READINESS);
    mockGetAgentLaneWitness.mockResolvedValue([]);

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByText(/no agent activity or governance witness/i)).toBeTruthy();
  });

  it('never crashes /setup when the repository read fails (table not migrated yet)', async () => {
    mockHeaders.mockResolvedValue(new Map([['cookie', '']]));
    mockGetReadinessReport.mockResolvedValue({ checkedAt: READINESS.checkedAt });
    mockProjectReadinessReport.mockReturnValue(READINESS);
    mockGetAgentLaneWitness.mockRejectedValue(new Error('relation "action_records" does not exist'));

    const ui = await SetupPage();
    render(ui);

    expect(screen.getByRole('heading', { name: /silent-lane witness/i })).toBeTruthy();
    const card = document.getElementById('silent-lane-witness');
    expect(card?.textContent).toMatch(/could not be read/i);
  });
});
