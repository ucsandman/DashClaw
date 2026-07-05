import { Suspense } from 'react';
import Link from 'next/link';
import {
  ArrowRight, ExternalLink, BookOpen,
  Terminal, Zap, CircleDot, Eye, ShieldAlert, BarChart3,
  ChevronRight, Network, FileCheck, Scale, Radio, Users,
  Newspaper, MessageSquare, SlidersHorizontal, Shield, History, Activity,
  ClipboardCheck
} from 'lucide-react';
import DashClawLogo from '../components/DashClawLogo';
import CopyDocsButton from '../components/CopyDocsButton';
import ConnectAgentButton from '../components/ConnectAgentButton';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import DocsSidebarClient from './DocsSidebarClient';
import DocsCodeTabs from './DocsCodeTabs';

export const metadata = {
  title: 'DashClaw SDK Documentation',
  description:
    'Canonical, up-to-date reference for the DashClaw SDK. Install, configure, and govern your AI agents across action recording, behavior guard, evaluation framework, scoring profiles, learning analytics, prompt management, feedback loops, behavioral drift, compliance exports, and more.',
};

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
  { href: '#quick-start', label: 'Quick Start' },
  { href: '#mcp-server', label: 'MCP Server' },
  { href: '#mcp-tools', label: 'Tools (33)', indent: true },
  { href: '#mcp-resources', label: 'Resources (6)', indent: true },
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
  { href: '#agent-lifecycle', label: 'Agent Lifecycle' },
  { href: '#heartbeat', label: 'heartbeat', indent: true },
  { href: '#reportConnections', label: 'reportConnections', indent: true },
  { href: '#loops-assumptions', label: 'Loops & Assumptions' },
  { href: '#learning-analytics', label: 'Learning Analytics' },
  { href: '#getLessons', label: 'getLessons', indent: true },
  { href: '#recordDecision', label: 'recordDecision', indent: true },
  { href: '#getLearningRecommendations', label: 'getLearningRecommendations', indent: true },
  { href: '#prompt-management', label: 'Prompt Management' },
  { href: '#listPromptTemplates', label: 'listPromptTemplates', indent: true },
  { href: '#getPromptTemplate', label: 'getPromptTemplate', indent: true },
  { href: '#createPromptTemplate', label: 'createPromptTemplate', indent: true },
  { href: '#updatePromptTemplate', label: 'updatePromptTemplate', indent: true },
  { href: '#deletePromptTemplate', label: 'deletePromptTemplate', indent: true },
  { href: '#listPromptVersions', label: 'listPromptVersions', indent: true },
  { href: '#createPromptVersion', label: 'createPromptVersion', indent: true },
  { href: '#getPromptVersion', label: 'getPromptVersion', indent: true },
  { href: '#activatePromptVersion', label: 'activatePromptVersion', indent: true },
  { href: '#getPromptStats', label: 'getPromptStats', indent: true },
  { href: '#listPromptRuns', label: 'listPromptRuns', indent: true },
  { href: '#evaluation-framework', label: 'Evaluation Framework' },
  { href: '#previewScorer', label: 'previewScorer', indent: true },
  { href: '#scoring-profiles', label: 'Scoring Profiles' },
  { href: '#policies', label: 'Policies' },
  { href: '#simulatePolicy', label: 'simulatePolicy', indent: true },
  { href: '#policies-generate', label: 'AI Policy Generator', indent: true },
  { href: '#policy-tuning', label: 'Tuning proposals', indent: true },
  { href: '#policy-degradation', label: 'Degradation observability', indent: true },
  { href: '#messaging', label: 'Agent Messaging' },
  { href: '#sendMessage', label: 'sendMessage', indent: true },
  { href: '#getInbox', label: 'getInbox', indent: true },
  { href: '#markRead', label: 'markRead', indent: true },
  { href: '#archiveMessages', label: 'archiveMessages', indent: true },
  { href: '#handoffs', label: 'Session Handoffs' },
  { href: '#createHandoff', label: 'createHandoff', indent: true },
  { href: '#getLatestHandoff', label: 'getLatestHandoff', indent: true },
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
  { href: '#workflow-templates', label: 'Workflow Templates', indent: true },
  { href: '#model-strategies-http', label: 'Model Strategies', indent: true },
  { href: '#knowledge-collections', label: 'Knowledge Collections', indent: true },
  { href: '#deleteKnowledgeCollection', label: 'deleteKnowledgeCollection', indent: true },
  { href: '#capability-registry', label: 'Capability Registry', indent: true },
  { href: '#capability-runtime', label: 'Capability Runtime', indent: true },
  { href: '#analytics', label: 'Analytics' },
  { href: '#guard-decisions', label: 'Guard Decisions', indent: true },
  { href: '#agent-profile', label: 'Agent Profile', indent: true },
  { href: '#agent-reputation', label: 'Agent Reputation' },
  { href: '#agent-registry', label: 'Agent Registry' },
  { href: '#x402-spend-governance', label: 'x402 Spend Governance' },
  { href: '#x402-budget-tiers', label: 'Spend limit tiers', indent: true },
  { href: '#x402Budget', label: 'GET /api/x402/budget', indent: true },
  { href: '#finops-spend', label: 'FinOps Spend' },
  { href: '#governance-posture', label: 'Governance Posture' },
  { href: '#posture-score', label: 'GET /api/posture', indent: true },
  { href: '#posture-findings', label: 'Findings queue', indent: true },
  { href: '#posture-resolve', label: 'Resolve a finding', indent: true },
  { href: '#posture-scan', label: 'Scan (snapshot)', indent: true },
  { href: '#coverage', label: 'Coverage' },
  { href: '#coverage-get', label: 'GET /api/coverage', indent: true },
  { href: '#fanouts', label: 'Fan-outs' },
  { href: '#fanouts-get', label: 'GET /api/agents/fanouts', indent: true },
  { href: '#work-orders', label: 'Work Orders' },
  { href: '#submitWorkOrder', label: 'submitWorkOrder', indent: true },
  { href: '#getWorkOrder', label: 'getWorkOrder', indent: true },
  { href: '#listWorkOrders', label: 'listWorkOrders', indent: true },
  { href: '#cancelWorkOrder', label: 'cancelWorkOrder', indent: true },
  { href: '#claimWorkOrder', label: 'claimWorkOrder', indent: true },
  { href: '#completeWorkOrder', label: 'completeWorkOrder', indent: true },
  { href: '#listWorkOrderTypes', label: 'listWorkOrderTypes', indent: true },
  { href: '#registerWorkOrderType', label: 'registerWorkOrderType', indent: true },
  { href: '#code-sessions', label: 'Code Sessions' },
  { href: '#code-sessions-ingest', label: 'Ingest transcripts', indent: true },
  { href: '#code-sessions-optimal-files', label: 'Optimal Files', indent: true },
  { href: '#code-sessions-analytics', label: 'Cost & signals', indent: true },
  { href: '#hosted-provisioning', label: 'Hosted Provisioning (operator)' },
  { href: '#hosted-workspaces-post', label: 'POST /workspaces', indent: true },
  { href: '#hosted-workspaces-get', label: 'GET /workspaces/:id', indent: true },
  { href: '#hosted-workspaces-delete', label: 'DELETE /workspaces/:id', indent: true },
  { href: '#hosted-cleanup', label: 'POST /cleanup', indent: true },
  { href: '#error-handling', label: 'Error Handling' },
  { href: '#legacy-v1', label: 'Legacy API (v1)', legacy: true },
  { href: '#real-time-events', label: 'Real-Time Events', indent: true, legacy: true },
  { href: '#dashboard-data', label: 'Dashboard Data', indent: true, legacy: true },
  { href: '#automation-snippets', label: 'Automation Snippets', indent: true, legacy: true },
  { href: '#user-preferences', label: 'User Preferences', indent: true, legacy: true },
  { href: '#compliance-engine', label: 'Compliance Engine', indent: true, legacy: true },
  { href: '#mapCompliance', label: 'mapCompliance', indent: true, legacy: true },
  { href: '#getProofReport', label: 'getProofReport', indent: true, legacy: true },
  { href: '#activity-logs', label: 'Activity Logs', indent: true, legacy: true },
  { href: '#getActivityLogs', label: 'getActivityLogs', indent: true, legacy: true },
  { href: '#webhooks', label: 'Webhooks', indent: true, legacy: true },
  { href: '#createWebhook', label: 'createWebhook', indent: true, legacy: true },
];

/* ─── page ─── */

interface DocsPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DocsPage({ searchParams }: DocsPageProps) {
  const params = await searchParams;
  const showLegacy = params?.legacy === 'true';

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
              <code className="font-mono text-text-secondary">@dashclaw/mcp-server</code> exposes DashClaw governance over Model Context Protocol. Any MCP-compatible client gets 33 governance tools across 12 groups (core governance, optimal files, session continuity, credential hygiene, skill safety, open loops, learning + retrospection, agent inbox, agent identity, behavior learning, governance posture, work orders) plus 6 read-only resources.
            </p>

