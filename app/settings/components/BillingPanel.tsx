'use client';

// Billing tab (v5.14 hosted paid tier checkout). Reads the org's plan from
// /api/usage (already carries it), starts Checkout via /api/billing/checkout,
// and opens the Stripe customer portal via /api/billing/portal. Honest
// states: self-host/unconfigured instances say "not configured" instead of
// pretending a store exists; unclaimed hosted trials are pointed at /claim.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CreditCard, ExternalLink, ShieldCheck } from 'lucide-react';

const TIERS = [
  {
    plan: 'indie',
    label: 'Indie',
    price: '$49/mo',
    blurb: '2 seats. For one developer and their agent fleet.',
  },
  {
    plan: 'team',
    label: 'Team',
    price: '$199/mo',
    blurb: '10 seats. Higher ceilings, priority support.',
  },
];

const START_ERROR_COPY: Record<string, string> = {
  BILLING_NOT_CONFIGURED: 'Billing is not configured on this instance. Self-hosted DashClaw is free forever — there is nothing to buy here.',
  claim_required: 'Claim this workspace first (see /claim) — billing needs a durable owner, not an anonymous trial session.',
  UNKNOWN_PLAN: 'That plan does not exist.',
};

export default function BillingPanel() {
  const searchParams = useSearchParams();
  const [plan, setPlan] = useState<string | null>(null);
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const outcome = searchParams?.get('billing');

  useEffect(() => {
    let mounted = true;
    fetch('/api/usage', { cache: 'no-store' })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (mounted && body) {
          setPlan(body.plan || 'free');
          setSubscriptionActive(body.plan === 'indie' || body.plan === 'team');
        }
      })
      .catch(() => {
        if (mounted) setError('Could not load the current plan.');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const start = useCallback(async (targetPlan: string) => {
    setBusy(targetPlan);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan: targetPlan }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(START_ERROR_COPY[body.code] || START_ERROR_COPY[body.error] || 'Checkout could not start.');
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Could not reach the billing service.');
    } finally {
      setBusy(null);
    }
  }, []);

  const openPortal = useCallback(async () => {
    setBusy('portal');
    setError(null);
    try {
      const res = await fetch('/api/billing/portal');
      const body = await res.json();
      if (!res.ok) {
        setError(START_ERROR_COPY[body.code] || 'The billing portal could not open.');
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Could not reach the billing service.');
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <div className="max-w-3xl space-y-4">
      {outcome === 'success' && (
        <div className="rounded-xl border border-success/30 bg-success-subtle px-4 py-3 text-sm text-success">
          Subscription active. The plan updates here as soon as Stripe confirms — usually within seconds.
        </div>
      )}
      {outcome === 'canceled' && (
        <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3 text-sm text-secondary">
          Checkout canceled. Nothing was charged.
        </div>
      )}

      <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">Current plan</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-2xl font-semibold capitalize text-primary">{plan ?? '…'}</span>
          {subscriptionActive && (
            <button
              onClick={openPortal}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-3 py-1.5 text-xs font-semibold text-secondary transition-colors hover:border-border-hover hover:text-primary disabled:opacity-60"
            >
              <ExternalLink size={12} aria-hidden="true" />
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </button>
          )}
        </div>
        <p className="mt-2 text-[12px] text-tertiary">
          Every governance capability works on every plan — paid tiers change how much we run for you
          (seats, ceilings, retention), never whether you are safe.
        </p>
      </div>

      {!subscriptionActive && (
        <div className="grid gap-3 sm:grid-cols-2">
          {TIERS.map((tier) => (
            <div key={tier.plan} className="flex flex-col rounded-xl border border-border bg-surface-secondary p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-primary">{tier.label}</span>
                <span className="text-lg font-semibold tabular-nums text-primary">{tier.price}</span>
              </div>
              <p className="mt-1 flex-1 text-[12px] text-tertiary">{tier.blurb}</p>
              <button
                onClick={() => start(tier.plan)}
                disabled={busy !== null}
                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-brand-hover disabled:opacity-60"
              >
                <CreditCard size={14} aria-hidden="true" />
                {busy === tier.plan ? 'Starting…' : `Upgrade to ${tier.label}`}
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-[12px] text-warning">{error}</div>}

      <div className="flex items-start gap-2 rounded-xl border border-border bg-surface-secondary px-4 py-3 text-[12px] text-tertiary">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          Self-hosted DashClaw stays free forever under MIT — these tiers only exist on the hosted
          instance, where we run the infrastructure for you.
        </span>
      </div>
    </div>
  );
}
