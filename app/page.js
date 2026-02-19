import Link from 'next/link';
import {
  Zap, ShieldAlert, Shield, CircleDot, Eye, ArrowRight, Github,
  ExternalLink, BookOpen, FolderKanban, MessageSquare, ArrowLeftRight,
  Brain, ScanSearch, HeartPulse, Newspaper, Package, UsersRound,
  Webhook, Clock, Compass, Building2, Terminal, BarChart3,
  Scale, Network, FileCheck, Download, SlidersHorizontal, Radio,
} from 'lucide-react';
import PublicNavbar from './components/PublicNavbar';
import PublicFooter from './components/PublicFooter';
import HeroScreenshot from './components/HeroScreenshot';

/* ─── data ─── */

const coreFeatures = [
  {
    icon: Zap,
    title: 'Prove Every Decision Your Agents Make',
    description: 'Every action recorded with reasoning, assumptions, and policy compliance. A live decision ledger streams everything so you can prove why any agent acted.',
  },
  {
    icon: Shield,
    title: 'Enforce Policies Before Agents Act',
    description: 'Semantic guard policies intercept intent before execution. Natural language rules evaluated in real time. No hard-coded checks to maintain.',
  },
  {
    icon: BarChart3,
    title: 'Attribute Every Dollar to a Decision',
    description: 'Cost-per-decision and burn rate by goal in real time. Financial accountability for every autonomous operation.',
  },
  {
    icon: ShieldAlert,
    title: 'Human-in-the-Loop Decision Gates',
    description: 'Approval workflows pause risky decisions for human review. Agents request permission, not forgiveness.',
  },
  {
    icon: FileCheck,
    title: 'Built-in Evaluation Framework',
    description: '5 built-in scorer types (regex, keywords, numeric range, custom, optional LLM judge) to track output quality automatically.',
  },
  {
    icon: Zap,
    title: 'Learning Velocity & Maturity',
    description: 'Track how fast your agents are improving. 6-level maturity model from Novice to Master based on real performance data.',
  },
];

const platformFeatures = [
  { icon: Package, title: 'Drop-In SDKs', description: 'Connect any agent in minutes. Zero-dependency Node.js and Python clients with native adapters for OpenClaw, CrewAI, AutoGen, and LangChain.' },
  { icon: Newspaper, title: 'Prompt Registry', description: 'Version-controlled prompt templates with mustache variables and instant rollback. Stop hardcoding prompts in your agent code.' },
  { icon: MessageSquare, title: 'User Feedback Loop', description: 'Collect structured ratings with auto-sentiment detection and 6-category auto-tagging. Close the loop between users and agents.' },
  { icon: Radio, title: 'Behavioral Drift Detection', description: 'Statistical baselines and z-score alerts catch when agent behavior deviates from the norm. Detect logic drift early.' },
  { icon: Download, title: 'Compliance Export Bundles', description: 'One-click exports for SOC 2, NIST AI RMF, EU AI Act, and ISO 42001. All your governance evidence, packaged.' },
  { icon: SlidersHorizontal, title: 'Scoring Profiles', description: 'User-defined weighted quality scoring with auto-calibration from real data. Risk templates replace hardcoded agent risk numbers with transparent, editable rules.' },
  { icon: Shield, title: 'Verified Agent Identity', description: 'Know which agent took which action. RSA signature verification ensures accountability at every step.' },
  { icon: Brain, title: 'Keep Agent Memory Clean', description: 'Detect stale facts, repetition loops, and context bloat before they cause bad decisions.' },
];

const operationalFeatures = [
  { icon: UsersRound, title: 'Team Management', description: 'Invite your team in seconds. Role-based access keeps operators in control and agents accountable.' },
  { icon: Webhook, title: 'Decision Risk Notifications', description: 'HMAC-signed webhooks and email alerts fire when decision integrity signals breach thresholds. No more checking dashboards.' },
  { icon: Clock, title: 'Full Audit Trail', description: 'Every action is logged with actor, timestamp, and reasoning: ready for compliance audits and debugging.' },
  { icon: Compass, title: 'Ship in 10 Minutes', description: 'Four steps: create workspace, generate key, install SDK, send first action. That\'s it.' },
  { icon: Building2, title: 'Built for Multi-Tenant', description: 'Full org isolation out of the box. Each team gets their own agents, keys, and settings.' },
  { icon: Terminal, title: '30+ CLI Tools', description: 'Run agent ops locally with Python CLI tools. Push results to the dashboard when you\'re ready.' },
];

