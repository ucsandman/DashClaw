'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  CheckCircle2, Check, X, Loader2, ShieldAlert, Info,
} from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import { useRealtime } from '../hooks/useRealtime';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { isDemoMode } from '../lib/isDemoMode';
import { EntityLink } from '../components/context-menu/EntityLink';

function timeAgo(timestamp: any): string {
  if (!timestamp) return '';
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function safeVibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Vibration unsupported — not fatal.
  }
}

// Correlate pending actions to the guard decision that put them in
// pending_approval. The action_records table does not persist the matched
// policy, so we fetch /api/guard/decisions in parallel and match by
// (agent_id + declared_goal), falling back to the most recent require_approval
// decision for the same agent within a 5-minute window.
interface DecisionIndex {
  byGoal: Map<string, any>;
  byAgent: Map<string, any>;
}

function buildDecisionIndex(decisions: any[]): DecisionIndex {
  const byGoal = new Map<string, any>();
  const byAgent = new Map<string, any>();
  for (const d of decisions) {
    if (d.decision !== 'require_approval') continue;
    const agentKey = d.agent_id || '';
    if (d.declared_goal) {
      const goalKey = `${agentKey}|${d.declared_goal.toLowerCase()}`;
      if (!byGoal.has(goalKey)) byGoal.set(goalKey, d);
    }
    const existing = byAgent.get(agentKey);
    if (!existing || new Date(d.created_at) > new Date(existing.created_at)) {
      byAgent.set(agentKey, d);
    }
  }
  return { byGoal, byAgent };
}

function findMatchingDecision(action: any, index: DecisionIndex): any {
  const agentKey = action.agent_id || '';
  if (action.declared_goal) {
    const goalKey = `${agentKey}|${action.declared_goal.toLowerCase()}`;
    if (index.byGoal.has(goalKey)) return index.byGoal.get(goalKey);
  }
  const candidate = index.byAgent.get(agentKey);
  if (!candidate) return null;
  const actionTime = new Date(action.timestamp_start || action.created_at || 0).getTime();
  const decisionTime = new Date(candidate.created_at || 0).getTime();
  if (!Number.isFinite(actionTime) || !Number.isFinite(decisionTime)) return null;
  return Math.abs(actionTime - decisionTime) < 5 * 60 * 1000 ? candidate : null;
}

function extractPolicyLabel(decision: any): string | null {
  if (!decision) return null;
  const list = Array.isArray(decision.matched_policies) ? decision.matched_policies : [];
  const top = list[0];
  if (!top) return null;
  return top.name || top.policy_name || top.id || top.policy_id || null;
}

function enrichWithPolicyContext(rawActions: any[], rawDecisions: any[]): any[] {
  const index = buildDecisionIndex(rawDecisions);
  return rawActions.map((action) => {
    const match = findMatchingDecision(action, index);
    return {
      ...action,
      _matchedPolicy: extractPolicyLabel(match),
      _guardReason: match?.reason || null,
    };
  });
}

function SkeletonCard() {
  return (
    <div className="h-40 animate-pulse rounded-xl border border-border bg-surface-secondary" />
  );
}

