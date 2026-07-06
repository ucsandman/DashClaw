import type { GuideData, HttpCapture, McpCapture, SdkCapture } from '../types';
import type { CodeForm } from '../components/CodeTabs';

/** Sidebar nav groups: area ids in reading order. Areas not listed fall into "API Reference". */
export const NAV_GROUPS: Array<{ label: string; areaIds: string[] }> = [
  { label: 'Start here', areaIds: ['quickstart', 'auth', 'setup'] },
  { label: 'Product surfaces', areaIds: ['pages'] },
  {
    label: 'Core governance API',
    areaIds: ['api-guard', 'api-actions', 'api-policies', 'api-approvals', 'api-assumptions', 'api-agents'],
  },
  { label: 'API reference', areaIds: [] }, // filled with remaining api-* areas at render time
  { label: 'SDKs & tooling', areaIds: ['sdk-node', 'sdk-python', 'cli', 'mcp', 'hooks', 'plugins'] },
  { label: 'Everything else', areaIds: ['other'] },
];

/** Curated one-paragraph intros per area id. Areas without an entry get a generated line. */
export const AREA_BLURBS: Record<string, string> = {
  pages:
    'Every page a human can open in the product, with the click path to reach it. Pages marked beta sit behind the collapsed "Labs" group in the sidebar; archived pages are unreachable.',
  'api-guard':
    'The heart of DashClaw: POST /api/guard evaluates an intended action against org policies BEFORE it happens and returns allow, warn, block, or require_approval. Evidence-first: attach the actual act (shell command, HTTP request, SQL, file write) and the server classifies it independently of what the agent claims.',
  'api-actions':
    'The decision ledger. Record what agents did (POST /api/actions), track outcomes, open loops, costs, and replay causal chains. Every governed action lands here and feeds /decisions and Mission Control.',
  'api-policies':
    'CRUD for guard policies plus policy modes (pre-built packs like claude-code, openclaw, research). Policy types observed live: risk_threshold, require_approval, block_action_type, rate_limit, protected_path, permission_escalation, x402_spend_limit, behavioral_anomaly, non_fabrication, allow_grant, warn_action_type.',
  'api-approvals':
    'The human half of require_approval: list pending approvals, approve or deny with a reason. Approvals bind to the exact act content hash the agent presented (approve-X-do-Y is closed).',
  'api-assumptions':
    'Track the assumptions an agent made while acting, tied to the action that depended on them, with confidence and impact-if-wrong.',
  'api-agents': 'Fleet registry: agent heartbeats, connections, lineage, and per-agent governance coverage.',
  'sdk-node':
    'The canonical Node/TypeScript SDK (npm install dashclaw). One DashClaw client, zero runtime dependencies, Node 18+. Note on counts: this list includes the constructor, error classes, and the execution.capabilities namespace, so it is larger than the official public-method count (scripts/count-sdk-methods.mjs), which counts class-body methods only. The dashclaw/legacy subpath is DEPRECATED and will be removed in v5.0.0 — its 193 methods are listed here so you can migrate off them deliberately.', // version-hardcode-allowed
  'sdk-python':
    'The Python SDK (pip install dashclaw) mirrors the platform surface with snake_case names — 234 public methods on one DashClaw client. OpenClawAgent is a plain alias of DashClaw.',
  cli: 'The @dashclaw/cli terminal client: one-command local install (npx dashclaw up), approvals inbox, kill switch, doctor, code-session ingest, and governance provisioning for Claude Code and Codex.',
  mcp: 'The @dashclaw/mcp-server package exposes governance as MCP tools for Claude Code, Claude Desktop, Codex, and any MCP host. Needs only a base URL and an API key (agent id optional — org_id is NOT required).',
  hooks:
    'Claude Code PreToolUse/PostToolUse/Stop hooks that intercept every tool call and route it through guard, with Codex and Hermes parity surfaces. DASHCLAW_HOOK_MODE controls enforcement.',
  plugins:
    'The distributable plugin bundles: the Claude Code plugin (MCP server + governance skills + hooks in one install), the Codex provisioning surface (dashclaw install codex), the Hermes lifecycle-hook plugin, and the OpenClaw gateway plugin. One entry per hook, skill, manifest, and runtime target — parity gaps are marked, not hidden.',
  auth: 'How every request authenticates: the x-api-key header, agent vs operator/admin keys, OAuth bearer, the pairing flow, and org scoping. Includes the classic 503 SCHEMA_NOT_INITIALIZED trap.',
  setup:
    'Everything needed to run your own instance: required env vars (from .env.example), npx dashclaw up, Vercel deploy, db:migrate, and the /setup readiness page.',
  other: 'Surfaces that fit no other bucket: the floating widget, webhook destination formats, notification adapters, the livingcode dashboard, /proof, and downloadable bundles.',
  'api-archive':
    'Legacy platform-era routes preserved under app/api/_archive. The leading underscore makes the folder PRIVATE in the Next.js App Router — none of these routes are reachable at runtime. Documented for completeness; do not build on them.',
};

