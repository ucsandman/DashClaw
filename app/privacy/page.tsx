import Link from 'next/link';
import { ChevronRight, Lock } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Privacy Policy: DashClaw',
  description:
    'What DashClaw stores, where it lives, and who can see it, for self-hosted instances and the hosted trial.',
  path: '/privacy',
});

const LAST_UPDATED = '2026-07-03';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 py-6 border-b border-border last:border-b-0">
      <h2 className="text-lg font-semibold text-text-primary mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-text-secondary leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <PublicNavbar />

      <section className="pt-28 pb-8 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-text-tertiary mb-4">
            <Link href="/" className="hover:text-text-primary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-text-primary">Privacy</span>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center">
              <Lock size={20} className="text-brand" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
              <p className="mt-2 text-text-secondary leading-relaxed">
                What DashClaw stores, where it lives, and who can see it.
              </p>
              <p className="mt-1 text-xs text-text-tertiary font-mono uppercase tracking-wide">
                Last updated {LAST_UPDATED}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="px-6 pb-16">
        <div className="max-w-3xl mx-auto">
          <Section id="scope" title="Two deployment models, two very different answers">
            <p>
              DashClaw is an open-source governance runtime. How your data is handled depends on
              which of the two deployment models you use:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <span className="text-text-primary font-medium">Self-hosted (the default).</span>{' '}
                You deploy DashClaw on your own infrastructure with your own database. Everything
                your agents record (actions, decisions, sessions, approvals) is stored in the
                database you control. The software does not send telemetry, usage data, or any
                other information to us. We never see it.
              </li>
              <li>
                <span className="text-text-primary font-medium">Hosted trial (dashclaw.io).</span>{' '}
                If you sign in on our hosted instance, we operate the infrastructure and this
                policy describes what we collect and why.
              </li>
            </ul>
          </Section>

          <Section id="hosted-collect" title="What the hosted trial collects">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <span className="text-text-primary font-medium">Account data.</span> Signing in
                with Google gives us your email address and display name. We use them to create
                and identify your workspace. We do not access your contacts, files, or anything
                else in your Google account.
              </li>
              <li>
                <span className="text-text-primary font-medium">Governance records your agents send.</span>{' '}
                The product&apos;s purpose is to record what your AI agents do: action records,
                guard decisions, sessions, assumptions, approvals, messages, and spend records.
                These are scoped to your workspace and visible only to your workspace.
              </li>
              <li>
                <span className="text-text-primary font-medium">Credentials.</span> API keys and
                OAuth access tokens are stored as SHA-256 hashes, never in plaintext.
              </li>
              <li>
                <span className="text-text-primary font-medium">Marketing analytics.</span> Public
                marketing pages (landing, docs, get-started) record anonymous page-view events so
                we can tell which documentation works. Operational surfaces are not tracked.
              </li>
            </ul>
          </Section>

          <Section id="subprocessors" title="Hosted-trial subprocessors">
            <p>The hosted instance runs on a small set of infrastructure providers:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Vercel: application hosting</li>
              <li>Neon: Postgres database</li>
              <li>Google: sign-in (OAuth)</li>
              <li>Cloudflare Turnstile: bot protection on signup</li>
            </ul>
            <p>
              Self-hosted instances use whatever infrastructure you choose; none of the above
              applies unless you pick the same providers.
            </p>
          </Section>

          <Section id="use" title="What we do not do">
            <ul className="list-disc pl-5 space-y-1">
              <li>We do not sell your data.</li>
              <li>We do not train models on your data.</li>
              <li>We do not share workspace contents with anyone outside your workspace.</li>
              <li>
                DashClaw never requires an LLM API key: the governance runtime does not call
                language models on your behalf.
              </li>
            </ul>
          </Section>

          <Section id="retention" title="Retention and deletion">
            <p>
              Hosted-trial workspaces and everything in them are deleted on request: email us
              from the address you signed up with. Self-hosted data lives in your database;
              deleting it is a query you run, not a request you make.
            </p>
            <p>
              The hosted trial is a trial: it carries no SLA and no independent backup
              guarantee beyond the database provider&apos;s own recovery. For production
              workloads, self-host.
            </p>
          </Section>

          <Section id="changes" title="Changes to this policy">
            <p>
              Material changes are recorded in the project&apos;s public{' '}
              <a
                href="https://github.com/ucsandman/DashClaw/blob/main/CHANGELOG.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                changelog
              </a>{' '}
              and reflected in the date at the top of this page.
            </p>
          </Section>

          <Section id="contact" title="Contact">
            <p>
              Questions or deletion requests:{' '}
              <a href="mailto:team@dashclaw.io" className="text-brand hover:underline">
                team@dashclaw.io
              </a>
              .
            </p>
          </Section>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
