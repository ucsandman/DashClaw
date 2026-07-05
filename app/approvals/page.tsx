'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, Check, X, Clock, User, Zap,
  RefreshCw, Info, Ban, Hourglass,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { isDemoMode } from '../lib/isDemoMode';
import { parseJsonArray as safeJsonArray } from '../lib/parseJson';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { useRealtime } from '../hooks/useRealtime';
import { useAgentFilter } from '../lib/AgentFilterContext';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';
import { EntityLink } from '../components/context-menu/EntityLink';
import ApprovalFloodBanner from '../components/ApprovalFloodBanner';

type BannerTone = 'neutral' | 'warning';

interface BannerProps {
  icon: React.ElementType;
  tone: BannerTone;
  title: React.ReactNode;
  children?: React.ReactNode;
}

function Banner({ icon: Icon, tone, title, children }: BannerProps) {
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
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]">{title}</div>
        <p className="mt-1 text-xs text-secondary">{children}</p>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const { agentId } = useAgentFilter();
  const [pendingActions, setPendingActions] = useState<any[]>([]);
  const [expiredActions, setExpiredActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const { isAdmin, settled: sessionSettled } = useEffectiveRole();

  const fetchPending = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true);
      const agentQs = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
      const res = await fetch(`/api/actions?status=pending_approval&limit=50${agentQs}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load pending actions');
      const json = await res.json();
      setPendingActions(json.actions || []);
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
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchPending();
    const interval = setInterval(() => fetchPending({ silent: true }), 10000); // Fallback poll
    return () => clearInterval(interval);
  }, [fetchPending]);

  // Realtime: clear instantly when an approval is resolved anywhere (another
  // channel, the widget, /approve) rather than waiting up to 10s for the poll.
  useRealtime((event) => {
    if (event === 'action.created' || event === 'action.updated' || event === 'guard.decision.created') {
      fetchPending({ silent: true });
    }
  });

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

  const isDemo = isDemoMode();
  const canDecide = isAdmin && !isDemo;

  const selection = useSelection<any>(pendingActions, (a) => a.action_id);
  useSelectAllHotkey(selection.toggleAll);

  const handleBulkApprove = async () => {
    const ids = selection.selectedIds;
    const { ok } = await bulkAction(ids, (id) =>
      fetch(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'allow' }),
      })
    );
    setPendingActions((prev) => prev.filter((a) => !ok.includes(a.action_id)));
    selection.clear();
  };

  const handleBulkDeny = async () => {
    const ids = selection.selectedIds;
    const { ok } = await bulkAction(ids, (id) =>
      fetch(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'deny' }),
      })
    );
    setPendingActions((prev) => prev.filter((a) => !ok.includes(a.action_id)));
    selection.clear();
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
        <ApprovalFloodBanner onResolved={() => fetchPending({ silent: true })} />
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

        {pendingActions.length > 0 && isAdmin && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-secondary">
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all"
            />
            <span>Select all</span>
          </div>
        )}

        {pendingActions.length === 0 ? (
          <div className="py-12">
            <EmptyState
              icon={Check}
              title="All clear"
              description="No actions currently require human approval."
            />
          </div>
        ) : (
          <div className="space-y-4">
            {pendingActions.map((action) => {
              const systems = safeJsonArray(action.systems_touched) as string[];
              const isProcessing = processingId === action.action_id;
              const riskColor = action.risk_score >= 70 ? 'text-error' : 'text-warning';
              return (
                <Card key={action.action_id} data-entity-type="decision" data-entity-id={action.action_id} data-entity-status={action.status} hover={false}>
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
                                <span title="This approval is bound to the exact recorded act — an agent retry presenting a different command or request re-queues for approval instead of reusing the grant.">
                                  <Badge variant="info" size="xs">Act-bound</Badge>
                                </span>
                              )}
                              <EntityLink
                                type="decision"
                                id={action.action_id}
                                name={action.action_id}
                                className="font-mono text-[11px] text-tertiary"
                              />
                            </div>
                            <h3 className="text-lg font-semibold text-white">{action.declared_goal}</h3>
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
                        <button
                          onClick={() => handleDecision(action.action_id, 'deny')}
                          disabled={!canDecide || isProcessing}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-error/20 bg-error-subtle px-4 py-2.5 text-sm font-semibold text-error transition-colors hover:border-error/40 hover:bg-error-subtle focus:border-error/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X size={16} /> Deny
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {expiredActions.length > 0 && (
          <div className="mt-10">
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              <Hourglass size={12} /> Expired
            </div>
            <p className="mb-3 text-xs text-tertiary">
              These approvals outlived the requesting agent&rsquo;s wait window — approving them
              would release nothing. If the action is still wanted, have the agent retry it.
            </p>
            <div className="space-y-2">
              {expiredActions.map((action) => (
                <div
                  key={action.action_id}
                  data-entity-type="decision"
                  data-entity-id={action.action_id}
                  data-entity-status="expired"
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
          </div>
        )}
      </div>
    </PageLayout>
  );
}
