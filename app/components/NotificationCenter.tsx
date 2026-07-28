'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Bell, AlertTriangle, CheckCircle2, Info, XCircle, Check, Ban } from 'lucide-react';
import { useRealtime } from '../hooks/useRealtime';
import { useEffectiveRole } from '../hooks/useEffectiveRole';

interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface PendingApproval {
  action_id: string;
  agent_id?: string;
  agent_name?: string;
  declared_goal?: string;
  action_type?: string;
  risk_score?: number | string;
}

export default function NotificationCenter() {
  const { isAdmin } = useEffectiveRole();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [permission, setPermission] = useState('default');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Live pending approvals — the same data /approvals + the InterventionQueue
  // act on. Read for any authenticated org member (server-side auth + org scope);
  // only admins get the inline Approve/Deny controls.
  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch('/api/actions?status=pending_approval&limit=20', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPendingApprovals(Array.isArray(data.actions) ? data.actions : []);
    } catch {
      // Non-fatal — the bell just won't show pending approvals this cycle.
    }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const decide = useCallback(async (actionId: string, decision: 'allow' | 'deny') => {
    setDecidingId(actionId);
    // Optimistic removal — reconciled by the fetchPending() in finally.
    setPendingApprovals((prev) => prev.filter((a) => a.action_id !== actionId));
    try {
      await fetch(`/api/approvals/${actionId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
    } catch {
      // swallow — fetchPending() below restores the true server state
    } finally {
      setDecidingId(null);
      fetchPending();
    }
  }, [fetchPending]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  // Close on Escape or outside click while the popover is open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [isOpen]);

  const requestPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        addNotification('success', 'Notifications enabled.');
      }
    }
  };

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- compiler diagnostic only: it cannot prove this memo, but the [] deps are correct (reads only the stable setState and platform globals)
  const addNotification = useCallback((type: string, message: string, title = 'DashClaw') => {
    const newNotif: NotificationItem = {
      id: Date.now(),
      type,
      title,
      message,
      timestamp: new Date().toLocaleTimeString(),
      read: false
    };
    setNotifications(prev => [newNotif, ...prev].slice(0, 20));

    // Read live permission off the platform API instead of closing over the
    // React-state copy: a permission grant that lands between callback
    // memoization and an event firing would otherwise be missed.
    const currentPermission =
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'denied';
    if (currentPermission === 'granted' && type !== 'info') {
      new Notification(title, { body: message });
    }
  }, []);

  // Listen to real-time SSE events for governance notifications
  useRealtime(useCallback((event: string, payload: any) => {
    // Approval required — an agent is waiting for human decision
    if (event === 'action.created') {
      const action = payload?.action || payload;
      if (action?.status === 'pending_approval') {
        const agentName = action.agent_name || action.agent_id || 'An agent';
        const goal = action.declared_goal || action.action_type || 'action';
        addNotification('warning', `${agentName} needs approval: ${goal}`, 'Approval required');
      }
    }

    // Guard blocked an action
    if (event === 'guard.decision.created') {
      const decision = payload?.decision;
      if (decision?.decision === 'block') {
        const agentName = decision.agent_id || 'An agent';
        addNotification('error', `Action blocked for ${agentName}`, 'Guard policy');
      }
    }

    // Risk signal detected
    if (event === 'signal.detected') {
      const signalType = (payload?.type || 'risk signal').replace(/_/g, ' ');
      addNotification('error', `${signalType} detected`, 'Risk signal');
    }

    // Keep the pending-approvals list + badge fresh as actions arrive or resolve.
    if (event === 'action.created' || event === 'action.updated') {
      fetchPending();
    }
  }, [addNotification, fetchPending]));

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const pendingCount = pendingApprovals.length;
  const badgeCount = unreadCount + pendingCount;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'error': return <XCircle size={14} className="text-error" aria-hidden="true" />;
      case 'warning': return <AlertTriangle size={14} className="text-warning" aria-hidden="true" />;
      case 'success': return <CheckCircle2 size={14} className="text-success" aria-hidden="true" />;
      default: return <Info size={14} className="text-info" aria-hidden="true" />;
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={badgeCount > 0
          ? `Notifications · ${unreadCount} unread${pendingCount > 0 ? `, ${pendingCount} pending approval${pendingCount === 1 ? '' : 's'}` : ''}`
          : 'Notifications'}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="relative rounded-lg p-2 transition-colors duration-150 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-brand/40"
      >
        <Bell size={18} className="text-secondary" aria-hidden="true" />
        {badgeCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full border border-surface-primary bg-status-error px-1 text-[10px] font-semibold tabular-nums text-surface-primary"
          >
            {badgeCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-11 z-50 max-h-96 w-80 overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-3">
              {permission !== 'granted' && (
                <button onClick={requestPermission} className="text-xs text-brand transition-colors hover:text-brand-hover">
                  Enable
                </button>
              )}
              <button onClick={markAllRead} className="text-xs text-tertiary transition-colors hover:text-white">
                Mark read
              </button>
              <button onClick={clearAll} className="text-xs text-tertiary transition-colors hover:text-white">
                Clear
              </button>
            </div>
          </div>

          {pendingCount > 0 && (
            <div className="border-b border-border">
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
                  Pending approvals · {pendingCount}
                </span>
                <Link
                  href="/approvals"
                  onClick={() => setIsOpen(false)}
                  className="text-xs text-brand transition-colors hover:text-brand-hover"
                >
                  View all &rarr;
                </Link>
              </div>
              <div className="max-h-48 divide-y divide-border overflow-y-auto">
                {pendingApprovals.map((a) => (
                  <div
                    key={a.action_id}
                    data-entity-type="decision"
                    data-entity-id={a.action_id}
                    data-entity-status="pending_approval"
                    className="px-4 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-white">
                          {a.declared_goal || a.action_type || 'Action'}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-tertiary">
                          <span className="truncate">{a.agent_name || a.agent_id || 'agent'}</span>
                          {a.risk_score != null && a.risk_score !== '' && (
                            <span className="tabular-nums">risk {a.risk_score}</span>
                          )}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => decide(a.action_id, 'allow')}
                            disabled={decidingId === a.action_id}
                            aria-label={`Approve ${a.declared_goal || a.action_id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-success/30 px-2 py-1 text-[11px] font-medium text-success transition-colors hover:bg-success-subtle disabled:opacity-50"
                          >
                            <Check size={12} aria-hidden="true" /> Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => decide(a.action_id, 'deny')}
                            disabled={decidingId === a.action_id}
                            aria-label={`Deny ${a.declared_goal || a.action_id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-error/30 px-2 py-1 text-[11px] font-medium text-error transition-colors hover:bg-error-subtle disabled:opacity-50"
                          >
                            <Ban size={12} aria-hidden="true" /> Deny
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-tertiary">
                <Bell size={24} className="mb-2 text-disabled" aria-hidden="true" />
                <span className="text-sm">No notifications</span>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 transition-colors ${!notif.read ? 'bg-white/[0.02]' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 shrink-0">{getTypeIcon(notif.type)}</div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white">{notif.title}</div>
                          <div className="mt-0.5 text-xs text-secondary">{notif.message}</div>
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-tertiary">{notif.timestamp}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {permission !== 'granted' && (
            <div className="border-t border-border px-4 py-2.5 text-center">
              <button onClick={requestPermission} className="text-xs text-brand transition-colors hover:text-brand-hover">
                Enable browser notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
