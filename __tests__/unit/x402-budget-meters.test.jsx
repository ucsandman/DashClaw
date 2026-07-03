import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

// Render coverage for the /spend/x402 budget meters (roadmap v2.6c): the
// section is invisible without budget-bearing policies, org meters show
// "$X of $Y" with the gate's tone tiers, agent meters render per family,
// and failed loads use the error + Retry pattern.

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import X402BudgetMeters from '@/spend/components/X402BudgetMeters';

const ORG_ENTRY = {
  policy_id: 'pol_org', policy_name: 'Paid capability spend', agent_ids: [],
  budget_usd: 25, budget_approval_threshold: 20, budget_window_days: 30,
  budget_scope: 'org', window_start: '2026-06-03T00:00:00.000Z', window_spend_usd: 21.4,
};
const AGENT_ENTRY = {
  policy_id: 'pol_agent', policy_name: 'Per-agent budget', agent_ids: [],
  budget_usd: 10, budget_approval_threshold: null, budget_window_days: 7,
  budget_scope: 'agent', window_start: '2026-06-26T00:00:00.000Z',
  families: [
    { agent_id: 'clawdbot', window_spend_usd: 9.5 },
    { agent_id: 'deploy-runner', window_spend_usd: 1 },
  ],
};

const okFetch = (budgets) => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ budgets }) }));

describe('X402BudgetMeters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when no budget-bearing policies exist', async () => {
    global.fetch = okFetch([]);
    const { container } = render(<X402BudgetMeters />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('org meter shows spend of budget with the warning tone at/over the approval threshold', async () => {
    global.fetch = okFetch([ORG_ENTRY]);
    const { container } = render(<X402BudgetMeters />);
    await waitFor(() => expect(container.textContent).toContain('Paid capability spend'));
    expect(container.textContent).toContain('$21.40');
    expect(container.textContent).toContain('of $25.00');
    expect(container.textContent).toContain('30d · org');
    expect(container.textContent).toContain('Approval from $20.00 · blocks over $25.00');
    // 21.4 >= approval 20 → warning tone on the number and the bar fill
    const spendLine = Array.from(container.querySelectorAll('span')).find((s) => s.textContent.startsWith('$21.40'));
    expect(spendLine.className).toContain('text-warning');
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).toBeTruthy();
    expect(bar.querySelector('.bg-status-warning')).toBeTruthy();
  });

  it('agent meter renders one bar per identity family with entity links; 80%-of-budget warning when no approval tier', async () => {
    global.fetch = okFetch([AGENT_ENTRY]);
    const { container } = render(<X402BudgetMeters />);
    await waitFor(() => expect(container.textContent).toContain('Per-agent budget'));
    expect(container.textContent).toContain('7d · per agent');
    expect(container.querySelector('a[data-entity-id="clawdbot"]')).toBeTruthy();
    expect(container.querySelector('a[data-entity-id="deploy-runner"]')).toBeTruthy();
    const bars = container.querySelectorAll('[role="progressbar"]');
    expect(bars.length).toBe(2);
    // clawdbot at $9.50 of $10 (≥80%, no approval tier) → warning; deploy-runner stays neutral
    expect(bars[0].querySelector('.bg-status-warning')).toBeTruthy();
    expect(bars[1].querySelector('.bg-status-warning')).toBeFalsy();
  });

  it('passes the agent filter through to the API query', async () => {
    global.fetch = okFetch([]);
    render(<X402BudgetMeters agentId="claude-code:explore" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(String(global.fetch.mock.calls[0][0])).toContain('agent_id=claude-code%3Aexplore');
  });

  it('failed load shows the error + Retry pattern and recovers', async () => {
    let calls = 0;
    global.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ budgets: [ORG_ENTRY] }) };
    });
    const { container } = render(<X402BudgetMeters />);
    await waitFor(() => expect(container.textContent).toContain('Failed to load budget consumption.'));
    const retry = Array.from(container.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Retry');
    fireEvent.click(retry);
    await waitFor(() => expect(container.textContent).toContain('Paid capability spend'));
  });
});
