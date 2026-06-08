import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the SSE callback the store registers; stub the shared hook so no real
// EventSource opens.
let realtimeCb = null;
vi.mock('@/hooks/useRealtime', () => ({
  useRealtime: (cb) => {
    realtimeCb = cb;
  },
}));

import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useMissionData } from '@/mission-control/lib/useMissionData';

let feedCalls = 0;
function bodyFor(u) {
  if (u.includes('/api/operations/feed')) return { items: [], counts: {} };
  if (u.includes('/api/operations/summary')) return {};
  if (u.includes('/api/actions/stats')) return {};
  if (u.includes('/api/actions')) return { actions: [] };
  if (u.includes('/api/capabilities/health')) return { capabilities: [] };
  if (u.includes('/api/signals')) return { signals: [] };
  if (u.includes('/api/actions/loops')) return { loops: [] };
  return {};
}

beforeEach(() => {
  realtimeCb = null;
  feedCalls = 0;
  global.fetch = vi.fn((url) => {
    const u = String(url);
    if (u.includes('/api/operations/feed')) feedCalls++;
    return Promise.resolve({ ok: true, json: async () => bodyFor(u) });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useMissionData — coordinated store', () => {
  it('fetches one coordinated wave on mount (single feed fetch, not three pollers)', async () => {
    renderHook(() => useMissionData(null));
    await waitFor(() => expect(feedCalls).toBe(1));
  });

  it('coalesces an SSE burst into ONE debounced reconcile (no per-event fetch storm)', async () => {
    renderHook(() => useMissionData(null));
    await waitFor(() => expect(feedCalls).toBe(1));
    expect(typeof realtimeCb).toBe('function');

    // Fire 5 relevant events inside the debounce window.
    await act(async () => {
      for (let i = 0; i < 5; i++) realtimeCb('action.created', {});
    });
    // After the 750ms debounce, exactly ONE reconcile fires → 2 feed fetches total, not 6.
    await waitFor(() => expect(feedCalls).toBe(2), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(feedCalls).toBe(2);
  });

  it('ignores irrelevant SSE events (no reconcile)', async () => {
    renderHook(() => useMissionData(null));
    await waitFor(() => expect(feedCalls).toBe(1));
    await act(async () => {
      realtimeCb('token.usage', {});
    });
    await new Promise((r) => setTimeout(r, 900));
    expect(feedCalls).toBe(1);
  });

  it('exposes a refresh that triggers a coordinated refetch', async () => {
    const { result } = renderHook(() => useMissionData(null));
    await waitFor(() => expect(feedCalls).toBe(1));
    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(feedCalls).toBe(2));
  });
});