            {/* Tools */}
            <div id="mcp-tools" className="scroll-mt-20 mb-10">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Tools (33)</h3>
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
                      { group: 'Optimal files', tool: 'dashclaw_optimal_files_preview', desc: 'Preview optimizer output for a session', inputs: 'session_id' },
                      { tool: 'dashclaw_optimal_files_manifest', desc: 'Generate optimal-files manifest', inputs: 'session_id, selections' },
                      { group: 'Session continuity', tool: 'dashclaw_handoff_create', desc: 'Write handoff bundle for next session', inputs: 'bundle, agent_id, project_id' },
                      { tool: 'dashclaw_handoff_latest', desc: 'Fetch latest unconsumed handoff', inputs: 'agent_id, project_id' },
                      { tool: 'dashclaw_handoff_consume', desc: 'Mark handoff consumed (idempotent)', inputs: 'id, session_id' },
                      { group: 'Credential hygiene', tool: 'dashclaw_secret_list', desc: 'List tracked secrets (metadata only)', inputs: 'agent_id' },
                      { tool: 'dashclaw_secret_due', desc: 'Secrets coming due for rotation', inputs: 'within_days, agent_id' },
                      { tool: 'dashclaw_secret_mark_rotated', desc: 'Mark secret rotated (operator-confirmed)', inputs: 'id' },
                      { group: 'Skill safety', tool: 'dashclaw_skill_scan', desc: 'Static safety scan of skill files', inputs: 'skill_name, files' },
                      { group: 'Open loops', tool: 'dashclaw_loop_add', desc: 'Register action-scoped commitment', inputs: 'action_id, loop_type, description' },
                      { tool: 'dashclaw_loop_list', desc: 'List open/resolved loops', inputs: 'action_id, status, priority' },
                      { tool: 'dashclaw_loop_close', desc: 'Resolve an open loop', inputs: 'id, resolution' },
                      { group: 'Learning + retrospection', tool: 'dashclaw_assumption_record', desc: 'Record an unverified assumption underpinning an action', inputs: 'action_id, assumption, basis' },
                      { tool: 'dashclaw_learning_log', desc: 'Log non-obvious decision + outcome', inputs: 'decision, context, outcome' },
                      { tool: 'dashclaw_learning_query', desc: 'Query prior decisions/lessons', inputs: 'query, agent_id, limit' },
                      { tool: 'dashclaw_decisions_recent', desc: 'Recent governed-action ledger', inputs: 'agent_id, action_type, decision, since' },
                      { group: 'Agent inbox', tool: 'dashclaw_inbox_list', desc: 'List inbox messages + unread count', inputs: 'agent_id, direction, unread, type, limit' },
                      { tool: 'dashclaw_messages_mark_read', desc: 'Mark inbox messages as read', inputs: 'message_ids, agent_id' },
                      { group: 'Agent identity', tool: 'dashclaw_pair', desc: 'Enroll identity: generate keypair locally, submit public key for approval', inputs: 'agent_id, agent_name, wait' },
                      { group: 'Behavior learning', tool: 'dashclaw_behavior_suggestions', desc: 'Observe-only Policy Coach suggestions from recorded behavior', inputs: 'agent_id' },
                      { group: 'Governance posture', tool: 'dashclaw_posture', desc: 'Read the org governance posture score + 6 dimensions + findings queue (read-only)', inputs: 'dimension' },
                      { tool: 'dashclaw_posture_next', desc: 'The next prioritized remediation finding from the posture queue (read-only)', inputs: '(none)' },
                      { group: 'Work orders', tool: 'dashclaw_work_order_submit', desc: 'Submit a typed, budget-capped work order; guard-gated then queued for a worker', inputs: 'type, input, max_cost_usd, timeout_seconds' },
                      { tool: 'dashclaw_work_order_status', desc: 'Check a work order: lifecycle status, worker, guard decision, and (when terminal) the receipt', inputs: 'work_order_id' },
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
              <h3 className="text-lg font-semibold text-text-primary mb-4">Resources (6)</h3>
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
                      { uri: 'dashclaw://capabilities', desc: 'Available capabilities and health' },
                      { uri: 'dashclaw://agent/{agent_id}/history', desc: 'Recent action history (last 50)' },
                      { uri: 'dashclaw://status', desc: 'Instance health + operational metrics' },
                      { uri: 'dashclaw://code-sessions/projects', desc: 'Claude Code projects with ingested session data and per-project rollups' },
                      { uri: 'dashclaw://code-sessions/sessions/{session_id}', desc: 'Full detail for one ingested Code Session (session, messages, tool uses)' },
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
node cli/bin/dashclaw.js install codex --project /path/to/your/project --include-notify

# Backfill existing rollouts for analytics
node cli/bin/dashclaw.js code ingest-codex --dry-run
node cli/bin/dashclaw.js code ingest-codex`}</CodeBlock>
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
              description="Evaluate guard policies for a proposed action. Call this before risky operations. The guard response includes a `learning` field with historical performance context when available (recent scores, drift status, learned patterns, feedback summary). With a non_fabrication policy active, pass `content` + `sourceOfTruth` to verify outbound text before it goes out — a violation blocks (or routes to approval) and is returned under `non_fabrication` with a signed, re-verifiable receipt."
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

          {/* ── Agent Lifecycle ── */}
          <section id="agent-lifecycle" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-status-success-subtle flex items-center justify-center">
                <Activity size={16} className="text-success" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Agent Lifecycle</h2>
            </div>

            <MethodEntry
              id="heartbeat"
              signature="claw.heartbeat(status, metadata) / claw.heartbeat(status=..., metadata=...)"
              description="Report agent presence and health to the control plane. Call periodically to indicate the agent is alive."
              params={[
                { name: 'status', type: 'string', required: false, desc: "Agent status — 'online', 'busy', 'idle'. Defaults to 'online'" },
                { name: 'metadata', type: 'object', required: false, desc: 'Arbitrary metadata to include with the heartbeat' },
              ]}
              example={
                <DocsCodeTabs
                  nodeSnippet={`await claw.heartbeat('online', { cycle: 42, uptime_ms: 360000 });`}
                  pythonSnippet={`claw.heartbeat("online", metadata={"cycle": 42, "uptime_ms": 360000})`}
                />
              }
            />

            <MethodEntry
              id="reportConnections"
              signature="claw.reportConnections(connections) / claw.report_connections(connections)"
              description="Report active provider connections and their status. Appears in the agent's Fleet profile."
              params={[
                { name: 'connections', type: 'Array<Object>', required: true, desc: 'List of { name, type, status } connection objects' },
              ]}
              example={
                <DocsCodeTabs
                  nodeSnippet={`await claw.reportConnections([
  { name: 'OpenAI', type: 'llm', status: 'connected' },
  { name: 'Postgres', type: 'database', status: 'connected' },
]);`}
                  pythonSnippet={`claw.report_connections([
    {"name": "OpenAI", "type": "llm", "status": "connected"},
    {"name": "Postgres", "type": "database", "status": "connected"},
])`}
                />
              }
            />
          </section>

          {/* ── Loops & Assumptions ── */}
          <section id="loops-assumptions" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <CircleDot size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Loops & Assumptions</h2>
            </div>

            <p className="text-sm text-secondary leading-relaxed mb-6">
              The assumption ledger is the agent&apos;s advocate, not paperwork. Governance runs both ways: it protects
              the world from agents, and it protects the agent — from unfair blame (assumptions recorded before acting
              are evidence of reasonable behavior on known information), from weaponization (prompt-injection scan
              outcomes and non-fabrication receipts are persisted with each guard decision), and from bankrupting
              mistakes (x402 spend gates interrupt before money moves). Every governed action&apos;s detail record
              (<code className="text-xs">GET /api/actions/:id</code>) carries an <code className="text-xs">agent_defense</code> rollup
              — what the agent declared, what it assumed, the exact guard decision that governed it
              (joined by <code className="text-xs">guard_decision_id</code>), and each shield&apos;s outcome. Where a shield
              didn&apos;t run, the rollup says <code className="text-xs">not_recorded</code> — it never fabricates a clean bill.
              <code className="text-xs">GET /api/sessions/:id/retro</code> (and the <code className="text-xs">dashclaw_session_retro</code> MCP
              tool) composes these same per-action rollups across a whole session into one clean/review/flagged
              defensibility posture.
            </p>

            <MethodEntry
              id="registerOpenLoop"
              signature="claw.registerOpenLoop(actionId, type, desc) / claw.register_open_loop(...)"
              description="Register an unresolved dependency for a decision. Open loops track work that must be completed before the decision is fully resolved."
              params={[
                { name: 'action_id', type: 'string', required: true, desc: 'Associated action' },
                { name: 'loop_type', type: 'string', required: true, desc: 'The category of the loop' },
                { name: 'description', type: 'string', required: true, desc: 'What needs to be resolved' },
              ]}
              example={
                <DocsCodeTabs 
                  nodeSnippet={`await claw.registerOpenLoop(action_id, 'validation', 'Waiting for PR review');`}
                  pythonSnippet={`claw.register_open_loop(action_id, 'validation', 'Waiting for PR review')`}
                />
              }
            />

            <MethodEntry
              id="resolveOpenLoop"
              signature="claw.resolveOpenLoop(loopId, status, res) / claw.resolve_open_loop(...)"
              description="Resolve a pending loop."
              example={
                <DocsCodeTabs 
                  nodeSnippet={`await claw.resolveOpenLoop(loop_id, 'completed', 'Approved');`}
                  pythonSnippet={`claw.resolve_open_loop(loop_id, 'completed', 'Approved')`}
                />
              }
            />

            <MethodEntry
              id="recordAssumption"
              signature="claw.recordAssumption(asm) / claw.record_assumption(asm)"
              description="Record what the agent believed to be true when making a decision. Assumptions are the agent's alibi: when an outcome goes wrong, the ledger shows the agent acted reasonably on what it knew — and which belief was later invalidated, by whom, and why. They roll up into the action's agent_defense summary."
              example={
                <DocsCodeTabs 
                  nodeSnippet={`await claw.recordAssumption({ action_id, assumption: 'User is authenticated' });`}
                  pythonSnippet={`claw.record_assumption({'action_id': action_id, 'assumption': 'User is authenticated'})`}
                />
              }
            />
          </section>

          {/* ── Learning Analytics ── */}
          <section id="learning-analytics" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <Zap size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Learning Analytics</h2>
            </div>
            
            <MethodEntry
              id="getLearningVelocity"
              signature="claw.getLearningVelocity() / claw.get_learning_velocity()"
              description="Compute learning velocity (rate of score improvement) for agents."
              returns="Promise<{ velocity: Array<Object> }>"
              example={
                <DocsCodeTabs 
                  nodeSnippet={`const { velocity } = await claw.getLearningVelocity();`}
                  pythonSnippet={`velocity = claw.get_learning_velocity()`}
                />
              }
            />

            <MethodEntry
              id="getLearningCurves"
              signature="claw.getLearningCurves() / claw.get_learning_curves()"
              description="Compute learning curves per action type to measure efficiency gains."
              example={
                <DocsCodeTabs
                  nodeSnippet={`const curves = await claw.getLearningCurves();`}
                  pythonSnippet={`curves = claw.get_learning_curves()`}
                />
              }
            />

            <MethodEntry
              id="getLessons"
              signature="claw.getLessons({ actionType, limit }) / claw.get_lessons(action_type=..., limit=...)"
              description="Fetch consolidated lessons from scored outcomes — what DashClaw has learned about this agent's performance patterns."
              params={[
                { name: 'actionType', type: 'string', required: false, desc: 'Filter by action type' },
                { name: 'limit', type: 'number', required: false, desc: 'Max lessons to return (default 10)' },
              ]}
              returns="Promise<{ lessons: Object[], drift_warnings: Object[], agent_id: string }>"
              example={
                <DocsCodeTabs
                  nodeSnippet={`const { lessons, drift_warnings } = await claw.getLessons({ actionType: 'deploy' });\nlessons.forEach(l => console.log(l.guidance));`}
                  pythonSnippet={`result = claw.get_lessons(action_type="deploy")\nfor lesson in result["lessons"]:\n    print(lesson["guidance"])`}
                />
              }
            />

            <MethodEntry
              id="recordDecision"
              signature="claw.recordDecision(entry)"
              description="Record a decision/outcome into the learning ledger so the governance loop improves over time. agent_id is auto-injected from the constructor's agentId when omitted. Node SDK only."
              params={[
                { name: 'decision', type: 'string', required: true, desc: 'The decision that was made' },
                { name: 'context', type: 'string', required: false, desc: 'Situation the decision was made in' },
                { name: 'reasoning', type: 'string', required: false, desc: 'Why this decision was chosen' },
                { name: 'outcome', type: 'string', required: false, desc: 'What happened as a result' },
                { name: 'confidence', type: 'number', required: false, desc: 'Confidence in the decision' },
                { name: 'agent_id', type: 'string', required: false, desc: 'Overrides the constructor agentId for attribution' },
              ]}
              returns="Promise<{ decision: Object }>"
              example={
                <CodeBlock title="Node.js">
{`const { decision } = await claw.recordDecision({
  decision: 'Rolled back the auth-service deploy',
  context: 'The new deploy raised the error rate',
  reasoning: 'Faster recovery than a forward fix',
  outcome: 'Error rate returned to baseline',
  confidence: 0.9
});`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="getLearningRecommendations"
              signature="claw.getLearningRecommendations(filters)"
              description="Read learned recommendations for an agent/action_type from the learning ledger. agent_id defaults to the constructor's agentId when omitted. Node SDK only."
              params={[
                { name: 'agent_id', type: 'string', required: false, desc: 'Agent to read recommendations for (defaults to constructor agentId)' },
                { name: 'action_type', type: 'string', required: false, desc: 'Filter by action type' },
                { name: 'include_metrics', type: 'boolean', required: false, desc: 'Include supporting metrics in the response' },
                { name: 'lookback_days', type: 'number', required: false, desc: 'Window of history to consider' },
                { name: 'limit', type: 'number', required: false, desc: 'Max recommendations to return' },
              ]}
              example={
                <CodeBlock title="Node.js">
{`const recs = await claw.getLearningRecommendations({
  action_type: 'deploy',
  include_metrics: true,
  lookback_days: 30
});`}
                </CodeBlock>
              }
            />
          </section>

          {/* ── Prompt Management ── */}
          <section id="prompt-management" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <Newspaper size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Prompt Management</h2>
            </div>
            <MethodEntry 
              id="renderPrompt" 
              signature="claw.renderPrompt() / claw.render_prompt()" 
              description="Fetch rendered prompt from DashClaw."
              example={
                <DocsCodeTabs 
                  nodeSnippet={`const { rendered } = await claw.renderPrompt({
  template_id: 'marketing',
  variables: { company: 'Apple' }
});`}
                  pythonSnippet={`res = claw.render_prompt(
    template_id="marketing",
    variables={"company": "Apple"}
)
rendered = res["rendered"]`}
                />
              }
            />

            <p className="mt-8 text-xs text-text-tertiary leading-relaxed">
              <strong className="text-text-secondary">Prompt Library</strong> — versioned template management on top of <code className="font-mono text-text-secondary">renderPrompt</code>. Templates hold metadata; each template has one or more versions and exactly one active version, which is what <code className="font-mono text-text-secondary">renderPrompt</code> resolves. Create/update/delete and version mutations require an admin key. <strong className="text-text-secondary">Node SDK only</strong> (no Python equivalent yet).
            </p>

            <MethodEntry
              id="listPromptTemplates"
              signature="claw.listPromptTemplates(filters)"
              description="List prompt templates. Node SDK only."
              params={[
                { name: 'category', type: 'string', required: false, desc: 'Filter templates by category' },
              ]}
              returns="Promise<{ templates: Object[] }>"
              example={
                <CodeBlock title="Node.js">
{`const { templates } = await claw.listPromptTemplates({ category: 'marketing' });`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="getPromptTemplate"
              signature="claw.getPromptTemplate(templateId)"
              description="Fetch a single template by id. Node SDK only."
              example={
                <CodeBlock title="Node.js">
{`const template = await claw.getPromptTemplate('marketing');`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="createPromptTemplate"
              signature="claw.createPromptTemplate({ name, description, category })"
              description="Create a template (admin). Node SDK only."
              params={[
                { name: 'name', type: 'string', required: true, desc: 'Template name' },
                { name: 'description', type: 'string', required: false, desc: 'Human-readable description' },
                { name: 'category', type: 'string', required: false, desc: 'Grouping category' },
              ]}
              returns="Promise<{ id, name, description, category }>"
              example={
                <CodeBlock title="Node.js">
{`const tpl = await claw.createPromptTemplate({
  name: 'Cold outreach',
  description: 'First-touch sales email',
  category: 'sales'
});`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="updatePromptTemplate"
              signature="claw.updatePromptTemplate(templateId, patch)"
              description="Update a template's name, description, or category (admin). Node SDK only."
              example={
                <CodeBlock title="Node.js">
{`await claw.updatePromptTemplate('marketing', { category: 'growth' });`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="deletePromptTemplate"
              signature="claw.deletePromptTemplate(templateId)"
              description="Delete a template along with its versions and runs (admin). Node SDK only."
              returns="Promise<{ deleted: true }>"
              example={
                <CodeBlock title="Node.js">
{`await claw.deletePromptTemplate('marketing');`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="listPromptVersions"
              signature="claw.listPromptVersions(templateId)"
              description="List a template's versions, newest first. Node SDK only."
              returns="Promise<{ versions: Object[] }>"
              example={
                <CodeBlock title="Node.js">
{`const { versions } = await claw.listPromptVersions('marketing');`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="createPromptVersion"
              signature="claw.createPromptVersion(templateId, { content, model_hint, parameters, changelog })"
              description="Create a new version for a template (admin). Node SDK only."
              params={[
                { name: 'content', type: 'string', required: true, desc: 'The prompt body (may contain variables)' },
                { name: 'model_hint', type: 'string', required: false, desc: 'Suggested model for this version' },
                { name: 'parameters', type: 'object', required: false, desc: 'Default render parameters' },
                { name: 'changelog', type: 'string', required: false, desc: 'What changed in this version' },
              ]}
              example={
                <CodeBlock title="Node.js">
{`await claw.createPromptVersion('marketing', {
  content: 'Write a launch post for {{company}}.',
  model_hint: 'claude-sonnet',
  changelog: 'Initial draft'
});`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="getPromptVersion"
              signature="claw.getPromptVersion(templateId, versionId)"
              description="Fetch a single version of a template. Node SDK only."
              example={
                <CodeBlock title="Node.js">
{`const version = await claw.getPromptVersion('marketing', 'v3');`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="activatePromptVersion"
              signature="claw.activatePromptVersion(templateId, versionId)"
              description="Activate a version (admin). Activating one version deactivates the others for that template, so it becomes the version renderPrompt resolves. Node SDK only."
              example={
                <CodeBlock title="Node.js">
{`await claw.activatePromptVersion('marketing', 'v3');`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="getPromptStats"
              signature="claw.getPromptStats(filters)"
              description="Prompt usage analytics. Node SDK only."
              params={[
                { name: 'template_id', type: 'string', required: false, desc: 'Scope stats to a single template' },
              ]}
              example={
                <CodeBlock title="Node.js">
{`const stats = await claw.getPromptStats({ template_id: 'marketing' });`}
                </CodeBlock>
              }
            />

            <MethodEntry
              id="listPromptRuns"
              signature="claw.listPromptRuns(filters)"
              description="List recorded prompt runs. Node SDK only."
              params={[
                { name: 'template_id', type: 'string', required: false, desc: 'Filter by template' },
                { name: 'version_id', type: 'string', required: false, desc: 'Filter by version' },
                { name: 'limit', type: 'number', required: false, desc: 'Max runs to return' },
              ]}
              example={
                <CodeBlock title="Node.js">
{`const runs = await claw.listPromptRuns({ template_id: 'marketing', limit: 20 });`}
                </CodeBlock>
              }
            />
          </section>

          {/* ── Evaluation Framework ── */}
          <section id="evaluation-framework" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <FileCheck size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Evaluation Framework</h2>
            </div>

            <p className="text-sm text-secondary leading-relaxed mb-4">
              Evaluations grade the <em>quality</em> of what agents produce, where policies gate what agents are
              <em> allowed</em> to do. The loop has four parts. A <strong>scorer</strong> is a reusable grading rule —
              <code className="font-mono text-xs"> llm_judge</code> (a model judges the output against a rubric),
              <code className="font-mono text-xs"> regex</code> (pattern match), or
              <code className="font-mono text-xs"> range</code> (numeric bounds). A <strong>run</strong> applies scorers
              to a batch of recent recorded actions. Each graded action lands as a <strong>score</strong> (0–1, with a
              label and the scorer&apos;s reasoning). The <strong>distributions</strong> — per-scorer histograms and
              trends — render on the evaluations page, where runs are started and scorer configs can be previewed
              against a sample before anything persists.
            </p>
            <p className="text-sm text-secondary leading-relaxed mb-6">
              Start on the <a href="/evaluations" className="text-brand hover:underline">evaluations page</a>: define a
              scorer, test the config against a sample output, then run it over recent actions. Runs never mutate the
              actions they grade; scores are additive evidence on the ledger.
            </p>

            <MethodEntry
              id="createScorer"
              signature="claw.createScorer(name, type, config) / claw.create_scorer(...)"
              description="Create a reusable scorer definition for automated evaluation."
              params={[
                { name: 'name', type: 'string', required: true, desc: 'Scorer name' },
                { name: 'scorer_type', type: 'string', required: true, desc: 'Type (llm_judge, regex, range)' },
                { name: 'config', type: 'object', required: false, desc: 'Scorer configuration' },
              ]}
              example={
                <DocsCodeTabs
                  nodeSnippet={`await claw.createScorer('toxicity', 'regex', { pattern: 'bad-word' });`}
                  pythonSnippet={`claw.create_scorer('toxicity', 'regex', config={'pattern': 'bad-word'})`}
                />
              }
            />

            <MethodEntry
              id="previewScorer"
              signature="claw.previewScorer({ scorer_type, config, sample })"
              description="Dry-run a scorer config against a sample without persisting anything — no eval_scores row is written. Use it to validate a quality gate before wiring the scorer into a profile. Node SDK only."
              params={[
                { name: 'scorer_type', type: 'string', required: true, desc: 'Scorer type (llm_judge, regex, range)' },
                { name: 'config', type: 'object', required: false, desc: 'Scorer configuration to test' },
                { name: 'sample', type: 'object', required: false, desc: 'Sample input to score' },
              ]}
              returns="Promise<{ preview, scorer_type, result: { score, label, reasoning, error } }>"
              example={
                <CodeBlock title="Node.js">
{`const { result } = await claw.previewScorer({
  scorer_type: 'regex',
  config: { pattern: 'bad-word' },
  sample: { output: 'this contains a bad-word' }
});
console.log(result.score, result.label);`}
                </CodeBlock>
              }
            />
          </section>

          {/* ── Scoring Profiles ── */}
          <section id="scoring-profiles" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <SlidersHorizontal size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Scoring Profiles</h2>
            </div>
            
            <MethodEntry
              id="createScoringProfile"
              signature="claw.createScoringProfile(config) / claw.create_scoring_profile(...)"
              description="Define weighted quality scoring profiles across multiple scorers."
              example={
                <DocsCodeTabs 
                  nodeSnippet={`await claw.createScoringProfile({ 
  name: 'prod-quality', 
  dimensions: [{ scorer: 'toxicity', weight: 0.5 }] 
});`}
                  pythonSnippet={`claw.create_scoring_profile(
    name='prod-quality',
    dimensions=[{'scorer': 'toxicity', 'weight': 0.5}]
)`}
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
                default 3500&nbsp;ms). When the deadline fires or an evaluation phase fails (a policy webhook, the
                x402 budget sum), the guard does not silently allow: it falls back — per-policy{' '}
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

          {/* ── Agent Messaging ── */}
          <section id="messaging" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <MessageSquare size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Agent Messaging</h2>
            </div>

            <MethodEntry
              id="sendMessage"
              signature="claw.sendMessage(params) / claw.send_message(**kwargs)"
              description="Send a point-to-point message or broadcast to all agents in the organization."
              params={[
                { name: 'to', type: 'string', required: false, desc: 'Target agent ID (omit for broadcast)' },
                { name: 'body', type: 'string', required: true, desc: 'Message content' },
                { name: 'type', type: 'string', required: false, desc: 'action|info|lesson|question' },
                { name: 'urgent', type: 'boolean', required: false, desc: 'Mark as high priority' },
              ]}
              example={
                <DocsCodeTabs
                  nodeSnippet={`await claw.sendMessage({
  to: 'scout-agent-01',
  body: 'I have finished indexing the repository. You can start the analysis.',
  type: 'status'
});`}
                  pythonSnippet={`claw.send_message(
    to="scout-agent-01",
    body="I have finished indexing the repository. You can start the analysis.",
    type="status"
)`}
                />
              }
            />

            <MethodEntry
              id="getInbox"
              signature="claw.getInbox(options?) / claw.get_inbox(**kwargs)"
              description="Retrieve messages from the agent inbox with optional filtering."
              params={[
                { name: 'type', type: 'string', required: false, desc: 'Filter by message type' },
                { name: 'unread', type: 'boolean', required: false, desc: 'Only return unread messages' },
                { name: 'limit', type: 'number', required: false, desc: 'Max messages to return' },
              ]}
              returns="Promise<{ messages, total, unread_count }>"
              example={
                <DocsCodeTabs
                  nodeSnippet={`const { messages } = await claw.getInbox({ unread: true, limit: 10 });`}
                  pythonSnippet={`result = claw.get_inbox(unread=True, limit=10)`}
                />
              }
            />

            <MethodEntry
              id="markRead"
              signature="claw.markRead(messageIds) / claw.mark_read(message_ids)"
              description="Mark messages as read for this agent. Direct messages are marked read only for the target agent (or dashboard); broadcasts update read_by for the reading agent."
              params={[
                { name: 'messageIds', type: 'string[]', required: true, desc: 'Message IDs (msg_*) to mark read' },
              ]}
              returns="Promise<{ updated }>"
              example={
                <DocsCodeTabs
                  nodeSnippet={`const { updated } = await claw.markRead(['msg_abc123']);`}
                  pythonSnippet={`result = claw.mark_read(["msg_abc123"])`}
                />
              }
            />

            <MethodEntry
              id="archiveMessages"
              signature="claw.archiveMessages(messageIds) / claw.archive_messages(message_ids)"
              description="Archive messages for this agent so they no longer surface in the active inbox."
              params={[
                { name: 'messageIds', type: 'string[]', required: true, desc: 'Message IDs (msg_*) to archive' },
              ]}
              returns="Promise<{ updated }>"
              example={
                <DocsCodeTabs
                  nodeSnippet={`const { updated } = await claw.archiveMessages(['msg_abc123']);`}
                  pythonSnippet={`result = claw.archive_messages(["msg_abc123"])`}
                />
              }
            />
          </section>

          {/* ── Session Handoffs ── */}
          <section id="handoffs" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <Network size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Session Handoffs</h2>
            </div>

            <MethodEntry
              id="createHandoff"
              signature="claw.createHandoff(handoff) / claw.create_handoff(**kwargs)"
              description="Create a session handoff document to persist state between agent sessions or transfer context to another agent."
              example={
                <DocsCodeTabs
                  nodeSnippet={`await claw.createHandoff({
  summary: 'Completed initial data collection from Jira.',
  key_decisions: ['Prioritize high-severity bugs', 'Ignore closed tickets'],
  open_tasks: ['Run security scan on src/', 'Draft fix for #123'],
  next_priorities: ['Security audit']
});`}
                  pythonSnippet={`claw.create_handoff(
    summary="Completed initial data collection from Jira.",
    key_decisions=["Prioritize high-severity bugs", "Ignore closed tickets"],
    open_tasks=["Run security scan on src/", "Draft fix for #123"],
    next_priorities=["Security audit"]
)`}
                />
              }
            />

            <MethodEntry
              id="getLatestHandoff"
              signature="claw.getLatestHandoff() / claw.get_latest_handoff()"
              description="Retrieve the most recent handoff for the current agent."
              returns="Promise<Object|null>"
              example={
                <DocsCodeTabs
                  nodeSnippet={`const handoff = await claw.getLatestHandoff();`}
                  pythonSnippet={`handoff = claw.get_latest_handoff()`}
                />
              }
            />
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
              <li><strong>Fleet grouping</strong> — <code className="text-brand">/agents</code> nests composed ids under their parent, so a harness&apos;s sub-agent swarm reads as one family, not fleet noise.</li>
              <li><strong>Per-family budgets</strong> — agent-scoped x402 window budgets meter by family, so <code className="text-brand">claude-code</code> and its sub-agents draw down one shared budget.</li>
            </ul>

            <h3 className="text-lg font-semibold tracking-tight mt-10 mb-2">Legacy (v1): public-key pairing</h3>
            <p className="text-sm text-text-secondary mb-6 leading-relaxed">
              Predates JWKS verification and is retained for older integrations. Enroll agents via public-key pairing and manage approved identities. Pairing requests are created by agents; approval is an admin action. Once approved, the agent&apos;s public key is registered as a trusted identity for signature verification.
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
{`// Node SDK — pairing is on the deprecated dashclaw/legacy subpath
import { DashClaw } from 'dashclaw/legacy';
const claw = new DashClaw({ baseUrl, apiKey, agentId });

const { pairing } = await claw.createPairing(publicKeyPem, 'RSASSA-PKCS1-v1_5', 'my-agent');
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
{`// Node SDK (v1 legacy)
const status = await claw.getPairing(pairingId);
console.log(status.pairing.status); // pending | approved | expired`}
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
{`// Node SDK (v1 legacy)
await claw.registerIdentity('agent-007', publicKeyPem, 'RSASSA-PKCS1-v1_5');`}
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
{`// Node SDK (v1 legacy)
const { identities } = await claw.getIdentities();`}
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
              Governance packaging: workflow templates, model strategies, knowledge collections, a capability registry, and a read-only execution graph on actions. <strong className="text-text-secondary">Every surface here has a canonical SDK wrapper method in the v2 Node SDK (see <code className="font-mono text-brand">sdk/dashclaw.js</code>, 147 methods total).</strong> The HTTP examples below are shown first because they&apos;re language-agnostic; the equivalent SDK calls (<code className="font-mono text-brand">claw.listWorkflowTemplates</code>, <code className="font-mono text-brand">claw.execution.capabilities.invoke</code>, etc.) are in <a href="https://github.com/ucsandman/DashClaw/blob/main/sdk/README.md#execution-studio" className="text-brand underline">sdk/README.md → Execution Studio</a>. Full OpenAPI definitions are at <code className="font-mono text-text-tertiary">docs/openapi/critical-stable.openapi.json</code>.
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

