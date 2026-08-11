import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
// whatever the lens — so the grant has to exist as a policy row too.
const POLICY_ROWS = [
  {
    id: GRANT_ID,
    name: '[Grant] api',
    policy_type: 'allow_grant',
    rules: JSON.stringify({ action_type: 'api', target_prefix: '/dev/null' }),
    active: 1,
    created_at: null,
  },
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
    expect(screen.getByRole('tab', { name: /sentences/i }).getAttribute('aria-selected')).toBe('true');
    // The human's whole job here is one click: remove the grant.
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
