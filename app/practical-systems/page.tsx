import Link from 'next/link';
import {
  Building2, UsersRound, Zap, ArrowRight, ExternalLink,
  Rocket, Shield
} from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Practical Systems: The Company Behind DashClaw',
  description: 'Practical Systems is an AI-operated company. An autonomous agent fleet researches, builds, and sells. One human approves what matters. DashClaw is the control plane that makes it safe.',
  path: '/practical-systems',
});

export default function PracticalSystemsPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <PublicNavbar />

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border-active bg-brand-subtle text-brand text-xs font-medium mb-6">
            <Building2 size={14} />
            Practical Systems
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            The Company Behind DashClaw
          </h1>
          <p className="mt-6 text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed">
            Practical Systems is an AI-operated company. An autonomous agent fleet researches
            opportunities, builds products, and runs outreach. One human approves what matters.
            DashClaw is the control plane that makes it safe.
          </p>
          <div className="mt-10">
            <a
              href="https://www.practicalsystems.io/contact"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-all inline-flex items-center gap-2"
            >
              Get in Touch <ExternalLink size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* About Section — "Who We Are" */}
      <section className="py-20 px-6 border-t border-border bg-surface-secondary/40">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight mb-6">Who We Are</h2>
              <div className="space-y-4 text-text-secondary leading-relaxed">
                <p>
                  Practical Systems is an autonomous AI company. An AI chief executive runs a fleet
                  of specialist agents that prospect, research, qualify, build, and sell. Wes Sander,
                  the founder, is the only human in the company.
                </p>
                <p>
                  Wes founded the firm after leading AI adoption at a mid-market company: 40+ custom
                  AI tools, 50+ users. In 2026 he handed day-to-day operations to the agents. His job
                  now is to watch a company that runs itself and step in only when a decision needs
                  a human.
                </p>
                <p>
                  Every meaningful agent decision lands in DashClaw first: policy-checked,
                  risk-scored, recorded, and held for human approval when it crosses a line.
                  Outreach stays drafts-only until a human approves the send.
                </p>
                <div className="pt-4 flex items-center gap-3">
                  <div className="h-px w-8 bg-brand"></div>
                  <span className="text-brand font-medium italic">&quot;We run what we sell.&quot;</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-6 rounded-xl bg-surface-secondary border border-border">
                <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center mb-4">
                  <DashClawLogo size={20} />
                </div>
                <h3 className="text-text-primary font-semibold mb-2">Governed Fleet</h3>
                <p className="text-sm text-text-tertiary">An AI CEO and specialist agents, every action policy-checked by DashClaw.</p>
              </div>
              <div className="p-6 rounded-xl bg-surface-secondary border border-border">
                <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center mb-4">
                  <UsersRound size={20} className="text-brand" />
                </div>
                <h3 className="text-text-primary font-semibold mb-2">One Human</h3>
                <p className="text-sm text-text-tertiary">Wes approves the decisions that matter: sends, spend, and ships.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What We Build Section */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">What We Run</h2>
            <p className="mt-4 text-text-secondary max-w-2xl mx-auto">
              An autonomous company needs three things: agents that do the work, a loop that
              decides the work, and a control plane that keeps it safe.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-surface-secondary border border-border hover:border-border-active transition-all">
              <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mb-6">
                <Rocket size={24} className="text-brand" />
              </div>
              <h3 className="text-xl font-bold mb-4">Autonomous Product Cycle</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                A governed 11-step loop, live in production: research trends, ideate, pick, build,
                market, QA, queue outreach, close with a P&amp;L snapshot. Each step is recorded as
                a governed action.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-surface-secondary border border-border hover:border-border-active transition-all">
              <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mb-6">
                <Zap size={24} className="text-brand" />
              </div>
              <h3 className="text-xl font-bold mb-4">AI Sales Pipeline</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                A domain name goes in. A proposal-ready account packet comes out: contacts,
                research, qualification score, and solution scope, with outreach drafts queued
                for human approval.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-surface-secondary border border-border hover:border-border-active transition-all">
              <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mb-6">
                <Shield size={24} className="text-brand" />
              </div>
              <h3 className="text-xl font-bold mb-4">Governance Infrastructure</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                DashClaw: the approval layer that intercepts every agent action, scores risk,
                enforces policy, and records the audit trail. Open source, and the product you
                are looking at now.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DashClaw Connection Section */}
      <section className="py-24 px-6 border-t border-border bg-surface-secondary/40">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-3xl bg-surface-secondary border border-brand-subtle p-10 sm:p-16 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <DashClawLogo size={120} />
            </div>
            <div className="relative z-10">
              <h2 className="text-3xl font-bold tracking-tight mb-6">DashClaw Is Our Control Plane</h2>
              <div className="space-y-6 text-text-secondary text-lg leading-relaxed">
                <p>
                  Practical Systems built DashClaw to govern its own fleet. Every agent decision is
                  intercepted, risk-scored, recorded, and gated behind human approval when it matters.
                  That is the level of control an autonomous company requires before it can act
                  unattended.
                </p>
                <p>
                  The proof runs in both directions: the company is governed by DashClaw, and
                  DashClaw itself is maintained by an AI under a delegation charter with five
                  human-held invariants. We do not just recommend this way of working. We live in it.
                </p>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-6">
                <Link href="/proof" className="text-brand font-semibold inline-flex items-center gap-2 hover:underline">
                  See the live proof <ArrowRight size={18} />
                </Link>
                <Link href="/" className="text-text-secondary font-semibold inline-flex items-center gap-2 hover:text-text-primary hover:underline">
                  Back to DashClaw <ArrowRight size={18} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 px-6 border-t border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-6">
            Running Agents in Production?
          </h2>
          <p className="text-xl text-text-secondary mb-10 leading-relaxed">
            The same control plane that governs Practical Systems is open source and
            self-hostable. Give your fleet the approval layer ours runs on.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <a
              href="https://www.practicalsystems.io/contact"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-8 py-3 rounded-lg bg-brand text-white font-bold hover:bg-brand-hover transition-all inline-flex items-center justify-center gap-2"
            >
              Talk to Practical Systems <ExternalLink size={18} />
            </a>
            <a
              href="https://www.practicalsystems.io"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-8 py-3 rounded-lg bg-surface-secondary border border-border text-text-secondary font-semibold hover:bg-surface-tertiary hover:text-text-primary transition-all inline-flex items-center justify-center gap-2"
            >
              practicalsystems.io
            </a>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
