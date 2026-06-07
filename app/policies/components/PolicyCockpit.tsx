'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShieldOff } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { fetchSummary, type PolicySummary } from '../lib/modesClient';
import { SHIELDS, matchShieldsToPolicies, buildShieldPayload } from '../lib/shields';
import PostureHeader from './PostureHeader';
import EnforcementSummary from './EnforcementSummary';
import ShieldList from './ShieldList';
import RecentDigest, { type RecentDecision } from './RecentDigest';
import ModeDrawer from './ModeDrawer';

/**
 * The /policies "posture cockpit": a read-first view of what is governing the
 * agent fleet right now. Mutation (apply/change a mode, toggle a shield) happens
 * in place or in a focused drawer; the page never opens as a settings dump.
 */
export default function PolicyCockpit() {
  const [summary, setSummary] = useState<PolicySummary | null>(null);
  const [recent, setRecent] = useState<RecentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busyShield, setBusyShield] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [s, decisionsRes] = await Promise.all([
        fetchSummary(),
        fetch('/api/guard/decisions?limit=5')
          .then((r) => (r.ok ? r.json() : { decisions: [] }))
          .catch(() => ({ decisions: [] })),
      ]);
      setSummary(s);
      const rows = (decisionsRes.decisions || []) as Array<Record<string, unknown>>;
      setRecent(
        rows.map((d) => ({
          id: String(d.id ?? ''),
          decision: String(d.decision ?? ''),
          agentLabel: String(d.agent_name ?? d.agent_id ?? 'agent'),
          actionType: String(d.action_type ?? ''),
          createdAt: String(d.created_at ?? ''),
        })),
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Shield on/off mirrors the legacy ShieldsGrid contract: create on first
  // enable, otherwise flip the existing policy's `active` flag.
  const handleShieldToggle = useCallback(
    async (shieldId: string, next: boolean) => {
      setBusyShield(shieldId);
      try {
        const shield = (SHIELDS as Array<{ id: string }>).find((s) => s.id === shieldId);
        if (!shield) return;
        const all = await fetch('/api/policies')
          .then((r) => (r.ok ? r.json() : { policies: [] }))
          .catch(() => ({ policies: [] }));
        const policy = matchShieldsToPolicies(all.policies || []).get(shieldId) as { id?: string } | null;
        if (next && !policy) {
          await fetch('/api/policies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildShieldPayload(shield)),
          });
        } else if (policy?.id) {
          await fetch('/api/policies', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: policy.id, active: next ? 1 : 0 }),
          });
        }
        await load();
      } finally {
        setBusyShield(null);
      }
    },
    [load],
  );

  if (loading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-10 w-2/3 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex items-center justify-between border-t border-border py-6 text-sm">
        <span className="text-tertiary">Couldn&apos;t load posture.</span>
        <button onClick={load} className="text-brand hover:underline">
          Retry &rsaquo;
        </button>
      </div>
    );
  }

  if (!summary.governed) {
    return (
      <>
        <div className="mx-auto max-w-md py-16">
          <div className="flex flex-col items-center rounded-xl border border-border bg-surface-secondary px-8 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-tertiary text-tertiary">
              <ShieldOff size={22} aria-hidden="true" />
            </div>
            <h2 className="mt-5 text-base font-semibold text-primary">No mode applied</h2>
            <p className="mt-2 text-sm text-secondary">
              Your agents are running unchecked. A mode gates the actions that matter —
              paid spend, deploys, destructive ops, and protected paths — in one decision.
            </p>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="mt-6 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-xs font-medium text-brand transition-colors hover:border-brand/60 hover:bg-brand/15 motion-reduce:transition-none"
            >
              Apply a mode
            </button>
          </div>
        </div>
        <ModeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onApplied={load} />
      </>
    );
  }

  const scopeLabel = summary.scope.allAgents ? 'All agents' : 'Custom scope';

  return (
    <div className="max-w-3xl space-y-8">
      <PostureHeader
        primaryMode={summary.primaryMode}
        modeCount={summary.modes.length}
        agentsTotal={summary.agents.total}
        pendingApprovals={summary.pendingApprovals}
        scopeLabel={scopeLabel}
        onChangeMode={() => setDrawerOpen(true)}
      />
      <EnforcementSummary
        enforcement={summary.enforcement}
        rules={summary.rules}
        decisions30d={summary.decisions30d}
      />
      <ShieldList shields={summary.shields} onToggle={handleShieldToggle} busyId={busyShield} />
      <RecentDigest decisions={recent} />
      <ModeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onApplied={load} />
    </div>
  );
}
