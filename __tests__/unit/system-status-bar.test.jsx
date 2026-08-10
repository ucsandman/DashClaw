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
  global.fetch = vi.fn(async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST') return { ok: true, json: async () => ({ dismissed: 0 }) };
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

    // Each tier deep-links to the decisions ledger seeded with its severity,
    // so clicking "N Critical" lands on exactly those N signals in the
    // GovernanceSignalsPanel (see SEVERITY_ROUTE).
    await waitFor(() => expect(container.querySelector('a[href="/decisions?severity=red"]')).toBeTruthy());
    const red = container.querySelector('a[href="/decisions?severity=red"]');
    expect(red.textContent).toContain('Critical');
    const amber = container.querySelector('a[href="/decisions?severity=amber"]');
    expect(amber.textContent).toContain('Elevated');
  });

  it('shows the All clear state with no severity links when there are no signals', async () => {
    mockSignals([]);
    const { container } = render(<SystemStatusBar />);

    await waitFor(() => expect(screen.getByText('All clear')).toBeTruthy());
    const links = Array.from(container.querySelectorAll('a[href="/decisions"]'));
    expect(links.some((a) => a.textContent.includes('Critical'))).toBe(false);
    expect(links.some((a) => a.textContent.includes('Elevated'))).toBe(false);
  });

  it('migrates a legacy localStorage dismissed set to the server once', async () => {
    localStorage.setItem('dashclaw_dismissed_signals', JSON.stringify(['k1', 'k2']));
    mockSignals([]);
    render(<SystemStatusBar />);

    await waitFor(() => {
      const post = global.fetch.mock.calls.find(([, opts]) => opts?.method === 'POST');
      expect(post).toBeTruthy();
      expect(post[0]).toBe('/api/signals');
      expect(JSON.parse(post[1].body).dismiss_keys).toEqual(['k1', 'k2']);
    });
    // The local copy is gone — the server set is now the only source of truth.
    await waitFor(() => expect(localStorage.getItem('dashclaw_dismissed_signals')).toBeNull());
  });

  it('does not POST a migration when there is no legacy local set', async () => {
    mockSignals([]);
    render(<SystemStatusBar />);
    await waitFor(() => expect(screen.getByText('All clear')).toBeTruthy());
    expect(global.fetch.mock.calls.some(([, opts]) => opts?.method === 'POST')).toBe(false);
  });
});
