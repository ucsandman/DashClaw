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
// Stub capabilities' heavy presentational components so the test exercises the
// page's selection wiring, not the card internals.
vi.mock('@/capabilities/components/CapabilityRegistryCard', () => ({
  default: ({ capability }) => <div>{capability?.name ?? capability?.capability_id}</div>,
}));
vi.mock('@/capabilities/components/CapabilityRegistrySummary', () => ({ default: () => <div /> }));
vi.mock('@/capabilities/components/CapabilityRegistryFilters', () => ({ default: () => <div /> }));

import KnowledgePage from '@/knowledge/page';
import ApiKeysPage from '@/api-keys/page';
import WebhooksPage from '@/webhooks/page';
import SecretsPage from '@/secrets/page';
import CapabilitiesPage from '@/capabilities/page';

const NOW = '2026-06-01T00:00:00.000Z';
const KNOWLEDGE = [1, 2, 3].map((n) => ({
  collection_id: `col_${n}`, name: `Collection ${n}`, ingestion_status: 'ready',
  source_type: 'manual', doc_count: 1, created_at: NOW, last_synced_at: NOW, tags: [],
}));
const KEYS = [1, 2, 3].map((n) => ({
  id: `key_${n}`, name: `Key ${n}`, prefix: 'dk_live_', revoked_at: null, created_at: NOW, last_used_at: null,
}));
const WEBHOOKS = [1, 2, 3].map((n) => ({
  id: `wh_${n}`, url: 'https://example.com/hook', active: true, events: '["signal.detected"]', created_at: NOW,
}));
const SECRETS = [1, 2, 3].map((n) => ({
  id: `sec_${n}`, name: `Secret ${n}`, next_rotation_due: null, rotation_interval_days: 90, last_rotated_at: null,
}));
const CAPS = [1, 2, 3].map((n) => ({
  capability_id: `cap_${n}`, name: `Capability ${n}`, risk_level: 'low', health_status: 'healthy', status: 'active',
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
    if (u.includes('/api/knowledge/collections') && method === 'GET') body = { collections: KNOWLEDGE };
    else if (u.startsWith('/api/keys') && method === 'GET') body = { keys: KEYS };
    else if (u.startsWith('/api/webhooks') && method === 'GET') body = { webhooks: WEBHOOKS };
    else if (u.includes('/api/capabilities/health')) body = { capabilities: [] };
    else if (u.startsWith('/api/capabilities') && method === 'GET') body = { capabilities: CAPS };
    else if (u.startsWith('/api/secrets') && method === 'GET') body = { secrets: SECRETS };
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
  it('knowledge: select-all → BulkActionBar count → bulk delete fires 3 DELETEs', async () => {
    const { actions } = await selectAllThenAssertCount(<KnowledgePage />);
    fireEvent.click(within(actions).getByText('Delete'));
    await waitFor(() => expect(fetchCalls('DELETE', '/api/knowledge/collections/').length).toBe(3));
  });

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

  it('secrets: select-all → count → bulk delete fires 3 secret DELETEs', async () => {
    const { actions } = await selectAllThenAssertCount(<SecretsPage />);
    fireEvent.click(within(actions).getByText('Delete'));
    await waitFor(() => expect(fetchCalls('DELETE', '/api/secrets/').length).toBe(3));
  });

  it('capabilities: select-all → count → bulk delete fires 3 capability DELETEs', async () => {
    const { actions } = await selectAllThenAssertCount(<CapabilitiesPage />);
    fireEvent.click(within(actions).getByText('Delete'));
    await waitFor(() => expect(fetchCalls('DELETE', '/api/capabilities/').length).toBe(3));
  });

  it('destructive bulk delete is gated on confirm — declining fires no DELETE', async () => {
    window.confirm.mockReturnValue(false);
    const { actions } = await selectAllThenAssertCount(<KnowledgePage />);
    fireEvent.click(within(actions).getByText('Delete'));
    // give any (incorrectly un-gated) request a tick to fire
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalls('DELETE', '/api/knowledge/collections/').length).toBe(0);
    expect(window.confirm).toHaveBeenCalled();
  });
});
