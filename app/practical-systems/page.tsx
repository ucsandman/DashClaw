import Link from 'next/link';
import {
  Building2, UsersRound, Zap, ArrowRight, ExternalLink,
  Activity, CheckCircle2, ChevronRight, Rocket, Code, Laptop, Shield
} from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Practical Systems: The Team Behind DashClaw',
  description: 'Practical Systems builds AI-powered sales and operations infrastructure for growing companies. DashClaw is what we built to run our own agent fleet. Now you can use it too.',
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
            Meet the Team Behind DashClaw
          </h1>
          <p className="mt-6 text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed">
            Practical Systems builds AI-powered sales and operations infrastructure for growing companies.
            DashClaw is what we built to run our own agent fleet. Now you can use it too.
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
                  Practical Systems is an AI integration consultancy and platform company focused on SMB and mid-market businesses (50 to 500 employees).
                </p>
                <p>
                  Founded by Wes, who led AI adoption at a mid-market company: building 40+ custom AI tools, driving adoption across 50+ users, and leading AI strategy conversations with executive leadership.
                </p>
                <p>
                  The firm&apos;s approach: strategic advisory combined with hands-on implementation. We do not just recommend. We build and run what we sell.
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
                <h3 className="text-text-primary font-semibold mb-2">Strategic Advisory</h3>
                <p className="text-sm text-text-tertiary">Expert guidance on AI adoption and integration.</p>
              </div>
              <div className="p-6 rounded-xl bg-surface-secondary border border-border">
                <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center mb-4">
                  <Activity size={20} className="text-brand" />
                </div>
                <h3 className="text-text-primary font-semibold mb-2">Implementation</h3>
                <p className="text-sm text-text-tertiary">Hands-on building and deployment of AI tools.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What We Build Section */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">What We Build</h2>
            <p className="mt-4 text-text-secondary max-w-2xl mx-auto">
              We focus on building infrastructure that turns AI from a toy into a reliable employee.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-surface-secondary border border-border hover:border-border-active transition-all">
              <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mb-6">
                <Rocket size={24} className="text-brand" />
              </div>
              <h3 className="text-xl font-bold mb-4">AI Agent Fleets</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Autonomous agents that handle prospecting, research, scoring, and outreach so your team focuses on relationships and closing.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-surface-secondary border border-border hover:border-border-active transition-all">
              <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mb-6">
                <Zap size={24} className="text-brand" />
              </div>
              <h3 className="text-xl font-bold mb-4">Mission Control</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                A unified dashboard where humans and AI agents work together with full visibility and zero black boxes.
              </p>
            </div>
            <div className="p-8 rounded-2xl bg-surface-secondary border border-border hover:border-border-active transition-all">
              <div className="w-12 h-12 rounded-xl bg-brand-subtle flex items-center justify-center mb-6">
                <Code size={24} className="text-brand" />
              </div>
              <h3 className="text-xl font-bold mb-4">AI Integration Consulting</h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                Hands-on help identifying where AI creates leverage in your business, then actually building it.
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
              <h2 className="text-3xl font-bold tracking-tight mb-6">DashClaw Is Our Infrastructure</h2>
              <div className="space-y-6 text-text-secondary text-lg leading-relaxed">
                <p>
                  Practical Systems built DashClaw to govern our own agent fleet. Every decision our agents make is logged,
                  scored for risk, and reviewable.
                </p>
                <p>
                  We needed that level of control before we could trust agents with real sales pipeline. We open-sourced and
                  productized DashClaw so other teams building agent fleets can have the same foundation.
                </p>
              </div>
              <div className="mt-10 flex items-center gap-6">
                <Link href="/" className="text-brand font-semibold inline-flex items-center gap-2 hover:underline">
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
            Building Something With AI Agents?
          </h2>
          <p className="text-xl text-text-secondary mb-10 leading-relaxed">
            Whether you need help designing your agent architecture, governing an existing fleet,
            or integrating AI into a specific workflow, we can help.
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
