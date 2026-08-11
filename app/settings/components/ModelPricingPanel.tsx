'use client';

import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_PRICING as ENGINE_PRICING } from '../../lib/billing';

// Seed the editor from the engine's canonical pricing table (app/lib/billing.js)
// so the Settings defaults can never drift from the rates actually used to
// estimate cost. Previously this was a hand-maintained copy that went stale —
// Opus 4.5/4.6 lingered at the legacy $15/$75 (real rate $5/$25), Opus 4.7/4.8
// were absent, and o3-pro read $150/$600 (real $20/$80). The editor only
// exposes input/output per 1M tokens; the engine's cache columns aren't shown.
const DEFAULT_PRICING = ENGINE_PRICING.map(({ pattern, label, input, output }: any) => ({
  pattern,
  label,
  input,
  output,
}));

export default function ModelPricingPanel() {
  const [pricing, setPricing] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<any>(null); // { type: 'success'|'error', message }
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editRow, setEditRow] = useState<any>({ pattern: '', label: '', input: '', output: '' });
  const [newRow, setNewRow] = useState<any>({ pattern: '', label: '', input: '', output: '' });

  const loadPricing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings?key=MODEL_PRICING');
      const data = await res.json();
      const setting = data.settings?.find((s: any) => s.key === 'MODEL_PRICING');
      if (setting?.value) {
        try {
          const parsed = JSON.parse(setting.value);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPricing(parsed);
            setLoading(false);
            return;
          }
        } catch {
          // Invalid JSON in stored value, fall through to defaults
        }
      }
      setPricing(DEFAULT_PRICING.map((p: any) => ({ ...p })));
    } catch {
      setPricing(DEFAULT_PRICING.map((p: any) => ({ ...p })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadPricing(); }, [loadPricing]);

  const savePricing = useCallback(async () => {
    if (!pricing) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'MODEL_PRICING',
          value: JSON.stringify(pricing),
          category: 'system',
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus({ type: 'success', message: 'Pricing saved successfully.' });
      } else {
        setStatus({ type: 'error', message: data.error || 'Failed to save pricing.' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Network error. Could not save.' });
    }
    setSaving(false);
  }, [pricing]);

  const resetToDefaults = useCallback(() => {
    setPricing(DEFAULT_PRICING.map((p: any) => ({ ...p })));
    setEditingIdx(null);
    setStatus({ type: 'success', message: 'Reset to default pricing. Click Save to persist.' });
  }, []);

  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditRow({ ...(pricing as any[])[idx] });
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditRow({ pattern: '', label: '', input: '', output: '' });
  };

  const confirmEdit = () => {
    if (!editRow.pattern || editRow.input === '' || editRow.output === '') return;
    const updated = [...(pricing as any[])];
    updated[editingIdx as number] = {
      pattern: editRow.pattern.trim(),
      label: editRow.label.trim() || editRow.pattern.trim(),
      input: parseFloat(editRow.input) || 0,
      output: parseFloat(editRow.output) || 0,
    };
    setPricing(updated);
    setEditingIdx(null);
    setEditRow({ pattern: '', label: '', input: '', output: '' });
  };

  const deleteRow = (idx: number) => {
    setPricing((pricing as any[]).filter((_, i) => i !== idx));
    if (editingIdx === idx) cancelEdit();
  };

  const addRow = () => {
    if (!newRow.pattern || newRow.input === '' || newRow.output === '') return;
    setPricing([
      ...(pricing as any[]),
      {
        pattern: newRow.pattern.trim(),
        label: newRow.label.trim() || newRow.pattern.trim(),
        input: parseFloat(newRow.input) || 0,
        output: parseFloat(newRow.output) || 0,
      },
    ]);
    setNewRow({ pattern: '', label: '', input: '', output: '' });
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface-secondary p-8">
        <p className="text-sm text-tertiary">Loading pricing configuration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="rounded-2xl border border-border bg-surface-secondary p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-white">Model Pricing</h3>
            <p className="mt-1 text-xs text-tertiary">
              Configure per-model token pricing used for cost estimation when agents report actions.
              Prices are in USD per million tokens. The pattern field is matched against the model name reported by agents.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={resetToDefaults}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-secondary hover:text-white hover:border-white/20 transition-colors"
            >
              Reset to Defaults
            </button>
            <button
              onClick={savePricing}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-brand/10 border border-brand/30 text-brand hover:bg-brand/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Pricing'}
            </button>
          </div>
        </div>

        {status && (
          <div className={`mt-4 px-4 py-2 rounded-lg text-xs ${
            status.type === 'success'
              ? 'bg-emerald-950/30 border border-emerald-900/40 text-success'
              : 'bg-red-950/30 border border-red-900/40 text-error'
          }`}>
            {status.message}
          </div>
        )}
      </div>

      {/* Pricing table */}
      <div className="rounded-2xl border border-border bg-surface-secondary overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/5">
              <th className="px-5 py-3 text-left text-[10px] uppercase tracking-widest text-disabled font-medium">Pattern</th>
              <th className="px-5 py-3 text-left text-[10px] uppercase tracking-widest text-disabled font-medium">Label</th>
              <th className="px-5 py-3 text-right text-[10px] uppercase tracking-widest text-disabled font-medium">Input $/M</th>
              <th className="px-5 py-3 text-right text-[10px] uppercase tracking-widest text-disabled font-medium">Output $/M</th>
              <th className="px-5 py-3 text-right text-[10px] uppercase tracking-widest text-disabled font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {(pricing as any[]).map((row, idx) => (
              <tr key={`${row.pattern}-${idx}`} className="group hover:bg-white/[0.02]">
                {editingIdx === idx ? (
                  <>
                    <td className="px-5 py-2">
                      <input
                        type="text"
                        value={editRow.pattern}
                        onChange={(e) => setEditRow({ ...editRow, pattern: e.target.value })}
                        className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs font-mono text-secondary focus:border-brand/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-5 py-2">
                      <input
                        type="text"
                        value={editRow.label}
                        onChange={(e) => setEditRow({ ...editRow, label: e.target.value })}
                        className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-secondary focus:border-brand/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-5 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editRow.input}
                        onChange={(e) => setEditRow({ ...editRow, input: e.target.value })}
                        className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-right font-mono text-secondary focus:border-brand/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-5 py-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editRow.output}
                        onChange={(e) => setEditRow({ ...editRow, output: e.target.value })}
                        className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-right font-mono text-secondary focus:border-brand/50 focus:outline-none"
                      />
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button onClick={confirmEdit} className="text-xs text-success hover:text-success mr-2">Save</button>
                      <button onClick={cancelEdit} className="text-xs text-tertiary hover:text-secondary">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-5 py-3 text-xs font-mono text-secondary">{row.pattern}</td>
                    <td className="px-5 py-3 text-xs text-secondary">{row.label}</td>
                    <td className="px-5 py-3 text-xs text-right font-mono text-secondary">${row.input.toFixed(2)}</td>
                    <td className="px-5 py-3 text-xs text-right font-mono text-secondary">${row.output.toFixed(2)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => startEdit(idx)} className="text-xs text-disabled hover:text-secondary mr-2 opacity-0 group-hover:opacity-100 transition-opacity">Edit</button>
                      <button onClick={() => deleteRow(idx)} className="text-xs text-disabled hover:text-error opacity-0 group-hover:opacity-100 transition-opacity">Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}

            {/* Add new row */}
            <tr className="bg-white/[0.01]">
              <td className="px-5 py-2">
                <input
                  type="text"
                  placeholder="e.g. deepseek"
                  value={newRow.pattern}
                  onChange={(e) => setNewRow({ ...newRow, pattern: e.target.value })}
                  className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs font-mono text-secondary placeholder:text-tertiary focus:border-brand/50 focus:outline-none"
                />
              </td>
              <td className="px-5 py-2">
                <input
                  type="text"
                  placeholder="Display name"
                  value={newRow.label}
                  onChange={(e) => setNewRow({ ...newRow, label: e.target.value })}
                  className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-secondary placeholder:text-tertiary focus:border-brand/50 focus:outline-none"
                />
              </td>
              <td className="px-5 py-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={newRow.input}
                  onChange={(e) => setNewRow({ ...newRow, input: e.target.value })}
                  className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-right font-mono text-secondary placeholder:text-tertiary focus:border-brand/50 focus:outline-none"
                />
              </td>
              <td className="px-5 py-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={newRow.output}
                  onChange={(e) => setNewRow({ ...newRow, output: e.target.value })}
                  className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-right font-mono text-secondary placeholder:text-tertiary focus:border-brand/50 focus:outline-none"
                />
              </td>
              <td className="px-5 py-2 text-right">
                <button
                  onClick={addRow}
                  disabled={!newRow.pattern || newRow.input === '' || newRow.output === ''}
                  className="text-xs text-brand hover:text-brand/80 disabled:text-zinc-700 disabled:cursor-not-allowed transition-colors"
                >
                  + Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Info panel */}
      <div className="rounded-2xl border border-border bg-surface-secondary p-5">
        <div className="text-[10px] font-bold text-disabled uppercase tracking-widest mb-3">How pricing works</div>
        <div className="space-y-2 text-xs text-tertiary">
          <p>
            When an agent reports an action with <code className="text-secondary bg-black/40 px-1 rounded">tokens_in</code> and <code className="text-secondary bg-black/40 px-1 rounded">tokens_out</code> but no explicit cost, DashClaw estimates the cost using these prices.
          </p>
          <p>
            The <strong className="text-secondary">pattern</strong> is matched against the model name (case-insensitive substring match). Patterns are evaluated top-to-bottom; the first match wins.
          </p>
          <p>
            If no pattern matches, the first entry is used as fallback pricing.
          </p>
        </div>
      </div>
    </div>
  );
}
