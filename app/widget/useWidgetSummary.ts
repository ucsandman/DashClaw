'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '../hooks/useRealtime.js';
import { deriveConnection, type ConnectionState } from './connection.js';
import type { WidgetSummary } from '../lib/widget/summary.js';

const POLL_MS = 30_000;
const RECONNECT_TICK_MS = 15_000;
const REFETCH_DEBOUNCE_MS = 1_000;

// Realtime events that should trigger a fresh summary fetch. The widget feels
// "alive" by reacting to these, but reconciles via the 30s poll regardless.
const REFETCH_EVENTS = new Set([
  'action.created',
  'action.updated',
  'signal.detected',
  'decision.created',
  'guard.decision.created',
]);

export interface UseWidgetSummaryResult {
  data: WidgetSummary | null;
  loading: boolean;
  error: string | null;
  connection: ConnectionState;
  lastUpdated: number | null;
}

/**
 * Live widget data: fetch on mount, poll every 30s, and debounce-refetch on
 * relevant realtime events (reusing the shared SSE singleton — no extra
 * connection). Connection state is derived client-side from fetch freshness.
 */
export function useWidgetSummary(): UseWidgetSummaryResult {
  const [data, setData] = useState<WidgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessTs, setLastSuccessTs] = useState<number | null>(null);
  // Forces a re-render between polls so the connection indicator goes stale even
  // when no fetch is in flight.
  const [, setTick] = useState(0);

  const inFlight = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const fetchSummary = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch('/api/widget/summary', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as WidgetSummary;
      if (!mounted.current) return;
      setData(json);
      setError(null);
      setLastSuccessTs(Date.now());
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchSummary();
    const poll = setInterval(fetchSummary, POLL_MS);
    const ticker = setInterval(() => {
      if (mounted.current) setTick((t) => t + 1);
    }, RECONNECT_TICK_MS);
    return () => {
      mounted.current = false;
      clearInterval(poll);
      clearInterval(ticker);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchSummary]);

  useRealtime((event) => {
    if (!REFETCH_EVENTS.has(event)) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSummary();
    }, REFETCH_DEBOUNCE_MS);
  });

  const connection = deriveConnection({ lastSuccessTs, now: Date.now(), hasError: error != null });

  return { data, loading, error, connection, lastUpdated: lastSuccessTs };
}
