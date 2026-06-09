'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { ArrowRight } from 'lucide-react';

type Capacity = { full: boolean; active: number; max: number };

/**
 * Hosted-trial hero CTA. Renders only on a hosted instance (dashclaw.io).
 * On a self-hosted instance `/api/hosted/capacity` returns 404, so this
 * component renders nothing and the existing hero is left untouched.
 */
export default function HostedTrialCTA() {
  const [capacity, setCapacity] = useState<Capacity | null>(null);

  useEffect(() => {
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
  }, []);

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
    <button
      type="button"
      onClick={() => signIn('google', { callbackUrl: '/connect?hosted=1' })}
      className="px-8 py-3 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-all hover:scale-105 inline-flex items-center gap-2 shadow-xl shadow-brand/20"
    >
      Govern your Claude — free <ArrowRight size={18} aria-hidden="true" />
    </button>
  );
}
