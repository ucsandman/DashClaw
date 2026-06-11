import {
  Zap, ShieldAlert, CircleDot, Eye, ArrowRight,
  ExternalLink, BookOpen, FolderKanban, MessageSquare, ArrowLeftRight,
  Brain, ScanSearch, HeartPulse, Newspaper, Package, UsersRound,
  Webhook, Clock, Compass, Building2, Terminal, BarChart3,
  Scale, Network, FileCheck, Download, SlidersHorizontal, Radio,
  Shield, DollarSign, AppWindow, ClipboardCheck,
} from 'lucide-react';
import DashClawLogo from './components/DashClawLogo';

/* ─── data ─── */

export const coreFeatures = [
  {
    icon: Zap,
    title: 'Prove Every Decision Your Agents Make',
    description: 'Every action, approval, assumption, and outcome lands in a live decision ledger so you can prove what happened, why it happened, and who authorized it.',
  },
  {
    icon: DashClawLogo,
    title: 'Enforce Policies Before Agents Act',
    description: 'Semantic guard policies intercept intent before execution. Test policies, import packs, generate proof reports, and keep governance logic out of brittle application code.',
  },
  {
    icon: BarChart3,
    title: 'Score, Calibrate, and Improve Quality',
    description: 'Built-in scorers, weighted scoring profiles, risk templates, and auto-calibration give operators a concrete quality bar instead of vibes and one-off dashboards.',
  },
  {
    icon: ShieldAlert,
    title: 'Human-in-the-Loop Decision Gates',
    description: 'Approval workflows pause risky decisions for human review, pair trusted agents, and keep verified identity attached to the decisions that matter most.',
  },
  {
    icon: FileCheck,
    title: 'Governance Signals & Anomaly Detection',
    description: 'Automated detection of autonomy spikes, high-impact actions without oversight, and reasoning drift ensures you catch risky behavior before it scales.',
  },
  {
    icon: Scale,
    title: 'Compliance-Ready Evidence Ledger',
    description: 'Map policies to SOC 2, NIST, and EU AI Act controls. Generate cryptographically signed proof reports and decision replays for audit and compliance.',
  },
];

export const platformFeatures = [
  { icon: Package, title: 'Drop-In SDKs', description: 'Connect any agent in minutes. Zero-dependency Node.js and Python clients optimized for minimal latency and high stability.' },
  { icon: Newspaper, title: 'Prompt Governance', description: 'Version-controlled prompt templates with mustache variables. Govern the prompts your agents use without hardcoding them in application logic.' },
  { icon: Radio, title: 'Behavioral Drift Detection', description: 'Detect when agent reasoning deviates from verified baselines. Catch "hallucinated intent" before it results in a blocked action.' },
  { icon: Download, title: 'Compliance Export Bundles', description: 'Framework mapping, gap analysis, evidence capture, and audit-ready exports for serious governance workflows.' },
  { icon: SlidersHorizontal, title: 'Scoring Profiles', description: 'User-defined weighted quality scoring with auto-calibration from real data. Replace hardcoded agent risk numbers with transparent rules.' },
  { icon: DashClawLogo, title: 'Verified Agent Identity', description: 'Know which agent took which action. JWKS-verified OIDC bearer tokens (EdDSA, RSA, ECDSA) with replay protection and per-call action binding — cryptographic attribution, not self-assertion.' },
  { icon: Terminal, title: 'CLI Approval Channel', description: 'Approve or deny agent actions from the terminal without opening a browser. Works with Claude Code, Codex, Hermes Agent, Gemini CLI, and any terminal-first workflow.' },
  { icon: Webhook, title: 'Coding-agent Hooks', description: 'Govern Claude Code, Codex, and Hermes Agent tool calls via shared field-compatible hook schemas. No SDK instrumentation required. Hermes additionally exposes pre_llm_call (per-turn context injection), post_llm_call (live ingest), transform_tool_result (secret redaction), and subagent_stop (delegate_task ROI).' },
  { icon: Network, title: 'MCP Server', description: 'Connect any MCP client to DashClaw governance with one config line. 32 governance tools and 6 resources over stdio or Streamable HTTP, plus credential-gated provider execution and verified launch plans on the local server. Works with Claude Code, Claude Desktop, and Managed Agents.' },
  { icon: FolderKanban, title: 'Execution Studio', description: 'Workflow templates, capability registry, knowledge collections, and model strategies. Chain governed actions into multi-step pipelines with conditional execution and resume-from-checkpoint.' },
  { icon: BarChart3, title: 'Agent Reputation', description: 'A per-agent trust vector computed from your own governed decisions: reliability, completion, policy violations, approval adherence, quality, and risk. Time-decayed and Bayesian-smoothed, with Ed25519-signed receipts that re-verify against the instance keys.' },
  { icon: UsersRound, title: 'Agent Registry', description: 'Register external, owned providers that group capabilities and are delegated to through governance. Every registry invocation routes through the same guard, action ledger, and SSRF-defended runtime as direct capabilities, with risk derived from the existing scale.' },
  { icon: DollarSign, title: 'Governed Capability Spend', description: 'Govern what agents pay for. Register x402 capability providers and gate each purchase through the same guard loop and action ledger — DashClaw governs purchase intent and records spend, it never holds a wallet. The Spend surface rolls up agent LLM cost and x402 capability purchases into one fleet view.' },
  { icon: ClipboardCheck, title: 'Work Orders', description: 'Typed task contracts with budget ceilings and self-verifying receipts; any agent can claim, every result is auditable. DashClaw stays the control plane — execution is external workers via claim/complete, and each completion produces a SHA-256 receipt with cost, output hash, and governance trail.' },
];

