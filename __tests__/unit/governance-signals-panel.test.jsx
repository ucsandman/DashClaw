import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { signalDismissKey } from '@/lib/signal-hash';

// GovernanceSignalsPanel: the landing surface for the SystemStatusBar
// "N Critical" / "N Elevated" quick links. Dismissals are server-side
// (signal_dismissals via computeSignals) — the invariant under test: the
// panel renders exactly what /api/signals returns (no client-side
// subtraction) and dismiss clicks POST the occurrence key back.

vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: null }),
}));

import GovernanceSignalsPanel from '../../app/components/GovernanceSignalsPanel';

const SIGNALS = [
  {
    type: 'repeated_failures', severity: 'red',
    label: 'Decision reliability degraded: agent-a (7 failures in 24h)',
    agent_id: 'agent-a', detected_at: '2026-08-09T10:00:00Z',
  },
  {
    type: 'high_impact_low_oversight', severity: 'red',
    label: 'Ungoverned high-risk decision: wipe prod',
    agent_id: 'agent-b', action_id: 'act_123', detected_at: '2026-08-09T11:00:00Z',
  },
  {
    type: 'autonomy_spike', severity: 'amber',
    label: 'Governance alert: agent-c (40 ungoverned decisions/hr)',
    agent_id: 'agent-c', detected_at: '2026-08-09T12:00:00Z',
  },
];

function stubSignalsFetch(signals = SIGNALS) {
  return vi.fn(async (_url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST') {
      return { ok: true, status: 200, json: async () => ({ dismissed: 1 }) };
    }
    return { ok: true, status: 200, json: async () => ({ signals }) };
  });
}

describe('GovernanceSignalsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = stubSignalsFetch();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders every active signal with tier counts in the chips', async () => {
    render(<GovernanceSignalsPanel initialSeverity={null} />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(3));
    const chips = screen.getByTestId('signal-severity-chips');
    expect(chips.textContent).toContain('All 3');
    expect(chips.textContent).toContain('Critical 2');
    expect(chips.textContent).toContain('Elevated 1');
  });

  it('?severity deep link (initialSeverity) shows only that tier', async () => {
    render(<GovernanceSignalsPanel initialSeverity="red" />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(2));
    expect(screen.queryByText(/autonomy_spike/)).toBeNull();
  });

  it('renders the server list as-is — no client-side dismissed subtraction', async () => {
    // Dismissals moved server-side; a stale localStorage set must NOT hide rows.
    localStorage.setItem(
      'dashclaw_dismissed_signals',
      JSON.stringify([signalDismissKey(SIGNALS[0])]),
    );
    render(<GovernanceSignalsPanel initialSeverity="red" />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(2));
  });

  it('dismiss removes the row and POSTs the occurrence key to /api/signals', async () => {
    render(<GovernanceSignalsPanel initialSeverity="red" />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(2));
    fireEvent.click(screen.getAllByLabelText('Dismiss signal')[0]);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(1));
    const post = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST');
    expect(post).toBeTruthy();
    expect(post[0]).toBe('/api/signals');
    const body = JSON.parse(post[1].body);
    expect(body.dismiss_keys).toHaveLength(1);
    expect(body.dismiss_keys[0]).toBe(signalDismissKey(SIGNALS[0]));
  });

  it('links a signal with an action_id to its decision record', async () => {
    render(<GovernanceSignalsPanel initialSeverity={null} />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(3));
    const link = screen.getByText('View the related decision →');
    expect(link.getAttribute('href')).toBe('/decisions/act_123');
  });

  it('tier chips re-filter without refetching', async () => {
    render(<GovernanceSignalsPanel initialSeverity={null} />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(3));
    const callsBefore = global.fetch.mock.calls.length;
    fireEvent.click(screen.getByText(/Elevated 1/));
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(1));
    expect(global.fetch.mock.calls.length).toBe(callsBefore);
  });
});
