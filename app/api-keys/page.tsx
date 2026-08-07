'use client';

import { useState, useEffect, useCallback } from 'react';
import { KeyRound, Plus, Copy, Check, Ban, ArrowRight } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { CollapsibleSection } from '../components/ui/CollapsibleSection';
import ConnectAgentButton from '../components/ConnectAgentButton';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { API_KEY_ROLE_OPTIONS } from '../lib/apiKeyRoles';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { useListControls, type ListColumn } from '../lib/useListControls';
import { ListControlsBar } from '../components/ListControlsBar';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';

export default function ApiKeysPage() {
  const { isAdmin } = useEffectiveRole();

  const [keys, setKeys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  // Least privilege (security review 2026-07-05): agent keys must not be
  // admin by accident — admin can approve its own pending actions.
  const [newRole, setNewRole] = useState('member');
  const [creating, setCreating] = useState(false);

  // Newly created key (shown once)
  const [newKey, setNewKey] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  // Revoke confirmation
  const [revokingId, setRevokingId] = useState<any>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys');
      const data = await res.json();


      if (!res.ok) {
        setError(data.error || 'Failed to load keys');
        setLoading(false);
        return;
      }

      setKeys(data.keys || []);
    } catch (err) {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), role: newRole }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create key');
        return;
      }

      setNewKey(data.key);
      setNewLabel('');
      setShowCreateForm(false);
      await fetchKeys();
    } catch (err) {
      setError('Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
    }
  };

  const handleRevoke = async (keyId: any) => {
    setRevokeLoading(true);
    try {
      const res = await fetch(`/api/keys?id=${encodeURIComponent(keyId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to revoke key');
        return;
      }

      setRevokingId(null);
      await fetchKeys();
    } catch (err) {
      setError('Failed to revoke key');
    } finally {
      setRevokeLoading(false);
    }
  };

  const formatDate = (dateStr: any) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  const keysColumns: ListColumn<any>[] = [
    { key: 'name', label: 'Name', accessor: (k) => k.label, sortable: true },
    { key: 'role', label: 'Role', accessor: (k) => k.role, filterable: true },
    { key: 'created', label: 'Created', accessor: (k) => k.created_at, sortable: true },
    { key: 'last_used', label: 'Last used', accessor: (k) => k.last_used_at, sortable: true },
  ];
  const keysControls = useListControls(keys, keysColumns);

  // Selection is built over the control-processed (filtered/sorted) rows so
  // "select all" and bulk revoke only ever touch what's currently visible.
  const selection = useSelection<any>(keysControls.rows, (k) => k.id);
  useSelectAllHotkey(selection.toggleAll);

  // A search/filter narrowing (or a revoke) can shrink the visible set out
  // from under an existing selection — drop any now-invisible ids so a bulk
  // action never operates on a hidden/stale row.
  useEffect(() => {
    const visibleIds = new Set(keysControls.rows.map((k) => k.id));
    const pruned = selection.selectedIds.filter((id) => visibleIds.has(id));
    if (pruned.length !== selection.selectedIds.length) {
      selection.setSelected(pruned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysControls.rows]);

  const handleBulkRevoke = async () => {
    // Defensive re-scope to currently-visible ids: the pruning effect above
    // keeps the selection in sync, but a destructive revoke should never trust
    // a selection snapshot that could include a hidden/stale id.
    const visibleIds = new Set(keysControls.rows.map((k) => k.id));
    const ids = selection.selectedIds.filter((id) => visibleIds.has(id));
    if (ids.length === 0) return;
    if (!window.confirm(`Revoke ${ids.length} key${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const { ok } = await bulkAction(ids, (id) =>
      fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    );
    setKeys((prev) => prev.filter((k) => !ok.includes(k.id)));
    selection.clear();
  };

  const bulkActions = isAdmin ? [
    { id: 'revoke', label: 'Revoke', icon: Ban, onClick: handleBulkRevoke, danger: true },
  ] : [];


  // Loading state
  if (loading) {
    return (
      <PageLayout agentFilter={false}
        title="API keys"
        subtitle="Manage your workspace API keys"
        breadcrumbs={['Dashboard', 'API keys']}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-surface-secondary sm:grid-cols-3 sm:divide-x sm:divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4">
                <div className="h-3 w-20 animate-pulse rounded bg-white/5" />
                <div className="mt-2 h-7 w-16 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-xl border border-border bg-surface-secondary p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout agentFilter={false}
      title="API keys"
      subtitle="Manage your workspace API keys"
      breadcrumbs={['Dashboard', 'API keys']}
      maturity="stable"
      actions={
        <div className="flex items-center gap-2">
          <ConnectAgentButton />
          {isAdmin && (
            <button
              onClick={() => { setShowCreateForm(true); setNewKey(null); }}
              className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
            >
              <Plus size={14} aria-hidden="true" />
              Generate new key
            </button>
          )}
          <BulkActionBar count={selection.count} actions={bulkActions} onClear={selection.clear} />
        </div>
      }
    >
      {/* Error banner */}
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-lg border border-error/30 bg-error-subtle p-3 text-sm text-error">
          <div className="flex items-center gap-2">
            <span>{error}</span>
            {error.includes('Demo mode') && (
              <a
                href="/demo?leave=1"
                className="ml-2 underline opacity-80 hover:no-underline"
              >
                Exit demo
              </a>
            )}
          </div>
          <button
            onClick={() => setError(null)}
            className="ml-4 rounded px-2 py-0.5 text-error transition-colors hover:bg-error-subtle hover:text-error"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Newly created key banner */}
      {newKey && (
        <div role="status" className="mb-6 rounded-xl border border-success/30 bg-success-subtle p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-success/30 bg-success-subtle">
              <KeyRound size={16} className="text-success" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-success">
                Key created: {newKey.label}
                {newKey.role && (
                  <Badge variant={newKey.role === 'admin' ? 'warning' : 'info'} size="xs">{newKey.role}</Badge>
                )}
              </div>
              <p className="mb-3 text-xs text-secondary">Copy your API key now. It will not be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-sm text-success">
                  {newKey.raw_key}
                </code>
                <button
                  onClick={() => handleCopy(newKey.raw_key)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-secondary transition-colors hover:border-border-hover hover:text-white"
                >
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <ConnectAgentButton className="shrink-0" />
              </div>
            </div>
            <button
              onClick={() => setNewKey(null)}
              aria-label="Dismiss"
              className="shrink-0 text-lg leading-none text-tertiary transition-colors hover:text-secondary"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Instrument rail */}
      <div className="mb-6 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-surface-secondary">
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Total keys</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-white">{keys.length}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Active</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-success">{activeKeys.length}</div>
        </div>
        <div className="p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Revoked</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-error">{revokedKeys.length}</div>
        </div>
      </div>

      {/* Setup callout */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-tertiary px-4 py-2.5">
        <p className="text-xs text-tertiary">
          Need to verify your instance is configured correctly before connecting agents?
        </p>
        <a
          href="/setup"
          className="flex shrink-0 items-center gap-1 text-xs text-brand transition-colors hover:text-brand-hover"
        >
          Setup & verify <ArrowRight size={11} aria-hidden="true" />
        </a>
      </div>

      {/* Create form (inline, admin only) */}
      {showCreateForm && isAdmin && (
        <Card hover={false} className="mb-6">
          <CardContent className="pt-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              Generate new API key
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label htmlFor="new-key-label" className="sr-only">Key label</label>
              <input
                id="new-key-label"
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Key label (e.g. Production, Staging)"
                maxLength={256}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="flex-1 rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <label htmlFor="new-key-role" className="sr-only">Key role</label>
              <select
                id="new-key-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-secondary transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
              >
                {API_KEY_ROLE_OPTIONS.map((opt: any) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={handleCreate}
                disabled={creating || !newLabel.trim()}
                className="rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setShowCreateForm(false); setNewLabel(''); setNewRole('member'); }}
                className="rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-sm text-secondary transition-colors hover:border-border-hover hover:text-white"
              >
                Cancel
              </button>
            </div>
            <p className="mt-2 text-xs text-tertiary">
              {API_KEY_ROLE_OPTIONS.find((o: any) => o.value === newRole)?.desc}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Key list */}
      <CollapsibleSection
        id="apikeys.list"
        title="Keys"
        icon={KeyRound}
        count={keysControls.rows.length}
        controls={keys.length > 0 ? <ListControlsBar columns={keysColumns} controls={keysControls} searchPlaceholder="Search keys…" /> : undefined}
        actions={
          keys.length > 0 && isAdmin ? (
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all"
            />
          ) : undefined
        }
      >
      {keys.length === 0 ? (
        <Card hover={false}>
          <CardContent className="pt-4">
            <EmptyState
              icon={KeyRound}
              title="No API keys yet"
              description={isAdmin ? 'Generate an API key to connect your agents to this workspace.' : 'No API keys have been created yet. Ask a workspace admin to generate one.'}
              action={
                isAdmin ? (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15"
                  >
                    <Plus size={14} aria-hidden="true" />
                    Generate key
                  </button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card hover={false}>
          <div className="divide-y divide-border">
            {keysControls.rows.map((key) => {
              const isRevoked = !!key.revoked_at;
              const isConfirmingRevoke = revokingId === key.id;

              return (
                <div key={key.id} data-entity-type="apiKey" data-entity-id={key.id} data-entity-status={key.revoked_at ? 'revoked' : 'active'} className="flex items-center gap-4 px-5 py-4">
                  {isAdmin && (
                    <SelectCheckbox
                      checked={selection.isSelected(key.id)}
                      onToggle={(e) => { e.stopPropagation(); selection.selectClick(key.id, e.shiftKey); }}
                      label={`Select ${key.label || 'API key'}`}
                    />
                  )}
                  {/* Key icon + prefix */}
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${isRevoked ? 'border-border bg-surface-tertiary' : 'border-brand/20 bg-brand/10'}`}>
                      <KeyRound size={14} className={isRevoked ? 'text-tertiary' : 'text-brand'} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isRevoked ? 'text-tertiary' : 'text-secondary'}`}>
                          {key.label || 'API key'}
                        </span>
                        <Badge variant={isRevoked ? 'error' : 'success'} size="xs">
                          {isRevoked ? 'Revoked' : 'Active'}
                        </Badge>
                        {key.role && (
                          <Badge variant={key.role === 'admin' ? 'warning' : 'info'} size="xs">
                            {key.role}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs">
                        <code className={`font-mono ${isRevoked ? 'text-tertiary' : 'text-secondary'}`}>
                          {key.key_prefix}…
                        </code>
                        <span className="tabular-nums text-tertiary">
                          Created {formatDate(key.created_at)}
                        </span>
                        <span className="tabular-nums text-tertiary">
                          Last used: {formatDate(key.last_used_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions (admin only) */}
                  {!isRevoked && isAdmin && (
                    <div className="shrink-0">
                      {isConfirmingRevoke ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-secondary">Revoke?</span>
                          <button
                            onClick={() => handleRevoke(key.id)}
                            disabled={revokeLoading}
                            className="rounded-md border border-error/30 bg-error-subtle px-2.5 py-1 text-xs font-medium text-error transition-colors hover:border-error/50 hover:bg-error-subtle disabled:opacity-50"
                          >
                            {revokeLoading ? 'Revoking…' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setRevokingId(null)}
                            className="rounded-md px-2.5 py-1 text-xs text-secondary transition-colors hover:bg-white/5 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRevokingId(key.id)}
                          className="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-tertiary transition-colors hover:bg-error-subtle hover:text-error"
                        >
                          <Ban size={12} aria-hidden="true" />
                          Revoke
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      </CollapsibleSection>
    </PageLayout>
  );
}
