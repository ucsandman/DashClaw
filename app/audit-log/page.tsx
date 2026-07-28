'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Clock, KeyRound, Mail, UsersRound, Settings,
  ShieldAlert, Webhook, Filter, ChevronDown, User, Cog, BarChart3, Copy,
} from 'lucide-react';
import Image from 'next/image';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { isDemoMode } from '../lib/isDemoMode';
import { demoAuditLogs, demoAuditStats } from '../lib/demoAuditData';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';

export default function AuditLogPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // "now" is stamped when a fetch lands, not read during render — relative
  // times measure against the data's freshness and keep render pure.
  const [now, setNow] = useState(() => Date.now());

  // Filters
  const [actionFilter, setActionFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  // Pagination. offset is a ref (not state) so fetchLogs does not depend on it —
  // otherwise paging would recreate fetchLogs and re-fire the reset effect,
  // snapping "Load more" back to page 0.
  const offsetRef = useRef(0);
  const limit = 50;

  const fetchLogs = useCallback(async (reset = false) => {
    try {
      setNow(Date.now());
      if (reset) {
        setLoading(true);
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }

      if (isDemoMode()) {
        await new Promise((r) => setTimeout(r, 600));
        let filteredLogs = [...demoAuditLogs];
        if (actionFilter !== 'all') {
          filteredLogs = filteredLogs.filter(l => l.action === actionFilter);
        }

        if (reset) {
          setLogs(filteredLogs);
        } else {
          setLogs((prev) => [...prev, ...filteredLogs]);
        }
        setStats(demoAuditStats);
        setHasMore(false);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const currentOffset = reset ? 0 : offsetRef.current;
      const params = new URLSearchParams({ limit: limit.toString(), offset: currentOffset.toString() });
      if (actionFilter !== 'all') {
        params.set('action', actionFilter);
      }

      const res = await fetch(`/api/activity?${params}`);
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Failed to load audit logs');
        return;
      }

      const newItems = json.events || [];
      if (reset) {
        setLogs(newItems);
      } else {
        setLogs((prev) => [...prev, ...newItems]);
      }

      setStats(json.stats || { total: json.total || 0, today: 0, unique_actors: 0 });
      setHasMore(newItems.length === limit);

      // Advance the running offset by the actual items loaded (covers both the
      // reset and load-more paths; no duplicate first page).
      offsetRef.current = currentOffset + newItems.length;
    } catch {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [actionFilter, limit]);

  useEffect(() => {
    fetchLogs(true);
  }, [actionFilter, fetchLogs]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchLogs(false);
    }
  };

  const selection = useSelection<any>(logs, (log) => log.id);
  useSelectAllHotkey(selection.toggleAll);

  const handleCopyIds = () => {
    if (selection.count === 0) return;
    if (typeof navigator !== 'undefined') navigator.clipboard?.writeText(selection.selectedIds.join('\n'));
  };

  const BULK_ACTIONS = [{ id: 'copy-ids', label: 'Copy IDs', icon: Copy, onClick: handleCopyIds }];

  const getActionIcon = (action: string) => {
    if (action.startsWith('key.')) return KeyRound;
    if (action.startsWith('invite.')) return Mail;
    if (action.startsWith('member.') || action.startsWith('role.')) return UsersRound;
    if (action.startsWith('setting.')) return Settings;
    if (action.startsWith('usage.')) return BarChart3;
    if (action.startsWith('webhook.')) return Webhook;
    if (action.startsWith('signal.') || action.startsWith('alert.')) return ShieldAlert;
    return Cog;
  };

  const formatActionLabel = (action: string) => {
    return action
      .split('.')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatRelativeTime = (dateStr: any) => {
    const then = new Date(dateStr).getTime();
    const diff = now - then;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return `${seconds}s ago`;
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const parseDetails = (detailsStr: any) => {
    if (!detailsStr) return null;
    try {
      const parsed = JSON.parse(detailsStr);
      return Object.keys(parsed).length > 0 ? parsed : null;
    } catch {
      return null;
    }
  };

  const getActorLabel = (log: any) => {
    if (log.actor_name) return log.actor_name;
    if (log.actor_type === 'system') return '(system)';
    if (log.actor_type === 'cron') return '(cron)';
    return log.actor_id || 'Unknown';
  };

  const actionTypes = [
    { value: 'all', label: 'All actions' },
    { value: 'key.created', label: 'API key created' },
    { value: 'key.revoked', label: 'API key revoked' },
    { value: 'invite.created', label: 'Invite created' },
    { value: 'invite.revoked', label: 'Invite revoked' },
    { value: 'invite.accepted', label: 'Invite accepted' },
    { value: 'role.changed', label: 'Role changed' },
    { value: 'member.removed', label: 'Member removed' },
    { value: 'member.left', label: 'Member left' },
    { value: 'setting.updated', label: 'Setting updated' },
    { value: 'setting.deleted', label: 'Setting deleted' },
    { value: 'usage.limit_reached', label: 'Usage limit reached' },
    { value: 'webhook.created', label: 'Webhook created' },
    { value: 'webhook.deleted', label: 'Webhook deleted' },
    { value: 'webhook.tested', label: 'Webhook tested' },
    { value: 'webhook.fired', label: 'Webhook fired' },
    { value: 'signal.detected', label: 'Signal detected' },
    { value: 'alert.email_sent', label: 'Alert email sent' },
  ];

  if (loading) {
    return (
      <PageLayout agentFilter={false}
        title="Audit log"
        subtitle="Permanent record of system and administrative events"
        breadcrumbs={['Evidence', 'Audit log']}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-0 overflow-hidden rounded-xl border border-border bg-surface-secondary sm:grid-cols-3 sm:divide-x sm:divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4">
                <div className="h-3 w-20 animate-pulse rounded bg-white/5" />
                <div className="mt-2 h-7 w-16 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-xl border border-border bg-surface-secondary p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout agentFilter={false}
      title="Audit log"
      subtitle="Permanent record of system and administrative events"
      breadcrumbs={['Evidence', 'Audit log']}
      actions={
        <>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
            aria-expanded={showFilters}
          >
            <Filter size={14} aria-hidden="true" />
            Filters
            <ChevronDown size={12} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          <BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />
        </>
      }
    >
      {/* Error banner */}
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-lg border border-error/30 bg-error-subtle p-3 text-sm text-error">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-4 rounded px-2 py-0.5 text-error transition-colors hover:bg-error-subtle hover:text-error"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Instrument rail */}
      <div className="mb-6 grid grid-cols-1 gap-0 overflow-hidden rounded-xl border border-border bg-surface-secondary sm:grid-cols-3 sm:divide-x sm:divide-border">
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total events</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{stats?.total || 0}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Today</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-brand">{stats?.today || 0}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Unique actors</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-info">{stats?.unique_actors || 0}</div>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="mb-6 rounded-xl border border-border bg-surface-secondary p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="action-filter" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              Action type
            </label>
            <select
              id="action-filter"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-sm text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
            >
              {actionTypes.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Activity timeline */}
      <Card hover={false}>
        <CardContent className="pt-0">
          {logs.length === 0 ? (
            <div className="py-6">
              <EmptyState
                icon={Clock}
                title="No activity logs"
                description="Activity will appear here as changes are made to your workspace."
              />
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                <SelectCheckbox
                  checked={selection.allSelected}
                  onToggle={() => selection.toggleAll()}
                  label="Select all"
                />
                <span className="text-xs text-tertiary">Select all</span>
              </div>
              <div className="divide-y divide-border">
              {logs.map((log) => {
                const ActionIcon = getActionIcon(log.action);
                const details = parseDetails(log.details);

                return (
                  <div key={log.id} data-entity-type="auditEvent" data-entity-id={log.id} className="flex items-start gap-4 py-4">
                    <div className="mt-1 flex h-8 shrink-0 items-center">
                      <SelectCheckbox
                        checked={selection.isSelected(log.id)}
                        onToggle={(e) => { e.stopPropagation(); selection.selectClick(log.id, e.shiftKey); }}
                        label={`Select ${formatActionLabel(log.action) ?? log.id}`}
                      />
                    </div>

                    {/* Icon */}
                    <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-tertiary">
                      <ActionIcon size={14} className="text-secondary" aria-hidden="true" />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      {/* Action label */}
                      <div className="mb-1 text-sm font-medium text-secondary">
                        {formatActionLabel(log.action)}
                      </div>

                      {/* Actor */}
                      <div className="mb-1 flex items-center gap-2">
                        {log.actor_image ? (
                          <Image
                            src={log.actor_image}
                            alt=""
                            width={16}
                            height={16}
                            unoptimized
                            className="h-4 w-4 rounded-full"
                          />
                        ) : (
                          <User size={12} className="text-tertiary" aria-hidden="true" />
                        )}
                        <span className="text-xs text-secondary">
                          {getActorLabel(log)}
                        </span>
                        {(log.actor_type === 'system' || log.actor_type === 'cron') && (
                          <Badge variant="default" size="xs">{log.actor_type}</Badge>
                        )}
                      </div>

                      {/* Resource ID */}
                      {log.resource_id && (
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                            {log.resource_type}
                          </span>
                          <code className="font-mono text-xs text-secondary">
                            {log.resource_id.length > 24
                              ? `${log.resource_id.substring(0, 24)}…`
                              : log.resource_id}
                          </code>
                        </div>
                      )}

                      {/* Details */}
                      {details && (
                        <div className="mt-2 rounded-lg border border-border bg-surface-tertiary p-3">
                          <div className="space-y-1">
                            {Object.entries(details).map(([key, value]) => (
                              <div key={key} className="flex items-start gap-3">
                                <span className="min-w-[80px] text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                  {key}
                                </span>
                                <span className="flex-1 break-words text-xs text-secondary">
                                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Timestamp */}
                    <div className="shrink-0 text-right">
                      <div className="flex items-center justify-end gap-1 text-xs tabular-nums text-secondary">
                        <Clock size={10} aria-hidden="true" />
                        {formatRelativeTime(log.created_at)}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-tertiary">
                        {new Date(log.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </>
          )}

          {/* Load More */}
          {logs.length > 0 && hasMore && (
            <div className="border-t border-border pb-2 pt-4 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="rounded-lg border border-border bg-surface-tertiary px-4 py-1.5 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </PageLayout>
  );
}
