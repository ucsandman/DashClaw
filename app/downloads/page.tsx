import Link from 'next/link';
import {
  Download, Package, Cable, Network, Terminal, ChevronRight, ExternalLink,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../lib/marketingSeo';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Downloads: DashClaw',
  description:
    'Skills, plugins, hooks, and the MCP server: every DashClaw governance artifact in one place, with install commands for Claude Code, Codex, and Hermes Agent.',
  path: '/downloads',
});

interface SectionHeaderProps {
  icon: LucideIcon;
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
}

function SectionHeader({ icon: Icon, eyebrow, title, description }: SectionHeaderProps) {
  return (
    <div className="mb-8">
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-text-tertiary mb-3">
        {eyebrow}
      </p>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-surface-tertiary border border-border flex items-center justify-center">
          <Icon size={18} className="text-text-secondary" aria-hidden="true" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{title}</h2>
      </div>
      <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">{description}</p>
    </div>
  );
}

interface DownloadCardProps {
  name: React.ReactNode;
  role: React.ReactNode;
  sizeLabel?: React.ReactNode;
  primaryHref: string;
  primaryLabel: React.ReactNode;
  secondary?: React.ReactNode;
  mono?: boolean;
}

function DownloadCard({ name, role, sizeLabel, primaryHref, primaryLabel, secondary, mono = true }: DownloadCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-secondary p-5 hover:border-border-hover transition-colors">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="min-w-0">
          <h3 className={`text-sm ${mono ? 'font-mono' : 'font-semibold'} text-text-primary truncate`}>
            {name}
          </h3>
          {sizeLabel && (
            <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.12em] text-text-tertiary">
              {sizeLabel}
            </p>
          )}
        </div>
        <a
          href={primaryHref}
          download
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-brand text-white text-xs font-semibold px-3 py-1.5 hover:bg-brand-hover transition-colors"
        >
          <Download size={13} aria-hidden="true" />
          {primaryLabel}
        </a>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">{role}</p>
      {secondary}
    </div>
  );
}

interface CommandBlockProps {
  children: React.ReactNode;
  label?: React.ReactNode;
}

function CommandBlock({ children, label }: CommandBlockProps) {
  return (
    <div className="rounded-lg border border-border bg-surface-primary overflow-hidden">
      {label && (
        <div className="px-4 py-2 border-b border-border text-[11px] font-mono uppercase tracking-[0.12em] text-text-tertiary">
          {label}
        </div>
      )}
      <pre className="p-4 font-mono text-xs leading-relaxed text-text-secondary overflow-x-auto">
        {children}
      </pre>
    </div>
  );
}

interface PluginEntryProps {
  ecosystem: React.ReactNode;
  manifest: React.ReactNode;
  installCommand: React.ReactNode;
  agentId: React.ReactNode;
  description: React.ReactNode;
}

function PluginEntry({ ecosystem, manifest, installCommand, agentId, description }: PluginEntryProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-secondary p-5">
      <div className="flex items-baseline justify-between gap-4 mb-2 flex-wrap">
        <h3 className="text-sm font-semibold text-text-primary">{ecosystem}</h3>
        <code className="font-mono text-[11px] text-text-tertiary">{manifest}</code>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed mb-4">{description}</p>
      <CommandBlock label={`Install (agent_id: ${agentId})`}>{installCommand}</CommandBlock>
    </div>
  );
}

