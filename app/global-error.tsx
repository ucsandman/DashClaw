'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import './globals.css';

// Last-resort boundary. `error.js` cannot catch a throw in the root layout
// itself; `global-error.js` replaces the whole document when that happens, so
// even a root-level failure renders an on-brand surface with a digest instead
// of the browser's opaque "This page couldn't load".
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashclaw] root error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-primary font-sans">
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="w-full max-w-md rounded-xl border bg-secondary p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-error-subtle">
              <AlertTriangle size={24} className="text-error" strokeWidth={1.5} />
            </div>
            <h1 className="text-lg font-semibold text-primary">DashClaw hit an unexpected error</h1>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              The application failed to render. Try again; if it persists, check the deployment logs.
            </p>
            {error?.digest && (
              <p className="mt-3 font-mono text-xs text-tertiary">Reference: {error.digest}</p>
            )}
            <button
              onClick={reset}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
