'use client';

import { useState, useEffect, useCallback } from 'react';
import { Fingerprint, Shield, CheckCircle, Clock, AlertTriangle, Trash2, Send, UserX } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { CollapsibleSection } from '../components/ui/CollapsibleSection';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { isDemoMode } from '../lib/isDemoMode';
import { isSyntheticAgentId } from '../lib/synthetic-agents';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { useListControls, type ListColumn } from '../lib/useListControls';
import { ListControlsBar } from '../components/ListControlsBar';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';
import {
  buildPairingRequestMessage,
  computeUnidentified,
  PAIRING_REQUEST_SUBJECT,
  type UnidentifiedAgent,
} from '../lib/pairing-request';

const PERMISSION_LEVELS = ['readonly', 'workspace_write', 'prompt', 'allow', 'danger'];

const PERMISSION_BADGE_VARIANT: Record<string, string> = {
  readonly: 'default',
  workspace_write: 'info',
  prompt: 'warning',
  allow: 'success',
  danger: 'error',
};

interface Pairing {
  id: string;
  agent_id: string;
  agent_name?: string | null;
  permission_level?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
}

interface Identity {
  agent_id: string;
  agent_name?: string | null;
  permission_level?: string | null;
  algorithm?: string | null;
  created_at?: string | null;
}

