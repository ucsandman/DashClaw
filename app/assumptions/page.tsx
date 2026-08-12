'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain, CheckCircle2, XCircle, Clock, Copy, Check,
} from 'lucide-react';
import Link from 'next/link';
import PageLayout from '../components/PageLayout';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { CollapsibleSection } from '../components/ui/CollapsibleSection';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { deriveAssumptionStatus, ASSUMPTION_FILTER_OPTIONS as FILTER_OPTIONS } from '../lib/assumptions-status';
import { bulkAction } from '../lib/bulkAction';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { useListControls, type ListColumn } from '../lib/useListControls';
import { ListControlsBar } from '../components/ListControlsBar';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';

// Sort-only columns. The existing status *tabs* (FILTER_OPTIONS below) already
// give a filterable status control over the same four values a `filterable`
// status column would offer — adding a second one would be a redundant,
// stacked status filter, so this section intentionally omits it (deviation
// from the task-10 brief's "status filterable" bullet; see report).
const assumptionsColumns: ListColumn<any>[] = [
  { key: 'agent', label: 'Agent', accessor: (a) => a.agent_id, sortable: true },
  { key: 'created', label: 'Created', accessor: (a) => a.created_at, sortable: true },
];

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
  // Inline invalidate flow (operator judgment = a visible control, not
  // right-click-only): which card is armed, its reason draft, and errors.
  const [invalidatingId, setInvalidatingId] = useState<string | null>(null);
  const [invalidateReason, setInvalidateReason] = useState('');
  const [invalidateError, setInvalidateError] = useState<string | null>(null);
  const [invalidateBusy, setInvalidateBusy] = useState(false);
  // Validate is the OTHER half of the same operator judgment. It lived only in
  // the right-click menu, which is not a control a human can find — so the
  // whole positive verdict was invisible while "Invalidate…" sat in the open.
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // Bulk validate fans out per-item PATCHes (bulkAction); a partial failure
  // must reach the human, not just the console — the per-row path already
  // surfaces failures via rowError above.
  const [bulkError, setBulkError] = useState<string | null>(null);

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

  // Fetch in demo mode too — the demo middleware serves assumption fixtures
  // for /api/actions/assumptions, so skipping here just blanked the page.
  useEffect(() => {
    fetchAssumptions();
  }, [fetchAssumptions]);

  const visibleAssumptions = filter === 'all'
    ? assumptions
    : assumptions.filter(a => deriveAssumptionStatus(a) === filter);

  const assumptionsControls = useListControls(visibleAssumptions, assumptionsColumns);
  const selection = useSelection<any>(assumptionsControls.rows, (a) => a.assumption_id || a.id);
  useSelectAllHotkey(selection.toggleAll);

  // The rendered rows are sort/search-narrowed client-side; a selected id
  // must never point at a row the operator can no longer see (see identities.tsx).
  useEffect(() => {
    const visibleIds = new Set(assumptionsControls.rows.map((a) => a.assumption_id || a.id));
    const pruned = selection.selectedIds.filter((id) => visibleIds.has(id));
    if (pruned.length !== selection.selectedIds.length) {
      selection.setSelected(pruned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assumptionsControls.rows]);

  const handleInvalidate = async (assumptionId: string) => {
    setInvalidateBusy(true);
    setInvalidateError(null);
    try {
      const res = await fetch(`/api/assumptions/${assumptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          validated: false,
          ...(invalidateReason.trim() ? { invalidated_reason: invalidateReason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Invalidate failed (${res.status})`);
      }
      setInvalidatingId(null);
      setInvalidateReason('');
      await fetchAssumptions();
    } catch (err) {
      setInvalidateError((err as Error).message);
    } finally {
      setInvalidateBusy(false);
    }
  };

  const handleValidate = async (assumptionId: string) => {
    setValidatingId(assumptionId);
    setRowError(null);
    try {
      const res = await fetch(`/api/assumptions/${assumptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validated: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Validate failed (${res.status})`);
      }
      await fetchAssumptions();
    } catch (err) {
      setRowError({ id: assumptionId, message: (err as Error).message });
    } finally {
      setValidatingId(null);
    }
  };

  // Bulk validate only. Invalidating needs a reason per belief — that is a
  // judgment you write, not one you fan out — so it stays a per-row control.
  const handleBulkValidate = async () => {
    // Call-time re-scope to visible rows, and never re-verdict a row that is
    // already decided (the API 409s an invalidated one).
    const eligible = new Map(
      assumptionsControls.rows
        .filter((a) => deriveAssumptionStatus(a) === 'pending')
        .map((a) => [a.assumption_id || a.id, true]),
    );
    const ids = selection.selectedIds.filter((id) => eligible.has(id));
    if (ids.length === 0) return;
    setBulkError(null);
    const { ok, failed } = await bulkAction(ids, (id) =>
      fetch(`/api/assumptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validated: true }),
      }),
    );
    selection.clear();
    await fetchAssumptions();
    if (failed.length > 0) {
      setBulkError(`Validated ${ok.length} of ${ids.length} assumption${ids.length === 1 ? '' : 's'}. ${failed.length} failed and ${failed.length === 1 ? 'remains' : 'remain'} pending — try again or validate individually.`);
    }
  };

  const handleCopyIds = () => {
    if (selection.count === 0) return;
    if (typeof navigator !== 'undefined') navigator.clipboard?.writeText(selection.selectedIds.join('\n'));
  };

  const BULK_ACTIONS = [
    { id: 'validate', label: 'Validate', icon: Check, onClick: handleBulkValidate },
    { id: 'copy-ids', label: 'Copy IDs', icon: Copy, onClick: handleCopyIds },
  ];

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
      subtitle="Decision basis tracking: what agents believe while acting"
      breadcrumbs={['Governance', 'Assumptions']}
      actions={<BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />}
    >
      {bulkError && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-lg border border-error/20 bg-error-subtle p-3 text-sm text-error">
          <span>{bulkError}</span>
          <button onClick={() => setBulkError(null)} className="ml-4 text-error hover:text-error" aria-label="Dismiss">&times;</button>
        </div>
      )}
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
      ) : (
        <CollapsibleSection
          id="assumptions.list"
          title="Assumptions"
          icon={Brain}
          count={visibleAssumptions.length}
          controls={
            visibleAssumptions.length > 0 ? (
              <ListControlsBar columns={assumptionsColumns} controls={assumptionsControls} searchPlaceholder="Search assumptions…" />
            ) : undefined
          }
          actions={
            visibleAssumptions.length > 0 ? (
              <SelectCheckbox
                checked={selection.allSelected}
                onToggle={() => selection.toggleAll()}
                label="Select all"
              />
            ) : undefined
          }
        >
        {visibleAssumptions.length === 0 ? (
          <EmptyState
            icon={Brain}
            title={filter === 'all' ? 'No assumptions recorded' : `No ${filter === 'pending' ? 'awaiting-validation' : filter} assumptions`}
            description={filter === 'all'
              ? 'Agents record assumptions using claw.recordAssumption() when making decisions based on uncertain information. Claude Code sessions auto-capture "ASSUMPTIONS I\'M MAKING:" blocks via the Stop hook.'
              : 'No assumptions match this filter. Switch to “All” to see every recorded assumption.'}
          />
        ) : (
          <div className="space-y-3">
          {assumptionsControls.rows.map((a) => {
            const status = deriveAssumptionStatus(a);
            const cfg = STATUS_CONFIG[status]!;
            const StatusIcon = cfg.icon;
            const entityId = a.assumption_id || a.id;
            const armed = invalidatingId === entityId;
            return (
              <Card key={entityId} data-entity-type="assumption" data-entity-id={entityId} data-entity-status={status} hover={false}>
                <div className="flex items-start gap-4 p-4">
                  <SelectCheckbox
                    checked={selection.isSelected(entityId)}
                    onToggle={(e) => { e.stopPropagation(); selection.selectClick(entityId, e.shiftKey); }}
                    label={`Select ${a.assumption ?? entityId}`}
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
                          href={`/decisions/${a.action_id}`}
                          // The visible label is a truncated id, so on its own the
                          // accessible name is an opaque string with no hint that it
                          // navigates — the row's only way through to the decision
                          // this assumption was recorded against.
                          title={`Open decision ${a.action_id}`}
                          aria-label={`Open the decision this assumption was recorded against (${a.action_id})`}
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
                    {status !== 'invalidated' && !armed && (
                      <div className="mt-1 flex items-center gap-2">
                        {status === 'pending' && (
                          <button
                            onClick={() => handleValidate(entityId)}
                            disabled={validatingId === entityId}
                            className="inline-flex items-center gap-1.5 rounded-md border border-success/20 bg-success-subtle px-2.5 py-1 text-xs font-medium text-success transition-colors hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Check size={12} aria-hidden="true" />
                            {validatingId === entityId ? 'Validating…' : 'Validate'}
                          </button>
                        )}
                        <button
                          onClick={() => { setInvalidatingId(entityId); setInvalidateReason(''); setInvalidateError(null); }}
                          className="text-xs text-tertiary transition-colors hover:text-error"
                        >
                          Invalidate…
                        </button>
                      </div>
                    )}
                    {rowError && rowError.id === entityId && (
                      <p role="alert" className="mt-1 max-w-[220px] text-right text-xs text-error">{rowError.message}</p>
                    )}
                  </div>
                </div>
                {/* Armed confirm row: reason + confirm/cancel. The agent is
                    notified via its inbox and hears about it before acting on
                    this belief again (v2.4 transport). */}
                {armed && (
                  <div className="border-t border-border bg-surface-primary/40 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={invalidateReason}
                        onChange={(e) => setInvalidateReason(e.target.value)}
                        placeholder="Why is this belief no longer true? (optional)"
                        autoFocus
                        className="min-w-0 flex-1 rounded-md border border-border bg-surface-secondary px-2.5 py-1.5 text-xs text-white placeholder:text-disabled focus:border-border-active focus:outline-none"
                      />
                      <button
                        onClick={() => handleInvalidate(entityId)}
                        disabled={invalidateBusy}
                        className="rounded-md bg-error-subtle px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
                      >
                        {invalidateBusy ? 'Invalidating…' : 'Confirm invalidate'}
                      </button>
                      <button
                        onClick={() => { setInvalidatingId(null); setInvalidateError(null); }}
                        disabled={invalidateBusy}
                        className="rounded-md px-3 py-1.5 text-xs text-tertiary transition-colors hover:text-secondary disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-tertiary">
                      The agent is notified in its inbox and sees this before acting on the assumption again.
                    </p>
                    {invalidateError && (
                      <p role="alert" className="mt-1.5 text-xs text-error">{invalidateError}</p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          </div>
        )}
        </CollapsibleSection>
      )}
    </PageLayout>
  );
}