const signals = [
  { name: 'Autonomy Spike', description: 'Agent taking too many actions without human checkpoints' },
  { name: 'High Impact, Low Oversight', description: 'Critical actions without sufficient review' },
  { name: 'Repeated Failures', description: 'Same action type failing multiple times' },
  { name: 'Stale Loop', description: 'Open loops unresolved past their expected timeline' },
  { name: 'Assumption Drift', description: 'Assumptions becoming stale or contradicted by outcomes' },
  { name: 'Stale Assumption', description: 'Assumptions not validated within expected timeframe' },
  { name: 'Stale Running Action', description: 'Actions stuck in running state for over 4 hours' },
];

const agentToolCategories = [
  { title: 'Learning & Decisions', desc: 'Log decisions, lessons, and outcomes. Track what worked and why.', example: 'learner.py log "Used JWT" --push' },
  { title: 'Context & Handoffs', desc: 'Key points, threads, and session continuity documents.', example: 'context.py capture "Dark theme" --push' },
  { title: 'Memory & Health', desc: 'Scan memory files, track entities, detect stale facts.', example: 'scanner.py scan ~/.agent/memory --push' },
  { title: 'Goals & Relationships', desc: 'Goal milestones, contacts, interactions, and follow-ups.', example: 'goals.py add "Ship auth" --push' },
  { title: 'Security & Audit', desc: 'Outbound content filtering, session isolation, audit logging.', example: 'outbound_filter.py scan message.txt --push' },
  { title: 'Automation & Snippets', desc: 'Reusable code snippets with search, tags, and use tracking.', example: 'snippets.py add "retry logic" --push' },
];

const platformCoverage = [
  {
    icon: FolderKanban,
    title: 'Control Plane + Dashboard',
    description: 'Onboarding, team roles, approval queue, risk signals, live action views, and platform health cards.',
  },
  {
    icon: MessageSquare,
    title: 'API + Data Layer',
    description: 'Typed repository boundaries, route contract governance, maturity labels, and OpenAPI drift checks.',
  },
  {
    icon: Zap,
    title: 'Realtime Runtime',
    description: 'Broker-backed SSE fanout, reconnect with Last-Event-ID replay, and cutover health controls.',
  },
  {
    icon: Package,
    title: 'SDK + Tooling',
    description: 'Node and Python SDKs, CLI toolkit, parity test suites, and docs/CI governance.',
  },
];

const shippedHighlights = [
  {
    icon: Brain,
    title: 'Agents That Learn From Their Mistakes',
    description: 'Every completed action is scored and turned into recommendations. Your agents get better without manual retraining.',
    href: '/learning',
  },
  {
    icon: Shield,
    title: 'Data Layer You Can Trust',
    description: 'SQL drift checks and contract tests run in CI. No silent regressions reach production.',
    href: '/docs',
  },
  {
    icon: MessageSquare,
    title: 'APIs That Never Break Silently',
    description: 'OpenAPI drift checks catch contract changes before they ship. Your integrations stay stable.',
    href: '/docs',
  },
  {
    icon: Package,
    title: 'SDKs That Stay in Sync',
    description: 'Node and Python SDKs are tested against the same contract fixtures. Feature parity is enforced, not hoped for.',
    href: '/docs',
  },
  {
    icon: Clock,
    title: 'Always-Fresh Recommendations',
    description: 'Automated background jobs keep learning data current. No manual cron jobs to manage.',
    href: '/learning',
  },
  {
    icon: Scale,
    title: 'Compliance Without the Spreadsheets',
    description: 'Map your guardrails to SOC 2, ISO 27001, GDPR, and NIST AI RMF automatically. Generate audit-ready reports in one click.',
    href: '/docs#compliance-engine',
  },
  {
    icon: Network,
    title: 'The Right Agent for Every Task',
    description: 'Tasks automatically route to the best-fit agent based on skills, load, and track record. Failed tasks retry and escalate.',
    href: '/docs#task-routing',
  },
];

