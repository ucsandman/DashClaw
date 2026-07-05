import Link from 'next/link';
import {
  ArrowRight,
  Terminal,
  ShieldCheck,
  FileCheck,
  Radar,
  Scale,
  MessageSquare,
  Gauge,
  Wallet,
  Stethoscope,
} from 'lucide-react';
import PublicNavbar from './components/PublicNavbar';
import PublicFooter from './components/PublicFooter';
import InlineCopyCommand from './components/InlineCopyCommand';
import LiveDemo from './components/LiveDemo';
import UseCases from './components/UseCases';
import TrackedLink from './components/TrackedLink';
import MarketingViewObserver from './components/MarketingViewObserver';
import SetupBanner from './components/SetupBanner';
import HostedTrialCTA from './components/HostedTrialCTA';
import HeroDecisionRecord from './components/HeroDecisionRecord';
import StackQuickstarts from './components/StackQuickstarts';
import { isHostedMode } from './lib/hosted/flag';

import { signals } from './landingData';

/* ─── page ─── */

const GOVERNANCE_LOOP = `const claw = new DashClaw();

// 1. guard: policy decides before anything runs
const g = await claw.guard({
  action_type: 'deploy',
  declared_goal: 'Ship auth-service v2.1 to prod',
  risk_score: 85,
});

// 2. createAction: open the decision record
const action = await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Ship auth-service v2.1 to prod',
});

// 3. waitForApproval: block until a human resolves it
if (g.decision === 'require_approval') {
  await claw.waitForApproval(action.id);
}

// 4. updateOutcome: close the record, one-shot
await deploy();
await claw.updateOutcome(action.id, { status: 'success' });`;

const LOOP_STEPS = [
  {
    method: 'guard',
    text: 'Policy evaluates the declared action before it runs: allow, warn, block, or require_approval. A block is never downgraded.',
  },
  {
    method: 'createAction',
    text: 'The decision record opens: declared goal, reasoning, risk score, matched policies, assumptions.',
  },
  {
    method: 'waitForApproval',
    text: 'Held actions route to the dashboard, the CLI, a mobile PWA, Discord, or Telegram. Approvals expire; a lapsed one never releases held work.',
  },
  {
    method: 'updateOutcome',
    text: 'Terminal outcomes are one-shot and durable, so a retried agent never silently double-executes.',
  },
];

const OPERATE_SURFACES = [
  {
    icon: Radar,
    title: 'Mission Control',
    desc: 'Fleet posture, the intervention queue, and a live stream of governed events. Emergency halt is one confirmed click.',
    href: '/demo?sandbox=1',
  },
  {
    icon: Scale,
    title: 'Decisions ledger',
    desc: 'Every governed action, replayable: goal, risk composition, matched policies, approver, terminal outcome.',
    href: '/decisions',
  },
  {
    icon: MessageSquare,
    title: 'Approvals anywhere',
    desc: 'Dashboard inbox, CLI, mobile PWA at /approve, Discord and Telegram with one-tap resolve. A flood guard collapses approval storms into one bulk event.',
    href: '/approve',
  },
  {
    icon: Gauge,
    title: 'Posture score',
    desc: 'A gaming-resistant 0 to 100 across six governance dimensions. It rises only from policies proven to fire, never from drafts.',
    href: '/posture',
  },
  {
    icon: Wallet,
    title: 'Spend',
    desc: 'Fleet LLM cost plus x402 capability purchases, with per-purchase caps, window budgets, and live "$X of $Y used" meters.',
    href: '/spend',
  },
  {
    icon: Stethoscope,
    title: 'dashclaw doctor',
    desc: 'Diagnoses the instance and the machine: database, config, auth, deployment, SDK reachability, stale installs. Report-only by default.',
    href: '/docs#dashclaw-doctor',
  },
];

