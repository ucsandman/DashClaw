import { Suspense } from 'react';
import Link from 'next/link';
import {
  BookOpen, Terminal, Zap, ShieldAlert,
  ChevronRight, Network, Scale, Shield,
} from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import CopyDocsButton from '../components/CopyDocsButton';
import ConnectAgentButton from '../components/ConnectAgentButton';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import DocsSidebarClient from './DocsSidebarClient';
import DocsCodeTabs from './DocsCodeTabs';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'DashClaw SDK Documentation',
  description:
    'Canonical, up-to-date reference for the DashClaw SDK. Install, configure, and govern your AI agents across guard/policy evaluation, action recording, human approvals, durable outcomes, agent identity, and risk signals.',
  path: '/docs',
});

/* ─── helpers ─── */

interface CodeBlockProps {
  children?: React.ReactNode;
  title?: React.ReactNode;
}

function CodeBlock({ children, title }: CodeBlockProps) {
  return (
    <div className="rounded-xl bg-surface-secondary border border-border overflow-x-auto">
      {title && (
        <div className="px-5 py-2.5 border-b border-border text-xs text-text-tertiary font-mono">{title}</div>
      )}
      <pre className="p-5 font-mono text-sm leading-relaxed text-text-secondary">{children}</pre>
    </div>
  );
}

interface DocParam {
  name?: string;
  type?: React.ReactNode;
  required?: boolean;
  desc?: React.ReactNode;
}

interface ParamTableProps {
  params?: DocParam[];
}

