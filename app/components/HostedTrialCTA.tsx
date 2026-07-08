'use client';

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';

type Capacity = { full: boolean; active: number; max: number };

/**
 * Hosted-trial hero CTA. Two render modes:
 *
 * 1. Marketing site (NEXT_PUBLIC_HOSTED_TRIAL_URL set, e.g. dashclaw.io):
 *    a plain cross-origin link to the hosted-trial instance's /connect —
 *    no capacity fetch (same-origin /api/hosted 404s here), always visible.
 * 2. The hosted instance itself (env unset, DASHCLAW_HOSTED=true): probes
 *    same-origin /api/hosted/capacity and links to /connect, where the
 *    anonymous Turnstile mint discloses the trial caps before provisioning.
 *    (Not signIn('google') — the hosted deployment has no Google provider;
 *    the Turnstile mint is the working signup path.)
 *
 * On a self-hosted instance both are absent (capacity 404s) and this renders
 * nothing, leaving the existing hero untouched.
 */
export default function HostedTrialCTA({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const trialUrl = process.env.NEXT_PUBLIC_HOSTED_TRIAL_URL || '';
  const [capacity, setCapacity] = useState<Capacity | null>(null);

  useEffect(() => {
    if (trialUrl) return; // marketing mode: no probe needed
    let active = true;
    fetch('/api/hosted/capacity')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active) setCapacity(data);
      })
      .catch(() => {
        if (active) setCapacity(null);
      });
    return () => {
      active = false;
    };
  }, [trialUrl]);

  // Single-line label so the CTA row keeps one shared baseline; the trial
  // terms live in the caption the page renders under the whole row.
  // secondary keeps brand orange a signal (.impeccable #2): the install path
  // is the one primary action, the hosted trial is the quiet second door.
  const className =
    variant === 'secondary'
      ? 'px-6 py-2.5 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-colors inline-flex items-center gap-2 whitespace-nowrap'
      : 'px-8 py-3 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-all hover:scale-105 inline-flex items-center gap-2 shadow-xl shadow-brand/20 whitespace-nowrap';

  if (trialUrl) {
    return (
      <a href={trialUrl} className={className}>
        Start a hosted trial <ArrowRight size={18} aria-hidden="true" />
      </a>
    );
  }

  // Self-host (404), fetch error, or not yet loaded: render nothing.
  if (!capacity) return null;

  if (capacity.full) {
    return (
      <span
        aria-disabled="true"
        className="px-8 py-3 rounded-lg bg-surface-tertiary border border-border-hover text-text-tertiary text-sm font-medium cursor-not-allowed inline-flex items-center gap-2"
      >
        Trials are full, check back soon
      </span>
    );
  }

  return (
    <a href="/connect" className={className}>
      Start a hosted trial <ArrowRight size={18} aria-hidden="true" />
    </a>
  );
}