interface Setting {
  key: string;
  value: string | boolean;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeLeft(expiresAt?: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'Expires now';
  return `${mins}m left`;
}

export default function IdentitiesPage() {
  const { isAdmin, settled: sessionSettled } = useEffectiveRole();
  // Demo visitors are anonymous (never admin) but should still SEE the surface:
  // the demo middleware serves identity/pairing fixtures and blocks writes.
  const demo = isDemoMode();

  const [pendingPairings, setPendingPairings] = useState<Pairing[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [unidentified, setUnidentified] = useState<UnidentifiedAgent[]>([]);
  // Agents already asked to pair (from sent dashboard messages + this session)
  // so double-requests are obvious across reloads.
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [requestingIds, setRequestingIds] = useState<Set<string>>(new Set());
  const [enforcementOn, setEnforcementOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showTestAgents, setShowTestAgents] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  // Per-row state
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [permLevels, setPermLevels] = useState<Record<string, string>>({});
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [pendingRes, identitiesRes, settingsRes, agentsRes, sentRes] = await Promise.all([
        fetch('/api/pairings?status=pending&limit=200'),
        fetch('/api/identities'),
        fetch('/api/settings?key=ENFORCE_AGENT_SIGNATURES'),
        fetch('/api/agents?include_synthetic=true'),
        // Previously-sent pairing requests (dashboard outbox) so requested
        // state survives reloads.
        fetch('/api/messages?agent_id=dashboard&direction=sent&type=action&limit=200'),
      ]);

      let pendingList: Pairing[] = [];
      if (pendingRes.ok) {
        const data = await pendingRes.json();
        pendingList = data.pairings || [];
        setPendingPairings(pendingList);
        // Initialize permission level dropdowns from existing pairing data
        const initLevels: Record<string, string> = {};
        pendingList.forEach((p: Pairing) => {
          initLevels[p.id] = p.permission_level || 'readonly';
        });
        setPermLevels((prev) => ({ ...initLevels, ...prev }));
      }

      let identityList: Identity[] = [];
      if (identitiesRes.ok) {
        const data = await identitiesRes.json();
        identityList = data.identities || [];
        setIdentities(identityList);
      }

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const setting = (data.settings || []).find((s: Setting) => s.key === 'ENFORCE_AGENT_SIGNATURES');
        setEnforcementOn(setting?.value === 'true' || setting?.value === true);
      }

      // Unidentified fleet agents = fleet minus identified minus pending,
      // collapsed via baseAgentId (sub-agents inherit the parent identity).
      if (agentsRes.ok) {
        const fleet = (await agentsRes.json()).agents || [];
        setUnidentified(computeUnidentified(
          fleet,
          identityList.map((i) => i.agent_id),
          pendingList.map((pr) => pr.agent_id),
        ));
      }

      if (sentRes.ok) {
        const sent = (await sentRes.json()).messages || [];
        const requested = sent
          .filter((m: any) => m.subject === PAIRING_REQUEST_SUBJECT)
          .map((m: any) => String(m.to_agent_id));
        if (requested.length) setRequestedIds((prev) => new Set([...prev, ...requested]));
      }
    } catch (err) {
      setError('Failed to load identity data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handleApprove = async (pairingId: string) => {
    setApprovingId(pairingId);
    try {
      const permLevel = permLevels[pairingId] || 'readonly';
      // Set the permission level first, then approve through POST /approve —
      // the ONLY path that writes the agent_identities row (upsertIdentity).
      // PATCHing {status:'approved'} flips the pairing status WITHOUT creating
      // the identity, leaving the agent permanently unverified (the old bug).
      const patchRes = await fetch(`/api/pairings/${encodeURIComponent(pairingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_level: permLevel }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        setError(data.error || 'Failed to set permission level');
        return;
      }
      const res = await fetch(`/api/pairings/${encodeURIComponent(pairingId)}/approve`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to approve pairing');
        return;
      }
      showSuccess('Pairing approved, identity created.');
      await fetchAll();
    } catch (err) {
      setError('Failed to approve pairing');
    } finally {
      setApprovingId(null);
    }
  };

  const handleRevoke = async (agentId: string) => {
    setRevokeLoading(true);
    try {
      const res = await fetch(`/api/identities/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to revoke identity');
        return;
      }
      setRevokingId(null);
      showSuccess('Identity revoked.');
      await fetchAll();
    } catch (err) {
      setError('Failed to revoke identity');
    } finally {
      setRevokeLoading(false);
    }
  };

  // Send the structured pairing-request directive over the messages rails.
  const requestPairing = useCallback(async (agentId: string): Promise<boolean> => {
    setRequestingIds((prev) => new Set(prev).add(agentId));
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPairingRequestMessage(agentId, origin)),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to request pairing for ${agentId}`);
        return false;
      }
      setRequestedIds((prev) => new Set(prev).add(agentId));
      return true;
    } catch {
      setError(`Failed to request pairing for ${agentId}`);
      return false;
    } finally {
      setRequestingIds((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }
  }, []);

  const handleRequestPairing = async (agentId: string) => {
    if (await requestPairing(agentId)) {
      showSuccess(`Pairing requested. ${agentId} sees it next time it runs with DashClaw attached.`);
    }
  };

  // Synthetic (test-agent) traffic is hidden by default on this page; the
  // toggle below reveals it for cleanup without changing the "unidentified"
  // count used to gate the section itself (see Step 4's render condition).
  const syntheticCount = unidentified.filter((a) => isSyntheticAgentId(a.agent_id)).length;
  const visibleUnidentified = showTestAgents ? unidentified : unidentified.filter((a) => !isSyntheticAgentId(a.agent_id));

  const unidentifiedColumns: ListColumn<UnidentifiedAgent>[] = [
    { key: 'agent', label: 'Agent', accessor: (a) => a.agent_name || a.agent_id, sortable: true },
    { key: 'actions', label: 'Actions', accessor: (a) => a.action_count, sortable: true },
    { key: 'last_active', label: 'Last active', accessor: (a) => a.last_active, sortable: true },
  ];
  const unidentifiedControls = useListControls(visibleUnidentified, unidentifiedColumns, { defaultSortKey: 'actions', defaultSortDir: 'desc' });

  // Selection is built over the control-processed (filtered/sorted) rows so
  // "select all" only selects what's currently visible.
  const unidentifiedSelection = useSelection<UnidentifiedAgent>(unidentifiedControls.rows, (a) => a.agent_id);

  const handleCleanupTestAgents = async () => {
    if (!window.confirm(`Delete ${syntheticCount} test agents and ALL their recorded actions? The decisions ledger totals will shrink. This cannot be undone.`)) return;
    setCleaning(true);
    try {
      const res = await fetch('/api/actions?synthetic=true', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Cleanup failed'); return; }
      showSuccess(`Deleted ${data.deleted} test-agent actions. Roster refreshed.`);
      await fetchAll();
    } catch { setError('Cleanup failed'); }
    finally { setCleaning(false); }
  };

  const handleBulkDeleteAgents = async () => {
    const ids = unidentifiedSelection.selectedIds;
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} agent(s) and ALL their recorded actions? This cannot be undone.`)) return;
    const res = await fetch(`/api/actions?agent_ids=${encodeURIComponent(ids.join(','))}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Delete failed'); return; }
    showSuccess(`Deleted ${data.deleted} actions across ${ids.length} agent(s).`);
    unidentifiedSelection.clear();
    await fetchAll();
  };

  const handleBulkRequestPairing = async () => {
    if (unidentifiedSelection.count === 0) return;
    const ids = unidentifiedSelection.selectedIds.filter((id) => !requestedIds.has(id));
    const results = await Promise.all(ids.map((id) => requestPairing(id)));
    const ok = results.filter(Boolean).length;
    if (ok > 0) showSuccess(`Pairing requested for ${ok} agent${ok === 1 ? '' : 's'}, delivered at their next governed session.`);
    unidentifiedSelection.clear();
  };

  const identitiesColumns: ListColumn<Identity>[] = [
    { key: 'agent', label: 'Agent', accessor: (i) => i.agent_name || i.agent_id, sortable: true },
    { key: 'permission', label: 'Permission', accessor: (i) => i.permission_level, filterable: true },
    { key: 'enrolled', label: 'Enrolled', accessor: (i) => i.created_at, sortable: true },
  ];
  const identitiesControls = useListControls(identities, identitiesColumns);

  const selection = useSelection<Identity>(identitiesControls.rows, (identity) => identity.agent_id);
  useSelectAllHotkey(selection.toggleAll);

  const handleBulkRevoke = async () => {
    if (selection.count === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Revoke ${selection.count} identity(s)? This cannot be undone.`)) return;
    await bulkAction(selection.selectedIds, (id) => fetch(`/api/identities/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    await fetchAll();
    selection.clear();
  };

  const BULK_ACTIONS = [
    { id: 'revoke', label: 'Revoke', icon: Trash2, danger: true, onClick: handleBulkRevoke },
  ];

  if (loading || !sessionSettled) {
    return (
      <PageLayout agentFilter={false}
        title="Agent Identities"
        subtitle="Manage agent pairings and approved identities"
        breadcrumbs={['Dashboard', 'Agent Identities']}
      >
        <div className="flex items-center justify-center py-20">
          <div className="text-sm text-tertiary">Loading identities...</div>
        </div>
      </PageLayout>
    );
  }

  if (!isAdmin && !demo) {
    return (
      <PageLayout agentFilter={false}
        title="Agent Identities"
        subtitle="Manage agent pairings and approved identities"
        breadcrumbs={['Dashboard', 'Agent Identities']}
        maturity="stable"
      >
        <Card hover={false}>
          <CardContent className="pt-8 pb-8 text-center">
            <div className="flex justify-center mb-3">
              <Shield size={32} className="text-disabled" />
            </div>
            <div className="text-sm font-medium text-secondary mb-1">Admin access required</div>
            <div className="text-xs text-tertiary">Only workspace admins can manage agent identities.</div>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout agentFilter={false}
      title="Agent Identities"
      subtitle="Manage agent pairings and approved identities"
      breadcrumbs={['Dashboard', 'Agent Identities']}
      maturity="stable"
      actions={<BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />}
    >
      {/* Demo mode: fixtures are visible, writes are middleware-blocked */}
      {demo && !isAdmin && (
        <div className="mb-4 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-tertiary">
          Demo mode &middot; identities are read-only.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-error-subtle border border-error/20 rounded-lg text-sm text-error flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-error hover:text-error ml-4">&times;</button>
        </div>
      )}

      {/* Success banner */}
      {successMsg && (
        <div className="mb-4 p-3 bg-status-success/10 border border-status-success/20 rounded-lg text-sm text-success flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-success hover:text-success ml-4">&times;</button>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Total Identities" value={identities.length} color="text-white" />
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Unidentified Agents" value={visibleUnidentified.length} color={visibleUnidentified.length > 0 ? 'text-warning' : 'text-secondary'} />
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Pending Pairings" value={pendingPairings.length} color={pendingPairings.length > 0 ? 'text-warning' : 'text-secondary'} />
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact
              label="Signature Enforcement"
              value={enforcementOn ? 'On' : 'Off'}
              color={enforcementOn ? 'text-success' : 'text-tertiary'}
            />
          </CardContent>
        </Card>
      </div>

      {/* Unidentified agents — the coverage gap to drive to zero. */}
      {unidentified.length > 0 && (
        <CollapsibleSection
          id="identities.unidentified"
          title="Unidentified Agents"
          icon={UserX}
          iconClassName="text-warning"
          count={unidentified.length}
          badgeVariant="warning"
          controls={<ListControlsBar columns={unidentifiedColumns} controls={unidentifiedControls} searchPlaceholder="Search agents…" />}
          actions={
            <>
              <SelectCheckbox
                checked={unidentifiedSelection.allSelected}
                onToggle={() => unidentifiedSelection.toggleAll()}
                label="Select all unidentified agents"
              />
              <BulkActionBar
                count={unidentifiedSelection.count}
                actions={[
                  { id: 'request-pairing', label: 'Request pairing', icon: Send, onClick: handleBulkRequestPairing },
                  { id: 'delete', label: 'Delete', icon: Trash2, danger: true, onClick: handleBulkDeleteAgents },
                ]}
                onClear={unidentifiedSelection.clear}
              />
              {isAdmin && syntheticCount > 0 && !demo && (
                <button
                  type="button"
                  onClick={handleCleanupTestAgents}
                  disabled={cleaning}
                  className="inline-flex items-center gap-1.5 rounded-md border border-error/30 px-2.5 py-1 text-xs text-error transition-colors hover:bg-error-subtle disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {cleaning ? 'Cleaning…' : `Clean up test agents (${syntheticCount})`}
                </button>
              )}
              {syntheticCount > 0 && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={showTestAgents}
                  onClick={() => setShowTestAgents((v) => !v)}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                    showTestAgents
                      ? 'border-brand/40 bg-brand/10 text-brand'
                      : 'border-border text-tertiary hover:border-border-hover hover:text-white',
                  ].join(' ')}
                >
                  Show test agents
                </button>
              )}
            </>
          }
        >
          <div data-testid="unidentified-section">
            <Card hover={false}>
              <div className="divide-y divide-white/[0.04]">
                {unidentifiedControls.rows.map((agent) => {
                  const requested = requestedIds.has(agent.agent_id);
                  const requesting = requestingIds.has(agent.agent_id);
                  return (
                    <div key={agent.agent_id} data-entity-type="agent" data-entity-id={agent.agent_id} className="px-5 py-3 flex items-center gap-4">
                      <SelectCheckbox
                        checked={unidentifiedSelection.isSelected(agent.agent_id)}
                        onToggle={() => unidentifiedSelection.toggle(agent.agent_id)}
                        label={`Select ${agent.agent_id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-secondary truncate">{agent.agent_name || agent.agent_id}</span>
                          {agent.agent_name && (
                            <code className="text-[10px] font-mono text-tertiary truncate">{agent.agent_id}</code>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-disabled tabular-nums">
                          <span>{agent.action_count} actions</span>
                          {agent.last_active && <span>Last active {formatDate(agent.last_active)}</span>}
                        </div>
                      </div>
                      {requested ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-tertiary" title="Delivered to the agent's inbox; it pairs next time it runs with DashClaw attached.">
                          <CheckCircle size={12} aria-hidden="true" /> Requested
                        </span>
                      ) : (
                        <button
                          onClick={() => handleRequestPairing(agent.agent_id)}
                          disabled={requesting}
                          className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50"
                        >
                          <Send size={11} aria-hidden="true" /> {requesting ? 'Requesting…' : 'Request pairing'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
            <p className="mt-2 text-[11px] text-tertiary">
              Requests ride the agent inbox: each agent sees its request the next time it runs with DashClaw attached
              (MCP <code className="font-mono">dashclaw_pair</code>, Node <code className="font-mono">claw.createPairing()</code>, Python <code className="font-mono">claw.create_pairing()</code>).
            </p>
          </div>
        </CollapsibleSection>
      )}

      {/* Pending Pairings */}
      <CollapsibleSection
        id="identities.pending"
        title="Pending Pairings"
        icon={Clock}
        iconClassName="text-warning"
        count={pendingPairings.length}
        badgeVariant="warning"
      >
        {pendingPairings.length === 0 ? (
          <Card hover={false}>
            <CardContent className="pt-4">
              <EmptyState
                icon={Clock}
                title="No pending pairings"
                description="Pairing requests will appear here for review."
              />
            </CardContent>
          </Card>
        ) : (
          <Card hover={false}>
            <div className="divide-y divide-white/[0.04]">
              {pendingPairings.map((pairing) => {
                const remaining = timeLeft(pairing.expires_at);
                const isExpired = remaining === 'Expired';

                return (
                  <div key={pairing.id} data-entity-type="identity" data-entity-id={pairing.id} data-entity-status={isExpired ? 'expired' : 'pending'} className="px-5 py-4 flex items-center gap-4">
                    <div className="w-8 h-8 rounded-lg bg-warning-subtle flex items-center justify-center flex-shrink-0">
                      <Fingerprint size={14} className="text-warning" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-secondary truncate">
                          {pairing.agent_name || pairing.agent_id}
                        </span>
                        {pairing.agent_name && (
                          <code className="text-[10px] font-mono text-tertiary truncate">{pairing.agent_id}</code>
                        )}
                        <Badge variant={isExpired ? 'error' : 'warning'} size="xs">
                          {isExpired ? 'Expired' : 'Pending'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-disabled">Requested {formatDate(pairing.created_at)}</span>
                        {remaining && (
                          <span className={`text-[10px] ${isExpired ? 'text-error' : 'text-warning'}`}>
                            {remaining}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Permission level + approve */}
                    {!isExpired && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <select
                          value={permLevels[pairing.id] || 'readonly'}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                            setPermLevels((prev) => ({ ...prev, [pairing.id]: e.target.value }))
                          }
                          className="bg-surface-tertiary border border-white/[0.06] rounded-lg px-2 py-1.5 text-xs text-secondary focus:outline-none focus:border-brand transition-colors"
                        >
                          {PERMISSION_LEVELS.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleApprove(pairing.id)}
                          disabled={approvingId === pairing.id}
                          className="px-3 py-1.5 text-xs font-medium bg-brand hover:bg-brand/90 text-white rounded-lg transition-colors disabled:opacity-50"
                        >
                          {approvingId === pairing.id ? 'Approving...' : 'Approve'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </CollapsibleSection>

      {/* Approved Identities */}
      <CollapsibleSection
        id="identities.approved"
        title="Approved Identities"
        icon={Shield}
        iconClassName="text-success"
        count={identities.length}
        badgeVariant="success"
        controls={identities.length > 0 ? <ListControlsBar columns={identitiesColumns} controls={identitiesControls} searchPlaceholder="Search identities…" /> : undefined}
        actions={
          identities.length > 0 ? (
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all"
            />
          ) : undefined
        }
      >
        {identities.length === 0 ? (
          <Card hover={false}>
            <CardContent className="pt-4">
              <EmptyState
                icon={Fingerprint}
                title="No approved identities"
                description="Approved agent identities will appear here. To enroll one, approve a request in Pending Pairings above, or go to Settings → Agent Identity to register a public key manually or share a pairing URL."
              />
            </CardContent>
          </Card>
        ) : (
          <Card hover={false}>
            <div className="divide-y divide-white/[0.04]">
              {identitiesControls.rows.map((identity) => {
                const isConfirmingRevoke = revokingId === identity.agent_id;
                const permLevel = identity.permission_level || 'readonly';

                return (
                  <div key={identity.agent_id} data-entity-type="identity" data-entity-id={identity.agent_id} data-entity-status={identity.permission_level || 'readonly'} className="px-5 py-4 flex items-center gap-4">
                    <SelectCheckbox
                      checked={selection.isSelected(identity.agent_id)}
                      onToggle={(e) => { e.stopPropagation(); selection.selectClick(identity.agent_id, e.shiftKey); }}
                      label={`Select ${identity.agent_name || identity.agent_id}`}
                    />
                    <div className="w-8 h-8 rounded-lg bg-status-success/10 flex items-center justify-center flex-shrink-0">
                      <Fingerprint size={14} className="text-success" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-secondary truncate">
                          {identity.agent_name || identity.agent_id}
                        </span>
                        {identity.agent_name && (
                          <code className="text-[10px] font-mono text-tertiary truncate">{identity.agent_id}</code>
                        )}
                        <Badge variant={PERMISSION_BADGE_VARIANT[permLevel] || 'default'} size="xs">
                          {permLevel}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-disabled">
                          Enrolled {formatDate(identity.created_at)}
                        </span>
                        {identity.algorithm && (
                          <span className="text-[10px] text-disabled">{identity.algorithm}</span>
                        )}
                      </div>
                    </div>

                    {/* Revoke */}
                    <div className="flex-shrink-0">
                      {isConfirmingRevoke ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-secondary">Revoke?</span>
                          <button
                            onClick={() => handleRevoke(identity.agent_id)}
                            disabled={revokeLoading}
                            className="px-2.5 py-1 text-xs font-medium text-error bg-error-subtle border border-error/20 rounded-md hover:bg-error-subtle transition-colors disabled:opacity-50"
                          >
                            {revokeLoading ? 'Revoking...' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setRevokingId(null)}
                            className="px-2.5 py-1 text-xs text-secondary hover:text-white transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRevokingId(identity.agent_id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-tertiary hover:text-error transition-colors"
                        >
                          <AlertTriangle size={12} />
                          Revoke
                        </button>
                      )}
                    </div>
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
