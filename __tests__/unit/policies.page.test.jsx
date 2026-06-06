import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' } } }),
}));

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children }) => (
    <div>
      <h1>{title}</h1>
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

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: ({ className }) => <div data-testid="skeleton" className={className} />,
}));

vi.mock('@/components/ui/Stat', () => ({
  StatCompact: ({ label, value }) => (
    <div><span>{label}</span><span>{value}</span></div>
  ),
}));

vi.mock('@/components/ui/EmptyState', () => ({
  EmptyState: ({ title }) => <div>{title}</div>,
}));

vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: () => {},
}));

vi.mock('@/lib/isDemoMode', () => ({
  isDemoMode: () => false,
}));

describe('PoliciesPage', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/policies') {
        return {
          ok: true,
          json: async () => ({
            policies: [
              {
                id: 'pol_1',
                name: 'Deploy Gate',
                policy_type: 'require_approval',
                rules: JSON.stringify({ action_types: ['deploy', 'migrate'], _shield: 'deploy_gate' }),
                active: 1,
                agent_ids: null,
              },
            ],
          }),
        };
      }

      if (String(url).startsWith('/api/guard/decisions')) {
        return {
          ok: true,
          json: async () => ({
            decisions: [],
            total: 0,
            stats: { blocks: 3, approvals: 1, warns: 2 },
          }),
        };
      }

      if (String(url) === '/api/agents') {
        return {
          ok: true,
          json: async () => ({ agents: [{ agent_id: 'agent_1', agent_name: 'Bot' }] }),
        };
      }

      if (String(url) === '/api/policies' && arguments[1]?.method) {
        return { ok: true, json: async () => ({ policy: { id: 'pol_new' } }) };
      }

      return { ok: true, json: async () => ({}) };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders shield cards on the Shields tab', async () => {
    const { default: PoliciesPage } = await import('@/policies/page.jsx');
    render(<PoliciesPage />);

    // Page title
    expect(screen.getByText('Policies')).toBeTruthy();

    // Tabs exist (Modes is the new first/default tab)
    expect(screen.getByText('Modes')).toBeTruthy();
    expect(screen.getByText('Shields')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText('Activity')).toBeTruthy();

    // Switch to Shields, then shield cards render (wait for fetch)
    fireEvent.click(screen.getByText('Shields'));
    expect(await screen.findByText('Deploy Gate')).toBeTruthy();
    expect(screen.getByText('High Risk Review')).toBeTruthy();
    expect(screen.getByText('Critical Risk Block')).toBeTruthy();
    expect(screen.getByText('Rate Limiter')).toBeTruthy();
  });

  it('shows stats bar with counts', async () => {
    const { default: PoliciesPage } = await import('@/policies/page.jsx');
    render(<PoliciesPage />);

    // Wait for stats to load
    await waitFor(() => {
      expect(screen.getByText('active shields').closest('span').textContent).toContain('1');
    });
  });

  it('switches between tabs', async () => {
    const { default: PoliciesPage } = await import('@/policies/page.jsx');
    render(<PoliciesPage />);

    // Switch to Shields tab → shield cards
    fireEvent.click(screen.getByText('Shields'));
    expect(await screen.findByText('Deploy Gate')).toBeTruthy();

    // Switch to Activity tab
    fireEvent.click(screen.getByText('Activity'));

    // Activity tab shows decision filter
    await waitFor(() => {
      expect(screen.getByDisplayValue('All decisions')).toBeTruthy();
    });
  });
});
