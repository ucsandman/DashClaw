import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronRight, Terminal, ArrowRight, Shield, Server, Cloud } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import CopyMarkdownButton from '../components/CopyMarkdownButton';
import CopyableCodeBlock from '../components/CopyableCodeBlock';
import MarketingPageView from '../components/MarketingPageView';
import SetupTabs from './SetupTabs';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Get Started with DashClaw',
  description: 'Deploy your own DashClaw dashboard for free with Vercel + Neon, or run locally with Docker.',
  path: '/self-host',
});

export default function SelfHostPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <MarketingPageView event="marketing_self_host_visited" />
      <PublicNavbar />

      <section className="pt-28 pb-12 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-text-tertiary mb-4">
            <Link href="/" className="hover:text-text-primary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-text-primary">Get Started</span>
          </div>

          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center">
              <Terminal size={20} className="text-brand" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Self-host your own governance control plane</h1>
              <p className="mt-2 text-text-secondary max-w-2xl leading-relaxed">
                Free to deploy. You own the data. Run doctor, connect your first agent, and verify the first decision record in under 10 minutes.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/connect" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover transition-colors">
              Connect your first agent <ArrowRight size={16} />
            </Link>
            <a href="https://github.com/ucsandman/DashClaw" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-surface-secondary border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-tertiary hover:text-text-primary hover:border-border-hover transition-colors">
              Open Source Repo <ArrowRight size={16} />
            </a>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-tertiary">
            <Link href="/demo" className="hover:text-text-secondary transition-colors">View live demo</Link>
            <span aria-hidden="true" className="text-text-disabled">·</span>
            <Link href="/docs" className="hover:text-text-secondary transition-colors">SDK docs</Link>
            <span aria-hidden="true" className="text-text-disabled">·</span>
            <Link href="/setup" className="hover:text-text-secondary transition-colors">Check instance status</Link>
          </div>
          <div className="mt-5 rounded-xl border border-border bg-surface-secondary p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">Expected proof after deploy</p>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed">
              <code className="font-mono text-text-primary">npm run doctor</code> or{' '}
              <code className="font-mono text-text-primary">dashclaw doctor</code> exits 0 or names the blocker. Your first governed action appears in{' '}
              <code className="font-mono text-text-primary">/decisions</code>, held work appears in{' '}
              <code className="font-mono text-text-primary">/approvals</code>, and{' '}
              <code className="font-mono text-text-primary">/api/setup/live-proof</code> can capture setup evidence without exposing secrets.
            </p>
          </div>
        </div>
      </section>

      {/* Two-path intro */}
      <section className="pb-8 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-surface-secondary border border-border-active p-5">
              <div className="flex items-center gap-2 mb-2">
                <Cloud size={18} className="text-brand" />
                <h3 className="text-sm font-semibold text-text-primary">Cloud (recommended)</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                Vercel + Neon free tiers. Zero cost, accessible from any device, auto-HTTPS. Takes ~10 minutes.
              </p>
            </div>
            <div className="rounded-xl bg-surface-secondary border border-border p-5">
              <div className="flex items-center gap-2 mb-2">
                <Server size={18} className="text-text-tertiary" />
                <h3 className="text-sm font-semibold text-text-primary">Local</h3>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">
                Docker + localhost. Good for development or if you want everything on your machine.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Cloud path */}
      <section className="pb-20 px-6">
        <div className="max-w-5xl mx-auto">
          <Suspense fallback={null}>
            <SetupTabs />
          </Suspense>
        </div>
      </section>

      {/* Verify your deployment with Doctor */}
      <section className="pb-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">Verify</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-text-primary">Confirm your deployment is healthy</h2>
          <p className="mt-2 text-text-secondary">
            Doctor diagnoses database, configuration, auth, deployment, SDK reachability, governance staleness, data hygiene, shape drift, and write-path health (live canary writes that prove heartbeats, action records, and guard audit rows actually land: synthetic, isolated, self-cleaning). It reports by default; pass --fix to apply safe repairs. Run it as the first thing after your instance comes up.
          </p>
          <p className="mt-2 text-text-secondary">
            The live host canary covers the outside-in half: an hourly GitHub Actions cron probes your deployed hosts as a real unauthenticated client (pages render, trial mint stays fail-closed, OAuth discovery and the MCP handshake answer their contracts) and files its verdict to your instance; failures render on <code className="font-mono text-text-primary">/setup#live-canary</code> and raise a posture finding.
          </p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Operator (on the host)</div>
              <h3 className="text-sm font-semibold text-text-primary mb-2">npm run doctor</h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">
                Filesystem-level fixes. Can write missing env vars to <code className="font-mono text-text-primary">.env</code> (always backed up first), run pending DB migrations, generate <code className="font-mono text-text-primary">NEXTAUTH_SECRET</code>/<code className="font-mono text-text-primary">ENCRYPTION_KEY</code>, fix CORS, and seed a default policy.
              </p>
              <pre className="overflow-x-auto rounded-xl border border-border bg-surface-primary p-3 text-xs leading-relaxed text-text-secondary font-mono">{`npm run doctor`}</pre>
            </div>
            <div className="rounded-2xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Anyone with an API key</div>
              <h3 className="text-sm font-semibold text-text-primary mb-2">dashclaw doctor</h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">
                Same engine, invoked via <code className="font-mono text-text-primary">GET /api/doctor</code> + <code className="font-mono text-text-primary">POST /api/doctor/fix</code>. No filesystem access. Add <code className="font-mono text-text-primary">--json</code> for CI, <code className="font-mono text-text-primary">--no-fix</code> to diagnose only.
              </p>
              <pre className="overflow-x-auto rounded-xl border border-border bg-surface-primary p-3 text-xs leading-relaxed text-text-secondary font-mono">{`npm install -g @dashclaw/cli
dashclaw doctor`}</pre>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-text-tertiary">
            Exit codes: <code className="font-mono text-text-secondary">0</code> healthy, <code className="font-mono text-text-secondary">1</code> warnings, failures, or unreachable.
          </p>
        </div>
      </section>

      {/* Approve from anywhere */}
      <section id="approve-from-anywhere" className="pb-20 px-6 border-t border-border scroll-mt-20">
        <div className="max-w-5xl mx-auto py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-tertiary">Approve from anywhere</p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-text-primary">Resolve pending actions without opening the dashboard</h2>
          <p className="mt-2 text-text-secondary">
            Every instance exposes four approval surfaces against the same <code className="font-mono text-text-primary">/api/approvals/:id</code> endpoint. Pick whichever your on-call workflow prefers. <code className="font-mono text-text-primary">waitForApproval</code> unblocks the agent within about a second regardless of which surface resolved the action.
          </p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Mobile PWA</div>
              <h3 className="text-sm font-semibold text-text-primary mb-2"><code className="font-mono">/approve</code></h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">
                Phone-first approval surface. Add to your home screen and incoming approvals appear with the triggering policy, risk score, and one-tap Allow / Deny.
              </p>
              <pre className="overflow-x-auto rounded-xl border border-border bg-surface-primary p-3 text-xs leading-relaxed text-text-secondary font-mono">{`https://<your-instance>/approve`}</pre>
            </div>
            <div className="rounded-2xl border border-border bg-surface-secondary p-5">
              <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2 font-mono">Telegram bot (optional)</div>
              <h3 className="text-sm font-semibold text-text-primary mb-2">Inline Approve / Reject</h3>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">
                Pending actions push to an admin chat with inline buttons. If Telegram is unreachable, DashClaw warn-logs and approvals stay available via the other surfaces; it is purely additive.
              </p>
              <pre className="overflow-x-auto rounded-xl border border-border bg-surface-primary p-3 text-xs leading-relaxed text-text-secondary font-mono">{`dashclaw install telegram`}</pre>
            </div>
          </div>

          <p className="mt-3 text-[11px] text-text-tertiary">
            Dashboard (<code className="font-mono text-text-secondary">/approvals</code>) and CLI (<code className="font-mono text-text-secondary">dashclaw approve</code>) are always on. Mobile PWA ships by default; Telegram is opt-in via <code className="font-mono text-text-secondary">TELEGRAM_BOT_TOKEN</code>.
          </p>
        </div>
      </section>

      {/* What you just deployed */}
      <section className="pb-20 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto py-12">
          <h2 className="text-2xl font-bold tracking-tight mb-2">What you just deployed</h2>
          <p className="text-text-secondary mb-8">
            Your DashClaw instance ships with the full governance API surface. Every feature works out of the box -- no LLM API key required.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                category: 'Governance',
                features: [
                  'Decision audit trail with full action traces',
                  'Behavior guard -- no-code policy decisions (mechanically enforced on hook and capability surfaces)',
                  'Human-in-the-loop approval gates with expiry (a lapsed approval can never release work)',
                  'Preflight plan authorization -- an agent submits its plan, you review one card with per-step verdicts, approved steps become single-use act-bound grants',
                  'Plan deviation events -- every governed action is diffed against the live approved plan; departures (substituted payloads, scope escapes, off-plan actions) are always recorded, and consequence is your explicit per-kind policy choice',
                  'Scoped delegation constraints -- cap a spawned subagent\'s risk, action types, paths, and depth; attenuation only tightens',
                  'Role constraints -- a named authority bundle per agent role (allowed action types, risk ceiling, path scope); anything outside the role escalates to your inbox',
                  'Containment verdicts -- a file-scoped edit can proceed reversibly instead of freezing: staged in an isolated worktree, you promote or discard the diff on your own time',
                  'Approval flood guard with bulk resolution',
                  'Plain-English approvals -- every pending item leads with one sentence for what the command actually does, flags what cannot be undone, and shows the exact command underneath',
                  'One judgment queue on /policies -- tuning, tightening, loosening, and calibration proposals with ratify/dismiss/undo in one click',
                  'Calibrated interruption controller on /calibration -- set a target false-interruption rate, hold it with a distribution-free bound (shadow first, tighten-only when active)',
                  'External decision provider -- plug one outside decision engine into the guard; its verdict joins stricter-wins (its deny is absolute, its allow never loosens), with an explicit fail-closed posture when it is unreachable',
                  'Guard degradation observability (deadline fallbacks surfaced, never silent)',
                  'Prompt injection scanning',
                ],
              },
              {
                category: 'Observability',
                features: [
                  'Real-time SSE event stream',
                  'Token usage and per-action cost recorded on every decision',
                  'Risk signal monitoring (autonomy spikes, repeated failures, assumption drift, stale actions)',
                  'Coverage truth -- record-vs-recorded tool-use coverage with an explicit "no evidence" state, plus close_source outcome provenance',
                  'Fleet attribution -- multi-agent fan-outs joined from persisted lineage evidence',
                  'Risk composition ledger -- every guard score itemized (risk_breakdown)',
                  'Session retros -- evidence-based end-of-session defensibility review',
                ],
              },
              {
                category: 'Audit & Evidence',
                features: [
                  'Signed, replayable audit trail (Ed25519 receipts, JWKS export)',
                  'Evidence packaging (guard decisions + action records)',
                  'Tamper-evident proof of what was blocked, approved, and by whom',
                ],
              },
              {
                category: 'Security',
                features: [
                  'Verified agent identity (JWKS / JWT verification)',
                  'Per-harness composed identities (parent:sub) with fleet grouping',
                  'agent_defense rollup -- the agent\'s advocate on every action detail',
                  'Automatic secret redaction',
                  'Assumption tracking with one-click invalidation and drift reports',
                  'Content scanning for sensitive data',
                ],
              },
              {
                category: 'Platform',
                features: [
                  'Multi-tenant org isolation',
                  'HMAC-signed webhooks',
                  'Full activity audit log',
                  'Docker + Vercel + any Node.js host',
                ],
              },
            ].map((group) => (
              <div key={group.category} className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-hover transition-colors">
                <h3 className="text-sm font-semibold text-text-primary mb-2">{group.category}</h3>
                <ul className="space-y-1">
                  {group.features.map((f) => (
                    <li key={f} className="text-xs text-text-secondary flex items-start gap-2 leading-relaxed">
                      <span className="text-text-tertiary mt-[5px] shrink-0 w-1 h-1 rounded-full bg-text-tertiary" aria-hidden="true" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-sm text-text-tertiary mt-6">
            All features are free, self-hosted, and work without any external AI provider.
            The governance core (guard, policies, approvals, and action recording) is pure
            runtime logic with no LLM dependency.
          </p>
        </div>

        {/* Divider */}
        <div className="max-w-5xl mx-auto relative py-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border"></div>
          </div>
          <div className="relative flex justify-center">
            <span className="bg-surface-primary px-4 text-sm text-text-tertiary">Alternative: Local Setup</span>
          </div>
        </div>

        <div className="max-w-5xl mx-auto rounded-xl bg-surface-primary border border-border p-5">
          <div className="flex items-center gap-2 mb-3">
            <Server size={18} className="text-text-secondary" />
            <h3 className="text-base font-semibold text-text-primary">Run locally with Docker</h3>
          </div>
          <p className="text-sm text-text-secondary mb-4 leading-relaxed">
            The installer generates secrets, writes .env.local, installs dependencies, and prints the API key your agents should use.
          </p>
          <div className="mb-4">
            <Suspense fallback={null}>
              <CopyMarkdownButton
                href="/api/prompts/server-setup/raw"
                label="Copy Server Setup Prompt"
                rawLabel="View prompt"
              />
            </Suspense>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CopyableCodeBlock title="Windows (PowerShell)">{`./install-windows.bat`}</CopyableCodeBlock>
            <CopyableCodeBlock title="Mac / Linux (bash)">{`bash ./install-mac.sh`}</CopyableCodeBlock>
          </div>
          <p className="mt-3 text-xs text-text-tertiary">
            When it finishes, open <span className="font-mono text-text-primary">http://localhost:3000</span>.
          </p>
        </div>

        {/* Verified agents */}
        <div className="max-w-5xl mx-auto mt-5 rounded-xl bg-surface-secondary border border-border p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-subtle flex items-center justify-center shrink-0">
              <Shield size={18} className="text-brand" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-6 h-6 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center">6</span>
                <h2 className="text-base font-semibold text-text-primary">Optional: enable verified agents</h2>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed">For cryptographic identity binding, set <code className="font-mono text-text-primary">ENFORCE_AGENT_SIGNATURES=true</code> on the dashboard host. The Python SDK&apos;s <code className="font-mono text-text-primary">create_pairing_from_private_jwk()</code> helper generates a keypair and registers the public key via <code className="font-mono text-text-primary">POST /api/pairings</code>; an admin then approves the pairing in the dashboard before the agent&apos;s signed actions are accepted.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Framework Integration Guides */}
      <section className="pb-12 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold tracking-tight mb-2">Connect your agent framework</h2>
          <p className="text-text-secondary mb-6">Step-by-step guides for popular agent frameworks. Each takes under 20 minutes.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Link href="/guides/claude-code" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">Claude Code</h3>
              <p className="text-xs text-text-secondary mt-1">Hook-based governance</p>
            </Link>
            <Link href="/guides/codex" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">Codex</h3>
              <p className="text-xs text-text-secondary mt-1">dashclaw install codex</p>
            </Link>
            <Link href="/guides/hermes" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">Hermes Agent</h3>
              <p className="text-xs text-text-secondary mt-1">8 lifecycle hooks + live ingest</p>
            </Link>
            <Link href="/docs#mcp-config" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">Claude Desktop</h3>
              <p className="text-xs text-text-secondary mt-1">OAuth connector, no install</p>
            </Link>
            <Link href="/guides/openai-agents-sdk" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">OpenAI Agents SDK</h3>
              <p className="text-xs text-text-secondary mt-1">Node.js SDK integration</p>
            </Link>
            <Link href="/guides/langgraph" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">LangGraph</h3>
              <p className="text-xs text-text-secondary mt-1">Python governance node</p>
            </Link>
            <Link href="/guides/crewai" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">CrewAI</h3>
              <p className="text-xs text-text-secondary mt-1">@tool decorator pattern</p>
            </Link>
            <Link href="/guides/openclaw" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">OpenClaw</h3>
              <p className="text-xs text-text-secondary mt-1">Framework-native plugin</p>
            </Link>
            <Link href="/guides/autogen" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">AutoGen</h3>
              <p className="text-xs text-text-secondary mt-1">Governed tool calls</p>
            </Link>
            <Link href="/guides/pydantic-ai" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">Pydantic AI</h3>
              <p className="text-xs text-text-secondary mt-1">Governed agent tools</p>
            </Link>
            <Link href="/guides/vercel-ai-sdk" className="p-4 rounded-xl bg-surface-secondary border border-border hover:border-border-active transition-colors">
              <h3 className="text-sm font-semibold text-text-primary">Vercel AI SDK</h3>
              <p className="text-xs text-text-secondary mt-1">Governed execute wrapper</p>
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
