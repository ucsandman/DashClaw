'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldOff } from 'lucide-react';
import { Skeleton } from '../../components/ui/Skeleton';
import { fetchSummary, type PolicySummary } from '../lib/modesClient';
import ContractPanel from './ContractPanel';
import ReviewFeed from './ReviewFeed';
import TuningProposals from './TuningProposals';
import ModeDrawer from './ModeDrawer';
import ApprovalFloodBanner from '../../components/ApprovalFloodBanner';

/**
 * The /policies "posture cockpit": a read-first view of what is governing the
 * agent fleet right now. Mutation (apply/change a mode, toggle a shield) happens
 * in place or in a focused drawer; the page never opens as a settings dump.
 */
export default function PolicyCockpit() {
  const searchParams = useSearchParams();
  // Deep-link target from an EntityLink (policy → /policies?policy=<id|name>).
  const policyHighlight = searchParams.get('policy');
  const [summary, setSummary] = useState<PolicySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Bumped when the review feed creates/removes a policy, so the contract refetches.
  const [contractRefresh, setContractRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const s = await fetchSummary();
      setSummary(s);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="max-w-3xl space-y-8">
      <ApprovalFloodBanner onResolved={load} />
      <ContractPanel onChangeMode={() => setDrawerOpen(true)} onContractChanged={load} highlight={policyHighlight} shields={summary.shields} refreshSignal={contractRefresh} />
      <ReviewFeed onPolicyChange={() => { setContractRefresh((n) => n + 1); load(); }} />
      <TuningProposals onPolicyChange={() => { setContractRefresh((n) => n + 1); load(); }} />
      <ModeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onApplied={load} />
    </div>
  );
}
