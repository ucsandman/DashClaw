import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// P14: the drift page renders REAL evidence — the baseline percentiles and
// 10-bucket distribution stored (but never rendered) since the schema
// shipped — plus honest handling of the z=999 zero-variance sentinel and
// VISIBLE errors when a non-admin hits the admin-gated ack/delete routes.

vi.mock('@/components/PageLayout', () => ({ default: ({ children, actions }) => <div>{actions}{children}</div> }));
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardHeader: ({ title }) => <div>{title}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }) => <span>{children}</span> }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: ({ title }) => <div>{title}</div> }));
vi.mock('@/components/ui/Skeleton', () => ({ ListSkeleton: () => <div>loading…</div> }));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));

const { default: DriftPage } = await import('@/drift/page.jsx');

const ALERT = {
  id: 'da_1',
  severity: 'critical',
  metric: 'risk_score',
  agent_id: 'agent-x',
  description: 'Risk Score for agent-x has increased by 60% (z-score: 3.2).',
  z_score: 3.2,
  direction: 'increasing',
  pct_change: 60,
  baseline_mean: 50,
  baseline_stddev: 10,
  current_mean: 80,
  current_stddev: 8,
  sample_count: 12,
  acknowledged: false,
  created_at: '2026-06-09T12:00:00.000Z',
  // Evidence joined from the baseline row
  baseline_median: 49.5,
  baseline_p5: 31,
  baseline_p25: 42,
  baseline_p75: 58,
  baseline_p95: 69,
  baseline_min: 28,
  baseline_max: 74,
  baseline_sample_count: 40,
  baseline_distribution: JSON.stringify({ '28-32.6': 4, '32.6-37.2': 6, '37.2-41.8': 10, '41.8-46.4': 8, '46.4-51': 12 }),
};

const SENTINEL_ALERT = {
  ...ALERT,
  id: 'da_2',
  metric: 'cost_estimate',
  severity: 'warning',
  z_score: 999,
  baseline_distribution: null,
  baseline_median: null,
};

function mockFetch({ alerts = [ALERT], patchStatus = 200 } = {}) {
  return vi.fn(async (url, options = {}) => {
    const u = String(url);
    const method = options.method || 'GET';
    if (u.startsWith('/api/drift/alerts/') && (method === 'PATCH' || method === 'DELETE')) {
      return { ok: patchStatus < 400, status: patchStatus, json: async () => (patchStatus < 400 ? { acknowledged: true } : { error: 'Admin access required' }) };
    }
    if (u.startsWith('/api/drift/alerts')) return { ok: true, json: async () => ({ alerts }) };
    if (u.startsWith('/api/drift/stats')) {
      return {
        ok: true,
        json: async () => ({
          overall: { total_alerts: alerts.length, critical_count: 1, warning_count: 1, info_count: 0, unacknowledged: alerts.length },
          recent_baselines: [{ agent_id: 'agent-x', metric: 'risk_score', mean: 50, stddev: 10, sample_count: 40, created_at: '2026-06-08T00:00:00.000Z' }],
          by_metric: [], by_agent: [],
          auto_tick: { ran: false, last_run_at: '2026-06-10T08:00:00.000Z' },
        }),
      };
    }
    if (u.startsWith('/api/drift/snapshots')) {
      return {
        ok: true,
        json: async () => ({
          snapshots: [
            { agent_id: 'agent-x', metric: 'risk_score', mean: 52, stddev: 9, sample_count: 10, period_start: '2026-06-07T00:00:00.000Z' },
            { agent_id: 'agent-x', metric: 'risk_score', mean: 66, stddev: 9, sample_count: 11, period_start: '2026-06-08T00:00:00.000Z' },
            { agent_id: 'agent-x', metric: 'risk_score', mean: 80, stddev: 8, sample_count: 12, period_start: '2026-06-09T00:00:00.000Z' },
          ],
        }),
      };
    }
    if (u === '/api/drift/metrics') return { ok: true, json: async () => ({ metrics: [{ id: 'risk_score', label: 'Risk Score' }] }) };
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('drift evidence panel', () => {
  it('renders percentiles + distribution + trend from the joined baseline data', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<DriftPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Evidence' }));

    // Percentile table from the stored baseline stats.
    expect(screen.getByText('Baseline percentiles')).toBeTruthy();
    expect(screen.getByText('median')).toBeTruthy();
    expect(screen.getByText('49.50')).toBeTruthy();
    expect(screen.getByText('current mean')).toBeTruthy();

    // The 10-bucket distribution jsonb finally renders.
    expect(screen.getByRole('img', { name: 'Baseline sample distribution' })).toBeTruthy();
    expect(screen.getByText(/40 baseline samples/)).toBeTruthy();

    // Daily mean trend sparkline from drift_snapshots.
    expect(screen.getByText('Daily mean trend')).toBeTruthy();
  });

  it('shows the auto-run provenance line from stats.auto_tick', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<DriftPage />);
    expect(await screen.findByText(/runs automatically/)).toBeTruthy();
  });

  it('renders the z=999 sentinel as "no baseline variance", never as a number', async () => {
    vi.stubGlobal('fetch', mockFetch({ alerts: [SENTINEL_ALERT] }));
    render(<DriftPage />);
    expect(await screen.findByText('no baseline variance')).toBeTruthy();
    expect(screen.queryByText('+999')).toBeNull();
    expect(screen.queryByText('999')).toBeNull();
  });

  it('surfaces a visible admin-required error when a member acks (was a silent no-op)', async () => {
    vi.stubGlobal('fetch', mockFetch({ patchStatus: 403 }));
    render(<DriftPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Acknowledge risk_score alert/ }));
    expect(await screen.findByText(/requires an admin role/)).toBeTruthy();
  });
});
