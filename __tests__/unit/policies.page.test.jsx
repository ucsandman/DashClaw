import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// PageLayout is chrome; render only its children + title.
vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children }) => (
    <div><h1>{title}</h1><div>{children}</div></div>
  ),
}));

vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: ({ className }) => <div data-testid="skeleton" className={className} />,
}));

// The two state branches are exercised in their own suites; here we only assert
// the page routes to the correct one based on whether any policy is active.
vi.mock('@/policies/components/PolicyFrontDoor', () => ({
  default: () => <div data-testid="front-door">front door</div>,
}));
vi.mock('@/policies/components/PolicyConsole', () => ({
  default: ({ policies }) => <div data-testid="console">console:{policies.length}</div>,
}));

function mockPolicies(policies) {
  global.fetch = vi.fn(async (url) => {
    if (String(url) === '/api/policies') {
      return { ok: true, json: async () => ({ policies }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('PoliciesPage routing', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows the guided front door when no policy is active', async () => {
    mockPolicies([]);
    const { default: PoliciesPage } = await import('@/policies/page.jsx');
    render(<PoliciesPage />);

    expect(await screen.findByTestId('front-door')).toBeTruthy();
    expect(screen.queryByTestId('console')).toBeNull();
    // The deleted flat tab bar: the page itself no longer renders co-equal tabs.
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('treats inactive-only policies as the zero state', async () => {
    mockPolicies([{ id: 'p1', name: 'x', policy_type: 'block', rules: '{}', active: 0, agent_ids: null }]);
    const { default: PoliciesPage } = await import('@/policies/page.jsx');
    render(<PoliciesPage />);

    expect(await screen.findByTestId('front-door')).toBeTruthy();
  });

  it('shows the governance console when a policy is active', async () => {
    mockPolicies([
      { id: 'p1', name: '[Claude Code Mode] Block', policy_type: 'risk_threshold', rules: '{"_mode":"claude-code"}', active: 1, agent_ids: null },
    ]);
    const { default: PoliciesPage } = await import('@/policies/page.jsx');
    render(<PoliciesPage />);

    expect(await screen.findByTestId('console')).toBeTruthy();
    expect(screen.queryByTestId('front-door')).toBeNull();
  });

  it('renders the page title', async () => {
    mockPolicies([]);
    const { default: PoliciesPage } = await import('@/policies/page.jsx');
    render(<PoliciesPage />);
    await waitFor(() => expect(screen.getByText('Policies')).toBeTruthy());
  });
});
