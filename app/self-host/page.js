import Link from 'next/link';
import { ChevronRight, Terminal, ArrowRight, Shield, KeyRound, Server, Cloud, Database, Github, Download, Sparkles, Zap } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import CopyMarkdownButton from '../components/CopyMarkdownButton';
import CopyableCodeBlock from '../components/CopyableCodeBlock';
import SecretGenerator from '../components/SecretGenerator';

export const metadata = {
  title: 'Get Started with DashClaw',
  description: 'Deploy your own DashClaw dashboard for free with Vercel + Neon, or run locally with Docker.',
};

function StepCard({ n, title, desc, icon: Icon, children }) {
  return (
    <div className="rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)] p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center shrink-0">
          <Icon size={18} className="text-brand" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center">{n}</span>
            <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed">{desc}</p>
        </div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export default function SelfHostPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <PublicNavbar />

      <section className="pt-28 pb-12 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4">
            <Link href="/" className="hover:text-zinc-300 transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-zinc-300">Get Started</span>
          </div>

          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center">
              <Terminal size={20} className="text-brand" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Get started with DashClaw</h1>
              <p className="mt-2 text-zinc-400 max-w-2xl leading-relaxed">
                Deploy free, access from anywhere — including your phone. You own the data.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/demo" className="inline-flex items-center gap-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-[#181818] hover:text-white transition-colors">
              View Live Demo
            </Link>
            <Link href="/docs" className="inline-flex items-center gap-2 rounded-lg bg-[#111] border border-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-[#181818] hover:text-white transition-colors">
              SDK Docs
            </Link>
            <a href="https://github.com/ucsandman/DashClaw" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium hover:bg-brand-hover transition-colors">
              Open Source Repo <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* Two-path intro */}
      <section className="pb-8 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-[#111] border border-brand/30 p-5">
              <div className="flex items-center gap-2 mb-2">
                <Cloud size={18} className="text-brand" />
                <h3 className="text-sm font-semibold text-white">Cloud (recommended)</h3>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Vercel + Neon free tiers. Zero cost, accessible from any device, auto-HTTPS. Takes ~10 minutes.
              </p>
            </div>
            <div className="rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)] p-5">
              <div className="flex items-center gap-2 mb-2">
                <Server size={18} className="text-zinc-400" />
                <h3 className="text-sm font-semibold text-white">Local</h3>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Docker + localhost. Good for development or if you want everything on your machine.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Cloud path */}
      <section className="pb-20 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 gap-5">
          <StepCard
            n="1"
            title="Create a free Neon database"
            desc="Neon gives you a serverless Postgres database on their free tier — no credit card required."
            icon={Database}
          >
            <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1.5 mb-4">
              <li>Sign up at <a href="https://neon.tech" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">neon.tech</a></li>
              <li>Create a new project (any name, e.g. &quot;dashclaw&quot;)</li>
              <li>Copy the connection string — it looks like <code className="text-zinc-300 font-mono text-xs">postgresql://user:pass@ep-xyz.neon.tech/neondb</code></li>
            </ol>
            <p className="text-xs text-zinc-500">
              You&apos;ll paste this as <code className="font-mono text-zinc-300">DATABASE_URL</code> in the next step.
            </p>
          </StepCard>

          <StepCard
            n="2"
            title="Deploy to Vercel"
            desc="Fork the repo and import it into Vercel. Add the environment variables and deploy."
            icon={Cloud}
          >
            <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1.5 mb-4">
              <li>Fork <a href="https://github.com/ucsandman/DashClaw" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">ucsandman/DashClaw</a> to your GitHub account</li>
              <li>Go to <a href="https://vercel.com/new" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">vercel.com/new</a> and import your fork</li>
              <li>Generate your secrets, then paste them into Vercel&apos;s environment variables:</li>
            </ol>
            <SecretGenerator />
            <div className="mt-3 rounded-lg bg-[rgba(249,115,22,0.05)] border border-brand/10 px-4 py-3 text-xs text-zinc-400">
              <strong className="text-zinc-300">About the API key:</strong> <code className="font-mono text-zinc-300">DASHCLAW_API_KEY</code> is your bootstrap admin key — it authenticates agents and seeds your first organization. After you sign in, you can create and manage additional API keys from the dashboard at <code className="font-mono text-zinc-300">/api-keys</code>.
            </div>
            <p className="mt-2 text-xs text-zinc-500">Tables are created automatically on first request.</p>
          </StepCard>

          <StepCard
            n="3"
            title="Set up GitHub OAuth"
            desc="Create a GitHub OAuth app so you can sign in to your dashboard."
            icon={Github}
          >
            <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1.5 mb-4">
              <li>Go to <a href="https://github.com/settings/developers" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">GitHub Developer Settings</a> → OAuth Apps → New OAuth App</li>
              <li>Set <strong className="text-zinc-200">Homepage URL</strong> to <code className="font-mono text-zinc-300 text-xs">https://your-app.vercel.app</code></li>
              <li>Set <strong className="text-zinc-200">Authorization callback URL</strong> to <code className="font-mono text-zinc-300 text-xs">https://your-app.vercel.app/api/auth/callback/github</code></li>
              <li>Copy the Client ID and Client Secret into your Vercel env vars as <code className="font-mono text-zinc-300">GITHUB_ID</code> and <code className="font-mono text-zinc-300">GITHUB_SECRET</code></li>
              <li>Redeploy from the Vercel dashboard</li>
            </ol>
            <p className="text-xs text-zinc-500">
              Replace <code className="font-mono text-zinc-300">your-app.vercel.app</code> with your actual Vercel domain.
            </p>
          </StepCard>

          <StepCard
            n="4"
            title="Enable Live Updates (Redis)"
            desc="Use Upstash Redis to bridge Vercel's serverless functions for real-time dashboard events."
            icon={Zap}
          >
            <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-1.5 mb-4">
              <li>Sign up for a free account at <a href="https://upstash.com" target="_blank" rel="noopener noreferrer" className="text-brand hover:text-brand-hover transition-colors">upstash.com</a></li>
              <li>Create a new Redis database (Global or in the same region as your Vercel app)</li>
              <li>Copy the <strong className="text-zinc-200">REST URL</strong> and <strong className="text-zinc-200">REST Token</strong>, or the raw <strong className="text-zinc-200">Redis URL</strong></li>
              <li>Add these environment variables to Vercel:
                <ul className="list-disc list-inside ml-4 mt-1 text-zinc-500 text-xs font-mono">
                  <li>REALTIME_BACKEND=redis</li>
                  <li>REDIS_URL=redis://default:pass@ep-xyz.upstash.io:6379</li>
                  <li>REALTIME_ENFORCE_REDIS=true</li>
                </ul>
              </li>
              <li>Redeploy your Vercel app to apply the changes</li>
            </ol>
            <p className="text-xs text-zinc-500">
              The 30MB free tier at Upstash is more than enough for DashClaw&apos;s live event buffer.
            </p>
          </StepCard>

          <StepCard
            n="5"
            title="Connect your agents"
            desc="Agents only need a base URL + API key. Once connected, they can record decisions, enforce policies, score outputs, define quality profiles, manage prompts, and track learning -- all through the SDK."
            icon={KeyRound}
          >
            <div className="mb-4">
              <CopyMarkdownButton
                href="/api/prompts/agent-connect/raw"
                label="Copy Agent Connect Prompt"
                rawLabel="View prompt"
              />
            </div>

            <h3 className="text-sm font-semibold text-white mt-6 mb-3">Agent environment</h3>
            <CopyableCodeBlock title="Agent environment" copyText={`DASHCLAW_BASE_URL=https://your-app.vercel.app\nDASHCLAW_API_KEY=<your-secret-api-key>\nDASHCLAW_AGENT_ID=my-agent`}>{`DASHCLAW_BASE_URL=https://your-app.vercel.app
DASHCLAW_API_KEY=<your-secret-api-key>
DASHCLAW_AGENT_ID=my-agent`}</CopyableCodeBlock>
            <p className="text-xs text-zinc-500 mt-2">
              Your Vercel app uses Vercel env vars. Your agent uses its own environment variables.
            </p>

            <h3 className="text-sm font-semibold text-white mt-8 mb-3">Quick integration (Node.js)</h3>
            <CopyableCodeBlock title="agent.js" copyText={`import { DashClaw } from 'dashclaw';\n\nconst dc = new DashClaw({\n  baseUrl: process.env.DASHCLAW_BASE_URL,\n  apiKey: process.env.DASHCLAW_API_KEY,\n  agentId: 'my-agent',\n  guardMode: 'warn',\n});\n\n// Record a decision\nconst action = await dc.createAction({\n  actionType: 'deploy',\n  declaredGoal: 'Ship auth-service v2.1',\n  riskScore: 40,\n});\n\n// Guard check (policy enforcement)\nconst decision = await dc.guard({\n  actionType: 'deploy',\n  content: 'Deploying to production',\n  riskScore: 40,\n});\n\n// Score the output quality\nawait dc.scoreOutput({\n  scorer_id: 'es_your_scorer',\n  output: deployResult,\n  action_id: action.action_id,\n});\n\n// Score against your custom quality profile\nconst profileScore = await dc.scoreWithProfile('sp_your_profile', {\n  duration_ms: deployResult.duration,\n  confidence: deployResult.confidence,\n  action_id: action.action_id,\n});\n\n// Update outcome\nawait dc.updateOutcome(action.action_id, {\n  status: 'completed',\n  outputSummary: 'Deployed successfully',\n});`}>{`import { DashClaw } from 'dashclaw';

const dc = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent',
  guardMode: 'warn',
});

// Record a decision
const action = await dc.createAction({
  actionType: 'deploy',
  declaredGoal: 'Ship auth-service v2.1',
  riskScore: 40,
});

// Guard check (policy enforcement)
const decision = await dc.guard({
  actionType: 'deploy',
  content: 'Deploying to production',
  riskScore: 40,
});

// Score the output quality
await dc.scoreOutput({
  scorer_id: 'es_your_scorer',
  output: deployResult,
  action_id: action.action_id,
});

// Score against your custom quality profile
const profileScore = await dc.scoreWithProfile('sp_your_profile', {
  duration_ms: deployResult.duration,
  confidence: deployResult.confidence,
  action_id: action.action_id,
});

// Update outcome
await dc.updateOutcome(action.action_id, {
  status: 'completed',
  outputSummary: 'Deployed successfully',
});`}</CopyableCodeBlock>

            <h3 className="text-sm font-semibold text-white mt-8 mb-3">Quick integration (Python)</h3>
            <CopyableCodeBlock title="agent.py" copyText={`from dashclaw import DashClaw\n\ndc = DashClaw(\n    base_url=os.environ["DASHCLAW_BASE_URL"],\n    api_key=os.environ["DASHCLAW_API_KEY"],\n    agent_id="my-agent",\n    guard_mode="warn",\n)\n\n# Record a decision\naction = dc.create_action(\n    action_type="deploy",\n    declared_goal="Ship auth-service v2.1",\n    risk_score=40,\n)\n\n# Guard check (policy enforcement)\ndecision = dc.guard(\n    action_type="deploy",\n    content="Deploying to production",\n    risk_score=40,\n)\n\n# Score the output quality\ndc.score_output(\n    scorer_id="es_your_scorer",\n    output=deploy_result,\n    action_id=action["action_id"],\n)\n\n# Score against your custom quality profile\nprofile_score = dc.score_with_profile("sp_your_profile", {\n    "duration_ms": deploy_result["duration"],\n    "confidence": deploy_result["confidence"],\n    "action_id": action["action_id"],\n})\n\n# Update outcome\ndc.update_outcome(action["action_id"],\n    status="completed",\n    output_summary="Deployed successfully",\n)`}>{`from dashclaw import DashClaw

dc = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="my-agent",
    guard_mode="warn",
)

# Record a decision
action = dc.create_action(
    action_type="deploy",
    declared_goal="Ship auth-service v2.1",
    risk_score=40,
)

# Guard check (policy enforcement)
decision = dc.guard(
    action_type="deploy",
    content="Deploying to production",
    risk_score=40,
)

# Score the output quality
dc.score_output(
    scorer_id="es_your_scorer",
    output=deploy_result,
    action_id=action["action_id"],
)

# Score against your custom quality profile
profile_score = dc.score_with_profile("sp_your_profile", {
    "duration_ms": deploy_result["duration"],
    "confidence": deploy_result["confidence"],
    "action_id": action["action_id"],
})

# Update outcome
dc.update_outcome(action["action_id"],
    status="completed",
    output_summary="Deployed successfully",
)`}</CopyableCodeBlock>
          </StepCard>

          {/* What you just deployed */}
          <div className="py-12 border-t border-[rgba(255,255,255,0.06)]">
            <h2 className="text-2xl font-bold tracking-tight mb-2">What you just deployed</h2>
            <p className="text-zinc-400 mb-8">
              Your DashClaw instance ships with 177+ SDK methods across 29 categories. Every feature works out of the box -- no LLM API key required.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  category: 'Governance',
                  features: [
                    'Decision audit trail with full action traces',
                    'Behavior guard -- no-code policy enforcement',
                    'Human-in-the-loop approval gates',
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
                    'Risk signal monitoring (7 signal types)',
                    'Behavioral drift detection with z-score alerts',
                  ],
                },
                {
                  category: 'Compliance & Audit',
                  features: [
                    'SOC 2, NIST AI RMF, EU AI Act, ISO 42001 mapping',
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
                  category: 'Security',
                  features: [
                    'Verified agent identity (RSA signatures)',
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
                <div key={group.category} className="p-4 rounded-xl bg-[#111] border border-[rgba(255,255,255,0.06)]">
                  <h3 className="text-sm font-semibold text-white mb-2">{group.category}</h3>
                  <ul className="space-y-1">
                    {group.features.map((f) => (
                      <li key={f} className="text-xs text-zinc-400 flex items-start gap-2">
                        <span className="text-brand mt-0.5 shrink-0">*</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <p className="text-sm text-zinc-500 mt-6">
              All features are free, self-hosted, and work without any external AI provider.
              The only optional LLM feature is the <code>llm_judge</code> scorer type in the Evaluation Framework.
            </p>
          </div>

          {/* DashClaw Platform Skill */}
          <div className="rounded-2xl bg-gradient-to-b from-[rgba(249,115,22,0.06)] to-transparent p-6 sm:p-8 border border-[rgba(249,115,22,0.12)]">
            <div className="flex items-start gap-3 mb-5">
              <div className="w-10 h-10 rounded-lg bg-[rgba(249,115,22,0.1)] flex items-center justify-center shrink-0">
                <Sparkles size={20} className="text-brand" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">DashClaw Platform Skill</h2>
                <p className="text-sm text-zinc-400 leading-relaxed mt-1">
                  Skills are an open standard for giving agents specialized capabilities. Any agent that supports the skill framework can load this skill and become a DashClaw platform expert -- with knowledge of 177+ SDK methods across 29 categories.
                </p>
                <p className="text-sm text-zinc-400 leading-relaxed mt-2">
                  Works with Claude Code, and the growing ecosystem of skill-compatible agents.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <div className="rounded-lg bg-[#0d0d0d] border border-[rgba(255,255,255,0.06)] p-4">
                <h3 className="text-sm font-semibold text-zinc-200 mb-2">What it does</h3>
                <ul className="text-sm text-zinc-400 space-y-1.5">
                  <li>Instruments any agent with DashClaw SDKs (Node.js or Python)</li>
                  <li>Designs guard policies for cost ceilings, risk thresholds, and action allowlists</li>
                  <li>Configures evaluation scorers to track output quality (5 built-in types)</li>
                  <li>Sets up prompt template registries with version control and rollback</li>
                  <li>Generates compliance export bundles for SOC 2, NIST AI RMF, EU AI Act</li>
                  <li>Configures behavioral drift detection with statistical baselines</li>
                  <li>Sets up learning analytics to track agent velocity and maturity</li>
                  <li>Troubleshoots 401, 403, 429, and 503 errors with guided diagnostics</li>
                </ul>
              </div>
              <div className="rounded-lg bg-[#0d0d0d] border border-[rgba(255,255,255,0.06)] p-4">
                <h3 className="text-sm font-semibold text-zinc-200 mb-2">What&apos;s inside</h3>
                <pre className="text-xs text-zinc-400 font-mono overflow-x-auto leading-relaxed">
{`dashclaw-platform-intelligence/
|-- SKILL.md                          # 13 guided workflows (v2.1)
|-- scripts/
|   |-- validate-integration.mjs      # End-to-end connectivity test
|   |-- diagnose.mjs                  # 5-phase platform diagnostics
|   \`-- bootstrap-agent-quick.mjs     # Agent workspace importer
\`-- references/
    |-- api-surface.md                # 140+ routes, 29 categories
    |-- platform-knowledge.md         # Architecture, auth chain, ID prefixes
    \`-- troubleshooting.md            # Error resolution guide`}</pre>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-white mt-8 mb-3">Skill workflows</h3>
            <p className="text-xs text-zinc-400 mb-4">
              The skill includes 13 guided workflows. Your agent picks the right one from the decision tree based on what you ask:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
              {[
                { title: 'Instrument My Agent', desc: 'Full SDK integration with action recording and guard checks' },
                { title: 'Configure Evaluations', desc: '5 scorer types: regex, keywords, numeric range, custom, LLM judge' },
                { title: 'Manage Prompts', desc: 'Template registry with mustache variables and version history' },
                { title: 'Collect Feedback', desc: 'Structured ratings with auto-sentiment and auto-tagging' },
                { title: 'Export Compliance', desc: 'Multi-framework bundles with evidence packaging' },
                { title: 'Monitor Drift', desc: 'Statistical baselines and z-score deviation alerts' },
                { title: 'Track Learning', desc: 'Velocity scoring and 6-level maturity model' },
                { title: 'Configure Scoring', desc: 'Weighted quality profiles and risk templates' },
                { title: 'Design Policies', desc: 'Guard rules for cost ceilings and risk thresholds' },
                { title: 'Bootstrap Agent', desc: 'Auto-discover and import existing agent workspace data' },
                { title: 'Add a Capability', desc: 'Full-stack scaffold guide for adding new API routes' },
                { title: 'Generate Client', desc: 'Generate a DashClaw SDK in any language from OpenAPI' },
                { title: 'Troubleshoot', desc: 'Guided error resolution for auth and rate limits' },
              ].map((item) => (
                <div key={item.title} className="p-3 rounded-lg bg-[#0d0d0d] border border-[rgba(255,255,255,0.06)]">
                  <h4 className="text-xs font-medium text-white">{item.title}</h4>
                  <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-[#0d0d0d] border border-[rgba(255,255,255,0.06)] p-4 mb-5">
              <h3 className="text-sm font-semibold text-zinc-200 mb-3">Setup</h3>
              <ol className="list-decimal list-inside text-sm text-zinc-400 space-y-2">
                <li>Download and extract the zip into your project&apos;s skills directory (e.g. <code className="text-zinc-300 font-mono text-xs">.claude/skills/</code> for Claude Code)</li>
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
              <span className="text-xs text-zinc-500">~28 KB · open standard, works with any skill-compatible agent</span>
            </div>
          </div>

          {/* Divider */}
          <div className="relative py-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[rgba(255,255,255,0.06)]"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-[#0a0a0a] px-4 text-sm text-zinc-500">Alternative: Local Setup</span>
            </div>
          </div>

          <div className="rounded-xl bg-[#0d0d0d] border border-[rgba(255,255,255,0.06)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Server size={18} className="text-zinc-400" />
              <h3 className="text-base font-semibold text-zinc-200">Run locally with Docker</h3>
            </div>
            <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
              The installer generates secrets, writes .env.local, installs dependencies, and prints the API key your agents should use.
            </p>
            <div className="mb-4">
              <CopyMarkdownButton
                href="/api/prompts/server-setup/raw"
                label="Copy Server Setup Prompt"
                rawLabel="View prompt"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CopyableCodeBlock title="Windows (PowerShell)">{`./install-windows.bat`}</CopyableCodeBlock>
              <CopyableCodeBlock title="Mac / Linux (bash)">{`bash ./install-mac.sh`}</CopyableCodeBlock>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              When it finishes, open <span className="font-mono text-zinc-300">http://localhost:3000</span>.
            </p>
          </div>

          {/* Verified agents */}
          <StepCard
            n="6"
            title="Optional: enable verified agents (one-click pairing)"
            desc="If you want cryptographic identity binding, your agent generates a keypair and prints a one-click pairing URL. You approve once (or approve-all)."
            icon={Shield}
          >
            <CopyableCodeBlock title="Agent environment (verified mode)" copyText={`DASHCLAW_PRIVATE_KEY_PATH=./secrets/cinder-private.jwk\nENFORCE_AGENT_SIGNATURES=true`}>{`# Optional: sign actions with a private key
DASHCLAW_PRIVATE_KEY_PATH=./secrets/cinder-private.jwk

# Optional: server-side enforcement (set on the dashboard host)
ENFORCE_AGENT_SIGNATURES=true`}</CopyableCodeBlock>
            <p className="mt-3 text-sm text-zinc-400">
              The goal is: no manual public key uploads. Pairing registers the matching public key automatically.
            </p>
          </StepCard>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