            {/* Workflow Templates */}
            <div id="workflow-templates" className="scroll-mt-20 pt-10">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Workflow Templates</h3>
              <p className="text-xs text-text-tertiary mb-4">Package a repeatable operational pattern as a reusable, versioned asset linking policies, prompts, knowledge, capabilities, and a model strategy.</p>

              <MethodEntry
                id="listWorkflowTemplates"
                signature="GET /api/workflows/templates"
                description="List all workflow templates for the current org. Supports ?status=draft|active|archived, ?limit, ?offset."
                example={
                  <CodeBlock title="List templates">
{`const { templates } = await fetch(\`\${baseUrl}/api/workflows/templates\`, {
  headers: { 'x-api-key': apiKey }
}).then(r => r.json());`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="createWorkflowTemplate"
                signature="POST /api/workflows/templates"
                description="Create a workflow template. Slug auto-generated from name if omitted. Starts as v1, status=draft. Body fields: name (required), description, objective, steps, linked_prompt_template_ids, linked_policy_ids, linked_knowledge_collection_ids, linked_capability_ids, linked_capability_tags, model_strategy_id, status."
                example={
                  <CodeBlock title="Create template">
{`await fetch(\`\${baseUrl}/api/workflows/templates\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Release Hotfix',
    description: 'Ship urgent production patches safely',
    objective: 'Deploy with full policy + approval coverage',
    linked_policy_ids: ['pol_prod_deploy'],
    linked_capability_tags: ['deploy'],
    model_strategy_id: 'mst_balanced_default'
  })
});`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="updateWorkflowTemplate"
                signature="GET | PATCH /api/workflows/templates/:templateId"
                description="Fetch or partially update a template. PATCH bumps version by 1 when the steps array changes; all linked arrays and metadata can be updated in the same call."
                example={
                  <CodeBlock title="Update steps (bumps version)">
{`await fetch(\`\${baseUrl}/api/workflows/templates/\${templateId}\`, {
  method: 'PATCH',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    steps: [{ id: 'plan' }, { id: 'test' }, { id: 'deploy' }]
  })
});`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="duplicateWorkflowTemplate"
                signature="POST /api/workflows/templates/:templateId/duplicate"
                description="Clone a template as a new draft (version resets to 1, status='draft'). Accepts optional name and slug overrides in the body."
                example={
                  <CodeBlock title="Duplicate">
{`const { template } = await fetch(
  \`\${baseUrl}/api/workflows/templates/\${templateId}/duplicate\`,
  { method: 'POST', headers: { 'x-api-key': apiKey } }
).then(r => r.json());`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="launchWorkflowTemplate"
                signature="POST /api/workflows/templates/:templateId/launch"
                description="Launch a template. Creates a new row in action_records with trigger='workflow:<templateId>' and reasoning='WORKFLOW_LAUNCH_META=<json>' carrying the full template context. If the template links a model_strategy_id, the resolved config is fetched and snapshotted onto the launched action and the template. No schema columns were added to action_records — Phase 1 piggybacks on existing trace primitives."
                returns="{ launch: { action_id, template_id, template_version, launched_at, resolved_strategy } }"
                example={
                  <CodeBlock title="Launch and link to replay">
{`const { launch } = await fetch(
  \`\${baseUrl}/api/workflows/templates/\${templateId}/launch\`,
  {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: 'deploy-bot' })
  }
).then(r => r.json());

// The launched action is immediately traceable in decision replay
console.log(\`\${baseUrl}/decisions/\${launch.action_id}\`);`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="listWorkflowRuns"
                signature="GET /api/workflows/templates/:templateId/runs"
                description="List past workflow executions for a template. Each run is a parent action_record with step counts from workflow_step_results. Supports status, agent_id, limit, and offset query params."
                returns="{ template_id, runs: [{ run_action_id, template_id, status, agent_id, declared_goal, duration_ms, started_at, finished_at, step_count, steps_completed, steps_failed }], total }"
                example={
                  <CodeBlock title="List recent runs">
{`const runs = await fetch(
  \`\${baseUrl}/api/workflows/templates/\${templateId}/runs?limit=10\`,
  { headers: { 'x-api-key': apiKey } }
).then(r => r.json());

runs.runs.forEach(r =>
  console.log(\`\${r.status} — \${r.steps_completed}/\${r.step_count} steps — \${r.duration_ms}ms\`)
);`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="getWorkflowRun"
                signature="GET /api/workflows/templates/:templateId/runs/:runActionId"
                description="Fetch full run detail including all step results with complete input/output JSON. Powers the run detail page. Each step includes the resolved input after variable interpolation and the full output (no truncation)."
                returns="{ run_action_id, template_id, template_name, status, agent_id, declared_goal, duration_ms, started_at, finished_at, error_message, steps: [{ step_id, step_index, step_type, step_name, status, input, output, error_message, retry_count, duration_ms }] }"
                example={
                  <CodeBlock title="Inspect a failed run">
{`const run = await fetch(
  \`\${baseUrl}/api/workflows/templates/\${templateId}/runs/\${runActionId}\`,
  { headers: { 'x-api-key': apiKey } }
).then(r => r.json());

const failed = run.steps.filter(s => s.status === 'failed');
failed.forEach(s =>
  console.log(\`Step \${s.step_name} failed: \${s.error_message}\`)
);`}
                  </CodeBlock>
                }
              />
            </div>

            {/* Model Strategies */}
            <div id="model-strategies-http" className="scroll-mt-20 pt-10">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Model Strategies</h3>
              <p className="text-xs text-text-tertiary mb-4">Reusable provider/model strategy records (primary + fallback chain, cost/latency sensitivity, budget cap). Linked from workflow templates and snapshotted at launch.</p>

              <MethodEntry
                id="listModelStrategies"
                signature="GET | POST /api/model-strategies"
                description="List all strategies or create a new one. Config is validated server-side: primary.provider and primary.model are required; costSensitivity must be one of low | balanced | high-quality; latencySensitivity must be low | medium | high; maxBudgetUsd must be a number; maxRetries must be an integer; fallback, allowedProviders, and disallowedProviders must be arrays if provided."
                example={
                  <CodeBlock title="Create strategy">
{`await fetch(\`\${baseUrl}/api/model-strategies\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Balanced Default',
    description: 'GPT-4.1 primary, Claude Sonnet 4 fallback',
    config: {
      primary: { provider: 'openai', model: 'gpt-4.1' },
      fallback: [{ provider: 'anthropic', model: 'claude-sonnet-4' }],
      costSensitivity: 'balanced',
      latencySensitivity: 'medium',
      maxBudgetUsd: 0.5,
      maxRetries: 2,
      allowedProviders: ['openai', 'anthropic']
    }
  })
});`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="updateModelStrategy"
                signature="GET | PATCH | DELETE /api/model-strategies/:strategyId"
                description="Fetch, update, or delete a strategy. PATCH merges config patches over the existing config (primary fields preserved unless overridden). DELETE nulls out the soft reference on any linked workflow_templates rather than orphaning them."
                example={
                  <CodeBlock title="Patch budget only">
{`await fetch(\`\${baseUrl}/api/model-strategies/\${strategyId}\`, {
  method: 'PATCH',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ config: { maxBudgetUsd: 1.0 } })
});`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="completeWithStrategy"
                signature="POST /api/model-strategies/:strategyId/complete"
                description="Execute a chat completion using this strategy. Resolves BYOK provider credentials from org settings, walks the fallback chain (primary provider first, then each fallback), enforces maxBudgetUsd, and returns a normalized response. Supports task_mode to override primary with the corresponding taskModes entry. Providers supported: openai, anthropic, groq, together, perplexity. Returns 502 with provider_errors array when all providers fail."
                params={[
                  { name: 'messages', type: 'Array<{ role, content }>', required: true, desc: 'Chat messages (system, user, assistant)' },
                  { name: 'max_tokens', type: 'number', required: false, desc: 'Max output tokens (default 1024)' },
                  { name: 'temperature', type: 'number', required: false, desc: 'Sampling temperature (default 0.7)' },
                  { name: 'task_mode', type: 'string', required: false, desc: 'Override primary with taskModes[mode] if defined in strategy config' },
                ]}
                returns="{ content, provider, model, usage: { input_tokens, output_tokens }, cost_usd, fallback_used, attempts, strategy_id, strategy_name }"
                example={
                  <CodeBlock title="Execute completion with fallback">
{`const result = await claw.completeWithStrategy(strategyId, [
  { role: 'user', content: 'Summarize the deploy plan' }
], { max_tokens: 512, task_mode: 'reasoning' });

console.log(result.content);       // LLM response
console.log(result.provider);      // which provider handled it
console.log(result.cost_usd);      // estimated cost
console.log(result.fallback_used); // true if primary failed`}
                  </CodeBlock>
                }
              />
            </div>

            {/* Knowledge Collections */}
            <div id="knowledge-collections" className="scroll-mt-20 pt-10">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Knowledge Collections</h3>
              <p className="text-xs text-text-tertiary mb-4">Lightweight metadata layer for knowledge sources that workflows and agents can bind to. <strong className="text-text-secondary">No embedding or retrieval in Phase 1</strong> — metadata + tags only.</p>

              <MethodEntry
                id="listKnowledgeCollections"
                signature="GET | POST /api/knowledge/collections"
                description="List collections (filter by ?source_type) or create a new one. source_type must be one of files | urls | external | notes. New collections start with ingestion_status='empty' and doc_count=0."
                example={
                  <CodeBlock title="Create collection">
{`await fetch(\`\${baseUrl}/api/knowledge/collections\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Runbook Library',
    description: 'Incident response runbooks',
    source_type: 'files',
    tags: ['ops', 'oncall']
  })
});`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="getKnowledgeCollection"
                signature="GET | PATCH /api/knowledge/collections/:collectionId"
                description="Fetch or update a collection's metadata (name, description, source_type, tags, ingestion_status)."
                example={
                  <CodeBlock title="Fetch">
{`const { collection } = await fetch(
  \`\${baseUrl}/api/knowledge/collections/\${collectionId}\`,
  { headers: { 'x-api-key': apiKey } }
).then(r => r.json());`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="knowledgeCollectionItems"
                signature="GET | POST /api/knowledge/collections/:collectionId/items"
                description="List or add items in a collection. Adding an item increments the parent collection's doc_count atomically and transitions ingestion_status from 'empty' to 'pending' on the first item. Items carry source_uri (required), title, mime_type, status, and a metadata object."
                example={
                  <CodeBlock title="Add an item">
{`await fetch(
  \`\${baseUrl}/api/knowledge/collections/\${collectionId}/items\`,
  {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_uri: 'https://docs.example.com/runbook.md',
      title: 'Deploy runbook',
      mime_type: 'text/markdown'
    })
  }
);`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="syncKnowledgeCollection"
                signature="POST /api/knowledge/collections/:collectionId/sync"
                description="Caller-invoked ingestion: fetches source_uri content for each pending item, chunks text (~500 tokens with overlap), generates embeddings via BYOK OpenAI key (text-embedding-3-small, 1536 dims), and stores in the knowledge_chunks table (pgvector). Updates item status (pending → indexed/failed) and collection ingestion_status. Bounded to 50 items per call — designed for Vercel free tier (no cron required)."
                returns="{ sync: { ingested, failed, chunks_created, errors } }"
                example={
                  <CodeBlock title="Sync a collection">
{`// SDK
const { sync } = await claw.syncKnowledgeCollection(collectionId);
console.log(sync.ingested, sync.chunks_created);`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="searchKnowledgeCollection"
                signature="POST /api/knowledge/collections/:collectionId/search"
                description="Semantic search over chunked + embedded content. Embeds the query via BYOK OpenAI key, then uses pgvector cosine distance to find the most relevant chunks. Returns top-k results with similarity scores, chunk content, and source item metadata."
                params={[
                  { name: 'query', type: 'string', required: true, desc: 'Natural language search query' },
                  { name: 'limit', type: 'number', required: false, desc: 'Max results (default 5, max 20)' },
                ]}
                returns="{ query, collection_id, results: Array<{ chunk_id, item_id, content, score, position, token_count, title, source_uri }>, count }"
                example={
                  <CodeBlock title="Search a collection">
{`const { results } = await claw.searchKnowledgeCollection(
  collectionId,
  'How do I roll back a deploy?',
  { limit: 5 }
);
results.forEach(r => console.log(\`\${(r.score * 100).toFixed(1)}%: \${r.content.slice(0, 80)}\`));`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="deleteKnowledgeCollection"
                signature="claw.deleteKnowledgeCollection(collectionId)"
                description="Delete a collection (and its items/chunks). Node SDK only."
                returns="Promise<{ deleted, collection_id }>"
                example={
                  <CodeBlock title="Node.js">
{`const { deleted, collection_id } = await claw.deleteKnowledgeCollection(collectionId);`}
                  </CodeBlock>
                }
              />
            </div>

            {/* Capability Registry */}
            <div id="capability-registry" className="scroll-mt-20 pt-10 pb-4">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Capability Registry</h3>
              <p className="text-xs text-text-tertiary mb-4">Governed registry of callable capabilities with risk, approval, health, and (future) pricing metadata. Workflow templates can reference capabilities by id or by tag.</p>

              <MethodEntry
                id="listCapabilities"
                signature="GET | POST /api/capabilities"
                description="Search or register a capability. GET supports combinable filters: ?category, ?risk_level (low|medium|high|critical), ?search (ILIKE on name/description/tags). source_type must be one of internal_sdk | http_api | webhook | human_approval | external_marketplace. (org_id, slug) is unique — POST returns 409 on duplicate slug."
                example={
                  <CodeBlock title="Register a capability">
{`await fetch(\`\${baseUrl}/api/capabilities\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Send Slack Message',
    description: 'Posts to a configured Slack channel',
    category: 'messaging',
    source_type: 'http_api',
    auth_type: 'oauth',
    risk_level: 'medium',
    requires_approval: false,
    tags: ['notify', 'slack'],
    health_status: 'healthy',
    docs_url: 'https://docs.example.com/slack'
  })
});`}
                  </CodeBlock>
                }
              />

              <MethodEntry
                id="getCapability"
                signature="GET | PATCH | DELETE /api/capabilities/:capabilityId"
                description="Fetch, update, or delete a capability. PATCH validates risk_level and source_type enums on change. DELETE removes the capability (SDK: claw.deleteCapability(capabilityId))."
                example={
                  <CodeBlock title="Mark degraded">
{`await fetch(\`\${baseUrl}/api/capabilities/\${capabilityId}\`, {
  method: 'PATCH',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ health_status: 'degraded' })
});`}
                  </CodeBlock>
                }
              />
            </div>
          </section>

          {/* Capability Runtime */}
          <section id="capability-runtime" className="scroll-mt-20 pt-8">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Capability Runtime</h3>
              <p className="text-xs text-text-tertiary mb-4">Governed capability invocation with retry policies, circuit breaker, and health tracking. Capabilities with retry_policy retry transient failures automatically. Capabilities with circuit_breaker auto-block after consecutive failures (reset via test route).</p>
              <MethodEntry
                id="invokeCapability"
                signature="POST /api/capabilities/:capabilityId/invoke"
                description="Execute a governed capability invocation. Evaluates guard policies, scans for sensitive data, enforces quota, runs the HTTP call with optional retry, and records a full action audit trail. Returns retry_metadata when retry_policy is configured. Returns 503 circuit_breaker_open when the circuit breaker is tripped."
                example={
                  <CodeBlock title="Invoke with payload">
{`const res = await fetch(\`\${baseUrl}/api/capabilities/\${capabilityId}/invoke\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'What is x402?' })
});
const data = await res.json();
// data.success, data.action_id, data.result, data.elapsed_ms, data.governed
// data.retry_metadata (when retry_policy configured): { total_attempts, retried, attempts }`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="testCapability"
                signature="POST /api/capabilities/:capabilityId/test"
                description="Run a non-production validation call. Bypasses guard policies and circuit breaker. Updates capability health_status and certification_status based on the result. Use this to certify a capability or reset an open circuit breaker."
                example={
                  <CodeBlock title="Test a capability">
{`const res = await fetch(\`\${baseUrl}/api/capabilities/\${capabilityId}/test\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'test input' })
});
const data = await res.json();
// data.tested, data.health_status, data.certification_status`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="capabilityHealth"
                signature="GET /api/capabilities/:capabilityId/health"
                description="Fetch derived health summary including success rates (1d/7d), p95 latency, certification status, recent errors, and stale check. Computed from action_records over the past 7 days."
                example={
                  <CodeBlock title="Check capability health">
{`const res = await fetch(\`\${baseUrl}/api/capabilities/\${capabilityId}/health\`, {
  headers: { 'x-api-key': apiKey }
});
const health = await res.json();
// health.status (healthy|degraded|failing|untested)
// health.certification_status (certified|stale|failed|uncertified)
// health.success_rate_1d, health.success_rate_7d, health.p95_latency_ms`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="capabilityHistory"
                signature="GET /api/capabilities/:capabilityId/history"
                description="Fetch invocation and test event history for a capability. Filter by action_type (capability_invoke, capability_test) and status (completed, failed, running, pending_approval). Supports limit and offset pagination."
                example={
                  <CodeBlock title="Fetch recent failures">
{`const res = await fetch(\`\${baseUrl}/api/capabilities/\${capabilityId}/history?status=failed&limit=10\`, {
  headers: { 'x-api-key': apiKey }
});
const history = await res.json();
// history.events[].action_id, action_type, status, error_message, duration_ms`}
                  </CodeBlock>
                }
              />
            </div>
          </section>

          {/* ── Analytics ── */}
          <section id="analytics" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <BarChart3 size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
            </div>
            <MethodEntry
              id="getAnalytics"
              signature="GET /api/analytics"
              description="Fetch aggregated governance analytics for the organization over a rolling window. Includes action counts, guard decision totals, signal summaries, and assumption stats. Supports ?days (1–365, default 30)."
              params={[
                { name: 'days', type: 'number', required: false, desc: 'Rolling window in days (1–365). Defaults to 30.' },
              ]}
              returns="{ actions_total, actions_by_status, guard_decisions_total, guard_decisions_by_outcome, signals_total, assumptions_total }"
              example={
                <CodeBlock title="Fetch 7-day analytics">
{`const res = await fetch(\`\${baseUrl}/api/analytics?days=7\`, {
  headers: { 'x-api-key': apiKey }
});
const data = await res.json();
// data.actions_total, data.guard_decisions_total, data.signals_total`}
                </CodeBlock>
              }
            />

            {/* Guard Decisions */}
            <div id="guard-decisions" className="scroll-mt-20 pt-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Guard Decisions</h3>
              <MethodEntry
                id="listGuardDecisions"
                signature="GET /api/guard/decisions"
                description="List guard evaluation records for the organization. Returns paginated decisions with matched policies and declared goal context. Supports filtering by ?decision (allow|block|flag), ?agent_id, ?limit (max 200), and ?offset."
                params={[
                  { name: 'decision', type: 'string', required: false, desc: 'Filter by outcome: allow | block | flag' },
                  { name: 'agent_id', type: 'string', required: false, desc: 'Filter to a specific agent' },
                  { name: 'limit', type: 'number', required: false, desc: 'Page size (max 200, default 50)' },
                  { name: 'offset', type: 'number', required: false, desc: 'Pagination offset (default 0)' },
                ]}
                returns="{ decisions: Array<{ id, agent_id, action_type, decision, matched_policies, declared_goal, agent_name, created_at }>, total, stats }"
                example={
                  <CodeBlock title="List blocked decisions">
{`const res = await fetch(\`\${baseUrl}/api/guard/decisions?decision=block&limit=25\`, {
  headers: { 'x-api-key': apiKey }
});
const { decisions, total, stats } = await res.json();
// decisions[].decision, decisions[].matched_policies, decisions[].declared_goal`}
                  </CodeBlock>
                }
              />
            </div>

            {/* Agent Profile */}
            <div id="agent-profile" className="scroll-mt-20 pt-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Agent Profile</h3>
              <MethodEntry
                id="getAgentProfile"
                signature="GET /api/agents/:agentId/profile"
                description="Fetch the full governance profile for a specific agent. Includes identity, presence (heartbeat state), trust posture, computed risk signals, and assumptions summary. Returns 404 if the agent has not been seen by the instance."
                params={[
                  { name: 'agentId', type: 'string', required: true, desc: 'The agent identifier (path parameter)' },
                ]}
                returns="{ agent: { agent_id, agent_name, action_count, last_active, presence: { status, last_heartbeat_at, current_task_id } }, trust, signals, assumptions_summary }"
                example={
                  <CodeBlock title="Fetch agent profile">
{`const res = await fetch(\`\${baseUrl}/api/agents/my-agent/profile\`, {
  headers: { 'x-api-key': apiKey }
});
const { agent, trust, signals, assumptions_summary } = await res.json();
// agent.presence.status, trust.risk_score, signals, assumptions_summary`}
                  </CodeBlock>
                }
              />
            </div>
          </section>

          {/* ── Code Sessions ── */}
          <section id="agent-reputation" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Agent Reputation</h3>
              <p className="text-xs text-text-tertiary mb-4">Per-agent trust vectors computed from your own governed decisions (actions, guard outcomes, evaluations, feedback). Time-decayed (90-day half-life) and Bayesian-smoothed; risk_score wraps the existing 0-100 risk numbers. Each vector can be returned with an Ed25519-signed receipt that re-verifies against the instance JWKS. All reads are org-scoped.</p>
              <MethodEntry
                id="getAgentReputation"
                signature="GET /api/reputation/agents/:agentId"
                description="Current reputation vector (stored snapshot, or computed read-only when none exists yet). Returns 404 for an unknown agent."
                example={
                  <CodeBlock title="Fetch the vector">
{`const { vector } = await claw.getAgentReputation('agent_42');
// vector: { reliability_score, completion_rate, policy_violation_rate, approval_adherence,
//           quality_score, risk_score, volume_weight, confidence, total_events, last_event_at, computed_at }`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="recomputeAgentReputation"
                signature="POST /api/reputation/agents/:agentId/recompute"
                description="Recompute the vector from evidence, persist the snapshot, and store a signed receipt."
                example={<CodeBlock title="Recompute">{`await claw.recomputeAgentReputation('agent_42');`}</CodeBlock>}
              />
              <MethodEntry
                id="listAgentReputationEvents"
                signature="GET /api/reputation/agents/:agentId/events"
                description="Paginated reputation events for an agent (org-scoped)."
                example={<CodeBlock title="List events">{`await claw.listAgentReputationEvents('agent_42', { limit: 50, offset: 0 });`}</CodeBlock>}
              />
              <MethodEntry
                id="getAgentReputationReceipt"
                signature="GET /api/reputation/agents/:agentId/receipt"
                description="Signed receipt for the current vector (stored, or built read-only)."
                example={<CodeBlock title="Receipt">{`const { receipt } = await claw.getAgentReputationReceipt('agent_42');`}</CodeBlock>}
              />
              <MethodEntry
                id="verifyReputationReceipt"
                signature="POST /api/reputation/verify"
                description="Verify a reputation receipt against the instance's published signing keys. The vector hash is checked constant-time and the Ed25519 signature is verified. Returns { ok, kid?, reason? }."
                example={<CodeBlock title="Verify">{`const { ok } = await claw.verifyReputationReceipt(receipt);`}</CodeBlock>}
              />
            </div>
          </section>

          <section id="agent-registry" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Agent Registry</h3>
              <p className="text-xs text-text-tertiary mb-4">Register external, org-owned providers that group existing capabilities and are invoked through governance. An invocation routes through the existing capability runtime (auth, timeout, retry, request/response mapping, SSRF defense), the guard, and the action ledger; the registry never reimplements HTTP. Risk derives from risk_class + budget + capability metadata via the existing risk map and predictive risk. x402 and auth metadata are recorded; no payment settlement is performed.</p>
              <MethodEntry
                id="registerAgent"
                signature="POST /api/agents/registry"
                description="Register an external provider. GET /api/agents/registry lists them; GET/PATCH /api/agents/registry/:id read and update one."
                example={
                  <CodeBlock title="Register + group a capability">
{`const { registered_agent } = await claw.registerAgent({ name: 'Pricing API', endpoint: 'https://pricing.example.com', auth_type: 'bearer', risk_class: 'high', default_budget_usd: 5 });
await claw.addAgentCapability(registered_agent.entry_id, 'cap_123');`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="invokeRegisteredAgent"
                signature="POST /api/agents/invoke"
                description="Invoke a capability through a registered agent, governed end to end by the existing capability runtime + guard + action ledger. Returns 403 when guard blocks, 202 when approval is required, and records a thin invocation referencing the resulting action_id."
                example={
                  <CodeBlock title="Governed invocation">
{`const out = await claw.invokeRegisteredAgent({
  registered_agent_id: registered_agent.entry_id,
  capability_id: 'cap_123',
  agent_id: 'agent-1',
  payload: { q: 'sku-9' }
});
// out.success, out.action_id, out.risk_score, out.result`}
                  </CodeBlock>
                }
              />
            </div>
          </section>

          <section id="x402-spend-governance" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">x402 Spend Governance</h3>
              <p className="text-xs text-text-tertiary mb-4">Register x402 providers, govern individual purchases through the guard loop, and record spend for audit. The agent executes the actual x402 call itself — DashClaw registers providers, governs purchase intent, and keeps a tamper-evident ledger. DashClaw never holds a wallet.</p>

              <div id="x402-budget-tiers" className="scroll-mt-20 p-4 rounded-xl bg-surface-secondary border border-border">
                <h4 className="text-sm font-semibold text-text-primary mb-1.5">Spend limit tiers (x402_spend_limit policy)</h4>
                <p className="text-sm text-text-secondary leading-relaxed mb-2">
                  One policy type gates spend at two tiers, evaluated on every governed purchase:
                </p>
                <ul className="text-sm text-text-secondary leading-relaxed list-disc pl-5 space-y-1 mb-2">
                  <li>
                    <strong>Per-purchase</strong> — <code className="text-xs">max_spend_usd</code> hard-blocks any
                    single purchase above the cap; <code className="text-xs">approval_threshold</code> pauses one
                    for human approval.
                  </li>
                  <li>
                    <strong>Cumulative window budget</strong> — <code className="text-xs">budget_usd</code> caps
                    total spend over a rolling window (<code className="text-xs">budget_window_days</code>, 1–365,
                    default 30); <code className="text-xs">budget_approval_threshold</code> routes to approval as
                    the window fills. <code className="text-xs">budget_scope</code> is{' '}
                    <code className="text-xs">&apos;org&apos;</code> (one shared pool, default) or{' '}
                    <code className="text-xs">&apos;agent&apos;</code> — each agent family (the base id before{' '}
                    <code className="text-xs">:</code>, so <code className="text-xs">claude-code</code> and{' '}
                    <code className="text-xs">claude-code:explore</code> share a meter) is metered separately. A
                    policy targeted at specific <code className="text-xs">agent_ids</code> meters only those
                    families.
                  </li>
                </ul>
                <p className="text-sm text-text-secondary leading-relaxed">
                  A runaway purchase is interrupted <em>before</em> the money moves, and the interruption is recorded
                  like any other decision. Budget consumption renders live on{' '}
                  <code className="text-xs">/spend/x402</code> (Window budgets cards) and on each policy&apos;s card
                  at <code className="text-xs">/policies/rules</code> (&quot;$X of $Y used&quot;).
                </p>
              </div>
              <MethodEntry
                id="listProviders"
                signature="GET /api/x402/providers"
                description="List registered x402 providers (org-scoped). Filter by status."
                example={<CodeBlock title="List providers">{`const { providers } = await claw.listProviders({ status: 'active' });`}</CodeBlock>}
              />
              <MethodEntry
                id="createProvider"
                signature="POST /api/x402/providers"
                description="Register a paid x402 provider. Supply name, category, and optional base_url, description, pricing_model, or metadata."
                example={
                  <CodeBlock title="Register a provider">
{`const { provider } = await claw.createProvider({
  name: 'Exa Search',
  category: 'research',
  base_url: 'https://api.exa.ai',
});`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="getProvider"
                signature="GET /api/x402/providers/:id"
                description="Provider detail including registered endpoints."
                example={<CodeBlock title="Fetch provider">{`const { provider } = await claw.getProvider(provider.provider_id);`}</CodeBlock>}
              />
              <MethodEntry
                id="updateProvider"
                signature="PATCH /api/x402/providers/:id"
                description="Update a provider (name, status, pricing_model, metadata, etc.)."
                example={<CodeBlock title="Update status">{`await claw.updateProvider(provider.provider_id, { status: 'disabled' });`}</CodeBlock>}
              />
              <MethodEntry
                id="listProviderEndpoints"
                signature="GET /api/x402/providers/:id/endpoints"
                description="List the endpoints registered under a provider."
                example={<CodeBlock title="List endpoints">{`const { endpoints } = await claw.listProviderEndpoints(provider.provider_id);`}</CodeBlock>}
              />
              <MethodEntry
                id="createProviderEndpoint"
                signature="POST /api/x402/providers/:id/endpoints"
                description="Add an endpoint to a provider. Supply name, endpoint_url, and optional default_price, sensitivity_level, or metadata."
                example={
                  <CodeBlock title="Add an endpoint">
{`await claw.createProviderEndpoint(provider.provider_id, {
  name: 'Search',
  endpoint_url: 'https://api.exa.ai/search',
  default_price: 0.01,
  sensitivity_level: 'low',
});`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="recordPurchase"
                signature="POST /api/x402/purchases"
                description="Govern + record a paid acquisition. Routes through the guard loop. Required: agent_id, provider, declared_goal, purchase_reason, context_gap, expected_value. Returns { action, purchase, decision }; branch on action.status (running | pending_approval)."
                params={[
                  { name: 'agent_id', type: 'string', required: true, desc: 'Identifier of the agent making the purchase' },
                  { name: 'provider', type: 'string', required: true, desc: 'Provider id from createProvider' },
                  { name: 'declared_goal', type: 'string', required: true, desc: 'The agent\'s goal that requires this purchase' },
                  { name: 'purchase_reason', type: 'string', required: true, desc: 'Why this purchase is necessary' },
                  { name: 'context_gap', type: 'string', required: true, desc: 'What information the agent lacks locally' },
                  { name: 'expected_value', type: 'string', required: true, desc: 'What value the agent expects to get' },
                ]}
                returns="{ action: { id, status }, purchase: { id }, decision: { decision, risk_score } }"
                example={
                  <CodeBlock title="Govern a purchase">
{`const { action, purchase, decision } = await claw.recordPurchase({
  agent_id: 'research-agent',
  provider: provider.provider_id,
  declared_goal: 'Find recent papers on quantum computing',
  purchase_reason: 'Context gap: no local data for period 2025-01-01..2026-01-01',
  context_gap: 'No papers in knowledge base for the requested window',
  expected_value: 'Retrieve 10+ relevant citations',
});

if (action.status === 'pending_approval') {
  await claw.waitForApproval(action.id);
}
// Agent now executes the x402 call, then records the result`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="listPurchases"
                signature="GET /api/x402/purchases"
                description="List governed purchases (org-scoped). Filter by provider_id."
                example={<CodeBlock title="List purchases">{`const { purchases } = await claw.listPurchases({ provider_id: provider.provider_id });`}</CodeBlock>}
              />
              <MethodEntry
                id="recordPurchaseResult"
                signature="POST /api/artifacts (Node-only convenience wrapper)"
                description="Attach the x402 result snapshot to its purchase action. Reuses the existing artifacts endpoint; links by source_action_id so the snapshot appears in that action's evidence bundle. Python callers post directly to POST /api/artifacts with artifact_type='x402_purchase_result'."
                params={[
                  { name: 'actionId', type: 'string', required: true, desc: 'The act_ id returned by recordPurchase' },
                  { name: 'result', type: 'object', required: true, desc: '{ summary?, data?, url? } — snapshot of what the x402 call returned' },
                ]}
                example={
                  <CodeBlock title="Record the result">
{`await claw.recordPurchaseResult(action.id, {
  summary: 'Found 14 papers on quantum computing',
  data: { count: 14, citations: ['...'] },
  url: 'https://api.research.example.com/results/...',
});`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="recordX402Purchase"
                signature="POST /api/x402/purchases → /api/actions/:id/outcome → /api/artifacts"
                description="Convenience: record a SETTLED x402 payment end-to-end in one call — govern + record the purchase, mark it succeeded, and (when given) attach the on-chain receipt. Use this for the pay-outside-a-hook self-report pattern: your agent pays through a native shell / wrapper that OpenClaw's hooks never see, so it must report the spend itself. The server resolves/auto-registers the provider from `provider`, so you don't register one first. Python parity: record_x402_purchase()."
                params={[
                  { name: 'agent_id', type: 'string', required: true, desc: 'Identifier of the agent that paid' },
                  { name: 'provider', type: 'string', required: true, desc: 'Provider name/origin, e.g. "stableenrich.dev" — the server resolves it to a provider_id' },
                  { name: 'spend', type: 'number', required: true, desc: 'Settled USD amount (> 0)' },
                  { name: 'transaction_hash', type: 'string', required: false, desc: 'On-chain tx hash, attached as receipt evidence' },
                  { name: 'request_id', type: 'string', required: false, desc: 'Provider request id, attached as receipt evidence' },
                ]}
                returns="{ action, purchase, decision, outcome }"
                example={
                  <CodeBlock title="Self-report a settled payment">
{`const settled = await claw.recordX402Purchase({
  agent_id: 'research-agent',
  provider: 'stableenrich.dev',   // name/origin
  spend: 0.007,                   // settled USD
  transaction_hash: '0xabc…',
  request_id: 'req_123',
});`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="x402Budget"
                signature="GET /api/x402/budget"
                description="Read window-budget consumption — the same sums the guard's cumulative budget gate enforces, so the meter you see is the meter that blocks. Returns one entry per active x402_spend_limit policy that defines budget_usd or budget_approval_threshold. Org-scoped budgets return window_spend_usd; agent-scoped budgets return families (one spend figure per agent family). ?agent_id= narrows agent-scoped entries to that agent's family. Rendered as the Window budgets cards on /spend/x402 and the consumption line on each policy card at /policies/rules."
                params={[
                  { name: 'agent_id', type: 'string', required: false, desc: 'Narrow agent-scoped budgets to this agent\'s family (sub-agent ids resolve to their base id)' },
                ]}
                returns="{ budgets: [{ policy_id, policy_name, agent_ids, budget_usd, budget_approval_threshold, budget_window_days, budget_scope, window_start, window_spend_usd?, families?: [{ agent_id, window_spend_usd }] }] }"
                example={
                  <CodeBlock title="Read budget consumption">
{`const res = await fetch(\`\${baseUrl}/api/x402/budget\`, {
  headers: { 'x-api-key': apiKey }
});
const { budgets } = await res.json();
// budgets[0] -> { policy_name: 'Research spend',
//   budget_usd: 50, budget_window_days: 30, budget_scope: 'org',
//   window_start: '2026-06-03T…', window_spend_usd: 43.12 }`}
                  </CodeBlock>
                }
              />
            </div>
          </section>

          <section id="finops-spend" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">FinOps Spend</h3>
              <p className="text-xs text-text-tertiary mb-4">A read-only operator aggregation over already-stored cost. It reconciles spend across surfaces — agent LLM cost, governed x402 purchases, and Claude Code sessions — without doing any new pricing. There is no SDK wrapper; this is a dashboard endpoint that powers the /spend, /spend/x402, and /spend/code UI surfaces.</p>
              <MethodEntry
                id="finopsSpend"
                signature="GET /api/finops/spend"
                description="Aggregate spend for the org under one lens. Sums cost already recorded by the governance runtime; it owns no tables and introduces no new pricing."
                params={[
                  { name: 'lens', type: 'string', required: false, desc: "fleet | claude-code. Default fleet. fleet covers agent LLM cost + x402; claude-code covers Code Sessions cost." },
                  { name: 'period', type: 'string', required: false, desc: '7d | 30d | 90d. Default 30d.' },
                ]}
                returns="fleet: { lens, period, agent, x402, fleet_total_usd }; claude-code: { lens, period, code_sessions, code_total_usd }"
                example={
                  <CodeBlock title="Aggregate fleet spend">
{`// Operator dashboard endpoint — no SDK wrapper
const res = await fetch('/api/finops/spend?lens=fleet&period=30d', {
  headers: { 'x-api-key': process.env.DASHCLAW_API_KEY },
});
const { lens, period, agent, x402, fleet_total_usd } = await res.json();

// Your Claude Code spend (advisory)
const code = await fetch('/api/finops/spend?lens=claude-code&period=7d', {
  headers: { 'x-api-key': process.env.DASHCLAW_API_KEY },
}).then((r) => r.json());
// code.code_sessions, code.code_total_usd`}
                  </CodeBlock>
                }
              />
            </div>
          </section>

          <section id="governance-posture" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono">Governance Posture</h3>
              <p className="text-xs text-text-tertiary mb-4">A gaming-resistant, read-only governance posture score for the org: it measures what the fleet actually GOVERNS versus what it COULD, across six dimensions, and drives a human-gated remediation loop. The score only rises from ACTIVE, proven-to-fire policies — drafting a fix never raises it. Operator surface only; no SDK wrapper. Powers the /posture page. All routes experimental.</p>
              <MethodEntry
                id="posture-score"
                signature="GET /api/posture"
                description="Compute the current posture score with its six dimension breakdowns, the prioritized findings queue, a summary, and the recent snapshot trend."
                returns="{ score, status, cappedBy, dimensions, findings, summary, snapshots, snapshotTs }"
                example={
                  <CodeBlock title="Read the org posture">
{`const res = await fetch('/api/posture', {
  headers: { 'x-api-key': process.env.DASHCLAW_API_KEY },
});
const { score, status, dimensions, findings, summary, snapshots } = await res.json();`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="posture-findings"
                signature="GET /api/posture/findings"
                description="The prioritized remediation queue, plus the risk-accepted ledger and per-status counts. Filter by status or dimension."
                params={[
                  { name: 'status', type: 'string', required: false, desc: 'open | drafted | resolved | snoozed | accepted_risk' },
                  { name: 'dimension', type: 'string', required: false, desc: 'Filter to one of the six posture dimensions' },
                ]}
                returns="{ findings, riskAccepted, counts }"
                example={
                  <CodeBlock title="List the open queue">
{`const res = await fetch('/api/posture/findings?status=open', {
  headers: { 'x-api-key': apiKey },
});
const { findings, riskAccepted, counts } = await res.json();`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="posture-resolve"
                signature="POST /api/posture/findings/:key/resolve"
                description="Human-gated resolution. action='create_draft' inserts an INACTIVE policy draft (never auto-activates, never raises the score); 'snooze' defers it; 'accept_risk' records an explicit acceptance in the ledger. Draft-only by design — a human still activates any policy at /policies."
                params={[
                  { name: 'action', type: 'string', required: true, desc: 'create_draft | snooze | accept_risk' },
                  { name: 'note', type: 'string', required: false, desc: 'Operator note (e.g. a risk-acceptance justification)' },
                ]}
                returns="{ resolved, action, status, policy?, state, finding? }"
                example={
                  <CodeBlock title="Draft a remediation (a human activates it later)">
{`const res = await fetch('/api/posture/findings/' + key + '/resolve', {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'create_draft' }),
});`}
                  </CodeBlock>
                }
              />
              <MethodEntry
                id="posture-scan"
                signature="POST /api/posture/scan"
                description="Recompute the posture score and persist a trend snapshot for history."
                returns="{ score, status, dimensions, snapshot, summary }"
                example={
                  <CodeBlock title="Recompute and record a snapshot">
{`const res = await fetch('/api/posture/scan', {
  method: 'POST',
  headers: { 'x-api-key': apiKey },
});
const { score, snapshot } = await res.json();`}
                  </CodeBlock>
                }
              />
              <p className="text-sm text-text-secondary mb-2 leading-relaxed">Also exposed read-only over MCP — tools <code className="text-brand">dashclaw_posture</code> + <code className="text-brand">dashclaw_posture_next</code> — and as CLI commands <code className="text-brand">dashclaw posture</code> / <code className="text-brand">dashclaw next</code> / <code className="text-brand">dashclaw posture resolve &lt;key&gt;</code> (draft-only). The dashboard view is at <code className="text-brand">/posture</code>.</p>
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

          <section id="code-sessions" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <Terminal size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Code Sessions</h2>
              <span className="text-[10px] uppercase tracking-wider text-brand border border-brand/40 rounded px-1.5 py-0.5">Beta</span>
            </div>
            <p className="text-sm text-text-secondary mb-6 leading-relaxed">
              Ingest Claude Code (and Codex) transcripts, price the spend with cache-aware accounting, surface optimizer signals (stuck loops, cache crater, context gaps), and distill a session into an <strong>Optimal Files</strong> bundle — a root <code className="text-brand">CLAUDE.md</code>, path-scoped rules, hooks, and skill packs you apply locally. The canonical parser runs server-side, so clients never parse transcripts; all routes are experimental.
            </p>

            <h3 id="code-sessions-ingest" className="scroll-mt-20 text-lg font-semibold tracking-tight mt-8 mb-2">Ingest transcripts</h3>
            <p className="text-sm text-text-secondary mb-3 leading-relaxed">
              Three ways in, all landing on the same server-side parser:
            </p>
            <ul className="text-sm text-text-secondary mb-4 leading-relaxed list-disc pl-5 space-y-1">
              <li><strong>Stop-hook (live).</strong> Set <code className="text-brand">DASHCLAW_CODE_SESSIONS_ENABLED=1</code> for the Claude Code hooks. After each turn the reporter POSTs the JSONL delta with <code>source_host: &apos;hook&apos;</code> — fail-silent if the instance is unreachable. Run <code className="text-brand">node scripts/install-hooks.mjs --global</code> to capture every project on your machine (capture-only; no API key in global config).</li>
              <li><strong>CLI backfill.</strong> <code className="text-brand">dashclaw code ingest [--dry-run]</code> walks <code>~/.claude/projects</code>; <code className="text-brand">dashclaw code ingest-codex</code> walks <code>~/.codex/sessions</code>. Large transcripts are gzip-compressed on the wire automatically, so real-world sessions stay under the 4.5&nbsp;MB request limit; files over 40&nbsp;MB are skipped.</li>
              <li><strong>Direct API.</strong> <code>POST /api/code-sessions/ingest-jsonl</code> (below), or <code>POST /api/code-sessions/ingest-live</code> for per-turn incremental append with <code>finalize: true</code> to close the session.</li>
            </ul>
            <MethodEntry
              id="ingestJsonl"
              signature="POST /api/code-sessions/ingest-jsonl"
              description="Ingest a Claude Code JSONL transcript (or a delta). The server dedups duplicate usage fragments (Claude Code repeats one model request across many rows), computes cache-aware cost, and runs optimizer + alert detection. Accepts raw lines, a raw-gzip body (x-dashclaw-encoding: gzip header — the primary path for large transcripts), or a legacy base64 compressed_jsonl field (50 MB decompressed cap, 200k lines)."
              params={[
                { name: 'project', type: 'object', required: true, desc: '{ slug, source_host: "hook" | "jsonl" }' },
                { name: 'jsonl_lines', type: 'string[]', required: false, desc: 'Raw JSONL lines. Either this or compressed_jsonl is required.' },
                { name: 'compressed_jsonl', type: 'string', required: false, desc: 'base64(gzip(jsonl)) alternative for large transcripts.' },
                { name: 'session_uuid', type: 'string', required: false, desc: 'Validated against the parser-derived uuid; mismatch is rejected.' },
                { name: 'tool_use_action_map', type: 'object', required: false, desc: 'Maps tool_use ids to governed action_ids (the governance bridge).' },
              ]}
              returns="{ project: { id, slug }, session: { session_uuid, inserted_messages, inserted_tool_uses, signals_inserted, alerts_inserted }, parser: { jsonl_records, model_requests, duplicate_fragments_skipped } }"
              example={
                <CodeBlock title="Ingest a transcript via the API">
{`// Backfill is easiest via the CLI: dashclaw code ingest
// Direct API — you supply the raw JSONL lines:
const res = await fetch(baseUrl + '/api/code-sessions/ingest-jsonl', {
  method: 'POST',
  headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
  body: JSON.stringify({
    project: { slug: 'my-repo', source_host: 'jsonl' },
    jsonl_lines: lines,        // string[] — or compressed_jsonl (base64 gzip)
  }),
});
const { session, parser } = await res.json();
// parser.duplicate_fragments_skipped = the cache-aware dedup that
// prevents the Nx cost over-count from repeated usage fragments`}
                </CodeBlock>
              }
            />

            <h3 id="code-sessions-optimal-files" className="scroll-mt-20 text-lg font-semibold tracking-tight mt-10 mb-2">Optimal Files</h3>
            <p className="text-sm text-text-secondary mb-4 leading-relaxed">
              Distill a session into a curated config bundle (root <code className="text-brand">CLAUDE.md</code>, path-scoped rules, hooks, skill candidates), persist the selected files as a manifest, then apply it to disk with the CLI. The server cannot read your filesystem, so generation is preview-only until you apply; every file is secret-redacted before it leaves the server.
            </p>
            <MethodEntry
              id="optimalFilesPreview"
              signature="POST /api/code-sessions/sessions/:sessionId/optimal-files/preview"
              description="Generate the candidate file bundle for a session (read-only). Each file carries a kind, a commit recommendation, a secret-scan result, and an overwrite_risk of 'unknown' (the server can't see your working tree)."
              returns="{ session_id, bundle: [{ path, kind, title, content, commit_recommendation, secret_scan, overwrite_risk }], groups, analysis }"
              example={
                <CodeBlock title="Preview the bundle">
{`const res = await fetch(
  baseUrl + '/api/code-sessions/sessions/' + sessionId + '/optimal-files/preview',
  { method: 'POST', headers: { 'x-api-key': apiKey } }
);
const { bundle } = await res.json();   // every file already secret-redacted`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="optimalFilesManifest"
              signature="POST /api/code-sessions/sessions/:sessionId/optimal-files/manifest"
              description="Persist a chosen subset of the bundle as an apply-able manifest (24 h TTL, strict path allowlist: CLAUDE.md, .claude/rules/, .claude/hooks/, .claude/skills/). Returns a ready-to-run apply command."
              params={[
                { name: 'selections', type: 'Array<{ path }>', required: true, desc: 'Paths chosen from the preview bundle. Paths outside the allowlist are rejected.' },
              ]}
              returns="{ manifest_id, expires_at, apply_command }"
              example={
                <CodeBlock title="Persist a manifest, then apply it locally">
{`const res = await fetch(
  baseUrl + '/api/code-sessions/sessions/' + sessionId + '/optimal-files/manifest',
  {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      selections: [{ path: 'CLAUDE.md' }, { path: '.claude/rules/testing.md' }],
    }),
  }
);
const { manifest_id, apply_command } = await res.json();
// apply_command, e.g.:  dashclaw code apply <manifest_id> --dest=. --yes`}
                </CodeBlock>
              }
            />

            <h3 id="code-sessions-analytics" className="scroll-mt-20 text-lg font-semibold tracking-tight mt-10 mb-2">Cost, signals &amp; retrospection</h3>
            <p className="text-sm text-text-secondary mb-3 leading-relaxed">
              Read surfaces over ingested sessions (all <code>GET</code> unless noted, <code>x-api-key</code> required):
            </p>
            <ul className="text-sm text-text-secondary mb-4 leading-relaxed list-disc pl-5 space-y-1">
              <li><code className="text-brand">/api/code-sessions/projects</code> — projects with per-project cost rollups.</li>
              <li><code className="text-brand">/api/code-sessions/projects/:projectId/sessions</code> — sessions for a project.</li>
              <li><code className="text-brand">/api/code-sessions/sessions/:sessionId</code> — token in/out + cache breakdown, cache-hit %, and cost reconciliation (flags a ≥2× divergence from Mission Control pricing).</li>
              <li><code className="text-brand">/api/code-sessions/sessions/:sessionId/autopsy</code> — outcome classification (completed / thrashed / fell_back_to_rules / timed_out / aborted) and where the spend went by tool category.</li>
              <li><code className="text-brand">/api/code-sessions/subagent-roi</code> — keep / trim / drop per subagent by success-rate and cost-per-success.</li>
              <li><code className="text-brand">/api/code-sessions/memos</code> + <code>POST /memos/regenerate</code> — weekly spend memo (7-day vs prior-7-day).</li>
              <li><code className="text-brand">/api/code-sessions/alerts</code> + <code>POST /alerts/read-all</code> — cost-anomaly / cache-crater / stuck-loop alerts.</li>
              <li><code className="text-brand">/api/learning/code-signals</code> — optimizer findings aggregated into the learning loop.</li>
            </ul>
            <p className="text-sm text-text-secondary mb-2 leading-relaxed">
              Also exposed over MCP — tools <code className="text-brand">dashclaw_optimal_files_preview</code> + <code className="text-brand">dashclaw_optimal_files_manifest</code>, and resources <code className="text-brand">dashclaw://code-sessions/projects</code> + <code className="text-brand">{'dashclaw://code-sessions/sessions/{session_id}'}</code>. The dashboard view is at <code className="text-brand">/code-sessions</code>.
            </p>
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

          {/* ── Work Orders ── */}
          <section id="work-orders" className="scroll-mt-20 pt-12 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-subtle flex items-center justify-center">
                <ClipboardCheck size={16} className="text-brand" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Work Orders</h2>
            </div>
            <p className="text-sm text-text-secondary mb-6 leading-relaxed">
              Task-grade contracts for agent work: a typed input/output schema, a budget ceiling, and a self-verifying receipt. A caller <strong>submits</strong> an order against a registered type — it&apos;s validated against the contract, guard-gated (may be blocked or parked for human approval), then queued. Any agent with an API key can <strong>claim</strong> the next queued order and <strong>complete</strong> it; the server validates the output against the contract, builds a SHA-256-hashed receipt (cost, lifecycle timestamps, output hash, governance trail), and writes an audit record. <strong>DashClaw stays the control plane — it never runs the work.</strong> Execution is external workers; see <code className="text-brand">examples/work-order-worker/</code> for a ~75-line reference worker.
            </p>

            <div className="overflow-x-auto mb-8">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-text-secondary font-medium">Route</th>
                    <th className="text-left py-2 text-text-secondary font-medium">Behavior</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { route: 'POST /api/work-orders', desc: 'Validate input against the registered contract, validate the budget, guard-gate, insert. Returns 201 { work_order_id, status, guard }.' },
                    { route: 'GET /api/work-orders', desc: 'List with ?status=, ?type=, ?agent= filters + pagination. Sweeps expired leases first.' },
                    { route: 'GET /api/work-orders/:id', desc: 'Order + receipt (when terminal). 404 work_order_not_found.' },
                    { route: 'DELETE /api/work-orders/:id', desc: 'Cancel a queued/claimed/pending-approval order; 409 not_cancellable for terminal.' },
                    { route: 'POST /api/work-orders/claim', desc: 'Worker: atomically claim the oldest queued order of a matching type (no double-claim), set the lease. work_order is null when nothing is queued.' },
                    { route: 'POST /api/work-orders/:id/complete', desc: 'Claim-holder only. Output validated against the contract; builds receipt + artifact, writes audit record. 422 output_contract_violation leaves the order claimed.' },
                    { route: 'GET /api/work-orders/:id/artifacts', desc: 'Artifacts for the order.' },
                    { route: 'GET/POST /api/work-orders/types', desc: 'List / register contracts (JSON Schema validated).' },
                    { route: 'GET/PUT/DELETE /api/work-orders/types/:type', desc: 'Read / update (version bump on schema change) / soft-disable a contract.' },
                  ].map((row) => (
                    <tr key={row.route} className="border-b border-border">
                      <td className="py-2 pr-4 font-mono text-xs text-brand">{row.route}</td>
                      <td className="py-2 text-xs text-text-secondary">{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <MethodEntry
              id="submitWorkOrder"
              signature="claw.submitWorkOrder(order)"
              description="Submit a work order against a registered contract. The order is validated against the type's input schema, guard-gated, then queued (or parked as pending_approval / blocked depending on policy). Python: claw.submit_work_order(order)."
              params={[
                { name: 'order.type', type: 'string', required: true, desc: "Registered work order type (e.g. 'research_brief')." },
                { name: 'order.input', type: 'object', required: true, desc: 'Input payload matching the contract input schema.' },
                { name: 'order.budget', type: 'object', required: false, desc: '{ max_cost_usd?, timeout_seconds? } — overrides the type defaults; both must be > 0.' },
                { name: 'order.requested_by', type: 'string', required: false, desc: 'Submitting agent id (defaults to the client agentId).' },
              ]}
              returns="{ work_order_id, status, guard: { decision, decision_id, risk_score, matched_policies, reason } }"
              example={
                <CodeBlock title="Submit a research brief">
{`const { work_order_id, status, guard } = await claw.submitWorkOrder({
  type: 'research_brief',
  input: { topic: 'Agent governance market', depth: 'standard' },
  budget: { max_cost_usd: 2.50, timeout_seconds: 600 },
});
// status: 'queued' | 'pending_approval' | 'blocked'`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="getWorkOrder"
              signature="claw.getWorkOrder(workOrderId)"
              description="Fetch a work order plus its receipt (present once the order is terminal). Python: claw.get_work_order(work_order_id)."
              returns="{ work_order, receipt: { receipt, receipt_hash } | null }"
              example={
                <CodeBlock title="Poll an order + verify its receipt">
{`const { work_order, receipt } = await claw.getWorkOrder(workOrderId);
if (receipt) {
  // receipt.receipt is the canonical body; receipt.receipt_hash is
  // SHA-256 over it (stable key order) — recompute to verify.
  console.log(work_order.status, receipt.receipt_hash);
}`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="listWorkOrders"
              signature="claw.listWorkOrders(filters?)"
              description="List work orders with optional filters. Expired leases are swept to timed_out first. Python: claw.list_work_orders(filters)."
              params={[
                { name: 'filters', type: 'object', required: false, desc: '{ status?, type?, agent?, limit?, offset? }' },
              ]}
              returns="{ work_orders, total }"
              example={
                <CodeBlock title="List queued orders">
{`const { work_orders, total } = await claw.listWorkOrders({ status: 'queued', limit: 20 });`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="cancelWorkOrder"
              signature="claw.cancelWorkOrder(workOrderId)"
              description="Cancel a queued, claimed, or pending-approval order. Terminal orders (completed/failed/timed_out) cannot be cancelled (409 not_cancellable). Python: claw.cancel_work_order(work_order_id)."
              returns="{ work_order }"
              example={
                <CodeBlock title="Cancel an order">
{`const { work_order } = await claw.cancelWorkOrder(workOrderId);`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="claimWorkOrder"
              signature="claw.claimWorkOrder({ types?, agent_id? })"
              description="Worker: atomically claim the next queued order of the given types (oldest-first; no double-claim under concurrency). The lease expires after the order's timeout_seconds. Python: claw.claim_work_order(types, agent_id)."
              params={[
                { name: 'types', type: 'string[] | null', required: false, desc: 'Filter by type(s); null = any type.' },
                { name: 'agent_id', type: 'string', required: false, desc: 'Worker id (defaults to the client agentId).' },
              ]}
              returns="{ work_order: object | null }  // null when the queue is empty"
              example={
                <CodeBlock title="Worker: claim the next order">
{`const { work_order } = await claw.claimWorkOrder({ types: ['research_brief'] });
if (!work_order) return; // queue empty`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="completeWorkOrder"
              signature="claw.completeWorkOrder(workOrderId, result)"
              description="Worker: report completion or failure. On success the server validates output against the type's output schema and builds a self-verifying receipt; output-contract violations (422) leave the order claimed so the worker can re-report before the lease expires. Claim-holder only. Python: claw.complete_work_order(work_order_id, result)."
              params={[
                { name: 'result.status', type: "'completed' | 'failed'", required: true, desc: 'Completion outcome.' },
                { name: 'result.output', type: 'object', required: false, desc: 'Required when status=completed; validated against the output contract.' },
                { name: 'result.cost', type: 'object', required: false, desc: '{ input_tokens?, output_tokens?, total_usd? } as reported by the worker.' },
                { name: 'result.error', type: 'object', required: false, desc: '{ code?, message? } when status=failed.' },
                { name: 'result.agent_id', type: 'string', required: false, desc: 'Reporting worker id (defaults to the client agentId).' },
              ]}
              returns="{ work_order, receipt: { receipt, receipt_hash } }"
              example={
                <CodeBlock title="Worker: complete with a receipt">
{`const { work_order, receipt } = await claw.completeWorkOrder(work_order.id, {
  status: 'completed',
  output: { summary: '...', sources: ['...'] },
  cost: { input_tokens: 1200, output_tokens: 800, total_usd: 0.42 },
});
// receipt.receipt.over_budget flags cost over the ceiling
// receipt.receipt_hash verifies by recomputation`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="listWorkOrderTypes"
              signature="claw.listWorkOrderTypes()"
              description="List the org's registered work order contracts (the seeded research_brief example is created on first access). Python: claw.list_work_order_types()."
              returns="{ types, total }"
              example={
                <CodeBlock title="List contracts">
{`const { types } = await claw.listWorkOrderTypes();`}
                </CodeBlock>
              }
            />
            <MethodEntry
              id="registerWorkOrderType"
              signature="claw.registerWorkOrderType(definition)"
              description="Register a new work order contract (input + output JSON Schema, budget/timeout defaults). Python: claw.register_work_order_type(definition)."
              params={[
                { name: 'definition.type', type: 'string', required: true, desc: 'snake_case slug, unique per org.' },
                { name: 'definition.input_schema', type: 'object', required: true, desc: 'JSON Schema (object root) for inputs.' },
                { name: 'definition.output_schema', type: 'object', required: true, desc: 'JSON Schema (object root) for outputs.' },
                { name: 'definition.default_max_cost_usd', type: 'number', required: false, desc: 'Default budget ceiling.' },
                { name: 'definition.default_timeout_seconds', type: 'number', required: false, desc: 'Default lease/SLA seconds.' },
              ]}
              returns="{ type }"
              example={
                <CodeBlock title="Register a contract">
{`const { type } = await claw.registerWorkOrderType({
  type: 'summarize_doc',
  display_name: 'Summarize Document',
  input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  output_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  default_max_cost_usd: 1.0,
  default_timeout_seconds: 300,
});`}
                </CodeBlock>
              }
            />
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              Also exposed over MCP — tools <code className="text-brand">dashclaw_work_order_submit</code> + <code className="text-brand">dashclaw_work_order_status</code> — and as the <code className="text-brand">/work-orders</code> dashboard (ledger + contracts, with a client-side receipt-hash verifier). The 8 SDK methods are identical across the Node (camelCase) and Python (snake_case) clients.
            </p>
          </section>

          {/* ── Error Handling ── */}
          <section id="error-handling" className="scroll-mt-20 pt-12 border-t border-border">
            <h2 className="text-2xl font-bold tracking-tight mb-2">Error Handling</h2>
            <CodeBlock title="Error shape">{`{ message: "Validation failed", status: 400 }`}</CodeBlock>
          </section>

          {/* ── Legacy Section ── */}
          {showLegacy && (
            <div id="legacy-v1" className="mt-20 pt-12 border-t-2 border-dashed border-border-hover">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-surface-tertiary border border-border-hover flex items-center justify-center text-text-tertiary">
                  <History size={20} />
                </div>
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Legacy Reference</h2>
                  <p className="text-text-tertiary text-sm">Background v1 utilities and technical helper methods.</p>
                </div>
              </div>

              {/* Real-Time Events */}
              <section id="real-time-events" className="scroll-mt-20 pt-12">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">Real-Time Events</h3>
                <MethodEntry 
                  id="events" 
                  signature="claw.events(options?)" 
                  description="Subscribe to real-time SSE events from the DashClaw server. Uses fetch-based SSE parsing for Node 18+ compatibility (no native EventSource required)."
                  params={[
                    { name: 'reconnect', type: 'boolean', required: false, desc: 'Auto-reconnect on disconnect (resumes from last event ID). Default: true.' },
                    { name: 'maxRetries', type: 'number', required: false, desc: 'Max reconnection attempts.' },
                    { name: 'retryInterval', type: 'number', required: false, desc: 'Milliseconds between reconnection attempts. Default: 3000.' },
                  ]}
                  example={
                    <CodeBlock title="Subscribing to updates">
{`const stream = client.events();
stream
  .on('action.created', (data) => console.log('New action:', data))
  .on('action.updated', (data) => console.log('Action updated:', data))
  .on('goal.created', (data) => console.log('New goal:', data))
  .on('policy.updated', (data) => console.log('Policy changed:', data))
  .on('error', (err) => console.error('Stream error:', err));`}
                    </CodeBlock>
                  }
                />
              </section>

              {/* Dashboard Data */}
              <section id="dashboard-data" className="scroll-mt-20 pt-12 border-t border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">Dashboard Data</h3>
                <MethodEntry 
                  id="reportTokenUsage" 
                  signature="claw.reportTokenUsage(usage)" 
                  description="Record a point-in-time token usage snapshot for this agent."
                  params={[
                    { name: 'tokens_in', type: 'number', required: true, desc: 'Input/Prompt tokens' },
                    { name: 'tokens_out', type: 'number', required: true, desc: 'Output/Completion tokens' },
                    { name: 'model', type: 'string', required: false, desc: 'LLM model used' },
                  ]}
                  example={
                    <CodeBlock>
{`await claw.reportTokenUsage({
  tokens_in: 850,
  tokens_out: 215,
  model: 'claude-sonnet-4-6'
});`}
                    </CodeBlock>
                  }
                />
                <MethodEntry 
                  id="createGoal" 
                  signature="claw.createGoal(goal)" 
                  description="Register a high-level goal in the Mission Control UI."
                  params={[
                    { name: 'title', type: 'string', required: true, desc: 'Short name for the goal' },
                    { name: 'status', type: 'string', required: false, desc: 'active|completed|paused' },
                    { name: 'progress', type: 'number', required: false, desc: '0-100 percentage' },
                  ]}
                  example={
                    <CodeBlock>
{`await claw.createGoal({
  title: 'Refactor Auth Layer',
  progress: 75,
  status: 'active'
});`}
                    </CodeBlock>
                  }
                />
                <MethodEntry 
                  id="wrapClient" 
                  signature="claw.wrapClient(llmClient, options?)" 
                  description="Wrap an Anthropic or OpenAI client to automatically report token usage after each API call."
                  example={
                    <CodeBlock title="Auto-telemetry wrapping">
{`const anthropic = claw.wrapClient(new Anthropic());
// usage is auto-reported after this call:
const msg = await anthropic.messages.create({ 
  model: 'claude-sonnet-4-6', 
  max_tokens: 1024, 
  messages: [{ role: 'user', content: 'Hello' }] 
});`}
                    </CodeBlock>
                  }
                />
              </section>

              {/* Behavior Guard (v1) */}
              <section id="legacy-guard" className="scroll-mt-20 pt-12 border-t border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">Behavior Guard (v1)</h3>
                <MethodEntry 
                  id="guard" 
                  signature="claw.guard(context)" 
                  description="Intercept intent and check it against current safety and governance policies."
                  params={[
                    { name: 'action_type', type: 'string', required: true, desc: 'Intent category (deploy, post, build, etc)' },
                    { name: 'risk_score', type: 'number', required: false, desc: '0-100 estimate' },
                    { name: 'declared_goal', type: 'string', required: false, desc: 'Human-readable justification' },
                  ]}
                  example={
                    <CodeBlock title="Checking a dangerous intent">
{`const decision = await claw.guard({
  action_type: 'production_deployment',
  risk_score: 95,
  declared_goal: 'Updating API endpoints for new feature'
});

if (decision.decision === 'block') {
  console.error('Safety policy blocked action:', decision.reasons);
}`}
                    </CodeBlock>
                  }
                />
              </section>

              {/* User Preferences */}
              <section id="user-preferences" className="scroll-mt-20 pt-12 border-t border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">User Preferences</h3>
                <MethodEntry 
                  id="logObservation" 
                  signature="claw.logObservation(obs)" 
                  description="Log a behavioral observation about the user to improve future interactions."
                  example={
                    <CodeBlock>
{`await claw.logObservation({
  observation: 'User prefers concise, bulleted summaries over long paragraphs.',
  importance: 8,
  category: 'communication_style'
});`}
                    </CodeBlock>
                  }
                />
                <MethodEntry 
                  id="setPreference" 
                  signature="claw.setPreference(pref)" 
                  description="Explicitly set a learned user preference."
                  example={
                    <CodeBlock>
{`await claw.setPreference({
  preference: 'Always use tabs for indentation in generated Python code.',
  confidence: 100
});`}
                    </CodeBlock>
                  }
                />
              </section>

              {/* Security Scanning (legacy) */}
              <section id="legacy-security-scanning" className="scroll-mt-20 pt-12 border-t border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">Security Scanning (Legacy)</h3>
                <MethodEntry
                  id="scanContent"
                  signature="claw.scanContent(text, destination?)"
                  description="Scan text for sensitive data (API keys, tokens, PII) before it leaves the secure environment."
                  returns="Promise<{clean: boolean, findings: Object[], redacted_text: string}>"
                  example={
                    <CodeBlock title="Safe-guarding outbound data">
{`const { clean, redacted_text } = await claw.scanContent(userOutput, 'slack-webhook');
if (!clean) {
  console.warn('Sensitive data detected and redacted.');
}
await sendToSlack(redacted_text);`}
                    </CodeBlock>
                  }
                />
              </section>

              {/* Automation Snippets */}
              <section id="automation-snippets" className="scroll-mt-20 pt-12 border-t border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">Automation Snippets</h3>
                <MethodEntry 
                  id="saveSnippet" 
                  signature="claw.saveSnippet(snippet)" 
                  description="Save or update a reusable code snippet or automation script."
                  example={
                    <CodeBlock>
{`await claw.saveSnippet({
  name: 'backup-config',
  code: 'cp /etc/app/config.json /backup/config.json',
  language: 'bash',
  tags: ['utility', 'backup']
});`}
                    </CodeBlock>
                  }
                />
                <MethodEntry 
                  id="useSnippet" 
                  signature="claw.useSnippet(snippetId)" 
                  description="Mark a snippet as used (increments telemetry use_count)."
                  returns="Promise<{snippet: Object}>"
                />
              </section>

              {/* Compliance Engine (moved from v2) */}
              <section id="compliance-engine" className="scroll-mt-20 pt-12 border-t border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">Compliance Engine</h3>
                <MethodEntry
                  id="mapCompliance"
                  signature="claw.mapCompliance(framework) / claw.map_compliance(framework)"
                  description="Map active policies to a compliance framework's controls."
                  example={
                    <CodeBlock>
{`await claw.mapCompliance('SOC2');`}
                    </CodeBlock>
                  }
                />
                <MethodEntry
                  id="getProofReport"
                  signature="claw.getProofReport(format) / claw.get_proof_report(format)"
                  description="Generate a compliance proof report from active policies."
                  example={
                    <CodeBlock>
{`const report = await claw.getProofReport('json');`}
                    </CodeBlock>
                  }
                />
              </section>

              {/* Activity Logs (moved from v2) */}
              <section id="activity-logs" className="scroll-mt-20 pt-12 border-t border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">Activity Logs</h3>
                <MethodEntry
                  id="getActivityLogs"
                  signature="claw.getActivityLogs(filters) / claw.get_activity_logs(**filters)"
                  description="Query the immutable audit trail of all workspace changes and administrative events."
                  example={
                    <CodeBlock>
{`const logs = await claw.getActivityLogs({ limit: 10 });`}
                    </CodeBlock>
                  }
                />
              </section>

              {/* Webhooks (moved from v2) */}
              <section id="webhooks" className="scroll-mt-20 pt-12 border-t border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-2 font-mono underline decoration-border-hover underline-offset-8">Webhooks</h3>
                <MethodEntry
                  id="createWebhook"
                  signature="claw.createWebhook(url, events) / claw.create_webhook(url, events)"
                  description="Register an HMAC-signed webhook for real-time exfiltration of governance events."
                  example={
                    <CodeBlock>
{`await claw.createWebhook('https://api.myapp.com/hooks', ['approval_pending']);`}
                    </CodeBlock>
                  }
                />
              </section>
            </div>
          )}
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
