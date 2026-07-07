import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// BUG-03b regression: /approvals treats the response of /api/session/effective
// (which unifies NextAuth + local-session auth) as the source of truth for
// admin detection. These tests pin that contract and the settled-before-banner
// hydration behavior.

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children, actions }) => (
    <div>
      <h1>{title}</h1>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }) => <div>{children}</div>,
  CardContent: ({ children }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title, description }) => (
    <div><div>{title}</div><div>{description}</div></div>
  ),
}));

vi.mock('@/lib/isDemoMode', () => ({
  isDemoMode: () => false,
}));

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => {},
}));

// Global agent picker — controllable per test (default: All agents).
const agentFilterState = vi.hoisted(() => ({ agentId: null }));
vi.mock('@/lib/AgentFilterContext', () => ({
  useAgentFilter: () => ({ agentId: agentFilterState.agentId }),
}));
vi.mock('@/components/ApprovalFloodBanner', () => ({ default: () => null }));

const READ_ONLY_TEXT = /Only administrators can approve or deny actions/i;

function makeFetch({ effective }) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/api/actions')) {
      return { ok: true, json: async () => ({ actions: [] }) };
    }
    if (u === '/api/session/effective') {
      if (effective === 'ERROR') {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({
          authenticated: !!effective,
          authType: effective?.authType || null,
          role: effective?.role ?? null,
          isAdmin: effective?.role === 'admin',
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('ApprovalsPage — session resolution', () => {
  beforeEach(() => {
    // Each test sets its own fetch; start clean.
    global.fetch = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not flash the read-only banner before session is settled', async () => {
    // Keep fetch pending so neither fetchPending nor /api/session/effective
    // resolves — sessionSettled must remain false and the banner must stay
    // hidden during the hydration window.
    global.fetch = vi.fn(() => new Promise(() => {}));

    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    expect(screen.queryByText(READ_ONLY_TEXT)).toBeNull();
  });

  it('hides the read-only banner for a NextAuth admin', async () => {
    global.fetch = makeFetch({ effective: { role: 'admin', authType: 'nextauth' } });

    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    // Wait for the empty state to confirm the page settled.
    await waitFor(() => expect(screen.getByText('All clear')).toBeTruthy());
    expect(screen.queryByText(READ_ONLY_TEXT)).toBeNull();
  });

  it('hides the read-only banner for a local-password admin (BUG-03b)', async () => {
    global.fetch = makeFetch({ effective: { role: 'admin', authType: 'local' } });

    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    await waitFor(() => expect(screen.getByText('All clear')).toBeTruthy());
    expect(screen.queryByText(READ_ONLY_TEXT)).toBeNull();
  });

  it('shows the read-only banner for a non-admin member', async () => {
    global.fetch = makeFetch({ effective: { role: 'member', authType: 'nextauth' } });

    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    await waitFor(() => expect(screen.getByText(READ_ONLY_TEXT)).toBeTruthy());
  });

  it('shows the read-only banner when /api/session/effective fails', async () => {
    global.fetch = makeFetch({ effective: 'ERROR' });

    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    await waitFor(() => expect(screen.getByText(READ_ONLY_TEXT)).toBeTruthy());
  });

  it('renders the agent and action_id as EntityLinks to their destinations', async () => {
    const PENDING = {
      action_id: 'act_77', agent_id: 'agent_aa', agent_name: 'planner',
      declared_goal: 'Deploy to prod', action_type: 'deploy', risk_score: 80,
      status: 'pending_approval', timestamp_start: '2026-06-01T00:00:00.000Z', systems_touched: '[]',
    };
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      // The page fetches both lists; only the pending one carries this row —
      // matching startsWith('/api/actions') alone would render it twice.
      if (u.includes('status=pending_approval')) return { ok: true, json: async () => ({ actions: [PENDING] }) };
      if (u.includes('status=expired')) return { ok: true, json: async () => ({ actions: [] }) };
      if (u === '/api/session/effective') {
        return { ok: true, json: async () => ({ authenticated: true, authType: 'local', role: 'admin', isAdmin: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    // The agent detail page was removed in the v5 cull; EntityLink renders the
    // agent as a tagged span (context-menu Copy ID) rather than an anchor.
    const agentLink = await screen.findByText('planner');
    expect(agentLink.tagName).toBe('SPAN');
    expect(agentLink.getAttribute('href')).toBeNull();
    expect(agentLink.getAttribute('data-entity-type')).toBe('agent');

    const actionLink = screen.getByText('act_77');
    expect(actionLink.tagName).toBe('A');
    expect(actionLink.getAttribute('href')).toBe('/decisions/act_77');
    expect(actionLink.getAttribute('data-entity-type')).toBe('decision');
  });

  it('appends agent_id to the pending-actions fetch when the global picker has a selection', async () => {
    agentFilterState.agentId = 'agent-9';
    try {
      global.fetch = makeFetch({ effective: { role: 'admin', authType: 'local' } });

      const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
      render(<ApprovalsPage />);

      await waitFor(() => {
        const actionCalls = global.fetch.mock.calls
          .map((c) => String(c[0]))
          .filter((u) => u.startsWith('/api/actions'));
        expect(actionCalls.length).toBeGreaterThan(0);
        expect(actionCalls[0]).toContain('status=pending_approval');
        expect(actionCalls[0]).toContain('agent_id=agent-9');
      });
    } finally {
      agentFilterState.agentId = null;
    }
  });

  // Act-content grant binding (drizzle/0056): an act-stamped pending row shows
  // the approver that the approval is pinned to the exact recorded act.
  it('shows the Act-bound badge only on act-stamped pending rows', async () => {
    const STAMPED = {
      action_id: 'act_bound_1', agent_id: 'agent_aa', agent_name: 'planner',
      declared_goal: 'Deploy to prod', action_type: 'deploy', risk_score: 80,
      status: 'pending_approval', timestamp_start: '2026-06-01T00:00:00.000Z', systems_touched: '[]',
      act_content_hash: 'sha256:abc123',
    };
    const UNSTAMPED = {
      action_id: 'act_plain_1', agent_id: 'agent_bb', agent_name: 'researcher',
      declared_goal: 'Send the digest', action_type: 'message', risk_score: 60,
      status: 'pending_approval', timestamp_start: '2026-06-01T00:00:00.000Z', systems_touched: '[]',
    };
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('status=pending_approval')) return { ok: true, json: async () => ({ actions: [STAMPED, UNSTAMPED] }) };
      if (u.includes('status=expired')) return { ok: true, json: async () => ({ actions: [] }) };
      if (u === '/api/session/effective') {
        return { ok: true, json: async () => ({ authenticated: true, authType: 'local', role: 'admin', isAdmin: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    await screen.findByText('Deploy to prod');
    expect(screen.getByText('Send the digest')).toBeTruthy();
    // Exactly one badge — the stamped row's; the plain row renders none.
    expect(screen.getAllByText('Act-bound').length).toBe(1);
  });

  it('renders expired approvals in a distinct non-approvable section (roadmap v2.3)', async () => {
    const EXPIRED = {
      action_id: 'act_exp', agent_id: 'agent_bb', agent_name: 'researcher',
      declared_goal: 'Buy dataset access', action_type: 'x402_purchase', risk_score: 60,
      status: 'expired', timestamp_start: '2026-06-01T00:00:00.000Z', systems_touched: '[]',
    };
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('status=pending_approval')) return { ok: true, json: async () => ({ actions: [] }) };
      if (u.includes('status=expired')) return { ok: true, json: async () => ({ actions: [EXPIRED] }) };
      if (u === '/api/session/effective') {
        return { ok: true, json: async () => ({ authenticated: true, authType: 'local', role: 'admin', isAdmin: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { default: ApprovalsPage } = await import('@/approvals/page.jsx');
    render(<ApprovalsPage />);

    await screen.findByText('Buy dataset access');
    // Section is explanatory and non-approvable: badge + copy, no buttons.
    // Both the section header and the row badge say "Expired".
    expect(screen.getAllByText('Expired').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/approving them\s+would release nothing/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /allow/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /deny/i })).toBeNull();
  });
});
