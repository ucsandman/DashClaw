'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

const BTN_NEUTRAL =
  'rounded-md border border-border bg-surface-secondary px-2.5 py-1 text-xs font-medium text-secondary transition-colors hover:border-border-hover hover:text-primary motion-reduce:transition-none';
const BTN_WARNING =
  'rounded-md border border-border bg-status-warning-subtle px-2.5 py-1 text-xs font-medium text-status-warning transition-colors hover:border-border-hover motion-reduce:transition-none';

interface Flood { policy_id: string; name: string; count: number; tripped_at: string }
type Confirm = { policyId: string; kind: 'pause' | 'allow' | 'deny' } | null;

/**
 * Approval-flood banner: shown only while the interruption budget is tripped.
 * One row per flooding policy with pause / bulk-allow / bulk-deny, each behind
 * a labeled confirm. Renders nothing when there is no flood.
 */
export default function ApprovalFloodBanner({ onResolved }: { onResolved?: () => void }) {
  const [floods, setFloods] = useState<Flood[]>([]);
  const [budget, setBudget] = useState<{ windowMin: number } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals/floods', { cache: 'no-store' });
      if (!res.ok) return; // banner is best-effort; absence of data = no banner
      const json = await res.json();
      setFloods(json.floods ?? []);
      setBudget(json.budget ?? null);
    } catch { /* best-effort surface — stay hidden on fetch failure */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (flood: Flood, kind: 'pause' | 'allow' | 'deny') => {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'pause') {
        const res = await fetch('/api/policies', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: flood.policy_id, active: 0 }),
        });
        if (!res.ok) throw new Error(`Failed to pause rule (${res.status})`);
      } else {
        const res = await fetch('/api/approvals/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: kind, filter: { policy_id: flood.policy_id } }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Bulk ${kind} failed (${res.status})`);
        }
      }
      setConfirm(null);
      await load();
      onResolved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [load, onResolved]);

  if (floods.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-status-warning-subtle px-4 py-3 space-y-2">
      {floods.map((flood) => {
        const confirming = confirm?.policyId === flood.policy_id ? confirm : null;
        return (
          <div key={flood.policy_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <AlertTriangle size={14} className="shrink-0 text-status-warning" aria-hidden="true" />
            <span className="text-sm text-primary">
              Approval flood: <span className="font-medium">{flood.name}</span>
              <span className="ml-1.5 tabular-nums text-xs text-secondary">
                {flood.count} interrupts in {budget?.windowMin ?? 15}m — per-action pings paused
              </span>
            </span>
            {confirming ? (
              <span className="flex items-center gap-2">
                <span className="text-xs text-status-warning">
                  {confirming.kind === 'pause' && `Deactivate "${flood.name}"? Pending approvals stay pending.`}
                  {confirming.kind === 'allow' && `Approve all pending actions matched by "${flood.name}"?`}
                  {confirming.kind === 'deny' && `Deny all pending actions matched by "${flood.name}"?`}
                </span>
                {/* autoFocus: the opener just unmounted; keep keyboard focus in the flow */}
                <button type="button" autoFocus disabled={busy} onClick={() => act(flood, confirming.kind)} className={`${BTN_WARNING} disabled:opacity-50`}>
                  Confirm
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={BTN_NEUTRAL}>
                  Cancel
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                {/* disabled while busy: opening another row's confirm would silently
                    dismiss the in-flight row's confirmation mid-action */}
                <button type="button" disabled={busy} onClick={() => setConfirm({ policyId: flood.policy_id, kind: 'pause' })} className={`${BTN_NEUTRAL} disabled:opacity-50`}>
                  Pause rule&hellip;
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm({ policyId: flood.policy_id, kind: 'allow' })} className={`${BTN_NEUTRAL} disabled:opacity-50`}>
                  Approve all&hellip;
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirm({ policyId: flood.policy_id, kind: 'deny' })} className={`${BTN_WARNING} disabled:opacity-50`}>
                  Deny all&hellip;
                </button>
              </span>
            )}
          </div>
        );
      })}
      {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
    </div>
  );
}
