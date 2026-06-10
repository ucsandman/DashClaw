import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/PageLayout.js', () => ({
  default: ({ title, children, actions }) => (
    <div>
      <div>{title}</div>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Card.js', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Badge.js', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/EmptyState.js', () => ({
  EmptyState: ({ title, description, action }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      <div>{action}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Skeleton.jsx', () => ({
  ListSkeleton: ({ rows }) => <div data-testid="list-skeleton">skeleton:{rows}</div>,
}));

vi.mock('@/components/ui/ProgressBar.js', () => ({
  ProgressBar: ({ value }) => <div data-testid="progress" data-value={value} />,
}));

function okJson(body) {
  return {
    ok: true,
    json: async () => body,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('ReputationPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading skeleton until the leaderboard resolves', async () => {
    const gate = deferred();
    global.fetch = vi.fn(async (url) => {
      if (String(url).startsWith('/api/reputation/leaderboard')) {
        await gate.promise;
        return okJson({ leaderboard: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { default: ReputationPage } = await import('@/reputation/page.jsx');
    render(<ReputationPage />);

    expect(screen.getByTestId('list-skeleton')).toBeTruthy();

    gate.resolve();
    await waitFor(() => {
      expect(screen.queryByTestId('list-skeleton')).toBeNull();
    });
  });

  it('renders ranked rows from the leaderboard fixture with Number-coerced scores', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).startsWith('/api/reputation/leaderboard')) {
        return okJson({
          leaderboard: [
            {
              agent_id: 'agent-top',
              reliability_score: '0.92',
              completion_rate: '0.88',
              confidence: '0.75',
              risk_score: '10',
              total_events: 42,
            },
            {
              agent_id: 'agent-mid',
              reliability_score: '0.5',
              completion_rate: '0.6',
              confidence: '0.4',
              risk_score: '80',
              total_events: 12,
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { default: ReputationPage } = await import('@/reputation/page.jsx');
    render(<ReputationPage />);

    await waitFor(() => {
      expect(screen.queryByTestId('list-skeleton')).toBeNull();
    });

    // Agent links route to /agents/{agent_id}
    const topLink = await screen.findByRole('link', { name: 'agent-top' });
    expect(topLink.getAttribute('href')).toBe('/agents/agent-top');
    expect(screen.getByRole('link', { name: 'agent-mid' }).getAttribute('href')).toBe('/agents/agent-mid');

    // Ranking order: the top agent is row 1 (#1), the mid agent #2
    const rows = screen.getAllByRole('row');
    // rows[0] is the header row
    expect(within(rows[1]).getByText('#1')).toBeTruthy();
    expect(within(rows[1]).getByRole('link', { name: 'agent-top' })).toBeTruthy();
    expect(within(rows[2]).getByText('#2')).toBeTruthy();
    expect(within(rows[2]).getByRole('link', { name: 'agent-mid' })).toBeTruthy();

    // Number coercion of string scores into percentages
    expect(screen.getByText('92%')).toBeTruthy(); // reliability
    expect(screen.getByText('88%')).toBeTruthy(); // completion
    expect(screen.getByText('75%')).toBeTruthy(); // confidence

    // ProgressBar receives a 0..100 numeric (string * 100) value
    const bars = screen.getAllByTestId('progress');
    expect(bars[0].getAttribute('data-value')).toBe('92');

    // total_events rendered (coerced)
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();

    // risk_score is a 0-100 integer (not a 0..1 fraction) — bands from the
    // shared riskThresholds module (40/70)
    expect(within(rows[1]).getByText('Low risk')).toBeTruthy(); // risk_score 10
    expect(within(rows[2]).getByText('High risk')).toBeTruthy(); // risk_score 80
  });

  it('saturated scores render one-decimal (no fake 100%) and the breakdown row expands with the dimension table', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).startsWith('/api/reputation/leaderboard')) {
        return okJson({
          leaderboard: [
            {
              agent_id: 'agent-sat',
              reliability_score: '0.9994', // old display rounded this to "100%"
              completion_rate: null,        // null renders an em dash, not 0%
              confidence: '0.55',
              risk_score: '20',
              total_events: 5003,
              breakdown: {
                formula: 'weighted_blend/v1',
                half_life_days: 90,
                lookback_days: 365,
                normalized_weights: { outcome: 0.64, policy_violation: 0.36 },
                reliability_unrounded: 0.99935,
                violation_penalty: { rate: 0.0006, ceiling_rate: 0.1, penalty: 0.006 },
                dimensions: [
                  { key: 'outcome', event_count: 3, effective_weight: 2.9, raw_rate: 1, prior: { weight: 3, value: 0.7 }, smoothed: 0.9991, blend_score: 0.9991, contribution: 0.6394 },
                  { key: 'policy_violation', event_count: 5000, effective_weight: 4100, raw_rate: 0.0006, prior: { weight: 5, value: 0.05 }, smoothed: 0.0006, blend_score: 0.994, contribution: 0.3578 },
                  { key: 'risk', event_count: 5000, effective_weight: 4100, raw_rate: 20, prior: { weight: 0, value: 0 }, smoothed: 20, blend_score: null, contribution: null },
                ],
                note: 'Risk is tracked separately.',
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { default: ReputationPage } = await import('@/reputation/page.jsx');
    const { container } = render(<ReputationPage />);

    await waitFor(() => {
      expect(screen.queryByTestId('list-skeleton')).toBeNull();
    });

    // 0.9994 floors to 99.9%, never "100%"; null completion is an em dash.
    expect(container.textContent).toContain('99.9%');
    expect(container.textContent).not.toContain('100%');
    expect(container.textContent).toContain('—');

    // Expand the derivation row.
    const toggle = screen.getByRole('button', { name: /reliability derivation for agent-sat/i });
    fireEvent.click(toggle);
    expect(container.textContent).toContain('Completion');
    expect(container.textContent).toContain('Policy violations');
    expect(container.textContent).toContain('5000 ev');
    expect(container.textContent).toContain('unrounded 0.999'); // unrounded blend, 4dp
    expect(container.textContent).toContain('Risk is tracked separately.');
  });

  it('shows the empty state with a recompute action, which populates the leaderboard', async () => {
    let leaderboardCalls = 0;
    global.fetch = vi.fn(async (url, options = {}) => {
      const u = String(url);
      if (u.startsWith('/api/reputation/leaderboard')) {
        leaderboardCalls += 1;
        if (leaderboardCalls === 1) {
          return okJson({ leaderboard: [] });
        }
        return okJson({
          leaderboard: [
            {
              agent_id: 'agent-1',
              reliability_score: '0.7',
              completion_rate: '0.8',
              confidence: '0.6',
              risk_score: '20',
              total_events: 5,
            },
          ],
        });
      }
      if (u === '/api/agents') {
        return okJson({ agents: [{ agent_id: 'agent-1' }] });
      }
      if (u === '/api/reputation/agents/agent-1/recompute') {
        expect(options.method).toBe('POST');
        return okJson({ agent_id: 'agent-1', vector: {}, recomputed_at: 'now' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const { default: ReputationPage } = await import('@/reputation/page.jsx');
    render(<ReputationPage />);

    expect(await screen.findByText('No reputation snapshots yet')).toBeTruthy();

    // Recompute appears in both the header actions and the empty state action.
    const recomputeButtons = screen.getAllByRole('button', { name: /recompute all/i });
    expect(recomputeButtons.length).toBeGreaterThan(0);

    fireEvent.click(recomputeButtons[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/agents');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/reputation/agents/agent-1/recompute',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // After recompute the leaderboard is re-fetched and rows render.
    expect(await screen.findByRole('link', { name: 'agent-1' })).toBeTruthy();
    expect(screen.getByText('70%')).toBeTruthy();
  });
});
