import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// REGRESSION (task-8 review findings 1 + 2 + minor): the unidentified-agents
// header badge, the summary stat, and the rendered rows must all agree on
// what's currently VISIBLE (the "Show test agents" toggle hides synthetic
// agents by default) — and a destructive bulk selection must never keep
// hold of an id that just became invisible (toggle flip) or was deleted
// (cleanup). Both bugs would let "Delete" erase rows the operator can no
// longer see.

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div><h1>{title}</h1><div>{actions}</div><div>{children}</div></div>
  ),
}));
vi.mock('../../app/hooks/useEffectiveRole', () => ({
  useEffectiveRole: () => ({ isAdmin: true, settled: true }),
}));

const REAL_AGENT = { agent_id: 'prod-agent-1', agent_name: null, action_count: 3, last_active: null };
// `test-` is one of the synthetic-id prefixes in app/lib/synthetic-agents.js.
const SYNTHETIC_AGENT = { agent_id: 'test-cleanup-agent', agent_name: null, action_count: 5, last_active: null };

function identitiesFetch(getFleet) {
  return vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.startsWith('/api/pairings?')) {
      return { ok: true, status: 200, json: async () => ({ pairings: [] }) };
    }
    if (u.startsWith('/api/identities')) {
      return { ok: true, status: 200, json: async () => ({ identities: [] }) };
    }
    if (u.startsWith('/api/settings')) {
      return { ok: true, status: 200, json: async () => ({ settings: [] }) };
    }
    if (u.startsWith('/api/agents')) {
      return { ok: true, status: 200, json: async () => ({ agents: getFleet() }) };
    }
    if (u.startsWith('/api/messages')) {
      return { ok: true, status: 200, json: async () => ({ messages: [] }) };
    }
    if (u.startsWith('/api/actions?synthetic=true') && method === 'DELETE') {
      return { ok: true, status: 200, json: async () => ({ deleted: 5 }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

describe('/identities unidentified-agents visibility + selection scoping', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it('badge/stat/rows agree on the toggle-off visible count (finding 1)', async () => {
    global.fetch = identitiesFetch(() => [REAL_AGENT, SYNTHETIC_AGENT]);
    const { default: Page } = await import('../../app/identities/page.jsx');
    render(<Page />);

    await screen.findByRole('heading', { name: 'Unidentified Agents' });

    // Toggle off by default: only the real agent renders, and the header
    // badge must match — not the raw (synthetic-inclusive) total.
    expect(screen.getByText('prod-agent-1')).toBeTruthy();
    expect(screen.queryByText('test-cleanup-agent')).toBeNull();
    expect(screen.getByLabelText('Select prod-agent-1')).toBeTruthy();
    expect(screen.queryByLabelText('Select test-cleanup-agent')).toBeNull();

    const section = screen.getByTestId('unidentified-section').closest('div.mb-6');
    expect(section.textContent).toContain('Unidentified Agents');
    // Badge renders "1" (visible count), not "2" (raw unidentified.length).
    expect(within(section).queryAllByText('2').length).toBe(0);
    expect(within(section).getAllByText('1').length).toBeGreaterThan(0);
  });

  it('flipping the toggle off prunes hidden ids out of the bulk selection (finding 2)', async () => {
    global.fetch = identitiesFetch(() => [REAL_AGENT, SYNTHETIC_AGENT]);
    const { default: Page } = await import('../../app/identities/page.jsx');
    render(<Page />);

    await screen.findByRole('heading', { name: 'Unidentified Agents' });

    // Reveal synthetic agents, then select both.
    fireEvent.click(screen.getByRole('switch', { name: 'Show test agents' }));
    await screen.findByText('test-cleanup-agent');

    fireEvent.click(screen.getByLabelText('Select prod-agent-1'));
    fireEvent.click(screen.getByLabelText('Select test-cleanup-agent'));
    await screen.findByText('2 selected');

    // Hide synthetic agents again — the synthetic id must drop out of the
    // selection, not just out of the DOM.
    fireEvent.click(screen.getByRole('switch', { name: 'Show test agents' }));
    await waitFor(() => {
      expect(screen.queryByText('test-cleanup-agent')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByText('1 selected')).toBeTruthy();
    });
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('cleanup removing synthetic agents prunes them from the selection too (minor finding)', async () => {
    let fleet = [REAL_AGENT, SYNTHETIC_AGENT];
    const fetchMock = identitiesFetch(() => fleet);
    global.fetch = vi.fn(async (url, opts = {}) => {
      if (String(url).startsWith('/api/actions?synthetic=true') && (opts.method || 'GET') === 'DELETE') {
        fleet = [REAL_AGENT]; // simulate the sweep removing the synthetic agent
      }
      return fetchMock(url, opts);
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { default: Page } = await import('../../app/identities/page.jsx');
    render(<Page />);

    await screen.findByRole('heading', { name: 'Unidentified Agents' });
    fireEvent.click(screen.getByRole('switch', { name: 'Show test agents' }));
    await screen.findByText('test-cleanup-agent');

    fireEvent.click(screen.getByLabelText('Select prod-agent-1'));
    fireEvent.click(screen.getByLabelText('Select test-cleanup-agent'));
    await screen.findByText('2 selected');

    fireEvent.click(screen.getByRole('button', { name: /Clean up test agents/ }));

    await waitFor(() => {
      expect(screen.queryByText('test-cleanup-agent')).toBeNull();
    });
    // The pruning effect (keyed on the visible row set) already covers this:
    // once the synthetic agent is gone from `unidentified` entirely, it's
    // gone from `unidentifiedControls.rows` too, so it's pruned from the
    // selection with no extra code needed in handleCleanupTestAgents.
    await waitFor(() => {
      expect(screen.getByText('1 selected')).toBeTruthy();
    });
  });

  // REGRESSION (C2, final-fix wave): the approved-identities list is
  // searchable, but `selection` (unlike `unidentifiedSelection`) had no
  // pruning effect and handleBulkRevoke trusted the raw selectedIds — a
  // search-hidden identity that was selected before narrowing the search
  // would still be revoked. Both the pruning effect and the call-time
  // intersection with visible rows must hold this shut.
  it('a search-hidden approved identity is not revoked by bulk revoke (finding C2)', async () => {
    const REAL_IDENTITY = { agent_id: 'prod-identity-1', agent_name: null, permission_level: 'readonly', created_at: null };
    const HIDDEN_IDENTITY = { agent_id: 'test-identity-1', agent_name: null, permission_level: 'readonly', created_at: null };
    const deletedIds = [];
    global.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      const method = opts.method || 'GET';
      if (u.startsWith('/api/pairings?')) {
        return { ok: true, status: 200, json: async () => ({ pairings: [] }) };
      }
      if (u.startsWith('/api/identities/') && method === 'DELETE') {
        deletedIds.push(decodeURIComponent(u.split('/api/identities/')[1]));
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (u.startsWith('/api/identities')) {
        return { ok: true, status: 200, json: async () => ({ identities: [REAL_IDENTITY, HIDDEN_IDENTITY] }) };
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
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { default: Page } = await import('../../app/identities/page.jsx');
    render(<Page />);

    await screen.findByRole('heading', { name: 'Approved Identities' });

    fireEvent.click(screen.getByLabelText('Select prod-identity-1'));
    fireEvent.click(screen.getByLabelText('Select test-identity-1'));
    await screen.findByText('2 selected');

    // Narrow the visible list to just the real identity via search.
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'prod-identity' } });
    await waitFor(() => {
      expect(screen.queryByLabelText('Select test-identity-1')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByText('1 selected')).toBeTruthy();
    });

    const bulkBar = screen.getByRole('region', { name: 'Bulk actions' });
    fireEvent.click(within(bulkBar).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(deletedIds).toContain('prod-identity-1');
    });
    expect(deletedIds).not.toContain('test-identity-1');
  });
});
