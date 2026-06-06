import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { WidgetLog } from '@/widget/components/WidgetLog';

afterEach(cleanup);

const sample = [
  {
    actionId: 'a1',
    agentName: 'support-bot',
    actionType: 'email_send',
    summary: 'Awaiting approval to email the refund confirmation',
    status: 'pending_approval',
    riskScore: 55,
    outcomeStatus: null,
    ts: null,
  },
  {
    actionId: 'a2',
    agentName: 'data-agent',
    actionType: 'db_query',
    summary: 'Read 1200 rows from analytics',
    status: 'completed',
    riskScore: 8,
    outcomeStatus: 'completed',
    ts: null,
  },
  {
    actionId: 'a3',
    agentName: 'deploy-agent',
    actionType: 'shell_exec',
    summary: 'Write outside the authorized scope',
    status: 'failed',
    riskScore: 80,
    outcomeStatus: null,
    ts: null,
  },
];

describe('WidgetLog', () => {
  it('renders a loading skeleton', () => {
    const { container } = render(<WidgetLog actions={[]} loading />);
    expect(container.querySelector('[aria-label="Loading recent activity"]')).toBeTruthy();
  });

  it('renders an empty state that teaches the surface', () => {
    const { container } = render(<WidgetLog actions={[]} />);
    expect(container.textContent.toLowerCase()).toContain('no recent activity');
    expect(container.textContent.toLowerCase()).toContain('will appear here');
  });

  it('renders an error state', () => {
    const { container } = render(<WidgetLog actions={[]} error="Failed to load activity" />);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).toContain('Failed to load activity');
  });

  it('renders rows with summaries and status words (never color-only)', () => {
    const { container } = render(<WidgetLog actions={sample} />);
    const text = container.textContent.toLowerCase();
    expect(container.textContent).toContain('Read 1200 rows from analytics');
    expect(text).toContain('awaiting approval');
    expect(text).toContain('failed');
  });

  it('highlights attention rows (approval / failed / blocked / high-risk)', () => {
    const { container } = render(<WidgetLog actions={sample} />);
    const highlighted = [...container.querySelectorAll('li')].filter((li) =>
      li.className.includes('bg-white/[0.02]'),
    );
    // pending_approval + failed => 2 highlighted; completed/low-risk not highlighted
    expect(highlighted.length).toBe(2);
  });

  it('truncates long summaries cleanly via the truncate class', () => {
    const { container } = render(<WidgetLog actions={sample} />);
    const summarySpans = [...container.querySelectorAll('li span.truncate')];
    expect(summarySpans.length).toBeGreaterThan(0);
  });
});
