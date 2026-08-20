import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// The Calibration section of /policies (was the standalone /calibration page).
// Pins: the plain-language label layer (no Greek theta anywhere), the honest
// "learns from verdicts" state sentence with its live/retrospective split, the
// one-click relief switch, and the eligibility gate on "Fewer and more".

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import CalibrationSection from '@/policies/components/CalibrationSection';

const baseSnapshot = (over = {}) => ({
  settings: { mode: 'shadow', target_rate: 0.1 },
  state: {
    theta: 62.5,
    labeled_total: 3,
    labeled_live: 1,
    labeled_benign: 3,
    labeled_denied: 0,
    loss_sum: 1,
    observed_rate: 0.33,
    observed_window_rate: 0.08,
    observed_window: 3,
    relief_ceiling: 55,
    relief_ready: false,
    active_eligible: false,
    ...(over.state ?? {}),
  },
  defaults: {
    gamma: 2, alarm_at: 20, p0: 0.25, theta_floor: 20,
    relief_min_labels: 10, relief_min_live_labels: 3,
  },
  alarms: [
    { agent_id: 'agent_bad', e: 25.1, n: 12, denied: 9, alarmed_at: '2026-08-06T00:00:00.000Z' },
    { agent_id: 'agent_ok', e: 1.4, n: 8, denied: 2, alarmed_at: null },
  ],
  events: [
    { action_id: 'a1', agent_id: 'agent_bad', risk_score: 85, theta_before: 62, theta_after: 62.5, label: 'benign', loss: 1, source: 'approval', created_at: '2026-08-06T00:00:00.000Z' },
    { action_id: 'a2', agent_id: 'agent_ok', risk_score: 90, theta_before: 62.5, theta_after: 62.3, label: 'dangerous', loss: 0, source: 'warn_review', created_at: '2026-08-06T00:01:00.000Z' },
  ],
  risk_threshold_policies: [{ id: 'gp_1', name: 'High risk gate', threshold: 100, action: 'block' }],
  ...over,
});

let fetchMock;

function mountWith(snapshot) {
  fetchMock = vi.fn(async (url, opts) => ({
    ok: true,
    status: 200,
    json: async () => (opts?.method === 'POST' ? { success: true, changes: {} } : snapshot),
  }));
  global.fetch = fetchMock;
  return render(<CalibrationSection />);
}

const postCalls = () => fetchMock.mock.calls.filter(([, opts]) => opts?.method === 'POST');

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom always has it; be safe */ }
});

const openSettings = async () => {
  const toggle = await screen.findByText('Controller settings');
  fireEvent.click(toggle);
};

