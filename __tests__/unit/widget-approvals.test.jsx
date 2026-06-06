import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { WidgetApprovals } from '@/widget/components/WidgetApprovals';

afterEach(cleanup);

const sample = [
  {
    actionId: 'p1',
    agentName: 'support-bot',
    actionType: 'email_send',
    summary: 'Send refund confirmation',
    status: 'pending_approval',
    riskScore: 80,
    outcomeStatus: null,
    ts: null,
  },
];

describe('WidgetApprovals', () => {
  it('renders nothing when there are no approvals', () => {
    const { container } = render(
      <WidgetApprovals approvals={[]} canDecide processingId={null} onDecide={() => {}} />,
    );
    expect(container.querySelector('section')).toBeNull();
  });

  it('renders rows and fires onDecide for Approve and Deny', () => {
    const onDecide = vi.fn();
    const { getByLabelText, container } = render(
      <WidgetApprovals approvals={sample} canDecide processingId={null} onDecide={onDecide} />,
    );
    expect(container.textContent).toContain('Send refund confirmation');
    fireEvent.click(getByLabelText(/^Approve:/));
    expect(onDecide).toHaveBeenCalledWith('p1', 'allow');
    fireEvent.click(getByLabelText(/^Deny:/));
    expect(onDecide).toHaveBeenCalledWith('p1', 'deny');
  });

  it('disables the buttons and shows an admin hint when the user cannot decide', () => {
    const { getByLabelText, container } = render(
      <WidgetApprovals approvals={sample} canDecide={false} processingId={null} onDecide={() => {}} />,
    );
    expect(getByLabelText(/^Approve:/).disabled).toBe(true);
    expect(container.textContent.toLowerCase()).toContain('admin');
  });

  it('disables the row while it is processing', () => {
    const { getByLabelText } = render(
      <WidgetApprovals approvals={sample} canDecide processingId="p1" onDecide={() => {}} />,
    );
    expect(getByLabelText(/^Approve:/).disabled).toBe(true);
    expect(getByLabelText(/^Deny:/).disabled).toBe(true);
  });
});
