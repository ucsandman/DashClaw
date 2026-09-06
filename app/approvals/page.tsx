'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, ShieldAlert, Check, X, Clock, User, Zap,
  RefreshCw, Info, Ban, Hourglass, AppWindow, BellOff,
} from 'lucide-react';
import { IRREVERSIBLE_TEXT } from '../lib/plain-language/types';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { CollapsibleSection } from '../components/ui/CollapsibleSection';
import { isDemoMode } from '../lib/isDemoMode';
import { parseJsonArray as safeJsonArray } from '../lib/parseJson';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { useRealtime } from '../hooks/useRealtime';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { useListControls, type ListColumn } from '../lib/useListControls';
import { ListControlsBar } from '../components/ListControlsBar';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';
import { EntityLink } from '../components/context-menu/EntityLink';
import ApprovalFloodBanner from '../components/ApprovalFloodBanner';
import ApprovalPauseBanner from '../components/ApprovalPauseBanner';
import ObserveModeBanner from '../components/ObserveModeBanner';
import { RISK_HIGH_MIN } from '../lib/riskThresholds';
import DontAskAgainPanel from './_components/DontAskAgainPanel';
import ActiveGrantsStrip, { type GrantRow } from './_components/ActiveGrantsStrip';
import PlanReviewCard from './_components/PlanReviewCard';
import LivePlansSection from './_components/LivePlansSection';
import ContainmentSection from './_components/ContainmentSection';

type BannerTone = 'neutral' | 'warning';

interface BannerProps {
  icon: React.ElementType;
  tone: BannerTone;
  title: React.ReactNode;
  children?: React.ReactNode;
  onDismiss?: () => void;
}

// Sort-only client columns for the two approvals queues (both fetches are
// server-paginated/status-filtered already, so no filterable columns here).
const pendingColumns: ListColumn<any>[] = [
  { key: 'time', label: 'Requested', accessor: (a) => a.timestamp_start, sortable: true },
  { key: 'agent', label: 'Agent', accessor: (a) => a.agent_name || a.agent_id, sortable: true },
  { key: 'risk', label: 'Risk', accessor: (a) => a.risk_score, sortable: true },
];

const resolvedColumns: ListColumn<any>[] = [
  { key: 'time', label: 'Requested', accessor: (a) => a.timestamp_start, sortable: true },
  { key: 'agent', label: 'Agent', accessor: (a) => a.agent_name || a.agent_id, sortable: true },
];

function actionContext(action: any): Record<string, any> {
  if (action?.context && typeof action.context === 'object') return action.context;
  try { return JSON.parse(action?.context || '{}'); } catch { return {}; }
}

