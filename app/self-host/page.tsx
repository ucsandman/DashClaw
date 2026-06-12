import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronRight, Terminal, ArrowRight, Shield, Server, Cloud, Download, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import CopyMarkdownButton from '../components/CopyMarkdownButton';
import CopyableCodeBlock from '../components/CopyableCodeBlock';
import MarketingPageView from '../components/MarketingPageView';
import SetupTabs from './SetupTabs';

export const metadata: Metadata = {
  title: 'Get Started with DashClaw',
  description: 'Deploy your own DashClaw dashboard for free with Vercel + Neon, or run locally with Docker.',
};

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
            <a
              href="/downloads/dashclaw-platform-intelligence.zip"
              download
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover transition-colors"
            >
              <Download size={16} /> Download Skill
            </a>
            <Link href="/connect" className="inline-flex items-center gap-2 rounded-lg bg-surface-secondary border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface-tertiary hover:text-text-primary hover:border-border-hover transition-colors">
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
            Doctor diagnoses database, configuration, auth, deployment, SDK reachability, governance staleness, data hygiene, and shape drift. It reports by default; pass --fix to apply safe repairs. Run it as the first thing after your instance comes up.
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
              <pre className="overflow-x-auto rounded-xl border border-border bg-surface-primary p-3 text-xs leading-relaxed text-text-secondary font-mono">{`npm run telegram:setup`}</pre>
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
                  'Behavior guard -- no-code policy enforcement',
                  'Human-in-the-loop approval gates',
                  'Approval flood guard with bulk resolution',
                  'Prompt injection scanning',
                ],
              },
              {
                category: 'Quality & Evaluation',
                features: [
                  '5 scorer types (regex, keywords, range, custom, LLM judge)',
                  'Batch evaluation runs across outputs',
                  'Output quality tracking over time',
                  'Action-linked scoring for root-cause analysis',
                ],
              },
              {
                category: 'Scoring Profiles',
                features: [
                  'User-defined weighted quality dimensions with custom scales',
                  '3 composite methods (weighted avg, minimum, geometric mean)',
                  'Risk templates replace hardcoded agent risk numbers',
                  'Auto-calibration from real data (percentile analysis)',
                ],
              },
              {
                category: 'Prompt Management',
                features: [
                  'Version-controlled prompt templates',
                  'Mustache variable rendering (server-side, no LLM)',
                  'One-click rollback to any version',
                  'Usage analytics per template',
                ],
              },
              {
                category: 'Observability',
                features: [
                  'Real-time SSE event stream',
                  'Token usage and cost tracking',
                  'Risk signal monitoring (18 signal types)',
                  'Daily fleet digest through Slack/Discord/email adapters',
                  'Behavioral drift detection with z-score alerts',
                ],
              },
              {
                category: 'Compliance & Audit',
                features: [
                  'GDPR, SOC 2, NIST AI RMF, ISO 27001, IMDA Agentic mapping',
                  'One-click compliance export bundles',
                  'Evidence packaging (guard decisions + action records)',
                  'Scheduled recurring exports on cron',
                ],
              },
              {
                category: 'Learning & Feedback',
                features: [
                  'Learning velocity -- rate of agent improvement',
                  '6-level agent maturity model (Novice to Master)',
                  'Per-skill learning curves',
                  'User feedback with auto-sentiment and auto-tagging',
                ],
              },
              {
                category: 'Agent Operations',
                features: [
                  'Session handoffs with context preservation',
                  'Inter-agent messaging and broadcasts',
                  'Task routing with agent health monitoring',
                  'Memory health scanning and stale fact detection',
                ],
              },
              {
                category: 'Work Orders',
                features: [
                  'Typed task contracts validated on submit and complete',
                  'Budget ceilings and timeouts enforced per order',
                  'Atomic claim leases for external workers',
                  'Self-verifying SHA-256 receipts with the governance trail',
                ],
              },
              {
                category: 'Security',
                features: [
                  'Verified agent identity (JWKS / JWT verification)',
                  'Automatic secret redaction',
                  'Assumption tracking and drift reports',
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
            The only optional LLM feature is the <code>llm_judge</code> scorer type in the Evaluation Framework.
          </p>
        </div>

        {/* DashClaw Platform Skill */}
        <div className="max-w-5xl mx-auto rounded-2xl bg-gradient-to-b from-[rgba(249,115,22,0.06)] to-transparent p-6 sm:p-8 border border-brand-subtle">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center shrink-0">
              <Sparkles size={20} className="text-brand" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">DashClaw Platform Skill</h2>
              <p className="text-sm text-text-secondary leading-relaxed mt-1">
                Skills are an open standard for giving agents specialized capabilities. Any agent that supports the skill framework can load this skill and become a DashClaw platform expert -- with searchable knowledge of every route, env var, and schema field in your instance.
              </p>
              <p className="text-sm text-text-secondary leading-relaxed mt-2">
                Works with Claude Code, and the growing ecosystem of skill-compatible agents.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            <div className="rounded-lg bg-surface-primary border border-border p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-2">What it does</h3>
              <ul className="text-sm text-text-secondary space-y-1.5">
                <li>Instruments any agent with DashClaw SDKs (Node.js or Python)</li>
                <li>Designs guard policies for cost ceilings, risk thresholds, and action allowlists</li>
                <li>Configures evaluation scorers to track output quality (5 built-in types)</li>
                <li>Sets up prompt template registries with version control and rollback</li>
                <li>Generates compliance export bundles for GDPR, SOC 2, NIST AI RMF, ISO 27001, IMDA Agentic</li>
                <li>Configures behavioral drift detection with statistical baselines</li>
                <li>Sets up learning analytics to track agent velocity and maturity</li>
                <li>Troubleshoots 401, 403, 429, and 503 errors with guided diagnostics</li>
              </ul>
            </div>
            <div className="rounded-lg bg-surface-primary border border-border p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-2">What&apos;s inside</h3>
              <pre className="text-xs text-text-secondary font-mono overflow-x-auto leading-relaxed">
{`dashclaw-platform-intelligence/
├── SKILL.md                          # Auto-generated shape snapshot
├── scripts/
│   ├── validate-integration.mjs      # End-to-end connectivity test
│   ├── diagnose.mjs                  # Diagnostic info collector
│   └── bootstrap-agent-quick.mjs     # Agent workspace importer
└── references/
    ├── api-surface.md                # Curated route catalog by domain
    ├── platform-knowledge.md         # Architecture, auth chain, ID prefixes
    └── troubleshooting.md            # 401/403/429/503 resolution guide`}</pre>
            </div>
          </div>

          <p className="text-xs text-text-secondary mb-6 leading-relaxed">
            <code className="font-mono text-text-primary">SKILL.md</code> is regenerated from the live shape, so the agent always has the current API surface. When the snapshot might be stale, the skill instructs the agent to run a live query (<code className="font-mono text-text-primary">python -m livingcode query routes</code>, <code className="font-mono text-text-primary">env</code>, <code className="font-mono text-text-primary">tables</code>) against your instance and trust that result.
          </p>

          <div className="rounded-lg bg-surface-primary border border-border p-4 mb-5">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Setup</h3>
            <ol className="list-decimal list-inside text-sm text-text-secondary space-y-2">
              <li>Download and extract the zip into your project&apos;s skills directory (e.g. <code className="text-text-primary font-mono text-xs">.claude/skills/</code> for Claude Code)</li>
              <li>Point your agent at the skill directory -- it activates automatically</li>
              <li>Ask your agent anything DashClaw-related and it routes to the right workflow</li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/downloads/dashclaw-platform-intelligence.zip"
              download
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors"
            >
              <Download size={16} /> Download Skill
            </a>
          </div>
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
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
