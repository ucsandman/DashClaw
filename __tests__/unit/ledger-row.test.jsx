import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { LedgerRow } from '@/mission-control/components/LedgerRow';

afterEach(cleanup);

const failure = {
  id: 'f1', category: 'failure', severity: 'high', title: 'Failed: deploy', detail: 'exit 1',
  source: 'action', source_id: 'act_9', agent_id: 'deploy-bot', timestamp: null, action_url: '/decisions/act_9',
  suggested_action: 'investigate',
};
const approval = {
  id: 'a1', category: 'approval', severity: 'medium', title: 'Awaiting approval', detail: '',
  source: 'action', source_id: 'act_1', agent_id: 'mail-bot', timestamp: null, action_url: '/decisions/act_1',
  suggested_action: 'approve',
};

describe('LedgerRow', () => {
  it('renders severity as a word (AA, never color-alone) + tokenized category pill', () => {
    const { container } = render(<LedgerRow item={failure} />);
    expect(container.textContent).toContain('High');
    expect(container.textContent).toContain('Failure');
    expect(container.textContent).toContain('Failed: deploy');
  });

  it('emits data-entity-* for the context menu (keyed by source)', () => {
    const { container } = render(<LedgerRow item={failure} />);
    const row = container.querySelector('[data-entity-type]');
    expect(row?.getAttribute('data-entity-type')).toBe('action');
    expect(row?.getAttribute('data-entity-id')).toBe('act_9');
  });

  it('marks approval rows with pending_approval status so the context menu offers approve/deny', () => {
    const { container } = render(<LedgerRow item={approval} onApprove={() => {}} onDeny={() => {}} />);
    const row = container.querySelector('[data-entity-type]');
    expect(row?.getAttribute('data-entity-status')).toBe('pending_approval');
  });

  it('wires inline Approve/Deny on approval rows', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const { getByText } = render(<LedgerRow item={approval} onApprove={onApprove} onDeny={onDeny} />);
    fireEvent.click(getByText('Approve'));
    expect(onApprove).toHaveBeenCalledWith('act_1');
    fireEvent.click(getByText('Deny'));
    expect(onDeny).toHaveBeenCalledWith('act_1');
  });

  it('uses no raw palette-escape classes', () => {
    const { container } = render(<LedgerRow item={approval} onApprove={() => {}} onDeny={() => {}} />);
    expect(container.innerHTML).not.toMatch(/purple-400|emerald-400|blue-400|amber-400|zinc-[0-9]/);
  });
});
