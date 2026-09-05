import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowRight,
  Terminal,
  ShieldCheck,
  FileCheck,
  Scale,
  Crosshair,
  HeartPulse,
  Stethoscope,
  Inbox,
  SlidersHorizontal,
  AppWindow,
  Target,
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
import { marketingPageMetadata } from './lib/marketingSeo';
import JsonLd from './components/JsonLd';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DashClaw, the approval layer for unattended AI agents',
  description:
    'Stop risky agent actions before they run and approve them from your phone. Works with OpenClaw, Hermes, Claude Code, Codex and MCP. Every decision lands in a signed ledger.',
  path: '/',
});

/* ─── page ─── */

const GOVERNANCE_LOOP = `const claw = new DashClaw();

// Requires a server that advertises execution claim protocol 1.
await claw.runGoverned(
  { kind: 'shell', command: 'git push --force origin main' },
  {
    action_type: 'shell',
    declared_goal: 'Force-push the rebased branch',
  },
  () => run(),
);

// runGoverned checks current policy, waits if needed, claims one
// exact act and principal-bound attempt, then records its outcome.
// An uncertain claim or outcome must be reconciled, not retried blindly.`;

const LOOP_STEPS = [
  {
    stage: 'Intercept',
    text: 'A PreToolUse hook in Claude Code, Codex, or Hermes, the OpenClaw gateway, or bounded dashclaw_invoke can halt a supported tool call before it executes.',
  },
  {
    stage: 'Decide',
    text: 'The guard engine risk-scores the call against your policies into the lattice allow < warn < allow_contained < require_approval < block. The join is max, and a block is absolute.',
  },
  {
    stage: 'Approve',
    text: 'require_approval holds the action for a human verdict. Protocol 1 consumes approval or plan authority in the same database statement that claims one fresh, exact-act, principal-bound attempt. This prevents duplicate authority inside DashClaw; it does not make an external effect exactly once. Containment can stage supported file or Postgres work for later promotion or discard.',
  },
  {
    stage: 'Record',
    text: 'Recorded decisions and outcomes form a replayable audit trail with explicit identity and payload-signature status. The liveness probe is a timestamped client report from an installed seam, not continuous attestation.',
  },
];

const WEDGE_ROWS = [
  { dim: 'Who it protects', native: 'You, while you watch each prompt', dashclaw: 'The run you walked away from' },
  { dim: 'When you must be present', native: 'Each prompt, in real time', dashclaw: 'Only when a policy holds work; resolve from a phone' },
  { dim: 'Policy scope', native: 'Per session, per machine allowlist', dashclaw: 'Shared policy service across integrated runtimes' },
  { dim: 'Audit trail', native: 'No shared export', dashclaw: 'Replayable records with explicit signature status' },
  { dim: 'Interruption rate', native: 'Fixed prompts, no tuning', dashclaw: 'Calibrated to a target false-block bound' },
];

