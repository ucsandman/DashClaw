import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// /decisions deep links: every supported URL param must seed the filters and
// the fetch — they used to be silently ignored (the page read no search
// params), which made PostureScorecard/swarm/security-filter links no-ops.

let mockSearch = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div>
      <h1>{title}</h1>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));
vi.mock('@/components/MessageTrail', () => ({ default: () => null }));
vi.mock('@/components/OutcomeBadge', () => ({ OutcomeBadge: () => null }));
vi.mock('../../app/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: null }),
}));
vi.mock('../../app/hooks/useEffectiveRole', () => ({
  useEffectiveRole: () => ({ isAdmin: true }),
}));
vi.mock('../../app/hooks/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('../../app/lib/isDemoMode', () => ({ isDemoMode: () => false }));

function stubFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ actions: [], stats: {}, total: 0 }),
  }));
}

async function renderWith(search) {
  mockSearch = search;
  vi.resetModules();
  const { default: DecisionsPage } = await import('../../app/decisions/page.jsx');
  return render(<DecisionsPage />);
}

function actionFetchUrls(fetchMock) {
  return fetchMock.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.startsWith('/api/actions?'));
}

describe('/decisions URL param deep links', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/decisions');
    global.fetch = stubFetch();
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['agent_id=claude-code', 'agent_id=claude-code', 'agent: claude-code'],
    ['action_type=deploy', 'action_type=deploy', 'type: deploy'],
    ['status=failed', 'status=failed', 'status: failed'],
    ['outcome_status=lost_confirmation', 'outcome_status=lost_confirmation', 'outcome: lost confirmation'],
    ['swarm_id=sw_1', 'swarm_id=sw_1', 'swarm: sw_1'],
    ['risk_min=70', 'risk_min=70', 'risk ≥ 70'],
  ])('?%s filters the fetch and shows a clearable indicator', async (search, expectedQuery, chipLabel) => {
    await renderWith(search);

    await waitFor(() => {
      const urls = actionFetchUrls(global.fetch);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0]).toContain(expectedQuery);
    });

    // Visible indicator…
    const chips = await screen.findByTestId('active-filters');
    const chip = Array.from(chips.querySelectorAll('button')).find((b) => b.textContent.includes(chipLabel));
    expect(chip, `chip "${chipLabel}" not rendered`).toBeTruthy();

    // …and clearable: removing the chip refetches without the param.
    const callsBefore = actionFetchUrls(global.fetch).length;
    fireEvent.click(chip);
    await waitFor(() => {
      const urls = actionFetchUrls(global.fetch);
      expect(urls.length).toBeGreaterThan(callsBefore);
      expect(urls[urls.length - 1]).not.toContain(expectedQuery);
    });
  });

  it.each([
    ['decision=block', 'status=blocked', 'status: blocked'],
    ['decision=require_approval', 'status=pending_approval', 'status: pending approval'],
  ])('?%s maps the enforcement type onto the status filter', async (search, expectedQuery, chipLabel) => {
    await renderWith(search);

    await waitFor(() => {
      const urls = actionFetchUrls(global.fetch);
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0]).toContain(expectedQuery);
    });
    const chips = await screen.findByTestId('active-filters');
    expect(chips.textContent).toContain(chipLabel);
  });

  it('?decision=warn is ignored (warn evaluations have no ledger entries)', async () => {
    await renderWith('decision=warn');
    await waitFor(() => {
      const urls = actionFetchUrls(global.fetch);
      expect(urls.length).toBeGreaterThan(0);
      // Parse — a raw substring check would false-match exclude_status=.
      const params = new URL(urls[0], 'http://test').searchParams;
      expect(params.get('status')).toBeNull();
    });
    expect(screen.queryByTestId('active-filters')).toBeNull();
  });

  it('keeps the URL in sync (shareable) and consumes the decision alias', async () => {
    await renderWith('decision=block');
    await waitFor(() => {
      expect(window.location.search).toContain('status=blocked');
      expect(window.location.search).not.toContain('decision=');
    });
  });
});
