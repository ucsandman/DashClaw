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

    await waitFor(() => expect(container.querySelector('a[href="/security?severity=red"]')).toBeTruthy());
    const red = container.querySelector('a[href="/security?severity=red"]');
    expect(red.textContent).toContain('Critical');
    const amber = container.querySelector('a[href="/security?severity=amber"]');
    expect(amber).toBeTruthy();
    expect(amber.textContent).toContain('Elevated');
  });

  it('shows the All clear state with no severity links when there are no signals', async () => {
    mockSignals([]);
    const { container } = render(<SystemStatusBar />);

    await waitFor(() => expect(screen.getByText('All clear')).toBeTruthy());
    expect(container.querySelector('a[href="/security?severity=red"]')).toBeNull();
    expect(container.querySelector('a[href="/security?severity=amber"]')).toBeNull();
  });
});
