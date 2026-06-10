import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

// /spend must refetch with agent_id whenever the global agent picker changes,
// and surface the filtered state (label suffix + NULL-agent x402 exclusion note).

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
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

// Controllable agent filter: tests flip `current.agentId` and rerender.
const current = { agentId: null };
vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: current.agentId }),
}));

import SpendOverviewPage from '@/spend/page';

const PAYLOAD = {
  lens: 'fleet',
  fleet_total_usd: 12.5,
  agent: { total_cost_usd: 10, by_day: [] },
  x402: { total_spend_usd: 2.5, by_day: [] },
  unpriced: { action_count: 0, total_tokens: 0, models: [] },
};

describe('/spend agent filter wiring', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    current.agentId = null;
  });

  it('refetches tiles + chart data with agent_id on picker change and labels the filtered state', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => PAYLOAD,
    }));

    const { container, rerender } = render(<SpendOverviewPage />);
    await waitFor(() => {
      expect(container.textContent).toContain('$12.50');
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/finops/spend?period=30d', expect.anything());

    // Operator picks an agent in the global header dropdown.
    await act(async () => {
      current.agentId = 'agent-1';
      rerender(<SpendOverviewPage />);
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/finops/spend?period=30d&agent_id=agent-1',
        expect.anything(),
      );
    });

    await waitFor(() => {
      // Filtered state is legible: tile label suffix + exclusion note.
      expect(container.textContent).toContain('agent-1');
      expect(container.textContent).toContain('excluded');
    });
  });

  it('shows the unpriced-models warning banner when actions carry tokens at $0', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...PAYLOAD,
        unpriced: { action_count: 7, total_tokens: 1000, models: [{ model: 'mystery-9000', action_count: 7, total_tokens: 1000 }] },
      }),
    }));

    const { container } = render(<SpendOverviewPage />);
    await waitFor(() => {
      expect(container.textContent).toContain('7 actions in this period reported tokens but carry $0 cost');
    });
    expect(container.textContent).toContain('mystery-9000');
  });
});