function Banner({ icon: Icon, tone, title, children, onDismiss }: BannerProps) {
  const tones: Record<BannerTone, string> = {
    neutral: 'border-border bg-white/[0.02] text-secondary',
    warning: 'border-warning/20 bg-warning-subtle text-amber-200',
  };
  const iconTone: Record<BannerTone, string> = {
    neutral: 'text-secondary',
    warning: 'text-warning',
  };
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-xl border p-4 ${tones[tone]}`}>
      <Icon size={16} className={`mt-0.5 shrink-0 ${iconTone[tone]}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">{title}</div>
        <p className="mt-1 text-xs text-secondary">{children}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-lg leading-none text-tertiary transition-colors hover:text-secondary"
        >
          &times;
        </button>
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  const { agentId } = useAgentFilter();
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [expiredActions, setExpiredActions] = useState<any[]>([]);
  const [pendingPlans, setPendingPlans] = useState<Array<{ plan: any; steps: any[] }>>([]);
  const [livePlans, setLivePlans] = useState<Array<{ plan: any; steps: any[] }>>([]);
  const [awaitingContainment, setAwaitingContainment] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [lastSuccessfulRefresh, setLastSuccessfulRefresh] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [clearingExpired, setClearingExpired] = useState(false);
  // Bulk approve/deny fan out per-item requests (bulkAction); a partial
  // failure must never look like a clean sweep on the hero surface — the
  // single-item path already alerts on failure (handleDecision below).
  const [bulkFailure, setBulkFailure] = useState<{ verb: string; ok: number; failed: number } | null>(null);
  // "Don't ask again": which card has its scope panel open, the chosen lease,
  // and the live grants shown in the revoke strip.
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [grantTtl, setGrantTtl] = useState(24);
  const [grantPreview, setGrantPreview] = useState<{ actionId: string; target: string; matching_count: number; truncated: boolean } | null>(null);
  const [grantPreviewError, setGrantPreviewError] = useState<string | null>(null);
  const [grantPreviewLoading, setGrantPreviewLoading] = useState(false);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const { isAdmin, settled: sessionSettled } = useEffectiveRole();

  const fetchPending = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const agentQs = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
      const res = await fetch(`/api/actions?status=pending_approval&limit=50${agentQs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load pending actions');
      const json = await res.json();
      setPendingActions(json.actions || []);
      setQueueError(null);
      setLastSuccessfulRefresh(new Date().toLocaleTimeString());
      // Fetched AFTER the pending list on purpose: that request runs the
      // server's lazy expiry sweep, so rows it just flipped show up here.
      const expiredRes = await fetch(`/api/actions?status=expired&limit=20${agentQs}`, { cache: 'no-store' });
      if (expiredRes.ok) {
        const expiredJson = await expiredRes.json();
        setExpiredActions(expiredJson.actions || []);
      }
    } catch (error) {
      // The list stays as-is and the user can retry with the refresh button
      console.warn('Failed to fetch pending actions:', error);
      setQueueError('Approval queue unavailable');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // expand=details returns each plan already in the { plan, steps, deviations }
  // shape (batched server-side — see GET /api/plans), so the page needs zero
  // further per-plan calls.
  const fetchPlanList = useCallback(async (status: string) => {
    const res = await fetch(`/api/plans?status=${status}&limit=20&expand=details`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.plans ?? [];
  }, []);

  // Fetches pending plans (for review) plus the live set (approved,
  // partially_approved, denied) for the "Live plans" surface.
  const fetchPendingPlans = useCallback(async () => {
    try {
      const [pendingDetailed, approved, partiallyApproved, denied, previewing] = await Promise.all([
        fetchPlanList('pending'),
        fetchPlanList('approved'),
        fetchPlanList('partially_approved'),
        fetchPlanList('denied'),
        // V4: a plan stuck previewing (still dry-running steps, or orphaned
        // by a preview failure the route couldn't fully clean up) must stay
        // visible and revokable, not disappear until it reaches 'pending'.
        fetchPlanList('previewing'),
      ]);
      const liveDetailed = [...approved, ...partiallyApproved, ...denied, ...previewing];
      setPendingPlans(pendingDetailed);
      // Dead plans (expires_at already in the past — e.g. a lifted denial or
      // an unrevoked plan that simply timed out) age out of the Live plans
      // section client-side rather than sticking around until the next
      // status-based refetch drops them. A 'previewing' plan has no
      // expires_at yet (it hasn't been reviewed), so it's exempt from that
      // filter — it's live by definition until the loop finishes or an
      // operator revokes it.
      setLivePlans(liveDetailed.filter((p: any) => {
        if (p?.plan?.status === 'previewing') return true;
        const expiresAt = p?.plan?.expires_at;
        return expiresAt && Date.parse(expiresAt) > Date.now();
      }));
    } catch { /* pending/live plans are additive; the actions inbox must not break on this */ }
  }, [fetchPlanList]);

  // Containment Verdicts: actions an agent staged instead of executing,
  // awaiting an operator's promote/discard verdict. Additive like the plan
  // fetches above — a failure here must never break the approvals inbox.
  const fetchAwaitingContainment = useCallback(async () => {
    try {
      const agentQs = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
      const res = await fetch(`/api/actions?containment_status=awaiting_promotion&limit=50${agentQs}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setAwaitingContainment(data.actions || []);
    } catch { /* additive surface; the actions inbox must not break on this */ }
  }, [agentId]);

  // Active grants for the revoke strip. GET /api/policies already returns the
  // whole set, so this needs no new route — filter to live allow_grants here.
  const fetchGrants = useCallback(async () => {
    try {
      const res = await fetch('/api/policies', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      const rows: GrantRow[] = (json.policies || json || [])
        .filter((p: { policy_type?: string; active?: unknown }) =>
          p.policy_type === 'allow_grant' && (p.active === 1 || p.active === true));
      setGrants(rows);
    } catch (error) {
      // The strip just stays as-is; the queue below is the load-bearing part.
      console.warn('Failed to fetch grants:', error);
    }
  }, []);

  useEffect(() => {
    fetchPending();
    fetchPendingPlans();
    fetchAwaitingContainment();
    // Grants are not polled: they only change when someone on this page mints
    // or revokes one, and both paths refetch explicitly.
    fetchGrants();
    const interval = setInterval(() => {
      fetchPending({ silent: true });
      fetchPendingPlans();
      fetchAwaitingContainment();
    }, 10000); // Fallback poll
    return () => clearInterval(interval);
  }, [fetchPending, fetchPendingPlans, fetchAwaitingContainment, fetchGrants]);

  useEffect(() => {
    if (!grantingId) {
      setGrantPreview(null);
      setGrantPreviewError(null);
      return;
    }
    let cancelled = false;
    setGrantPreviewLoading(true);
    setGrantPreviewError(null);
    fetch(`/api/approvals/${grantingId}/grant?ttl_hours=${grantTtl}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Preview unavailable');
        if (!cancelled) setGrantPreview({ actionId: grantingId, target: json.target, matching_count: json.matching_count, truncated: Boolean(json.truncated) });
      })
      .catch((error) => { if (!cancelled) setGrantPreviewError(error.message); })
      .finally(() => { if (!cancelled) setGrantPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [grantingId, grantTtl]);

  // Realtime: clear instantly when an approval is resolved anywhere (another
  // channel, /approve) rather than waiting up to 10s for the poll.
  // Plan lists don't change on guard.decision.created — only fetchPending
  // needs that event; fetchPendingPlans only reacts to action create/update.
  useRealtime((event) => {
    if (event === 'action.created' || event === 'action.updated' || event === 'guard.decision.created') {
      fetchPending({ silent: true });
    }
    if (event === 'action.created' || event === 'action.updated') {
      fetchPendingPlans();
      fetchAwaitingContainment();
    }
  });

  /**
   * Approve this action, write the grant, release everything it covers.
   *
   * The release fans out over the SAME per-item approval route bulk approve
   * uses, so each released action keeps its full audit / webhook / calibration
   * chain. The server's release_ids is authoritative — the count shown in the
   * panel before confirming is only a client-side preview.
   */
  const handleGrant = async (actionId: string) => {
    try {
      setProcessingId(actionId);
      setBulkFailure(null);
      const res = await fetch(`/api/approvals/${actionId}/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl_hours: grantTtl }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to create the grant');

      const ids: string[] = json.release_ids?.length ? json.release_ids : [actionId];
      const { ok, failed } = await bulkAction(ids, (id) =>
        fetch(`/api/approvals/${id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ decision: 'allow' }),
        })
      );
      if (failed.length > 0) setBulkFailure({ verb: 'approve', ok: ok.length, failed: failed.length });
      setGrantingId(null);
      await fetchPending();
      await fetchGrants();
    } catch (err: any) {
      alert(`Couldn't stop the interruptions: ${err.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecision = async (actionId: string, decision: string) => {
    try {
      setProcessingId(actionId);
      const res = await fetch(`/api/approvals/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });

      if (!res.ok) throw new Error('Failed to submit decision');

      // Trust the server as the source of truth — re-fetch the pending list
      // instead of optimistically filtering locally. Previously a 200 with a
      // malformed body still passed the ok check and the action was removed
      // locally, then re-appeared on the next 10s poll, confusing operators.
      await fetchPending();
    } catch (err: any) {
      alert(`Decision failed: ${err.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  // "Clear expired" advances the org-level cleared-at cursor (a settings key,
  // same shape as the policy-review cursor) — the ledger rows stay untouched;
  // the expired lister just stops returning anything at/before the stamp.
  const handleClearExpired = async () => {
    try {
      setClearingExpired(true);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'approvals_expired_cleared_at',
          value: new Date().toISOString(),
          category: 'system',
        }),
      });
      if (!res.ok) throw new Error('Failed to clear expired approvals');
      setExpiredActions([]);
      await fetchPending({ silent: true });
    } catch (err: any) {
      alert(`Clear failed: ${err.message}`);
    } finally {
      setClearingExpired(false);
    }
  };

  const isDemo = isDemoMode();
  const canDecide = isAdmin && !isDemo;

  const pendingControls = useListControls(pendingActions, pendingColumns);
  const resolvedControls = useListControls(expiredActions, resolvedColumns);

  const selection = useSelection<any>(pendingControls.rows, (a) => a.action_id);
  useSelectAllHotkey(selection.toggleAll);

  // The pending queue is sort/search-narrowed client-side; a selected id must
  // never point at a row the operator can no longer see (see identities.tsx).
  useEffect(() => {
    const visibleIds = new Set(pendingControls.rows.map((a) => a.action_id));
    const pruned = selection.selectedIds.filter((id) => visibleIds.has(id));
    if (pruned.length !== selection.selectedIds.length) {
      selection.setSelected(pruned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingControls.rows]);

  const handleBulkApprove = async () => {
    // Defensive re-scope to currently-visible rows: the pruning effect keeps
    // the selection in sync, but a decision that can't be undone must never
    // trust a selection snapshot that could include a hidden/stale id (the
    // effect-race window between a render and this handler firing).
    const visibleIds = new Set(pendingControls.rows.map((a) => a.action_id));
    const ids = selection.selectedIds.filter((id) => visibleIds.has(id));
    if (ids.length === 0) return;
    setBulkFailure(null);
    const { ok, failed } = await bulkAction(ids, (id) =>
      fetch(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'allow' }),
      })
    );
    setPendingActions((prev) => prev.filter((a) => !ok.includes(a.action_id)));
    selection.clear();
    if (failed.length > 0) setBulkFailure({ verb: 'approve', ok: ok.length, failed: failed.length });
  };

  const handleBulkDeny = async () => {
    // Same call-time visible-ids re-scope as handleBulkApprove above.
    const visibleIds = new Set(pendingControls.rows.map((a) => a.action_id));
    const ids = selection.selectedIds.filter((id) => visibleIds.has(id));
    if (ids.length === 0) return;
    setBulkFailure(null);
    const { ok, failed } = await bulkAction(ids, (id) =>
      fetch(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'deny' }),
      })
    );
    setPendingActions((prev) => prev.filter((a) => !ok.includes(a.action_id)));
    selection.clear();
    if (failed.length > 0) setBulkFailure({ verb: 'deny', ok: ok.length, failed: failed.length });
  };

  const bulkActions = isAdmin ? [
    { id: 'approve', label: 'Approve', icon: Check, onClick: handleBulkApprove },
    { id: 'deny', label: 'Deny', icon: Ban, onClick: handleBulkDeny, danger: true },
  ] : [];

  return (
    <PageLayout
      title="Approval Queue"
      subtitle="Human-in-the-loop intervention for sensitive agent actions"
      breadcrumbs={['Operations', 'Approvals']}
      maturity="stable"
      actions={
        <>
          <button
            onClick={() => window.open('/widget', 'dashclaw-pulse', 'popup,width=360,height=560')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
            title="Open Pulse — a small always-on-top status window for this workspace"
            aria-label="Open the Pulse status window"
          >
            <AppWindow size={14} />
            Pulse
          </button>
          <button
            onClick={() => fetchPending()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:border-border-hover hover:text-white"
            aria-label="Refresh pending approvals"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} />
        </>
      }
    >
      <div className="mx-auto max-w-5xl">
        {/* F0: an approval queue whose gates don't stop anything must say so. */}
        <ObserveModeBanner />
        {/* Same class of honesty as the observe banner above: while a pause is
            live, an empty inbox means "not being asked", not "nothing needed
            you". Refetches the queue on resume so the two agree immediately. */}
        <ApprovalPauseBanner onResumed={() => fetchPending({ silent: true })} />
        <ApprovalFloodBanner onResolved={() => fetchPending({ silent: true })} />
        {queueError && (
          <Banner icon={AlertTriangle} tone="warning" title={queueError}>
            {lastSuccessfulRefresh
              ? `Showing the last successful result from ${lastSuccessfulRefresh}. Retry before assuming the queue is clear.`
              : 'No successful approval read is available. Retry before assuming the queue is clear.'}
          </Banner>
        )}
        {isDemo && (
          <Banner icon={Info} tone="neutral" title="Demo Mode">
            Approvals are read-only in the demo. Self-host to approve or deny actions for real agents.
          </Banner>
        )}
        {sessionSettled && !isAdmin && (
          <Banner icon={ShieldAlert} tone="warning" title="Read-only access">
            Only administrators can approve or deny actions. You are currently viewing as a member.
          </Banner>
        )}
        {bulkFailure && (
          <Banner
            icon={AlertTriangle}
            tone="warning"
            title={`Bulk ${bulkFailure.verb} partially failed`}
            onDismiss={() => setBulkFailure(null)}
          >
            {bulkFailure.ok} of {bulkFailure.ok + bulkFailure.failed} action{bulkFailure.ok + bulkFailure.failed === 1 ? '' : 's'} {bulkFailure.verb === 'approve' ? 'approved' : 'denied'}.
            {' '}{bulkFailure.failed} failed and {bulkFailure.failed === 1 ? 'remains' : 'remain'} pending &mdash; retry or resolve {bulkFailure.failed === 1 ? 'it' : 'them'} individually below.
          </Banner>
        )}

        {pendingPlans.length > 0 && (
          <div className="mb-4 space-y-4">
            {pendingPlans.map(({ plan, steps }) => (
              <PlanReviewCard
                key={plan.plan_id}
                plan={plan}
                steps={steps}
                canDecide={canDecide}
                onResolved={() => { fetchPendingPlans(); fetchPending({ silent: true }); }}
              />
            ))}
          </div>
        )}

        <LivePlansSection
          plans={livePlans}
          canDecide={canDecide}
          onResolved={() => { fetchPendingPlans(); fetchPending({ silent: true }); }}
        />

        <ContainmentSection
          actions={awaitingContainment}
          canDecide={canDecide}
          onResolvedAction={() => { fetchAwaitingContainment(); fetchPending({ silent: true }); }}
        />

        {/* Undo surface for "don't ask again". It sits above the queue, on the
            same page the grant was created from — a mute you can make in one
            click but need /policies to undo is not a finished feature. */}
        {isAdmin && <ActiveGrantsStrip grants={grants} onRevokedAction={fetchGrants} />}

        <CollapsibleSection
          id="approvals.pending"
          title="Pending approvals"
          icon={Clock}
          iconClassName="text-warning"
          count={pendingActions.length}
          badgeVariant="warning"
          controls={
            pendingActions.length > 0 ? (
              <ListControlsBar columns={pendingColumns} controls={pendingControls} searchPlaceholder="Search pending…" />
            ) : undefined
          }
          actions={
            pendingActions.length > 0 && isAdmin ? (
              <SelectCheckbox
                checked={selection.allSelected}
                onToggle={() => selection.toggleAll()}
                label="Select all"
              />
            ) : undefined
          }
        >
        {loading && !lastSuccessfulRefresh ? (
          <div className="py-12 text-center text-sm text-secondary" role="status">Loading approvals…</div>
        ) : pendingActions.length === 0 && !queueError ? (
          <div className="py-12">
            <EmptyState
              icon={Check}
              title="All clear"
              description="No actions currently require human approval."
            />
          </div>
        ) : (
          <div className="space-y-4">
            {pendingControls.rows.map((action) => {
              const systems = safeJsonArray(action.systems_touched) as string[];
              const isProcessing = processingId === action.action_id;
              const riskColor = action.risk_score >= 70 ? 'text-error' : 'text-warning';
              return (
                <Card key={action.action_id} data-entity-type="decision" data-entity-id={action.action_id} data-entity-status={action.status} data-entity-action-type={action.action_type} hover={false}>
                  <CardContent className="pt-5">
                    {isAdmin && (
                      <div className="mb-3">
                        <SelectCheckbox
                          checked={selection.isSelected(action.action_id)}
                          onToggle={(e) => { e.stopPropagation(); selection.selectClick(action.action_id, e.shiftKey); }}
                          label={`Select ${action.declared_goal || action.action_id}`}
                        />
                      </div>
                    )}
                    <div className="flex flex-col gap-6 md:flex-row">
                      {/* Action Content */}
                      <div className="flex-1 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <Badge variant="warning">Awaiting Approval</Badge>
                              {action.act_content_hash && (
                                <span title="This approval is bound to the exact recorded act: an agent retry presenting a different command or request re-queues for approval instead of reusing the grant.">
                                  <Badge variant="info" size="xs">Act-bound</Badge>
                                </span>
                              )}
                              {/* RFC 2026-08-13 §6: an operator approving a
                                  require_approval that came from an external
                                  escalate sees that is WHY they were asked. */}
                              {/* A 'not_applicable' skip (#219 scope filter) stays
                                  unlabeled here: this badge explains why the ask
                                  happened, and a never-consulted provider never
                                  caused an ask. The detail page shows the skip. */}
                              {action.external_verdict && action.external_verdict.regime !== 'not_applicable' && (
                                <span title={`External decision provider: ${action.external_verdict.provider_id}`}>
                                  <Badge
                                    variant={action.external_verdict.regime === 'external+local' ? 'info' : 'warning'}
                                    size="xs"
                                  >
                                    {action.external_verdict.regime === 'external+local'
                                      ? `External: ${action.external_verdict.raw_verdict}`
                                      : 'External unavailable'}
                                  </Badge>
                                </span>
                              )}
                              {action.plain?.confidence === 'unknown' && (
                                <Badge variant="default" size="xs">Not translated</Badge>
                              )}
                              <EntityLink
                                type="decision"
                                id={action.action_id}
                                name={action.action_id}
                                className="font-mono text-[11px] text-tertiary"
                              />
                            </div>
                            {action.plain?.headline ? (
                              <>
                                {action.plain?.reversible === false && (
                                  <div className="mb-3 flex items-start gap-2 rounded-r-lg border-l-2 border-error bg-error/10 px-3 py-2 text-sm text-error">
                                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                    <span><strong className="font-semibold">{IRREVERSIBLE_TEXT}</strong></span>
                                  </div>
                                )}
                                <h3
                                  className={`break-words text-lg font-semibold ${
                                    action.plain?.confidence === 'unknown' ? 'text-tertiary' : 'text-white'
                                  }`}
                                >
                                  {action.plain.headline}
                                </h3>
                                {action.plain?.detail && action.plain.confidence === 'unknown' && (
                                  <p className="mt-1.5 text-sm text-tertiary">{action.plain.detail}</p>
                                )}
                                {(action.plain?.warnings || []).map((w: string) => (
                                  <p key={w} className="mt-1.5 flex items-start gap-2 text-sm text-warning">
                                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                    <span>{w}</span>
                                  </p>
                                ))}
                                {/* A reassurance is the absence of a problem, so it must not
                                    wear the attention colour: amber is reserved for when
                                    attention is actually required (.impeccable.md). */}
                                {action.plain?.reassurance && (
                                  <p className="mt-1.5 flex items-start gap-2 text-sm text-tertiary">
                                    <Check size={14} className="mt-0.5 shrink-0" />
                                    <span>{action.plain.reassurance}</span>
                                  </p>
                                )}
                              </>
                            ) : null}
                            {/* Why the GUARD held this — the matched rule's own
                                sentence. Distinct from action.reasoning below,
                                which is the agent's self-report. An
                                assumption_hold names the stale assumption here. */}
                            {action.gating_reason && (
                              <p className="mt-2 break-words text-sm text-warning">
                                Held because: {action.gating_reason}
                              </p>
                            )}
                            <div className="mt-3">
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                Bound act {actionContext(action).act ? '(redacted)' : '(unavailable)'}
                              </div>
                              {actionContext(action).act ? (
                                <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-xs leading-relaxed text-secondary">
                                  {JSON.stringify(actionContext(action).act, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-xs text-warning">The canonical act was not recorded for this historical action.</p>
                              )}
                            </div>
                            <div className="mt-3">
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Recorded request</div>
                              <p className="break-words text-sm text-secondary">{action.declared_goal || 'No request supplied'}</p>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                              Risk
                            </div>
                            <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${riskColor}`}>
                              {action.risk_score || 0}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                          <div className="space-y-2.5">
                            <div className="flex items-center gap-2 text-tertiary">
                              <User size={14} />
                              <span>Agent</span>
                              <EntityLink
                                type="agent"
                                id={action.agent_id}
                                name={action.agent_name || action.agent_id}
                                className="ml-auto text-secondary"
                              />
                            </div>
                            <div className="flex items-center gap-2 text-tertiary">
                              <Zap size={14} />
                              <span>Type</span>
                              <span className="ml-auto text-secondary">{action.action_type}</span>
                            </div>
                            <div className="flex items-center gap-2 text-tertiary">
                              <Clock size={14} />
                              <span>Triggered</span>
                              <span className="ml-auto tabular-nums text-secondary">
                                {new Date(action.timestamp_start).toLocaleString()}
                              </span>
                            </div>
                            {action.approval_expires_at && (
                              <div className="flex items-center gap-2 text-tertiary">
                                <Hourglass size={14} />
                                <span>Expires</span>
                                <span className="ml-auto tabular-nums text-secondary">
                                  {new Date(action.approval_expires_at).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="space-y-2 rounded-lg border border-border bg-surface-tertiary p-3">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                              <Info size={10} /> Systems Touched
                            </div>
                            {systems.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {systems.map((s: string) => (
                                  <Badge key={s} variant="default" size="xs">{s}</Badge>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-tertiary">None declared</div>
                            )}
                          </div>
                        </div>

                        {action.reasoning && (
                          <blockquote className="rounded-lg border-l-2 border-border bg-surface-tertiary/50 px-4 py-2.5 text-sm italic text-secondary">
                            &ldquo;{action.reasoning}&rdquo;
                          </blockquote>
                        )}
                      </div>

                      {/* Actions Panel */}
                      <div className="flex flex-row justify-center gap-2 md:w-44 md:flex-col">
                        <button
                          onClick={() => handleDecision(action.action_id, 'allow')}
                          disabled={!canDecide || isProcessing}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-success/20 bg-success-subtle px-4 py-2.5 text-sm font-semibold text-success transition-colors hover:border-success/40 hover:bg-success-subtle focus:border-success/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Check size={16} /> Allow
                        </button>
                        {/* Risk ceiling. Above RISK_HIGH_MIN there is no button
                            to press — a grant minted here could not cover such
                            an action anyway (applyAllowGrants refuses it), so
                            offering one would be a promise the guard breaks. */}
                        {action.risk_score < RISK_HIGH_MIN ? (
                          <button
                            onClick={() => setGrantingId(grantingId === action.action_id ? null : action.action_id)}
                            disabled={!canDecide || isProcessing}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-surface-tertiary px-4 py-2.5 text-sm font-semibold text-secondary transition-colors hover:border-success/40 hover:text-success focus:border-success/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <BellOff size={16} /> Don&apos;t ask again
                          </button>
                        ) : (
                          <div className="flex-1 rounded-lg border border-border/60 px-3 py-2 text-center text-[11px] leading-snug text-tertiary">
                            Needs a human every time
                          </div>
                        )}
                        <button
                          onClick={() => handleDecision(action.action_id, 'deny')}
                          disabled={!canDecide || isProcessing}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-error/20 bg-error-subtle px-4 py-2.5 text-sm font-semibold text-error transition-colors hover:border-error/40 hover:bg-error-subtle focus:border-error/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X size={16} /> Deny
                        </button>
                      </div>
                    </div>

                    {grantingId === action.action_id && (
                      <DontAskAgainPanel
                        actionType={action.action_type}
                        targetLabel={grantPreview?.actionId === action.action_id ? (grantPreview?.target ?? 'No target') : 'Loading scope…'}
                        ttlHours={grantTtl}
                        onTtlChange={setGrantTtl}
                        onConfirm={() => handleGrant(action.action_id)}
                        onCancel={() => setGrantingId(null)}
                        matchCount={grantPreview?.actionId === action.action_id ? (grantPreview?.matching_count ?? 1) : 1}
                        truncated={Boolean(grantPreview?.actionId === action.action_id && grantPreview?.truncated)}
                        previewError={grantPreviewError}
                        previewPending={grantPreviewLoading || !grantPreview}
                        busy={isProcessing}
                      />
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        </CollapsibleSection>

        {expiredActions.length > 0 && (
          <div className="mt-10">
            <CollapsibleSection
              id="approvals.resolved"
              title="Expired"
              icon={Hourglass}
              count={expiredActions.length}
              controls={
                <ListControlsBar columns={resolvedColumns} controls={resolvedControls} searchPlaceholder="Search expired…" />
              }
              actions={
                canDecide ? (
                  <button
                    type="button"
                    onClick={handleClearExpired}
                    disabled={clearingExpired}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-tertiary transition-colors hover:border-border-hover hover:text-secondary disabled:opacity-50"
                    aria-label="Clear expired approvals from this list"
                  >
                    {clearingExpired ? 'Clearing…' : 'Clear expired'}
                  </button>
                ) : undefined
              }
            >
            <p className="mb-3 text-xs text-tertiary">
              These approvals outlived the requesting agent&rsquo;s wait window; approving them
              would release nothing. If the action is still wanted, have the agent retry it.
            </p>
            <div className="space-y-2">
              {resolvedControls.rows.map((action) => (
                <div
                  key={action.action_id}
                  data-entity-type="decision"
                  data-entity-id={action.action_id}
                  data-entity-status="expired"
                  data-entity-action-type={action.action_type}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-secondary px-4 py-2.5 opacity-70"
                >
                  <Badge variant="default" size="xs">Expired</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm text-secondary">{action.declared_goal}</span>
                  <EntityLink
                    type="agent"
                    id={action.agent_id}
                    name={action.agent_name || action.agent_id}
                    className="text-xs text-tertiary"
                  />
                  <span className="text-xs tabular-nums text-tertiary">
                    Requested {new Date(action.timestamp_start).toLocaleString()}
                  </span>
                  {action.approval_expires_at && (
                    <span className="text-xs tabular-nums text-tertiary">
                      Expired {new Date(action.approval_expires_at).toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
            </CollapsibleSection>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
