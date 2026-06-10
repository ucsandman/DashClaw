'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLayout from '../../components/PageLayout';
import EntityLink from '../../components/context-menu/EntityLink';
import type { X402PurchaseListRow } from '../../lib/types/x402';

const fmt = (n: any, cur?: string) => `${Number(n || 0).toFixed(4)} ${cur || 'USDC'}`;
const STATUS_TONE: Record<string, string> = {
  succeeded: 'text-success', approved: 'text-secondary', pending: 'text-warning', failed: 'text-error', blocked: 'text-error',
};

export default function X402PurchasesPage() {
  const [rows, setRows] = useState<X402PurchaseListRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/x402/purchases');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows((await res.json()).purchases || []);
    } catch (err) {
      console.error('Failed to load x402 purchases:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <PageLayout title="x402 Purchases" subtitle="Governed capability purchases" breadcrumbs={['Spend', 'Purchases']} maturity="beta">
      {loading ? (
        <div className="text-sm text-tertiary">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-surface-secondary p-8 text-center">
          <div className="text-sm text-error mb-3">Failed to load purchases.</div>
          <button
            onClick={load}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-secondary hover:border-border-hover transition-colors"
          >
            Retry
          </button>
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-secondary p-8 text-center text-sm text-tertiary">
          No governed purchases yet.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface-secondary overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-tertiary border-b border-border">
                <th className="text-left font-medium px-4 py-3">Provider</th>
                <th className="text-left font-medium px-4 py-3">Agent</th>
                <th className="text-right font-medium px-4 py-3">Spend</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">Reason</th>
                <th className="text-left font-medium px-4 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.action_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-xs">
                    {r.provider_name ? (
                      <span title={r.provider_id || undefined}>{r.provider_name}</span>
                    ) : (
                      <span className="font-mono">{r.provider_id || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.agent_id ? <EntityLink type="agent" id={r.agent_id} /> : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmt(r.spend_amount, r.currency)}</td>
                  <td className={`px-4 py-3 ${STATUS_TONE[r.execution_status] || 'text-secondary'}`}>{r.execution_status || '—'}</td>
                  <td className="px-4 py-3 text-secondary max-w-xs truncate" title={r.purchase_reason || ''}>{r.purchase_reason || '—'}</td>
                  <td className="px-4 py-3 text-tertiary tabular-nums">{r.created_at ? String(r.created_at).slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageLayout>
  );
}
