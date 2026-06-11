import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Attribution-coverage warning on /spend.
// The warning fires when data.agent.attribution.coverage_pct < 90,
// lists the lowest-coverage agents, and is absent when coverage is 100%.

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }: any) => (
    <div>
      <h1>{title}</h1>
      {actions}
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock('next/dynamic', () => ({
  default: () => function ChartStub() {
    return <div data-testid="chart" />;
  },
}));

vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: null }),
}));

import SpendOverviewPage from '@/spend/page';

const LOW_COVERAGE_PAYLOAD = {
  fleet_total_usd: 1,
  x402: { total_spend_usd: 0 },
  unpriced: { action_count: 0, models: [] },
  agent: {
    total_cost_usd: 1,
    attribution: { attributed_count: 10, total_count: 100, coverage_pct: 10 },
    by_agent: [
      { agent_id: 'openclaw-main', cost_usd: 0, action_count: 80, attributed_count: 0, coverage_pct: 0 },
      { agent_id: 'cc-1', cost_usd: 1, action_count: 20, attributed_count: 10, coverage_pct: 50 },
    ],
    by_day: [],
  },
};

const HIGH_COVERAGE_PAYLOAD = {
  fleet_total_usd: 1,
  x402: { total_spend_usd: 0 },
  unpriced: { action_count: 0, models: [] },
  agent: {
    total_cost_usd: 1,
    attribution: { attributed_count: 5, total_count: 5, coverage_pct: 100 },
    by_agent: [
      { agent_id: 'openclaw-main', cost_usd: 0, action_count: 5, attributed_count: 5, coverage_pct: 100 },
      { agent_id: 'cc-1', cost_usd: 1, action_count: 5, attributed_count: 5, coverage_pct: 100 },
    ],
    by_day: [],
  },
};

describe('/spend attribution coverage warning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the coverage warning and worst agent when coverage is low', async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).startsWith('/api/finops/spend')) {
        return { ok: true, status: 200, json: async () => LOW_COVERAGE_PAYLOAD } as any;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any;

    const { container } = render(<SpendOverviewPage />);

    await waitFor(() => {
      expect(container.textContent).toContain('Token attribution coverage is 10%');
    });
    expect(container.textContent).toContain('openclaw-main');
  });

  it('does not render the coverage warning when coverage is 100%', async () => {
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).startsWith('/api/finops/spend')) {
        return { ok: true, status: 200, json: async () => HIGH_COVERAGE_PAYLOAD } as any;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as any;

    const { container } = render(<SpendOverviewPage />);

    await waitFor(() => {
      // Wait for the page to finish loading by checking for a known rendered value.
      expect(container.textContent).toContain('$1.00');
    });
    expect(container.textContent).not.toContain('Token attribution coverage is');
  });
});
