import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Regression coverage for a code review fix on decisions.stream (list-controls
// rollout): handleBulkDeleteSelected built the DELETE request straight off the
// selection with no call-time re-scope against the currently-visible rows —
// the same defensive pattern already used by identities.tsx's
// handleBulkDeleteAgents. This pins the visible behavior: after a client-side
// search narrows the section, a bulk delete must only ever target the rows
// still on screen.

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/components/PageLayout', () => ({
  default: ({ children, actions }) => (
    <div>
      <div data-testid="actions">{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));
vi.mock('@/components/OutcomeBadge', () => ({ OutcomeBadge: () => null }));
vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: null }),
}));
vi.mock('../../app/hooks/useEffectiveRole', () => ({
  useEffectiveRole: () => ({ isAdmin: true }),
}));
vi.mock('../../app/hooks/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../../app/lib/isDemoMode', () => ({ isDemoMode: () => false }));

const A = {
  action_id: 'act_a', agent_id: 'agent-aa', agent_name: null, declared_goal: 'Deploy to prod',
  action_type: 'deploy', risk_score: 80, status: 'completed', timestamp_start: '2026-06-01T00:00:00.000Z',
};
const B = {
  action_id: 'act_b', agent_id: 'agent-bb', agent_name: null, declared_goal: 'Send digest',
  action_type: 'message', risk_score: 20, status: 'completed', timestamp_start: '2026-06-02T00:00:00.000Z',
};

describe('/decisions bulk delete — visibility scoping', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/decisions');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('deletes only the currently visible selected rows after a search narrows the section', async () => {
    const deletes = [];
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      const method = (init && init.method) || 'GET';
      if (method === 'DELETE' && u.startsWith('/api/actions?action_ids=')) {
        deletes.push(u);
        return { ok: true, json: async () => ({ deleted: 1 }) };
      }
      if (u.startsWith('/api/actions?')) {
        return { ok: true, json: async () => ({ actions: [A, B], stats: {}, total: 2 }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: DecisionsPage } = await import('../../app/decisions/page.jsx');
    render(<DecisionsPage />);

    await screen.findByText('Deploy to prod');
    expect(screen.getByText('Send digest')).toBeTruthy();

    const checkboxes = screen.getAllByLabelText('Select decision');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const actionsSlot = screen.getByTestId('actions');
    await waitFor(() => expect(within(actionsSlot).getByText(/Delete 2 selected/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'agent-aa' } });
    await waitFor(() => expect(screen.queryByText('Send digest')).toBeNull());
    await waitFor(() => expect(within(actionsSlot).getByText(/Delete 1 selected/)).toBeTruthy());

    fireEvent.click(within(actionsSlot).getByText(/Delete 1 selected/));

    await waitFor(() => expect(deletes.length).toBe(1));
    expect(deletes[0]).toContain('act_a');
    expect(deletes[0]).not.toContain('act_b');
  });
});
