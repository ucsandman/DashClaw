import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * F1 inert-rule banner → the grant that nullified the rule.
 *
 * Regression: the banner's "Review suppressed patterns" was `<Link
 * href="#suppressed">` and nothing on the page carried `id="suppressed"`. The
 * grants ("Never bother me about…") only exist in the ledger's Sentences lens,
 * which the Table default never renders — so the click changed the URL hash and
 * did nothing visible. The control must land the human on the grant with its
 * Remove button in reach.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

const { default: PolicyWorkbench } = await import('@/policies/components/PolicyWorkbench.jsx');

const GRANT_ID = 'gp_grant_api';

const SUMMARY = {
  governed: true,
  modes: [],
  primaryMode: null,
  enforcement: { total: 1, warn: 0, require_approval: 1, block: 0 },
  rules: [],
  shields: [],
  decisions30d: { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 },
  scope: { allAgents: true },
  agents: { total: 1 },
  pendingApprovals: 0,
  budgetReport: { policiesOverBudget: 0, shapesOverBudget: 0, window_hours: 24, budget: 50, shape_budget: 50 },
  // Spec 4.1: only an inert BLOCK or Short List line is raised above the fold,
  // so the suppressed gate has to be on the list for the alert to exist.
  shortList: [
    {
      id: 'gp_gate',
      name: '[Claude Code Mode] Record external comms',
      tier: 'HOLD',
      policy_type: 'require_approval',
      scope: 'external comms',
      fired30d: 0,
      ungrantable: false,
      shape_exceptions: [],
      active: true,
      seeded: false,
    },
  ],
  shortListCap: 10,
  suggestions: [],
  inert: [
    {
      id: 'gp_gate',
      name: '[Claude Code Mode] Record external comms',
      policy_type: 'require_approval',
      action_types: ['api'],
      suppressed_by: [{ id: GRANT_ID, name: '[Grant] api', target_prefix: '/dev/null' }],
    },
  ],
};

const CONTRACT = {
  governed: true,
  mode_id: null,
  interrupts: [],
  silent: [],
  blocks: [],
  grants: [{ policy_id: GRANT_ID, label: 'api → /dev/null', shape_key: 'api::/dev/null', created_at: null }],
  custom: [],
  friction: { interrupts_7d: 0, est_seconds: 0 },
};

// The ledger short-circuits to "No rules yet" when the raw rule list is empty,
// whatever the lens — so the grant has to exist as a policy row too. The nine
// filler rows keep the count at ten, where the ledger's default lens is Table
// (under ten it opens on Sentences) — this test is about the Table default not
// showing grants until the banner drives the ledger there.
const POLICY_ROWS = [
  {
    id: GRANT_ID,
    name: '[Grant] api',
    policy_type: 'allow_grant',
    rules: JSON.stringify({ action_type: 'api', target_prefix: '/dev/null' }),
    active: 1,
    created_at: null,
  },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `gp_filler_${i}`,
    name: `Filler ${i}`,
    policy_type: 'warn_action_type',
    rules: JSON.stringify({ action_types: ['build'] }),
    active: 1,
    created_at: null,
  })),
];

function mockFetch() {
  const routes = {
    '/api/policies/summary': () => SUMMARY,
    '/api/policies/contract': () => CONTRACT,
    '/api/policies': () => ({ policies: POLICY_ROWS }),
    '/api/agents': () => ({ agents: [] }),
  };
  return vi.fn(async (url) => {
    const path = String(url).split('?')[0];
    const handler = routes[path];
    // Everything else is the triage inbox's five proposal feeds — empty, but
    // shaped: it reads `policies` on the tuning feed before `proposals`.
    const fallback = { groups: [], interrupts: [], proposals: [], policies: [], cursor: '' };
    return { ok: true, status: 200, json: async () => (handler ? handler() : fallback) };
  });
}

describe('/policies — inert-rule banner reveals the suppressing grant (F1)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
    // jsdom has no layout; the reveal scrolls its target into view.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lands on the grant, in the Sentences lens, with Remove in reach', async () => {
    render(<PolicyWorkbench />);

    await screen.findByText(/currently inert/i);
    // Table lens is the default and has no grants section.
    expect(screen.queryByText(/never bother me about/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /review suppressed patterns/i }));

    expect(await screen.findByText(/never bother me about/i)).toBeTruthy();
    // This assertion fails ONLY in CI full-suite runs (2026-08-14, twice) and
    // has never reproduced locally — in isolation, repeated, or with slowed
    // mocks. The catch block prints the discriminating evidence so the next
    // CI failure identifies the mechanism instead of just the symptom.
    try {
      await waitFor(() =>
        expect(screen.getByRole('tab', { name: /sentences/i }).getAttribute('aria-selected')).toBe('true'));
    } catch (err) {
      const tablists = document.querySelectorAll('[role="tablist"]');
      const tabs = document.querySelectorAll('[role="tab"]');
      console.error('[inert-banner diag] tablists:', tablists.length,
        '| tabs:', [...tabs].map((t) => `${t.textContent}=${t.getAttribute('aria-selected')}${t.closest('[hidden]') ? '(hidden)' : ''}`).join(' '),
        '| sentences text still in DOM:', !!screen.queryByText(/never bother me about/i),
        '| inert banner present:', !!screen.queryByText(/currently inert/i));
      throw err;
    }
    // The human's whole job here is one click: remove the grant.
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
