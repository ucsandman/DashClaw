import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

// Shared passthrough/stub mocks for the Phase-4 wired list pages.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/PageLayout', () => ({
  default: ({ actions, children }) => (
    <div>
      <div data-testid="actions">{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/hooks/useEffectiveRole', () => ({
  useEffectiveRole: () => ({ isAdmin: true, settled: true, authenticated: true }),
}));
vi.mock('@/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: null }),
  AgentFilterProvider: ({ children }) => children,
}));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));

const NOW = '2026-06-01T00:00:00.000Z';
let calls = [];
const fetchCalls = (method, includes) => calls.filter((c) => c.method === method && c.u.includes(includes));

function installFetch(router) {
  calls = [];
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    calls.push({ u, method });
    return Promise.resolve({ ok: true, json: async () => router(u, method) });
  });
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function selectAll(page, label = 'Select all') {
  const utils = render(page);
  const selectAllBox = await waitFor(() => utils.getByLabelText(label));
  fireEvent.click(selectAllBox);
  const actions = utils.getByTestId('actions');
  await waitFor(() => expect(within(actions).getByText(/3 selected/)).toBeTruthy());
  return { utils, actions };
}

const THREE = [1, 2, 3].map((n) => ({
  id: `x${n}`, agent_id: `x${n}`, name: `Item ${n}`,
  scorer_name: 'scorer', action_id: `act_${n}`, score: 0.9, label: 'pass',
  permission_level: 'readonly', created_at: NOW, assumption: `Assumption ${n}`,
}));

describe('Phase 4 multi-select — mutating pages fan out per-item DELETEs', () => {
  it('identities: select-all → Revoke fires 3 identity DELETEs', async () => {
    installFetch((u) => {
      if (u.includes('/api/identities')) return { identities: THREE };
      if (u.includes('/api/pairings')) return { pairings: [] };
      return {};
    });
    const { default: IdentitiesPage } = await import('@/identities/page');
    const { actions } = await selectAll(<IdentitiesPage />);
    fireEvent.click(within(actions).getByText('Revoke'));
    await waitFor(() => expect(fetchCalls('DELETE', '/api/identities/').length).toBe(3));
  });

  it('declining the confirm fires no DELETE (destructive bulk is gated)', async () => {
    window.confirm.mockReturnValue(false);
    installFetch((u) => {
      if (u.includes('/api/identities')) return { identities: THREE };
      if (u.includes('/api/pairings')) return { pairings: [] };
      return {};
    });
    const { default: IdentitiesPage } = await import('@/identities/page');
    const { actions } = await selectAll(<IdentitiesPage />);
    fireEvent.click(within(actions).getByText('Revoke'));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalls('DELETE', '/api/identities/').length).toBe(0);
    expect(window.confirm).toHaveBeenCalled();
  });
});

describe('Phase 4 multi-select — read-only pages expose non-destructive bulk only', () => {
  it('assumptions: select-all → Copy IDs available, no DELETE fan-out', async () => {
    installFetch((u) => {
      if (u.includes('/api/actions/assumptions')) return { assumptions: THREE, total: 3 };
      return {};
    });
    const { default: AssumptionsPage } = await import('@/assumptions/page');
    const { actions } = await selectAll(<AssumptionsPage />);
    expect(within(actions).getByText('Copy IDs')).toBeTruthy();
    expect(within(actions).queryByText('Delete')).toBeNull();
  });

  it('evaluations: select-all on scores → Copy IDs available', async () => {
    installFetch((u) => {
      if (u.includes('/api/evaluations/scorers')) return { scorers: [] };
      if (u.includes('/api/evaluations/runs')) return { runs: [] };
      if (u.includes('/api/evaluations/stats')) return {};
      if (u.includes('/api/evaluations')) return { scores: THREE, total: 3 };
      return {};
    });
    const { default: EvaluationsPage } = await import('@/evaluations/page');
    const { actions } = await selectAll(<EvaluationsPage />);
    expect(within(actions).getByText('Copy IDs')).toBeTruthy();
  });
});
