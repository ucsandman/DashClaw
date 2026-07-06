import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// /calibration — operator surface for the calibrated interruption controller.
// Pins: snapshot rendering, the two-step active confirm, target-rate save,
// alarm reset, and the loosening pointer to /policies (human rails).

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

import CalibrationPage from '@/calibration/page.jsx';

const SNAPSHOT = {
  settings: { mode: 'shadow', target_rate: 0.1 },
  state: {
    theta: 62.5,
    labeled_total: 40,
    labeled_benign: 30,
    labeled_denied: 10,
    loss_sum: 4,
    observed_rate: 0.1,
    observed_window_rate: 0.08,
    observed_window: 40,
  },
  defaults: { gamma: 2, alarm_at: 20, p0: 0.25, theta_floor: 20 },
  alarms: [
    { agent_id: 'agent_bad', e: 25.1, n: 12, denied: 9, alarmed_at: '2026-07-06T00:00:00.000Z' },
    { agent_id: 'agent_ok', e: 1.4, n: 8, denied: 2, alarmed_at: null },
  ],
  events: [
    { action_id: 'a1', agent_id: 'agent_bad', risk_score: 85, theta_before: 62, theta_after: 62.5, label: 'benign', loss: 1, created_at: '2026-07-06T00:00:00.000Z' },
    { action_id: 'a2', agent_id: 'agent_ok', risk_score: 90, theta_before: 62.5, theta_after: 62.3, label: 'dangerous', loss: 0, created_at: '2026-07-06T00:01:00.000Z' },
  ],
  risk_threshold_policies: [{ id: 'gp_1', name: 'High risk gate', threshold: 80, action: 'require_approval' }],
};

let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn(async (url, opts) => ({
    ok: true,
    status: 200,
    json: async () => (opts?.method === 'POST' ? { success: true, changes: {} } : SNAPSHOT),
  }));
  global.fetch = fetchMock;
});

const postCalls = () => fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST');

describe('/calibration page', () => {
  it('renders the controller snapshot: θ, observed vs target, alarms, adjudications', async () => {
    render(<CalibrationPage />);
    await waitFor(() => expect(screen.getByText('62.5')).toBeTruthy());
    expect(screen.getByText(/8\.0%/)).toBeTruthy(); // observed window rate
    expect(screen.getByText(/target 10%/)).toBeTruthy();
    expect(screen.getAllByText('agent_bad').length).toBeGreaterThan(0);
    expect(screen.getByText(/escalating/)).toBeTruthy();
    expect(screen.getAllByText(/approved · false interruption/).length).toBeGreaterThan(0);
  });

  it('activating requires a second confirming click, then POSTs mode=active', async () => {
    render(<CalibrationPage />);
    await waitFor(() => expect(screen.getByText('Active')).toBeTruthy());
    fireEvent.click(screen.getByText('Active'));
    expect(postCalls().length).toBe(0);
    const confirm = await screen.findByText('Confirm activate?');
    fireEvent.click(confirm);
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ mode: 'active' });
  });

  it('saves the target rate as a decimal and rejects out-of-range input', async () => {
    render(<CalibrationPage />);
    await waitFor(() => expect(screen.getByLabelText(/Target false-interruption rate/i)).toBeTruthy());
    const input = screen.getByLabelText(/Target false-interruption rate/i);
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.click(screen.getByText('Save'));
    expect(postCalls().length).toBe(0);
    expect(await screen.findByText(/between 1% and 50%/)).toBeTruthy();

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ target_rate: 0.05 });
  });

  it('resets a standing agent alarm by click', async () => {
    render(<CalibrationPage />);
    const reset = await screen.findByText('Reset alarm');
    fireEvent.click(reset);
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ reset_agent_alarm: 'agent_bad' });
  });

  it('shows the load error with a Retry control', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    render(<CalibrationPage />);
    expect(await screen.findByText(/Failed to load/)).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
