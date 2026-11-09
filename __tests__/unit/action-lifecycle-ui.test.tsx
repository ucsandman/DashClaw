import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ACTION_STATES, ACTION_STATE_LABELS } from '../../app/lib/action-lifecycle';

// Operator surfaces of the action lifecycle state machine: /approvals decision
// buttons follow nextStates(status, 'user'), a failed decision shows the
// server's reason, and the /decisions status filter is the table's state list
// with its labels.

const nav = vi.hoisted(() => ({ search: '' }));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }: { title?: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));
vi.mock('@/components/ApprovalFloodBanner', () => ({ default: () => null }));
vi.mock('@/components/OutcomeBadge', () => ({ OutcomeBadge: () => null }));
vi.mock('@/lib/isDemoMode', () => ({ isDemoMode: () => false }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));
vi.mock('@/lib/AgentFilterContext', () => ({ useAgentFilter: () => ({ agentId: null }) }));

type FetchInit = { method?: string; body?: string } | undefined;
type FakeResponse = { ok: boolean; status?: number; json: () => Promise<unknown> };

const ADMIN_SESSION = { authenticated: true, authType: 'local', role: 'admin', isAdmin: true };

function row(action_id: string, status: string, declared_goal: string) {
  return {
    action_id, agent_id: 'agent_aa', agent_name: 'planner', declared_goal, action_type: 'deploy',
    risk_score: 40, status, timestamp_start: '2026-06-01T00:00:00.000Z', systems_touched: '[]',
  };
}

function approvalsFetch(pending: unknown[], onDecision?: (url: string, init: FetchInit) => FakeResponse) {
  return vi.fn(async (url: string, init?: FetchInit): Promise<FakeResponse> => {
    const u = String(url);
    if (u.startsWith('/api/approvals/') && init?.method === 'POST' && onDecision) return onDecision(u, init);
    if (u.includes('status=pending_approval')) return { ok: true, json: async () => ({ actions: pending }) };
    if (u.includes('status=expired')) return { ok: true, json: async () => ({ actions: [] }) };
    if (u === '/api/session/effective') return { ok: true, json: async () => ADMIN_SESSION };
    return { ok: true, json: async () => ({}) };
  });
}

function card(actionId: string): HTMLElement {
  const el = document.querySelector(`[data-entity-id="${actionId}"]`);
  if (!el) throw new Error(`card ${actionId} not rendered`);
  return el as HTMLElement;
}

describe('/approvals decision buttons follow the lifecycle table', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders Allow, Don\'t ask again and Deny only on the pending_approval card', async () => {
    vi.stubGlobal('fetch', approvalsFetch([
      row('act_pend', 'pending_approval', 'Deploy the hotfix'),
      row('act_run', 'running', 'Rotate the keys'),
    ]));
    const { default: ApprovalsPage } = await import('../../app/approvals/page');
    render(<ApprovalsPage />);

    await screen.findByText('Deploy the hotfix');
    await screen.findByText('Rotate the keys');

    const pending = within(card('act_pend'));
    expect(pending.getByRole('button', { name: /allow/i })).toBeTruthy();
    expect(pending.getByRole('button', { name: /deny/i })).toBeTruthy();
    expect(pending.getByRole('button', { name: /don.t ask again/i })).toBeTruthy();

    const running = within(card('act_run'));
    expect(running.queryByRole('button', { name: /allow/i })).toBeNull();
    expect(running.queryByRole('button', { name: /deny/i })).toBeNull();
    expect(running.queryByRole('button', { name: /don.t ask again/i })).toBeNull();
    expect(running.getByText(/now running; nothing to decide/i)).toBeTruthy();
  });

  it("a 410 answer shows the server's error text, not a generic failure", async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const fetchMock = approvalsFetch([row('act_pend', 'pending_approval', 'Deploy the hotfix')], () => ({
      ok: false,
      status: 410,
      json: async () => ({ error: 'Approval expired: the requesting agent stopped waiting', code: 'APPROVAL_EXPIRED' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { default: ApprovalsPage } = await import('../../app/approvals/page');
    render(<ApprovalsPage />);

    await screen.findByText('Deploy the hotfix');
    const allow = within(card('act_pend')).getByRole('button', { name: /allow/i }) as HTMLButtonElement;
    await waitFor(() => expect(allow.disabled).toBe(false));
    fireEvent.click(allow);

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const message = String(alertSpy.mock.calls[0]?.[0]);
    expect(message).toContain('Approval expired: the requesting agent stopped waiting');
    expect(message).toContain('APPROVAL_EXPIRED');
    expect(message).not.toContain('Failed to submit decision');
  });
});

describe('/decisions status filter is the lifecycle state list', () => {
  beforeEach(() => {
    nav.search = '';
    window.history.replaceState(null, '', '/decisions');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ actions: [], stats: {}, total: 0 }) })));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('offers every state, labelled from ACTION_STATE_LABELS, including expired', async () => {
    const { default: DecisionsPage } = await import('../../app/decisions/page');
    render(<DecisionsPage />);
    const select = (await screen.findByLabelText('Filter by status')) as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options.map((o) => o.value)).toEqual(['', ...ACTION_STATES]);
    for (const state of ACTION_STATES) {
      expect(options.find((o) => o.value === state)?.textContent).toBe(ACTION_STATE_LABELS[state]);
    }
    expect(options.map((o) => o.value)).toContain('expired');
  });
});
