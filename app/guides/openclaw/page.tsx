import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight, Waypoints } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'OpenClaw Integration Guide - DashClaw',
  description:
    'Add governance to OpenClaw agents with DashClaw in under 20 minutes.',
  path: '/guides/openclaw',
});

export default async function OpenClawGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const pluginConfigJson = `{
  "plugins": {
    "entries": {
      "dashclaw-governance": {
        "enabled": true,
        "config": {
          "dashclawUrl": "${baseUrl}",
          "dashclawApiKey": "oc_live_...",
          "agentId": "my-openclaw-agent",
          "failClosed": true,
          "highRiskTools": ["bash", "exec", "write_file"]
        }
      }
    }
  }
}`;

  const guardrailsYaml = `version: 1
project: my-openclaw-agent
description: >
  Governance policy for an OpenClaw agent.
  Block destructive shell commands.
  Require approval on deployment commands.

policies:
  - id: block_destructive_shell
    description: Block irreversible filesystem destruction
    applies_to:
      tools:
        - bash
        - exec
    rule:
      block: true
    when:
      command_contains:
        - "rm -rf"
        - "drop table"

  - id: approve_deploys
    description: Production deploys require human approval
    applies_to:
      tools:
        - bash
    rule:
      require: approval
    when:
      command_contains:
        - "git push origin main"
        - "vercel deploy"
        - "kubectl apply"`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary:
        'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Install the plugin',
      summary:
        'Install through the OpenClaw plugin CLI. The plugin self registers via openclaw.plugin.json; no manual import or wiring is required.',
      codeTitle: 'Terminal',
      codeBody: 'openclaw plugins install @dashclaw/openclaw-plugin',
    },
    {
      number: 3,
      title: 'Set environment variables',
      summary:
        'Export your DashClaw connection details before the gateway starts. API keys for self hosted instances start with oc_live_.',
      codeTitle: '.env',
      codeBody: `DASHCLAW_BASE_URL=${baseUrl}
DASHCLAW_API_KEY=oc_live_...
DASHCLAW_AGENT_ID=my-openclaw-agent`,
    },
    {
      number: 4,
      title: 'Configure the plugin',
      summary:
        'Drop a config block into your OpenClaw settings. Pick the tools that should always start at high risk; the classifier may raise the score further for known dangerous commands but will not lower it.',
      codeTitle: 'openclaw.config.json',
      codeBody: pluginConfigJson,
      note:
        'failClosed defaults to true. If DashClaw is unreachable, the plugin blocks the action instead of allowing it. This is the correct default for governance. Do not flip it to false unless you have a specific reason and you have thought through what happens when your governance plane goes down.',
    },
    {
      number: 5,
      title: 'Run your OpenClaw agent and trigger a tool call',
      summary:
        'Start your agent and ask it to do something that uses a governed tool (bash, write, edit). The plugin classifies the tool call, runs guard against your policies, waits for approval if required, and records the outcome to DashClaw.',
      codeTitle: 'Example prompt',
      codeBody:
        'Create a file called hello.txt with the contents "Hello from a governed agent"',
      note:
        'Watch the gateway logs. You should see [dashclaw-governance] entries as the plugin classifies and guards each tool call.',
    },
    {
      number: 6,
      title: 'See the result in DashClaw',
      summary:
        'Open your DashClaw dashboard to confirm the action was recorded.',
      note:
        "Go to /decisions. You should see your tool call in the ledger with agent_id 'my-openclaw-agent' and a classified action_type (apply for a file write, deploy for a git push, security for sensitive paths, or other for unknown tools).",
    },
  ];

  const proofMoment =
    "Go to /decisions. You should see your OpenClaw tool call in the ledger with agent_id 'my-openclaw-agent', a classified action_type that matches the tool call, and status 'completed'. Token usage and cost are attributed automatically once the agent's next LLM turn completes.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'OpenClaw Integration Guide - DashClaw',
          description: 'Add governance to OpenClaw agents with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/openclaw',
        }}
      />
      <PublicNavbar />

      <main className="px-6 pb-20 pt-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center gap-2 text-sm text-tertiary">
            <Link href="/" className="transition-colors hover:text-secondary">
              Home
            </Link>
            <ChevronRight size={14} />
            <Link href="/connect" className="transition-colors hover:text-secondary">
              Connect
            </Link>
            <ChevronRight size={14} />
            <span className="text-secondary">OpenClaw</span>
          </div>

          <p className="mb-6 text-sm text-secondary leading-relaxed">
            OpenClaw is where DashClaw&apos;s &ldquo;Claw&rdquo; comes from: it was the first
            agent runtime we governed, and this plugin remains one of the deepest integrations:
            the full guard &rarr; record &rarr; approval &rarr; outcome loop on every tool call,
            with token-cost attribution built in.
          </p>

          <GuideClient
            frameworkName="OpenClaw"
            frameworkIcon={<Waypoints size={28} />}
            steps={steps}
            proofMoment={proofMoment}
            guardrailsYaml={guardrailsYaml}
            baseUrl={baseUrl}
          />

          {/* What gets governed (plugin-specific reference, mirrors the README classification table) */}
          <section className="mt-6 rounded-xl border border-border-hover bg-surface-secondary p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              What gets governed
            </p>
            <p className="mt-4 text-sm text-secondary leading-relaxed">
              The plugin classifies each tool call before it executes. Bash commands are parsed against known intent sets (git, rm, curl, npm). File operations are scanned for sensitive paths (<span className="font-mono text-secondary">.env</span>, credentials, private keys). Unknown tools fall through to action_type <span className="font-mono text-secondary">other</span> with a configurable default risk score of 50. Tools listed in <span className="font-mono text-secondary">highRiskTools</span> always start at risk 85; the classifier may raise the score further but will not lower it.
            </p>
            <div className="mt-5 overflow-hidden rounded-xl border border-border-hover">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-tertiary">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">Tool call</th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">action_type</th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">Risk</th>
                    <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-tertiary">Reversible</th>
                  </tr>
                </thead>
                <tbody className="text-secondary">
                  {[
                    { tool: 'bash: git push origin main', type: 'deploy', risk: 80, reversible: 'no' },
                    { tool: 'bash: rm -rf /tmp/data', type: 'security', risk: 90, reversible: 'no' },
                    { tool: 'write: .env.production', type: 'security', risk: 85, reversible: 'yes' },
                    { tool: 'read: config.json', type: 'review', risk: 15, reversible: 'yes' },
                  ].map((row) => (
                    <tr key={row.tool} className="border-t border-border">
                      <td className="px-4 py-3 font-mono text-xs">{row.tool}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.type}</td>
                      <td className="px-4 py-3 text-xs tabular-nums">{row.risk}</td>
                      <td className="px-4 py-3 text-xs">{row.reversible}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-tertiary leading-relaxed">
              The classification vocabulary matches the DashClaw Claude Code hooks, so guard policies you write for one apply automatically to the other. Full reference and configuration options:{' '}
              <a
                href="https://github.com/ucsandman/DashClaw/tree/main/packages/openclaw-plugin#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:text-brand-hover transition-colors"
              >
                @dashclaw/openclaw-plugin README
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
