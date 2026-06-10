'use client';

import { useState, useEffect, useCallback } from 'react';
import { Fingerprint, Shield, CheckCircle, Clock, AlertTriangle, Trash2 } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import { useEffectiveRole } from '../hooks/useEffectiveRole';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';

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

  const [pendingPairings, setPendingPairings] = useState<Pairing[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [enforcementOn, setEnforcementOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Per-row state
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [permLevels, setPermLevels] = useState<Record<string, string>>({});
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [pendingRes, identitiesRes, settingsRes] = await Promise.all([
        fetch('/api/pairings?status=pending&limit=200'),
        fetch('/api/identities'),
        fetch('/api/settings?key=ENFORCE_AGENT_SIGNATURES'),
      ]);

      if (pendingRes.ok) {
        const data = await pendingRes.json();
        setPendingPairings(data.pairings || []);
        // Initialize permission level dropdowns from existing pairing data
        const initLevels: Record<string, string> = {};
        (data.pairings || []).forEach((p: Pairing) => {
          initLevels[p.id] = p.permission_level || 'readonly';
        });
        setPermLevels((prev) => ({ ...initLevels, ...prev }));
      }

      if (identitiesRes.ok) {
        const data = await identitiesRes.json();
        setIdentities(data.identities || []);
      }

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const setting = (data.settings || []).find((s: Setting) => s.key === 'ENFORCE_AGENT_SIGNATURES');
        setEnforcementOn(setting?.value === 'true' || setting?.value === true);
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
      const res = await fetch(`/api/pairings/${encodeURIComponent(pairingId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved', permission_level: permLevel }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to approve pairing');
        return;
      }
      showSuccess('Pairing approved successfully.');
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

  const selection = useSelection<Identity>(identities, (identity) => identity.agent_id);
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

  if (!isAdmin) {
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
      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-error-subtle border border-error/20 rounded-lg text-sm text-error flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-error hover:text-error ml-4">&times;</button>
        </div>
      )}

      {/* Success banner */}
      {successMsg && (
        <div className="mb-4 p-3 bg-status-success/10 border border-green-500/20 rounded-lg text-sm text-success flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-success hover:text-success ml-4">&times;</button>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Total Identities" value={identities.length} color="text-white" />
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

      {/* Pending Pairings */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Clock size={16} className="text-warning" />
          <h2 className="text-sm font-medium text-secondary">Pending Pairings</h2>
          {pendingPairings.length > 0 && (
            <Badge variant="warning" size="xs">{pendingPairings.length}</Badge>
          )}
        </div>

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
      </div>

      {/* Approved Identities */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          {identities.length > 0 && (
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all"
            />
          )}
          <Shield size={16} className="text-success" />
          <h2 className="text-sm font-medium text-secondary">Approved Identities</h2>
          {identities.length > 0 && (
            <Badge variant="success" size="xs">{identities.length}</Badge>
          )}
        </div>

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
              {identities.map((identity) => {
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
      </div>
    </PageLayout>
  );
}
