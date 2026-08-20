import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * B5 — /policies rebuilt around the Short List.
 *
 * Pins the things the rebuild is FOR, in the order a human reads them:
 * three top buttons instead of six, the Short List above the inbox above
 * Calibration, the old ledger demoted to a collapsed "Everything else", no
 * glossary, and a rule editor that can put a new line on the Short List.
 */

let searchParams = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParams),
}));

import PolicyWorkbench from '@/policies/components/PolicyWorkbench';

const SUMMARY = {
  governed: true,
  modes: [],
  primaryMode: null,
  enforcement: { total: 4, warn: 2, require_approval: 2, block: 0 },
  rules: [],
  shields: [],
  decisions30d: { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 },
  scope: { allAgents: true },
  agents: { total: 1 },
  pendingApprovals: 0,
  budgetReport: { policiesOverBudget: 0, shapesOverBudget: 0, window_hours: 24, budget: 50, shape_budget: 50 },
  shortList: [
    {
      id: 'gp_secrets',
      name: 'Secret-file writes',
      tier: 'HOLD',
      policy_type: 'require_approval',
      scope: 'writes to .env',
      fired30d: 1,
      ungrantable: true,
      shape_exceptions: [],
      active: true,
      seeded: true,
    },
  ],
  shortListCap: 10,
  suggestions: [],
  inert: [],
};

const CONTRACT = {
  governed: true,
  mode_id: null,
  interrupts: [],
  silent: [],
  blocks: [],
  grants: [],
  custom: [],
  friction: { interrupts_7d: 1, est_seconds: 20 },
};

const CONTROLLER = {
  settings: { mode: 'shadow', target_rate: 0.1 },
  state: {
    theta: 62.5,
    labeled_total: 0,
    labeled_live: 0,
    labeled_benign: 0,
    labeled_denied: 0,
    loss_sum: 0,
    observed_rate: null,
    observed_window_rate: null,
    observed_window: 0,
    relief_ceiling: 55,
    relief_ready: false,
    active_eligible: false,
  },
  defaults: { relief_min_labels: 10, relief_min_live_labels: 3 },
  alarms: [],
  events: [],
  risk_threshold_policies: [],
};

const POLICY_ROWS = [
  {
    id: 'gp_secrets',
    name: 'Secret-file writes',
    policy_type: 'require_approval',
    rules: JSON.stringify({ action_types: ['config'], action: 'require_approval' }),
    active: 1,
    created_at: null,
  },
];

let posted: Array<{ url: string; body: any }>;

function mockFetch() {
  posted = [];
  const routes: Record<string, () => unknown> = {
    '/api/policies/summary': () => SUMMARY,
    '/api/policies/contract': () => CONTRACT,
    '/api/calibration/controller': () => CONTROLLER,
    '/api/policies': () => ({ policies: POLICY_ROWS }),
    '/api/agents': () => ({ agents: [] }),
  };
  return vi.fn(async (url: string, options: any = {}) => {
    const path = String(url).split('?')[0] ?? '';
    if ((options.method || 'GET') !== 'GET') {
      posted.push({ url: path, body: JSON.parse(options.body || '{}') });
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }
    const handler = routes[path];
    // Everything else is the triage inbox's proposal feeds — empty but shaped.
    const fallback = { groups: [], interrupts: [], proposals: [], policies: [], cursor: '' };
    return { ok: true, status: 200, json: async () => (handler ? handler() : fallback) };
  });
}

const topRow = () => screen.getByTestId('policy-top-actions');

describe('/policies workbench layout (B5)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
    Element.prototype.scrollIntoView = vi.fn();
    try { localStorage.clear(); } catch { /* jsdom always has it */ }
    searchParams = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads top-to-bottom: Short List, Needs your call, Calibration, Everything else, Outside provider', async () => {
    const { container } = render(<PolicyWorkbench />);
    await screen.findByText('The Short List');

    const headings = Array.from(container.querySelectorAll('h2')).map((h) => (h.textContent || '').trim());
    expect(headings[0]).toBe('The Short List');
    expect(headings[1]).toBe('Needs your call');
    expect(headings[2]).toBe('Calibration');
    expect(headings[3]).toContain('Everything else — watched, recorded, not interrupting');
    expect(headings[4]).toContain('Outside decision provider');
  });

  it('offers exactly three top buttons and no glossary', async () => {
    render(<PolicyWorkbench />);
    await screen.findByText('The Short List');

    const buttons = within(topRow()).getAllByRole('button');
    expect(buttons.map((b) => (b.textContent || '').trim())).toEqual(['Add a rule', 'Packs', 'Export proof']);
    expect(screen.queryByText(/glossary/i)).toBeNull();
  });

  it('collapses Everything else by default', async () => {
    render(<PolicyWorkbench />);
    const header = await screen.findByRole('button', { name: /Everything else/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('puts both pack entries behind the Packs menu', async () => {
    render(<PolicyWorkbench />);
    await screen.findByText('The Short List');

    fireEvent.click(within(topRow()).getByRole('button', { name: 'Packs' }));
    const menu = within(topRow()).getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Browse packs/ }).getAttribute('href')).toBe('/policies/packs');
    expect(within(menu).getByRole('menuitem', { name: /Import pack \/ YAML/ })).toBeTruthy();
  });

  // The "Never let this happen unattended" flow on /decisions deep-links here
  // with ?prefill=. The editor it opens lives INSIDE the collapsed-by-default
  // ledger section, so without a forceOpen the human lands on an ordinary
  // /policies page and the whole flow dead-ends.
  it('shows the prefilled rule editor even though the ledger is collapsed', async () => {
    searchParams = `prefill=${encodeURIComponent(JSON.stringify({
      name: 'Never let this happen unattended',
      policy_type: 'require_approval',
      rules: { action_types: ['deploy'], short_list: true },
    }))}`;
    render(<PolicyWorkbench />);

    // getByRole skips anything inside a `hidden` ancestor — finding the dialog
    // is the proof that the section is genuinely open.
    const dialog = await screen.findByRole('dialog', { name: 'New rule' });
    expect(within(dialog).getByLabelText('Policy Name')).toHaveProperty(
      'value',
      'Never let this happen unattended',
    );
    expect((within(dialog).getByLabelText(/Interrupts unattended runs \(Short List\)/) as HTMLInputElement).checked).toBe(true);
  });

  it('writes rules.short_list when the Short List checkbox is ticked', async () => {
    render(<PolicyWorkbench />);
    await screen.findByText('The Short List');

    fireEvent.click(within(topRow()).getByRole('button', { name: 'Add a rule' }));
    fireEvent.change(await screen.findByLabelText('Policy Name'), { target: { value: 'Real money' } });
    fireEvent.click(screen.getByLabelText(/Interrupts unattended runs \(Short List\)/));
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    await waitFor(() => expect(posted.some((p) => p.url === '/api/policies')).toBe(true));
    const call = posted.find((p) => p.url === '/api/policies')!;
    expect(JSON.parse(call.body.rules).short_list).toBe(true);
  });
});
