import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Check, ChevronRight } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import { marketingPageMetadata } from '../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DashClaw pricing',
  description:
    'Self-hosted DashClaw is MIT licensed and free to run. Hosted plans start at $49/mo for teams who would rather we run it for them.',
  path: '/pricing',
});

/*
 * /pricing — reinstated per docs/decisions/2026-08-09-hosted-paid-tier.md,
 * which supersedes the 2026-05-14 "no pricing page" retraction (ef8bb678).
 * The rule that record sets and this page must never weaken: self-hosted
 * DashClaw stays MIT licensed and free to run. What changed is that
 * hosted.dashclaw.io, the control plane we operate, now charges for running
 * that plane on someone else's behalf. The core guard, policy, approval,
 * and ledger implementation is shared; hosted capacity and configuration vary.
 */

// Marketing build points this at the hosted-trial instance's own /connect
// (e.g. hosted.dashclaw.io); unset on a self-hosted deployment, where the
// same-origin /connect is already the right destination.
const TRIAL_URL = process.env.NEXT_PUBLIC_HOSTED_TRIAL_URL || '/connect';

interface Tier {
  eyebrow: string;
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
  emphasize?: boolean;
}

const TIERS: Tier[] = [
  {
    eyebrow: 'Run it yourself',
    name: 'Self-hosted',
    price: 'Free',
    description:
      'The core governance runtime. MIT licensed. Your infrastructure, your database, your retention policy.',
    features: [
      'Core guard, policy, approval, and decision-ledger capabilities',
      'No account with us, no telemetry, no calling home',
      'No seat limit and no action ceiling',
      'You own the data',
    ],
    cta: { label: 'Read the self-host guide', href: '/self-host' },
    emphasize: true,
  },
  {
    eyebrow: 'We run it for you',
    name: 'Hosted Indie',
    price: '$49',
    period: '/mo',
    description: 'For a solo builder or a small team who would rather not run infrastructure.',
    features: [
      '2 seats',
      'A monthly governed-action ceiling, sized generously',
      '30-day retention',
      'Email support',
      'The same core guard, policy, approval, and decision-ledger implementation',
    ],
    cta: { label: 'Start with the free trial', href: TRIAL_URL },
  },
  {
    eyebrow: 'We run it for you',
    name: 'Hosted Team',
    price: '$199',
    period: '/mo',
    description: 'For a team that needs more room and faster answers.',
    features: [
      '10 seats',
      'A higher governed-action ceiling',
      '90-day retention',
      'Org-scoped rate limits',
      'Priority support',
      'The same core guard, policy, approval, and decision-ledger implementation',
    ],
    cta: { label: 'Start with the free trial', href: TRIAL_URL },
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <PublicNavbar />

      {/* Hero */}
      <section className="pt-28 pb-10 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-text-tertiary mb-4">
            <Link href="/" className="hover:text-text-primary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-text-primary">Pricing</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Self-host DashClaw under the MIT license.
          </h1>
          <p className="mt-3 text-text-secondary max-w-2xl leading-relaxed">
            The self-hosted plane includes the current core guard, policy, approval, and
            decision-ledger implementation on your own infrastructure. Optional integrations
            still need their own configuration. <Link href="/self-host" className="text-brand hover:underline">Read the self-host guide</Link>.
          </p>
          <p className="mt-3 text-text-secondary max-w-2xl leading-relaxed">
            Paying buys infrastructure, retention, and support that we run on your behalf.
          </p>
        </div>
      </section>

      {/* Tiers */}
      <section className="pb-6 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`flex flex-col rounded-2xl border p-6 ${
                  tier.emphasize
                    ? 'border-border-active bg-surface-secondary'
                    : 'border-border bg-surface-secondary'
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                  {tier.eyebrow}
                </p>
                <h2 className="mt-2 text-lg font-semibold text-text-primary">{tier.name}</h2>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className={`text-2xl font-bold ${tier.emphasize ? 'text-brand' : 'text-text-primary'}`}>
                    {tier.price}
                  </span>
                  {tier.period && <span className="text-sm text-text-tertiary">{tier.period}</span>}
                </p>
                <p className="mt-3 text-sm text-text-secondary leading-relaxed">{tier.description}</p>

                <ul className="mt-5 space-y-2 flex-1">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-text-secondary leading-relaxed">
                      <Check size={15} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {tier.cta.href.startsWith('/') ? (
                  <Link
                    href={tier.cta.href}
                    className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg border border-border-hover bg-surface-tertiary px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-elevated transition-colors"
                  >
                    {tier.cta.label} <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                ) : (
                  <a
                    href={tier.cta.href}
                    className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg border border-border-hover bg-surface-tertiary px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-elevated transition-colors"
                  >
                    {tier.cta.label} <ArrowRight size={15} aria-hidden="true" />
                  </a>
                )}
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs text-text-tertiary max-w-2xl">
            Ceilings on Indie and Team are generous, sized so a real team does not think
            about them day to day. Exact numbers live in the{' '}
            <Link href="/docs" className="hover:text-text-secondary transition-colors underline decoration-border">docs</Link>,
            not repeated here, so there is one place they can drift out of date.
          </p>
        </div>
      </section>

      {/* What paying buys */}
      <section className="pb-12 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">What paying buys</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-text-primary">We run it for you</h2>
          <p className="mt-3 text-text-secondary leading-relaxed max-w-3xl">
            All plans use the same core guard, policy engine, approvals, and audit ledger.
            Available capacity, retention, and optional integrations depend on hosting and
            configuration. The hosted fee buys us running that stack on your behalf:
            managed, Redis-backed realtime instead of you standing one up, platform
            upgrades that just show up, the retention window, and someone to call when
            something breaks.
          </p>
        </div>
      </section>

      {/* Trial CTA */}
      <section className="pb-12 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">Try hosted first</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-text-primary">
            Free for 30 days, no card
          </h2>
          <p className="mt-3 text-text-secondary leading-relaxed max-w-2xl">
            The hosted trial is a real workspace, not a demo. Connect an agent, see the
            approvals land, and decide whether hosted or self-hosted is the right home
            before anyone asks for a card.
          </p>
          <div className="mt-6">
            <a
              href={TRIAL_URL}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-2.5 text-sm font-bold text-surface-primary hover:bg-brand-hover transition-colors"
            >
              Start a free hosted trial <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* Upgrade path + export honesty */}
      <section className="pb-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto py-12 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-border bg-surface-secondary p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-2">Already on hosted?</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              Changing or upgrading plans happens in-app, not here. Go to{' '}
              <code className="font-mono text-text-primary">Settings</code>
              {' -> '}
              <code className="font-mono text-text-primary">Billing</code>{' '}
              (<code className="font-mono text-text-primary">/settings?tab=billing</code>) on
              your own instance.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface-secondary p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-2">Leaving stays easy</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              Any hosted workspace can export its full decision history and configuration
              as one file and re-import it into a self-hosted instance you control,
              any time. Nothing about hosted is a one-way door.
            </p>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
