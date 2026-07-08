import { readFileSync } from 'fs';
import { resolve } from 'path';
import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import PlatformGuideClient from './PlatformGuideClient';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'The Complete Platform Guide - DashClaw',
  description:
    'Every page, endpoint, SDK method, CLI command, MCP tool, and hook in DashClaw, with live-captured examples and stable/experimental status for each.',
  path: '/guides/platform',
});

export default function PlatformGuidePage() {
  // Hero stats come from the same generated dataset the client fetches, so they
  // can never drift from the guide body (a separate meta snapshot did exactly that).
  const guideData = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public', 'guides', 'platform-guide-data.json'), 'utf8')
  ) as { meta: { generatedAt: string; counts: Record<string, number> } };
  const { counts, generatedAt } = guideData.meta;

  return (
    <div className="min-h-screen bg-primary">
      <PublicNavbar />
      <main className="pt-16">
        {/* Hero */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand">
              Complete platform reference
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold text-white sm:text-4xl">
              Every surface of DashClaw, verified against the code and a running instance.
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-secondary">
              {counts.total} entries: every product page, API endpoint, SDK method (Node and Python), CLI
              command, MCP tool, governance hook, and plugin surface, each marked stable, beta, experimental, deprecated,
              or archived based on evidence in the code, not guesswork. Examples are real captured
              request/response pairs; where a live capture was not possible, the section says so.
            </p>
            <div className="mt-5 flex flex-wrap gap-4 font-mono text-xs text-text-tertiary">
              <span className="tabular-nums">{counts.stable || 0} stable</span>
              <span className="tabular-nums">{counts.beta || 0} beta</span>
              <span className="tabular-nums">{counts.experimental || 0} experimental</span>
              <span className="tabular-nums">{counts.deprecated || 0} deprecated</span>
              <span className="tabular-nums">{counts.archived || 0} archived</span>
              <span>generated {generatedAt}</span>
            </div>
          </div>
        </section>
        <PlatformGuideClient />
      </main>
      <PublicFooter />
    </div>
  );
}
