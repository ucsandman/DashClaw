import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

// Shared mocks for the 5 list pages under test. PageLayout is stubbed to a
// passthrough that exposes the `actions` slot (where BulkActionBar mounts).
vi.mock('@/components/PageLayout', () => ({
  default: ({ actions, children }) => (
    <div>
      <div data-testid="actions">{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));
vi.mock('@/hooks/useEffectiveRole', () => ({
  useEffectiveRole: () => ({ isAdmin: true, settled: true, authenticated: true }),
}));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
import ApiKeysPage from '@/api-keys/page';
import WebhooksPage from '@/webhooks/page';

const NOW = '2026-06-01T00:00:00.000Z';
const KEYS = [1, 2, 3].map((n) => ({
  id: `key_${n}`, name: `Key ${n}`, prefix: 'dk_live_', revoked_at: null, created_at: NOW, last_used_at: null,
}));
const WEBHOOKS = [1, 2, 3].map((n) => ({
  id: `wh_${n}`, url: 'https://example.com/hook', active: true, events: '["signal.detected"]', created_at: NOW,
}));

let calls = [];
function fetchCalls(method, includes) {
  return calls.filter((c) => c.method === method && c.u.includes(includes));
}

beforeEach(() => {
  calls = [];
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';
    calls.push({ u, method });
    let body = {};
    if (u.startsWith('/api/keys') && method === 'GET') body = { keys: KEYS };
    else if (u.startsWith('/api/webhooks') && method === 'GET') body = { webhooks: WEBHOOKS };
    return Promise.resolve({ ok: true, json: async () => body });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function selectAllThenAssertCount(page) {
  const utils = render(page);
  const selectAll = await waitFor(() => utils.getByLabelText('Select all'));
  fireEvent.click(selectAll);
  const actions = utils.getByTestId('actions');
  await waitFor(() => expect(within(actions).getByText(/3 selected/)).toBeTruthy());
  return { utils, actions };
}

describe('multi-select wiring across list pages', () => {
  it('api-keys: select-all → count → bulk revoke fires 3 key DELETEs', async () => {
    const { actions } = await selectAllThenAssertCount(<ApiKeysPage />);
    fireEvent.click(within(actions).getByText('Revoke'));
    await waitFor(() => expect(fetchCalls('DELETE', '/api/keys?id=').length).toBe(3));
  });

  it('webhooks: select-all → count → bulk delete fires 3 webhook DELETEs', async () => {
    const { actions } = await selectAllThenAssertCount(<WebhooksPage />);
    fireEvent.click(within(actions).getByText('Delete'));
    await waitFor(() => expect(fetchCalls('DELETE', '/api/webhooks?id=').length).toBe(3));
  });

  it('destructive bulk action is gated on confirm — declining fires no request', async () => {
    window.confirm.mockReturnValue(false);
    const { actions } = await selectAllThenAssertCount(<ApiKeysPage />);
    fireEvent.click(within(actions).getByText('Revoke'));
    // give any (incorrectly un-gated) request a tick to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalls('DELETE', '/api/keys?id=').length).toBe(0);
    expect(window.confirm).toHaveBeenCalled();
  });
});