/* ─── page ─── */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* ── 1. Navbar ── */}
      <PublicNavbar />

      {/* ── 2. Hero ── */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(249,115,22,0.3)] bg-[rgba(249,115,22,0.08)] text-brand text-xs font-medium mb-6">
            <ShieldAlert size={14} />
            Agent Decision Infrastructure
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            Prove what your AI agents decided{' '}
            <span className="text-brand">and why</span>.
          </h1>
          <p className="mt-6 text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            Your agents are making decisions right now. Can you prove what they decided,
            what they assumed, and whether they followed policy? Guard what they do before they do it.
          </p>
          <div className="mt-4 flex items-center justify-center gap-6 text-sm text-zinc-500 font-medium">
            <span className="flex items-center gap-1.5"><Zap size={14} className="text-brand" /> 177+ SDK methods</span>
            <span className="flex items-center gap-1.5"><BookOpen size={14} className="text-brand" /> 29 categories</span>
          </div>
          <p className="mt-3 text-sm text-zinc-500">Open-source. Self-hosted. Built for teams shipping AI agents to production.</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Policy guard</span>
            <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Decision audit trail</span>
            <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Risk signals</span>
            <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Compliance mapping</span>
            <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Assumption tracking</span>
            <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Human-in-the-loop</span>
          </div>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/dashboard" className="px-6 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors inline-flex items-center gap-2">
              Dashboard <ArrowRight size={16} />
            </Link>
            <Link href="/self-host" className="px-6 py-2.5 rounded-lg bg-[#1a1a1a] border border-[rgba(255,255,255,0.1)] text-zinc-300 text-sm font-medium hover:bg-[#222] hover:text-white transition-colors inline-flex items-center gap-2">
              <Terminal size={16} /> Get Started
            </Link>
          </div>
        </div>
      </section>

      {/* ── 2.5 Dashboard Preview ── */}
      <section className="pb-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-6xl mx-auto pt-16">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-center">
            <div className="lg:col-span-2">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">A dashboard you will actually use</h2>
              <p className="mt-3 text-zinc-400 leading-relaxed">
                One screen for actions, risk, approvals, messages, and fleet context. Click the screenshot to view fullscreen.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Realtime</span>
                <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">HITL approvals</span>
                <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Guard policies</span>
                <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[#111] px-3 py-1 text-zinc-300">Swarm map</span>
              </div>
            </div>
            <div className="lg:col-span-3">
              <HeroScreenshot
                src="/images/screenshots/Mission Control.png"
                alt="DashClaw Mission Control - strategic overview of your agent fleet"
                className="shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)]"
              />
              <div className="mt-3 text-right">
                <Link href="/gallery" className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
                  View full gallery →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. How It Works ── */}
      <section className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Secure your first agent in 5 minutes</h2>
            <p className="mt-3 text-zinc-400">Four steps from install to full decision governance.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { step: '1', title: 'Instrument in 60 seconds', code: 'npm install dashclaw\n# or\npip install dashclaw', desc: 'Zero dependencies. Works with Node.js and Python agents.' },
              { step: '2', title: 'Guard before you act', code: "const decision = await dc.guard({\n  actionType: 'deploy',\n  riskScore: 85,\n});", desc: 'Intervene with real-time policy checks.' },
              { step: '3', title: 'Score with your own quality bar', code: "// Define what \"good\" means for your use case\nawait dc.createScoringProfile({\n  name: 'deploy-quality',\n  action_type: 'deploy',\n  dimensions: [\n    { name: 'Speed', weight: 0.3, data_source: 'duration_ms',\n      scale: [\n        { label: 'excellent', operator: 'lt', value: 30000, score: 100 },\n        { label: 'poor', operator: 'gte', value: 120000, score: 20 },\n      ]},\n    { name: 'Reliability', weight: 0.4, data_source: 'confidence',\n      scale: [\n        { label: 'excellent', operator: 'gte', value: 0.9, score: 100 },\n        { label: 'poor', operator: 'lt', value: 0.7, score: 25 },\n      ]},\n  ],\n});\n\n// Or let DashClaw suggest thresholds from your real data\nconst suggestions = await dc.autoCalibrate({ lookback_days: 30 });", desc: 'Custom weighted quality scoring with auto-calibration.' },
              { step: '4', title: 'Record and Learn', code: "with claw.track(action='deploy'):\n  # ... decisions stream to\n  # dashboard in real-time", desc: 'Decisions, policy checks, and signals stream in real-time.' },
            ].map((item) => (
              <div key={item.step} className="p-5 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)]">
                <span className="w-7 h-7 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center mb-3">{item.step}</span>
                <h3 className="text-base font-semibold text-white mb-2">{item.title}</h3>
                <pre className="bg-[#0a0a0a] rounded-lg px-3 py-2.5 text-xs text-zinc-300 font-mono overflow-x-auto mb-3 whitespace-pre-wrap">{item.code}</pre>
                <p className="text-sm text-zinc-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. Features Grid ── */}
      <section id="features" className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Everything you need to trust your agents</h2>
            <p className="mt-3 text-zinc-400 max-w-xl mx-auto">Built for teams running autonomous AI agents in production.</p>
          </div>

          {/* Core features: 2 col, larger */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            {coreFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="p-6 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center mb-4">
                    <Icon size={20} className="text-brand" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>

          {/* Platform features: 4 col, smaller */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {platformFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="p-4 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center mb-3">
                    <Icon size={16} className="text-brand" />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-1">{feature.title}</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 4.5 What Makes DashClaw Different ── */}
      <section className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">What makes DashClaw different?</h2>
            <p className="mt-3 text-zinc-400">Governance that doesn&apos;t slow you down.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)]">
              <h3 className="text-lg font-semibold text-white">No-Code Policy Engine</h3>
              <p className="text-sm text-zinc-400 mt-2">
                Define guardrails in natural language and enforce them across all agents instantly.
                No hardcoded checks or messy conditional logic.
              </p>
            </div>
            <div className="p-6 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)]">
              <h3 className="text-lg font-semibold text-white">Learning Velocity</h3>
              <p className="text-sm text-zinc-400 mt-2">
                DashClaw doesn&apos;t just log actions; it tracks how fast your agents are improving
                and where they&apos;re still struggling.
              </p>
            </div>
            <div className="p-6 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)]">
              <h3 className="text-lg font-semibold text-white">Financial Attribution</h3>
              <p className="text-sm text-zinc-400 mt-2">
                Every dollar spent on tokens is attributed to a specific decision and goal.
                Know exactly what your AI budget is buying.
              </p>
            </div>
            <div className="p-6 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)]">
              <h3 className="text-lg font-semibold text-white">Operator-Defined Quality</h3>
              <p className="text-sm text-zinc-400 mt-2">
                You define what &quot;good&quot; means. Weighted multi-dimensional scoring with auto-calibration
                from your real data. Risk templates replace guesswork with transparent rules.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. SDK Showcase ── */}
      <section className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Complete platform scope</h2>
            <p className="mt-3 text-zinc-400 max-w-2xl mx-auto">
              DashClaw is more than a dashboard. It is a full platform spanning control plane UX, APIs, data contracts,
              realtime transport, SDKs, and CI governance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
            {platformCoverage.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111] p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(249,115,22,0.1)]">
                      <Icon size={18} className="text-brand" />
                    </div>
                    <h3 className="text-base font-semibold text-zinc-100">{item.title}</h3>
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-400">{item.description}</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[#111] p-5">
            <h3 className="text-base font-semibold text-zinc-100 mb-3">Production hardening shipped</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              {shippedHighlights.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.title} href={item.href} className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#0d0d0d] p-3 hover:border-[rgba(255,255,255,0.14)] transition-colors">
                    <div className="mb-1.5 flex items-center gap-2">
                      <Icon size={14} className="text-brand" />
                      <p className="text-sm font-medium text-zinc-200">{item.title}</p>
                    </div>
                    <p className="text-xs leading-relaxed text-zinc-400">{item.description}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-brand">
                      Explore <ArrowRight size={11} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

        </div>
      </section>

      {/* ── AI Governance Suite Showcase ── */}
      <section className="py-20 px-6 border-t border-[rgba(249,115,22,0.15)]">
        <div className="max-w-6xl mx-auto">
          <div className="rounded-2xl bg-gradient-to-b from-[rgba(249,115,22,0.06)] to-transparent p-8 sm:p-12 border border-[rgba(249,115,22,0.12)]">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(249,115,22,0.3)] bg-[rgba(249,115,22,0.08)] text-brand text-xs font-medium mb-4">
                <Shield size={12} />
                AI Governance Suite
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">The only agent platform with built-in compliance</h2>
              <p className="mt-3 text-zinc-400 max-w-2xl mx-auto leading-relaxed">
                Most platforms stop at logging. DashClaw ships decision enforcement,
                regulatory compliance mapping, and intelligent task routing. All auditable,
                all testable, all live in the demo.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
              {/* Card 1: Compliance Engine */}
              <div className="p-6 rounded-xl bg-[#111]/80 border border-[rgba(255,255,255,0.06)]">
                <div className="w-10 h-10 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center mb-4">
                  <Scale size={20} className="text-brand" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-3">Compliance Engine</h3>
                <ul className="space-y-2 text-sm text-zinc-400 mb-4">
                  <li>SOC 2, ISO 27001, GDPR, NIST AI RMF, EU AI Act</li>
                  <li>Control-level gap analysis with remediation priorities</li>
                  <li>Audit-ready reports in Markdown or JSON</li>
                  <li>Live enforcement evidence from guard decisions</li>
                </ul>
                <Link href="/demo" className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors">
                  Explore Compliance <ArrowRight size={14} />
                </Link>
              </div>

              {/* Card 2: Policy Testing & Proof */}
              <div className="p-6 rounded-xl bg-[#111]/80 border border-[rgba(255,255,255,0.06)]">
                <div className="w-10 h-10 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center mb-4">
                  <FileCheck size={20} className="text-brand" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-3">Policy Testing &amp; Proof</h3>
                <ul className="space-y-2 text-sm text-zinc-400 mb-4">
                  <li>Run tests against all active guard policies</li>
                  <li>Per-policy pass/fail breakdown with diagnostics</li>
                  <li>Generate compliance proof reports on demand</li>
                  <li>Import pre-built policy packs (enterprise, SMB, startup)</li>
                </ul>
                <Link href="/demo" className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors">
                  Explore Policy Testing <ArrowRight size={14} />
                </Link>
              </div>

              {/* Card 3: Intelligent Task Routing */}
              <div className="p-6 rounded-xl bg-[#111]/80 border border-[rgba(255,255,255,0.06)]">
                <div className="w-10 h-10 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center mb-4">
                  <Network size={20} className="text-brand" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-3">Intelligent Task Routing</h3>
                <ul className="space-y-2 text-sm text-zinc-400 mb-4">
                  <li>Skill-based agent matching with scoring</li>
                  <li>Real-time load balancing and health verification</li>
                  <li>Urgency-aware queue with retry and escalation</li>
                  <li>Full agent registry with capability tracking</li>
                </ul>
                <Link href="/demo" className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors">
                  Explore Task Routing <ArrowRight size={14} />
                </Link>
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm text-zinc-400 mb-4">Every feature works in the demo. No signup required.</p>
              <Link href="/demo" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors">
                Launch Demo <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="sdk" className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(249,115,22,0.08)] border border-[rgba(249,115,22,0.2)] text-brand text-xs font-medium mb-4">
                <Package size={12} />
                177+ methods across 29 categories
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">One SDK. Full decision governance.</h2>
              <p className="mt-3 text-zinc-400 leading-relaxed">
                Install from npm or pip. Zero dependencies. Native adapters for <span className="text-zinc-200 font-semibold">OpenClaw</span>, <span className="text-zinc-200 font-semibold">CrewAI</span>, <span className="text-zinc-200 font-semibold">AutoGen</span>, and <span className="text-zinc-200 font-semibold">LangChain</span>.
                Decision recording, policy enforcement, assumption tracking, handoffs, messaging, and more.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <span className="px-3 py-1 rounded-full bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] text-xs text-zinc-300">npm package</span>
                <span className="px-3 py-1 rounded-full bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] text-xs text-zinc-300">Node.js</span>
                <span className="px-3 py-1 rounded-full bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] text-xs text-zinc-300">ESM + CJS</span>
                <span className="px-3 py-1 rounded-full bg-[#1a1a1a] border border-[rgba(255,255,255,0.06)] text-xs text-zinc-300">Zero Dependencies</span>
              </div>
              <Link href="/docs" className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors">
                View full SDK docs <ArrowRight size={14} />
              </Link>
            </div>
            <div className="rounded-xl bg-[#0d0d0d] border border-[rgba(255,255,255,0.06)] p-5 font-mono text-sm overflow-x-auto">
              <div className="text-zinc-500 mb-3">{'// govern your agent'}</div>
              <div>
                <span className="text-purple-400">import</span>
                <span className="text-zinc-300">{' { DashClaw } '}</span>
                <span className="text-purple-400">from</span>
                <span className="text-green-400"> &apos;dashclaw&apos;</span>
              </div>
              <div className="mt-3">
                <span className="text-purple-400">const</span>
                <span className="text-zinc-300"> claw = </span>
                <span className="text-purple-400">new</span>
                <span className="text-yellow-300"> DashClaw</span>
                <span className="text-zinc-300">({'{'}</span>
              </div>
              <div className="text-zinc-300 pl-4">
                apiKey: <span className="text-zinc-300">process.env.</span><span className="text-cyan-300">DASHCLAW_API_KEY</span>,
              </div>
              <div className="text-zinc-300 pl-4">
                agentId: <span className="text-green-400">&apos;my-agent&apos;</span>,
              </div>
              <div className="text-zinc-300">{'})'}</div>

              <div className="mt-4 text-zinc-500">{'// check guard before acting'}</div>
              <div>
                <span className="text-purple-400">const</span>
                <span className="text-zinc-300">{' { decision } = '}</span>
                <span className="text-purple-400">await</span>
                <span className="text-zinc-300"> claw.</span>
                <span className="text-yellow-300">guard</span>
                <span className="text-zinc-300">({'{'}</span>
              </div>
              <div className="text-zinc-300 pl-4">
                action_type: <span className="text-green-400">&apos;deploy&apos;</span>,
              </div>
              <div className="text-zinc-300 pl-4">
                risk_score: <span className="text-cyan-300">85</span>,
              </div>
              <div className="text-zinc-300">{'})'}</div>

              <div className="mt-4 text-zinc-500">{'// record a governed decision'}</div>
              <div>
                <span className="text-purple-400">await</span>
                <span className="text-zinc-300"> claw.</span>
                <span className="text-yellow-300">createAction</span>
                <span className="text-zinc-300">({'{'}</span>
              </div>
              <div className="text-zinc-300 pl-4">
                action_type: <span className="text-green-400">&apos;deploy&apos;</span>,
              </div>
              <div className="text-zinc-300 pl-4">
                declared_goal: <span className="text-green-400">&apos;Ship auth service&apos;</span>,
              </div>
              <div className="text-zinc-300">{'})'}</div>

              <div className="mt-4 text-zinc-500">{'// create a session handoff'}</div>
              <div>
                <span className="text-purple-400">await</span>
                <span className="text-zinc-300"> claw.</span>
                <span className="text-yellow-300">createHandoff</span>
                <span className="text-zinc-300">({'{'}</span>
              </div>
              <div className="text-zinc-300 pl-4">
                summary: <span className="text-green-400">&apos;Completed auth system&apos;</span>,
              </div>
              <div className="text-zinc-300 pl-4">
                key_decisions: [<span className="text-green-400">&apos;JWT over sessions&apos;</span>],
              </div>
              <div className="text-zinc-300">{'})'}</div>

              <div className="mt-4 text-zinc-500">{'// bulk sync agent state'}</div>
              <div>
                <span className="text-purple-400">await</span>
                <span className="text-zinc-300"> claw.</span>
                <span className="text-yellow-300">syncState</span>
                <span className="text-zinc-300">({'{'} goals, learning, snippets {'}'})</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. Signals Showcase ── */}
      <section id="signals" className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">7 Decision Integrity Signals</h2>
            <p className="mt-3 text-zinc-400 max-w-xl mx-auto">Automatic detection of autonomy breaches and logic drift. Zero configuration.</p>
          </div>
          <div className="space-y-3">
            {signals.map((signal, i) => (
              <div key={signal.name} className="flex items-start gap-4 p-4 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)]">
                <div className="w-7 h-7 rounded-lg bg-[rgba(239,68,68,0.1)] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <ShieldAlert size={14} className="text-red-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{signal.name}</h3>
                    <span className="text-[10px] text-zinc-500 font-mono">SIGNAL-{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <p className="text-sm text-zinc-400 mt-0.5">{signal.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. Platform Operations ── */}
      <section className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Production-ready operations</h2>
            <p className="mt-3 text-zinc-400 max-w-xl mx-auto">Team management, audit trails, webhooks, and more. Built in from day one.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {operationalFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="p-5 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center mb-3">
                    <Icon size={18} className="text-brand" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-1.5">{feature.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 8. Agent Tools ── */}
      <section id="agent-tools" className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[rgba(249,115,22,0.08)] border border-[rgba(249,115,22,0.2)] text-brand text-xs font-medium mb-4">
              <Terminal size={12} />
              30+ Python CLI tools
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Local Agent Toolkit</h2>
            <p className="mt-3 text-zinc-400 max-w-xl mx-auto">
              Python CLI tools that run alongside your agent. Local-first with SQLite storage.
              Add <code className="text-zinc-300 font-mono">--push</code> to sync anything to your dashboard.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
            {agentToolCategories.map((cat) => (
              <div key={cat.title} className="p-5 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] transition-colors">
                <h3 className="text-base font-semibold text-white mb-1.5">{cat.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed mb-3">{cat.desc}</p>
                <pre className="bg-[#0a0a0a] rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono overflow-x-auto">{cat.example}</pre>
              </div>
            ))}
          </div>
          <div className="text-center">
            <Link href="/docs#agent-tools" className="inline-flex items-center gap-1.5 text-sm text-brand hover:text-brand-hover transition-colors">
              View full toolkit docs <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* ── 9. Bottom CTA ── */}
      <section className="py-20 px-6 border-t border-[rgba(255,255,255,0.06)]">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Govern your first agent in 5 minutes
          </h2>
          <p className="mt-3 text-zinc-400">
            Install the SDK, enforce your first policy, and see decision signals on the dashboard. Open-source and self-hosted.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/dashboard" className="px-6 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover transition-colors inline-flex items-center gap-2">
              Dashboard <ArrowRight size={16} />
            </Link>
            <Link href="/self-host" className="px-6 py-2.5 rounded-lg bg-[#1a1a1a] border border-[rgba(255,255,255,0.1)] text-zinc-300 text-sm font-medium hover:bg-[#222] hover:text-white transition-colors inline-flex items-center gap-2">
              <Terminal size={16} /> Get Started
            </Link>
          </div>
        </div>
      </section>

      {/* ── 10. Footer ── */}
      <PublicFooter />
    </div>
  );
}
