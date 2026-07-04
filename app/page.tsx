import Link from 'next/link';
import { ShieldAlert, ArrowRight, Terminal, Package, Scale, FileCheck, Network, Shield, MessageSquare, Bot, Radar } from 'lucide-react';
import DashClawLogo from './components/DashClawLogo';
import PublicNavbar from './components/PublicNavbar';
import PublicFooter from './components/PublicFooter';
import InlineCopyCommand from './components/InlineCopyCommand';
import LiveDemo from './components/LiveDemo';
import UseCases from './components/UseCases';
import TrackedLink from './components/TrackedLink';
import MarketingViewObserver from './components/MarketingViewObserver';
import SetupBanner from './components/SetupBanner';
import HostedTrialCTA from './components/HostedTrialCTA';
import { isHostedMode } from './lib/hosted/flag';

import {
  corePrimitives,
  signals,
  frameworkQuickstarts,
} from './landingData';

/* ─── page ─── */

export default function LandingPage() {
  const hosted = isHostedMode();
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary text-base">
      {/* ── 1. Navbar ── */}
      <PublicNavbar />
      <SetupBanner />

      <main>
      {/* ── 2. Hero ── */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          {/* Eyebrow */}
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-tertiary mb-5">
            Decision Infrastructure for AI Agents
          </p>

          {/* Headline */}
          <h1 className="text-3xl sm:text-4xl lg:text-6xl font-bold tracking-tight leading-tight text-text-primary">
            The governance runtime for AI agents.
          </h1>

          {/* Subhead */}
          <p className="mt-6 text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed">
            DashClaw intercepts agent actions at the moment intent becomes a real-world call. In coding and personal agents (Claude Code, Codex, Hermes, OpenClaw) it can hard-block via lifecycle hooks; in chat-based clients it governs through approvals and a verifiable record. Intercept, enforce, record, approve, and verify every high-risk decision in one open source runtime.
          </p>

          {/* CTA row */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
            <HostedTrialCTA />
            <TrackedLink
              href="/self-host"
              event="marketing_hero_cta_clicked"
              className={hosted ? 'px-8 py-3 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-all inline-flex items-center gap-2' : 'px-8 py-3 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-all hover:scale-105 inline-flex items-center gap-2 shadow-xl shadow-brand/20'}
            >
              Self host the runtime <ArrowRight size={18} aria-hidden="true" />
            </TrackedLink>
            {/* Same-page anchor, not <Link href="/demo">: the middleware 302
                to /#live-demo loses its hash during client-side navigation
                when you're already on /, so the button looked dead. /demo
                stays the entrypoint for external links. */}
            <a
              href="#live-demo"
              className="px-8 py-3 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-all inline-flex items-center gap-2"
            >
              <Terminal size={16} aria-hidden="true" /> Run live demo
            </a>
          </div>

          {/* npx demo, demoted */}
          <div className="mt-6 flex justify-center">
            <InlineCopyCommand command="npx dashclaw-demo" className="px-3 py-1.5 text-xs" />
          </div>

          {/* Framework list */}
          <p className="mt-10 text-sm text-text-tertiary font-medium max-w-2xl mx-auto">
            Works with Claude Code, Codex, OpenClaw, Hermes Agent, Claude Managed Agents, OpenAI, LangChain, CrewAI, AutoGen, Gemini CLI, and any custom agent.
          </p>

          {/* Trust band */}
          <div className="mt-8 text-xs text-text-tertiary flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
            <span>MIT licensed</span>
            <span className="text-text-disabled" aria-hidden="true">·</span>
            <span>Self hosted</span>
            <span className="text-text-disabled" aria-hidden="true">·</span>
            <span>No per seat pricing</span>
            <span className="text-text-disabled" aria-hidden="true">·</span>
            <span>No usage caps when self-hosted</span>
            <span className="text-text-disabled" aria-hidden="true">·</span>
            <span>Your data stays on your infrastructure</span>
          </div>

          {/* ICP filter */}
          <p className="mt-6 text-sm text-text-tertiary italic max-w-2xl mx-auto">
            For teams running AI agents where the cost of a bad action is real.
          </p>
        </div>
      </section>

      {/* ── Live demo (interactive governance call against real /api/guard) ── */}
      <LiveDemo />

      {/* ── Integration band (which surfaces plug DashClaw in) ── */}
      <section
        aria-labelledby="integration-band-heading"
        className="py-10 px-6 border-t border-border bg-surface-secondary/30"
      >
        <div className="max-w-5xl mx-auto">
          <h2
            id="integration-band-heading"
            className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-tertiary text-center mb-4"
          >
            Works with
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-text-secondary">
            {[
              'Claude Code Hooks',
              'OpenClaw Plugin',
              'MCP Server',
              'Platform Skill',
              'Node SDK',
              'Python SDK',
              'REST API',
              'CLI',
              'Discord Approvals',
              'Telegram Approvals',
            ].map((surface, idx, arr) => (
              <span key={surface} className="inline-flex items-center gap-3">
                <span className="font-medium text-text-primary">{surface}</span>
                {idx < arr.length - 1 ? (
                  <span className="text-text-disabled" aria-hidden="true">·</span>
                ) : null}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3. The Interception Layer ── */}
      <section className="py-20 px-6 border-t border-border bg-surface-primary">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">The interception layer for AI agents</h2>
            <p className="mt-4 text-brand font-medium">
              DashClaw governs the moment where agent intent becomes real-world action.
            </p>
            <p className="mt-2 text-text-secondary max-w-2xl mx-auto">
              This interception is where trust is created.
            </p>
          </div>

          {/* Flow Diagram */}
          <div className="max-w-3xl mx-auto mb-10">
            <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
              <div className="flex flex-col items-center gap-2">
                <div className="px-4 py-3 rounded-xl bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-mono font-medium shadow-lg whitespace-nowrap">
                  Agent Intent
                </div>
              </div>

              <div className="text-text-disabled font-mono text-lg">→</div>

              <div className="flex flex-col items-center gap-2">
                <div className="px-5 py-3 rounded-xl bg-brand/10 border border-brand/40 text-brand text-sm font-mono font-bold shadow-[0_0_20px_rgba(249,115,22,0.15)] whitespace-nowrap">
                  DashClaw Guard
                </div>
              </div>

              <div className="flex flex-col gap-2 items-start">
                <div className="flex items-center gap-2">
                  <div className="text-text-disabled font-mono">→</div>
                  <div className="px-4 py-2 rounded-lg bg-success-subtle border border-status-success/40 text-success text-xs font-mono font-bold tracking-wider">
                    ALLOW
                  </div>
                  <div className="text-text-disabled font-mono">→</div>
                  <div className="px-4 py-2 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-xs font-mono whitespace-nowrap">
                    Production
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-text-disabled font-mono">→</div>
                  <div className="px-4 py-2 rounded-lg bg-error-subtle border border-status-error/40 text-error text-xs font-mono font-bold tracking-wider">
                    BLOCK
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Code Split */}
          <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-surface-secondary overflow-hidden">
              <div className="px-4 py-2 border-b border-border flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-status-error/60"></div>
                <span className="text-xs font-mono text-text-tertiary">without DashClaw</span>
              </div>
              <pre
                tabIndex={0}
                aria-label="Ungoverned delete example"
                className="p-4 text-xs font-mono text-text-secondary leading-relaxed overflow-x-auto"
              >{`await deleteFiles({
  path: "/prod/data"
});
// No check. No record.
// No way back.`}</pre>
            </div>

            <div className="rounded-xl border border-brand/20 bg-surface-secondary overflow-hidden shadow-[0_0_20px_rgba(249,115,22,0.05)]">
              <div className="px-4 py-2 border-b border-brand/20 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-status-success/60"></div>
                <span className="text-xs font-mono text-brand">with DashClaw</span>
              </div>
              <pre
                tabIndex={0}
                aria-label="DashClaw guard example"
                className="p-4 text-xs font-mono text-text-secondary leading-relaxed overflow-x-auto"
              >{`const { decision } = await dc.guard({
  action: "delete_files",
  resource: "/prod/data"
});
if (decision === "allow") {
  await deleteFiles({ path: "/prod/data" });
}`}</pre>
            </div>
          </div>

          <div className="mt-12 text-center max-w-2xl mx-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-surface-secondary border border-border">
                <p className="text-brand font-semibold text-sm">Agents retain autonomy.</p>
              </div>
              <div className="p-4 rounded-xl bg-surface-secondary border border-border">
                <p className="text-brand font-semibold text-sm">Organizations retain control.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. Architecture Section ── */}
      <section className="py-24 px-6 border-t border-border bg-surface-secondary/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">DashClaw sits between agents and the systems they control</h2>
            <p className="mt-4 text-text-secondary">DashClaw intercepts actions before they reach real-world systems.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div className="p-6 rounded-2xl border border-border bg-surface-secondary text-center">
              <div className="text-xs font-mono text-text-tertiary mb-4 uppercase tracking-widest">Autonomous Actor</div>
              <div className="text-lg font-bold text-text-primary mb-2">AI Agent</div>
              <div className="text-xs text-text-secondary leading-relaxed">
                OpenAI &middot; Claude &middot; CrewAI &middot; OpenClaw
              </div>
            </div>

            <div className="flex md:flex-col items-center justify-center gap-4">
              <div className="h-px w-8 md:w-px md:h-12 bg-border-hover"></div>
              <div className="p-1 rounded-full bg-brand/20 border border-brand/30">
                <ArrowRight className="text-brand md:rotate-90" size={16} />
              </div>
              <div className="h-px w-8 md:w-px md:h-12 bg-border-hover"></div>
            </div>

            <div className="hidden md:block"></div>

            <div className="hidden md:block"></div>

            <div className="relative p-8 rounded-2xl border-2 border-brand/30 bg-brand/5 text-center shadow-[0_0_40px_rgba(249,115,22,0.1)]">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand text-[10px] font-bold text-surface-primary uppercase tracking-widest">
                DashClaw Runtime
              </div>
              <div className="space-y-3">
                <div className="text-sm font-semibold text-text-primary">Policy Engine</div>
                <div className="text-sm font-semibold text-text-primary">Approval Routing</div>
                <div className="text-sm font-semibold text-text-primary">Evidence Ledger</div>
              </div>
            </div>

            <div className="hidden md:block"></div>

            <div className="hidden md:block"></div>

            <div className="flex md:flex-col items-center justify-center gap-4">
              <div className="h-px w-8 md:w-px md:h-12 bg-border-hover"></div>
              <div className="p-1 rounded-full bg-brand/20 border border-brand/30">
                <ArrowRight className="text-brand md:rotate-90" size={16} />
              </div>
              <div className="h-px w-8 md:w-px md:h-12 bg-border-hover"></div>
            </div>

            <div className="p-6 rounded-2xl border border-border bg-surface-secondary text-center">
              <div className="text-xs font-mono text-text-tertiary mb-4 uppercase tracking-widest">Real-world Targets</div>
              <div className="text-lg font-bold text-text-primary mb-2">External Systems</div>
              <div className="text-xs text-text-secondary leading-relaxed">
                GitHub &middot; APIs &middot; Databases &middot; Infrastructure
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. The Runtime Problem ── */}
      <section className="py-20 px-6 border-t border-border bg-surface-secondary/40">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center mb-12">AI agents introduce a new runtime problem</h2>

          {/* Contrast Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
            {/* Traditional Software */}
            <div className="p-6 rounded-2xl bg-surface-secondary border border-border">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-surface-tertiary border border-border-hover flex items-center justify-center">
                  <Terminal size={18} className="text-text-secondary" />
                </div>
                <span className="text-sm font-semibold text-text-secondary uppercase tracking-wider">Traditional Software</span>
              </div>
              <ul className="space-y-3">
                {[
                  'Deterministic code paths',
                  'Predictable outputs',
                  'Traceable call stacks',
                  'Debuggers work',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-text-secondary">
                    <div className="w-1.5 h-1.5 rounded-full bg-text-disabled shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* AI Agents */}
            <div className="p-6 rounded-2xl bg-surface-secondary border border-brand/20 shadow-[0_0_30px_rgba(249,115,22,0.05)]">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/30 flex items-center justify-center">
                  <Bot size={18} className="text-brand" />
                </div>
                <span className="text-sm font-semibold text-brand uppercase tracking-wider">AI Agents</span>
              </div>
              <ul className="space-y-3">
                {[
                  'Actions generated from goals',
                  'Non-deterministic outputs',
                  'No call stack to trace',
                  'Debuggers are not enough',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm text-text-secondary">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand/60 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Conclusion */}
          <div className="text-center border-t border-border pt-10">
            <p className="text-xl sm:text-2xl font-semibold text-text-primary leading-snug">
              Developers need <span className="text-brand">governance</span> over agent decisions.
            </p>
            <p className="mt-3 text-text-tertiary text-sm">Not just logs. Not just traces. A runtime that governs the decision itself.</p>
          </div>
        </div>
      </section>

      {/* ── 5. The Decision Runtime ── */}
      <section className="py-24 px-6 border-t border-border bg-surface-secondary">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">The Decision Runtime</h2>
          <p className="mt-3 text-text-secondary mb-16">DashClaw is built around five primitives that form a decision runtime for autonomous systems.</p>

          <div className="relative flex flex-col md:flex-row items-center justify-between gap-4 md:gap-0">
            {/* Connecting Line (Desktop) */}
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-brand/30 to-transparent -translate-y-1/2 z-0"></div>

            {corePrimitives.map((primitive, idx) => {
              const Icon = primitive.icon;
              return (
                <div key={primitive.title} className="relative z-10 flex flex-col items-center group w-full md:w-1/5">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-secondary border border-border shadow-xl group-hover:border-brand/40 transition-all group-hover:shadow-[0_0_20px_rgba(249,115,22,0.15)] ring-4 ring-surface-secondary relative">
                    <Icon size={24} className="text-brand" />

                    {/* Hover Cards for all Primitives */}
                    <div className="absolute -top-36 left-1/2 -translate-x-1/2 w-52 p-3 rounded-xl bg-surface-elevated border border-border-hover shadow-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-20 scale-90 group-hover:scale-100 origin-bottom">

                      {primitive.title === 'Intent' && (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-text-secondary tracking-tight uppercase">Agent Intent</span>
                            <div className="w-2 h-2 rounded-full bg-status-info animate-pulse"></div>
                          </div>
                          <div className="text-[11px] font-bold text-text-primary mb-1 leading-tight">Sync local data to Neon dashboard</div>
                          <div className="text-[9px] text-text-tertiary mb-2">Actor: moltfire</div>
                          <div className="flex justify-between items-center pt-2 border-t border-border-hover/50">
                            <span className="text-[9px] text-text-tertiary italic">Confidence: 50%</span>
                          </div>
                        </>
                      )}

                      {primitive.title === 'Guard' && (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-text-secondary tracking-tight uppercase">Guard Policy</span>
                            <span className="px-1.5 py-0.5 rounded bg-status-success/10 border border-status-success/20 text-[8px] text-success font-bold uppercase tracking-tighter">active</span>
                          </div>
                          <div className="text-[11px] font-bold text-text-primary mb-1 leading-tight">Block if risk &gt; 80</div>
                          <div className="text-[10px] font-mono text-brand mb-2">Risk &gt;= 80 → block</div>
                          <div className="text-[8px] font-mono text-text-disabled truncate">gp_0423d9749de847b8be38ff3a</div>
                        </>
                      )}

                      {primitive.title === 'Approval' && (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-text-secondary tracking-tight uppercase tracking-tighter">Human Approval</span>
                            <span className="px-1.5 py-0.5 rounded bg-brand/10 border border-active/20 text-[8px] text-brand font-bold uppercase tracking-tighter">pending</span>
                          </div>
                          <div className="text-[11px] font-bold text-text-primary mb-1 leading-tight">REVIEW: data alerting</div>
                          <div className="text-[9px] text-text-tertiary mb-2">Agent: api-monitor</div>
                          <div className="flex justify-between items-center pt-2 border-t border-border-hover/50">
                            <span className="text-[10px] font-bold text-error font-mono">96% RISK</span>
                            <div className="flex gap-1">
                              <div className="w-3 h-3 rounded bg-status-success/20 border border-status-success/40"></div>
                              <div className="w-3 h-3 rounded bg-error-subtle border border-status-error/40"></div>
                            </div>
                          </div>
                        </>
                      )}

                      {primitive.title === 'Action' && (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-text-secondary tracking-tight uppercase">Execution</span>
                            <span className="px-1.5 py-0.5 rounded bg-info-subtle border border-status-info/20 text-[8px] text-info font-bold uppercase tracking-tighter">success</span>
                          </div>
                          <div className="text-[11px] font-bold text-success mb-1 tracking-tight">ACTION SUCCESSFUL</div>
                          <div className="text-[9px] text-text-secondary mb-2 leading-tight italic">Synced 80 rows + 6 calendar events</div>
                          <div className="pt-2 border-t border-border-hover/50 text-[9px] text-text-tertiary">
                            Duration: 6.25s
                          </div>
                        </>
                      )}

                      {primitive.title === 'Evidence' && (
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-text-secondary tracking-tight uppercase">Decision Proof</span>
                            <span className="px-1.5 py-0.5 rounded bg-info-subtle border border-status-info/20 text-[8px] text-info font-bold uppercase tracking-tighter">verified</span>
                          </div>
                          <div className="text-[11px] font-bold text-text-primary mb-1 leading-tight">Cryptographically Signed</div>
                          <div className="text-[8px] font-mono text-text-tertiary mb-2 truncate">act_1386c4ee-2529-4c79-9455</div>
                          <div className="pt-2 border-t border-border-hover/50">
                            <div className="text-[7px] font-mono text-text-disabled break-all leading-[8px]">dc_sig_v1_eyJpZCI6I...</div>
                          </div>
                        </>
                      )}

                    </div>
                  </div>
                  <h3 className="text-sm font-bold text-text-primary uppercase tracking-tighter mb-2">{primitive.title}</h3>
                  <p className="text-xs text-text-tertiary max-w-[140px] leading-relaxed mx-auto">{primitive.description}</p>

                  {/* Visual Arrow (Desktop) */}
                  {idx < corePrimitives.length - 1 && (
                    <div className="hidden md:block absolute top-7 -right-4 translate-x-1/2">
                      <ArrowRight size={24} className="text-text-disabled" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-20 text-text-tertiary text-sm italic font-medium">
            Governance logic belongs in the runtime, not hardcoded in your agents.
          </p>
        </div>
      </section>

      {/* ── 6. Framework Quickstarts ── */}
      <section className="py-24 px-6 border-t border-border bg-surface-primary">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary mb-4">Works with your agent stack</h2>
            <p className="text-text-secondary">DashClaw is the governance layer for existing agent frameworks.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {frameworkQuickstarts.map(qs => (
              <div key={qs.id} className="flex flex-col rounded-2xl border border-border bg-surface-secondary overflow-hidden shadow-2xl group/qs">
                <div className="px-5 py-4 border-b border-border bg-surface-tertiary flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-brand"></div>
                    <span className="text-xs font-bold text-text-primary tracking-tight uppercase">{qs.name}</span>
                  </div>
                  <span className="text-[10px] text-text-tertiary font-medium group-hover/qs:text-brand transition-colors">{qs.label}</span>
                </div>
                <div
                  tabIndex={0}
                  aria-label={`${qs.name} quickstart code`}
                  className="p-5 font-mono text-[11px] leading-relaxed text-text-secondary overflow-x-auto bg-black/40 h-full"
                >
                  <pre>{qs.code}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. Quickstart ── */}
      <section id="sdk" className="py-20 px-6 border-t border-border bg-surface-secondary/40">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-subtle border border-brand/20 text-brand text-xs font-medium mb-4">
                <Package size={12} />
                One SDK. Full decision infrastructure.
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">Get governance in 60 seconds</h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                Zero-dependency Node.js and Python clients. Adding governance requires only a small wrapper around risky actions.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <InlineCopyCommand command="npx dashclaw-demo" highlight={true} className="px-3 py-1.5" />
                <InlineCopyCommand command="npm install dashclaw" className="px-3 py-1.5" />
                <InlineCopyCommand command="pip install dashclaw" className="px-3 py-1.5" />
                <div className="w-full h-px bg-border-hover/50 my-1"></div>
                <InlineCopyCommand command="docker compose up -d" className="px-3 py-1.5" />
                <InlineCopyCommand command="npm install -g @dashclaw/cli" className="px-3 py-1.5" />
              </div>
              <Link href="/docs" className="mt-6 inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors">
                View full SDK docs <ArrowRight size={14} />
              </Link>
            </div>
            <div>
              <div className="text-xs text-text-tertiary font-mono mb-2 uppercase tracking-wider">SDK Example</div>
              <div
                tabIndex={0}
                aria-label="SDK guard example"
                className="rounded-xl bg-surface-secondary border border-border p-5 font-mono text-sm overflow-x-auto shadow-2xl"
              >
                <div className="text-text-tertiary mb-3">{'// 1. Initialize DashClaw'}</div>
                <div>
                  <span className="text-purple-400">const</span>
                  <span className="text-text-secondary"> claw = </span>
                  <span className="text-purple-400">new</span>
                  <span className="text-warning"> DashClaw</span>
                  <span className="text-text-secondary">()</span>
                </div>

                <div className="mt-6 text-text-tertiary">{'// 2. Intercept before you act'}</div>
                <div>
                  <span className="text-purple-400">const</span>
                  <span className="text-text-secondary">{' { decision } = '}</span>
                  <span className="text-purple-400">await</span>
                  <span className="text-text-secondary"> claw.</span>
                  <span className="text-warning">guard</span>
                  <span className="text-text-secondary">({'{'}</span>
                </div>
                <div className="text-text-secondary pl-4">
                  actionType: <span className="text-success">&apos;deploy&apos;</span>,
                </div>
                <div className="text-text-secondary pl-4">
                  riskScore: <span className="text-cyan-300">85</span>
                </div>
                <div className="text-text-secondary">{'})'}</div>

                <div className="mt-6 text-text-tertiary">{'// 3. Follow the decision'}</div>
                <div className="text-text-secondary">
                  <span className="text-purple-400">if</span> (decision === <span className="text-success">&apos;allow&apos;</span>) {'{'}
                </div>
                <div className="text-text-secondary pl-4 text-text-tertiary">
                  {'// execute real-world action'}
                </div>
                <div className="text-text-secondary">{'}'}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. Use Cases (tabbed: deploys / spend / drift) ── */}
      <UseCases />

      {/* ── 8. Platform Visibility ── */}
      <section id="features" className="py-24 px-6 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary mb-4">When governance becomes operations</h2>
            <p className="mt-4 text-text-secondary max-w-2xl mx-auto leading-relaxed">
              Once decisions are governed, DashClaw provides the operational visibility required to run agent fleets at scale.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-20">
            {[
              {
                icon: Radar,
                title: 'Mission Control',
                description: 'Live operational visibility for the agent fleet. See what is running, what was decided, and what is waiting on a human.',
                items: ['Live fleet posture and active interventions', 'Emergency halt — one confirmed click blocks every guard evaluation for the org, and one resumes it', 'Decision replay with the full causal chain and an itemized risk composition ledger', 'Per-harness agent identities (parent:sub) grouped under their parent on /agents', 'Evidence-based session retros — a defensibility verdict on every agent session', "The agent's advocate: an agent_defense rollup (declared goal, assumptions, shields) on every action detail", 'Real-time SSE event stream'],
              },
              {
                icon: Shield,
                title: 'Policy Engine',
                description: 'Semantic guardrails that decide allow, block, or require approval before the action reaches the real world — halted mechanically on hook surfaces, honored by SDK and chat callers.',
                items: ['Guard primitive with policy testing', 'Risk signals for autonomy spikes and failure loops', 'Assumption drift detection with z-score baselines — invalidate a broken belief in one click', 'Self-calibrating risk scoring — miscalibrated shapes mined from your own ledger become one-click ratify/dismiss proposals on /policies', 'Policy tuning proposals mined from real decision outcomes — Apply and Dismiss are buttons', 'Tightening proposals close the other direction: ungoverned high-risk patterns become one-click require_approval policies', 'x402 spend gates: per-purchase caps plus cumulative window budgets with live "$X of $Y used" meters', 'Degraded evaluations surfaced, never silent — deadline fallbacks are counted and shown on /policies'],
              },
              {
                icon: MessageSquare,
                title: 'Approval Surfaces',
                description: 'Approvers resolve pending actions wherever they already work, against the same governance endpoint. Claude Code lifecycle hooks add an inline prompt path for terminal workflows, and an interruption budget collapses approval floods into one bulk-resolvable event.',
                items: ['Dashboard inbox at /approvals', 'CLI with dashclaw approve and approvals', 'Mobile PWA at /approve', 'Discord DM with inline Approve and Deny buttons', 'Telegram inline Approve and Reject buttons', 'Flood guard with pause-rule and bulk allow/deny', 'Approvals expire — a lapsed approval can never release held work'],
              },
              {
                icon: FileCheck,
                title: 'Work Orders',
                description: 'Typed task contracts with budget ceilings and self-verifying receipts — submit, claim, complete, audit.',
                items: ['Typed input/output contract per order type', 'Budget ceiling enforced before the work runs', 'SHA-256 receipt with cost, output hash, and governance trail', 'External workers claim and complete; DashClaw stays the control plane'],
              },
            ].map((capability) => {
              const Icon = capability.icon;
              return (
                <div key={capability.title} className="p-6 rounded-2xl bg-surface-secondary border border-border hover:border-border-hover transition-colors text-left flex flex-col">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-subtle border border-border-active flex items-center justify-center">
                      <Icon size={20} className="text-brand" aria-hidden="true" />
                    </div>
                    <h3 className="text-base font-bold text-text-primary tracking-tight">{capability.title}</h3>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed mb-4">{capability.description}</p>
                  <ul className="space-y-1.5 text-xs text-text-tertiary mt-auto">
                    {capability.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 leading-relaxed">
                        <span className="mt-[6px] w-1 h-1 rounded-full bg-text-disabled shrink-0" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="space-y-20">
            {/* Compliance Suite Merge */}
            <div className="rounded-2xl bg-gradient-to-b from-[rgba(249,115,22,0.06)] to-transparent p-8 sm:p-12 border border-brand-subtle">
              <div className="text-center mb-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border-active bg-brand-subtle text-brand text-xs font-medium mb-4">
                  <DashClawLogo size={12} />
                  AI Governance Suite
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Every governed decision produces audit-ready evidence.</h2>
                <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm font-semibold text-text-secondary">
                  <span className="px-3 py-1 rounded-lg bg-surface-secondary border border-border">SOC 2</span>
                  <span className="px-3 py-1 rounded-lg bg-surface-secondary border border-border">ISO 27001</span>
                  <span className="px-3 py-1 rounded-lg bg-surface-secondary border border-border">GDPR</span>
                  <span className="px-3 py-1 rounded-lg bg-surface-secondary border border-border">NIST AI RMF</span>
                </div>
                <p className="mt-4 text-xs text-text-tertiary max-w-2xl mx-auto leading-relaxed">
                  DashClaw maps your guard decisions and approvals to these frameworks and generates audit-ready evidence; it does not assert that your deployment is certified.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="p-6 rounded-xl bg-surface-secondary/80 border border-border text-center">
                  <Scale size={20} className="text-brand mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-text-primary mb-2 text-sm">Compliance Engine</h3>
                  <p className="text-xs text-text-secondary">Control-level gap analysis with remediation priorities.</p>
                </div>
                <div className="p-6 rounded-xl bg-surface-secondary/80 border border-border text-center">
                  <FileCheck size={20} className="text-brand mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-text-primary mb-2 text-sm">Policy Testing</h3>
                  <p className="text-xs text-text-secondary">Run tests against all active guard policies.</p>
                </div>
                <div className="p-6 rounded-xl bg-surface-secondary/80 border border-border text-center">
                  <Network size={20} className="text-brand mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-text-primary mb-2 text-sm">Audit Evidence</h3>
                  <p className="text-xs text-text-secondary">Generate audit-ready evidence from live behavior.</p>
                </div>
              </div>
            </div>

            {/* Signals Showcase Merge */}
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Detect when agent autonomy goes wrong</h2>
                <p className="mt-3 text-text-secondary">Automatic detection of autonomy breaches and logic drift.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                {signals.map((signal) => (
                  <div key={signal.name} className="flex items-start gap-4 p-4 rounded-xl bg-surface-secondary border border-border">
                    <div className="w-7 h-7 rounded-lg bg-status-error-subtle flex items-center justify-center flex-shrink-0 mt-0.5">
                      <ShieldAlert size={14} className="text-error" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{signal.name}</h3>
                      <p className="text-xs text-text-secondary mt-0.5">{signal.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Integration Surfaces. MCP-led. */}
            <div className="max-w-6xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">Integration surfaces</h2>
                <p className="mt-3 text-text-secondary">Pick the surface that matches your stack. All five hit the same governance loop on the same instance.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 text-left">
                {[
                  {
                    label: 'Zero code',
                    title: 'MCP server',
                    desc: 'Any MCP-compatible client (Claude Code, Claude Desktop, Managed Agents) gets governance via 33 tools and 6 resources. No SDK, no hooks. In chat clients the model invokes governance cooperatively (records + approval gates), not a hard kernel block — pair with the governance skill so the agent consults guard before acting.',
                    example: 'npx @dashclaw/mcp-server --url ... --key ...',
                    href: '/docs#mcp-server',
                  },
                  {
                    label: 'SDK',
                    title: 'Node & Python',
                    desc: 'Instrument any agent runtime with the canonical governance loop: guard → createAction → waitForApproval → updateOutcome.',
                    example: 'npm install dashclaw   #   pip install dashclaw',
                    href: '/docs#constructor',
                  },
                  {
                    label: 'Plugin',
                    title: 'OpenClaw',
                    desc: 'Native plugin for OpenClaw — the agent framework that inspired the "Claw" in DashClaw. Intercepts PreToolUse / PostToolUse, runs guard / record / wait-for-approval automatically.',
                    example: 'npm install @dashclaw/openclaw-plugin',
                    href: '/docs#openclaw-plugin',
                  },
                  {
                    label: 'Skill',
                    title: 'Claude governance skill',
                    desc: 'Anthropic skill that teaches Managed Agents the MCP usage protocol: risk tiers, decision handling, recording rules, session lifecycle.',
                    example: 'Pairs with @dashclaw/mcp-server',
                    href: '/docs#governance-skill',
                  },
                  {
                    label: 'Hooks',
                    title: 'Claude Code lifecycle',
                    desc: 'Two stdlib-only Python scripts for PreToolUse / PostToolUse. No pip install. Safe to ship even without DashClaw configured. Governs Bash, Edit, Write, MultiEdit, sub-agent (Agent/Task) spawns, and MCP tool calls (mcp__*) — including Gmail/Stripe/Calendar sends.',
                    example: 'cp hooks/dashclaw_*.py .claude/hooks/',
                    href: '/docs',
                  },
                  {
                    label: 'CLI',
                    title: 'Terminal approvals',
                    desc: 'Approve or deny agent actions from any terminal. Same endpoint as the dashboard and mobile PWA, and decisions sync over Redis SSE in about 1s.',
                    example: 'npm install -g @dashclaw/cli',
                    href: '/docs#cli-and-doctor',
                  },
                ].map((surface) => (
                  <Link
                    key={surface.title}
                    href={surface.href}
                    className="group p-5 rounded-xl bg-surface-secondary border border-border hover:border-border-hover transition-colors"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">{surface.label}</div>
                    <h3 className="text-sm font-semibold text-text-primary mb-1.5 group-hover:text-brand transition-colors">{surface.title}</h3>
                    <p className="text-xs text-text-secondary leading-relaxed mb-3">{surface.desc}</p>
                    <pre className="bg-surface-primary rounded-lg px-3 py-2 text-[10px] sm:text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">{surface.example}</pre>
                  </Link>
                ))}
              </div>
            </div>

            {/* Operate it: Doctor, Mobile PWA, Analytics */}
            <div className="max-w-6xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">Operate it</h2>
                <p className="mt-3 text-text-secondary">Day-2 tools for the people running governance in production.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-left">
                <Link
                  href="/docs#dashclaw-doctor"
                  className="group p-5 rounded-xl bg-surface-secondary border border-border hover:border-border-hover transition-colors"
                >
                  <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Diagnostics</div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1.5 group-hover:text-brand transition-colors">dashclaw doctor</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-3">Diagnoses your instance and this machine — database, config, auth, deployment, SDK reachability, data hygiene, stale installs. Report-only by default; --fix applies safe repairs.</p>
                  <pre className="bg-surface-primary rounded-lg px-3 py-2 text-[10px] sm:text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">dashclaw doctor</pre>
                </Link>
                <Link
                  href="/approve"
                  className="group p-5 rounded-xl bg-surface-secondary border border-border hover:border-border-hover transition-colors"
                >
                  <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">On-call</div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1.5 group-hover:text-brand transition-colors">Mobile approvals</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-3">A PWA at <code className="font-mono text-text-primary">/approve</code> for approving high-risk actions from your phone. Same governance loop as the dashboard.</p>
                  <pre className="bg-surface-primary rounded-lg px-3 py-2 text-[10px] sm:text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">https://&lt;instance&gt;/approve</pre>
                </Link>
                <Link
                  href="/self-host#approve-from-anywhere"
                  className="group p-5 rounded-xl bg-surface-secondary border border-border hover:border-border-hover transition-colors"
                >
                  <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Messaging</div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1.5 group-hover:text-brand transition-colors">Telegram approvals</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-3">Pending actions fan out to an admin Telegram chat with inline Approve / Reject. One tap on your phone resolves the action against the same endpoint as the dashboard.</p>
                  <pre className="bg-surface-primary rounded-lg px-3 py-2 text-[10px] sm:text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">npm run telegram:setup</pre>
                </Link>
                <Link
                  href="/analytics"
                  className="group p-5 rounded-xl bg-surface-secondary border border-border hover:border-border-hover transition-colors"
                >
                  <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Cost &amp; volume</div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1.5 group-hover:text-brand transition-colors">Analytics dashboard</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-3">Hero stats with trend comparison, cost-trend and action-volume series, breakdowns by agent, action type, and model. Token usage by tier.</p>
                  <pre className="bg-surface-primary rounded-lg px-3 py-2 text-[10px] sm:text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">GET /api/analytics?days=7</pre>
                </Link>
                <Link
                  href="/spend"
                  className="group p-5 rounded-xl bg-surface-secondary border border-border hover:border-border-hover transition-colors"
                >
                  <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Cost &amp; spend</div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1.5 group-hover:text-brand transition-colors">Spend (FinOps)</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-3">Fleet spend rollup — agent LLM cost plus x402 capability purchases, with a separate Your-Claude-Code lens. 7/30/90-day trend.</p>
                  <pre className="bg-surface-primary rounded-lg px-3 py-2 text-[10px] sm:text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">GET /api/finops/spend?lens=fleet</pre>
                </Link>
                <Link
                  href="/posture"
                  className="group p-5 rounded-xl bg-surface-secondary border border-border hover:border-border-hover transition-colors"
                >
                  <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Governance health</div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1.5 group-hover:text-brand transition-colors">Posture score</h3>
                  <p className="text-xs text-text-secondary leading-relaxed mb-3">A gaming-resistant score across six governance dimensions — what the fleet actually governs versus what it could. It rises only from policies proven to fire, never from drafts. Each gap becomes a prioritized finding you resolve as a draft, snooze, or accept.</p>
                  <pre className="bg-surface-primary rounded-lg px-3 py-2 text-[10px] sm:text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">GET /api/posture</pre>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Vs alternatives (LangSmith / Langfuse positioning) ── */}
      <section
        id="vs-alternatives"
        aria-labelledby="vs-alternatives-heading"
        className="py-24 px-6 border-t border-border bg-surface-secondary/40 scroll-mt-20"
      >
        <MarketingViewObserver
          targetId="vs-alternatives"
          event="marketing_vs_section_viewed"
        />
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-tertiary mb-3">
              How DashClaw compares
            </p>
            <h2
              id="vs-alternatives-heading"
              className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary leading-tight"
            >
              Observability tools record what happened. DashClaw governs what is allowed to happen.
            </h2>
          </div>

          <div className="rounded-2xl border border-border bg-surface-secondary overflow-hidden">
            <div tabIndex={0} aria-label="DashClaw comparison table" className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-tertiary">
                    <th scope="col" className="px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary font-semibold">
                      Dimension
                    </th>
                    <th scope="col" className="px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-text-tertiary font-semibold">
                      Tracing tools (LangSmith, Langfuse)
                    </th>
                    <th scope="col" className="px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-brand font-semibold bg-brand-subtle/50">
                      DashClaw
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { dim: 'When it acts', tracing: 'After the action', dashclaw: 'Before the action' },
                    { dim: 'Core primitive', tracing: 'Log or trace', dashclaw: 'Guard and policy' },
                    { dim: 'Human in the loop', tracing: 'Add on', dashclaw: 'First class' },
                    { dim: 'Compliance evidence', tracing: 'Trace export', dashclaw: 'Action level, policy and approver bound' },
                    { dim: 'Self host', tracing: 'Available', dashclaw: 'Available, MIT, no paid tier required' },
                  ].map((row, idx, arr) => (
                    <tr
                      key={row.dim}
                      className={idx < arr.length - 1 ? 'border-b border-border' : ''}
                    >
                      <th scope="row" className="px-4 py-3 font-semibold text-text-primary align-top">
                        {row.dim}
                      </th>
                      <td className="px-4 py-3 text-text-secondary align-top">{row.tracing}</td>
                      <td className="px-4 py-3 text-text-primary font-medium bg-brand-subtle/30 align-top">
                        {row.dashclaw}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-8 text-sm text-text-secondary leading-relaxed text-center max-w-2xl mx-auto">
            Tracing tools answer the question, what did my agent do. DashClaw answers the question, what is my agent allowed to do. Both have a place. Most teams will eventually run both.
          </p>
        </div>
      </section>

      {/* ── 8. Bottom CTA ── */}
      <section className="py-20 px-6 border-t border-border">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Run agents with permissioned autonomy.
          </h2>
          <p className="mt-3 text-text-secondary">
            DashClaw lets agents move fast without giving up control. Intercept risky actions. Require approval when needed. Prove every decision afterward.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/self-host" className="px-6 py-2.5 rounded-lg bg-brand text-surface-primary text-sm font-medium hover:bg-brand-hover transition-colors inline-flex items-center gap-2">
              Deploy DashClaw
            </Link>
            {/* Same-page anchor for the same reason as the hero button: the
                middleware 302 /demo → /#live-demo drops its hash during
                client-side navigation from /, leaving the button dead. */}
            <a href="#live-demo" className="px-6 py-2.5 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-colors inline-flex items-center gap-2">
              Explore the Demo <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      </main>

      {/* ── 10. Footer ── */}
      <PublicFooter />
    </div>
  );
}