export default function LandingPage() {
  const hosted = isHostedMode();
  // The trial CTA renders when this IS the hosted instance or when the
  // marketing build points at one (NEXT_PUBLIC_HOSTED_TRIAL_URL). In either
  // case the trial is the one primary action — self-host drops to the quiet
  // style so brand orange stays a signal, not wallpaper (.impeccable #2).
  const trialConfigured = hosted || Boolean(process.env.NEXT_PUBLIC_HOSTED_TRIAL_URL);
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary text-base">
      <PublicNavbar />
      <SetupBanner />

      <main>
        {/* ── 1. Hero: the claim on the left, the proof on the right ── */}
        <section className="pt-28 pb-16 px-6">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
            <div>
              <h1 className="text-4xl sm:text-5xl xl:text-[3.5rem] font-bold tracking-tight leading-[1.08] text-text-primary [text-wrap:balance]">
                Govern AI agents before they act.
              </h1>
              <p className="mt-6 text-lg text-text-secondary leading-relaxed max-w-xl">
                DashClaw is an open source runtime that sits between your agents and
                production. Policy evaluates every risky action before it runs: allow,
                block, or hold for a human. Every decision lands in a signed,
                replayable ledger.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
                <HostedTrialCTA />
                <TrackedLink
                  href="/self-host"
                  event="marketing_hero_cta_clicked"
                  className={trialConfigured ? 'px-7 py-3 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap' : 'px-7 py-3 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap'}
                >
                  Self host the runtime <ArrowRight size={16} aria-hidden="true" />
                </TrackedLink>
                <InlineCopyCommand command="npx dashclaw-demo" className="px-3 py-2.5 text-xs" />
              </div>
              {trialConfigured ? (
                <p className="mt-3 text-xs text-text-tertiary">
                  Free for 30 days, no credit card. Your first governed action runs in
                  the browser, no install needed.
                </p>
              ) : null}

              <p className="mt-8 text-sm text-text-tertiary max-w-xl">
                Works with Claude Code, Codex, Hermes, OpenClaw, Claude Managed Agents,
                OpenAI, LangChain, CrewAI, AutoGen, and any custom runtime over MCP,
                SDK, or REST.
              </p>

              <div className="mt-4 text-xs text-text-tertiary flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>MIT licensed</span>
                <span className="text-text-disabled" aria-hidden="true">&middot;</span>
                <span>Self hosted</span>
                <span className="text-text-disabled" aria-hidden="true">&middot;</span>
                <span>No per seat pricing</span>
                <span className="text-text-disabled" aria-hidden="true">&middot;</span>
                <span>Your data stays on your infrastructure</span>
              </div>
            </div>

            <HeroDecisionRecord />
          </div>
        </section>

        {/* ── 2. Live demo: run a real guard call against a live instance ── */}
        <LiveDemo />

        {/* ── 3. Why: governance runs before the action, tracing runs after ── */}
        <section
          id="vs-alternatives"
          aria-labelledby="vs-alternatives-heading"
          className="py-20 px-6 border-t border-border scroll-mt-20"
        >
          <MarketingViewObserver
            targetId="vs-alternatives"
            event="marketing_vs_section_viewed"
          />
          <div className="max-w-4xl mx-auto">
            <div className="max-w-2xl mx-auto text-center mb-10">
              <h2
                id="vs-alternatives-heading"
                className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary leading-tight [text-wrap:balance]"
              >
                Observability tools record what happened. DashClaw governs what is
                allowed to happen.
              </h2>
              <p className="mt-4 text-text-secondary leading-relaxed">
                An agent with production credentials generates its actions at runtime.
                There is no code review for each decision, and a trace only tells you
                what happened after it happened. The check has to run before the
                action does.
              </p>
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
                      <th scope="col" className="px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-brand font-semibold">
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
                        <td className="px-4 py-3 text-text-primary font-medium align-top">
                          {row.dashclaw}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="mt-8 text-sm text-text-secondary leading-relaxed text-center max-w-2xl mx-auto">
              Tracing answers the question, what did my agent do. DashClaw answers the
              question, what is my agent allowed to do. Both have a place. Most teams
              will eventually run both.
            </p>
          </div>
        </section>

        {/* ── 4. The loop: four calls, annotated ── */}
        <section id="sdk" className="py-20 px-6 border-t border-border bg-surface-secondary/40 scroll-mt-20">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                One loop governs every action
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                Four calls, from the SDK, the MCP server, a plugin, or plain REST.
                Every path lands on the same primitives, the same ledger, and the same
                approval queue.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
              <div className="rounded-xl border border-border bg-surface-secondary overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                  <Terminal size={14} className="text-text-tertiary" aria-hidden="true" />
                  <span className="text-xs font-mono text-text-tertiary">govern-deploy.ts</span>
                </div>
                <pre
                  tabIndex={0}
                  aria-label="The four-call governance loop in the Node SDK"
                  className="p-5 font-mono text-xs leading-relaxed text-text-secondary overflow-x-auto bg-surface-primary"
                >
                  <code>{GOVERNANCE_LOOP}</code>
                </pre>
              </div>

              <div>
                <ol className="space-y-6">
                  {LOOP_STEPS.map((step, idx) => (
                    <li key={step.method} className="flex gap-4">
                      <span className="font-mono text-sm text-text-tertiary tabular-nums pt-0.5" aria-hidden="true">
                        {idx + 1}
                      </span>
                      <div>
                        <h3 className="font-mono text-sm font-semibold text-text-primary">
                          {step.method}
                        </h3>
                        <p className="mt-1 text-sm text-text-secondary leading-relaxed max-w-md">
                          {step.text}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-8 flex flex-wrap gap-3">
                  <InlineCopyCommand command="npm install dashclaw" className="px-3 py-1.5" />
                  <InlineCopyCommand command="pip install dashclaw" className="px-3 py-1.5" />
                  <InlineCopyCommand command="npx @dashclaw/mcp-server" className="px-3 py-1.5" />
                </div>
                <Link href="/docs" className="mt-5 inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors">
                  Read the SDK and API docs <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── 5. Stack: quickstarts as tabs ── */}
        <section className="py-20 px-6 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                It meets your agent where it already runs
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                One command wires Claude Code, Codex, or Hermes. A plugin covers
                OpenClaw. The MCP server gives any MCP client the same loop
                through {'33 tools and 6 resources'}, no SDK and no code changes.
                Everything else takes the Node or Python SDK.
              </p>
            </div>
            <StackQuickstarts />
          </div>
        </section>

        {/* ── 6. The enforcement boundary, stated plainly ── */}
        <section className="py-20 px-6 border-t border-border bg-surface-secondary/40">
          <div className="max-w-4xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                Where the block is mechanical, and where it is honored
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                Most governance pitches skip this question. We publish the table.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="p-6 rounded-xl border border-border bg-surface-secondary">
                <div className="flex items-center gap-2.5 mb-3">
                  <ShieldCheck size={18} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Mechanical halt</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Claude Code, Codex, and Hermes lifecycle hooks, the OpenClaw plugin,
                  and every capability DashClaw executes itself. The action is stopped
                  in the harness before it runs. The agent cannot proceed past a
                  block.
                </p>
              </div>
              <div className="p-6 rounded-xl border border-border bg-surface-secondary">
                <div className="flex items-center gap-2.5 mb-3">
                  <FileCheck size={18} className="text-text-secondary" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Honored and recorded</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  SDK, MCP, and chat-based callers consult guard and honor the
                  decision cooperatively. Every call is still recorded, a block is
                  never downgraded in the ledger, and any gap between decision and
                  behavior is visible evidence, not silence.
                </p>
              </div>
            </div>

            <p className="mt-6 text-sm text-text-tertiary">
              The full per-surface table lives in the{' '}
              <a
                href="https://github.com/ucsandman/DashClaw/blob/main/docs/architecture/enforcement-boundary.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-secondary underline underline-offset-4 decoration-border-hover hover:text-brand transition-colors"
              >
                enforcement boundary doc
              </a>
              .
            </p>
          </div>
        </section>

        {/* ── 7. Use cases (tabbed: deploys / spend / drift) ── */}
        <UseCases />

        {/* ── 8. Operating the fleet after the decision ── */}
        <section id="features" className="py-20 px-6 border-t border-border bg-surface-secondary/40 scroll-mt-20">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                After the decision, the control room
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                Governed decisions produce operations: a live fleet view, an approval
                inbox, a posture score, a spend meter. All of it reads from the same
                ledger the loop writes.
              </p>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
                {OPERATE_SURFACES.map((surface) => {
                  const Icon = surface.icon;
                  return (
                    <Link
                      key={surface.title}
                      href={surface.href}
                      className="group flex items-start gap-4 p-5 bg-surface-secondary hover:bg-surface-tertiary transition-colors"
                    >
                      <Icon size={17} className="text-text-tertiary mt-0.5 shrink-0 group-hover:text-brand transition-colors" aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5">
                          {surface.title}
                          <ArrowRight size={13} className="text-text-disabled group-hover:text-brand transition-colors" aria-hidden="true" />
                        </h3>
                        <p className="mt-1 text-xs text-text-secondary leading-relaxed">{surface.desc}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Risk signals the runtime raises on its own */}
            <div className="mt-10">
              <p className="text-sm text-text-secondary mb-3">
                The runtime also watches the fleet and raises risk signals on its own:
              </p>
              <ul className="flex flex-wrap gap-2">
                {signals.map((signal) => (
                  <li
                    key={signal.name}
                    className="px-3 py-1 rounded-full border border-border bg-surface-secondary text-xs text-text-secondary"
                    title={signal.description}
                  >
                    {signal.name}
                  </li>
                ))}
              </ul>
            </div>

            {/* Compliance evidence, one honest line */}
            <div className="mt-10 pt-8 border-t border-border flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
              <p className="text-sm text-text-secondary leading-relaxed max-w-xl">
                Every governed decision doubles as audit evidence. DashClaw maps guard
                decisions and approvals to SOC 2, ISO 27001, GDPR, and NIST AI RMF and
                generates audit-ready exports; it does not assert that your deployment
                is certified.
              </p>
              <Link
                href="/compliance"
                className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors shrink-0"
              >
                Compliance engine <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── 9. Bottom CTA ── */}
        <section className="py-20 px-6 border-t border-border">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight [text-wrap:balance]">
              Put a permission layer in front of your agents.
            </h2>
            <p className="mt-3 text-text-secondary">
              For teams running AI agents where the cost of a bad action is real.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <HostedTrialCTA />
              <Link href="/self-host" className={trialConfigured ? 'px-6 py-2.5 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-colors inline-flex items-center gap-2' : 'px-6 py-2.5 rounded-lg bg-brand text-surface-primary text-sm font-medium hover:bg-brand-hover transition-colors inline-flex items-center gap-2'}>
                Self host the runtime
              </Link>
              {/* Same-page anchor, not <Link href="/demo">: the middleware 302
                  to /#live-demo loses its hash during client-side navigation
                  when you're already on /, so the button looked dead. /demo
                  stays the entrypoint for external links. */}
              <a href="#live-demo" className="px-6 py-2.5 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-colors inline-flex items-center gap-2">
                <Terminal size={15} aria-hidden="true" /> Run the live demo
              </a>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