const SUPPORT_SURFACES = [
  {
    icon: Inbox,
    title: 'Approvals inbox',
    desc: 'The primary human surface for recorded work waiting on you. Each item shows the redacted act bound to the decision, its risk, and the available allow or deny controls. Resolve from a browser, CLI, phone, Telegram, or Discord when that channel is configured.',
    href: '/approvals',
  },
  {
    icon: Scale,
    title: 'Decisions ledger',
    desc: 'Recorded governed actions with their declared goal, bound act, risk composition, matched policies, approver, outcome, verified-identity state, and payload-signature state.',
    href: '/decisions',
  },
  {
    icon: SlidersHorizontal,
    title: 'Policies',
    desc: 'A short list of things that stop your agent, with other recorded traffic measured. The default pack holds only its explicit evidence-matched catastrophes.',
    href: '/policies',
  },
  {
    icon: Crosshair,
    title: 'Fewer interruptions, earned',
    desc: 'Starts in preview on day one. Learns from your verdicts — including one-click retrospective calls on things that never interrupted you — and only gets quieter until you say otherwise.',
    href: '/policies#calibration',
  },
  {
    icon: HeartPulse,
    title: 'Enforcement liveness',
    desc: 'An installed client can drive a synthetic held action through its hook seam and report whether it executed. Setup shows the report time and renders missing or stale evidence explicitly; it is not continuous attestation.',
    href: '/setup#enforcement-liveness',
  },
  {
    icon: AppWindow,
    title: 'Pulse',
    desc: 'A small always-on-top window that answers one question from across the room: is anything owed? A dim dash when nothing is, the pending count when something waits, and honesty rules that keep a dead pipe from ever rendering as calm. Read-only; opens with one click from the approvals inbox.',
    href: '/widget',
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
  // The hosted trial is the secondary door (thesis): the install path is the
  // one primary action, so the trial CTA renders quiet. It only appears when
  // this IS the hosted instance or the marketing build points at one.
  const trialConfigured = hosted || Boolean(process.env.NEXT_PUBLIC_HOSTED_TRIAL_URL);
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary text-base">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'SoftwareApplication',
              name: 'DashClaw',
              description:
                'An approval layer for unattended AI agents. Supported hooks and gateways (OpenClaw, Hermes, Claude Code, Codex, MCP) halt risky actions for human approval before execution, and every decision is recorded in a signed ledger.',
              url: 'https://www.dashclaw.io',
              applicationCategory: 'DeveloperApplication',
              operatingSystem: 'Any',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            },
            {
              '@type': 'Organization',
              name: 'DashClaw',
              url: 'https://www.dashclaw.io',
              sameAs: ['https://github.com/ucsandman/DashClaw'],
            },
          ],
        }}
      />
      <PublicNavbar />
      <SetupBanner />

      <main>
        {/* ── 1. Hero: the claim on the left, a real caught action on the right ── */}
        <section className="pt-28 pb-16 px-6">
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
            <div>
              <h1 className="text-4xl sm:text-5xl xl:text-[3.25rem] font-bold tracking-tight leading-[1.08] text-text-primary [text-wrap:balance]">
                Remote approvals for unattended agent runs. A signed record of every decision.
              </h1>
              <p className="mt-6 text-lg text-text-secondary leading-relaxed max-w-xl">
                Let the routine work continue. Review the actions your policies
                hold, then allow or deny them from the dashboard or phone.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
                <TrackedLink
                  href="/self-host"
                  event="marketing_hero_cta_clicked"
                  className="px-8 py-3 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-all hover:scale-105 inline-flex items-center justify-center gap-2 shadow-xl shadow-brand/20 whitespace-nowrap"
                >
                  Install the runtime <ArrowRight size={18} aria-hidden="true" />
                </TrackedLink>
                <InlineCopyCommand command="npx dashclaw up" className="px-4 py-2.5 text-sm" />
              </div>
              <p className="mt-3 text-xs text-text-tertiary max-w-xl">
                Installs the runtime, provisions Postgres, mints your key, and
                wires your first hook. No account on the path to your first
                caught action.
              </p>

              <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3">
                <TrackedLink
                  href="/connect"
                  event="marketing_hero_plugin_clicked"
                  className="px-6 py-2.5 rounded-lg bg-surface-tertiary border border-border-hover text-text-secondary text-sm font-medium hover:bg-surface-elevated hover:text-text-primary transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                >
                  Governing Claude Code? Install the plugin <ArrowRight size={15} aria-hidden="true" />
                </TrackedLink>
                {trialConfigured ? <HostedTrialCTA variant="secondary" /> : null}
              </div>
              {trialConfigured ? (
                <p className="mt-3 text-xs text-text-tertiary">
                  Rather not deploy yet? The hosted trial lets you see the
                  Approvals inbox in your browser, no install.
                </p>
              ) : null}

              <p className="mt-8 text-sm text-text-tertiary max-w-xl">
                Enforced at the hook seam in Claude Code, Codex, and Hermes, and
                at the OpenClaw gateway. Honored cooperatively by the Node and
                Python SDKs, the MCP server, and REST.
              </p>

              <div className="mt-4 text-xs text-text-tertiary flex flex-wrap items-center gap-x-3 gap-y-2">
                <span>MIT licensed</span>
                <span className="text-text-disabled" aria-hidden="true">&middot;</span>
                <span>Self hosted</span>
                <span className="text-text-disabled" aria-hidden="true">&middot;</span>
                <span>No account to your first block</span>
                <span className="text-text-disabled" aria-hidden="true">&middot;</span>
                <span>Your data stays on your infrastructure</span>
              </div>
            </div>

            <HeroDecisionRecord />
          </div>
        </section>

        {/* ── 2. Live demo: run a real guard call against a live instance ── */}
        <LiveDemo />

        {/* ── 3. The wedge: native prompts protect you at the keyboard ── */}
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
                Native permission prompts protect you at the keyboard. DashClaw protects the runs you walk away from.
              </h2>
              <p className="mt-4 text-text-secondary leading-relaxed">
                Claude Code and Codex already ship permission prompts for the
                at-keyboard user, for free. DashClaw does not compete with those.
                It does the job those prompts structurally cannot, because they
                need you present: it freezes the dangerous call and lets you
                approve it minutes or hours later, from anywhere.
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
                        Native permission prompts
                      </th>
                      <th scope="col" className="px-4 py-3 text-[10px] font-mono uppercase tracking-[0.18em] text-brand font-semibold">
                        DashClaw
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {WEDGE_ROWS.map((row, idx, arr) => (
                      <tr
                        key={row.dim}
                        className={idx < arr.length - 1 ? 'border-b border-border' : ''}
                      >
                        <th scope="row" className="px-4 py-3 font-semibold text-text-primary align-top">
                          {row.dim}
                        </th>
                        <td className="px-4 py-3 text-text-secondary align-top">{row.native}</td>
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
              This is not observability either. LangSmith and Langfuse record
              what an agent did after it ran. On an enforcing integration,
              DashClaw evaluates policy before the supported call runs.
            </p>
          </div>
        </section>

        {/* ── 4. The loop: intercept, decide, approve, prove ── */}
        <section id="sdk" className="py-20 px-6 border-t border-border bg-surface-secondary/40 scroll-mt-20">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                The whole product is one loop
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                Intercept, decide, approve, record. Hooks and OpenClaw own an
                enforcing seam. Node and Python <code className="font-mono text-xs">runGoverned</code>{' '}
                require a confirmed protocol-1 execution claim before the callback.
                Bare MCP and REST integrations must honor decisions cooperatively.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
              <div className="rounded-xl border border-border bg-surface-secondary overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                  <Terminal size={14} className="text-text-tertiary" aria-hidden="true" />
                  <span className="text-xs font-mono text-text-tertiary">govern-forcepush.ts</span>
                </div>
                <pre
                  tabIndex={0}
                  aria-label="The governance loop in the Node SDK"
                  className="p-5 font-mono text-xs leading-relaxed text-text-secondary overflow-x-auto bg-surface-primary"
                >
                  <code>{GOVERNANCE_LOOP}</code>
                </pre>
              </div>

              <div>
                <ol className="space-y-6">
                  {LOOP_STEPS.map((step, idx) => (
                    <li key={step.stage} className="flex gap-4">
                      <span className="font-mono text-sm text-text-tertiary tabular-nums pt-0.5" aria-hidden="true">
                        {idx + 1}
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-text-primary">
                          {step.stage}
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

        {/* ── 5. Three proof points: calibration + liveness + predicted vs actual ── */}
        <section className="py-20 px-6 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                Three things make the checkpoint livable
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                A governor you disable is worse than none. These three keep it
                earning its interruptions, report whether an installed seam held
                a probe, and compare agent confidence with reported outcomes.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="p-6 rounded-xl border border-border bg-surface-secondary">
                <div className="flex items-center gap-2.5 mb-3">
                  <Crosshair size={18} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Calibrated interruptions</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  A distribution-free controller tunes the interruption
                  threshold from your approve and deny stream, with a proven
                  false-block bound. It runs in shadow first, then loosens as
                  well as tightens: the things you keep approving stop asking,
                  never further than the riskiest action you approved, and one
                  deny takes the band straight back. Governance earns its
                  interruptions instead of nagging you into turning it off.
                </p>
              </div>
              <div className="p-6 rounded-xl border border-border bg-surface-secondary">
                <div className="flex items-center gap-2.5 mb-3">
                  <HeartPulse size={18} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Enforcement liveness</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  An installed client periodically drives a synthetic held action
                  through its hook seam and reports whether it executed. The report
                  is point-in-time evidence from that client. Missing or stale
                  reports never render green.
                </p>
              </div>
              <div className="p-6 rounded-xl border border-border bg-surface-secondary">
                <div className="flex items-center gap-2.5 mb-3">
                  <Target size={18} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Predicted vs actual</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Recorded actions can carry the agent&apos;s stated confidence. The
                  ledger compares it with agent-reported terminal outcomes over
                  30 days. That outcome is an audit assertion; consequential
                  external state still needs reconciliation.
                </p>
              </div>
            </div>

            <p className="mt-6 text-sm text-text-tertiary">
              Definitions, theorems, and honest limits are in the{' '}
              <a
                href="https://github.com/ucsandman/DashClaw/blob/main/docs/architecture/governance-core-theory.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-secondary underline underline-offset-4 decoration-border-hover hover:text-brand transition-colors"
              >
                governance core theory doc
              </a>
              .
            </p>
          </div>
        </section>

        {/* ── 6. Stack: quickstarts as tabs ── */}
        <section className="py-20 px-6 border-t border-border bg-surface-secondary/40">
          <div className="max-w-4xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                It meets your agent where it already runs
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                Installers wire supported Claude Code, Codex, and Hermes hook
                events. OpenClaw has a gateway plugin. The MCP server exposes
                17 tools and 3 resources to MCP clients, which still need to call them
                and honor the result. Custom runtimes can use the Node or Python SDK.
              </p>
            </div>
            <StackQuickstarts />
          </div>
        </section>

        {/* ── 7. The enforcement boundary, stated plainly ── */}
        <section className="py-20 px-6 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                Where the block is mechanical, and where it is honored
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                We do not claim universal enforcement. We publish the table.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="p-6 rounded-xl border border-border bg-surface-secondary">
                <div className="flex items-center gap-2.5 mb-3">
                  <ShieldCheck size={18} className="text-brand" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Mechanical halt</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Claude Code, Codex, and Hermes lifecycle hooks (fail-closed,
                  exit-2 on block), the OpenClaw gateway, and dashclaw_invoke.
                  The action is stopped in the seam before it runs.
                </p>
              </div>
              <div className="p-6 rounded-xl border border-border bg-surface-secondary">
                <div className="flex items-center gap-2.5 mb-3">
                  <FileCheck size={18} className="text-text-secondary" aria-hidden="true" />
                  <h3 className="text-base font-semibold text-text-primary">Honored and recorded</h3>
                </div>
                <p className="text-sm text-text-secondary leading-relaxed">
                  Bare SDK, MCP, and chat-based callers consult guard and honor
                  the decision cooperatively. Calls submitted to DashClaw are
                  recorded, and a block is never downgraded in the ledger. The
                  server cannot observe a cooperative caller that skips the
                  protocol. SDK callers can attach the actual command or request
                  so policy binds to evidence instead of only a declaration.
                </p>
              </div>
            </div>

            <p className="mt-6 text-sm text-text-secondary leading-relaxed">
              One more honest line: the hook runs at your agent&apos;s own
              privilege level. It is a seatbelt against accidents, not a cage
              against intent. DashClaw can record attempted edits and later probe
              failures, but a same-user process can tamper with its own hook. A
              stronger boundary comes from your
              deployment (a container, a separate OS user, or a read-only hook
              path), not from software running inside the agent&apos;s reach.
            </p>

            <p className="mt-4 text-sm text-text-secondary leading-relaxed">
              Governance can be narrowed as well as switched off, and that is
              loud too.{' '}
              <span className="font-mono text-xs">DASHCLAW_GOVERNED_CATEGORIES</span>{' '}
              decides which tool categories reach the guard at all, so an
              excluded category produces no row and its silence looks exactly
              like a quiet agent. The hook declares what it is not governing,
              and any gap raises a red <strong className="font-semibold text-text-primary">Governance
              scope narrowed</strong> signal naming what stopped being watched.
              Visibility, not enforcement: a client that narrows its own scope
              can also lie about the declaration, which is why the boundary
              above still matters.
            </p>

            <p className="mt-4 text-sm text-text-tertiary">
              The full per-surface table and threat model live in the{' '}
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

        {/* ── 8. Use cases (tabbed) ── */}
        <UseCases />

        {/* ── 9. The support surfaces around the loop ── */}
        <section id="features" className="py-20 px-6 border-t border-border bg-surface-secondary/40 scroll-mt-20">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary">
                One primary surface, and the switches around it
              </h2>
              <p className="mt-3 text-text-secondary leading-relaxed">
                The Approvals inbox is the front door. Everything else reads from
                the same ledger the loop writes.
              </p>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
                {SUPPORT_SURFACES.map((surface) => {
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
          </div>
        </section>

        {/* ── 10. Bottom CTA ── */}
        <section className="py-20 px-6 border-t border-border">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight [text-wrap:balance]">
              Put an approval layer in front of your unattended runs.
            </h2>
            <p className="mt-3 text-text-secondary">
              For the developer who kicks off a long run and cannot watch every
              tool call.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/self-host" className="px-8 py-3 rounded-lg bg-brand text-surface-primary text-sm font-bold hover:bg-brand-hover transition-all hover:scale-105 inline-flex items-center gap-2 shadow-xl shadow-brand/20">
                Install the runtime <ArrowRight size={18} aria-hidden="true" />
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
