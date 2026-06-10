import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// REGRESSION: approving a pairing from /identities must go through
// POST /api/pairings/{id}/approve — the ONLY path that writes the
// agent_identities row (upsertIdentity). The page used to PATCH
// {status:'approved'}, which flips the pairing status WITHOUT creating the
// identity: the pairing vanished from Pending but the agent never became
// verified. This test fails against the PATCH-only implementation.

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div><h1>{title}</h1><div>{actions}</div><div>{children}</div></div>
  ),
}));
vi.mock('../../app/hooks/useEffectiveRole', () => ({
  useEffectiveRole: () => ({ isAdmin: true, settled: true }),
}));

const PENDING_PAIRING = {
  id: 'pair_1',
  agent_id: 'clawdbot',
  agent_name: 'Clawdbot',
  status: 'pending',
  permission_level: 'readonly',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
};

function identitiesFetch() {
  return vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.startsWith('/api/pairings?')) {
      return { ok: true, status: 200, json: async () => ({ pairings: [PENDING_PAIRING] }) };
    }
    if (u.startsWith('/api/identities')) {
      return { ok: true, status: 200, json: async () => ({ identities: [] }) };
    }
    if (u.startsWith('/api/settings')) {
      return { ok: true, status: 200, json: async () => ({ settings: [] }) };
    }
    if (u.startsWith('/api/agents')) {
      return { ok: true, status: 200, json: async () => ({ agents: [] }) };
    }
    if (u.startsWith('/api/messages')) {
      return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    }
    if (u.startsWith('/api/pairings/') && method === 'PATCH') {
      return { ok: true, status: 200, json: async () => ({ pairing: { ...PENDING_PAIRING, ...JSON.parse(opts.body) } }) };
    }
    if (u.includes('/approve') && method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ pairing: { ...PENDING_PAIRING, status: 'approved' }, identity: { agent_id: 'clawdbot' } }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

describe('/identities approve flow — identity creation regression', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('UI approval hits the identity-creating endpoint (POST .../approve)', async () => {
    global.fetch = identitiesFetch();
    const { default: Page } = await import('../../app/identities/page.jsx');
    render(<Page />);

    const approveBtn = await screen.findByRole('button', { name: /^approve$/i });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      const approveCall = global.fetch.mock.calls.find(
        ([u, o]) => String(u).endsWith('/api/pairings/pair_1/approve') && o?.method === 'POST',
      );
      // Without this call, no agent_identities row is ever written — the
      // pairing disappears from Pending while the agent stays unverified.
      expect(approveCall).toBeTruthy();
    });
  });
});
