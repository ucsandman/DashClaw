'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { ShieldAlert, ShieldCheck, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { CardSkeleton } from './ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useTileSize, fitItems } from '../hooks/useTileSize';
import { useRealtime } from '../hooks/useRealtime';
import { HelpIcon } from './HelpIcon';
import { HELP_TIPS } from '../lib/demo/fixtures/help-tips';
import { signalDismissKey as getSignalHash } from '../lib/signal-hash';

export default function RiskSignalsCard() {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { agentId } = useAgentFilter();
  const { ref: sizeRef, height: tileHeight } = useTileSize();

  const handleRealtime = useCallback((event: any, payload: any) => {
    if (event === 'signal.detected') {
      if (agentId && payload.agent_id !== agentId) return;
      setSignals(prev => [payload, ...prev].slice(0, 50));
    }
  }, [agentId]);
  useRealtime(handleRealtime);

  useEffect(() => {
    async function fetchSignals() {
      try {
        const res = await fetch(`/api/signals${agentId ? `?agent_id=${agentId}` : ''}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setSignals(data.signals || []);
      } catch (error) {
        console.error('Failed to fetch risk signals:', error);
        setSignals([]);
      } finally {
        setLoading(false);
      }
    }
    fetchSignals();
  }, [agentId]);

  // Respect dismissals from the Security page (re-read when signals refresh)
  const dismissed = useMemo(() => {
    try {
      const stored = typeof window !== 'undefined' && localStorage.getItem('dashclaw_dismissed_signals');
      if (stored) return new Set(JSON.parse(stored));
    } catch { /* ignore */ }
    return new Set();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals]);

  const filteredSignals = useMemo(() => signals.filter(s => !dismissed.has(getSignalHash(s))), [signals, dismissed]);

  if (loading) {
    return <CardSkeleton />;
  }
  const ITEM_H = 52;
  const maxVisible = tileHeight > 0 ? fitItems(tileHeight, ITEM_H) : 5;
  const visibleSignals = filteredSignals.slice(0, maxVisible);
  const overflow = filteredSignals.length - visibleSignals.length;
  const redCount = filteredSignals.filter(s => s.severity === 'red').length;
  const amberCount = filteredSignals.filter(s => s.severity === 'amber').length;

  const viewAllLink = (
    <Link href="/security" className="text-xs text-brand hover:text-brand-hover transition-colors inline-flex items-center gap-1">
      View all <ArrowRight size={12} />
    </Link>
  );

  return (
    <Card className="h-full">
      <CardHeader title={<span className="flex items-center">Decision Integrity Signals<HelpIcon sectionKey="risk-signals" tip={HELP_TIPS['risk-signals']} /></span>} icon={ShieldAlert} action={viewAllLink}>
        {redCount > 0 && (
          <Badge variant="error" size="sm">{redCount} Red</Badge>
        )}
        {amberCount > 0 && (
          <Badge variant="warning" size="sm">{amberCount} Amber</Badge>
        )}
        {redCount === 0 && amberCount === 0 && (
          <Badge variant="success" size="sm">Clear</Badge>
        )}
      </CardHeader>

      <CardContent>
        <div ref={sizeRef as React.RefObject<HTMLDivElement>} className="flex flex-col h-full min-h-0">
        <div className="flex-1 min-h-0 space-y-2">
          {filteredSignals.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="All clear"
              description="All clear - no active risk signals"
            />
          ) : (
            visibleSignals.map((signal) => {
              const dotColor = signal.severity === 'red' ? 'bg-status-error' : 'bg-status-warning';
              const titleColor = signal.severity === 'red' ? 'text-error' : 'text-warning';
              // Stable key — index keys remount every row when the realtime
              // handler prepends a new signal, losing per-item local state.
              const key = signal.id ?? `${signal.type}:${signal.agent_id ?? ''}:${signal.label ?? ''}:${signal.detail ?? ''}`;

              return (
                <div
                  key={key}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-surface-tertiary border border-border transition-colors duration-150"
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${titleColor}`}>{signal.label}</div>
                    <div className="text-xs text-tertiary mt-0.5">{signal.detail}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        </div>
      </CardContent>
    </Card>
  );
}
