import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Regression coverage for a code review fix on the approvals.pending section
// (list-controls rollout): the ListControlsBar's mount condition was gated on
// the post-filter row count (`pendingControls.rows.length > 0`) instead of
// the raw list, so a search term matching zero rows unmounted the bar WITH
// the search input still holding the orphaned term — a dead end with no way
// to clear it. The bulk Approve/Deny handlers had the same class of bug as
// the destructive bulk-delete finding on /decisions: no call-time re-scope
// against the currently-visible rows before firing requests.

vi.mock('@/components/PageLayout', () => ({
  default: ({ children, actions }) => (
    <div>
      <div data-testid="actions">{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('@/lib/AgentFilterContext', () => ({ useAgentFilter: () => ({ agentId: null }) }));
vi.mock('@/components/ApprovalFloodBanner', () => ({ default: () => null }));

const NOW = '2026-06-01T00:00:00.000Z';
const A = {
  action_id: 'act_a', agent_id: 'agent-aa', agent_name: null, declared_goal: 'Deploy to prod',
  action_type: 'deploy', risk_score: 80, status: 'pending_approval', timestamp_start: NOW, systems_touched: '[]',
};
const B = {
  action_id: 'act_b', agent_id: 'agent-bb', agent_name: null, declared_goal: 'Send the digest',
  action_type: 'message', risk_score: 20, status: 'pending_approval', timestamp_start: NOW, systems_touched: '[]',
};

function makeFetch({ onApproval } = {}) {
  return vi.fn(async (url, init) => {
    const u = String(url);
    if (u.includes('status=pending_approval')) return { ok: true, json: async () => ({ actions: [A, B] }) };
    if (u.includes('status=expired')) return { ok: true, json: async () => ({ actions: [] }) };
    if (u === '/api/session/effective') {
      return { ok: true, json: async () => ({ authenticated: true, authType: 'local', role: 'admin', isAdmin: true }) };
    }
    if (u.startsWith('/api/approvals/')) {
      onApproval?.(u);
      return { ok: true, json: async () => ({ success: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('/approvals pending section — list-controls visibility fixes', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the search box mounted (and clearable) when the term matches zero rows', async () => {
    global.fetch = makeFetch();
    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    await screen.findByText('Deploy to prod');

    const search = screen.getByLabelText('Search');
    fireEvent.change(search, { target: { value: 'no-such-agent-zzz' } });

    await waitFor(() => expect(screen.queryByText('Deploy to prod')).toBeNull());
    // Previously the bar (and this input, still holding the term) unmounted
    // here because the gate used the post-filter row count.
    expect(screen.getByLabelText('Search').value).toBe('no-such-agent-zzz');

    fireEvent.click(screen.getByLabelText('Clear all filters'));
    await waitFor(() => expect(screen.getByText('Deploy to prod')).toBeTruthy());
  });

  it('bulk Approve only submits the currently-visible selected row after a search narrows the list', async () => {
    const approved = [];
    global.fetch = makeFetch({ onApproval: (u) => approved.push(u) });
    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    await screen.findByText('Deploy to prod');
    expect(screen.getByText('Send the digest')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Select all'));
    const actionsSlot = screen.getByTestId('actions');
    await waitFor(() => expect(within(actionsSlot).getByText('2 selected')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'agent-aa' } });
    await waitFor(() => expect(screen.queryByText('Send the digest')).toBeNull());
    await waitFor(() => expect(within(actionsSlot).getByText('1 selected')).toBeTruthy());

    fireEvent.click(within(actionsSlot).getByText('Approve'));

    await waitFor(() => expect(approved.length).toBe(1));
    expect(approved[0]).toBe('/api/approvals/act_a');
  });
});