function ParamTable({ params = [] }: ParamTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-4 text-text-secondary font-medium">Parameter</th>
            <th className="text-left py-2 pr-4 text-text-secondary font-medium">Type</th>
            <th className="text-left py-2 pr-4 text-text-secondary font-medium">Required</th>
            <th className="text-left py-2 text-text-secondary font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p) => (
            <tr key={p.name} className="border-b border-border">
              <td className="py-2 pr-4 font-mono text-xs text-brand">{p.name}</td>
              <td className="py-2 pr-4 font-mono text-xs text-text-tertiary">{p.type}</td>
              <td className="py-2 pr-4 text-xs">{p.required ? <span className="text-error">Yes</span> : <span className="text-text-disabled">No</span>}</td>
              <td className="py-2 text-text-secondary text-xs">{p.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface MethodEntryProps {
  id?: string;
  signature?: React.ReactNode;
  description?: React.ReactNode;
  params?: DocParam[];
  returns?: React.ReactNode;
  example?: React.ReactNode;
  children?: React.ReactNode;
}

function MethodEntry({ id, signature, description, params, returns, example, children }: MethodEntryProps) {
  return (
    <div id={id} className="scroll-mt-20 py-8 border-b border-border last:border-b-0">
      <h3 className="text-lg font-semibold text-text-primary font-mono">{signature}</h3>
      <p className="mt-2 text-sm text-text-secondary leading-relaxed">{description}</p>
      {params && params.length > 0 && (
        <div className="mt-4">
          <ParamTable params={params} />
        </div>
      )}
      {returns && (
        <p className="mt-3 text-xs text-text-tertiary"><span className="text-text-secondary font-medium">Returns:</span> <code className="font-mono text-text-secondary">{returns}</code></p>
      )}
      {example && (
        <div className="mt-4">
          {example}
        </div>
      )}
      {children}
    </div>
  );
}

interface SectionNavProps {
  items?: any[];
}

function SectionNav({ items }: SectionNavProps) {
  return <DocsSidebarClient items={items} />;
}

/* ─── nav items for sidebar ─── */

const navItems = [
  { href: '/guides/platform', label: 'Complete Platform Guide' },
  { href: '#quick-start', label: 'Quick Start' },
  { href: '#mcp-server', label: 'MCP Server' },
  { href: '#mcp-tools', label: 'Tools (12)', indent: true },
  { href: '#mcp-resources', label: 'Resources (3)', indent: true },
  { href: '#mcp-config', label: 'Configuration', indent: true },
  { href: '#cli-and-doctor', label: 'CLI & Doctor' },
  { href: '#dashclaw-doctor', label: 'dashclaw doctor', indent: true },
  { href: '#live-host-canary', label: 'Live host canary', indent: true },
  { href: '#claude-code-plugin', label: 'Claude Code Plugin', indent: true },
  { href: '#codex-plugin', label: 'Codex Plugin', indent: true },
  { href: '#hermes-plugin', label: 'Hermes Agent Plugin', indent: true },
  { href: '#openclaw-plugin', label: 'OpenClaw Plugin', indent: true },
  { href: '#governance-skill', label: 'Governance Skill', indent: true },
  { href: '#platform-intelligence-skill', label: 'Platform Intelligence Skill', indent: true },
  { href: '#constructor', label: 'Constructor' },
  { href: '#behavior-guard', label: 'Behavior Guard' },
  { href: '#guard', label: 'guard', indent: true },
  { href: '#risk-breakdown', label: 'Risk composition', indent: true },
  { href: '#risk-calibration', label: 'Calibration proposals', indent: true },
  { href: '#tightening-proposals', label: 'Tightening proposals', indent: true },
  { href: '#loosening-proposals', label: 'Loosening proposals', indent: true },
  { href: '#action-recording', label: 'Action Recording' },
  { href: '#createAction', label: 'createAction', indent: true },
  { href: '#waitForApproval', label: 'waitForApproval', indent: true },
  { href: '#updateOutcome', label: 'updateOutcome', indent: true },
  { href: '#recordAssumption', label: 'recordAssumption', indent: true },
  { href: '#signals', label: 'Signals' },
  { href: '#policies', label: 'Policies' },
  { href: '#simulatePolicy', label: 'simulatePolicy', indent: true },
  { href: '#policies-generate', label: 'AI Policy Generator', indent: true },
  { href: '#policy-tuning', label: 'Tuning proposals', indent: true },
  { href: '#policy-degradation', label: 'Degradation observability', indent: true },
  { href: '#security-scanning', label: 'Security Scanning' },
  { href: '#scanPromptInjection', label: 'scanPromptInjection', indent: true },
  { href: '#agent-identity', label: 'Agent Identity' },
  { href: '#composed-identities', label: 'Composed identities', indent: true },
  { href: '#createPairing', label: 'createPairing', indent: true },
  { href: '#listPairings', label: 'listPairings', indent: true },
  { href: '#getPairing', label: 'getPairing', indent: true },
  { href: '#approvePairing', label: 'approvePairing', indent: true },
  { href: '#registerIdentity', label: 'registerIdentity', indent: true },
  { href: '#listIdentities', label: 'listIdentities', indent: true },
  { href: '#revokeIdentity', label: 'revokeIdentity', indent: true },
  { href: '#execution-studio', label: 'Execution Studio (HTTP)' },
  { href: '#execution-graph', label: 'Execution Graph', indent: true },
  { href: '#action-outcome', label: 'Action Outcome', indent: true },
  { href: '#coverage', label: 'Coverage' },
  { href: '#coverage-get', label: 'GET /api/coverage', indent: true },
  { href: '#fanouts', label: 'Fan-outs' },
  { href: '#fanouts-get', label: 'GET /api/agents/fanouts', indent: true },
  { href: '#hosted-provisioning', label: 'Hosted Provisioning (operator)' },
  { href: '#hosted-workspaces-post', label: 'POST /workspaces', indent: true },
  { href: '#hosted-workspaces-get', label: 'GET /workspaces/:id', indent: true },
  { href: '#hosted-workspaces-delete', label: 'DELETE /workspaces/:id', indent: true },
  { href: '#hosted-cleanup', label: 'POST /cleanup', indent: true },
  { href: '#error-handling', label: 'Error Handling' },
];

/* ─── page ─── */

// Rendered per-request (a client child uses useSearchParams; static prerender
// would need a Suspense boundary for no reader benefit on this page).
export const dynamic = 'force-dynamic';

export default async function DocsPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      {/* Navbar */}
      <PublicNavbar />

      {/* Hero */}
      <section className="pt-32 pb-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-text-tertiary mb-4">
            <Link href="/" className="hover:text-text-secondary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-text-secondary">SDK Documentation</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center">
              <BookOpen size={20} className="text-brand" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">SDK Documentation</h1>
          </div>
          <p className="text-text-secondary max-w-2xl leading-relaxed">
            Canonical reference for the DashClaw SDK (Node v{process.env.NEXT_PUBLIC_SDK_NODE_VERSION} / Python v{process.env.NEXT_PUBLIC_SDK_PYTHON_VERSION}). Node.js and Python parity across all core governance features.
          </p>
          <Suspense fallback={null}>
            <CopyDocsButton />
          </Suspense>
        </div>
      </section>

      {/* Main content with side nav */}
      <div className="max-w-6xl mx-auto px-6 pb-20 flex gap-12">
        <SectionNav items={navItems} />

        <div className="min-w-0 flex-1">

          {/* ── Complete platform guide callout ── */}
          <div className="mb-10 rounded-xl border border-brand/25 bg-surface-secondary p-5">
            <p className="font-mono text-[11px] uppercase tracking-wider text-brand">New</p>
            <p className="mt-1 text-sm text-text-secondary leading-relaxed">
              Looking for the whole surface — every page, endpoint, SDK method, CLI command, MCP tool, and hook,
              with live-captured examples and a stable/experimental mark on each?
            </p>
            <Link href="/guides/platform" className="mt-2 inline-block text-sm font-medium text-brand hover:text-brand-hover">
              Open the Complete Platform Guide →
            </Link>
          </div>

          {/* ── Quick Start ── */}
          <section id="quick-start" className="scroll-mt-20 pb-12 border-b border-border">
            <h2 className="text-2xl font-bold tracking-tight mb-6">Quick Start</h2>

            <div className="space-y-8">
              {/* Step 1 */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center">1</span>
                  <h3 className="text-base font-semibold">Install</h3>
                </div>
                <div className="pl-10">
                  <DocsCodeTabs 
                    nodeSnippet="npm install dashclaw"
                    pythonSnippet="pip install dashclaw"
                    nodeTitle="npm"
                    pythonTitle="pip"
                  />
                </div>
              </div>

              {/* Step 2 */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center">2</span>
                  <h3 className="text-base font-semibold">Initialize</h3>
                </div>
                <div className="pl-10">
                  <DocsCodeTabs 
                    nodeSnippet={`import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent'
});`}
                    pythonSnippet={`from dashclaw import DashClaw
import os

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.getenv("DASHCLAW_API_KEY"),
    agent_id="my-agent"
)`}
                  />
                </div>
              </div>

              {/* Step 3 */}
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-7 h-7 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center">3</span>
                  <h3 className="text-base font-semibold">Governance Loop</h3>
                </div>
                <div className="pl-10">
                  <DocsCodeTabs 
                    nodeSnippet={`// 1. Ask permission — your abort IS the enforcement on the SDK path
const decision = await claw.guard({
  action_type: 'deploy',
  risk_score: 85,
  declared_goal: 'Update the auth service'
});

if (decision.decision === 'block') {
  throw new Error(\`Blocked: \${decision.reason || decision.reasons?.join(', ')}\`);
}

// 2. Log intent. The server re-evaluates policy here and is the
//    authoritative source for HITL gating.
const { action, action_id } = await claw.createAction({
  action_type: 'deploy',
  declared_goal: 'Update the auth service'
});

// 3. If the server flagged this, wait for a human operator.
//    Pass createAction's action_id — NOT the guard's decision_id (a.k.a. decision.action_id).
if (action?.status === 'pending_approval') {
  await claw.waitForApproval(action_id);
}

try {
  // 4. Log evidence
  await claw.recordAssumption({
    action_id,
    assumption: 'Tests passed'
  });

  // ... deploy ...

  // 5. Record outcome
  await claw.updateOutcome(action_id, { status: 'completed' });
} catch (err) {
  await claw.updateOutcome(action_id, { status: 'failed', error_message: err.message });
}`}
                    pythonSnippet={`# 1. Ask permission — your abort IS the enforcement on the SDK path
decision = claw.guard({
    "action_type": "deploy",
    "risk_score": 85,
    "declared_goal": "Update the auth service"
})

if decision["decision"] == "block":
    raise Exception(f"Blocked: {decision.get('reason') or ', '.join(decision.get('reasons', []))}")

# 2. Log intent
created = claw.create_action(
    action_type="deploy",
    declared_goal="Update the auth service"
)
action_id = created["action_id"]

# 3. If the server flagged this, wait for a human operator.
if created.get("action", {}).get("status") == "pending_approval":
    claw.wait_for_approval(action_id)

try:
    # 4. Log evidence
    claw.record_assumption({
        "action_id": action_id,
        "assumption": "Tests passed"
    })

    # ... deploy ...

    # 5. Record outcome
    claw.update_outcome(action_id, status="completed")
except Exception as e:
    claw.update_outcome(action_id, status="failed", error_message=str(e))`}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── MCP Server ── */}
          <section id="mcp-server" className="scroll-mt-20 py-12 border-b border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-surface-tertiary flex items-center justify-center">
                <Network size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">MCP Server</h2>
            </div>
            <p className="mt-2 mb-8 text-sm text-text-secondary leading-relaxed">
              <code className="font-mono text-text-secondary">@dashclaw/mcp-server</code> exposes DashClaw governance over Model Context Protocol. Any MCP-compatible client gets 12 governance tools across 3 groups (core governance, retrospection, agent identity) plus 3 read-only resources.
            </p>

            {/* Tools */}
            <div id="mcp-tools" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Tools (12)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-text-secondary font-medium">Tool</th>
                      <th className="text-left py-2 pr-4 text-text-secondary font-medium">Description</th>
                      <th className="text-left py-2 text-text-secondary font-medium">Key Inputs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { group: 'Core governance', tool: 'dashclaw_guard', desc: 'Evaluate policies before risky actions', inputs: 'action_type, declared_goal, risk_score' },
                      { tool: 'dashclaw_record', desc: 'Log action to audit trail', inputs: 'action_type, declared_goal, status, session_id' },
                      { tool: 'dashclaw_invoke', desc: 'Execute governed capability', inputs: 'capability_id, declared_goal, payload' },
                      { tool: 'dashclaw_capabilities_list', desc: 'Discover available APIs', inputs: 'category, risk_level, search' },
                      { tool: 'dashclaw_policies_list', desc: 'List active policies', inputs: 'agent_id' },
                      { tool: 'dashclaw_wait_for_approval', desc: 'Wait for human decision', inputs: 'action_id, timeout_seconds' },
                      { tool: 'dashclaw_session_start', desc: 'Register agent session', inputs: 'agent_id, workspace' },
                      { tool: 'dashclaw_session_end', desc: 'Close session', inputs: 'session_id, status, summary' },
                      { tool: 'dashclaw_session_retro', desc: 'Read the session\'s own defensibility retro (posture + evidenced findings)', inputs: 'session_id' },
                      { group: 'Retrospection', tool: 'dashclaw_assumption_record', desc: 'Record an unverified assumption underpinning an action', inputs: 'action_id, assumption, basis' },
                      { tool: 'dashclaw_decisions_recent', desc: 'Recent governed-action ledger', inputs: 'agent_id, action_type, decision, since' },
                      { group: 'Agent identity', tool: 'dashclaw_pair', desc: 'Enroll identity: generate keypair locally, submit public key for approval', inputs: 'agent_id, agent_name, wait' },
                    ] as Array<{ group?: string; tool: string; desc: string; inputs: string }>).map((row) => (
                      <tr key={row.tool} className="border-b border-border">
                        <td className="py-2 pr-4 font-mono text-xs text-brand">
                          {row.group && (
                            <div className="text-[10px] uppercase tracking-[0.14em] text-text-tertiary font-sans mb-0.5">{row.group}</div>
                          )}
                          {row.tool}
                        </td>
                        <td className="py-2 pr-4 text-xs text-text-secondary">{row.desc}</td>
                        <td className="py-2 font-mono text-xs text-text-tertiary">{row.inputs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Resources */}
            <div id="mcp-resources" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Resources (3)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-text-secondary font-medium">URI</th>
                      <th className="text-left py-2 text-text-secondary font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { uri: 'dashclaw://policies', desc: 'Active policy set' },
                      { uri: 'dashclaw://agent/{agent_id}/history', desc: 'Recent action history (last 50)' },
                      { uri: 'dashclaw://status', desc: 'Instance health + operational metrics' },
                    ].map((row) => (
                      <tr key={row.uri} className="border-b border-border">
                        <td className="py-2 pr-4 font-mono text-xs text-brand">{row.uri}</td>
                        <td className="py-2 text-xs text-text-secondary">{row.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Configuration */}
            <div id="mcp-config" className="scroll-mt-20">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Configuration</h3>
              <p className="text-xs text-text-tertiary mb-3">Config resolution: CLI args &gt; env vars &gt; defaults. Three config values: <code className="font-mono text-text-secondary">url</code> (<code className="font-mono text-text-secondary">DASHCLAW_URL</code>, default <code className="font-mono text-text-secondary">localhost:3000</code>), <code className="font-mono text-text-secondary">apiKey</code> (<code className="font-mono text-text-secondary">DASHCLAW_API_KEY</code>), <code className="font-mono text-text-secondary">agentId</code> (<code className="font-mono text-text-secondary">DASHCLAW_AGENT_ID</code>).</p>
              <div className="space-y-4">
                <CodeBlock title="stdio — Claude Code / Cowork (.mcp.json; Desktop chat uses the OAuth connector below)">{`{
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
}`}</CodeBlock>
                <CodeBlock title="Streamable HTTP — Managed Agents (Python)">{`mcp_servers=[{
    "type": "url",
    "url": "https://your-instance.vercel.app/api/mcp",
    "headers": {"x-api-key": "oc_live_..."},
    "name": "dashclaw"
}]`}</CodeBlock>
                <CodeBlock title="Custom connector — Claude app (web / Desktop / Cowork), OAuth, no key">{`Settings → Connectors → Add custom connector

  https://your-instance.vercel.app/api/mcp

Connect → log in to DashClaw → Authorize. No API key in the UI: the
instance runs its own OAuth (DCR + PKCE). Guide: docs/CLAUDE-DESKTOP-PLUGIN.md`}</CodeBlock>
                <p className="text-xs text-text-tertiary leading-relaxed">
                  In chat clients the connector governs <span className="text-text-secondary">cooperatively</span>: the agent, guided by the governance skill, calls <code className="font-mono text-text-secondary">dashclaw_guard</code> / <code className="font-mono text-text-secondary">dashclaw_invoke</code> and records its decisions — it is not a kernel-level block, so a non-compliant model could still call a native tool without consulting guard. Hard <code className="font-mono text-text-secondary">PreToolUse</code> blocking (fail-closed deny) is a property of the CLI hook path (Claude Code / Codex / Hermes); Cowork hard-gating is not yet verified.
                </p>
              </div>
            </div>
          </section>

          {/* ── CLI & Doctor ── */}
          <section id="cli-and-doctor" className="scroll-mt-20 py-12 border-b border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-status-success-subtle flex items-center justify-center">
                <Terminal size={16} className="text-success" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">CLI & Doctor</h2>
            </div>
            <p className="mt-2 mb-8 text-sm text-text-secondary leading-relaxed">
              <code className="font-mono text-text-secondary">@dashclaw/cli</code> handles terminal approvals and self-host diagnostics. <code className="font-mono text-text-secondary">npm run doctor</code> runs the same engine locally with filesystem-level fix powers.
            </p>

            <div id="dashclaw-doctor" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">dashclaw doctor</h3>
              <p className="text-xs text-text-tertiary mb-3">
                Diagnoses your instance (database, configuration, auth, deployment, SDK reachability, governance staleness, data hygiene, livingcode shape drift, write-path canaries — synthetic self-cleaning writes that prove heartbeat, action-ledger, and guard-audit inserts land) and this machine (stale compiled mcp-server lib, .gitattributes drift, local schema behind code, stale global CLI shim, broken hook installs, leaked machine-scope env vars). Report-only by default; <code className="font-mono text-text-secondary">--fix</code> applies safe repairs, re-checks, and prints a what-changed report. Invokes <code className="font-mono text-text-secondary">GET /api/doctor</code> and <code className="font-mono text-text-secondary">POST /api/doctor/fix</code> (admin keys). For operators, <code className="font-mono text-text-secondary">npm run doctor -- --fix</code> on the host adds <code className="font-mono text-text-secondary">.env</code> writes, migrations, and default-policy seeding (backs up <code className="font-mono text-text-secondary">.env</code> before any write).
              </p>
              <CodeBlock title="dashclaw doctor">{`npm install -g @dashclaw/cli

dashclaw doctor                          # report-only (default — applies nothing)
dashclaw doctor --fix                    # apply safe fixes, re-check, report what changed
dashclaw doctor --json                   # CI / scripts (includes local machine checks)
dashclaw doctor --category database,config

# Config resolution: env vars → ~/.dashclaw/config.json (600) → interactive prompt
dashclaw logout                          # remove saved config

# Self-host operator (filesystem-level fixes need --fix)
npm run doctor -- --fix`}</CodeBlock>
            </div>

            <div id="live-host-canary" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Live host canary</h3>
              <p className="text-xs text-text-tertiary mb-3">
                The doctor proves your instance works from the inside; the live host canary proves your deployment works from the outside. <code className="font-mono text-text-secondary">scripts/live-canary.mjs</code> probes your production hosts hourly as a real unauthenticated client — marketing page, docs, demo entry, trial-mint fail-closed (it passes on the Turnstile rejection, so it never mints junk trials), OAuth discovery, and the MCP handshake&apos;s 401 challenge — and files the verdict to <code className="font-mono text-text-secondary">POST /api/live-canary</code>. Verdicts render on <code className="font-mono text-text-secondary">/setup#live-canary</code>; a fresh failure also raises a posture auditability finding. Canary traffic is stored in its own table and never touches the action or guard ledgers.
              </p>
              <CodeBlock title="Enable (GitHub Actions)">{`# One-off run against your hosts:
LIVE_CANARY_MARKETING_ORIGIN=https://your-site \\
LIVE_CANARY_HOSTED_ORIGIN=https://your-instance \\
node scripts/live-canary.mjs

# Scheduled: .github/workflows/live-canary.yml runs hourly.
# To report verdicts to your instance, add two repo secrets
# (Settings -> Secrets and variables -> Actions):
#   LIVE_CANARY_REPORT_URL   e.g. https://my-dashclaw.vercel.app
#   LIVE_CANARY_REPORT_KEY   an operator API key on that instance
# If that key's org is not org_default, also set DASHCLAW_CANARY_ORG_ID
# on the instance so /setup renders the canary's runs.`}</CodeBlock>
            </div>

            <div id="claude-code-plugin" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Claude Code Plugin</h3>
              <p className="text-xs text-text-tertiary mb-3">
                <code className="font-mono text-text-secondary">plugins/dashclaw/.claude-plugin/plugin.json</code> is the Claude Code plugin manifest. Distributes the DashClaw MCP server (<code className="font-mono text-text-secondary">.mcp-claude.json</code>) plus the <code className="font-mono text-text-secondary">dashclaw-governance</code> and <code className="font-mono text-text-secondary">dashclaw-platform-intelligence</code> skills as one installable bundle. Full step-by-step at <Link href="/guides/claude-code" className="text-brand hover:text-brand-hover">/guides/claude-code</Link>.
              </p>
              <CodeBlock title="Install">{`# No clone required — the CLI downloads the hooks bundle from your instance:
npm i -g @dashclaw/cli
dashclaw install claude            # prompts for endpoint + API key
dashclaw install claude --trial    # hosted signup, paste the key

# Working from a repo checkout instead:
npm run hooks:install`}</CodeBlock>
            </div>

            <div id="codex-plugin" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Codex Plugin</h3>
              <p className="text-xs text-text-tertiary mb-3">
                <code className="font-mono text-text-secondary">dashclaw install codex</code> wires the same governance surface DashClaw ships for Claude Code into Codex&apos;s <code className="font-mono text-text-secondary">~/.codex/config.toml</code> — MCP server config, PreToolUse / PostToolUse / Stop hooks, and the governance protocol in <code className="font-mono text-text-secondary">AGENTS.md</code>. Idempotent; re-run after every <code className="font-mono text-text-secondary">git pull</code>. Full step-by-step at <Link href="/guides/codex" className="text-brand hover:text-brand-hover">/guides/codex</Link>.
              </p>
              <CodeBlock title="Install">{`# One command from the DashClaw repo root:
node cli/bin/dashclaw.js install codex --project /path/to/your/project

# Optional: opt in to legacy notify config for turn-complete records
node cli/bin/dashclaw.js install codex --project /path/to/your/project --include-notify`}</CodeBlock>
            </div>

            <div id="hermes-plugin" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Hermes Agent Plugin</h3>
              <p className="text-xs text-text-tertiary mb-3">
                <code className="font-mono text-text-secondary">plugins/dashclaw/.hermes-plugin/</code> ships eight lifecycle hooks for Hermes Agent: pre/post tool, pre/post LLM call with per-turn governance context injection, on-session start/end with live ingest finalize, secret redaction in tool output, and subagent_stop ROI tracking. Full step-by-step at <Link href="/guides/hermes" className="text-brand hover:text-brand-hover">/guides/hermes</Link>.
              </p>
              <CodeBlock title="Install">{`# macOS / Linux — symlinks the plugin, appends 8 hook entries to
# ~/.hermes/config.yaml between sentinel markers (idempotent).
bash scripts/install-hermes-plugin.sh

# Windows
powershell -File scripts/install-hermes-plugin.ps1

# 4-section sanity check
hermes dashclaw doctor`}</CodeBlock>
            </div>

            <div id="openclaw-plugin" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">OpenClaw Plugin</h3>
              <p className="text-xs text-text-tertiary mb-3">
                <code className="font-mono text-text-secondary">@dashclaw/openclaw-plugin</code> wires governance into the OpenClaw agent framework. Intercepts <code className="font-mono text-text-secondary">before_tool_call</code> / <code className="font-mono text-text-secondary">after_tool_call</code> lifecycle hooks, calls guard / record / wait-for-approval automatically, and ships a <code className="font-mono text-text-secondary">HOOK.md</code> pack the openclaw CLI installs. Tool classification vocabulary aligns with DashClaw guard action types.
              </p>
            </div>

            <div id="governance-skill" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Governance Skill</h3>
              <p className="text-xs text-text-tertiary mb-3">
                <code className="font-mono text-text-secondary">dashclaw-governance</code> teaches governed agents how to use DashClaw correctly — risk thresholds, decision handling (allow / warn / block / require_approval), action recording, approval-wait protocol, and session lifecycle. Pairs with <code className="font-mono text-text-secondary">@dashclaw/mcp-server</code>. Auto-installed by the Claude Code, Codex, and Hermes plugins; also downloadable as a standalone zip.
              </p>
              <CodeBlock title="Download">{`# Zip download from this instance:
curl -O ${'`'}https://${'<'}your-deployment${'>'}/downloads/dashclaw-governance.zip${'`'}

# Or copy the source dir directly:
cp -r public/downloads/dashclaw-governance ~/.claude/skills/

# Already auto-installed if you ran one of the plugin installers above.`}</CodeBlock>
            </div>

            <div id="platform-intelligence-skill" className="scroll-mt-20">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Platform Intelligence Skill</h3>
              <p className="text-xs text-text-tertiary mb-3">
                <code className="font-mono text-text-secondary">dashclaw-platform-intelligence</code> gives an agent a live reference to DashClaw&apos;s API surface, governance vocabulary, integration patterns, and troubleshooting playbooks. Regenerated from the codebase via <code className="font-mono text-text-secondary">npm run livingcode:refresh</code> so the skill never drifts from the runtime. Distributed as a zip download, mirrored into <code className="font-mono text-text-secondary">~/.claude/skills/</code> by the refresh, and shipped inside the Claude Code / Codex / Hermes plugin manifests.
              </p>
              <CodeBlock title="Download">{`# Zip download (regenerated on every livingcode refresh):
curl -O ${'`'}https://${'<'}your-deployment${'>'}/downloads/dashclaw-platform-intelligence.zip${'`'}

# Source files:
ls public/downloads/dashclaw-platform-intelligence/
#   SKILL.md            (auto-generated from livingcode shape)
#   references/         (api-surface, platform-knowledge, troubleshooting)
#   scripts/            (bootstrap-agent-quick, diagnose, validate-integration)

# Or just run the refresh — installs to ~/.claude/skills/ automatically:
npm run livingcode:refresh`}</CodeBlock>
            </div>
          </section>

          {/* ── Constructor ── */}
          <section id="constructor" className="scroll-mt-20 py-12 border-b border-border">
            <h2 className="text-2xl font-bold tracking-tight mb-2">Constructor</h2>
            <DocsCodeTabs
              nodeSnippet={`const claw = new DashClaw({ baseUrl, apiKey, agentId, agentName, authToken });`}
              pythonSnippet='claw = DashClaw(base_url="...", api_key="...", agent_id="...", agent_name="...", auth_token="...")'
            />
            <div className="mt-6">
              <ParamTable params={[
                { name: 'baseUrl / base_url', type: 'string', required: true, desc: 'Dashboard URL' },
                { name: 'apiKey / api_key', type: 'string', required: true, desc: 'API Key' },
                { name: 'agentId / agent_id', type: 'string', required: true, desc: 'Unique Agent ID' },
                { name: 'agentName / agent_name', type: 'string', required: false, desc: 'Human-readable agent label stored in audit trail for attribution. Automatically included on guard() calls if not overridden.' },
                { name: 'authToken / auth_token', type: 'string', required: false, desc: 'Phase 2 — JWT bearer token from your OIDC provider. When set, the server verifies the signature via JWKS and returns verification_status on every guard response; the JWT sub claim overrides agent_id in the audit record. See docs/agent-identity.md.' },
              ]} />
            </div>
          </section>

          {/* ── Behavior Guard ── */}
          <section id="behavior-guard" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-status-info-subtle flex items-center justify-center">
                <Shield size={16} className="text-info" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Behavior Guard</h2>
            </div>
            <MethodEntry
              id="guard"
              signature="claw.guard(context)"
              description="Evaluate guard policies for a proposed action. Call this before risky operations. With a non_fabrication policy active, pass `content` + `sourceOfTruth` to verify outbound text before it goes out — a violation blocks (or routes to approval) and is returned under `non_fabrication` with a signed, re-verifiable receipt."
              params={[
                { name: 'action_type', type: 'string', required: true, desc: 'Proposed action type' },
                { name: 'risk_score', type: 'number', required: false, desc: '0-100' },
                { name: 'content', type: 'string', required: false, desc: 'Outbound text to non-fabrication check (used by a non_fabrication policy)' },
                { name: 'sourceOfTruth', type: 'object', required: false, desc: 'Facts the content may state: { allowedFacts, requiredFacts, forbiddenPatterns?, extract? }' },
              ]}
              returns="Promise<{ decision: string, reasons: string[], risk_score: number, risk_breakdown: object, agent_risk_score: number | null, non_fabrication?: object[] }>"
              example={
                <DocsCodeTabs
                  nodeSnippet="const result = await claw.guard({ action_type: 'deploy', risk_score: 85 });"
                  pythonSnippet='result = claw.guard({"action_type": "deploy", "risk_score": 85})'
                />
              }
            />
            <div id="risk-breakdown" className="scroll-mt-20 mt-6 p-4 rounded-xl bg-surface-secondary border border-border">
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">Risk composition (risk_breakdown)</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                Every guard response carries a <code className="text-xs">risk_breakdown</code> sibling next to{' '}
                <code className="text-xs">risk_score</code> — an itemized ledger of how the score was composed, so
                no decision ever rests on an unexplained number:{' '}
                <code className="text-xs">base</code> (the action type&apos;s base score) →{' '}
                <code className="text-xs">modifiers</code> (server risk factors, each named with its points) →{' '}
                <code className="text-xs">server_total</code> →{' '}
                <code className="text-xs">template</code> (a matching risk template, if any) →{' '}
                <code className="text-xs">client_reported</code> (the risk_score you passed) →{' '}
                <code className="text-xs">effective</code> (the max of those — the server never lets a client
                under-report below its own floor) → <code className="text-xs">predictive</code> (history-based
                adjustment from the agent&apos;s failure rate and velocity) → <code className="text-xs">final</code>.
                The breakdown is persisted with the decision and rendered as the <em>Risk composition</em> panel on
                the action, decision, and replay detail pages.
              </p>
            </div>
            <div id="risk-calibration" className="scroll-mt-20 mt-6 p-4 rounded-xl bg-surface-secondary border border-border">
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">Risk calibration proposals</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                The score behind <code className="text-xs">guard</code> is pinned by a golden-vector corpus. DashClaw
                mines your own decision ledger for shapes where the scorer looks miscalibrated (over-scored benign
                actions, under-scored dangers, repeatedly approved shapes) and renders them as evidence cards on{' '}
                <code className="text-xs">/policies → Calibration proposals</code> — ratify and dismiss are buttons.
                The same proposals are available at <code className="text-xs">GET /api/calibration/proposals</code>;
                a ratified proposal is a recorded judgment (<code className="text-xs">?status=ratified</code> is the
                maintainer&apos;s forge queue). Nothing changes scoring until the vector is forged and committed.
              </p>
            </div>
            <div id="tightening-proposals" className="scroll-mt-20 mt-6 p-4 rounded-xl bg-surface-secondary border border-border">
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">Tightening proposals</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                Policy-tuning proposals only ever <em>loosen</em> (raise thresholds that over-interrupt).
                Tightening proposals own the other direction: when the same high-risk action type repeatedly
                reaches <code className="text-xs">allow</code> with no policy in its way, the pattern — mirrored
                one-to-one from the posture finding — is rendered as an evidence card on{' '}
                <code className="text-xs">/policies → Tightening proposals</code>. Ratify creates an active{' '}
                <code className="text-xs">require_approval</code> policy for that action type in the same click
                and resolves the posture finding; dismiss records why and stops the re-proposal. The same queue
                is available at <code className="text-xs">GET /api/policies/tightening</code>. Nothing
                auto-applies — every policy exists because a human ratified it.
              </p>
            </div>
            <div id="loosening-proposals" className="scroll-mt-20 mt-6 p-4 rounded-xl bg-surface-secondary border border-border">
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">Loosening proposals</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                The tightening mirror. When a policy&apos;s interruptions are approved ~100% of the time —
                a wrong interrupt by definition — the pattern renders as an evidence card in the{' '}
                <code className="text-xs">/policies</code> judgment queue. Ratify relaxes the policy in the
                same click: carve the always-approved action type out of its envelope (the rest stays
                governed) or, when no surgical fix exists, deactivate it. Undo keeps the change — the policy
                is a first-class row at <code className="text-xs">/policies</code>. The same queue is
                available at <code className="text-xs">GET /api/policies/loosening</code>. Harness traffic
                never counts as evidence, and risk-threshold policies stay with tuning.
              </p>
            </div>
          </section>

          {/* ── Action Recording ── */}
          <section id="action-recording" className="scroll-mt-20 pt-12">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <Zap size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Action Recording</h2>
            </div>
            <MethodEntry
              id="createAction"
              signature="claw.createAction(action) / claw.create_action(**kwargs)"
              description="Create a governance action record. The server re-evaluates policy at this point, so this call is the authoritative source for HITL gating: if policy requires human review, the response is HTTP 202 with action.status='pending_approval'. Always check action.status before assuming the action is clear to execute. Non-fabrication (optional): pass content + sourceOfTruth (Node) / content + source_of_truth (Python) to have a non_fabrication policy verify the outbound content before the action proceeds — a violation blocks or routes to approval and is recorded with a signed receipt. Session linkage (optional): pass session_id (the sess_… id from a started agent session) to attribute this action to that session, so /sessions can aggregate per-session action count, cost, and risk."
              returns="Promise<{ action: { action_id, status, ... }, action_id, decision, security }>"
              example={
                <DocsCodeTabs
                  nodeSnippet={`const { action, action_id } = await claw.createAction({ action_type: 'deploy' });
if (action?.status === 'pending_approval') {
  // gate execution on waitForApproval — see the method below
}`}
                  pythonSnippet={`created = claw.create_action(action_type="deploy")
if created.get("action", {}).get("status") == "pending_approval":
    claw.wait_for_approval(created["action_id"])`}
                />
              }
            />
            <MethodEntry
              id="waitForApproval"
              signature="claw.waitForApproval(actionId, { timeout?, interval? }) / claw.wait_for_approval(action_id, timeout=300, interval=5)"
              description="Wait for a human operator to approve or deny an action. Opens an SSE stream on /api/stream and falls back to polling /api/actions/:id every 5 seconds. Resolves when action.approved_by is set; throws ApprovalDeniedError when the operator denies AND when the approval expires server-side before a decision (a distinct third outcome — check err.status === 'expired' to tell a lapsed window from an operator 'no'; expired approvals render in their own section on /approvals and can no longer release anything); throws on timeout. IMPORTANT: pass the action_id returned by createAction() — NOT the action_id returned by guard(). They refer to different database tables and waiting on a guard decision ID will never resolve. Approvals can be resolved from the dashboard (/approvals), the CLI (dashclaw approve <id>), the mobile PWA (/approve), or — if the instance has Telegram configured (TELEGRAM_BOT_TOKEN) — via an inline Approve/Reject button pushed to the admin Telegram chat. All four surfaces call the same /api/approvals/:id endpoint, so waitForApproval unblocks the agent within ~1 second regardless of which surface was used."
              example={
                <DocsCodeTabs
                  nodeSnippet={`// Correct — wait on createAction's action_id
const { action, action_id } = await claw.createAction({ action_type: 'deploy' });
if (action?.status === 'pending_approval') {
  await claw.waitForApproval(action_id, { timeout: 600_000 });
}`}
                  pythonSnippet={`created = claw.create_action(action_type="deploy")
if created.get("action", {}).get("status") == "pending_approval":
    claw.wait_for_approval(created["action_id"], timeout=600)`}
                />
              }
            />
            <MethodEntry
              id="updateOutcome"
              signature="claw.updateOutcome(id, outcome) / claw.update_outcome(id, **kwargs)"
              description="Log final results. Accepts status, output_summary, error_message, duration_ms, tokens_in, tokens_out, model, cost_estimate. When tokens + model are supplied without cost_estimate, the server derives cost from the pricing table."
              example={
                <DocsCodeTabs
                  nodeSnippet={`await claw.updateOutcome(action_id, {
  status: 'completed',
  tokens_in: result.usage.input_tokens,
  tokens_out: result.usage.output_tokens,
  model: result.model,
});`}
                  pythonSnippet={`claw.update_outcome(
    action_id,
    status="completed",
    tokens_in=response.usage.input_tokens,
    tokens_out=response.usage.output_tokens,
    model=response.model,
)`}
                />
              }
            />
            <MethodEntry
              id="recordAssumption"
              signature="claw.recordAssumption(asm) / claw.record_assumption(asm)"
              description="Track agent beliefs."
              example={
                <DocsCodeTabs 
                  nodeSnippet="await claw.recordAssumption({ action_id, assumption: '...' });"
                  pythonSnippet='claw.record_assumption({"action_id": action_id, "assumption": "..."})'
                />
              }
            />
          </section>

          {/* ── Signals ── */}
          <section id="signals" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-status-error-subtle flex items-center justify-center">
                <ShieldAlert size={16} className="text-error" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Signals</h2>
            </div>
            <MethodEntry
              id="getSignals"
              signature="claw.getSignals() / claw.get_signals()"
              description="Get current risk signals across all agents."
              returns="Promise<{ signals: Object[] }>"
              example={
                <DocsCodeTabs 
                  nodeSnippet="const { signals } = await claw.getSignals();"
                  pythonSnippet="signals = claw.get_signals()"
                />
              }
            />
          </section>


          {/* ── Policies ── */}
          <section id="policies" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <Scale size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Policies</h2>
            </div>

            <MethodEntry
              id="simulatePolicy"
              signature="claw.simulatePolicy({ policy_type, rules, days })"
              description="Side-effect-free dry-run of a single proposed policy against recent historical actions — nothing is persisted. Use it to preview how a policy would have decided before committing it; pairs with guard() for live enforcement. Node SDK only."
              params={[
                { name: 'policy_type', type: 'string', required: true, desc: 'The policy type to simulate' },
                { name: 'rules', type: 'object', required: true, desc: 'The proposed policy rules' },
                { name: 'days', type: 'number', required: false, desc: 'How many days of historical actions to evaluate against' },
              ]}
              returns="Promise<{ summary: { total, matches, block, warn, require_approval, allow }, matches, sample_size, window_days }>"
              example={
                <CodeBlock title="Node.js">
{`const sim = await claw.simulatePolicy({
  policy_type: 'risk_threshold',
  rules: { max_risk_score: 70 },
  days: 30
});
console.log(sim.summary.block, 'of', sim.summary.total, 'would block');`}
                </CodeBlock>
              }
            />

            {/* AI Policy Generator (HTTP) */}
            <div id="policies-generate" className="scroll-mt-20 pt-10">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">AI Policy Generator</h3>
              <p className="text-xs text-text-tertiary mb-4">
                Turns a plain-English request into guard-policy drafts. The flow is iterative and never dead-ends: a clear request returns drafts; a vague one returns a best-effort draft plus suggested clarifications; an underspecified one returns clarifications only — never an empty &quot;be more specific&quot; rejection. Send the answered clarifications back in <code className="font-mono text-text-secondary">answers</code> to refine. Authored from <strong className="text-text-secondary">Policies → Custom → AI generator</strong> in the dashboard. Requires an LLM provider key in Settings; without one the endpoint returns <code className="font-mono text-text-secondary">422</code> with <code className="font-mono text-text-secondary">&quot;No LLM provider configured.&quot;</code>
              </p>

              <MethodEntry
                id="generatePolicies"
                signature="POST /api/policies/generate"
                description="Generate guard-policy drafts from natural language. dry_run (default true) previews drafts and is open to any org member; dry_run: false creates the drafts and is admin-only. The dashboard saves the reviewed/edited draft via POST /api/policies rather than creating with dry_run: false."
                params={[
                  { name: 'input_text', type: 'string', required: true, desc: 'Plain-English description of the policy you want (max 5000 chars)' },
                  { name: 'dry_run', type: 'boolean', required: false, desc: 'Preview only (default true). false creates the drafts and requires an admin key' },
                  { name: 'answers', type: '[{ id, value }]', required: false, desc: 'Answers to clarifications from a prior dry-run call, used to refine the drafts' },
                ]}
                returns="dry_run: { drafts: [{ name, policy_type, rules, confidence }], assumptions: string[], clarifications: [{ id, question, field, suggestions: string[], multi }], warnings, input_hash }"
                example={
                  <CodeBlock title="Iterative dry-run">
{`const res = await fetch(\`\${baseUrl}/api/policies/generate\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input_text: 'stop my agents from deleting things I care about',
    dry_run: true
  })
});
const { drafts, assumptions, clarifications } = await res.json();

// drafts → a best-effort protected_path draft
// [{
//   name: 'Protect critical paths from deletion',
//   policy_type: 'protected_path',
//   rules: { paths: ['.env', 'secrets/', 'migrations/'], action: 'block' },
//   confidence: 0.6
// }]
//
// assumptions → ['Assumed "things I care about" means config and secret files']
//
// clarifications → suggested-value chip sets to tighten the draft
// [
//   { id: 'paths', question: 'Which paths should be protected?', field: 'rules.paths',
//     suggestions: ['.env', 'secrets/', 'migrations/', 'src/'], multi: true },
//   { id: 'strictness', question: 'How strict should the guard be?', field: 'rules.action',
//     suggestions: ['block', 'require approval', 'warn'], multi: false }
// ]

// Refine by sending the picked answers back:
await fetch(\`\${baseUrl}/api/policies/generate\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input_text: 'stop my agents from deleting things I care about',
    dry_run: true,
    answers: [
      { id: 'paths', value: ['.env', 'secrets/', 'migrations/'] },
      { id: 'strictness', value: 'block' }
    ]
  })
});`}
                  </CodeBlock>
                }
              />
            </div>

            {/* Policy tuning proposals */}
            <div id="policy-tuning" className="scroll-mt-20 mt-10 p-4 rounded-xl bg-surface-secondary border border-border">
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">Policy tuning proposals</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                DashClaw mines your own decision outcomes for policies whose thresholds look wrong in practice — a
                gate every human rubber-stamps, a cap that never fires — and renders each as an evidence-backed
                proposal on <code className="text-xs">/policies</code>, where <em>Apply</em> and <em>Dismiss</em> are
                buttons (apply is a two-step confirm with an inline reason). The same feed is available at{' '}
                <code className="text-xs">GET /api/policies/proposals</code>, which returns{' '}
                <code className="text-xs">{'{ policies, proposals, degradation }'}</code>. Nothing changes a policy
                until a human clicks Apply.
              </p>
            </div>

            {/* Degradation observability */}
            <div id="policy-degradation" className="scroll-mt-20 mt-10 p-4 rounded-xl bg-surface-secondary border border-border">
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">Degradation observability</h3>
              <p className="text-sm text-text-secondary leading-relaxed mb-2">
                Guard evaluation runs under a deadline (<code className="text-xs">DASHCLAW_GUARD_DEADLINE_MS</code>,
                default 3500&nbsp;ms). When the deadline fires or an evaluation phase fails (for example a policy
                webhook), the guard does not silently allow: it falls back — per-policy{' '}
                <code className="text-xs">on_failure</code> override first, then the instance-wide{' '}
                <code className="text-xs">DASHCLAW_GUARD_FALLBACK</code>, then fail-closed{' '}
                <code className="text-xs">require_approval</code> — and marks the decision <em>degraded</em>.
              </p>
              <p className="text-sm text-text-secondary leading-relaxed">
                Degradations are observable, not just recorded:{' '}
                <code className="text-xs">GET /api/policies/proposals?days=30</code> returns a{' '}
                <code className="text-xs">degradation</code> rollup —{' '}
                <code className="text-xs">{'{ window_days, total, degraded, rate, last_degraded_at, by_day }'}</code>{' '}
                — and <code className="text-xs">/policies</code> renders it as a strip
                (&quot;N of M decisions were deadline degradations&quot;) whenever the count is non-zero. A rising
                rate means your policies are being decided by fallback, not evaluation — tune the deadline or the
                failing phase.
              </p>
            </div>
          </section>



          {/* ── Security Scanning ── */}
          <section id="security-scanning" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-status-error-subtle flex items-center justify-center">
                <ShieldAlert size={16} className="text-error" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Security Scanning</h2>
            </div>

            <MethodEntry
              id="scanPromptInjection"
              signature="claw.scanPromptInjection(text) / claw.scan_prompt_injection(text)"
              description="Scan untrusted input for potential prompt injection or jailbreak attempts."
              params={[
                { name: 'text', type: 'string', required: true, desc: 'Untrusted input to scan' },
              ]}
              returns="Promise<{ clean: boolean, risk_level: string, recommendation: string }>"
              example={
                <DocsCodeTabs
                  nodeSnippet={`const result = await claw.scanPromptInjection(userInput);
if (!result.clean) {
  console.warn('Injection risk:', result.risk_level);
}`}
                  pythonSnippet={`result = claw.scan_prompt_injection(user_input)
if not result["clean"]:
    print(f"Injection risk: {result['risk_level']}")`}
                />
              }
            />
          </section>

          {/* ── Agent Identity ── */}
          <section id="agent-identity" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <Shield size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Agent Identity</h2>
            </div>
            <p className="text-sm text-text-secondary mb-6 leading-relaxed">
              DashClaw verifies <em>which agent</em> took each action on three independent axes, each returned on the guard response and recorded in the decisions ledger. The current path is JWKS-verified JWTs (Phase&nbsp;2&nbsp;/&nbsp;2b&nbsp;/&nbsp;2c); the public-key pairing API further down remains for older (v1) integrations. Full setup guide:{' '}
              <a href="https://github.com/ucsandman/DashClaw/blob/main/docs/agent-identity.md" className="text-brand hover:underline">docs/agent-identity.md</a>.
            </p>

            <h3 className="text-lg font-semibold tracking-tight mt-8 mb-2">JWKS verification (Phase 2 / 2b / 2c)</h3>
            <p className="text-sm text-text-secondary mb-4 leading-relaxed">
              Attach an OIDC bearer token (or pass <code className="text-brand">authToken</code> to the SDK constructor). DashClaw fetches the issuer&apos;s keys from its <code className="text-brand">/.well-known/jwks.json</code>, verifies the signature (EdDSA, RS256&ndash;512, ES256&ndash;512), and on success overrides any body-supplied <code className="text-brand">agent_id</code> with the token&apos;s <code className="text-brand">sub</code> — proof beats self-assertion. A downed issuer fails soft to <code className="text-brand">unverified</code> and never blocks a decision.
            </p>
            <CodeBlock title="Guard with a verified identity">
{`import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  authToken: agentJwt,          // OIDC bearer token minted by your IdP
});

const { decision, verification_status } = await claw.guard({
  action_type: 'deploy', risk_score: 80,
});
// verification_status: 'verified' | 'unverified' | 'expired'
//                    | 'failed' | 'unknown_issuer' | 'exp_too_far'`}
            </CodeBlock>
            <p className="text-sm text-text-secondary mt-4 mb-2 leading-relaxed">
              Three independent axes travel back on the response, each in its own field so a downed issuer or absent claim degrades gracefully instead of hard-failing:
            </p>
            <ul className="text-sm text-text-secondary mb-4 leading-relaxed list-disc pl-5 space-y-1">
              <li><strong>Phase 2 — <code className="text-brand">verification_status</code></strong>: who signed the token. Configure trust with <code className="text-brand">DASHCLAW_ALLOWED_ISSUER</code> and <code className="text-brand">DASHCLAW_JWT_AUDIENCE</code>.</li>
              <li><strong>Phase 2b — <code className="text-brand">replay_status</code></strong>: whether the token was reused. <code className="text-brand">DASHCLAW_JTI_REPLAY_PROTECTION</code> (<code>off</code> / <code>best_effort</code> / <code>required</code>, default <code>required</code>) blocks a replayed <code className="text-brand">jti</code> — verified-JWT traffic only; API-key callers are never touched by it.</li>
              <li><strong>Phase 2c — <code className="text-brand">act_status</code></strong>: whether the token is bound to <em>this</em> call. <code className="text-brand">DASHCLAW_ACT_BINDING</code> (default <code>best_effort</code> — blocks only a positive <code>mismatch</code>) compares the request against the token&apos;s <code className="text-brand">urn:dashclaw:act-binding</code> claim.</li>
            </ul>

            <h3 id="composed-identities" className="scroll-mt-20 text-lg font-semibold tracking-tight mt-10 mb-2">Composed identities (per-harness families)</h3>
            <p className="text-sm text-text-secondary mb-4 leading-relaxed">
              One operator runs the same logical agent across several harnesses, and each harness spawns sub-agents.
              DashClaw encodes this as composed ids: <code className="text-brand">&lt;parent&gt;:&lt;sub&gt;</code>{' '}
              — e.g. <code className="text-brand">claude-code:explore</code> is the explore sub-agent of the{' '}
              <code className="text-brand">claude-code</code> parent. The base id before the first{' '}
              <code className="text-brand">:</code> is the <em>family</em>. No registration step is needed — the
              convention alone activates the behavior:
            </p>
            <ul className="text-sm text-text-secondary mb-6 leading-relaxed list-disc pl-5 space-y-1">
              <li><strong>Governance inheritance</strong> — pairing and permission lookups for a composed id fall back to the parent&apos;s row when no exact row exists; an exact row always wins. Sub-agents are governed from day one without per-sub setup.</li>
              <li><strong>Fleet grouping</strong> — composed ids nest under their parent, so a harness&apos;s sub-agent swarm reads as one family (the fan-outs view), not fleet noise.</li>
            </ul>

            <h3 className="text-lg font-semibold tracking-tight mt-10 mb-2">Public-key pairing</h3>
            <p className="text-sm text-text-secondary mb-6 leading-relaxed">
              Enroll agents via public-key pairing and manage approved identities. Pairing requests are created by agents; approval is an operator action (one click on the /identities page). Once approved, the agent&apos;s public key is registered as a trusted identity for signature verification.
            </p>

            <MethodEntry
              id="createPairing"
              signature="POST /api/pairings"
              description="Create an agent pairing request. The agent submits its public key and waits for operator approval."
              params={[
                { name: 'public_key', type: 'string', required: true, desc: 'PEM-encoded RSA public key' },
                { name: 'algorithm', type: 'string', required: false, desc: 'Key algorithm. Default: RSASSA-PKCS1-v1_5' },
                { name: 'agent_name', type: 'string', required: false, desc: 'Human-readable label for the agent' },
              ]}
              returns="{ pairing: { id, status, agent_name, created_at } }"
              example={
                <CodeBlock title="Create pairing request">
{`// Node SDK — pairing enrollment is canonical
import { DashClaw } from 'dashclaw';
const claw = new DashClaw({ baseUrl, apiKey, agentId });

const { pairing } = await claw.createPairing(publicKeyPem, { algorithm: 'RSASSA-PKCS1-v1_5', agentName: 'my-agent' });
console.log(pairing.id); // pair_...`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="listPairings"
              signature="GET /api/pairings"
              description="List all pairing requests for the organization. Admin API key required."
              returns="{ pairings: Array<{ id, status, agent_name, created_at, approved_at }> }"
              example={
                <CodeBlock title="List pairings (admin)">
{`const res = await fetch('/api/pairings', {
  headers: { 'x-api-key': adminApiKey }
});
const { pairings } = await res.json();`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="getPairing"
              signature="GET /api/pairings/:id"
              description="Get a specific pairing request by ID. Used by agents to poll for approval status."
              returns="{ pairing: { id, status, agent_name, created_at, approved_at } }"
              example={
                <CodeBlock title="Poll pairing status">
{`// Node SDK: block until the operator approves (or poll the route directly)
const paired = await claw.waitForPairing(pairingId);
// HTTP: GET /api/pairings/:id -> { pairing: { status: 'pending' | 'approved' | 'expired' } }`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="approvePairing"
              signature="POST /api/pairings/:id/approve"
              description="Approve a pending pairing request. Admin API key required. On approval, the agent's public key is registered as a trusted identity."
              returns="{ pairing: { id, status, approved_at } }"
              example={
                <CodeBlock title="Approve pairing (admin)">
{`const res = await fetch(\`/api/pairings/\${pairingId}/approve\`, {
  method: 'POST',
  headers: { 'x-api-key': adminApiKey }
});`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="registerIdentity"
              signature="POST /api/identities"
              description="Directly register an agent's public key as a trusted identity. Admin API key required. Bypasses the pairing flow."
              params={[
                { name: 'agent_id', type: 'string', required: true, desc: 'Unique agent identifier' },
                { name: 'public_key', type: 'string', required: true, desc: 'PEM-encoded RSA public key' },
                { name: 'algorithm', type: 'string', required: false, desc: 'Key algorithm. Default: RSASSA-PKCS1-v1_5' },
              ]}
              returns="{ identity: { agent_id, algorithm, created_at } }"
              example={
                <CodeBlock title="Register identity (admin)">
{`// HTTP (admin key)
await fetch(baseUrl + '/api/identities', {
  method: 'POST',
  headers: { 'x-api-key': adminKey, 'content-type': 'application/json' },
  body: JSON.stringify({ agent_id: 'agent-007', public_key: publicKeyPem, algorithm: 'RSASSA-PKCS1-v1_5' }),
});`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="listIdentities"
              signature="GET /api/identities"
              description="List all registered agent identities for the organization. Admin API key required."
              returns="{ identities: Array<{ agent_id, algorithm, created_at }> }"
              example={
                <CodeBlock title="List identities (admin)">
{`// HTTP (admin key)
const res = await fetch(baseUrl + '/api/identities', { headers: { 'x-api-key': adminKey } });
const { identities } = await res.json();`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="revokeIdentity"
              signature="DELETE /api/identities/:agentId"
              description="Revoke a registered agent identity. Admin API key required. The agent's public key is removed and signature verification will fail for future actions."
              returns="{ success: true }"
              example={
                <CodeBlock title="Revoke identity (admin)">
{`const res = await fetch(\`/api/identities/\${agentId}\`, {
  method: 'DELETE',
  headers: { 'x-api-key': adminApiKey }
});`}
                </CodeBlock>
              }
            />
          </section>

          {/* ── Execution Studio (HTTP API) ── */}
          <section id="execution-studio" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-surface-tertiary flex items-center justify-center">
                <Network size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Execution Studio (HTTP API)</h2>
            </div>
            <p className="text-sm text-text-secondary leading-relaxed mb-6">
              Governance packaging: a read-only execution graph and durable action outcomes on actions. <strong className="text-text-secondary">Every surface here has a canonical SDK wrapper method in the Node SDK (see <code className="font-mono text-brand">sdk/dashclaw.js</code>, 28 methods total).</strong> The HTTP examples below are shown first because they&apos;re language-agnostic; the equivalent SDK calls are in <a href="https://github.com/ucsandman/DashClaw/blob/main/sdk/README.md" className="text-brand underline">sdk/README.md</a>. Full OpenAPI definitions are at <code className="font-mono text-text-tertiary">docs/openapi/critical-stable.openapi.json</code>.
            </p>

            {/* Execution Graph */}
            <div id="execution-graph" className="scroll-mt-20 pt-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Execution Graph</h3>
              <MethodEntry
                id="getActionGraph"
                signature="GET /api/actions/:actionId/graph"
                description="Read-only execution graph (nodes + edges) for any action. Reuses the existing trace data plus correlated assumptions and open loops — zero schema change. Powers the Graph tab on decision replay."
                returns="{ rootActionId, nodes: Array<{ id, type, status, riskScore, ... }>, edges: Array<{ source, target, type, label }> }"
                example={
                  <CodeBlock title="Fetch graph">
{`const res = await fetch(\`\${baseUrl}/api/actions/\${actionId}/graph\`, {
  headers: { 'x-api-key': apiKey }
});
const { rootActionId, nodes, edges } = await res.json();
// node ids: action:<id>, assumption:<id>, loop:<id>
// edge types: parent_child | related | assumption_of | loop_from`}
                  </CodeBlock>
                }
              />
            </div>

            {/* Action Outcome (durable execution finality) */}
            <div id="action-outcome" className="scroll-mt-20 pt-10">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Action Outcome</h3>
              <p className="text-xs text-text-tertiary mb-4">Five-state terminal outcome on every action — closes the audit-trail gap between &quot;what was approved&quot; and &quot;what actually completed.&quot; See <a href="https://github.com/ucsandman/DashClaw/blob/main/docs/architecture/durable-execution-finality.md" className="text-brand underline">durable-execution-finality.md</a>.</p>

              <MethodEntry
                id="reportActionOutcome"
                signature="POST /api/actions/:actionId/outcome"
                description="Record the terminal outcome of an approved action. One-shot: the first successful POST wins, subsequent POSTs return 409 with the current state. status must be one of completed | partial | failed. error_message is required when status=failed; progress (object) is required when status=partial. lost_confirmation is reserved for the system sweep."
                returns="{ outcome: { action_id, status, outcome_at, summary, error_message, progress, elapsed_ms }, security: { clean, findings_count } }"
                example={
                  <CodeBlock title="Report success">
{`await fetch(\`\${baseUrl}/api/actions/\${actionId}/outcome\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    status: 'completed',
    summary: 'Deployed dashclaw 2.13.4 to production'
  })
});`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="getActionOutcome"
                signature="GET /api/actions/:actionId/outcome"
                description="Read the current outcome state. Returns the full outcome shape including elapsed_ms (outcome_at − created_at, or now − created_at while still pending). Agents call this before retrying to avoid re-executing already-completed actions."
                returns="{ action_id, status, outcome_at, summary, error_message, progress, elapsed_ms }"
                example={
                  <CodeBlock title="Retry-safe poll">
{`const outcome = await fetch(
  \`\${baseUrl}/api/actions/\${actionId}/outcome\`,
  { headers: { 'x-api-key': apiKey } }
).then(r => r.json());

// completed → SKIP, failed | lost_confirmation → RETRY,
// pending → WAIT, partial → CLEANUP_THEN_RETRY`}
                  </CodeBlock>
                }
              />
            </div>

          </section>


          <section id="coverage" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Coverage</h3>
              <p className="text-xs text-text-tertiary mb-4">Event coverage — orthogonal to posture&apos;s policy coverage (&quot;is it governed&quot;). Answers &quot;did the ledger actually see everything that happened.&quot; The Claude Code Stop hook POSTs one fail-silent per-turn report comparing transcript <code className="text-brand">tool_use</code> ground truth against the session&apos;s recorded action map; every closed action also carries a <code className="text-brand">close_source</code> (outcome | stop_autoclose | direct) so outcome coverage is computable from durable data. Operator surface only; no SDK wrapper. Powers the Coverage column on the <code className="text-brand">/agents</code> page and a posture finding when either figure drops below 90% (min 20 sampled).</p>
              <MethodEntry
                id="coverage-get"
                signature="GET /api/coverage"
                description="Per-agent record coverage (sum(recorded)/sum(expected) over a 24h window) and outcome coverage (share of hook-recorded actions closed with a real outcome vs Stop-hook auto-close). An agent with no reports renders an explicit no-evidence state rather than 100%."
                params={[
                  { name: 'window_hours', type: 'number', required: false, desc: '1-168, default 24' },
                  { name: 'include_synthetic', type: 'string', required: false, desc: '"1" includes synthetic/loadtest agents — diagnostics only; real views and posture always exclude them' },
                ]}
                returns="{ coverage: [{ agentId, expected, recorded, recordPct, outcomePct, outcomeSample }], window_hours, lastUpdated }"
                example={
                  <CodeBlock title="Read fleet coverage">
{`const res = await fetch('/api/coverage', {
  headers: { 'x-api-key': apiKey },
});
const { coverage } = await res.json();`}
                  </CodeBlock>
                }
              />
            </div>
          </section>

          <section id="fanouts" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Fan-outs</h3>
              <p className="text-xs text-text-tertiary mb-4">Multi-agent lineage as persisted evidence, not a client-side guess. Every recorded action carries its harness session (<code className="text-brand">harness_session_id</code>); subagent leaf actions carry the subagent instance uuid (<code className="text-brand">subagent_uuid</code>); spawn rows carry the spawned agent&apos;s uuid via <code className="text-brand">outcome_metadata.spawned_agent_uuid</code> on the outcome PATCH — the one <code className="text-brand">outcome_metadata</code> key the server persists. A fan-out reads as one governed unit with per-leaf attribution, joined at read time. Powers the Fan-outs panel on the <code className="text-brand">/agents</code> page, deep-linking to <code className="text-brand">/swarm?swarm_id=&lt;harness_session_id&gt;</code>.</p>
              <MethodEntry
                id="fanouts-get"
                signature="GET /api/agents/fanouts"
                description="Recent multi-agent harness sessions, newest-first, grouped by harness_session_id. Synthetic/loadtest agents excluded from the default view."
                params={[
                  { name: 'window_hours', type: 'number', required: false, desc: '1-168, default 24' },
                  { name: 'limit', type: 'number', required: false, desc: '1-100, default 20' },
                  { name: 'include_synthetic', type: 'string', required: false, desc: '"1" includes synthetic/loadtest agents — diagnostics only; the /agents panel never sets it' },
                ]}
                returns="{ fanouts: [{ harness_session_id, parent_agent_id, agents, agent_count, spawn_count, action_count, linked_leaf_count, first_at, last_at }], window_hours, lastUpdated }"
                example={
                  <CodeBlock title="Read recent fan-outs">
{`const res = await fetch('/api/agents/fanouts', {
  headers: { 'x-api-key': apiKey },
});
const { fanouts } = await res.json();`}
                  </CodeBlock>
                }
              />
            </div>
          </section>

          {/* ── Hosted Provisioning (operator) ── */}
          <section id="hosted-provisioning" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <Network size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Hosted Provisioning (operator)</h2>
            </div>
            <p className="text-sm text-text-secondary mb-6">
              Operator-facing routes exposed only when <code className="font-mono text-text-secondary">DASHCLAW_HOSTED=true</code>. These are not SDK methods — they produce the API key that downstream SDKs consume. Self-host deploys are unaffected; all routes return 404 when the flag is unset.
            </p>
            <MethodEntry
              id="hosted-workspaces-post"
              signature="POST /api/hosted/workspaces"
              description="Mint a new trial workspace. Public, gated by DASHCLAW_HOSTED flag + Turnstile + IP rate limit. Returns the workspace ID, a one-time API key, and onboarding URL."
              params={[
                { name: 'turnstile_token', type: 'string', required: false, desc: 'Cloudflare Turnstile challenge token. Required in production; omit in dev bypass mode.' },
              ]}
              returns="{ workspace_id, api_key, endpoint, expires_at, trial_action_cap, key_prefix, next_steps_url }"
              example={
                <CodeBlock title="Mint a trial workspace">
{`curl -X POST https://hosted.example.com/api/hosted/workspaces \\
  -H "content-type: application/json" \\
  -d '{"turnstile_token": "..."}'
# → { "workspace_id": "org_...", "api_key": "oc_live_...", "endpoint": "...",
#     "expires_at": "...", "trial_action_cap": 10000, "key_prefix": "oc_live_",
#     "next_steps_url": "https://hosted.example.com/connect?hosted=org_..." }`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="hosted-workspaces-get"
              signature="GET /api/hosted/workspaces/:id"
              description="Admin: inspect a trial workspace. Requires an admin-role API key."
              params={[
                { name: 'id', type: 'string', required: true, desc: 'Workspace (org) ID, e.g. org_abc' },
              ]}
              returns="{ workspace_id, status, expires_at, actions_used, trial_action_cap, created_at }"
              example={
                <CodeBlock title="Inspect a trial workspace">
{`curl https://hosted.example.com/api/hosted/workspaces/org_abc \\
  -H "x-api-key: <admin_key>"`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="hosted-workspaces-delete"
              signature="DELETE /api/hosted/workspaces/:id"
              description="Admin: manually delete a trial workspace and revoke its API key."
              params={[
                { name: 'id', type: 'string', required: true, desc: 'Workspace (org) ID to delete' },
              ]}
              returns="{ deleted: true, workspace_id }"
              example={
                <CodeBlock title="Delete a trial workspace">
{`curl -X DELETE https://hosted.example.com/api/hosted/workspaces/org_abc \\
  -H "x-api-key: <admin_key>"`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="hosted-cleanup"
              signature="POST /api/hosted/cleanup"
              description="Cron-safe sweeper for expired trial workspaces. Accepts admin-role API key OR X-Cleanup-Secret header. Safe to run repeatedly — idempotent."
              params={[
                { name: 'X-Cleanup-Secret', type: 'header', required: false, desc: 'Shared secret set via HOSTED_CLEANUP_SECRET env var. Alternative to admin API key.' },
              ]}
              returns="{ swept: number, workspace_ids: string[] }"
              example={
                <CodeBlock title="Sweep expired trials (cron)">
{`curl -X POST https://hosted.example.com/api/hosted/cleanup \\
  -H "X-Cleanup-Secret: $HOSTED_CLEANUP_SECRET"`}
                </CodeBlock>
              }
            />
          </section>

          {/* ── Error Handling ── */}
          <section id="error-handling" className="scroll-mt-20 pt-12 border-t border-border">
            <h2 className="text-2xl font-bold tracking-tight mb-2">Error Handling</h2>
            <CodeBlock title="Error shape">{`{ message: "Validation failed", status: 400 }`}</CodeBlock>
          </section>

        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
