'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Plus, Trash2 } from 'lucide-react';

const ACCESS_PILL: Record<string, { label: string; color: string }> = {
  allow: { label: 'Allow', color: 'bg-emerald-400/10 text-success border-success/20' },
  deny: { label: 'Deny', color: 'bg-red-400/10 text-error border-error/20' },
  require_approval: { label: 'Require Approval', color: 'bg-amber-400/10 text-warning border-warning/20' },
};

interface CapabilityAccessTabProps {
  capabilityId: string;
}

export default function CapabilityAccessTab({ capabilityId }: CapabilityAccessTabProps) {
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formAgentId, setFormAgentId] = useState('');
  const [formAccess, setFormAccess] = useState('deny');
  const [formReason, setFormReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dry-run: resolve the effective access decision for a specific agent.
  const [checkAgentId, setCheckAgentId] = useState('');
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch(`/api/capabilities/${capabilityId}/access`);
      if (res.ok) {
        const data = await res.json();
        setRules(data.rules || []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [capabilityId]);

  useEffect(() => { loadRules(); }, [loadRules]);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/capabilities/${capabilityId}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: formAgentId.trim() || undefined,
          access: formAccess,
          reason: formReason.trim() || undefined,
        }),
      });
      if (res.ok) {
        setFormAgentId('');
        setFormAccess('deny');
        setFormReason('');
        setShowForm(false);
        await loadRules();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to create rule');
      }
    } catch {
      setError('Failed to create rule');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ruleId: string) {
    try {
      const res = await fetch(`/api/capabilities/${capabilityId}/access/${ruleId}`, { method: 'DELETE' });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.rule_id !== ruleId));
      }
    } catch { /* ignore */ }
  }

  async function handleCheck() {
    if (!checkAgentId.trim()) return;
    setChecking(true);
    setCheckError(null);
    setCheckResult(null);
    try {
      const res = await fetch(`/api/capabilities/${capabilityId}/access/check?agent_id=${encodeURIComponent(checkAgentId.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCheckError(data.error || 'Access check failed');
        return;
      }
      setCheckResult(data);
    } catch {
      setCheckError('Access check failed');
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-tertiary py-4">Loading access rules...</div>;
  }

  const inputClass = 'w-full px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand';

  const checkPill = checkResult ? (ACCESS_PILL[checkResult.access] || ACCESS_PILL.deny) : null;

  return (
    <div className="space-y-4">
      {/* Dry-run effective-access check */}
      <div className="rounded-lg border border-border bg-white/[0.02] p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-secondary">
          <ShieldCheck className="w-3.5 h-3.5 text-brand" /> Check effective access
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={checkAgentId}
            onChange={(e) => setCheckAgentId(e.target.value)}
            placeholder="Agent ID to resolve"
            aria-label="Agent ID to check"
            className="min-w-[160px] flex-1 px-3 py-2 bg-surface-tertiary border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-brand"
          />
          <button
            onClick={handleCheck}
            disabled={checking || !checkAgentId.trim()}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 transition-colors disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Check access'}
          </button>
        </div>
        {checkError && <div className="mt-2 text-xs text-error" role="alert">{checkError}</div>}
        {checkResult && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" role="status">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${checkPill!.color}`}>{checkPill!.label}</span>
            <span className="text-tertiary">
              {checkResult.rule
                ? (checkResult.rule.agent_id ? `Matched rule for ${checkResult.rule.agent_id}` : 'Matched org-wide default rule')
                : 'No rule matched — default allow'}
              {checkResult.rule?.reason ? ` · ${checkResult.rule.reason}` : ''}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-tertiary">
          {rules.length === 0 ? 'No access rules — all agents can invoke this capability.' : `${rules.length} rule${rules.length !== 1 ? 's' : ''} configured`}
        </span>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Add Rule
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-white/[0.02] p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">Agent ID (leave blank for org-wide default)</label>
            <input
              type="text"
              value={formAgentId}
              onChange={(e) => setFormAgentId(e.target.value)}
              placeholder="e.g. deploy-bot"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">Access Level</label>
            <select
              value={formAccess}
              onChange={(e) => setFormAccess(e.target.value)}
              className={inputClass}
            >
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
              <option value="require_approval">Require Approval</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary uppercase tracking-wider mb-1.5">Reason (optional)</label>
            <input
              type="text"
              value={formReason}
              onChange={(e) => setFormReason(e.target.value)}
              placeholder="e.g. Production API — restricted access"
              className={inputClass}
            />
          </div>
          {error && <div className="text-xs text-error">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Rule'}
            </button>
            <button
              onClick={() => { setShowForm(false); setError(null); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-secondary hover:text-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map((rule) => {
            const pill = (ACCESS_PILL[rule.access] || ACCESS_PILL.deny) as { label: string; color: string };
            return (
              <div key={rule.rule_id} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${pill.color}`}>
                  {pill.label}
                </span>
                <span className="text-sm text-secondary flex-1">
                  {rule.agent_id || <span className="text-tertiary italic">All agents (default)</span>}
                </span>
                {rule.reason && <span className="text-xs text-tertiary truncate max-w-[200px]">{rule.reason}</span>}
                <button
                  onClick={() => handleDelete(rule.rule_id)}
                  className="text-disabled hover:text-error transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
