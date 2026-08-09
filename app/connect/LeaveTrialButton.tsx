'use client';

import { useState } from 'react';
import { LogOut } from 'lucide-react';

/*
 * Leave (sign out of) the trial workspace in this browser. For an UNCLAIMED
 * trial the session cookie is the only credential, so leaving can orphan the
 * workspace — the inline confirm says exactly that before anything happens.
 * The actual cookie clear lives in the middleware (/connect?leave=trial,
 * same-origin navigations only), next to the rest of the trial-cookie
 * lifecycle; no API route involved.
 */
export default function LeaveTrialButton() {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-tertiary px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-hover hover:text-text-primary"
      >
        <LogOut size={14} aria-hidden="true" />
        Leave workspace
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning-subtle px-3 py-2">
      <span className="text-xs text-warning">
        This browser session is the only way back in unless you claimed the
        workspace, saved an API key, or exported.
      </span>
      <a
        href="/connect?leave=trial"
        className="rounded border border-warning/40 px-2 py-1 text-xs font-semibold text-warning transition-colors hover:bg-warning/10"
      >
        Leave anyway
      </a>
      <button
        onClick={() => setConfirming(false)}
        className="px-1 text-xs text-text-tertiary transition-colors hover:text-text-primary"
      >
        Cancel
      </button>
    </span>
  );
}
