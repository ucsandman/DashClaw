'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Webhook, Plus, Trash2, Play, Check, Copy, ChevronDown, ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { isDemoMode } from '../lib/isDemoMode';
import { demoWebhooks, demoWebhookDeliveries } from '../lib/demoWebhooksData';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';

const WEBHOOK_TEMPLATES = [
  {
    name: 'Slack',
    description: 'Send notifications to a Slack channel via Incoming Webhook',
    urlPlaceholder: 'https://hooks.slack.com/services/T.../B.../...',
    defaultEvents: ['all'],
  },
  {
    name: 'Discord',
    description: 'Post alerts to a Discord channel via webhook URL',
    urlPlaceholder: 'https://discord.com/api/webhooks/...',
    defaultEvents: ['all'],
  },
  {
    name: 'PagerDuty',
    description: 'Trigger PagerDuty incidents (Events v2), append ?routing_key=YOUR_KEY',
    urlPlaceholder: 'https://events.pagerduty.com/v2/enqueue?routing_key=YOUR_ROUTING_KEY',
    defaultEvents: ['autonomy_spike', 'high_impact_low_oversight', 'repeated_failures'],
  },
  {
    name: 'Microsoft Teams',
    // Teams Workflows webhook (the old outlook.office.com connector URLs are retired).
    description: 'Post Adaptive Cards to a Teams channel via a Workflows webhook',
    urlPlaceholder: 'https://prod-00.westus.logic.azure.com/workflows/.../triggers/manual/paths/invoke?...',
    defaultEvents: ['all'],
  },
  {
    name: 'Generic REST',
    description: 'Send JSON payloads to any HTTPS endpoint',
    urlPlaceholder: 'https://your-api.example.com/webhook',
    defaultEvents: ['all'],
  },
];

// Mirrors VALID_EVENT_TYPES in app/api/webhooks/route.ts — keep in sync.
const EVENT_TYPES = [
  { value: 'all', label: 'All events' },
  { value: 'autonomy_spike', label: 'Autonomy spike' },
  { value: 'high_impact_low_oversight', label: 'High impact, low oversight' },
  { value: 'repeated_failures', label: 'Repeated failures' },
  { value: 'stale_loop', label: 'Stale loop' },
  { value: 'assumption_drift', label: 'Assumption drift' },
  { value: 'stale_assumption', label: 'Stale assumption' },
  { value: 'stale_running_action', label: 'Stale running action' },
  { value: 'approval_pending', label: 'Approval pending' },
  { value: 'approval_granted', label: 'Approval granted' },
  { value: 'approval_denied', label: 'Approval denied' },
];

