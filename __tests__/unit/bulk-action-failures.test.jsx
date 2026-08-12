import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

/**
 * bulkAction() (app/lib/bulkAction.ts) always computes `failed`, but every
 * page-level call site destructured only `ok` and threw the failure count
 * away — an operator could select 10 pending actions, click Deny, have three
 * POSTs fail (403/409/network), and see the three rows just sit there with no
 * error, no toast, no count. The single-item path (handleDecision) already
 * alerts on failure; bulk silently dropped it. Pinned here for the hero
 * surface (/approvals) with a full render, and at a lighter level for the
 * other five call sites (api-keys, webhooks, assumptions, identities).
 */

vi.mock('@/components/PageLayout', () => ({
  default: ({ children, actions }) => (
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
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('@/lib/AgentFilterContext', () => ({ useAgentFilter: () => ({ agentId: null }) }));
vi.mock('@/components/ApprovalFloodBanner', () => ({ default: () => null }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NOW = '2026-06-01T00:00:00.000Z';

// ---------------------------------------------------------------------------
// /approvals — bulk Deny, partial failure (the hero surface)
// ---------------------------------------------------------------------------

const A = {
  action_id: 'act_a', agent_id: 'agent-aa', agent_name: null, declared_goal: 'Deploy to prod',
  action_type: 'deploy', risk_score: 80, status: 'pending_approval', timestamp_start: NOW, systems_touched: '[]',
};
const B = {
  action_id: 'act_b', agent_id: 'agent-bb', agent_name: null, declared_goal: 'Send the digest',
  action_type: 'message', risk_score: 20, status: 'pending_approval', timestamp_start: NOW, systems_touched: '[]',
};
const C = {
  action_id: 'act_c', agent_id: 'agent-cc', agent_name: null, declared_goal: 'Rotate secrets',
  action_type: 'infra', risk_score: 60, status: 'pending_approval', timestamp_start: NOW, systems_touched: '[]',
};

function makeApprovalsFetch() {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('status=pending_approval')) return { ok: true, json: async () => ({ actions: [A, B, C] }) };
    if (u.includes('status=expired')) return { ok: true, json: async () => ({ actions: [] }) };
    if (u.startsWith('/api/approvals/')) {
      // act_b fails (e.g. a 409 — someone else already resolved it).
      const failed = u.includes('act_b');
      return { ok: !failed, json: async () => (failed ? { error: 'Conflict' } : { success: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('/approvals — bulk Deny surfaces partial failure', () => {
  it('shows how many succeeded, how many failed, and that the failures are still pending', async () => {
    global.fetch = makeApprovalsFetch();
    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    await screen.findByText('Deploy to prod');
    expect(screen.getByText('Send the digest')).toBeTruthy();
    expect(screen.getByText('Rotate secrets')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Select all'));
    const actionsSlot = screen.getByTestId('actions');
    await waitFor(() => expect(within(actionsSlot).getByText('3 selected')).toBeTruthy());

    fireEvent.click(within(actionsSlot).getByText('Deny'));

    // The two clean denials disappear from the list...
    await waitFor(() => expect(screen.queryByText('Deploy to prod')).toBeNull());
    expect(screen.queryByText('Rotate secrets')).toBeNull();
    // ...but the failed one is untouched, still sitting in the pending queue.
    expect(screen.getByText('Send the digest')).toBeTruthy();

    // And the failure reaches the screen with real counts, not silence.
    expect(await screen.findByText(/bulk deny partially failed/i)).toBeTruthy();
    expect(screen.getByText(/2 of 3 actions denied/i)).toBeTruthy();
    expect(screen.getByText(/1 failed and remains pending/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// /api-keys — bulk Revoke, partial failure
// ---------------------------------------------------------------------------

describe('/api-keys — bulk Revoke surfaces partial failure', () => {
  it('reports the failure count in the page error banner', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      const method = init?.method || 'GET';
      if (u === '/api/keys' && method === 'GET') {
        return { ok: true, json: async () => ({ keys: [
          { id: 'key_1', label: 'Prod', role: 'member', created_at: NOW, last_used_at: null },
          { id: 'key_2', label: 'Staging', role: 'member', created_at: NOW, last_used_at: null },
        ] }) };
      }
      if (u.startsWith('/api/keys?id=') && method === 'DELETE') {
        const failed = u.includes('key_2');
        return { ok: !failed, json: async () => (failed ? { error: 'Conflict' } : { success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: ApiKeysPage } = await import('@/api-keys/page.jsx');
    render(<ApiKeysPage />);

    await screen.findByText('Prod');
    fireEvent.click(screen.getByLabelText('Select all'));
    const actionsSlot = screen.getByTestId('actions');
    await waitFor(() => expect(within(actionsSlot).getByText('2 selected')).toBeTruthy());

    fireEvent.click(within(actionsSlot).getByText('Revoke'));

    await waitFor(() => expect(screen.queryByText('Prod')).toBeNull());
    expect(screen.getByText('Staging')).toBeTruthy();
    expect(await screen.findByText(/revoked 1 of 2 keys\. 1 failed/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// /webhooks — bulk Delete, partial failure
// ---------------------------------------------------------------------------

describe('/webhooks — bulk Delete surfaces partial failure', () => {
  it('reports the failure count in the page error banner', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      const method = init?.method || 'GET';
      if (u === '/api/webhooks' && method === 'GET') {
        return { ok: true, json: async () => ({ webhooks: [
          { id: 'wh_1', url: 'https://hooks.example.com/one', events: '["all"]', active: true, failure_count: 0, created_at: NOW, last_triggered_at: null },
          { id: 'wh_2', url: 'https://hooks.example.com/two', events: '["all"]', active: true, failure_count: 0, created_at: NOW, last_triggered_at: null },
        ] }) };
      }
      if (u.startsWith('/api/webhooks?id=') && method === 'DELETE') {
        const failed = u.includes('wh_2');
        return { ok: !failed, json: async () => (failed ? { error: 'Conflict' } : { success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: WebhooksPage } = await import('@/webhooks/page.jsx');
    render(<WebhooksPage />);

    await screen.findByText('https://hooks.example.com/one');
    fireEvent.click(screen.getByLabelText('Select all'));
    const actionsSlot = screen.getByTestId('actions');
    await waitFor(() => expect(within(actionsSlot).getByText('2 selected')).toBeTruthy());

    fireEvent.click(within(actionsSlot).getByText('Delete'));

    await waitFor(() => expect(screen.queryByText('https://hooks.example.com/one')).toBeNull());
    expect(screen.getByText('https://hooks.example.com/two')).toBeTruthy();
    expect(await screen.findByText(/deleted 1 of 2 webhooks\. 1 failed/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// /assumptions — bulk Validate, partial failure
// ---------------------------------------------------------------------------

describe('/assumptions — bulk Validate surfaces partial failure', () => {
  it('reports the failure count in a page-level error banner', async () => {
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      const method = init?.method || 'GET';
      if (u.startsWith('/api/actions/assumptions')) {
        return { ok: true, json: async () => ({
          assumptions: [
            { assumption_id: 'as_1', agent_id: 'agent-aa', assumption: 'The API key is valid', validated: 0, invalidated: 0, created_at: NOW },
            { assumption_id: 'as_2', agent_id: 'agent-bb', assumption: 'The bucket exists', validated: 0, invalidated: 0, created_at: NOW },
          ],
          total: 2,
        }) };
      }
      if (u.startsWith('/api/assumptions/') && method === 'PATCH') {
        const failed = u.includes('as_2');
        return { ok: !failed, json: async () => (failed ? { error: 'Conflict' } : { success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: AssumptionsPage } = await import('@/assumptions/page.jsx');
    render(<AssumptionsPage />);

    await screen.findByText('The API key is valid');
    fireEvent.click(screen.getByLabelText('Select all'));
    const actionsSlot = screen.getByTestId('actions');
    await waitFor(() => expect(within(actionsSlot).getByText('2 selected')).toBeTruthy());

    fireEvent.click(within(actionsSlot).getByText('Validate'));

    expect(await screen.findByText(/validated 1 of 2 assumptions\. 1 failed/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// /identities — bulk Revoke, partial failure
// ---------------------------------------------------------------------------

describe('/identities — bulk Revoke surfaces partial failure', () => {
  it('reports the failure count in the page error banner', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    global.fetch = vi.fn(async (url, init) => {
      const u = String(url);
      const method = init?.method || 'GET';
      if (u.startsWith('/api/identities') && method === 'GET') {
        return { ok: true, json: async () => ({ identities: [
          { agent_id: 'agent-aa', agent_name: 'Agent A', permission_level: 'readonly', created_at: NOW },
          { agent_id: 'agent-bb', agent_name: 'Agent B', permission_level: 'readonly', created_at: NOW },
        ] }) };
      }
      if (u.startsWith('/api/identities/') && method === 'DELETE') {
        const failed = u.includes('agent-bb');
        return { ok: !failed, json: async () => (failed ? { error: 'Conflict' } : { success: true }) };
      }
      if (u.startsWith('/api/pairings')) return { ok: true, json: async () => ({ pairings: [] }) };
      if (u.startsWith('/api/settings')) return { ok: true, json: async () => ({ settings: [] }) };
      if (u.startsWith('/api/agents')) return { ok: true, json: async () => ({ agents: [] }) };
      if (u.startsWith('/api/messages')) return { ok: true, json: async () => ({ messages: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    const { default: IdentitiesPage } = await import('@/identities/page.jsx');
    render(<IdentitiesPage />);

    await screen.findByText('Agent A');
    fireEvent.click(screen.getByLabelText('Select all'));
    const actionsSlot = screen.getByTestId('actions');
    await waitFor(() => expect(within(actionsSlot).getByText('2 selected')).toBeTruthy());

    fireEvent.click(within(actionsSlot).getByText('Revoke'));

    expect(await screen.findByText(/revoked 1 of 2 identity\(s\)\. 1 failed/i)).toBeTruthy();
  });
});
