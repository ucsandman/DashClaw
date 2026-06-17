import type { Metadata } from 'next';
import Link from 'next/link';
import { Network, ArrowUpRight } from 'lucide-react';
import PageLayout from '../../components/PageLayout';

export const metadata: Metadata = {
  title: 'Codebase — Mission Control | DashClaw',
};

// The Codebase Intelligence (livingcode) dashboard is a standalone static
// surface served at /livingcode/index.html. It was previously embedded here
// via an <iframe>, but the app's deliberate anti-clickjacking headers
// (X-Frame-Options: DENY + CSP frame-ancestors 'none', pinned by
// security-headers regression tests) block same-origin framing, so the embed
// rendered blank and logged a CSP error. Open it as a top-level surface
// instead — navigation is not subject to frame-ancestors, and we keep the
// strict framing posture intact.
export default function CodebasePage() {
  return (
    <PageLayout
      agentFilter={false}
      title="Codebase Intelligence"
      subtitle="Live architecture map, execution flows, and code-health signals for this deployment"
      breadcrumbs={['Mission Control', 'Codebase']}
      maturity="stable"
    >
      <div className="rounded-xl border border-border bg-surface-secondary p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-tertiary">
            <Network size={20} className="text-brand" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-text-primary">Codebase Intelligence dashboard</h2>
            <p className="mt-2 max-w-2xl text-sm text-text-secondary">
              The livingcode dashboard renders the architecture map, execution flows, and
              code-health signals generated from this deployment&apos;s source. It opens as a
              full-screen surface.
            </p>
            <Link
              href="/livingcode/index.html"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:border-brand/50 hover:bg-brand/15"
            >
              Open dashboard
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