const find = <T extends { id: string }>(list: T[], id: string): T | undefined => list.find((c) => c.id === id);

function bashVariant(psCommand: string): string {
  return psCommand
    .replace(/curl\.exe/g, 'curl')
    .replace(/\$env:DASHCLAW_API_KEY/g, '$DASHCLAW_API_KEY')
    .replace(/\$env:DASHCLAW_OPERATOR_KEY/g, '$DASHCLAW_OPERATOR_KEY');
}

function httpForms(cap: HttpCapture | undefined): CodeForm[] {
  if (!cap) return [];
  return [
    { label: 'PowerShell', code: cap.command, response: cap.response, verified: cap.capturedAt },
    { label: 'bash', code: bashVariant(cap.command), response: cap.response, verified: cap.capturedAt },
  ];
}

function sdkForm(cap: SdkCapture | undefined, label: string): CodeForm[] {
  if (!cap || cap.error) return [];
  return [{ label, code: cap.code, response: cap.response, verified: cap.verified }];
}

function mcpForm(cap: McpCapture | undefined): CodeForm[] {
  if (!cap) return [];
  return [
    {
      label: 'MCP tool',
      code: `${cap.tool}(${JSON.stringify(cap.request, null, 2)})`,
      response: cap.response + (cap.note ? `\n\n// ${cap.note}` : ''),
      verified: cap.verified,
    },
  ];
}

export interface QuickstartExample {
  title: string;
  blurb: string;
  forms: CodeForm[];
}

/**
 * The governed-action core loop, assembled from LIVE captures only. Every
 * request/response pair below was actually executed (localhost instance for
 * HTTP/SDK, a live hosted instance for MCP) — nothing is fabricated.
 */
export function buildQuickstart(data: GuideData): QuickstartExample[] {
  const { http, mcp, sdkNode, sdkPython } = data.liveExamples;
  return [
    {
      title: '0. Prove the instance is up',
      blurb: 'GET /api/health is public — no key needed. Use it as the first smoke check after any install.',
      forms: httpForms(find(http, 'health')),
    },
    {
      title: '1. Guard: ask before acting',
      blurb:
        'Evaluate an intended action against policy BEFORE doing it. Attach the real act as evidence — the server classifies it, blends server risk over the client-reported score, and returns the verdict.',
      forms: [
        ...httpForms(find(http, 'guard-check')),
        ...sdkForm(find(sdkNode, 'sdk-guard'), 'TypeScript'),
        ...sdkForm(find(sdkPython, 'py-guard'), 'Python'),
        ...mcpForm(find(mcp, 'mcp-guard')),
      ],
    },
    {
      title: '2. Record: write the ledger entry',
      blurb:
        'After acting, record what happened. Recording also runs a guard evaluation and a security scan; the server risk score overrides the client-reported one.',
      forms: [
        ...httpForms(find(http, 'action-record')),
        ...sdkForm(find(sdkNode, 'sdk-create-action'), 'TypeScript'),
        ...sdkForm(find(sdkPython, 'py-create-action'), 'Python'),
        ...mcpForm(find(mcp, 'mcp-record')),
      ],
    },
    {
      title: '3. Read the decision ledger',
      blurb: 'Every guard verdict is queryable — this feeds /decisions and Mission Control.',
      forms: [...httpForms(find(http, 'guard-decisions')), ...mcpForm(find(mcp, 'mcp-decisions-recent'))],
    },
    {
      title: '4. Track assumptions and loops',
      blurb: 'Attach the assumptions an action depended on (requires the action_id from step 2).',
      forms: [...httpForms(find(http, 'assumption-record')), ...httpForms(find(http, 'loops-list'))],
    },
    {
      title: '5. Check governance posture',
      blurb: 'The org-wide 0-100 posture score, six dimensions, and the prioritized remediation queue.',
      forms: [...httpForms(find(http, 'posture')), ...mcpForm(find(mcp, 'mcp-posture'))],
    },
  ];
}
