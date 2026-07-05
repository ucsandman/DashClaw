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
export default function HostedTrialCTA() {
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

  const className =
    'px-8 py-3 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-all hover:scale-105 inline-flex items-center gap-2 shadow-xl shadow-brand/20';

  // v5.2: the trial reaches a real governed action entirely in the browser —
  // say so where the trial is pitched.
  const caption = (
    <span className="text-xs text-text-tertiary">
      No install needed — your first governed action runs in the browser.
    </span>
  );

  if (trialUrl) {
    return (
      <span className="inline-flex flex-col items-center gap-1.5">
        <a href={trialUrl} className={className}>
          Start a hosted trial — free for 30 days <ArrowRight size={18} aria-hidden="true" />
        </a>
        {caption}
      </span>
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
        Trials are full — check back soon
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-center gap-1.5">
      <a href="/connect" className={className}>
        Start a hosted trial — free for 30 days <ArrowRight size={18} aria-hidden="true" />
      </a>
      {caption}
    </span>
  );
}
