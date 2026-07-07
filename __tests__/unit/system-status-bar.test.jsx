import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/AgentFilterContext', () => ({ useAgentFilter: () => ({ agentId: null }) }));
vi.mock('@/hooks/useRealtime', () => ({ useRealtime: () => {} }));

import SystemStatusBar from '@/components/SystemStatusBar';

function mockSignals(signals) {
  global.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/signals')) return { ok: true, json: async () => ({ signals }) };
    return { ok: true, json: async () => ({}) };
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SystemStatusBar ticker', () => {
  it('renders Critical/Elevated as severity-filtered links', async () => {
    mockSignals([
      { severity: 'red', type: 't1', agent_id: 'a1' },
      { severity: 'amber', type: 't2', agent_id: 'a2' },
    ]);
    const { container } = render(<SystemStatusBar />);

    // The dedicated /security dashboard was removed in the v5 cull; both severity
    // tiers now deep-link to the decisions ledger, so the links are distinguished
    // by their label rather than a per-severity href.
    await waitFor(() => expect(container.querySelector('a[href="/decisions"]')).toBeTruthy());
    const links = Array.from(container.querySelectorAll('a[href="/decisions"]'));
    const red = links.find((a) => a.textContent.includes('Critical'));
    expect(red).toBeTruthy();
    const amber = links.find((a) => a.textContent.includes('Elevated'));
    expect(amber).toBeTruthy();
  });

  it('shows the All clear state with no severity links when there are no signals', async () => {
    mockSignals([]);
    const { container } = render(<SystemStatusBar />);

    await waitFor(() => expect(screen.getByText('All clear')).toBeTruthy());
    const links = Array.from(container.querySelectorAll('a[href="/decisions"]'));
    expect(links.some((a) => a.textContent.includes('Critical'))).toBe(false);
    expect(links.some((a) => a.textContent.includes('Elevated'))).toBe(false);
  });
});
