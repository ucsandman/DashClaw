'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  KeyRound, Plus, Trash2, RotateCw, AlertTriangle, Check, RefreshCw,
} from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { isDemoMode } from '../lib/isDemoMode';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';

// Surfaces governed_secrets rotation tracking:
//   GET    /api/secrets[?agent_id=]        — list (org-wide by default)
//   POST   /api/secrets                    — create rotation record
//   PATCH  /api/secrets/[id]               — mark rotated / edit interval
//   DELETE /api/secrets/[id]               — remove record
//   GET    /api/secrets/rotation-due       — secrets due within N days (org-wide)
// Only rotation metadata lives here — the secret values stay in the agent's
// own secret manager.

function formatDate(ts: string | null | undefined): string {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleDateString();
}

// Derive a rotation badge from the computed next_rotation_due timestamp.
function dueStatus(nextDue: string | null | undefined): { label: string; variant: string } {
  if (!nextDue) return { label: 'No schedule', variant: 'default' };
  const days = Math.ceil((new Date(nextDue).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: `Overdue ${Math.abs(days)}d`, variant: 'error' };
  if (days <= 14) return { label: `Due in ${days}d`, variant: 'warning' };
  return { label: `OK · ${days}d`, variant: 'success' };
}

export default function SecretsPage() {
  const { isAdmin, settled } = useEffectiveRole();
  const isDemo = isDemoMode();
  const canEdit = isAdmin && !isDemo;

  const [secrets, setSecrets] = useState<any[]>([]);
  const [due, setDue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // List scope: blank = org-wide (agent_id IS NULL).
  const [scope, setScope] = useState('');
  const [scopeInput, setScopeInput] = useState('');

  // Create form
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [interval, setInterval] = useState('90');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const selection = useSelection<any>(secrets, (s) => s.id);
  useSelectAllHotkey(selection.toggleAll);

  const fetchSecrets = useCallback(async (scopeAgent: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = scopeAgent ? `?agent_id=${encodeURIComponent(scopeAgent)}` : '';
      const [listRes, dueRes] = await Promise.all([
        fetch(`/api/secrets${qs}`),
        fetch('/api/secrets/rotation-due'),
      ]);
      const listJson = await listRes.json().catch(() => ({}));
      if (!listRes.ok) {
        setError(listJson.error || 'Failed to load secrets');
        setSecrets([]);
        return;
      }
      setSecrets(listJson.secrets || []);
      if (dueRes.ok) {
        const dueJson = await dueRes.json().catch(() => ({}));
        setDue(dueJson.due || []);
      }
    } catch {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSecrets(scope);
  }, [fetchSecrets, scope]);

  const applyScope = (e: React.FormEvent) => {
    e.preventDefault();
    setScope(scopeInput.trim());
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          agent_id: agentId.trim() || null,
          rotation_interval_days: Number(interval) || 90,
          notes: notes.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Failed to create secret');
        return;
      }
      // Show the new secret's scope so it's immediately visible.
      const createdScope = agentId.trim();
      setName('');
      setAgentId('');
      setInterval('90');
      setNotes('');
      setShowAddForm(false);
      setScopeInput(createdScope);
      if (createdScope === scope) {
        await fetchSecrets(scope);
      } else {
        setScope(createdScope); // triggers refetch via effect
      }
    } catch {
      setError('Failed to create secret');
    } finally {
      setCreating(false);
    }
  };

  const handleMarkRotated = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/secrets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_rotated_at: new Date().toISOString() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || 'Failed to mark rotated');
        return;
      }
      await fetchSecrets(scope);
    } catch {
      setError('Failed to mark rotated');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rotation record? This cannot be undone.')) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/secrets/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error || 'Failed to delete secret');
        return;
      }
      await fetchSecrets(scope);
    } catch {
      setError('Failed to delete secret');
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkMarkRotated = async () => {
    const ids = selection.selectedIds;
    await bulkAction(ids, (id) =>
      fetch(`/api/secrets/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ last_rotated_at: new Date().toISOString() }),
      })
    );
    selection.clear();
    await fetchSecrets(scope);
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selection.count} rotation record${selection.count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const ids = selection.selectedIds;
    const { ok } = await bulkAction(ids, (id) =>
      fetch(`/api/secrets/${id}`, { method: 'DELETE' })
    );
    setSecrets((prev) => prev.filter((s) => !ok.includes(s.id)));
    selection.clear();
  };

  const bulkActions = canEdit ? [
    { id: 'mark-rotated', label: 'Mark rotated', icon: RefreshCw, onClick: handleBulkMarkRotated },
    { id: 'delete', label: 'Delete', icon: Trash2, onClick: handleBulkDelete, danger: true },
  ] : [];

  const stats = {
    total: secrets.length,
    due: due.length,
    overdue: due.filter((d) => Number(d.days_until_due) < 0).length,
  };

  const primaryBtn = 'flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryBtn = 'rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-sm text-secondary transition-colors hover:border-border-hover hover:text-white';
  const inputClass = 'w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20';
  const fieldLabel = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary';

  return (
    <PageLayout
      breadcrumbs={['Configure', 'Secrets']}
      title="Secret Rotation"
      subtitle="Track when agent and workspace secrets are due for rotation"
      actions={
        <>
          {canEdit && (
            <button
              onClick={() => {
                setShowAddForm(!showAddForm);
                setError(null);
              }}
              className={primaryBtn}
            >
              <Plus size={16} aria-hidden="true" />
              Track a secret
            </button>
          )}
          <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} />
        </>
      }
    >
      {isDemo && (
        <div role="note" className="mb-4 rounded-lg border border-border bg-surface-secondary p-3 text-sm text-secondary">
          Demo mode · secret rotation records are read-only.
        </div>
      )}

      {/* Instrument rail */}
      <div className="mb-6 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary">
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Tracked</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{stats.total}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Due soon</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${stats.due > 0 ? 'text-warning' : 'text-white'}`}>{stats.due}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Overdue</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${stats.overdue > 0 ? 'text-error' : 'text-white'}`}>{stats.overdue}</div>
        </div>
      </div>

      {/* Purpose note — this is a rotation reminder, not a secret vault */}
      <div role="note" className="mb-6 rounded-lg border border-border bg-surface-secondary p-3 text-sm text-secondary">
        This is a <span className="text-white">rotation reminder</span>, not a key store. DashClaw tracks <span className="text-white">when</span> each
        credential is due to be rotated and pings you before it goes stale — the actual key value stays in your agent&apos;s own secret manager
        and is never entered, stored, or shown here.
      </div>

      {/* Rotation-due banner (org-wide) */}
      {due.length > 0 && (
        <div role="status" className="mb-6 rounded-lg border border-warning/30 bg-warning-subtle p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle size={16} aria-hidden="true" />
            {due.length} secret{due.length === 1 ? '' : 's'} due for rotation
          </div>
          <ul className="space-y-1 text-xs text-secondary">
            {due.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <span className="font-mono text-secondary">{d.name}</span>
                {d.agent_id ? <Badge variant="default" size="xs">{d.agent_id}</Badge> : <Badge variant="info" size="xs">org-wide</Badge>}
                <span className={`tabular-nums ${Number(d.days_until_due) < 0 ? 'text-error' : 'text-warning'}`}>
                  {Number(d.days_until_due) < 0
                    ? `overdue ${Math.abs(Number(d.days_until_due))}d`
                    : `due in ${d.days_until_due}d`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-error/30 bg-error-subtle p-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-error" aria-hidden="true" />
          <div className="text-sm text-error">{error}</div>
        </div>
      )}

      {/* Scope filter */}
      <form onSubmit={applyScope} className="mb-6 flex items-end gap-2">
        <div className="flex-1 max-w-xs">
          <label htmlFor="secret-scope" className={fieldLabel}>Agent scope</label>
          <input
            id="secret-scope"
            type="text"
            value={scopeInput}
            onChange={(e) => setScopeInput(e.target.value)}
            placeholder="Agent ID (blank = org-wide)"
            className={inputClass}
          />
        </div>
        <button type="submit" className={secondaryBtn}>View</button>
      </form>

      {/* Add form */}
      {showAddForm && canEdit && (
        <Card className="mb-6">
          <CardContent className="py-5">
            <div className="space-y-4">
              <div>
                <label htmlFor="secret-name" className={fieldLabel}>Secret name</label>
                <input
                  id="secret-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. ANTHROPIC_API_KEY"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="secret-agent" className={fieldLabel}>Agent ID (optional)</label>
                  <input
                    id="secret-agent"
                    type="text"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    placeholder="Leave blank for org-wide"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="secret-interval" className={fieldLabel}>Rotation interval (days)</label>
                  <input
                    id="secret-interval"
                    type="number"
                    min="1"
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="secret-notes" className={fieldLabel}>Notes (optional)</label>
                <input
                  id="secret-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Where this secret lives, who owns it…"
                  className={inputClass}
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button onClick={handleCreate} disabled={creating || !name.trim()} className={primaryBtn}>
                  {creating ? 'Saving…' : 'Track secret'}
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setName('');
                    setAgentId('');
                    setInterval('90');
                    setNotes('');
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

      {/* Select-all toolbar — only visible when there are secrets */}
      {!loading && secrets.length > 0 && canEdit && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-secondary">
          <SelectCheckbox
            checked={selection.allSelected}
            onToggle={() => selection.toggleAll()}
            label="Select all"
          />
          <span>Select all</span>
        </div>
      )}

      {/* Secret list */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-surface-secondary" />
          ))}
        </div>
      ) : secrets.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <EmptyState
              icon={KeyRound}
              title={scope ? `No secrets tracked for ${scope}` : 'No secrets tracked yet'}
              description={
                canEdit
                  ? 'Track a secret to get a rotation reminder before it goes stale. Only rotation metadata is stored — never the secret value.'
                  : 'Ask an admin to track secret rotation for this workspace.'
              }
              action={
                canEdit && (
                  <button onClick={() => setShowAddForm(true)} className={primaryBtn}>
                    <Plus size={16} aria-hidden="true" />
                    Track a secret
                  </button>
                )
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {secrets.map((secret) => {
            const status = dueStatus(secret.next_rotation_due);
            return (
              <Card key={secret.id} data-entity-type="secret" data-entity-id={secret.id} data-entity-status={status.label}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    {canEdit && (
                      <SelectCheckbox
                        checked={selection.isSelected(secret.id)}
                        onToggle={(e) => { e.stopPropagation(); selection.selectClick(secret.id, e.shiftKey); }}
                        label={`Select ${secret.name}`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-white">{secret.name}</span>
                        {secret.agent_id
                          ? <Badge variant="default" size="xs">{secret.agent_id}</Badge>
                          : <Badge variant="info" size="xs">org-wide</Badge>}
                        <Badge variant={status.variant} size="xs">{status.label}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-tertiary">
                        <span className="tabular-nums">Last rotated: {formatDate(secret.last_rotated_at)}</span>
                        <span className="tabular-nums">Every {secret.rotation_interval_days}d</span>
                        <span className="tabular-nums">Next due: {formatDate(secret.next_rotation_due)}</span>
                      </div>
                      {secret.notes && <div className="mt-2 text-xs text-secondary">{secret.notes}</div>}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => handleMarkRotated(secret.id)}
                          disabled={busyId === secret.id}
                          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-xs text-secondary transition-colors hover:border-success/30 hover:bg-success-subtle hover:text-success disabled:opacity-50"
                        >
                          {busyId === secret.id ? <RotateCw size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                          Mark rotated
                        </button>
                        <button
                          onClick={() => handleDelete(secret.id)}
                          disabled={busyId === secret.id}
                          className="rounded-lg border border-border bg-surface-tertiary p-2 text-secondary transition-colors hover:border-error/30 hover:bg-error-subtle hover:text-error disabled:opacity-50"
                          aria-label={`Delete ${secret.name}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!isAdmin && settled && (
        <Card className="mt-6">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Admin only</div>
                <div className="text-xs text-secondary">
                  Only workspace admins can track, rotate, or delete secret records.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
}
