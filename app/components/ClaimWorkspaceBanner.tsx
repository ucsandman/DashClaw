'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

// Anonymous-trial claim prompt (v5.13). Renders only when this browser's
// trial cookie resolves to a claimable workspace — signed-in sessions,
// self-host, and claimed orgs all probe negative. One probe per SPA
// session: the answer only changes on claim, which navigates.
let cachedProbe: Promise<boolean> | null = null;

function probeClaimable(): Promise<boolean> {
  if (!cachedProbe) {
    cachedProbe = fetch('/api/hosted/claim', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return false;
        const body = await res.json();
        return body.claimable === true && body.signed_in !== true;
      })
      .catch(() => false);
  }
  return cachedProbe;
}

export function _resetClaimProbeForTests() {
  cachedProbe = null;
}

export default function ClaimWorkspaceBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let mounted = true;
    probeClaimable().then((claimable) => {
      if (mounted) setShow(claimable);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!show) return null;

  return (
    <div role="note" aria-label="Unclaimed trial workspace" className="border-b border-border bg-surface-secondary">
      <div className="flex flex-col gap-2 px-6 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 text-xs text-secondary">
          <span className="flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-warning">
            <ShieldCheck size={11} aria-hidden="true" />
            Unclaimed
          </span>
          <span>This trial workspace expires and only lives in this browser. Claim it to keep it.</span>
        </div>
        <Link href="/claim" className="text-xs text-brand transition-colors hover:text-brand-hover">
          Claim workspace
        </Link>
      </div>
    </div>
  );
}
