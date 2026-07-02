'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain, CheckCircle2, XCircle, Clock, Copy,
} from 'lucide-react';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { isDemoMode } from '../lib/isDemoMode';
import { deriveAssumptionStatus, ASSUMPTION_FILTER_OPTIONS as FILTER_OPTIONS } from '../lib/assumptions-status';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; variant: string; label: string }> = {
  validated: { icon: CheckCircle2, color: 'text-success', variant: 'success', label: 'validated' },
  invalidated: { icon: XCircle, color: 'text-error', variant: 'error', label: 'invalidated' },
  pending: { icon: Clock, color: 'text-warning', variant: 'warning', label: 'awaiting validation' },
};

export default function AssumptionsPage() {
  const { agentId: selectedAgentId } = useAgentFilter();
  const [assumptions, setAssumptions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [driftSummary, setDriftSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const demo = isDemoMode();

  // Fetch the full (agent-scoped) set once; the route filters on integer
  // `validated`/`stale` columns and has no `status` param, so the four display
  // statuses (incl. "invalidated", which the API can't filter directly) are
  // derived and filtered client-side from the real fields.
  const fetchAssumptions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedAgentId) params.set('agent_id', selectedAgentId);
      params.set('limit', '200');
      params.set('drift', 'true'); // annotate each row with drift_score + return drift_summary

      const res = await fetch(`/api/actions/assumptions?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAssumptions(data.assumptions || []);
        setTotal(typeof data.total === 'number' ? data.total : (data.assumptions || []).length);
        setDriftSummary(data.drift_summary || null);
      }
    } catch (err) {
      console.error('Failed to fetch assumptions:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAgentId]);

  useEffect(() => {
    if (!demo) fetchAssumptions();
    else setLoading(false);
  }, [demo, fetchAssumptions]);

  const visibleAssumptions = filter === 'all'
    ? assumptions
    : assumptions.filter(a => deriveAssumptionStatus(a) === filter);

  const selection = useSelection<any>(visibleAssumptions, (a) => a.id);
  useSelectAllHotkey(selection.toggleAll);

  const handleCopyIds = () => {
    if (selection.count === 0) return;
    if (typeof navigator !== 'undefined') navigator.clipboard?.writeText(selection.selectedIds.join('\n'));
  };

  const BULK_ACTIONS = [{ id: 'copy-ids', label: 'Copy IDs', icon: Copy, onClick: handleCopyIds }];

  // Tiles read the API's whole-table drift_summary (computed under the same
  // filters), falling back to counting fetched rows only when the summary is
  // unavailable — counting the page understates everything past 200 rows.
  const stats = {
    total,
    validated: driftSummary?.validated ?? assumptions.filter(a => deriveAssumptionStatus(a) === 'validated').length,
    invalidated: driftSummary?.invalidated ?? assumptions.filter(a => deriveAssumptionStatus(a) === 'invalidated').length,
    pending: driftSummary?.unvalidated ?? assumptions.filter(a => deriveAssumptionStatus(a) === 'pending').length,
  };

  return (
    <PageLayout
      title="Assumptions"
      subtitle="Decision basis tracking — what agents believe while acting"
      breadcrumbs={['Governance', 'Assumptions']}
      actions={<BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />}
    >
      {/* Instrument rail — one container, divided columns */}
      <div className="mb-8 grid grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary md:grid-cols-5 md:divide-y-0">
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{stats.total}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Validated</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-success">{stats.validated}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Invalidated</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-error">{stats.invalidated}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Pending</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-warning">{stats.pending}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">At risk · drift</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${(driftSummary?.at_risk || 0) > 0 ? 'text-warning' : 'text-white'}`}>{driftSummary?.at_risk ?? 0}</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div role="tablist" className="mb-6 flex items-center gap-1 border-b border-border">
        {FILTER_OPTIONS.map((opt: any) => {
          const isActive = filter === opt.value;
          return (
            <button
              key={opt.value}
              role="tab"
              aria-selected={isActive}
              onClick={() => setFilter(opt.value)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive ? 'text-white' : 'text-tertiary hover:text-secondary'
              }`}
            >
              {opt.label}
              {isActive && (
                <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" />
              )}
            </button>
          );
        })}
      </div>

      {/* List */}
      {loading ? (
        <ListSkeleton rows={6} />
      ) : visibleAssumptions.length === 0 ? (
        <EmptyState
          icon={Brain}
          title={filter === 'all' ? 'No assumptions recorded' : `No ${filter === 'pending' ? 'awaiting-validation' : filter} assumptions`}
          description={filter === 'all'
            ? 'Agents record assumptions using claw.recordAssumption() when making decisions based on uncertain information. Claude Code sessions auto-capture "ASSUMPTIONS I\'M MAKING:" blocks via the Stop hook.'
            : 'No assumptions match this filter. Switch to “All” to see every recorded assumption.'}
        />
      ) : (
        <div className="space-y-3">
          <div className="mb-3 flex items-center gap-2">
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all"
            />
            <span className="text-xs text-tertiary">Select all</span>
          </div>
          {visibleAssumptions.map((a) => {
            const status = deriveAssumptionStatus(a);
            const cfg = STATUS_CONFIG[status]!;
            const StatusIcon = cfg.icon;
            return (
              <Card key={a.id} data-entity-type="assumption" data-entity-id={a.assumption_id || a.id} data-entity-status={status} hover={false}>
                <div className="flex items-start gap-4 p-4">
                  <SelectCheckbox
                    checked={selection.isSelected(a.id)}
                    onToggle={(e) => { e.stopPropagation(); selection.selectClick(a.id, e.shiftKey); }}
                    label={`Select ${a.assumption ?? a.id}`}
                  />
                  <div className={`mt-0.5 shrink-0 ${cfg.color}`}>
                    <StatusIcon size={18} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 text-sm font-medium text-white">{a.assumption}</div>
                    {a.basis && (
                      <div className="mb-2 text-xs text-tertiary">Basis: {a.basis}</div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-tertiary">
                      <span className="font-mono text-secondary">{a.agent_id}</span>
                      {a.action_id && (
                        <Link
                          href={`/actions/${a.action_id}`}
                          className="font-mono text-brand transition-colors hover:text-brand-hover"
                        >
                          {a.action_id.slice(0, 16)}…
                        </Link>
                      )}
                      {a.created_at && (
                        <span className="tabular-nums">{new Date(a.created_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={cfg.variant} size="xs">
                      {cfg.label}
                    </Badge>
                    {typeof a.drift_score === 'number' && a.drift_score > 0 && (
                      <Badge variant={a.drift_score >= 50 ? 'error' : 'warning'} size="xs">
                        drift {a.drift_score}
                      </Badge>
                    )}
                    {status === 'invalidated' && typeof a.notification_status === 'string' && (
                      <Badge variant={a.notification_status === 'acknowledged' ? 'success' : 'warning'} size="xs">
                        {a.notification_status === 'acknowledged' ? 'agent acknowledged' : 'agent notified · unread'}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