export default function DownloadsPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      <PublicNavbar />

      <section className="pt-32 pb-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-text-tertiary mb-4">
            <Link href="/" className="hover:text-text-secondary transition-colors">Home</Link>
            <ChevronRight size={14} aria-hidden="true" />
            <span className="text-text-secondary">Downloads</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-brand-subtle flex items-center justify-center">
              <Download size={20} className="text-brand" aria-hidden="true" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Downloads</h1>
          </div>
          <p className="text-text-secondary max-w-2xl leading-relaxed">
            Every DashClaw governance artifact in one place. Skills ship as zips you can drop into <code className="font-mono text-text-secondary text-sm">~/.claude/skills/</code>; plugins, hooks, and the MCP server install from a single command against the source repo.
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 pb-24 space-y-20">

        {/* ── Skills ── */}
        <section>
          <SectionHeader
            icon={Package}
            eyebrow="Skill bundles"
            title="Skills (zip)"
            description="Self-contained skill directories Claude Code, Claude Desktop, Codex, and Hermes Agent can load directly. Each zip contains a SKILL.md plus any references and scripts the skill needs."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <DownloadCard
              name="dashclaw-governance"
              role="Teaches an agent how to use DashClaw correctly: risk thresholds, decision handling (allow / warn / block / require_approval), action recording, session lifecycle, plus six new sections for handoffs, secret hygiene, skill safety, open loops, learning, and in-session retrospection."
              sizeLabel="SKILL.md + references"
              primaryHref="/downloads/dashclaw-governance.zip"
              primaryLabel="dashclaw-governance.zip"
              secondary={(
                <div className="mt-4">
                  <CommandBlock label="Unzip to ~/.claude/skills/">
{`unzip dashclaw-governance.zip -d ~/.claude/skills/`}
                  </CommandBlock>
                </div>
              )}
            />
          </div>
          <p className="mt-4 text-xs text-text-tertiary">
            Auto-installed when you install any of the agent plugins below. Source mirrors live in{' '}
            <code className="font-mono">public/downloads/</code> and{' '}
            <code className="font-mono">plugins/dashclaw/skills/</code> in the repo.
          </p>
        </section>

        {/* ── Plugins ── */}
        <section>
          <SectionHeader
            icon={Cable}
            eyebrow="Agent plugins"
            title="Plugins"
            description="One DashClaw plugin source, three ecosystems. Each plugin ships the MCP server config, both skills above, and an agent identity used to separate sessions by host (claude-code, codex, hermes)."
          />

          {/* Bundle download — single zip containing all three plugin manifests, MCP configs, mirrored skills, assets */}
          <div className="mb-6">
            <DownloadCard
              name="dashclaw-governance-plugin"
              role={`Full plugin bundle in one zip: the three plugin manifests (Claude Code / Codex / Hermes), MCP configs, both skills, assets, and PLUGIN_PARITY.md. Drop into your agent's plugin directory or extract for inspection. Manifest version v${process.env.NEXT_PUBLIC_PLUGIN_MANIFEST_VERSION}.`}
              sizeLabel="manifests + skills + MCP configs"
              primaryHref="/downloads/dashclaw-governance-plugin.zip"
              primaryLabel="dashclaw-governance-plugin.zip"
              secondary={(
                <div className="mt-4">
                  <CommandBlock label="Unzip">
{`unzip dashclaw-governance-plugin.zip
# produces a dashclaw/ tree you can drop into ~/.claude/plugins/, ~/.codex/plugins/, etc.`}
                  </CommandBlock>
                </div>
              )}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <PluginEntry
              ecosystem="Claude Code"
              manifest="plugins/dashclaw/.claude-plugin/plugin.json"
              agentId="claude-code"
              description="MCP server + governance skill, plus a hooks installer for PreToolUse / PostToolUse / Stop guards over Bash, Edit, Write, and MultiEdit."
              installCommand={`# Native plugin marketplace (inside Claude Code):
/plugin marketplace add ucsandman/DashClaw
/plugin install dashclaw@dashclaw

# Or via the CLI, no clone required:
npm i -g @dashclaw/cli
dashclaw install claude            # prompts for endpoint + API key
dashclaw install claude --trial    # hosted signup, paste the key

# From a repo checkout:
npm run hooks:install`}
            />
            <PluginEntry
              ecosystem="Codex"
              manifest="plugins/dashclaw/.codex-plugin/plugin.json"
              agentId="codex"
              description="Same governance surface DashClaw ships for Claude Code, wired into Codex's ~/.codex/config.toml: MCP server config, PreToolUse / PostToolUse / Stop hooks, governance protocol in AGENTS.md. Idempotent; re-run after every git pull."
              installCommand={`node cli/bin/dashclaw.js install codex \\
  --project /path/to/your/project

# Optional: opt in to legacy notify config
node cli/bin/dashclaw.js install codex \\
  --project /path/to/your/project --include-notify`}
            />
            <PluginEntry
              ecosystem="Hermes Agent"
              manifest="plugins/dashclaw/.hermes-plugin/plugin.yaml"
              agentId="hermes"
              description="Eight lifecycle hooks: pre/post tool, pre/post LLM call with per-turn governance context injection, on-session start/end with live ingest finalize, secret redaction in tool output, and subagent_stop ROI tracking. Wires handoffs end-to-end across sessions."
              installCommand={`# macOS / Linux
bash scripts/install-hermes-plugin.sh

# Windows
powershell -File scripts/install-hermes-plugin.ps1

# Sanity check
hermes dashclaw doctor`}
            />
          </div>
        </section>

        {/* ── MCP server ── */}
        <section>
          <SectionHeader
            icon={Network}
            eyebrow="Model Context Protocol"
            title="MCP server"
            description="17 governance tools plus 3 read-only resources. Ships inside every plugin above as the on-disk path mcp-server/bin/dashclaw-mcp.js. Also reachable as Streamable HTTP at /api/mcp on any DashClaw deployment, no install required."
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-3">stdio (Claude Code / Desktop)</h3>
              <CommandBlock label="claude_desktop_config.json">{`{
  "mcpServers": {
    "dashclaw": {
      "command": "node",
      "args": [
        "/path/to/DashClaw/mcp-server/bin/dashclaw-mcp.js",
        "--agent-id", "claude-code"
      ],
      "env": {
        "DASHCLAW_URL": "https://your-instance.vercel.app",
        "DASHCLAW_API_KEY": "oc_live_..."
      }
    }
  }
}`}</CommandBlock>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-3">Streamable HTTP (Managed Agents)</h3>
              <CommandBlock label="Python">{`mcp_servers=[{
    "type": "url",
    "url": "https://your-instance.vercel.app/api/mcp",
    "headers": {"x-api-key": "oc_live_..."},
    "name": "dashclaw"
}]`}</CommandBlock>
            </div>
          </div>
          <p className="mt-4 text-xs text-text-tertiary">
            Full tool catalogue and resource list:{' '}
            <Link href="/docs#mcp-server" className="text-brand hover:text-brand-hover">/docs#mcp-server</Link>.
          </p>
        </section>

        {/* ── Hooks ── */}
        <section>
          <SectionHeader
            icon={Terminal}
            eyebrow="Claude Code hooks"
            title="Hooks"
            description="Govern Claude Code tool calls without per-call SDK code. Installs four hooks (PreToolUse, PostToolUse, Stop, and a SessionStart memory digest) plus the tool-classification module into .claude/hooks/, then merges the relevant blocks into .claude/settings.json. Idempotent; re-run after every git pull to upgrade."
          />

          {/* Hooks bundle download */}
          <div className="mb-6">
            <DownloadCard
              name="dashclaw-claude-code-hooks"
              role="The hook scripts (pretool, posttool, stop, and the enforcement-liveness probe), the dashclaw_agent_intel/ tool-classification module, default settings.json, and the test suite. Drop the unzipped hooks/ directory into your project's .claude/hooks/."
              sizeLabel="hooks + agent_intel + tests"
              primaryHref="/downloads/dashclaw-claude-code-hooks.zip"
              primaryLabel="dashclaw-claude-code-hooks.zip"
              secondary={(
                <div className="mt-4">
                  <CommandBlock label="Unzip into your project">
{`unzip dashclaw-claude-code-hooks.zip -d <your-project>/.claude/
# Then merge .claude/hooks/settings.json snippets into your .claude/settings.json`}
                  </CommandBlock>
                </div>
              )}
            />
          </div>

          <div className="rounded-xl border border-border bg-surface-secondary p-5">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Or install from a repo checkout</h3>
            <CommandBlock label="Install from a DashClaw checkout">{`npm run hooks:install`}</CommandBlock>
            <div className="h-3" />
            <CommandBlock label="Install from any other project pointing at a DashClaw checkout">{`node /path/to/DashClaw/scripts/install-hooks.mjs --target=.`}</CommandBlock>
          </div>
          <p className="mt-4 text-xs text-text-tertiary">
            The Stop hook captures per-turn LLM token usage from the session transcript and PATCHes it onto the action records the pretool opened during the turn; cost analytics light up without per-agent instrumentation. Required env:{' '}
            <code className="font-mono">DASHCLAW_BASE_URL</code>,{' '}
            <code className="font-mono">DASHCLAW_API_KEY</code>, optional{' '}
            <code className="font-mono">DASHCLAW_HOOK_MODE=enforce</code>.
          </p>
        </section>

        {/* ── SDKs ── */}
        <section>
          <SectionHeader
            icon={Package}
            eyebrow="Programmatic surface"
            title="SDKs"
            description="For custom agents and frameworks. The 4-step governance loop and full method catalogue live in /docs. Versions current as of this build."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
                <h3 className="text-sm font-semibold text-text-primary">Node SDK</h3>
                <a
                  href="https://www.npmjs.com/package/dashclaw"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono text-text-tertiary hover:text-text-secondary inline-flex items-center gap-1"
                >
                  npmjs.com/package/dashclaw
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">
                Canonical 40-method surface across core governance, durable execution finality, security scanning, sessions and the action graph, agent identity, risk signals, policy simulation, plan authorization and attestation, delegation constraints, containment verdicts, and team tasks.
              </p>
              <CommandBlock label="Install">{`npm install dashclaw`}</CommandBlock>
            </div>
            <div className="rounded-xl border border-border bg-surface-secondary p-5">
              <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
                <h3 className="text-sm font-semibold text-text-primary">Python SDK</h3>
                <a
                  href="https://pypi.org/project/dashclaw/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono text-text-tertiary hover:text-text-secondary inline-flex items-center gap-1"
                >
                  pypi.org/project/dashclaw
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed mb-3">
                Broader Python surface (60 methods) with framework integrations: CrewAI task instrumentation and AutoGen conversation monitoring.
              </p>
              <CommandBlock label="Install">{`pip install dashclaw`}</CommandBlock>
            </div>
          </div>
        </section>

        {/* ── Reference link ── */}
        <section className="border-t border-border pt-12">
          <p className="text-sm text-text-secondary">
            Full integration reference, API method tables, OpenAPI spec, and self-host runbook live in{' '}
            <Link href="/docs" className="text-brand hover:text-brand-hover">/docs</Link>. Source code on{' '}
            <a
              href="https://github.com/ucsandman/DashClaw"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:text-brand-hover inline-flex items-center gap-1"
            >
              GitHub
              <ExternalLink size={12} aria-hidden="true" />
            </a>.
          </p>
        </section>
      </div>

      <PublicFooter />
    </div>
  );
}
