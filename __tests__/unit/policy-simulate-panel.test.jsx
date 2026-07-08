import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// "One Ledger, Many Lenses" redesign: CustomTab (and its per-row Simulate
// button) was deleted. The Table lens of Ledger now owns row actions,
// including Simulate — same in-page result modal, same wire shape.
const { default: Ledger } = await import('@/policies/components/Ledger.jsx');

const POLICY = {
  id: 'gp_1',
  name: 'Block prod deploys',
  policy_type: 'block_action_type',
  rules: JSON.stringify({ action_types: ['deploy'], action: 'block' }),
  active: 1,
};

const SIM = {
  summary: { total: 10, matches: 3, block: 3, warn: 0, require_approval: 0, allow: 7 },
  matches: [
    {
      action_id: 'a1',
      goal: 'deploy to prod',
      agent_name: 'ci',
      timestamp: 't',
      original_status: 'completed',
      simulated_action: 'block',
      simulated_reason: 'Action type "deploy" is blocked by policy',
    },
  ],
  sample_size: 10,
  window_days: 7,
};

function mockFetch() {
  const routes = {
    'GET /api/policies': () => ({ policies: [POLICY] }),
    'GET /api/agents': () => ({ agents: [] }),
    'POST /api/policies/simulate': () => SIM,
  };
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    const key = `${method} ${url.split('?')[0]}`;
    const handler = routes[key];
    return { ok: true, status: 200, json: async () => (handler ? handler() : {}) };
  });
}

const noop = () => {};
const baseProps = {
  summary: null,
  contract: null,
  highlightPolicy: null,
  prefill: null,
  refreshSignal: 0,
  onChanged: noop,
};

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Ledger — simulate impact panel (A3)', () => {
  it('renders an in-page panel with summary + sample matches and never calls window.alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.stubGlobal('fetch', mockFetch());

    render(<Ledger {...baseProps} />);
    await screen.findByText('Block prod deploys');

    fireEvent.click(screen.getByRole('button', { name: /simulate block prod deploys/i }));

    expect(await screen.findByText(/simulation impact/i)).toBeTruthy();
    expect(await screen.findByText(/would match/i)).toBeTruthy();
    expect(await screen.findByText(/deploy to prod/i)).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
