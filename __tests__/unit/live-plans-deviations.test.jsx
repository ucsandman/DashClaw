// LivePlansSection deviation strip (RFC 2026-08-11 §12): the strip chip, the
// declared-vs-observed pair, and the operator resolve buttons. Renders the
// real component (Card/Badge are simple presentational components).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { default: LivePlansSection } = await import('@/approvals/_components/LivePlansSection.jsx');

const plan = (over = {}) => ({
  plan_id: 'pa_live1', agent_id: 'deploy-agent', declared_goal: 'Rotate the staging API credentials',
  status: 'approved', expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  ...over,
});

const deviation = (over = {}) => ({
  deviation_id: 'dv_1', kind: 'act_substitution', severity: 'high', status: 'open',
  detector: 'server_derived', step_id: 'ps_2',
  declared: { action_type: 'config_change', step_goal: 'swap staging config' },
  observed: { action_type: 'config_change', declared_goal: 'swap staging config', act_summary: 'config_change: production env config' },
  agent_note: null,
  ...over,
});

describe('LivePlansSection — deviations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it('renders the deviation count chip and expands to declared-vs-observed with resolve buttons', () => {
    render(
      <LivePlansSection
        plans={[{ plan: plan(), steps: [], deviations: [deviation()] }]}
        canDecide={true}
        onResolved={() => {}}
      />,
    );
    const chip = screen.getByText(/1 deviation · 1 open/);
    expect(chip).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Toggle deviations/i));
    expect(screen.getByText('act substitution')).toBeTruthy();
    expect(screen.getByText('Declared (plan)')).toBeTruthy();
    expect(screen.getByText('Observed (live)')).toBeTruthy();
    expect(screen.getByText('Acknowledge')).toBeTruthy();
    expect(screen.getByText('Accept')).toBeTruthy();
    expect(screen.getByText('Accept & amend plan')).toBeTruthy();
    expect(screen.getByText('Reject')).toBeTruthy();
  });

  it('a resolve click POSTs the resolve_deviation verdict and refetches', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const onResolved = vi.fn();
    render(
      <LivePlansSection
        plans={[{ plan: plan(), steps: [], deviations: [deviation()] }]}
        canDecide={true}
        onResolved={onResolved}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Toggle deviations/i));
    fireEvent.click(screen.getByText('Accept & amend plan'));

    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/plans/pa_live1');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      verdict: 'resolve_deviation', deviation_id: 'dv_1', resolution: 'accepted', amend_plan: true,
    });
    vi.unstubAllGlobals();
  });

  it('read-only viewers see the strip but no resolve buttons', () => {
    render(
      <LivePlansSection
        plans={[{ plan: plan(), steps: [], deviations: [deviation()] }]}
        canDecide={false}
        onResolved={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Toggle deviations/i));
    expect(screen.getByText('act substitution')).toBeTruthy();
    expect(screen.queryByText('Acknowledge')).toBeNull();
  });

  it('resolved deviations show their status and lose the buttons', () => {
    render(
      <LivePlansSection
        plans={[{ plan: plan(), steps: [], deviations: [deviation({ status: 'accepted' })] }]}
        canDecide={true}
        onResolved={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Toggle deviations/i));
    expect(screen.getByText('accepted')).toBeTruthy();
    expect(screen.queryByText('Acknowledge')).toBeNull();
  });
});
