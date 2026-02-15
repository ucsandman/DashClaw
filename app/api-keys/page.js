'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { KeyRound, Plus, Copy, Check, Ban, AlertTriangle, ArrowRight } from 'lucide-react';
import PageLayout from '../components/PageLayout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { StatCompact } from '../components/ui/Stat';
import { EmptyState } from '../components/ui/EmptyState';
import ConnectAgentButton from '../components/ConnectAgentButton';

export default function ApiKeysPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';

  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [error, setError] = useState(null);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [creating, setCreating] = useState(false);

  // Newly created key (shown once)
  const [newKey, setNewKey] = useState(null);
  const [copied, setCopied] = useState(false);

  // Revoke confirmation
  const [revokingId, setRevokingId] = useState(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys');
      const data = await res.json();

      if (res.status === 403 && data.needsOnboarding) {
        setNeedsOnboarding(true);
        setLoading(false);
        return;
      }

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
        body: JSON.stringify({ label: newLabel.trim() }),
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

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
    }
  };

  const handleRevoke = async (keyId) => {
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

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  // Onboarding guard
  if (needsOnboarding) {
    return (
      <PageLayout
        title="API Keys"
        subtitle="Manage your workspace API keys"
        breadcrumbs={['Dashboard', 'API Keys']}
      >
        <Card hover={false}>
          <CardContent className="pt-6">
            <EmptyState
              icon={AlertTriangle}
              title="Workspace Required"
              description="Complete onboarding to create a workspace before managing API keys."
              action={
                <a
                  href="/setup"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand/90 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Go to Setup <ArrowRight size={14} />
                </a>
              }
            />
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  // Loading state
  if (loading) {
    return (
      <PageLayout
        title="API Keys"
        subtitle="Manage your workspace API keys"
        breadcrumbs={['Dashboard', 'API Keys']}
      >
        <div className="flex items-center justify-center py-20">
          <div className="text-sm text-zinc-500">Loading API keys...</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="API Keys"
      subtitle="Manage your workspace API keys"
      breadcrumbs={['Dashboard', 'API Keys']}
      actions={
        <div className="flex items-center gap-2">
          <ConnectAgentButton />
          {isAdmin && (
            <button
              onClick={() => { setShowCreateForm(true); setNewKey(null); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-brand hover:bg-brand/90 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={14} />
              Generate New Key
            </button>
          )}
        </div>
      }
    >
      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 ml-4">&times;</button>
        </div>
      )}

      {/* Newly created key banner */}
      {newKey && (
        <Card hover={false} className="mb-6 border-green-500/30">
          <CardContent className="pt-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <KeyRound size={16} className="text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-green-400 mb-1">Key Created: {newKey.label}</div>
                <p className="text-xs text-zinc-400 mb-3">Copy your API key now. It will not be shown again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-surface-tertiary border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2 text-sm font-mono text-green-400 overflow-x-auto">
                    {newKey.raw_key}
                  </code>
                  <button
                    onClick={() => handleCopy(newKey.raw_key)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-surface-tertiary border border-[rgba(255,255,255,0.06)] rounded-lg text-sm text-zinc-300 hover:text-white hover:border-[rgba(255,255,255,0.12)] transition-colors flex-shrink-0"
                  >
                    {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <ConnectAgentButton className="flex-shrink-0" />
                </div>
              </div>
              <button
                onClick={() => setNewKey(null)}
                className="text-zinc-500 hover:text-zinc-300 text-lg leading-none flex-shrink-0"
              >
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
            <StatCompact label="Total Keys" value={keys.length} color="text-white" />
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Active" value={activeKeys.length} color="text-green-400" />
          </CardContent>
        </Card>
        <Card hover={false}>
          <CardContent className="pt-4 pb-4">
            <StatCompact label="Revoked" value={revokedKeys.length} color="text-red-400" />
          </CardContent>
        </Card>
      </div>

      {/* Create form (inline, admin only) */}
      {showCreateForm && isAdmin && (
        <Card hover={false} className="mb-6">
          <CardContent className="pt-5">
            <div className="text-sm font-medium text-zinc-200 mb-3">Generate New API Key</div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Key label (e.g. Production, Staging)"
                maxLength={256}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="flex-1 bg-surface-tertiary border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-brand transition-colors"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newLabel.trim()}
                className="px-4 py-2 bg-brand hover:bg-brand/90 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => { setShowCreateForm(false); setNewLabel(''); }}
                className="px-3 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key list */}
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
                    className="flex items-center gap-1.5 px-4 py-2 bg-brand hover:bg-brand/90 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <Plus size={14} />
                    Generate Key
                  </button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card hover={false}>
          <div className="divide-y divide-[rgba(255,255,255,0.04)]">
            {keys.map((key) => {
              const isRevoked = !!key.revoked_at;
              const isConfirmingRevoke = revokingId === key.id;

              return (
                <div key={key.id} className="px-5 py-4 flex items-center gap-4">
                  {/* Key icon + prefix */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isRevoked ? 'bg-zinc-500/10' : 'bg-brand-subtle'}`}>
                      <KeyRound size={14} className={isRevoked ? 'text-zinc-500' : 'text-brand'} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isRevoked ? 'text-zinc-500' : 'text-zinc-200'}`}>
                          {key.label || 'API Key'}
                        </span>
                        <Badge variant={isRevoked ? 'error' : 'success'} size="xs">
                          {isRevoked ? 'Revoked' : 'Active'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <code className={`text-xs font-mono ${isRevoked ? 'text-zinc-600' : 'text-zinc-400'}`}>
                          {key.key_prefix}...
                        </code>
                        <span className="text-[10px] text-zinc-600">
                          Created {formatDate(key.created_at)}
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          Last used: {formatDate(key.last_used_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions (admin only) */}
                  {!isRevoked && isAdmin && (
                    <div className="flex-shrink-0">
                      {isConfirmingRevoke ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-400">Revoke?</span>
                          <button
                            onClick={() => handleRevoke(key.id)}
                            disabled={revokeLoading}
                            className="px-2.5 py-1 text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-md hover:bg-red-500/20 transition-colors disabled:opacity-50"
                          >
                            {revokeLoading ? 'Revoking...' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setRevokingId(null)}
                            className="px-2.5 py-1 text-xs text-zinc-400 hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRevokingId(key.id)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          <Ban size={12} />
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
    </PageLayout>
  );
}
