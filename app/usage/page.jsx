'use client';

// /usage — read-only metering panel (hosted paid tier, G4).
// Shows the caller org's monthly governed-action rollup and seats. This page
// measures; it never gates. Entitlement enforcement, if it ever exists, lives
// elsewhere and later (docs/decisions/2026-08-09-hosted-paid-tier.md).
import { useCallback, useEffect, useState } from 'react';
import PageLayout from '../components/PageLayout';
import { Skeleton } from '../components/ui/Skeleton';

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-primary">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-tertiary">{sub}</div>}
    </div>
  );
}

export default function UsagePage() {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/usage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUsage(await res.json());
    } catch (err) {
      console.warn('Failed to load usage (page=/usage):', err);
      setUsage(null);
      setError('Failed to load usage.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  return (
    <PageLayout
      title="Usage"
      subtitle="Governed actions and seats for this workspace. Read-only measurement: nothing is enforced from these numbers."
    >
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-error/30 bg-error-subtle px-4 py-3">
          <div className="text-sm text-error">{error}</div>
          <button
            type="button"
            onClick={fetchUsage}
            className="mt-2 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-sm text-secondary hover:border-border-hover"
          >
            Retry
          </button>
        </div>
      ) : usage ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Governed actions"
              value={formatCount(usage.governed_actions)}
              sub={`this period (${usage.period})`}
            />
            <StatTile
              label="Blocked"
              value={formatCount(usage.blocked_actions)}
              sub="of the governed actions"
            />
            <StatTile label="Seats" value={formatCount(usage.seats?.users)} sub="human users" />
            <StatTile
              label="API keys"
              value={formatCount(usage.seats?.active_api_keys)}
              sub="active machine credentials"
            />
          </div>

          {usage.trial && (
            <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3 text-sm text-secondary">
              Trial cap: <span className="tabular-nums">{formatCount(usage.trial.actions_used)}</span> of{' '}
              <span className="tabular-nums">{formatCount(usage.trial.action_cap)}</span> governed actions used.
            </div>
          )}

          <div className="rounded-xl border border-border bg-surface-secondary">
            <div className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
              Monthly history
            </div>
            {Array.isArray(usage.history) && usage.history.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-tertiary">
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 font-medium text-right">Governed actions</th>
                    <th className="px-4 py-2 font-medium text-right">Blocked</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.history.map((row) => (
                    <tr key={row.period} className="border-t border-border text-secondary">
                      <td className="px-4 py-2 font-mono text-[13px]">{row.period}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCount(row.governed_actions)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatCount(row.blocked_actions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-6 text-sm text-tertiary">No usage recorded yet.</div>
            )}
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}
