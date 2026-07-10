'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCw } from 'lucide-react';

// App-level error boundary. Catches render/SSR errors in any segment that lacks
// its own error.js, so an unhandled throw shows a graceful, debuggable surface
// (with the server `digest` for cross-referencing deployment logs) instead of an
// opaque browser "This page couldn't load" 500.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface for observability (browser console + Vercel runtime logs).
    console.error('[dashclaw] unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border bg-secondary p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-error-subtle">
          <AlertTriangle size={24} className="text-error" strokeWidth={1.5} />
        </div>
        <h1 className="text-lg font-semibold text-primary">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          This view hit an unexpected error. Try again, or head back to Approvals.
        </p>
        {error?.digest && (
          <p className="mt-3 font-mono text-xs text-tertiary">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            <RotateCw size={14} />
            Try again
          </button>
          <Link
            href="/approvals"
            className="rounded-lg border bg-surface-tertiary px-4 py-2 text-sm text-secondary transition-colors hover:border-hover hover:text-white"
          >
            Approvals
          </Link>
        </div>
      </div>
    </div>
  );
}
