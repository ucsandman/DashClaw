import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

// Render coverage for /spend/x402 (app/spend/x402/page.tsx): provider_name is
// the primary label with the raw prov_ id demoted to a title attribute; rows
// without a joined name fall back to the mono id, then '—'; failed loads show
// the error + Retry pattern instead of masquerading as the empty state.

vi.mock('@/components/PageLayout', () => ({
  default: ({ title, children }) => (
    <div>
      <h1>{title}</h1>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import X402PurchasesPage from '@/spend/x402/page';

const PURCHASES = [
  {
    action_id: 'act_1',
    provider_id: 'prov_a5ea64e0',
    provider_name: 'stableenrich.dev',
    agent_id: 'agent-1',
    spend_amount: 0.05,
    currency: 'USDC',
    execution_status: 'succeeded',
    purchase_reason: 'enrich lead',
    created_at: '2026-06-01T12:00:00Z',
  },
  {
    action_id: 'act_2',
    provider_id: 'prov_no_name',
    provider_name: null,
    agent_id: null,
    spend_amount: 0.01,
    currency: 'USDC',
    execution_status: 'pending',
    purchase_reason: null,
    created_at: '2026-06-02T12:00:00Z',
  },
  {
    action_id: 'act_3',
    provider_id: null,
    provider_name: null,
    agent_id: 'agent-2',
    spend_amount: 0.02,
    currency: 'USDC',
    execution_status: 'failed',
    purchase_reason: null,
    created_at: null,
  },
];

describe('/spend/x402 purchases page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders provider_name primary with the raw id as hover title, mono id fallback, then —', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ purchases: PURCHASES }),
    }));

    const { container } = render(<X402PurchasesPage />);
    await waitFor(() => {
      expect(container.textContent).toContain('stableenrich.dev');
    });

    // Named provider: human name primary, prov_ id demoted to title attr, not mono.
    const named = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent === 'stableenrich.dev'
    );
    expect(named).toBeTruthy();
    expect(named.getAttribute('title')).toBe('prov_a5ea64e0');
    expect(named.className).not.toContain('font-mono');

    // No joined name: raw id rendered as mono fallback.
    const fallback = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent === 'prov_no_name'
    );
    expect(fallback).toBeTruthy();
    expect(fallback.className).toContain('font-mono');

    // Null provider entirely: em dash.
    expect(container.textContent).toContain('—');

    // Agent cell is tagged via EntityLink; the agent detail page was removed in
    // the v5 cull, so it renders as a tagged span rather than an anchor.
    const agentLink = container.querySelector('[data-entity-id="agent-1"]');
    expect(agentLink).toBeTruthy();
    expect(agentLink.getAttribute('data-entity-type')).toBe('agent');
  });

  it('shows error + Retry on failed load (not the empty state), and retries', async () => {
    // URL-aware: the page mounts X402BudgetMeters, whose /api/x402/budget
    // fetch must not consume the purchases failure from a call-count queue.
    let purchaseCalls = 0;
    global.fetch = vi.fn(async (input) => {
      if (String(input).includes('/api/x402/budget')) {
        return { ok: true, status: 200, json: async () => ({ budgets: [] }) };
      }
      purchaseCalls += 1;
      if (purchaseCalls === 1) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ purchases: PURCHASES }) };
    });

    const { container } = render(<X402PurchasesPage />);
    await waitFor(() => {
      expect(container.textContent).toContain('Failed to load purchases.');
    });
    expect(container.textContent).not.toContain('No governed purchases yet.');

    const retry = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Retry'
    );
    expect(retry).toBeTruthy();
    fireEvent.click(retry);

    await waitFor(() => {
      expect(container.textContent).toContain('stableenrich.dev');
    });
  });

  it('renders the empty state only for a genuinely empty OK response', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ purchases: [] }),
    }));

    const { container } = render(<X402PurchasesPage />);
    await waitFor(() => {
      expect(container.textContent).toContain('No governed purchases yet.');
    });
  });
});
