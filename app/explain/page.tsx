import Link from 'next/link';
import type { Metadata } from 'next';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import MarketingPageView from '../components/MarketingPageView';
import { marketingPageMetadata } from '../lib/marketingSeo';
import { GovernanceFeed, GuardSimulator, IntegrationTabs, LoopWalkthrough, PolicyPlayground } from './sections';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DashClaw, explained: decision infrastructure for AI agents',
  description: 'An interactive explainer: how DashClaw intercepts, enforces, records, and verifies AI-agent actions.',
  path: '/explain',
});

const TOC = [
  { href: '#problem', label: 'The problem' },
  { href: '#loop', label: 'The loop' },
  { href: '#advocate', label: "The agent's advocate" },
  { href: '#retro', label: 'The session retro' },
  { href: '#simulator', label: 'Guard simulator' },
  { href: '#policies', label: 'Policy playground' },
  { href: '#integrate', label: 'Integrate' },
  { href: '#practices', label: 'Best practices' },
  { href: '#architecture', label: 'Architecture' },
];

const metaLabel = 'font-mono text-[11px] uppercase tracking-[0.14em] text-text-tertiary';
const card = 'rounded-xl border border-border bg-surface-secondary transition-colors hover:border-hover';

function Chip({ tone, children }: { tone: 'success' | 'warning' | 'error'; children: React.ReactNode }) {
  const tones = {
    success: 'text-status-success bg-status-success-subtle',
    warning: 'text-status-warning bg-status-warning-subtle',
    error: 'text-status-error bg-status-error-subtle',
  };
  return (
    <span className={`inline-flex items-center rounded-full border border-border px-2.5 py-0.5 font-mono text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function ExplainPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <MarketingPageView event="marketing_explain_visited" />
      <PublicNavbar />

      {/* Section nav: this page's table of contents, one quiet row under the header */}
      <nav
        aria-label="Sections on this page"
        className="sticky top-0 z-40 mt-14 border-b border-border bg-surface-primary/90 backdrop-blur-sm"
      >
        <div className="mx-auto flex h-11 max-w-5xl items-center gap-5 overflow-x-auto px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em] text-text-disabled">On this page</span>
          {TOC.map((t) => (
            <a key={t.href} href={t.href} className="whitespace-nowrap text-[13px] text-text-tertiary transition-colors hover:text-text-primary">
              {t.label}
            </a>
          ))}
        </div>
      </nav>

      <header className="px-6 pb-16 pt-24">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>Interactive explainer</div>
          <h1 className="mb-4 mt-2 text-4xl font-bold leading-tight tracking-tight">Decision infrastructure for AI&nbsp;agents.</h1>
          <p className="max-w-[62ch] text-lg text-text-secondary">
            DashClaw is a governance runtime. It sits between an agent&apos;s intent and the real world: every consequential action is
            checked against policy before it happens, recorded while it happens, and verified after it happens. This page explains the
            model, then lets you play with it.
          </p>
          <p className="mt-4 max-w-[62ch] text-lg text-text-secondary">
            Four things, and only four: <strong className="text-text-primary">policy enforcement</strong>,{' '}
            <strong className="text-text-primary">decision recording</strong>,{' '}
            <strong className="text-text-primary">assumption tracking</strong>, and{' '}
            <strong className="text-text-primary">risk signals</strong>. It does not give agents tools to achieve goals. It governs the
            goals they already have.
          </p>
          <p className="mt-6">
            <a
              href="#problem"
              className="inline-block rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-surface-primary transition-colors hover:bg-brand-hover"
            >
              See how it works
            </a>
          </p>
        </div>
      </header>

      <section id="problem" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>Why governance</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">An agent&apos;s afternoon, twice</h2>
          <p className="max-w-[62ch] text-lg text-text-secondary">
            Same agent, same tasks. The only difference is whether a governance runtime sits between intent and execution.
          </p>
          <GovernanceFeed />
        </div>
      </section>

      <section id="loop" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>How it works</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">The governance loop</h2>
          <p className="max-w-[62ch] text-lg text-text-secondary">
            A fully governed action makes four calls. Click each step, or use the arrow keys, to see what actually goes over the wire.
          </p>
          <LoopWalkthrough />
        </div>
      </section>

      <section id="advocate" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>Protection runs both ways</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">The agent&apos;s advocate</h2>
          <p className="max-w-[62ch] text-lg text-text-secondary">
            Governance is usually framed as protecting the world from agents. The same ledger protects the agent: from unfair blame,
            from being weaponized, and from bankrupting itself. Every governed action carries an{' '}
            <code className="font-mono text-[13px]">agent_defense</code> rollup on its detail record: what the agent declared, what it
            assumed, and which shields stood in front of it.
          </p>
          <div className="mt-4 grid gap-2">
            <div className={`${card} p-5`}>
              <div className={metaLabel}>The alibi</div>
              <h3 className="mb-2 mt-1.5 text-lg font-semibold">Assumptions are evidence, not overhead</h3>
              <p className="text-text-secondary">
                Before acting, an agent records what it believed and why (
                <span className="font-mono text-[12.5px]">assumption + basis</span>), tied to the action. When an outcome goes wrong,
                the ledger shows whether the agent acted reasonably on what it knew, and which assumption was later invalidated, by
                whom, and why. Blame lands on the broken belief, not reflexively on the agent.
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className={metaLabel}>Protection from weaponization</div>
              <h3 className="mb-2 mt-1.5 text-lg font-semibold">Shields, with receipts</h3>
              <p className="text-text-secondary">
                Declared goals are scanned for prompt-injection patterns on every guard call, and the scan&apos;s outcome is persisted
                with the decision, so a manipulated agent has evidence, not just a denial. Content policies can verify claims against a
                source of truth (<span className="font-mono text-[12.5px]">non_fabrication</span>) and issue signed receipts, failing
                closed when the source can&apos;t be checked. Where a shield didn&apos;t run, the record says <em>not recorded</em>.
                The advocate never fabricates its client&apos;s alibi.
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className={metaLabel}>Protection from bankrupting mistakes</div>
              <h3 className="mb-2 mt-1.5 text-lg font-semibold">Spend gates on x402 purchases</h3>
              <p className="text-text-secondary">
                For agents that spend real money over x402, per-purchase caps and cumulative window budgets interrupt a runaway
                purchase <em>before</em> the money moves: a block or an approval pause, recorded like any other decision. An agent
                under a spend gate cannot quietly drain a wallet; it gets stopped, and the stop is its proof of restraint.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="retro" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>The advocate&apos;s closing argument</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">The session retro</h2>
          <p className="max-w-[70ch] text-lg text-text-secondary">
            When a session ends, its whole record gets a defensibility review.{' '}
            <code className="font-mono text-[13px]">GET /api/sessions/:id/retro</code> composes it from the ledger on read, nothing is
            stored and nothing is invented, and returns a posture: <Chip tone="success">clean</Chip> <Chip tone="warning">review</Chip>{' '}
            <Chip tone="error">flagged</Chip>.
          </p>
          <div className="mt-4 grid gap-2">
            <div className={`${card} p-5`}>
              <div className={metaLabel}>Verdict from evidence, not vibes</div>
              <h3 className="mb-2 mt-1.5 text-lg font-semibold">Posture is derived, never scored</h3>
              <p className="text-text-secondary">
                The posture comes purely from the severities of evidenced findings: any high-severity finding (a blocked action, a
                failed shield verdict, an invalidated assumption that carried weight) means <em>flagged</em>; any finding at all means{' '}
                <em>review</em>; none means <em>clean</em>. Each finding cites the specific decision, action, or shield verdict behind
                it, so the verdict can be checked, not just believed.
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className={metaLabel}>The advocate, closing</div>
              <h3 className="mb-2 mt-1.5 text-lg font-semibold">A receipt of restraint</h3>
              <p className="text-text-secondary">
                The retro is the advocate section above, concluded: the assumptions the agent recorded, the shields that stood in
                front of it, and the approvals it waited for become its exhibit list. A clean retro is proof the agent operated inside
                its contract; a flagged one points at the exact evidence, not at the agent&apos;s reputation.
              </p>
            </div>
            <div className={`${card} p-5`}>
              <div className={metaLabel}>Where humans see it</div>
              <h3 className="mb-2 mt-1.5 text-lg font-semibold">On the session, at a glance</h3>
              <p className="text-text-secondary">
                Every session detail page renders the full retro card, with the posture chip pinned in the header next to the session
                status. Agents can read their own review too, over MCP (
                <span className="font-mono text-[12.5px]">dashclaw_session_retro</span>). Retrospection is part of the governance loop,
                not an ops afterthought.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="simulator" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>Illustrative simulation</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">Guard decision simulator</h2>
          <p className="max-w-[70ch] text-lg text-text-secondary">
            Describe a hypothetical action and watch the decision change. Illustrative simulation: production decisions come from the
            guard runtime, which computes risk server-side from the declared fields. The 40/70 bands are how DashClaw labels risk
            across the product; whether a given score warns, blocks, or pauses for approval is set by your org&apos;s risk_threshold
            policies. The toggle below mirrors one.
          </p>
          <GuardSimulator />
        </div>
      </section>

      <section id="policies" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>Illustrative simulation</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">Policy playground</h2>
          <p className="max-w-[70ch] text-lg text-text-secondary">
            Policies are the contract between you and your agents. Compose one and watch it re-evaluate a day of agent activity.
            Illustrative simulation: production decisions come from the guard runtime.
          </p>
          <PolicyPlayground />
        </div>
      </section>

      <section id="integrate" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>Integration</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">One action, four integrations</h2>
          <p className="max-w-[70ch] text-lg text-text-secondary">
            The same governed action (guard, record, act, report) in whichever shape your stack speaks. Pick a scenario, pick a style,
            copy it out.
          </p>
          <IntegrationTabs />
        </div>
      </section>

      <section id="practices" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>Operating well</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">Best practices</h2>
          <p className="max-w-[62ch] text-lg text-text-secondary">
            Distilled from running governed fleets. Each one exists because its absence has a failure story.
          </p>
          <div className="mt-4 grid gap-2">
            {PRACTICES.map((p) => (
              <details key={p.t} className={`${card} px-5 py-3.5`}>
                <summary className="cursor-pointer font-semibold text-text-primary">{p.t}</summary>
                <p className="mb-0.5 mt-2.5 max-w-[75ch] text-text-secondary">{p.d}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="architecture" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>The shape of it</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">Architecture at a glance</h2>
          <p className="max-w-[62ch] text-lg text-text-secondary">
            Agents speak to the runtime through an SDK, MCP server, or plain HTTP. The runtime enforces policy and writes the ledger.
            Humans watch and decide through the dashboard.
          </p>
          <div className={`${card} mt-4 overflow-x-auto p-6`}>
            <ArchitectureDiagram />
          </div>
          <p className="mt-3 text-[13px] text-text-tertiary">
            The dashboard surfaces are Mission Control (fleet posture and live decisions), Decisions (the causal-chain ledger), and
            Policies (the interruption contract). Note the direction of the human edge: people <em>observe and decide</em>; they are
            not in the data path of every action.
          </p>
        </div>
      </section>

      <section id="go-deeper" className="scroll-mt-28 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className={metaLabel}>Next steps</div>
          <h2 className="mb-2 mt-1 text-2xl font-semibold tracking-tight">Go deeper</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/connect" className={`${card} block px-5 py-4`}>
              <div className="font-semibold text-text-primary">Wire up your first agent</div>
              <div className="mt-1 text-[13px] text-text-tertiary">/connect: onboarding to the first governed action</div>
            </Link>
            <Link href="/mission-control" className={`${card} block px-5 py-4`}>
              <div className="font-semibold text-text-primary">Watch a fleet live</div>
              <div className="mt-1 text-[13px] text-text-tertiary">/mission-control: posture, interventions, decision stream</div>
            </Link>
            <Link href="/decisions" className={`${card} block px-5 py-4`}>
              <div className="font-semibold text-text-primary">Read a real ledger</div>
              <div className="mt-1 text-[13px] text-text-tertiary">/decisions: the causal chain of every governed action</div>
            </Link>
            <a
              href="https://github.com/ucsandman/DashClaw#readme"
              target="_blank"
              rel="noopener noreferrer"
              className={`${card} block px-5 py-4`}
            >
              <div className="font-semibold text-text-primary">Quick start &amp; SDKs</div>
              <div className="mt-1 text-[13px] text-text-tertiary">README, QUICK-START, Node &amp; Python SDK docs</div>
            </a>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

const PRACTICES = [
  {
    t: 'Fail closed',
    d: 'When the guard is unreachable or a policy is ambiguous, treat it as a block, not an allow. A paused agent is an inconvenience; an ungoverned one is an incident. DashClaw’s own non-fabrication verifier blocks on any error or malformed input for exactly this reason.',
  },
  {
    t: 'Record everything, idempotently',
    d: 'Every consequential action goes in the ledger before it executes, with an idempotency key derived from agent, type, and goal. Retries then return the existing record instead of double-recording, and double-executing paths get caught.',
  },
  {
    t: 'Never self-approve',
    d: 'An agent must never approve its own pending action, and a block is absolute: it is never downgraded, not even by an operator approval. If your integration can reach the approvals API, scope that credential away from the acting agent.',
  },
  {
    t: 'Declare goals honestly and specifically',
    d: '"Deploy build #402 to production" is governable; "run task" is not. Risk is computed from what you declare: vague declarations produce useless ledgers and let real risk hide. Approvals also match on the exact declared goal.',
  },
  {
    t: 'Report outcomes, including failures',
    d: 'The loop is not done at execution. Report completed, partial, or failed; the first terminal outcome wins. A ledger of intents without outcomes cannot tell you what actually happened.',
  },
  {
    t: 'Track the assumptions that carry weight',
    d: 'When an action rests on a belief ("staging was green", "this invoice is legitimate"), record it with its basis. When a belief turns out false, you can instantly find every action built on it.',
  },
  {
    t: 'Use sessions to bound accountability',
    d: 'Start and end sessions around units of agent work. A decision trail scoped to a session answers "what did this run do" without archaeology across the whole ledger.',
  },
  {
    t: 'Treat approvals as a contract, not a speed bump',
    d: 'Set approval thresholds where a human genuinely adds judgment: spend above a cap, irreversible operations, production access. Approve promptly or tune the threshold: a queue everyone rubber-stamps is worse than a lower gate.',
  },
];

function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 920 300"
      role="img"
      aria-label="Diagram: agents connect via SDK, MCP, or HTTP to the DashClaw governance runtime backed by Postgres; the dashboard surfaces Mission Control, Decisions, and Policies for humans."
      className="w-full min-w-[720px] font-mono text-[13px]"
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-tertiary)" />
        </marker>
      </defs>
      {/* agents */}
      <g stroke="var(--color-border-hover)" fill="var(--color-bg-secondary)">
        <rect x="20" y="30" width="150" height="52" rx="10" />
        <rect x="20" y="124" width="150" height="52" rx="10" />
        <rect x="20" y="218" width="150" height="52" rx="10" />
      </g>
      <g fill="var(--color-text-secondary)" textAnchor="middle">
        <text x="95" y="61">coding agent</text>
        <text x="95" y="155">ops agent</text>
        <text x="95" y="249">support agent</text>
      </g>
      {/* transport */}
      <g stroke="var(--color-border-hover)" fill="var(--color-bg-tertiary)">
        <rect x="250" y="106" width="140" height="88" rx="10" />
      </g>
      <g fill="var(--color-text-secondary)" textAnchor="middle">
        <text x="320" y="138">SDK / MCP</text>
        <text x="320" y="160" fill="var(--color-text-tertiary)">
          or raw HTTP
        </text>
      </g>
      {/* runtime */}
      <g stroke="var(--color-brand)" fill="var(--color-bg-secondary)">
        <rect x="470" y="76" width="200" height="148" rx="12" strokeWidth="1.5" />
      </g>
      <g textAnchor="middle">
        <text x="570" y="106" fill="var(--color-text-primary)" fontWeight="bold">
          governance runtime
        </text>
        <text x="570" y="132" fill="var(--color-text-tertiary)">
          guard &middot; policies
        </text>
        <text x="570" y="154" fill="var(--color-text-tertiary)">
          ledger &middot; assumptions
        </text>
        <text x="570" y="176" fill="var(--color-text-tertiary)">
          risk signals &middot; approvals
        </text>
        <text x="570" y="202" fill="var(--color-text-tertiary)">
          outcomes &middot; evidence
        </text>
      </g>
      {/* postgres */}
      <g stroke="var(--color-border-hover)" fill="var(--color-bg-tertiary)">
        <rect x="750" y="120" width="150" height="60" rx="10" />
      </g>
      <text x="825" y="155" fill="var(--color-text-secondary)" textAnchor="middle">
        Postgres
      </text>
      {/* dashboard */}
      <g stroke="var(--color-border-hover)" fill="var(--color-bg-tertiary)">
        <rect x="470" y="252" width="200" height="40" rx="10" />
      </g>
      <text x="570" y="277" fill="var(--color-text-secondary)" textAnchor="middle">
        dashboard &middot; humans
      </text>
      {/* edges */}
      <g stroke="var(--color-text-tertiary)" fill="none" markerEnd="url(#arrow)">
        <path d="M 170 56 C 215 56, 215 122, 250 132" />
        <path d="M 170 150 L 250 150" />
        <path d="M 170 244 C 215 244, 215 178, 250 168" />
        <path d="M 390 150 L 470 150" />
        <path d="M 670 150 L 750 150" />
        <path d="M 570 224 L 570 252" />
      </g>
      <text x="430" y="140" fill="var(--color-text-disabled)" textAnchor="middle" fontSize="11">
        govern
      </text>
      <text x="710" y="140" fill="var(--color-text-disabled)" textAnchor="middle" fontSize="11">
        persist
      </text>
    </svg>
  );
}