export default function WebhooksPage() {
  const { isAdmin } = useEffectiveRole();
  const isDemo = isDemoMode();
  const canEdit = isAdmin && !isDemo;

  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add webhook form
  const [showAddForm, setShowAddForm] = useState(false);
  const [url, setUrl] = useState('');
  const [urlPlaceholder, setUrlPlaceholder] = useState('https://example.com/webhook');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['all']);
  const [creating, setCreating] = useState(false);

  // Newly created webhook (show secret once)
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Test results
  const [testResults, setTestResults] = useState<Record<string, any>>({});

  // Delivery history
  const [expandedWebhook, setExpandedWebhook] = useState<any>(null);
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, any[]>>({});
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  const fetchWebhooks = useCallback(async () => {
    try {
      if (isDemoMode()) {
        await new Promise((r) => setTimeout(r, 600));
        setWebhooks(demoWebhooks);
        setLoading(false);
        return;
      }
      const res = await fetch('/api/webhooks');
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load webhooks');
        setLoading(false);
        return;
      }
      setWebhooks(json.webhooks || []);
    } catch {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const handleEventToggle = (eventValue: string) => {
    if (eventValue === 'all') {
      setSelectedEvents(['all']);
    } else {
      const withoutAll = selectedEvents.filter((e) => e !== 'all');
      if (withoutAll.includes(eventValue)) {
        const updated = withoutAll.filter((e) => e !== eventValue);
        setSelectedEvents(updated.length === 0 ? ['all'] : updated);
      } else {
        setSelectedEvents([...withoutAll, eventValue]);
      }
    }
  };

  const handleCreate = async () => {
    if (!url.trim()) return;
    if (!url.startsWith('https://')) {
      setError('Webhook URL must use HTTPS');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events: selectedEvents }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to create webhook');
        return;
      }
      setNewSecret(json.webhook.secret);
      setUrl('');
      setSelectedEvents(['all']);
      setShowAddForm(false);
      await fetchWebhooks();
    } catch {
      setError('Failed to create webhook');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: any) => {
    if (!confirm('Delete this webhook? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/webhooks?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Failed to delete webhook');
        return;
      }
      await fetchWebhooks();
    } catch {
      setError('Failed to delete webhook');
    }
  };

  const handleTest = async (id: any) => {
    if (isDemoMode()) {
      setTestResults({ ...testResults, [id]: 'testing' });
      await new Promise((r) => setTimeout(r, 1000));
      setTestResults({ ...testResults, [id]: { success: true, status: 200 } });
      return;
    }
    setTestResults({ ...testResults, [id]: 'testing' });
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setTestResults({ ...testResults, [id]: { success: false, status: json.response_status || 0 } });
        return;
      }
      setTestResults({ ...testResults, [id]: { success: json.success, status: json.response_status } });
    } catch {
      setTestResults({ ...testResults, [id]: { success: false, status: 0 } });
    }
  };

  const toggleDeliveries = async (webhookId: any) => {
    if (expandedWebhook === webhookId) {
      setExpandedWebhook(null);
      return;
    }

    setExpandedWebhook(webhookId);
    if (deliveries[webhookId]) return;

    setLoadingDeliveries(true);
    try {
      if (isDemoMode()) {
        await new Promise((r) => setTimeout(r, 400));
        setDeliveries({ ...deliveries, [webhookId]: (demoWebhookDeliveries as Record<string, any>)[webhookId] || [] });
        return;
      }
      const res = await fetch(`/api/webhooks/${webhookId}/deliveries`);
      const json = await res.json();
      if (res.ok) {
        setDeliveries({ ...deliveries, [webhookId]: json.deliveries || [] });
      }
    } catch {
      // Non-critical
    } finally {
      setLoadingDeliveries(false);
    }
  };

  const handleCopySecret = () => {
    if (newSecret) {
      navigator.clipboard.writeText(newSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const stats = {
    total: webhooks.length,
    active: webhooks.filter((w) => w.active).length,
    failed: webhooks.filter((w) => w.failure_count > 0).length,
  };

  const selection = useSelection<any>(webhooks, (w) => w.id);
  useSelectAllHotkey(selection.toggleAll);

  async function bulkDelete() {
    if (selection.count === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${selection.count} webhook${selection.count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const { ok } = await bulkAction(selection.selectedIds, (id) => fetch(`/api/webhooks?id=${encodeURIComponent(id)}`, { method: 'DELETE' }));
    setWebhooks((prev) => prev.filter((x) => !ok.includes(x.id)));
    selection.clear();
  }

  const BULK_ACTIONS = [
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: bulkDelete, danger: true },
  ];

  const formatTimestamp = (ts: any) => {
    if (!ts) return 'Never';
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const parseEvents = (eventsJson: any) => {
    try {
      return JSON.parse(eventsJson);
    } catch {
      return [];
    }
  };

  const primaryBtn = 'flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryBtn = 'rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-sm text-secondary transition-colors hover:border-border-hover hover:text-white';
  const inputClass = 'w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20';
  const fieldLabel = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary';

  return (
    <PageLayout agentFilter={false}
      breadcrumbs={['Dashboard', 'Webhooks']}
      title="Webhooks"
      subtitle="Receive real-time notifications when security signals are detected"
      actions={
        <>
          {canEdit && (
            <button
              onClick={() => {
                setShowAddForm(!showAddForm);
                setError(null);
                setNewSecret(null);
              }}
              className={primaryBtn}
            >
              <Plus size={16} aria-hidden="true" />
              Add webhook
            </button>
          )}
          <BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />
        </>
      }
    >
      {isDemo && (
        <div role="note" className="mb-4 rounded-lg border border-border bg-surface-secondary p-3 text-sm text-secondary">
          Demo mode · webhooks are read-only.
        </div>
      )}

      {/* Instrument rail */}
      <div className="mb-6 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary">
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total webhooks</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{stats.total}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Active</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-success">{stats.active}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Failed</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-warning">{stats.failed}</div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-error/30 bg-error-subtle p-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-error" aria-hidden="true" />
          <div className="text-sm text-error">{error}</div>
        </div>
      )}

      {/* New secret banner (show once after creation) */}
      {newSecret && (
        <div role="status" className="mb-6 rounded-lg border border-success/30 bg-success-subtle p-4">
          <div className="mb-2 flex items-start gap-3">
            <Check size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
            <div className="text-sm font-medium text-success">
              Webhook created successfully. Save your signing secret now, it will not be shown again.
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 break-all rounded border border-border bg-surface-tertiary p-2 font-mono text-xs text-secondary">
              {newSecret}
            </code>
            <button
              onClick={handleCopySecret}
              className="flex items-center gap-2 rounded border border-border bg-surface-tertiary px-3 py-2 text-xs text-secondary transition-colors hover:border-border-hover hover:text-white"
            >
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Add webhook form */}
      {showAddForm && canEdit && (
        <Card className="mb-6">
          <CardContent className="py-5">
            <div className="space-y-4">
              {/* Template selector */}
              <div>
                <div className={fieldLabel}>Start from template</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {WEBHOOK_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.name}
                      type="button"
                      onClick={() => {
                        // Placeholder only — injecting the example as the VALUE
                        // let junk URLs be created as dead, auto-disabling webhooks.
                        setUrlPlaceholder(tpl.urlPlaceholder);
                        setSelectedEvents(tpl.defaultEvents);
                        setUrl('');
                      }}
                      className="group rounded-lg border border-border bg-surface-tertiary p-3 text-left transition-colors hover:border-border-hover"
                    >
                      <div className="text-xs font-medium text-secondary group-hover:text-white">{tpl.name}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-tertiary">{tpl.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="webhook-url" className={fieldLabel}>Webhook URL</label>
                <input
                  id="webhook-url"
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={urlPlaceholder}
                  className={inputClass}
                />
                <div className="mt-1 text-xs text-tertiary">Must use HTTPS</div>
              </div>

              <div>
                <div className={fieldLabel}>Event types</div>
                <div className="grid grid-cols-2 gap-2">
                  {EVENT_TYPES.map((event) => (
                    <label
                      key={event.value}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-tertiary px-3 py-2 transition-colors hover:border-border-hover"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(event.value)}
                        onChange={() => handleEventToggle(event.value)}
                        className="h-4 w-4 accent-brand"
                      />
                      <span className="text-sm text-secondary">{event.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleCreate}
                  disabled={creating || !url.trim()}
                  className={primaryBtn}
                >
                  {creating ? 'Creating…' : 'Create webhook'}
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setUrl('');
                    setSelectedEvents(['all']);
                    setError(null);
                  }}
                  className={secondaryBtn}
                >
                  Cancel
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Webhook list */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-surface-secondary" />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon={Webhook}
              title="No webhooks configured"
              description={
                isAdmin
                  ? "Add your first webhook to receive real-time notifications when security signals are detected"
                  : "Ask an admin to configure webhooks for this workspace"
              }
              action={
                canEdit && (
                  <button onClick={() => setShowAddForm(true)} className={primaryBtn}>
                    <Plus size={16} aria-hidden="true" />
                    Add webhook
                  </button>
                )
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all"
            />
            <span className="text-xs text-tertiary">Select all</span>
          </div>
          <div className="space-y-4">
          {webhooks.map((webhook) => {
            const events = parseEvents(webhook.events);
            const testResult = testResults[webhook.id];
            const isExpanded = expandedWebhook === webhook.id;
            const webhookDeliveries = deliveries[webhook.id] || [];

            return (
              <Card key={webhook.id} data-entity-type="webhook" data-entity-id={webhook.id} data-entity-status={webhook.active ? 'active' : 'disabled'}>
                <CardContent className="py-4">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <SelectCheckbox
                          checked={selection.isSelected(webhook.id)}
                          onToggle={(e) => { e.stopPropagation(); selection.selectClick(webhook.id, e.shiftKey); }}
                          label={`Select webhook ${webhook.url}`}
                        />
                        <code className="block max-w-md truncate font-mono text-xs text-secondary">
                          {webhook.url}
                        </code>
                        {webhook.active ? (
                          <Badge variant="success" size="xs">Active</Badge>
                        ) : (
                          <Badge variant="error" size="xs">Disabled</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {events.map((event: any) => (
                          <Badge key={event} variant="default" size="xs">
                            {EVENT_TYPES.find((e) => e.value === event)?.label || event}
                          </Badge>
                        ))}
                      </div>
                      {webhook.failure_count > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                          <AlertTriangle size={12} aria-hidden="true" />
                          <span className="tabular-nums">{webhook.failure_count} recent failures</span>
                        </div>
                      )}
                      <div className="mt-2 tabular-nums text-xs text-tertiary">
                        Last triggered: {formatTimestamp(webhook.last_triggered_at)}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {canEdit && (
                        <>
                          <button
                            onClick={() => handleTest(webhook.id)}
                            disabled={testResult === 'testing'}
                            className="rounded-lg border border-border bg-surface-tertiary p-2 text-secondary transition-colors hover:border-border-hover hover:text-white disabled:opacity-50"
                            aria-label="Test webhook"
                          >
                            <Play size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(webhook.id)}
                            className="rounded-lg border border-border bg-surface-tertiary p-2 text-secondary transition-colors hover:border-error/30 hover:bg-error-subtle hover:text-error"
                            aria-label="Delete webhook"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => toggleDeliveries(webhook.id)}
                        className="rounded-lg border border-border bg-surface-tertiary p-2 text-secondary transition-colors hover:border-border-hover hover:text-white"
                        aria-label={isExpanded ? 'Hide delivery history' : 'Show delivery history'}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Test result */}
                  {testResult && testResult !== 'testing' && (
                    <div
                      role="status"
                      className={`mt-3 flex items-center gap-2 rounded-lg border p-2 text-xs ${
                        testResult.success
                          ? 'border-success/30 bg-success-subtle text-success'
                          : 'border-error/30 bg-error-subtle text-error'
                      }`}
                    >
                      {testResult.success ? <Check size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
                      <span>
                        {testResult.success ? 'Test successful' : 'Test failed'} (HTTP {testResult.status})
                      </span>
                    </div>
                  )}

                  {/* Delivery history */}
                  {isExpanded && (
                    <div className="mt-4 border-t border-border pt-4">
                      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                        Delivery history
                      </div>
                      {loadingDeliveries ? (
                        <div className="py-4 text-center text-xs text-tertiary">Loading deliveries…</div>
                      ) : webhookDeliveries.length === 0 ? (
                        <div className="py-4 text-center text-xs text-tertiary">No deliveries yet</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Event type</th>
                                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Status</th>
                                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">HTTP</th>
                                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Time</th>
                                <th className="pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Duration</th>
                              </tr>
                            </thead>
                            <tbody>
                              {webhookDeliveries.slice(0, 20).map((delivery: any) => (
                                <React.Fragment key={delivery.id}>
                                <tr
                                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-white/[0.02]"
                                  onClick={() => setExpandedDelivery((prev) => (prev === delivery.id ? null : delivery.id))}
                                  aria-expanded={expandedDelivery === delivery.id}
                                  data-testid="delivery-row"
                                >
                                  <td className="py-2 text-secondary">
                                    {EVENT_TYPES.find((e) => e.value === delivery.event_type)?.label ||
                                      delivery.event_type}
                                  </td>
                                  <td className="py-2">
                                    <Badge
                                      variant={
                                        delivery.status === 'success'
                                          ? 'success'
                                          : delivery.status === 'failed'
                                          ? 'error'
                                          : 'default'
                                      }
                                      size="xs"
                                    >
                                      {delivery.status}
                                    </Badge>
                                  </td>
                                  <td className="py-2 font-mono tabular-nums text-secondary">{delivery.response_status || '—'}</td>
                                  <td className="py-2 tabular-nums text-secondary">{formatTimestamp(delivery.attempted_at)}</td>
                                  <td className="py-2 tabular-nums text-secondary">
                                    {delivery.duration_ms ? `${delivery.duration_ms}ms` : '—'}
                                  </td>
                                </tr>
                                {expandedDelivery === delivery.id && (
                                  <tr className="border-b border-border last:border-0" data-testid="delivery-detail">
                                    <td colSpan={5} className="py-3">
                                      {/* Stored payload/response are redacted at write time. */}
                                      <div className="space-y-2">
                                        <div>
                                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary">Sent payload</div>
                                          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface-tertiary p-2 font-mono text-[11px] leading-relaxed text-secondary whitespace-pre-wrap break-all">{delivery.payload || '(not stored)'}</pre>
                                        </div>
                                        <div>
                                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary">Response body</div>
                                          <pre className="max-h-32 overflow-auto rounded-md border border-border bg-surface-tertiary p-2 font-mono text-[11px] leading-relaxed text-secondary whitespace-pre-wrap break-all">{delivery.response_body || '(empty)'}</pre>
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          </div>
        </>
      )}

      {/* Admin guide */}
      {!isAdmin && webhooks.length > 0 && (
        <Card className="mt-6">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Admin only</div>
                <div className="text-xs text-secondary">
                  Only workspace admins can add, test, or delete webhooks. Contact an admin to manage webhook
                  configurations.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
}