describe('CalibrationSection', () => {
  it('uses plain-language labels and never prints the Greek theta', async () => {
    const { container } = mountWith(baseSnapshot());
    await waitFor(() => expect(screen.getByText('Pausing above risk')).toBeTruthy());
    expect(screen.getByText(/False interruptions/)).toBeTruthy();
    expect(screen.getByText('62.5')).toBeTruthy();
    await openSettings();
    expect(container.textContent).not.toContain('θ');
    expect(container.textContent).not.toContain('Shadow');
    expect(container.textContent).not.toContain('Adjudication');
    expect(screen.getAllByText('Preview').length).toBeGreaterThan(0);
    expect(screen.getByText('Fewer interruptions')).toBeTruthy();
  });

  it('states the verdict count honestly, split live vs retrospective', async () => {
    mountWith(baseSnapshot());
    const sentence = await screen.findByTestId('calibration-state-sentence');
    expect(sentence.textContent).toContain('Calibration learns from verdicts, not from traffic.');
    expect(sentence.textContent).toContain('You have given 3 (1 from real approvals, 2 from the warn rows above).');
    expect(sentence.textContent).toContain('Automatic tuning needs 10 verdicts, 3 of them real approve/deny calls, before it can act.');
    expect(sentence.textContent).toContain('Preview mode is on');
    const link = screen.getByText('Review the warn groups above');
    expect(link.getAttribute('href')).toBe('#needs-your-call');
  });

  it('switches relief on with one click once it is ready', async () => {
    mountWith(baseSnapshot({
      state: { theta: 62.5, labeled_total: 14, labeled_live: 4, relief_ceiling: 71, relief_ready: true, active_eligible: false, observed_window_rate: 0.06, labeled_benign: 14, labeled_denied: 0, loss_sum: 1, observed_rate: 0.07, observed_window: 14 },
    }));
    const btn = await screen.findByText('Switch on fewer interruptions');
    expect(screen.getByTestId('calibration-state-sentence').textContent)
      .toContain('Ready. It would stop asking below risk 62.5 and never go past 71, the riskiest action you approved.');
    fireEvent.click(btn);
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ mode: 'relief' });
  });

  it('shows what relief is doing, and where to see it, when it is on', async () => {
    mountWith(baseSnapshot({
      settings: { mode: 'relief', target_rate: 0.1 },
      state: { theta: 78, labeled_total: 14, labeled_live: 4, relief_ceiling: 82, relief_ready: true, active_eligible: false, observed_window_rate: 0.06, labeled_benign: 14, labeled_denied: 0, loss_sum: 1, observed_rate: 0.07, observed_window: 14 },
    }));
    const sentence = await screen.findByTestId('calibration-state-sentence');
    expect(sentence.textContent).toContain('You have given 14 verdicts: 4 from real approvals, 10 from the warn rows above.');
    expect(sentence.textContent).toContain('It stops asking below risk 78, and it can never touch a Short List line, a block, or reach allow.');
    expect(screen.getByText(/See what it skipped/).getAttribute('href')).toBe('/decisions?decision=warn');
    expect(screen.getByText(/Fewer interruptions — 78/)).toBeTruthy();
  });

  it('disables "Fewer and more" until the controller reports it eligible', async () => {
    mountWith(baseSnapshot());
    await openSettings();
    const btn = await screen.findByText('Fewer and more');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(postCalls().length).toBe(0);
    expect(screen.getByText(/holds under target for 7 straight days/)).toBeTruthy();
  });

  it('still requires a second confirming click for "Fewer and more" when eligible', async () => {
    mountWith(baseSnapshot({
      state: { theta: 62.5, labeled_total: 14, labeled_live: 4, relief_ceiling: 71, relief_ready: true, active_eligible: true, observed_window_rate: 0.06, labeled_benign: 14, labeled_denied: 0, loss_sum: 1, observed_rate: 0.07, observed_window: 14 },
    }));
    await openSettings();
    const btn = await screen.findByText('Fewer and more');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(postCalls().length).toBe(0);
    fireEvent.click(await screen.findByText('Confirm fewer and more?'));
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ mode: 'active' });
  });

  it('saves the acceptable false-interruption rate and rejects out-of-range input', async () => {
    mountWith(baseSnapshot());
    await openSettings();
    const input = await screen.findByLabelText(/Acceptable false interruptions/i);
    fireEvent.change(input, { target: { value: '75' } });
    fireEvent.click(screen.getByText('Save'));
    expect(postCalls().length).toBe(0);
    expect(await screen.findByText(/between 1% and 50%/)).toBeTruthy();

    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ target_rate: 0.05 });
  });

  it('names the verdict table in plain language, with its source column', async () => {
    mountWith(baseSnapshot());
    await openSettings();
    expect(await screen.findByText('What your verdicts taught it')).toBeTruthy();
    expect(screen.getAllByText('approved — we should not have asked').length).toBe(1);
    expect(screen.getByText('Approval')).toBeTruthy();
    expect(screen.getByText('Warn review')).toBeTruthy();
    expect(screen.getByText('Forget everything it learned')).toBeTruthy();
  });

  it('resets an agent flagged as denied far more than chance explains', async () => {
    mountWith(baseSnapshot());
    await openSettings();
    expect(await screen.findByText('Agents denied far more than chance explains')).toBeTruthy();
    fireEvent.click(screen.getByText('Reset'));
    await waitFor(() => expect(postCalls().length).toBe(1));
    expect(JSON.parse(postCalls()[0][1].body)).toEqual({ reset_agent_alarm: 'agent_bad' });
  });

  it('shows the near-alarm chip line above the fold', async () => {
    mountWith(baseSnapshot({ alarms: [{ agent_id: 'agent_ok', e: 1.4, n: 8, denied: 2, alarmed_at: null }] }));
    expect(await screen.findByText('No agents flagged.')).toBeTruthy();
    expect(screen.getByText(/1 near the line/)).toBeTruthy();
  });

  it('shows the load error with a Retry control', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    render(<CalibrationSection />);
    expect(await screen.findByText(/Failed to load/)).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('reports every change to its parent so the page can refresh', async () => {
    const onChanged = vi.fn();
    fetchMock = vi.fn(async (url, opts) => ({
      ok: true,
      status: 200,
      json: async () => (opts?.method === 'POST' ? { success: true, changes: {} } : baseSnapshot({
        state: { theta: 62.5, labeled_total: 14, labeled_live: 4, relief_ceiling: 71, relief_ready: true, active_eligible: false, observed_window_rate: 0.06, labeled_benign: 14, labeled_denied: 0, loss_sum: 1, observed_rate: 0.07, observed_window: 14 },
      })),
    }));
    global.fetch = fetchMock;
    render(<CalibrationSection onChanged={onChanged} />);
    fireEvent.click(await screen.findByText('Switch on fewer interruptions'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
