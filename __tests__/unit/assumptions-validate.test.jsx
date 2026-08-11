import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/**
 * The positive verdict has to be a visible control.
 *
 * Regression: PATCH /api/assumptions/:id has accepted `{validated: true}` since
 * the route was written, and the right-click menu called it — but the page only
 * ever rendered "Invalidate…". A human staring at 42 pending assumptions could
 * invalidate any of them and validate none, unless they guessed that right-click
 * does something. Validate is now a button, per row and in bulk.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/assumptions',
}));

// PageLayout mounts UserMenu, which needs a SessionProvider we don't care about.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: vi.fn(),
  SessionProvider: ({ children }) => children,
}));

const { default: AssumptionsPage } = await import('@/assumptions/page.jsx');

const PENDING = [
  { assumption_id: 'asm_1', assumption: 'Local instance is on the latest schema', basis: 'session transcript', agent_id: 'guide-capture-agent', validated: 0, invalidated: 0, drift_score: 10, created_at: '2026-08-07T17:01:39Z' },
  { assumption_id: 'asm_2', assumption: 'The publish is credential-gated', basis: 'session transcript', agent_id: 'claude-code', validated: 0, invalidated: 0, drift_score: 10, created_at: '2026-08-07T22:35:18Z' },
];

let patches = [];

function mockFetch() {
  return vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'PATCH') {
      patches.push({ url: String(url), body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        assumptions: PENDING,
        total: PENDING.length,
        drift_summary: { validated: 0, invalidated: 0, unvalidated: 2, at_risk: 0 },
      }),
    };
  });
}

describe('/assumptions — validating is a visible click, not a right-click', () => {
  beforeEach(() => {
    patches = [];
    vi.stubGlobal('fetch', mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders a Validate button on every pending row and PATCHes validated:true', async () => {
    render(<AssumptionsPage />);

    const buttons = await screen.findAllByRole('button', { name: /^Validate$/ });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].url).toContain('/api/assumptions/asm_1');
    expect(patches[0].body).toEqual({ validated: true });
  });

  it('validates a whole selection at once from the bulk bar', async () => {
    render(<AssumptionsPage />);
    await screen.findAllByRole('button', { name: /^Validate$/ });

    fireEvent.click(screen.getByRole('checkbox', { name: /^Select all$/i }));

    const bulkBar = await screen.findByRole('region', { name: /bulk actions/i });
    fireEvent.click(within(bulkBar).getByRole('button', { name: /^Validate$/ }));

    // One PATCH per selected row — the point of the bulk control.
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches.map((p) => p.body)).toEqual([{ validated: true }, { validated: true }]);
  });
});
