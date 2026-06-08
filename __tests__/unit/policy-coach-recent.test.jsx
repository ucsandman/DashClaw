import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/PageLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));
vi.mock('@/lib/AgentFilterContext', () => ({ useAgentFilter: () => ({ agentId: null }) }));

const { roleRef } = vi.hoisted(() => ({ roleRef: { current: { isAdmin: true } } }));
vi.mock('@/hooks/useEffectiveRole', () => ({ useEffectiveRole: () => roleRef.current }));

import PolicyCoachPage from '@/policy-coach/page';

function installFetch({ recorder, status, list }) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/behavior/recorder')) return { ok: true, json: async () => recorder };
    if (u.includes('list=')) return { ok: true, json: async () => ({ samples: list, count: list.length }) };
    if (u.includes('/api/behavior/samples')) return { ok: true, json: async () => status };
    if (u.includes('/api/behavior/suggestions')) return { ok: true, json: async () => ({ suggestions: [], agents: [], sample_count: status.sample_count }) };
    return { ok: true, json: async () => ({}) };
  });
}

beforeEach(() => { roleRef.current = { isAdmin: true }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Policy Coach — recent samples + live status', () => {
  it('renders the Recent samples panel with real fields and the live status strip', async () => {
    installFetch({
      recorder: { enabled: true, effective: true, until: '2026-06-14T00:00:00.000Z' },
      status: { sample_count: 5, agent_count: 1, newest_ts: '2026-06-07T00:00:00.000Z', dir: '/tmp/x', agents: [], ready: false, min_samples: 8 },
      list: [
        { event_id: 'e1', tool: 'Bash', command_shape: 'git push --force', risk_score: 80, guard_decision: 'warn', outcome_status: 'completed', ts: '2026-06-07T00:00:00.000Z', read_paths: [], write_paths: [] },
      ],
    });
    render(<PolicyCoachPage />);
    await waitFor(() => expect(screen.getByText('Recent samples')).toBeTruthy());
    expect(screen.getByText('git push --force')).toBeTruthy();
    // Live observability strip
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText(/Captured this session/)).toBeTruthy();
  });

  it('empty-state distinguishes recorder-off from on-but-empty', async () => {
    installFetch({
      recorder: { enabled: false, effective: false },
      status: { sample_count: 0, agent_count: 0, agents: [], ready: false, min_samples: 8 },
      list: [],
    });
    const { unmount } = render(<PolicyCoachPage />);
    await waitFor(() => expect(screen.getByText(/Recorder is off/)).toBeTruthy());
    unmount();
    cleanup();

    installFetch({
      recorder: { enabled: true, effective: true },
      status: { sample_count: 0, agent_count: 0, agents: [], ready: false, min_samples: 8 },
      list: [],
    });
    render(<PolicyCoachPage />);
    await waitFor(() => expect(screen.getByText(/nothing captured yet/i)).toBeTruthy());
  });
});
