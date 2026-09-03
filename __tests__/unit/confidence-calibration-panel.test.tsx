import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a>,
}));

import ConfidenceCalibrationPanel from '@/components/ConfidenceCalibrationPanel';

beforeEach(() => vi.restoreAllMocks());

const stubStats = (confidence: unknown) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ total: 0, confidence }) })));

// Enough scored volume for a real verdict: 20 scored at a stated 95, half completed.
const scored = {
  window_days: 30,
  coverage: { closed: 1240, stated: 20 },
  overall: { n: 20, stated_avg: 95, observed_rate: 50, gap: 45, verdict: 'overconfident' },
  agents: [
    {
      agent_id: 'agent_deploy',
      agent_name: 'Deployer',
      n: 20,
      stated_avg: 95,
      observed_rate: 50,
      gap: 45,
      verdict: 'overconfident',
      buckets: [],
      coverage: { closed: 1240, stated: 20 },
    },
  ],
};

describe('ConfidenceCalibrationPanel', () => {
  it('renders the coverage line with thousands separators', async () => {
    stubStats(scored);
    const { container } = render(<ConfidenceCalibrationPanel />);
    await waitFor(() =>
      expect(container.textContent).toContain(
        '20 of 1,240 closed actions in the last 30 days carried a stated confidence.',
      ),
    );
  });

  it('renders the compact unscored state, not a table, below MIN_SCORED', async () => {
    // The shape a real workspace shows: six figures of closed actions, none scored.
    stubStats({
      window_days: 30,
      coverage: { closed: 129408, stated: 0 },
      overall: { n: 0, stated_avg: 0, observed_rate: 0, gap: 0, verdict: 'insufficient' },
      agents: [],
    });
    const { container, queryByTestId, getByTestId } = render(<ConfidenceCalibrationPanel />);

    await waitFor(() => expect(queryByTestId('calibration-coverage')).not.toBeNull());
    expect(getByTestId('calibration-coverage').textContent).toBe(
      '0 of 129,408 closed actions in the last 30 days carried a stated confidence.',
    );
    // One compact sentence, and no table at all.
    expect(container.textContent).toContain('Actions left at the default confidence of 50 are not scored.');
    expect(container.textContent).toContain('Verdicts need 10 scored actions.');
    expect(queryByTestId('calibration-table')).toBeNull();
  });

  it('renders a row per agent plus an All agents row, with verdict text', async () => {
    stubStats(scored);
    const { container, queryByTestId, getAllByTestId } = render(<ConfidenceCalibrationPanel />);

    await waitFor(() => expect(queryByTestId('calibration-table')).not.toBeNull());
    const rows = getAllByTestId('calibration-row');
    expect(rows).toHaveLength(2);
    const [overallRow, agentRow] = rows as [HTMLElement, HTMLElement];
    expect(overallRow.textContent).toContain('All agents');
    expect(agentRow.textContent).toContain('Deployer');
    // Verdict is spelled out, never colour alone.
    expect(agentRow.textContent).toContain('Overconfident');
    // Signed gap and percentages.
    expect(agentRow.textContent).toContain('+45');
    expect(agentRow.textContent).toContain('95%');
    expect(container.querySelector('a[href="/decisions?agent_id=agent_deploy"]')).not.toBeNull();
    expect(container.textContent).toContain(
      'Gap = stated confidence minus observed completion rate. Overconfident at +20 or more over at least 10 scored actions.',
    );
  });

  it('renders nothing when the stats fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { container } = render(<ConfidenceCalibrationPanel />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders nothing when the endpoint degraded the calibration block to null', async () => {
    stubStats(null);
    const { container } = render(<ConfidenceCalibrationPanel />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
