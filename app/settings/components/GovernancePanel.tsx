'use client';

import { useState, useEffect, useCallback } from 'react';

// Governance config flags that the runtime already reads but the UI never let
// you set. All are written through the generic POST /api/settings.
//
// IMPORTANT: the predictive-risk keys MUST be stored with category 'general' —
// guard.js reads them via getSettings(sql, orgId, { category: 'general' }), so
// any other category is a silent no-op. The cost-threshold and outcome-timeout
// keys are read by key (category-agnostic), so 'general' is safe for all four.
const KEYS = {
  predictiveEnabled: 'PREDICTIVE_RISK_ENABLED',
  predictiveThreshold: 'PREDICTIVE_RISK_THRESHOLD',
  costThreshold: 'DASHCLAW_ACTION_COST_THRESHOLD',
  outcomeTimeout: 'DASHCLAW_OUTCOME_TIMEOUT_MINUTES',
};

interface GovernanceForm {
  predictiveEnabled: boolean;
  predictiveThreshold: string;
  costThreshold: string;
  outcomeTimeout: string;
}

const DEFAULTS: GovernanceForm = {
  predictiveEnabled: false,
  predictiveThreshold: '60',
  costThreshold: '',
  outcomeTimeout: '15',
};

interface SaveStatus {
  type: 'success' | 'error';
  message: string;
}

export default function GovernancePanel() {
  const [form, setForm] = useState<GovernanceForm>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SaveStatus | null>(null); // { type, message }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sRes = await fetch('/api/settings');
      const sData = await sRes.json().catch(() => ({}));
      const map: Record<string, string> = {};
      (sData.settings || []).forEach((s: { key: string; value: string }) => { map[s.key] = s.value; });
      setForm({
        predictiveEnabled: map[KEYS.predictiveEnabled] === 'true',
        predictiveThreshold: map[KEYS.predictiveThreshold] ?? DEFAULTS.predictiveThreshold,
        costThreshold: map[KEYS.costThreshold] ?? DEFAULTS.costThreshold,
        outcomeTimeout: map[KEYS.outcomeTimeout] ?? DEFAULTS.outcomeTimeout,
      });
    } catch {
      // Leave defaults — non-admins get masked/empty reads and a 403 on save.
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveKey = async (key: string, value: string): Promise<boolean> => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: String(value), category: 'general' }),
    });
    return res.ok;
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const results = await Promise.all([
        saveKey(KEYS.predictiveEnabled, form.predictiveEnabled ? 'true' : 'false'),
        saveKey(KEYS.predictiveThreshold, form.predictiveThreshold || DEFAULTS.predictiveThreshold),
        saveKey(KEYS.costThreshold, form.costThreshold || ''),
        saveKey(KEYS.outcomeTimeout, form.outcomeTimeout || DEFAULTS.outcomeTimeout),
      ]);
      setStatus(results.every(Boolean)
        ? { type: 'success', message: 'Governance settings saved.' }
        : { type: 'error', message: 'Some settings failed to save — admin access is required to modify settings.' });
    } catch {
      setStatus({ type: 'error', message: 'Network error. Could not save.' });
    }
    setSaving(false);
  };

  // True "Disconnect": removes the setting row entirely (DELETE) rather than
  // overwriting it with an empty string. Closes the settings-DELETE gap.
  const handleDisconnect = async (key: string, label: string) => {
    setStatus(null);
    const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (res.ok) {
      setStatus({ type: 'success', message: `Removed ${label}.` });
      load();
    } else {
      setStatus({ type: 'error', message: `Failed to remove ${label} — admin access is required.` });
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface-secondary p-8">
        <p className="text-sm text-tertiary">Loading governance configuration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Governance flags */}
      <div className="rounded-2xl border border-border bg-surface-secondary p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-white">Governance settings</h3>
            <p className="mt-1 text-xs text-tertiary">
              Runtime flags read on every governed action. Saved per-org.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-brand/10 border border-brand/30 text-brand hover:bg-brand/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </div>

        {status && (
          <div className={`px-4 py-2 rounded-lg text-xs ${
            status.type === 'success'
              ? 'bg-emerald-950/30 border border-emerald-900/40 text-success'
              : 'bg-red-950/30 border border-red-900/40 text-error'
          }`}>
            {status.message}
          </div>
        )}

        {/* Predictive risk */}
        <div className="space-y-3 border-t border-white/5 pt-5">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.predictiveEnabled}
              onChange={(e) => setForm((f) => ({ ...f, predictiveEnabled: e.target.checked }))}
              className="h-4 w-4 accent-brand"
            />
            <span className="text-sm text-secondary">Predictive risk scoring</span>
          </label>
          <p className="text-xs text-tertiary">
            Adjusts an action&apos;s risk from statistical analysis of the agent&apos;s history. When the predicted risk exceeds the threshold, the action is escalated.
          </p>
          {form.predictiveEnabled && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-tertiary w-32">Risk threshold (0–100)</label>
              <input
                type="number" min="0" max="100"
                value={form.predictiveThreshold}
                onChange={(e) => setForm((f) => ({ ...f, predictiveThreshold: e.target.value }))}
                className="w-24 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-secondary focus:border-brand/50 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Cost-alert threshold */}
        <div className="space-y-2 border-t border-white/5 pt-5">
          <div className="flex items-center justify-between">
            <label className="text-sm text-secondary">Action cost-alert threshold (USD)</label>
            <button
              onClick={() => handleDisconnect(KEYS.costThreshold, 'cost-alert threshold')}
              className="text-xs text-disabled hover:text-error transition-colors"
            >
              Remove
            </button>
          </div>
          <input
            type="number" min="0" step="0.01" placeholder="blank = disabled"
            value={form.costThreshold}
            onChange={(e) => setForm((f) => ({ ...f, costThreshold: e.target.value }))}
            className="w-40 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-secondary placeholder:text-zinc-700 focus:border-brand/50 focus:outline-none"
          />
          <p className="text-xs text-tertiary">Fires a cost-exceeded signal when a single action&apos;s estimated cost crosses this amount. Blank or 0 disables it.</p>
        </div>

        {/* Outcome timeout */}
        <div className="space-y-2 border-t border-white/5 pt-5">
          <div className="flex items-center justify-between">
            <label className="text-sm text-secondary">Durable-finality timeout (minutes)</label>
            <button
              onClick={() => handleDisconnect(KEYS.outcomeTimeout, 'outcome timeout')}
              className="text-xs text-disabled hover:text-error transition-colors"
            >
              Remove
            </button>
          </div>
          <input
            type="number" min="1" max="1440"
            value={form.outcomeTimeout}
            onChange={(e) => setForm((f) => ({ ...f, outcomeTimeout: e.target.value }))}
            className="w-40 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-secondary focus:border-brand/50 focus:outline-none"
          />
          <p className="text-xs text-tertiary">Pending outcomes older than this are swept to <code className="text-secondary bg-black/40 px-1 rounded">lost_confirmation</code>. Clamped to 1–1440; default 15.</p>
        </div>
      </div>
    </div>
  );
}
