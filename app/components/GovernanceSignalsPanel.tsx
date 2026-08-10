'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronRight, ShieldCheck, X } from 'lucide-react';
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
  session_id?: string | null;
  detected_at?: string | null;
};

const SEVERITY_META = {
  red: { label: 'Critical', dot: 'bg-status-error', text: 'text-error' },
  amber: { label: 'Elevated', dot: 'bg-status-warning', text: 'text-warning' },
} as const;

// Human names for the signal types (app/lib/signals.ts builders). Unknown
// types fall back to the raw slug with underscores spaced.
const TYPE_LABELS: Record<string, string> = {
  agent_silent: 'Agent heartbeat lost',
  autonomy_spike: 'Autonomy spikes',
  high_impact_low_oversight: 'Ungoverned high-risk decisions',
  repeated_failures: 'Repeated failures',
  assumption_drift: 'Assumption drift',
  stale_assumption: 'Unverified assumptions',
  stale_running_action: 'Stalled decisions',
  approval_backlog: 'Stale approvals',
  integration_mismatch: 'Integration credentials',
  session_stalled: 'Stalled sessions',
  branch_stale: 'Stale branches',
  observe_mode: 'Hooks in observe mode',
  mcp_degraded: 'MCP servers degraded',
  green_insufficient: 'Insufficient test verification',
  executed_despite_block: 'Executed despite enforcement',
  approval_flood: 'Approval floods',
};

function typeLabel(type: string) {
  return TYPE_LABELS[type] || type.replace(/_/g, ' ');
}

// Server cap on dismiss_keys per POST (MAX_DISMISS_KEYS in /api/signals).
const DISMISS_CHUNK = 1000;

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

  // One group per signal type: groups with criticals first, then by size.
  const groups = useMemo(() => {
    const byType = new Map<string, Signal[]>();
    for (const s of visible) {
      const list = byType.get(s.type) || [];
      list.push(s);
      byType.set(s.type, list);
    }
    return [...byType.entries()]
      .map(([type, list]) => ({
        type,
        signals: list,
        redCount: list.filter((s) => s.severity === 'red').length,
      }))
      .sort((a, b) => (b.redCount > 0 ? 1 : 0) - (a.redCount > 0 ? 1 : 0) || b.signals.length - a.signals.length);
  }, [visible]);

  // Small groups start open; big groups start collapsed so 100+ signals of one
  // type read as one line, not a wall. First manual toggle wins after that.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const isGroupOpen = (type: string, size: number) => openGroups[type] ?? size <= 3;

  const dismissMany = async (toDismiss: Signal[]) => {
    const keys = toDismiss.map(signalDismissKey);
    const keySet = new Set(keys);
    // Optimistic remove; a failed POST refetches so the rows honestly return.
    setSignals((prev) => (prev || []).filter((row) => !keySet.has(signalDismissKey(row))));
    try {
      for (let i = 0; i < keys.length; i += DISMISS_CHUNK) {
        const res = await fetch('/api/signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dismiss_keys: keys.slice(i, i + DISMISS_CHUNK) }),
        });
        if (!res.ok) {
          fetchSignals();
          return;
        }
      }
    } catch {
      fetchSignals();
    }
  };

  const dismissSignal = (s: Signal) => dismissMany([s]);

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
            {visible.length > 1 && (
              <button
                type="button"
                onClick={() => dismissMany(visible)}
                title="Dismiss every signal occurrence currently shown (new occurrences will re-fire)"
                className="ml-1 rounded-full border border-border bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
              >
                Dismiss all {visible.length}
              </button>
            )}
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
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {groups.map((g) => {
                  const open = isGroupOpen(g.type, g.signals.length);
                  const groupMeta = g.redCount > 0 ? SEVERITY_META.red : SEVERITY_META.amber;
                  const Chevron = open ? ChevronDown : ChevronRight;
                  return (
                    <div key={g.type} data-testid="signal-group" className="rounded-lg border border-border bg-surface-tertiary">
                      <div className="flex items-center gap-2 p-3">
                        <button
                          type="button"
                          onClick={() => setOpenGroups((prev) => ({ ...prev, [g.type]: !open }))}
                          aria-expanded={open}
                          aria-label={`Toggle ${typeLabel(g.type)} signals`}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <Chevron size={14} className="shrink-0 text-tertiary" />
                          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${groupMeta.dot}`} />
                          <span className="truncate text-sm font-medium text-white">{typeLabel(g.type)}</span>
                          <span className="font-mono text-[11px] text-tertiary">{g.type}</span>
                          <span className="rounded-full border border-border bg-white/5 px-2 py-0.5 text-[11px] font-medium tabular-nums text-secondary">
                            {g.signals.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissMany(g.signals)}
                          aria-label={`Dismiss all ${typeLabel(g.type)} signals`}
                          title="Dismiss every occurrence in this group (new occurrences will re-fire)"
                          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-tertiary transition-colors hover:bg-white/5 hover:text-white"
                        >
                          Dismiss {g.signals.length > 1 ? `all ${g.signals.length}` : ''}
                        </button>
                      </div>
                      {open && (
                        <div className="space-y-2 border-t border-border p-3">
                          {g.signals.map((s) => {
                            const meta = SEVERITY_META[s.severity] || SEVERITY_META.amber;
                            return (
                              <div
                                key={signalDismissKey(s)}
                                data-testid="signal-row"
                                className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-hover"
                              >
                                <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                    <span className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${meta.text}`}>{meta.label}</span>
                                    <span className="font-mono text-[11px] tabular-nums text-tertiary">{formatDetectedAt(s.detected_at)}</span>
                                  </div>
                                  <div className="mt-0.5 text-sm font-medium text-white">{s.label}</div>
                                  {s.detail && <div className="mt-0.5 text-xs text-secondary">{s.detail}</div>}
                                  {s.help && <div className="mt-0.5 text-xs text-tertiary">{s.help}</div>}
                                  <div className="flex flex-wrap gap-x-4">
                                    {s.action_id && (
                                      <Link
                                        href={`/decisions/${s.action_id}`}
                                        className="mt-1.5 inline-block text-xs font-medium text-brand transition-colors hover:text-brand-hover"
                                      >
                                        View the related decision →
                                      </Link>
                                    )}
                                    {s.assumption_id && (
                                      <Link
                                        href="/assumptions"
                                        className="mt-1.5 inline-block text-xs font-medium text-brand transition-colors hover:text-brand-hover"
                                      >
                                        Validate or invalidate on Assumptions →
                                      </Link>
                                    )}
                                    {s.session_id && (
                                      <Link
                                        href={`/sessions/${s.session_id}`}
                                        className="mt-1.5 inline-block text-xs font-medium text-brand transition-colors hover:text-brand-hover"
                                      >
                                        View the session →
                                      </Link>
                                    )}
                                  </div>
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