export const corePrimitives = [
  {
    icon: Compass,
    title: 'Intent',
    description: 'Agents declare what they want to do.',
  },
  {
    icon: Shield,
    title: 'Guard',
    description: 'Evaluate policies before agents act.',
  },
  {
    icon: UsersRound,
    title: 'Approval',
    description: 'Pause risky decisions for human review.',
  },
  {
    icon: Zap,
    title: 'Action',
    description: 'The governed decision is executed.',
  },
  {
    icon: Scale,
    title: 'Evidence',
    description: 'A signed replay is recorded for audit.',
  },
];

export const frameworkQuickstarts = [
  {
    id: 'mcp',
    name: 'MCP Server',
    label: 'Zero-code governance',
    code: `// Add to claude_desktop_config.json
// or .mcp.json for Claude Code
{
  "mcpServers": {
    "dashclaw": {
      "command": "npx",
      "args": ["@dashclaw/mcp-server"],
      "env": {
        "DASHCLAW_URL": "https://your-instance.vercel.app",
        "DASHCLAW_API_KEY": "oc_live_..."
      }
    }
  }
}
// 32 governance tools + 6 resources
// No SDK. No code changes.`
  },
  {
    id: 'langchain',
    name: 'LangChain',
    label: 'Python tool guard',
    code: `from dashclaw import DashClaw
import os

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="my-agent"
)

# Intercept tool execution
decision = claw.guard(
    action_type="deploy",
    risk_score=82
)

if decision["decision"] == "allow":
    run_agent_tool()`
  },
  {
    id: 'crewai',
    name: 'CrewAI',
    label: 'Agent task guard',
    code: `# Wrap sensitive agent tasks
decision = claw.guard(
    action_type="external_api_call",
    provider="stripe",
    risk_score=88
)

if decision["decision"] == "allow":
    crew.kickoff()`
  },
  {
    id: 'openai',
    name: 'OpenAI Tools',
    label: 'Node.js function guard',
    code: `import { DashClaw } from 'dashclaw'
const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent'
})

// Guard before calling the tool
const { decision } = await claw.guard({
  actionType: "deploy",
  riskScore: 90
})

if (decision === 'allow') {
  await openai.chat.completions.create(...)
}`
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    label: 'One-command install',
    code: `# No clone required — the CLI downloads the hooks bundle
# from your instance, wires ~/.claude/settings.json, and
# defaults to observe mode.
npm i -g @dashclaw/cli
dashclaw install claude            # prompts for endpoint + API key
dashclaw install claude --trial    # hosted signup, paste the key

# Governs Bash, Edit, Write, MultiEdit, Agent/Task, mcp__* tools.
# Flip to enforce: set DASHCLAW_HOOK_MODE=enforce in
# ~/.dashclaw/claude-hooks/.env`
  },
  {
    id: 'codex',
    name: 'Codex',
    label: 'PreToolUse hook + MCP',
    code: `# One command wires it all into ~/.codex/config.toml
$ dashclaw install codex --project .

# Managed block written to ~/.codex/config.toml:
approval_policy = "on-request"

[mcp_servers.dashclaw]
command = "python"
args = [".../dashclaw-mcp.js", "--agent-id", "codex"]

[[hooks.PreToolUse]]
matcher = "Bash|Edit|Write|MultiEdit"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "python ~/.codex/hooks/dashclaw/dashclaw_pretool.py"

# Same hooks. Same audit ledger. agent_id = codex.`
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    label: '8 lifecycle hooks + live ingest',
    code: `# One install script wires 8 hooks into ~/.hermes/config.yaml
$ bash scripts/install-hermes-plugin.sh

# Managed block written to ~/.hermes/config.yaml:
hooks:
  pre_tool_call:  [...]  # guard / block / require_approval
  post_tool_call: [...]  # outcome recording
  pre_llm_call:   [...]  # per-turn policy + approval context injection
  post_llm_call:  [...]  # live ingest to /api/code-sessions/ingest-live
  on_session_start: [...] # cache warm
  on_session_end:   [...] # finalize: true -> optimizer + alerts pass
  transform_tool_result: [...] # redact API keys, JWTs, PEM blocks
  subagent_stop:    [...] # delegate_task ROI tracking

# Per-turn cost attribution. agent_id = hermes.`
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    label: 'Plugin — full governance loop',
    code: `// openclaw.config.json — the framework that
// inspired the "Claw" in DashClaw
{
  "plugins": {
    "entries": {
      "dashclaw-governance": {
        "enabled": true,
        "config": {
          "dashclawUrl": "https://your-instance.vercel.app",
          "dashclawApiKey": "oc_live_...",
          "agentId": "my-openclaw-agent",
          "failClosed": true
        }
      }
    }
  }
}
// Every tool call: guard -> record -> approval
// -> outcome. x402 spend gating included.`
  },
];

