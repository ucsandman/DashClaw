import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@/components/AgentSpendCard', () => ({ default: () => <div data-testid="spend" /> }));

import { PostureScorecard } from '@/mission-control/components/PostureScorecard';

afterEach(cleanup);

const feedItems = [
  { category: 'failure', source: 'action', agent_id: 'a1' },
  { category: 'failure', source: 'action', agent_id: 'a2' },
  { category: 'stale', source: 'loop', agent_id: 'a1' },
  { category: 'health', source: 'integration', agent_id: null },
];

const baseProps = {
  agentId: null,
  decisionMetrics: { total: 42, change_percent: 5 },
  pendingActions: [{ action_id: 'act_1' }, { action_id: 'act_2' }],
  signalCounts: { red: 1, amber: 2, total: 3 },
  capabilityHealth: [{ health_status: 'healthy' }, { health_status: 'degraded' }],
  feedItems,
  summary: null,
  sortedAgents: [],
  criticalAgentIds: new Set(),
  failedAgentIds: new Set(),
  agentColor: () => '',
  activeCategory: null,
  onToggleCategory: () => {},
};

describe('PostureScorecard', () => {
  it('surfaces all 6 governance categories with client-derived counts', () => {
    const { container, getByText } = render(<PostureScorecard {...baseProps} />);
    const text = container.textContent;
    // all six category labels present
    for (const label of ['Pending Approvals', 'Failures · 24h', 'Risk Signals', 'Capability Health', 'Integration Health', 'Stale Loops · 48h']) {
      expect(text).toContain(label);
    }
    // posture headline
    expect(getByText('42')).toBeTruthy();
  });

  it('reflects the live SSE pulse-independent counts (failures=2, signals=3, integration=1, stale=1)', () => {
    const { container } = render(<PostureScorecard {...baseProps} />);
    // counts are rendered as the bold tabular number at the end of each row
    const nums = [...container.querySelectorAll('.tabular-nums')].map((n) => n.textContent);
    expect(nums).toContain('2'); // failures + pending approvals both 2
    expect(nums).toContain('3'); // risk signals total
    expect(nums).toContain('1'); // integration + stale
  });

  it('marks the active category row as pressed', () => {
    const { container } = render(<PostureScorecard {...baseProps} activeCategory="failure" />);
    const pressed = container.querySelector('[aria-pressed="true"]');
    expect(pressed?.textContent).toContain('Failures · 24h');
  });
});
