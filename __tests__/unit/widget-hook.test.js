import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the realtime callback the hook registers, and stub the shared hook so
// we don't open a real EventSource (and don't need useEffectiveRole).
let realtimeCb = null;
vi.mock('@/hooks/useRealtime.js', () => ({
  useRealtime: (cb) => {
    realtimeCb = cb;
  },
}));

import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useWidgetSummary } from '@/widget/useWidgetSummary.js';

const summary = {
  status: 'calm',
  generatedAt: '2026-06-06T12:00:00.000Z',
  metrics: { activeAgents: 0, pendingApprovals: 0, signals: 0, spend: null },
  signals: { red: 0, amber: 0, total: 0 },
  recentActions: [],
  topSignals: [],
};

beforeEach(() => {
  realtimeCb = null;
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => summary }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useWidgetSummary', () => {
  it('fetches /api/widget/summary on mount and exposes data', async () => {
    const { result } = renderHook(() => useWidgetSummary());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledWith('/api/widget/summary', { cache: 'no-store' });
    expect(result.current.data).toEqual(summary);
  });

  it('subscribes to realtime and debounce-refetches on a relevant event', async () => {
    renderHook(() => useWidgetSummary());
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(typeof realtimeCb).toBe('function');

    await act(async () => {
      realtimeCb('action.created', {});
    });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2), { timeout: 2_500 });
  });

  it('ignores irrelevant realtime events', async () => {
    renderHook(() => useWidgetSummary());
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      realtimeCb('token.usage', {});
    });
    // give any (non-)debounced fetch a chance to fire
    await new Promise((r) => setTimeout(r, 1_300));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
