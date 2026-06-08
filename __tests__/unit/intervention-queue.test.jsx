import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { InterventionQueue } from '@/mission-control/components/InterventionQueue';

const approvals = [
  { id: 'approval:act_1', kind: 'approval', source: 'action', sourceId: 'act_1', status: 'pending_approval', agentId: 'a1', agentName: 'mail-bot', description: 'send email', href: '/approvals', sortKey: -1 },
  { id: 'approval:act_2', kind: 'approval', source: 'action', sourceId: 'act_2', status: 'pending_approval', agentId: 'a2', agentName: 'pay-bot', description: 'refund', href: '/approvals', sortKey: -1 },
];

let posted;
beforeEach(() => {
  posted = [];
  global.fetch = vi.fn((url, opts) => {
    posted.push({ url: String(url), body: opts?.body });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InterventionQueue', () => {
  it('renders the empty state when nothing needs intervention', () => {
    const { container } = render(<InterventionQueue items={[]} onDecision={() => {}} refresh={() => {}} />);
    expect(container.textContent).toContain('No intervention required');
  });

  it('inline Approve calls onDecision with allow', () => {
    const onDecision = vi.fn();
    const { getAllByText } = render(<InterventionQueue items={approvals} onDecision={onDecision} refresh={() => {}} />);
    fireEvent.click(getAllByText('Approve')[0]);
    expect(onDecision).toHaveBeenCalledWith('act_1', 'allow');
  });

  it('select-all + bulk Approve fires one POST per selected approval', async () => {
    const refresh = vi.fn();
    const { getByLabelText, container } = render(<InterventionQueue items={approvals} onDecision={() => {}} refresh={refresh} />);
    fireEvent.click(getByLabelText('Select all approvals'));
    // the bulk bar (in the header) now shows "2 selected" + an Approve action
    await waitFor(() => expect(container.textContent).toContain('2 selected'));
    const region = container.querySelector('[role="region"][aria-label="Bulk actions"]');
    fireEvent.click(within(region).getByText('Approve'));
    await waitFor(() => {
      const allows = posted.filter((p) => p.url.startsWith('/api/approvals/') && p.body?.includes('allow'));
      expect(allows.length).toBe(2);
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