export const operationalFeatures = [
  { icon: UsersRound, title: 'Team Management', description: 'Invite your team in seconds. Role-based access keeps operators in control and agents accountable.' },
  { icon: Webhook, title: 'Decision Risk Notifications', description: 'HMAC-signed webhooks and email alerts fire when decision integrity signals breach thresholds. No more checking dashboards.' },
  { icon: Clock, title: 'Full Audit Trail', description: 'Every action is logged with actor, timestamp, and reasoning: ready for compliance audits and debugging.' },
  { icon: Compass, title: 'Ship in 10 Minutes', description: 'Four steps: create workspace, generate key, install SDK, send first action. That\'s it.' },
  { icon: Building2, title: 'Built for Multi-Tenant', description: 'Full org isolation out of the box. Each team gets their own agents, keys, and settings.' },
  { icon: Terminal, title: 'Infrastructure Tooling', description: 'Terminal CLI for approving agent actions, viewing the approval inbox, and querying decision replays. Works with Claude Code, Codex, and any terminal-first agent workflow.' },
  { icon: AppWindow, title: 'Glanceable Status Widget', description: 'Install /widget as a standalone desktop app: a tiny cockpit showing fleet posture (calm, active, approval, elevated), pending approvals, risk signals, and the last few governed actions at a glance. Pin it always-on-top in one click (Chrome/Edge), choose the sections and metrics it shows, one-click PWA install from your instance, zero config, read-only.' },
];