export default function ApprovePage() {
  const { isAdmin, authenticated, settled: sessionSettled } = useEffectiveRole();
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pullOffset, setPullOffset] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullStartY = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isDemo = isDemoMode();
  const canDecide = isAdmin && !isDemo;

  const fetchPending = useCallback(async () => {
    setError(false);
    try {
      // Fetch pending actions and require_approval guard decisions in parallel.
      // The guard decisions supply the matched policy + reason that the actions
      // table doesn't persist. Decision fetch is best-effort — if it fails
      // (e.g. demo mode returns 403), we fall back to the agent's own reasoning.
      const [actionsRes, decisionsRes] = await Promise.all([
        fetch('/api/actions?status=pending_approval&limit=50', { cache: 'no-store' }),
        fetch('/api/guard/decisions?decision=require_approval&limit=100', { cache: 'no-store' })
          .catch(() => null),
      ]);
      if (!actionsRes.ok) throw new Error('Failed to load pending actions');
      const actionsJson = await actionsRes.json();
      const rawActions = Array.isArray(actionsJson.actions) ? actionsJson.actions : [];

      let rawDecisions: any[] = [];
      if (decisionsRes && decisionsRes.ok) {
        try {
          const decisionsJson = await decisionsRes.json();
          rawDecisions = Array.isArray(decisionsJson.decisions) ? decisionsJson.decisions : [];
        } catch {
          // Non-JSON response — skip enrichment.
        }
      }

      setActions(enrichWithPolicyContext(rawActions, rawDecisions));
    } catch {
      // Network / auth failure — surface a visible error state with Retry.
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch once session is known (or demo mode).
  useEffect(() => {
    if (!sessionSettled) return;
    if (!authenticated) {
      setLoading(false);
      return;
    }
    fetchPending();
  }, [sessionSettled, authenticated, fetchPending]);

  // Service worker registration for PWA install.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failures are non-fatal — the page still works.
    });
  }, []);

  // Online/offline status drives the realtime dot.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setConnected(navigator.onLine !== false);
    const handleOnline = () => setConnected(true);
    const handleOffline = () => setConnected(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Re-fetch on realtime action events.
  useRealtime((event) => {
    if (event === 'action.created' || event === 'action.updated') {
      fetchPending();
    }
  });

  // PWA home-screen icon badge — reflects pending count so the installed app
  // shows a live "N waiting" dot. Supported on iOS 16.4+, modern Chrome, Edge.
  // Graceful no-op on unsupported browsers.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const count = actions.length;
    try {
      if (count > 0 && typeof (navigator as any).setAppBadge === 'function') {
        (navigator as any).setAppBadge(count).catch(() => {});
      } else if (typeof (navigator as any).clearAppBadge === 'function') {
        (navigator as any).clearAppBadge().catch(() => {});
      }
    } catch {
      // setAppBadge unsupported or blocked — not fatal.
    }
  }, [actions.length]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const handleDecision = useCallback(async (actionId: string, decision: string) => {
    setProcessingId(actionId);
    safeVibrate(decision === 'allow' ? 10 : [10, 50, 10]);
    try {
      const res = await fetch(`/api/approvals/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) {
        let message = 'Decision failed';
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          // Ignore JSON parse failure — fall back to default message.
        }
        throw new Error(message);
      }
      setRemovingId(actionId);
      setTimeout(() => {
        setActions((prev) => prev.filter((a) => a.action_id !== actionId));
        setRemovingId(null);
      }, 220);
    } catch (err: any) {
      showToast(err.message || 'Decision failed');
    } finally {
      setProcessingId(null);
    }
  }, [showToast]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPending();
  }, [fetchPending]);

  // Pull-to-refresh — only engages when already scrolled to the top.
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    if (scrollRef.current.scrollTop <= 0) {
      pullStartY.current = e.touches[0]!.clientY;
    }
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (pullStartY.current === null) return;
    const delta = e.touches[0]!.clientY - pullStartY.current;
    if (delta > 0) {
      setPullOffset(Math.min(delta, 90));
    }
  };
  const onTouchEnd = () => {
    if (pullOffset > 60 && !refreshing) {
      handleRefresh();
    }
    setPullOffset(0);
    pullStartY.current = null;
  };

  // --- Render states ---

  if (!sessionSettled) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-tertiary" size={24} aria-label="Loading" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-xs text-center">
          <div className="mb-4 flex justify-center"><DashClawLogo size={40} /></div>
          <h1 className="mb-2 text-base font-semibold text-white">Sign in to approve actions</h1>
          <p className="mb-6 text-sm text-secondary">
            Authentication is required to review and decide on pending agent actions.
          </p>
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-active/30 bg-brand/10 px-4 text-sm font-semibold text-brand transition-colors hover:border-active/50 hover:bg-brand/20"
          >
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  const pendingCount = actions.length;

  return (
    <div>
      {/* Fixed header with safe-area padding for iOS notch */}
      <header
        className="fixed inset-x-0 top-0 z-20 border-b border-border bg-surface-primary/90 backdrop-blur-sm"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <DashClawLogo size={20} />
            <span className="text-sm font-semibold text-white">Approvals</span>
          </div>
          <div className="flex items-center gap-1.5" role="status"
               aria-label={connected ? 'Realtime connected' : 'Realtime reconnecting'}>
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
              }`}
            />
          </div>
        </div>
      </header>

      {/* Scroll container — content starts below the fixed header */}
      <div
        ref={scrollRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="px-4"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4.25rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 3rem)',
          transform: pullOffset > 0 ? `translateY(${pullOffset / 2}px)` : undefined,
          transition: pullOffset === 0 ? 'transform 200ms ease' : undefined,
        }}
      >
        {refreshing && (
          <div className="flex justify-center py-2" aria-hidden="true">
            <Loader2 className="animate-spin text-tertiary" size={16} />
          </div>
        )}

        {/* Status / count bar */}
        <div className="mb-4">
          {isDemo && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-border-hover bg-white/[0.02] p-3 text-xs text-secondary">
              <Info size={14} className="mt-0.5 shrink-0 text-tertiary" />
              <span>Demo mode — approvals are read-only. Self-host to decide for real agents.</span>
            </div>
          )}
          {!isDemo && !isAdmin && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning-subtle p-3 text-xs text-amber-200">
              <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" />
              <span>Admin access required to approve actions.</span>
            </div>
          )}
          {loading ? (
            <div className="text-sm text-tertiary">Loading pending actions…</div>
          ) : error ? (
            <div className="text-sm text-error">Failed to load pending actions.</div>
          ) : pendingCount === 0 ? (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 size={16} />
              All clear — no actions pending
            </div>
          ) : (
            <div className="text-sm text-secondary">
              {pendingCount} {pendingCount === 1 ? 'action' : 'actions'} awaiting your decision
            </div>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-border bg-surface-secondary py-12 text-center">
            <div className="mb-3 text-sm text-error">Failed to load pending actions.</div>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover"
            >
              Retry
            </button>
          </div>
        ) : pendingCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle2 className="mb-4 text-success" size={48} aria-hidden="true" />
            <h2 className="mb-1 text-base font-semibold text-white">All clear</h2>
            <p className="text-sm text-secondary">No actions waiting for approval</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {actions.map((action) => {
              const risk = Number(action.risk_score) || 0;
              const riskColor =
                risk >= 70 ? 'text-error' : risk >= 40 ? 'text-warning' : 'text-secondary';
              const isProcessing = processingId === action.action_id;
              const isRemoving = removingId === action.action_id;
              return (
                <li
                  key={action.action_id}
                  className={`rounded-xl border border-border bg-surface-secondary p-4 transition-opacity duration-200 ${
                    isRemoving ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-white break-words">
                        {action.declared_goal || 'Untitled action'}
                      </h3>
                      <p className="mt-0.5 truncate text-sm text-secondary">
                        {action.agent_id ? (
                          <EntityLink type="agent" id={action.agent_id} name={action.agent_name || action.agent_id} />
                        ) : (
                          action.agent_name || 'unknown agent'
                        )}
                      </p>
                    </div>
                    <div
                      className={`shrink-0 text-2xl font-semibold tabular-nums ${riskColor}`}
                      aria-label={`Risk score ${risk}`}
                    >
                      {risk}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md border border-border-hover bg-white/[0.02] px-2 py-0.5 font-mono text-xs font-medium text-secondary">
                      {action.action_type || 'action'}
                    </span>
                    <span className="tabular-nums text-xs text-tertiary">
                      {timeAgo(action.timestamp_start || action.created_at)}
                    </span>
                  </div>

                  {(action._matchedPolicy || action._guardReason || action.reasoning) && (
                    <div className="mt-3 rounded-lg border border-border bg-white/[0.02] p-2.5">
                      {action._matchedPolicy && (
                        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">
                          <ShieldAlert size={10} className="text-brand" />
                          Triggered by
                          <EntityLink
                            type="policy"
                            id={action._matchedPolicy}
                            name={action._matchedPolicy}
                            className="ml-1 font-mono normal-case tracking-normal text-secondary"
                          />
                        </div>
                      )}
                      {(action._guardReason || action.reasoning) && (
                        <p className={`text-xs text-secondary ${action._matchedPolicy ? 'mt-1' : ''}`}>
                          {action._guardReason || action.reasoning}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleDecision(action.action_id, 'allow')}
                      disabled={!canDecide || isProcessing || isRemoving}
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-success/30 bg-success-subtle px-4 text-sm font-semibold text-success transition-colors hover:border-success/50 hover:bg-success-subtle disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Allow action ${action.action_id}`}
                    >
                      {isProcessing ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                      Allow
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDecision(action.action_id, 'deny')}
                      disabled={!canDecide || isProcessing || isRemoving}
                      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-error/30 bg-error-subtle px-4 text-sm font-semibold text-error transition-colors hover:border-error/50 hover:bg-error-subtle disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={`Deny action ${action.action_id}`}
                    >
                      {isProcessing ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <X size={16} />
                      )}
                      Deny
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Toast (error feedback) */}
      {toast && (
        <div
          className="fixed inset-x-4 z-30 rounded-lg border border-error/30 bg-error-subtle p-3 text-center text-sm text-error"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
          role="alert"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
