'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { CollapsibleSection } from './ui/CollapsibleSection';
import { EmptyState } from './ui/EmptyState';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { filterSignalsBySeverity } from '../lib/security-filter';
import { signalDismissKey } from '../lib/signal-hash';

type Signal = {
  type: string;
  severity: 'red' | 'amber';
  label: string;
  detail?: string;
  help?: string;
  agent_id?: string | null;
  action_id?: string | null;
  assumption_id?: string | null;
  detected_at?: string | null;
};

const SEVERITY_META = {
  red: { label: 'Critical', dot: 'bg-status-error', text: 'text-error' },
  amber: { label: 'Elevated', dot: 'bg-status-warning', text: 'text-warning' },
} as const;

function formatDetectedAt(ts: string | null | undefined) {
  if (!ts) return '--';
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return ts;
  }
}

/**
 * The signals breakdown on the decisions ledger — the landing surface for the
 * SystemStatusBar "N Critical" / "N Elevated" quick links (?severity=red|amber).
 * Renders the same /api/signals list the top bar counts, minus the same
 * locally-dismissed set, so the number clicked equals the rows shown.
 */
export default function GovernanceSignalsPanel({ initialSeverity }: { initialSeverity: 'red' | 'amber' | null }) {
  const { agentId } = useAgentFilter();
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [severity, setSeverity] = useState<'red' | 'amber' | ''>(initialSeverity || '');
  // Deep links must render the section open even if a past collapse was
  // persisted; released on the first manual toggle (same pattern as /policies).
  const [forceOpen, setForceOpen] = useState(!!initialSeverity);

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch(`/api/signals${agentId ? `?agent_id=${agentId}` : ''}`);
      if (!res.ok) return;
      const data = await res.json();
      setSignals(data.signals || []);
    } catch {
      // Panel just stays in its loading-empty state; the ledger below is unaffected.
    }
  }, [agentId]);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 30000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  // Dismissals are subtracted server-side in computeSignals — the fetched
  // list IS the active set, identical to what the status bar counts.
  const activeSignals = useMemo(() => signals || [], [signals]);
  const redCount = activeSignals.filter((s) => s.severity === 'red').length;
  const amberCount = activeSignals.filter((s) => s.severity === 'amber').length;
  const visible = filterSignalsBySeverity(activeSignals, severity || null);

  const dismissSignal = async (s: Signal) => {
    const key = signalDismissKey(s);
    // Optimistic remove; a failed POST refetches so the row honestly returns.
    setSignals((prev) => (prev || []).filter((row) => signalDismissKey(row) !== key));
    try {
      const res = await fetch('/api/signals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss_keys: [key] }),
      });
      if (!res.ok) fetchSignals();
    } catch {
      fetchSignals();
    }
  };

  const chipClass = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
      active
        ? 'border-brand/30 bg-brand/10 text-brand'
        : 'border-border bg-white/5 text-secondary hover:border-border-hover hover:text-white'
    }`;

  return (
    <div className="mb-6" data-testid="governance-signals-panel">
      <CollapsibleSection
        id="decisions.signals"
        title="Governance Signals"
        icon={AlertTriangle}
        iconClassName={redCount > 0 ? 'text-error' : amberCount > 0 ? 'text-warning' : 'text-success'}
        count={visible.length}
        forceOpen={forceOpen}
        onToggle={() => setForceOpen(false)}
        actions={
          <div className="flex items-center gap-1.5" data-testid="signal-severity-chips">
            <button type="button" onClick={() => setSeverity('')} className={chipClass(severity === '')}>
              All {activeSignals.length}
            </button>
            <button type="button" onClick={() => setSeverity('red')} className={chipClass(severity === 'red')}>
              Critical {redCount}
            </button>
            <button type="button" onClick={() => setSeverity('amber')} className={chipClass(severity === 'amber')}>
              Elevated {amberCount}
            </button>
          </div>
        }
      >
        <Card hover={false}>
          <CardContent className="pt-5">
            {visible.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title={activeSignals.length === 0 ? 'All clear' : `No ${severity ? SEVERITY_META[severity as 'red' | 'amber'].label.toLowerCase() : ''} signals`}
                description={
                  activeSignals.length === 0
                    ? 'No active governance signals for this workspace'
                    : 'Switch tiers above to see the remaining signals'
                }
              />
            ) : (
              <div className="space-y-2">
                {visible.map((s) => {
                  const meta = SEVERITY_META[s.severity] || SEVERITY_META.amber;
                  return (
                    <div
                      key={signalDismissKey(s)}
                      data-testid="signal-row"
                      className="flex items-start gap-3 rounded-lg border border-border bg-surface-tertiary p-3 transition-colors hover:border-border-hover"
                    >
                      <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${meta.text}`}>{meta.label}</span>
                          <span className="font-mono text-[11px] text-tertiary">{s.type}</span>
                          <span className="font-mono text-[11px] tabular-nums text-tertiary">{formatDetectedAt(s.detected_at)}</span>
                        </div>
                        <div className="mt-0.5 text-sm font-medium text-white">{s.label}</div>
                        {s.detail && <div className="mt-0.5 text-xs text-secondary">{s.detail}</div>}
                        {s.help && <div className="mt-0.5 text-xs text-tertiary">{s.help}</div>}
                        {s.action_id && (
                          <Link
                            href={`/decisions/${s.action_id}`}
                            className="mt-1.5 inline-block text-xs font-medium text-brand transition-colors hover:text-brand-hover"
                          >
                            View the related decision →
                          </Link>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => dismissSignal(s)}
                        title="Dismiss this signal occurrence (also removes it from the top-bar count)"
                        aria-label="Dismiss signal"
                        className="rounded-md p-1 text-tertiary transition-colors hover:bg-white/5 hover:text-white"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleSection>
    </div>
  );
}