export const signals = [
  { name: 'Autonomy Spike', description: 'Agent taking too many actions without human checkpoints' },
  { name: 'High Impact, Low Oversight', description: 'Critical actions without sufficient review' },
  { name: 'Repeated Failures', description: 'Same action type failing multiple times' },
  { name: 'Stale Loop', description: 'Open loops unresolved past their expected timeline' },
  { name: 'Assumption Drift', description: 'Assumptions becoming stale or contradicted by outcomes' },
  { name: 'Stale Assumption', description: 'Assumptions not validated within expected timeframe' },
  { name: 'Stale Running Action', description: 'Actions stuck in running state for over 4 hours' },
];

export const agentToolCategories = [
  { title: 'Policy & Guard', desc: 'Define, test, and enforce guard policies. Centralize governance logic.', example: 'claw.guard({ type: "deploy", risk: 85 })' },
  { title: 'Decision Ledger', desc: 'Immutable record of every agent intent and outcome. Prove accountability.', example: 'claw.createAction({ goal: "Database cleanup" })' },
  { title: 'Risk Monitoring', desc: 'Automatic detection of risky behavior patterns across your agent fleet.', example: 'signal: autonomy_spike detected for agent-1' },
  { title: 'Compliance Evidence', desc: 'Mapping guard decisions to SOC 2 and ISO controls for audit readiness.', example: 'Generating cryptographically signed proof...' },
  { icon: DashClawLogo, title: 'Verified Identity', desc: 'JWKS-verified agent identity — only cryptographically attested agents interact with your systems.', example: 'Identity verified for agent: deploy-bot-4' },
];

export const platformCoverage = [
  {
    icon: FolderKanban,
    title: 'Governance Control Plane',
    description: 'Mission Control, onboarding, approval queue, fleet health, security posture, and role-based workspace management.',
  },
  {
    icon: Zap,
    title: 'Minimal Runtime API',
    description: 'A focused, stable API namespace for decision governance, policies, and evidence capture with enforced boundary CI.',
  },
  {
    icon: Radio,
    title: 'Decision Integrity Signals',
    description: 'Real-time streams for actions, policies, and anomalies with SSE replay, reconnect handling, and live dashboard updates.',
  },
  {
    icon: Package,
    title: 'Stable SDKs',
    description: 'Node and Python SDKs optimized for the governance lifecycle with parity suites and CI-backed contract governance.',
  },
];

export const shippedHighlights = [
  {
    icon: Shield,
    title: 'Zero-Trust Agent Governance',
    description: 'Intercept agent actions before they execute. Enforce organizational policies at the decision level, not the application level.',
    href: '/docs',
  },
  {
    icon: DashClawLogo,
    title: 'Infrastructure You Can Trust',
    description: 'SQL drift checks and contract tests run in CI. No silent regressions reach production governance.',
    href: '/docs',
  },
  {
    icon: Scale,
    title: 'Audit-Ready Decision Replays',
    description: 'Visual causal chains of every governed action. Record assumptions and verify outcomes for a complete audit trail.',
    href: '/decisions',
  },
  {
    icon: Package,
    title: 'SDKs That Stay in Sync',
    description: 'Node and Python SDKs are tested against the same contract fixtures. Feature parity is enforced, not hoped for.',
    href: '/docs',
  },
  {
    icon: Webhook,
    title: 'Operational Webhooks',
    description: 'Integrate DashClaw alerts into your existing PagerDuty or Slack workflows. React to risk signals in real-time.',
    href: '/webhooks',
  },
  {
    icon: Network,
    title: 'MCP Governance Server',
    description: 'Plug DashClaw into any MCP-compatible client. Guard, record, invoke, and discover capabilities without writing integration code — plus governed provider execution and verified launch plans on the local server.',
    href: '/docs#mcp-server',
  },
  {
    icon: FolderKanban,
    title: 'Execution Studio',
    description: 'Workflow templates with 3 step types, capability registry with governed HTTP invocation, and knowledge collections with semantic search.',
    href: '/workflows',
  },
  {
    icon: Scale,
    title: 'Compliance Automation',
    description: 'Map your guardrails to SOC 2, ISO 27001, GDPR, NIST AI RMF, and more. Generate audit-ready reports on demand.',
    href: '/docs#compliance-engine',
  },
];

/* ─── page ─── */
