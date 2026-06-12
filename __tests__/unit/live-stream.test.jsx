import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { LiveStream } from '@/mission-control/components/LiveStream';

afterEach(cleanup);

const handlers = {
  onApprove: () => {},
  onDeny: () => {},
  onRetry: () => {},
  onCancel: () => {},
  onDisable: () => {},
};

const signalA = {
  id: 's1', category: 'signal', severity: 'critical', title: 'Agent heartbeat lost: ps-qa',
  detail: '', source: 'signal', source_id: null, agent_id: 'ps-qa', timestamp: null,
  action_url: '/security', dismiss_key: 'agent_silent:ps-qa::::t1',
};
const signalB = {
  id: 's2', category: 'signal', severity: 'critical', title: 'Governance alert: codex',
  detail: '', source: 'signal', source_id: null, agent_id: 'codex', timestamp: null,
  action_url: '/security', dismiss_key: 'autonomy_spike:codex::::t2',
};
const failure = {
  id: 'f1', category: 'failure', severity: 'high', title: 'Failed: deploy', detail: '',
  source: 'action', source_id: 'act_9', agent_id: 'deploy-bot', timestamp: null,
  action_url: '/decisions/act_9',
};

function renderStream(extra = {}) {
  return render(
    <LiveStream
      feedItems={[signalA, signalB, failure]}
      agentId={null}
      activeCategory={null}
      onClearFilter={() => {}}
      livePulse={false}
      loading={false}
      handlers={handlers}
      {...extra}
    />,
  );
}

describe('LiveStream signal dismissal', () => {
  it('shows a "Clear N signals" header action and dismisses every signal dismiss_key at once', () => {
    const onDismissSignals = vi.fn();
    const { getByText } = renderStream({ onDismissSignals });
    fireEvent.click(getByText('Clear 2 signals'));
    expect(onDismissSignals).toHaveBeenCalledWith([
      'agent_silent:ps-qa::::t1',
      'autonomy_spike:codex::::t2',
    ]);
  });

  it('offers per-row dismiss on signal rows only', () => {
    const onDismissSignals = vi.fn();
    const { container } = renderStream({ onDismissSignals });
    const buttons = container.querySelectorAll('[aria-label="Dismiss signal"]');
    expect(buttons.length).toBe(2); // the failure row gets no dismiss
    fireEvent.click(buttons[0]);
    expect(onDismissSignals).toHaveBeenCalledWith(['agent_silent:ps-qa::::t1']);
  });

  it('a grouped signal row renders once and its X dismisses every occurrence', () => {
    const grouped = {
      id: 'sg', category: 'signal', severity: 'critical', title: 'Session stalled: openclaw',
      detail: '', source: 'signal', source_id: null, agent_id: 'openclaw', timestamp: null,
      action_url: '/security', dismiss_key: 'k1', dismiss_keys: ['k1', 'k2', 'k3'], occurrence_count: 3,
    };
    const onDismissSignals = vi.fn();
    const { container, getByText } = render(
      <LiveStream
        feedItems={[grouped, failure]}
        agentId={null}
        activeCategory={null}
        onClearFilter={() => {}}
        livePulse={false}
        loading={false}
        handlers={handlers}
        onDismissSignals={onDismissSignals}
      />,
    );
    const buttons = container.querySelectorAll('[aria-label="Dismiss signal"]');
    expect(buttons.length).toBe(1);
    // Header clear counts occurrences, not rows.
    expect(getByText('Clear 3 signals')).toBeTruthy();
    fireEvent.click(buttons[0]);
    expect(onDismissSignals).toHaveBeenCalledWith(['k1', 'k2', 'k3']);
  });

  it('renders no clear action without onDismissSignals or without dismissable signals', () => {
    const { queryByText } = renderStream();
    expect(queryByText(/Clear \d+ signal/)).toBeNull();

    const onDismissSignals = vi.fn();
    const { queryByText: q2 } = render(
      <LiveStream
        feedItems={[failure]}
        agentId={null}
        activeCategory={null}
        onClearFilter={() => {}}
        livePulse={false}
        loading={false}
        handlers={handlers}
        onDismissSignals={onDismissSignals}
      />,
    );
    expect(q2(/Clear \d+ signal/)).toBeNull();
  });
});
