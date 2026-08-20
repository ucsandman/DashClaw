import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// "One Ledger, Many Lenses" redesign: CustomTab (mounted only at
// /policies/rules, reading ?prefill= itself) was deleted. Prefill now flows
// in as a `prefill` prop on Ledger — PolicyWorkbench is responsible for
// parsing the deep-link and handing Ledger the parsed draft.
const { default: Ledger } = await import('@/policies/components/Ledger.jsx');

function mockFetch() {
  const routes = {
    'GET /api/policies': () => ({ policies: [] }),
    'GET /api/agents': () => ({ agents: [] }),
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
  refreshSignal: 0,
  onChanged: noop,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('Ledger — prefill from deep-link (A6)', () => {
  it('opens the rule editor pre-populated when a prefill draft is passed', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const draft = { name: 'CC6.1: block action type', policy_type: 'block_action_type', rules: { action_types: ['exec'], action: 'block' } };

    render(<Ledger {...baseProps} prefill={draft} />);

    // The rule editor is only mounted when showEditor is true; its Cancel
    // button is unique to that modal, so finding it proves the prefill opened it.
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy();
    // The prefilled policy name lands in the form.
    expect(screen.getByDisplayValue('CC6.1: block action type')).toBeTruthy();
  });

  it('does not open the rule editor without a prefill draft', async () => {
    vi.stubGlobal('fetch', mockFetch());
    render(<Ledger {...baseProps} prefill={null} />);
    await screen.findByText(/no rules yet/i);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B7: the "Never let this happen unattended" context-menu action deep-links to
// /policies?prefill=. The editor Ledger opens lives inside the collapsible
// "Everything else" section, which is kept MOUNTED but `hidden` when collapsed
// — so opening it is not enough; the section has to be forced open too, or the
// one-click path lands on an invisible form.
// ---------------------------------------------------------------------------
let searchParams = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParams),
}));

const WORKBENCH_SUMMARY = {
  governed: true,
  modes: [],
  primaryMode: null,
  enforcement: { total: 0, warn: 0, require_approval: 0, block: 0 },
  rules: [],
  shields: [],
  decisions30d: { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 },
  scope: { allAgents: true },
  agents: { total: 1 },
  pendingApprovals: 0,
  budgetReport: { policiesOverBudget: 0, shapesOverBudget: 0, window_hours: 24, budget: 50, shape_budget: 50 },
  shortList: [],
  shortListCap: 10,
  suggestions: [],
  inert: [],
};

const WORKBENCH_CONTRACT = {
  governed: true,
  mode_id: null,
  interrupts: [],
  silent: [],
  blocks: [],
  grants: [],
  custom: [],
  friction: { interrupts_7d: 0, est_seconds: 0 },
};

function mockWorkbenchFetch() {
  const routes = {
    '/api/policies/summary': () => WORKBENCH_SUMMARY,
    '/api/policies/contract': () => WORKBENCH_CONTRACT,
    '/api/policies': () => ({ policies: [] }),
    '/api/agents': () => ({ agents: [] }),
  };
  return vi.fn(async (url, options = {}) => {
    const path = String(url).split('?')[0] ?? '';
    if ((options.method || 'GET') !== 'GET') return { ok: true, status: 200, json: async () => ({ success: true }) };
    const handler = routes[path];
    const fallback = { groups: [], interrupts: [], proposals: [], policies: [], cursor: '', events: [], alarms: [] };
    return { ok: true, status: 200, json: async () => (handler ? handler() : fallback) };
  });
}

describe('PolicyWorkbench — a prefill deep-link lands on a VISIBLE editor (B7)', () => {
  it('opens the rule editor outside any hidden container', async () => {
    const { default: PolicyWorkbench } = await import('@/policies/components/PolicyWorkbench');
    const draft = {
      name: 'Hold file_write',
      policy_type: 'require_approval',
      rules: { action: 'require_approval', action_types: ['file_write'], short_list: true },
    };
    searchParams = `prefill=${encodeURIComponent(JSON.stringify(draft))}`;
    vi.stubGlobal('fetch', mockWorkbenchFetch());

    render(<PolicyWorkbench />);

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancel.closest('[hidden]')).toBeNull();
    expect(screen.getByDisplayValue('Hold file_write')).toBeTruthy();
    searchParams = '';
  });

  // Guards the assertion above: without the deep-link the same section really
  // is collapsed and hidden, so `forceOpen` is what makes the editor visible.
  it('leaves that section hidden when there is no deep-link', async () => {
    const { default: PolicyWorkbench } = await import('@/policies/components/PolicyWorkbench');
    searchParams = '';
    vi.stubGlobal('fetch', mockWorkbenchFetch());

    render(<PolicyWorkbench />);

    const ledgerContent = await screen.findByText(/no rules yet/i);
    expect(ledgerContent.closest('[hidden]')).not.toBeNull();
  });
});
