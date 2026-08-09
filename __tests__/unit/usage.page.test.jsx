import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// /usage — read-only metering panel (G4). Pins: summary tiles render the
// rollup numbers, seats and trial cap appear, history rows list past periods,
// and load failure shows the standard error + Retry pattern.

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, subtitle, children }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div>{children}</div>
    </div>
  ),
}));

import UsagePage from '@/usage/page.jsx';

const USAGE = {
  org_id: 'org_demo',
  period: '2026-08',
  governed_actions: 1234,
  blocked_actions: 21,
  seats: { users: 2, active_api_keys: 4 },
  plan: 'free',
  hosted_mode: true,
  trial: { action_cap: 10000, actions_used: 1234 },
  history: [
    { period: '2026-08', governed_actions: 1234, blocked_actions: 21 },
    { period: '2026-07', governed_actions: 480, blocked_actions: 3 },
  ],
  lastUpdated: '2026-08-09T12:00:00.000Z',
};

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => USAGE }));
  global.fetch = fetchMock;
});

describe('/usage page', () => {
  it('renders the current period counters and seats', async () => {
    render(<UsagePage />);
    await waitFor(() => expect(screen.getAllByText('1,234').length).toBeGreaterThan(0));
    expect(screen.getAllByText('21').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Governed actions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Seats/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/API keys/i).length).toBeGreaterThan(0);
  });

  it('shows the trial cap when the org is a capped trial', async () => {
    render(<UsagePage />);
    await waitFor(() => expect(screen.getByText(/10,000/)).toBeTruthy());
  });

  it('lists history rows by period', async () => {
    render(<UsagePage />);
    await waitFor(() => expect(screen.getByText('2026-07')).toBeTruthy());
    expect(screen.getByText('480')).toBeTruthy();
  });

  it('omits the trial line for non-trial orgs', async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...USAGE, trial: null }),
    }));
    render(<UsagePage />);
    await waitFor(() => expect(screen.getAllByText('1,234').length).toBeGreaterThan(0));
    expect(screen.queryByText(/10,000/)).toBeNull();
  });

  it('shows the load error with a Retry control that refetches', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    render(<UsagePage />);
    expect(await screen.findByText(/Failed to load/)).toBeTruthy();
    const retry = screen.getByText('Retry');
    global.fetch = fetchMock;
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getAllByText('1,234').length).toBeGreaterThan(0));
  });
});
