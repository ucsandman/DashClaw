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

  // Governance-scope visibility (adversarial review 2026-08-11). The whole
  // point of the signal is that a human SEES it, so pin the group header on the
  // TYPE_LABELS entry — without it the panel falls back to the raw type string
  // and the operator reads "ungoverned scope" with no idea what to do.
  it('renders a narrowed-scope signal with a human group label and its remedy', async () => {
    global.fetch = stubSignalsFetch([
      {
        type: 'ungoverned_scope',
        severity: 'red',
        label: 'Governance scope narrowed: claude-code',
        detail: 'This agent is not governing shell commands, file reads and writes.',
        help: 'Remove DASHCLAW_GOVERNED_CATEGORIES from this agent\'s hook env to restore the default scope, or set it to "all".',
        agent_id: 'claude-code',
        detected_at: '2026-08-11T10:00:00Z',
      },
    ]);

    render(<GovernanceSignalsPanel initialSeverity={null} />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(1));

    expect(screen.getByText('Governance scope narrowed')).toBeTruthy();
    expect(screen.getByText(/not governing shell commands/)).toBeTruthy();
    expect(screen.getByText(/DASHCLAW_GOVERNED_CATEGORIES/)).toBeTruthy();
    // It counts as Critical, not Elevated.
    expect(screen.getByTestId('signal-severity-chips').textContent).toContain('Critical 1');
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

  it('groups signals by type; a big group starts collapsed as one line', async () => {
    const flood = Array.from({ length: 6 }, (_, i) => ({
      type: 'stale_assumption', severity: 'red',
      label: `Unverified decision basis (35d): assumption ${i}`,
      assumption_id: `asm_${i}`, detected_at: `2026-08-0${(i % 5) + 1}T10:00:00Z`,
    }));
    global.fetch = stubSignalsFetch([...SIGNALS, ...flood]);
    render(<GovernanceSignalsPanel initialSeverity={null} />);
    await waitFor(() => expect(screen.getAllByTestId('signal-group')).toHaveLength(4));
    // The 6-signal group is collapsed: its rows are not in the DOM, only the 3
    // singleton groups' rows are.
    expect(screen.getAllByTestId('signal-row')).toHaveLength(3);
    // Expanding it reveals the rows.
    fireEvent.click(screen.getByLabelText('Toggle Unverified assumptions signals'));
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(9));
  });

  it('group Dismiss all POSTs every occurrence key in the group', async () => {
    const flood = Array.from({ length: 4 }, (_, i) => ({
      type: 'session_stalled', severity: 'red',
      label: `Session stalled (10h): agent-${i}`,
      session_id: `sess_${i}`, detected_at: `2026-08-09T0${i}:00:00Z`,
    }));
    global.fetch = stubSignalsFetch([...SIGNALS, ...flood]);
    render(<GovernanceSignalsPanel initialSeverity={null} />);
    await waitFor(() => expect(screen.getAllByTestId('signal-group')).toHaveLength(4));
    fireEvent.click(screen.getByLabelText('Dismiss all Stalled sessions signals'));
    await waitFor(() => expect(screen.getAllByTestId('signal-group')).toHaveLength(3));
    const post = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST');
    const body = JSON.parse(post[1].body);
    expect(body.dismiss_keys).toHaveLength(4);
    expect(body.dismiss_keys).toContain(signalDismissKey(flood[0]));
  });

  it('global Dismiss all clears every visible signal in one click', async () => {
    render(<GovernanceSignalsPanel initialSeverity={null} />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(3));
    fireEvent.click(screen.getByText('Dismiss all 3'));
    await waitFor(() => expect(screen.queryAllByTestId('signal-row')).toHaveLength(0));
    const post = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST');
    const body = JSON.parse(post[1].body);
    expect(body.dismiss_keys).toHaveLength(3);
  });

  it('links assumption and session signals to their surfaces', async () => {
    const extra = [
      {
        type: 'stale_assumption', severity: 'red',
        label: 'Unverified decision basis (35d): x',
        assumption_id: 'asm_1', detected_at: '2026-08-01T10:00:00Z',
      },
      {
        type: 'session_stalled', severity: 'red',
        label: 'Session stalled (10h): agent-z',
        session_id: 'sess_9', detected_at: '2026-08-09T01:00:00Z',
      },
    ];
    global.fetch = stubSignalsFetch(extra);
    render(<GovernanceSignalsPanel initialSeverity={null} />);
    await waitFor(() => expect(screen.getAllByTestId('signal-row')).toHaveLength(2));
    expect(screen.getByText('Validate or invalidate on Assumptions →').getAttribute('href')).toBe('/assumptions');
    expect(screen.getByText('View the session →').getAttribute('href')).toBe('/sessions/sess_9');
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
