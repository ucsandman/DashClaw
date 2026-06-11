'use client';

import { useState, useEffect, useCallback } from 'react';
import PageLayout from '../components/PageLayout';
import { Card, CardHeader, CardContent } from '../components/ui/Card';
import { canonicalizeJson } from '../lib/integrity/canonicalize';

type WorkOrder = {
  id: string; type: string; type_version?: string; status: string;
  max_cost_usd: string | number; timeout_seconds?: number;
  requested_by?: string | null; claimed_by?: string | null;
  created_at?: string | null; completed_at?: string | null;
  guard_decision?: Record<string, unknown> | null;
  error_code?: string | null;
};
type WorkOrderType = {
  type: string; version: string; status: string; display_name?: string | null;
  description?: string | null; default_max_cost_usd?: string | number | null;
  default_timeout_seconds?: number | null;
  input_schema: unknown; output_schema: unknown;
};
type ReceiptEnvelope = { receipt: Record<string, unknown>; receipt_hash: string } | null;

const STATUS_TONE: Record<string, string> = {
  completed: 'text-success', queued: 'text-secondary', claimed: 'text-brand',
  pending_approval: 'text-warning', failed: 'text-error', timed_out: 'text-error',
  cancelled: 'text-tertiary', blocked: 'text-error',
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status] || 'text-secondary'}`}>
      {status}
    </span>
  );
}

export default function WorkOrdersPage() {
  const [tab, setTab] = useState<'ledger' | 'contracts'>('ledger');
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [types, setTypes] = useState<WorkOrderType[] | null>(null);
  const [selected, setSelected] = useState<{ order: WorkOrder; receipt: ReceiptEnvelope } | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [verifyResult, setVerifyResult] = useState<null | 'valid' | 'invalid'>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
        const [ordersRes, typesRes] = await Promise.all([
          fetch(`/api/work-orders${qs}`, { cache: 'no-store' }),
          fetch('/api/work-orders/types', { cache: 'no-store' }),
        ]);
        if (!ordersRes.ok || !typesRes.ok) throw new Error(`HTTP ${ordersRes.status}/${typesRes.status}`);
        const ordersJson = await ordersRes.json();
        const typesJson = await typesRes.json();
        setOrders(ordersJson.work_orders || []);
        setTypes(typesJson.types || []);
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      }
    }
    console.error('Failed to load work orders:', lastErr);
    setError(true);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openOrder = useCallback(async (id: string) => {
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/work-orders/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setSelected({ order: json.work_order, receipt: json.receipt });
    } catch (err) {
      console.error('Failed to load work order detail:', err);
    }
  }, []);

  // Client-side receipt verification: canonical JSON (sorted-keys + NFC, matching
  // the server's canonicalizeJson) → SHA-256 via crypto.subtle → base64url.
  // We import canonicalizeJson directly so the byte-for-byte output matches the
  // server's digestJson (which also NFC-normalizes string values and keys).
  const verifyReceipt = useCallback(async () => {
    if (!selected?.receipt) return;
    const canonical = canonicalizeJson(selected.receipt.receipt);
    const bytes = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const b64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    setVerifyResult(`sha256:${b64url}` === selected.receipt.receipt_hash ? 'valid' : 'invalid');
  }, [selected]);

  return (
    <PageLayout
      title="Work Orders"
      subtitle="Task-grade contracts for agent work — submit against a typed contract, get back a verifiable receipt"
      breadcrumbs={['Work Orders']}
      maturity="beta"
      actions={
        <div className="flex items-center gap-2">
          <button onClick={() => setTab('ledger')} className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'ledger' ? 'bg-surface-secondary text-primary' : 'text-secondary'}`}>Ledger</button>
          <button onClick={() => setTab('contracts')} className={`rounded-lg px-3 py-1.5 text-sm ${tab === 'contracts' ? 'bg-surface-secondary text-primary' : 'text-secondary'}`}>Contracts</button>
        </div>
      }
    >
      {loading ? (
        <div className="text-sm text-tertiary">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-border bg-surface-secondary p-8 text-center">
          <div className="text-sm text-error mb-3">Failed to load work orders.</div>
          <button onClick={load} className="rounded-lg border border-border px-3 py-1.5 text-sm">Retry</button>
        </div>
      ) : tab === 'ledger' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader
                title="Ledger"
                action={
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1 text-xs">
                    <option value="">All statuses</option>
                    {['queued', 'claimed', 'pending_approval', 'completed', 'failed', 'timed_out', 'cancelled', 'blocked'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                }
              />
              <CardContent>
                {!orders?.length ? (
                  <div className="text-sm text-tertiary py-6 text-center">No work orders yet. Submit one via the API or SDK — see /docs.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-tertiary">
                        <th className="py-2 pr-3">Order</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Budget</th><th className="py-2 pr-3">Worker</th><th className="py-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id} className="border-t border-border cursor-pointer hover:bg-surface-secondary" onClick={() => openOrder(o.id)}>
                          <td className="py-2 pr-3 font-mono text-xs">{o.id}</td>
                          <td className="py-2 pr-3">{o.type}</td>
                          <td className="py-2 pr-3"><StatusChip status={o.status} /></td>
                          <td className="py-2 pr-3">${Number(o.max_cost_usd).toFixed(2)}</td>
                          <td className="py-2 pr-3">{o.claimed_by || '—'}</td>
                          <td className="py-2 text-xs text-tertiary">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
          <div>
            <Card>
              <CardHeader title={selected ? selected.order.id : 'Receipt'} />
              <CardContent>
                {!selected ? (
                  <div className="text-sm text-tertiary py-6 text-center">Select an order to inspect its receipt and governance trail.</div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-2"><StatusChip status={selected.order.status} /><span className="text-tertiary text-xs">{selected.order.type}@{selected.order.type_version}</span></div>
                    {selected.order.guard_decision ? (
                      <div className="text-xs text-secondary">
                        Guard: {String((selected.order.guard_decision as Record<string, unknown>).decision)} · risk {String((selected.order.guard_decision as Record<string, unknown>).risk_score ?? '—')}
                      </div>
                    ) : null}
                    {selected.order.error_code ? <div className="text-xs text-error">Error: {selected.order.error_code}</div> : null}
                    {selected.receipt ? (
                      <>
                        <div className="flex items-center gap-2">
                          <button onClick={verifyReceipt} className="rounded-lg border border-border px-2 py-1 text-xs">Verify receipt hash</button>
                          {verifyResult === 'valid' ? <span className="text-xs text-success">hash verifies</span> : null}
                          {verifyResult === 'invalid' ? <span className="text-xs text-error">HASH MISMATCH</span> : null}
                        </div>
                        <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-surface-secondary p-3 text-xs">
                          {JSON.stringify(selected.receipt, null, 2)}
                        </pre>
                      </>
                    ) : (
                      <div className="text-xs text-tertiary">No receipt yet — receipts are written when the order reaches a terminal state.</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader title="Registered contracts" />
          <CardContent>
            {!types?.length ? (
              <div className="text-sm text-tertiary py-6 text-center">No contracts registered.</div>
            ) : (
              <div className="space-y-4">
                {types.map((t) => (
                  <div key={t.type} className="rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium">{t.display_name || t.type}</span>
                        <span className="ml-2 font-mono text-xs text-tertiary">{t.type}@{t.version}</span>
                      </div>
                      <StatusChip status={t.status} />
                    </div>
                    {t.description ? <p className="mt-1 text-sm text-secondary">{t.description}</p> : null}
                    <div className="mt-2 text-xs text-tertiary">
                      defaults: ${Number(t.default_max_cost_usd ?? 0).toFixed(2)} ceiling · {t.default_timeout_seconds ?? '—'}s timeout
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-secondary">Input / output schema</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-secondary p-3 text-xs">{JSON.stringify({ input_schema: t.input_schema, output_schema: t.output_schema }, null, 2)}</pre>
                    </details>
                  </div>
                ))}
                <p className="text-xs text-tertiary">Register new contracts via <code>POST /api/work-orders/types</code> or the SDK (<code>registerWorkOrderType</code>). See /docs.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageLayout>
  );
}
