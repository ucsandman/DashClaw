'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  UsersRound, Plus, Copy, Check, Ban, AlertTriangle,
  ArrowRight, Shield, UserMinus, LogOut, Link2, Mail, Clock, Trash2,
} from 'lucide-react';
import Image from 'next/image';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import OrgNameEditor from './components/OrgNameEditor';
import { isDemoMode } from '../lib/isDemoMode';
import { useSelection } from '../lib/useSelection';
import { useSelectAllHotkey } from '../lib/useSelectAllHotkey';
import { SelectCheckbox } from '../components/selection/SelectCheckbox';
import { BulkActionBar } from '../components/selection/BulkActionBar';
import { bulkAction } from '../lib/bulkAction';

export default function TeamPage() {
  const isDemo = isDemoMode();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite form
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [creating, setCreating] = useState(false);

  // Newly created invite
  const [newInvite, setNewInvite] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  // Pending invites
  const [invites, setInvites] = useState<any[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Role change / remove confirmations
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [removingUser, setRemovingUser] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Leave workspace
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const fetchTeam = useCallback(async () => {
    try {
      const res = await fetch('/api/team');
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load team');
        setLoading(false);
        return;
      }
      setData(json);
    } catch {
      setError('Failed to connect to API');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInvites = useCallback(async () => {
    try {
      const res = await fetch('/api/team/invite');
      if (res.ok) {
        const json = await res.json();
        setInvites(json.invites || []);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchTeam();
    fetchInvites();
  }, [fetchTeam, fetchInvites]);

  const handleCreateInvite = async () => {
    setCreating(true);
    setError(null);
    try {
      const body: any = { role: inviteRole };
      if (inviteEmail.trim()) body.email = inviteEmail.trim();

      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to create invite');
        return;
      }
      setNewInvite(json.invite);
      setInviteEmail('');
      setInviteRole('member');
      setShowInviteForm(false);
      await fetchInvites();
    } catch {
      setError('Failed to create invite');
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
      // Fallback
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    try {
      const res = await fetch(`/api/team/invite?id=${encodeURIComponent(inviteId)}`, { method: 'DELETE' });
      if (res.ok) {
        setRevokingId(null);
        await fetchInvites();
      }
    } catch {
      setError('Failed to revoke invite');
    }
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/team/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to change role');
        return;
      }
      setChangingRole(null);
      await fetchTeam();
    } catch {
      setError('Failed to change role');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/team/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to remove member');
        return;
      }
      setRemovingUser(null);
      await fetchTeam();
    } catch {
      setError('Failed to remove member');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = async () => {
    setLeaving(true);
    try {
      const self = data?.members?.find((m: any) => m.is_self);
      if (!self) return;
      const res = await fetch(`/api/team/${encodeURIComponent(self.id)}?action=leave`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Failed to leave workspace');
        setLeaving(false);
        return;
      }
      // Full page reload to refresh JWT with new org_id
      window.location.href = '/dashboard';
    } catch {
      setError('Failed to leave workspace');
      setLeaving(false);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatExpiry = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    if (diff <= 0) return 'Expired';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  };

  // Determine if current user is admin
  const currentUser = data?.members?.find((m: any) => m.is_self);
  const isAdmin = currentUser?.role === 'admin';
  const canEdit = isAdmin && !isDemo;
  const adminCount = data?.members?.filter((m: any) => m.role === 'admin').length || 0;
  const isLastAdmin = isAdmin && adminCount <= 1;

  // Multi-select: only members an admin can actually remove (never self).
  const selectableMembers = (data?.members || []).filter((m: any) => !m.is_self);
  const selection = useSelection<any>(selectableMembers, (member) => member.id);
  useSelectAllHotkey(selection.toggleAll);

  const handleBulkRemove = async () => {
    if (selection.count === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(`Remove ${selection.count} member(s)? This cannot be undone.`)) return;
    await bulkAction(selection.selectedIds, (id) => fetch(`/api/team/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    await fetchTeam();
    selection.clear();
  };

  const BULK_ACTIONS = [
    { id: 'remove', label: 'Remove', icon: Trash2, danger: true, onClick: handleBulkRemove },
  ];

  if (loading) {
    return (
      <PageLayout title="Team" subtitle="Manage workspace members" breadcrumbs={['Dashboard', 'Team']}>
        <div className="flex items-center justify-center py-20">
          <div className="text-sm text-tertiary">Loading team...</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Team"
      subtitle={data?.org ? `${data.org.name} workspace` : 'Manage workspace members'}
      breadcrumbs={['Dashboard', 'Team']}
      actions={
        <>
          {isAdmin && !isDemo && (
            <button
              onClick={() => { setShowInviteForm(true); setNewInvite(null); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand/90 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={14} />
              Invite Member
            </button>
          )}
          <BulkActionBar count={selection.count} actions={BULK_ACTIONS} onClear={selection.clear} />
        </>
      }
    >
      {data?.org && (
        <OrgNameEditor
          orgId={data.org.id}
          name={data.org.name}
          isAdmin={canEdit}
          onRenamed={(name: string) => setData((d: any) => ({ ...d, org: { ...d.org, name } }))}
        />
      )}
      {isDemo && (
        <div className="mb-4 p-3 rounded-lg bg-zinc-500/10 border border-zinc-500/20 text-secondary text-sm">
          Demo mode: team management is read-only.
        </div>
      )}
      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-error-subtle border border-error/20 rounded-lg text-sm text-error flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-error hover:text-error ml-4">&times;</button>
        </div>
      )}

      {/* Newly created invite banner */}
      {newInvite && (
        <Card hover={false} className="mb-6 border-green-500/30">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-status-success/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Link2 size={16} className="text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-success mb-1">
                  Invite Created{newInvite.email ? ` for ${newInvite.email}` : ''}
                </div>
                <p className="text-xs text-secondary mb-3">
                  Share this link with the person you want to invite. It expires in 7 days.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-surface-tertiary border border-border rounded-lg px-3 py-2 text-sm font-mono text-success overflow-x-auto">
                    {newInvite.invite_url}
                  </code>
                  <button
                    onClick={() => handleCopy(newInvite.invite_url)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-surface-tertiary border border-border rounded-lg text-sm text-secondary hover:text-white hover:border-border-hover transition-colors flex-shrink-0"
                  >
                    {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <button onClick={() => setNewInvite(null)} className="text-tertiary hover:text-secondary text-lg leading-none flex-shrink-0">
                &times;
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Total Members" value={data?.member_count || 0} color="text-white" />
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Admins" value={adminCount} color="text-brand" />
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Pending Invites" value={invites.length} color="text-info" />
          </CardContent>
        </Card>
      </div>

      {/* Invite form (inline, admin only) */}
      {showInviteForm && canEdit && (
        <Card hover={false} className="mb-6">
          <CardContent className="pt-5">
            <div className="text-sm font-medium text-secondary mb-3">Create Invite Link</div>
            <div className="flex items-center gap-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Email (optional — leave blank for open invite)"
                className="flex-1 bg-surface-tertiary border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="bg-surface-tertiary border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand transition-colors"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={handleCreateInvite}
                disabled={creating}
                className="px-4 py-2 bg-brand hover:bg-brand/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => { setShowInviteForm(false); setInviteEmail(''); }}
                className="px-3 py-2 text-sm text-secondary hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending invites (admin only) */}
      {invites.length > 0 && (
        <Card hover={false} className="mb-6">
          <div className="px-5 py-3 border-b border-border">
            <div className="text-sm font-medium text-secondary">Pending Invites</div>
          </div>
          <div className="divide-y divide-border">
            {invites.map((inv) => (
              <div key={inv.id} className="px-5 py-3 flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg bg-info-subtle flex items-center justify-center flex-shrink-0">
                  {inv.email ? <Mail size={14} className="text-info" /> : <Link2 size={14} className="text-info" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-secondary">
                      {inv.email || 'Open invite (anyone with link)'}
                    </span>
                    <Badge variant={inv.role === 'admin' ? 'warning' : 'default'} size="xs">
                      {inv.role}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock size={10} className="text-disabled" />
                    <span className="text-[10px] text-disabled">
                      Expires in {formatExpiry(inv.expires_at)}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {canEdit ? (
                    revokingId === inv.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-secondary">Revoke?</span>
                        <button
                          onClick={() => handleRevokeInvite(inv.id)}
                          className="px-2.5 py-1 text-xs font-medium text-error bg-error-subtle border border-error/20 rounded-md hover:bg-error-subtle transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setRevokingId(null)}
                          className="px-2.5 py-1 text-xs text-secondary hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRevokingId(inv.id)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs text-tertiary hover:text-error transition-colors"
                      >
                        <Ban size={12} />
                        Revoke
                      </button>
                    )
                  ) : (
                    <span className="text-xs text-disabled">Read-only</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Members list */}
      <Card hover={false}>
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          {canEdit && selectableMembers.length > 0 && (
            <SelectCheckbox
              checked={selection.allSelected}
              onToggle={() => selection.toggleAll()}
              label="Select all members"
            />
          )}
          <div className="text-sm font-medium text-secondary">Members</div>
        </div>
        {(!data?.members || data.members.length === 0) ? (
          <CardContent className="pt-4">
            <EmptyState
              icon={UsersRound}
              title="No members"
              description="Invite your first team member to get started."
            />
          </CardContent>
        ) : (
          <div className="divide-y divide-border">
            {data.members.map((member: any) => (
              <div key={member.id} data-entity-type="teamMember" data-entity-id={member.id} className="px-5 py-4 flex items-center gap-4">
                {canEdit && !member.is_self && (
                  <SelectCheckbox
                    checked={selection.isSelected(member.id)}
                    onToggle={(e) => { e.stopPropagation(); selection.selectClick(member.id, e.shiftKey); }}
                    label={`Select ${member.name || member.email || member.id}`}
                  />
                )}
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {member.image ? (
                    <Image src={member.image} alt="" width={32} height={32} className="w-8 h-8 rounded-full" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-xs text-secondary font-medium">
                      {(member.name || member.email || '?')[0].toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-secondary">
                      {member.name || member.email}
                    </span>
                    {member.is_self && (
                      <span className="text-[10px] text-tertiary">(you)</span>
                    )}
                    <Badge variant={member.role === 'admin' ? 'warning' : 'default'} size="xs">
                      {member.role}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-tertiary">{member.email}</span>
                    <span className="text-[10px] text-disabled">
                      Last login: {formatDate(member.last_login_at)}
                    </span>
                  </div>
                </div>

                {/* Admin actions */}
                {canEdit && !member.is_self && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Role toggle */}
                    {changingRole === member.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-secondary">
                          Make {member.role === 'admin' ? 'member' : 'admin'}?
                        </span>
                        <button
                          onClick={() => handleChangeRole(member.id, member.role === 'admin' ? 'member' : 'admin')}
                          disabled={actionLoading}
                          className="px-2.5 py-1 text-xs font-medium text-brand bg-brand-subtle border border-brand/20 rounded-md hover:bg-brand/20 transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'Saving...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setChangingRole(null)}
                          className="px-2.5 py-1 text-xs text-secondary hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : removingUser === member.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-secondary">Remove?</span>
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          disabled={actionLoading}
                          className="px-2.5 py-1 text-xs font-medium text-error bg-error-subtle border border-error/20 rounded-md hover:bg-error-subtle transition-colors disabled:opacity-50"
                        >
                          {actionLoading ? 'Removing...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setRemovingUser(null)}
                          className="px-2.5 py-1 text-xs text-secondary hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setChangingRole(member.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-tertiary hover:text-brand transition-colors"
                        >
                          <Shield size={12} />
                          {member.role === 'admin' ? 'Demote' : 'Promote'}
                        </button>
                        <button
                          onClick={() => setRemovingUser(member.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-tertiary hover:text-error transition-colors"
                        >
                          <UserMinus size={12} />
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Leave workspace */}
      {!isLastAdmin && (
        <div className="mt-8 pt-6 border-t border-border">
          {showLeaveConfirm ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-secondary">Leave this workspace? You will be moved back to the default workspace.</span>
              <button
                onClick={handleLeave}
                disabled={leaving}
                className="px-3 py-1.5 text-sm font-medium text-error bg-error-subtle border border-error/20 rounded-lg hover:bg-error-subtle transition-colors disabled:opacity-50"
              >
                {leaving ? 'Leaving...' : 'Confirm Leave'}
              </button>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="px-3 py-1.5 text-sm text-secondary hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="flex items-center gap-1.5 text-sm text-tertiary hover:text-error transition-colors"
            >
              <LogOut size={14} />
              Leave Workspace
            </button>
          )}
        </div>
      )}
    </PageLayout>
  );
}
