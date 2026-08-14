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
    'Add governance to OpenClaw agents with DashClaw in one command.',
  path: '/guides/openclaw',
});

export default async function OpenClawGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

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

  const subhead = (
    <>
      One command wires DashClaw governance into an OpenClaw agent — even with no DashClaw
      instance or API key yet; it offers to create both. Restart the gateway and your
      next tool call shows up in <span className="text-secondary">/decisions</span>.
    </>
  );

  const steps = [
    {
      number: 1,
      title: 'Prerequisites',
      summary:
        'One thing before you start: OpenClaw installed and on PATH. A DashClaw instance and an API key help but are no longer required — run the install command without them and it offers to create both: the free hosted trial (sign in, paste the minted key) or a local instance on this machine via dashclaw up.',
      note: 'The CLI comes with npm: npm i -g @dashclaw/cli, or run everything through npx @dashclaw/cli.',
    },
    {
      number: 2,
      title: 'Run the install command',
      summary:
        'One command asks for anything it is missing, then installs the dashclaw-governance plugin, patches your OpenClaw config, enables the plugin, and writes the governance block into AGENTS.md. It prompts for an agent id with a per-machine default (<hostname>-openclaw): moltfire-openclaw, forge-openclaw, whatever fits your fleet. Reuse one id across machines and /decisions cannot tell the agents apart. Flags (--base-url, --api-key, --agent-id) or env vars skip the prompts; without a terminal the command fails loudly instead of hanging.',
      codeTitle: 'Terminal',
      codeBody: 'dashclaw install openclaw',
      note:
        'The API key is written as DASHCLAW_API_KEY to the .env beside your openclaw.json, so it follows openclaw --profile rather than always landing in the default profile. Pass --write-config to store it in openclaw.json instead. The key is written before the plugin is enabled, on purpose: a plugin that comes up with no key refuses every tool call. The installer also sets failClosed: true, and there is currently no flag to change it: if DashClaw is unreachable, the plugin blocks the call instead of letting it through. Already ran "openclaw plugins install @dashclaw/openclaw-plugin" by hand? Run this command anyway: the raw install only puts the plugin on disk, with no key, no config, and not enabled. The installer detects it, keeps it (it never downgrades an equal-or-newer version), and finishes the rest.',
    },
    {
      number: 3,
      title: 'Restart the gateway',
      summary:
        'OpenClaw reads plugin config when its processes start, so the newly enabled plugin has no effect until you restart.',
      codeTitle: 'Terminal',
      codeBody: 'openclaw gateway restart',
    },
    {
      number: 4,
      title: 'Trigger a governed tool call',
      summary:
        'Start the agent and give it something that uses a governed tool: bash, write, edit. From here governance is automatic. Guard runs before the call, a record opens, the call waits if a policy requires approval, and the outcome is recorded after. The agent calls no DashClaw tools itself. An Agent Session opens on its first tool call and closes when the run ends.',
      codeTitle: 'Example prompt',
      codeBody:
        'Create a file called hello.txt with the contents "Hello from a governed agent"',
      note:
        'Watch the gateway logs. You should see [dashclaw-governance] entries as the plugin classifies and guards the call.',
    },
    {
      number: 5,
      title: 'Verify it is working',
      summary:
        'Two checks: ask OpenClaw if the plugin is healthy, then look for the tool call in DashClaw.',
      codeTitle: 'Terminal',
      codeBody: 'openclaw plugins doctor',
      note:
        'Then open /decisions in your DashClaw instance. The tool call should be there within seconds, tagged with the agent id you installed with.',
    },
  ];

  const proofMoment =
    "Go to /decisions. You should see your OpenClaw tool call in the ledger with agent_id 'moltfire-openclaw', a classified action_type that matches the tool call, and status 'completed'. Token usage and cost are attributed automatically once the agent's next LLM turn completes.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'OpenClaw Integration Guide - DashClaw',
          description: 'Add governance to OpenClaw agents with DashClaw in one command.',
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
            subhead={subhead}
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
              The plugin classifies each tool call before it executes. Bash commands are parsed against known intent sets (git, rm, curl, npm). File operations are scanned for sensitive paths (<span className="font-mono text-secondary">.env</span>, credentials, private keys). Unknown tools fall through to action_type <span className="font-mono text-secondary">other</span> with a configurable default risk score of 50. Tools listed in <span className="font-mono text-secondary">highRiskTools</span>, set in the same <span className="font-mono text-secondary">openclaw.json</span> the installer patches, start at risk 85 instead of the default. A pattern match then takes precedence over that starting score in both directions: a destructive command scores 90, a deploy scores 80, and read-only tools are capped at 15 no matter what they started at.
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
                    { tool: 'write: hello.txt', type: 'apply', risk: 50, reversible: 'yes' },
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

          {/* Automatic identity pairing (v1.6.0+ plugin behavior) */}
          <section className="mt-6 rounded-xl border border-border-hover bg-surface-secondary p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              Automatic identity pairing
            </p>
            <p className="mt-4 text-sm text-secondary leading-relaxed">
              Click <span className="font-mono text-secondary">Request pairing</span> next to your agent on{' '}
              <span className="font-mono text-secondary">/identities</span> and the plugin answers on the
              agent&apos;s next tool call: it generates an RSA-2048 keypair locally, submits the public key,
              and the pairing appears under Pending Pairings for your one-click approval. The private key is
              written to <span className="font-mono text-secondary">~/.dashclaw/identity/&lt;agentId&gt;.pem</span>{' '}
              and never leaves the agent&apos;s machine. Approval is what creates the identity — the agent
              cannot enroll itself. Disable with <span className="font-mono text-secondary">autoPairing: false</span>{' '}
              in <span className="font-mono text-secondary">openclaw.json</span>, the same file the installer patches.
            </p>
          </section>

          {/* Troubleshooting: the failure mode this whole feature exists to fix */}
          <section className="mt-6 rounded-xl border border-border-hover bg-surface-secondary p-6 sm:p-8">
            <p className="text-xs uppercase tracking-[0.32em] text-tertiary">
              Troubleshooting
            </p>
            <p className="mt-4 text-sm text-secondary leading-relaxed">
              <span className="font-semibold text-white">
                &ldquo;My agent says it cannot reach the dashclaw MCP server.&rdquo;
              </span>{' '}
              OpenClaw has no DashClaw MCP server, and never did. Governance runs at the gateway:
              the <span className="font-mono text-secondary">dashclaw-governance</span> plugin
              intercepts every tool call before it executes, so the agent is not supposed to call
              anything itself.
            </p>
            <p className="mt-4 text-sm text-secondary leading-relaxed">
              If <span className="font-mono text-secondary">AGENTS.md</span> instructs the agent to
              call <span className="font-mono text-secondary">dashclaw_session_start</span> through
              an MCP server, that block came from{' '}
              <span className="font-mono text-secondary">dashclaw install codex</span> running
              against this same workspace, which is easy to do if the OpenClaw agent runs Codex as
              its underlying runtime. The agent then fail-closes on a tool that does not exist here,
              even though the gateway plugin is governing every call correctly the whole time.
            </p>
            <p className="mt-4 text-sm text-secondary leading-relaxed">
              Fix: re-run the install command. It recognizes the codex-authored block, replaces it
              with the OpenClaw protocol, and leaves a{' '}
              <span className="font-mono text-secondary">.dashclaw-bak</span> copy of what was there
              before.
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-border-hover bg-surface-tertiary">
              <pre className="overflow-x-auto whitespace-pre-wrap px-4 py-4 text-xs text-secondary">dashclaw install openclaw</pre>
            </div>
          </section>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
