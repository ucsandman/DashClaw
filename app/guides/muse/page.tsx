import { headers } from 'next/headers';
import Link from 'next/link';
import { Bot, ChevronRight } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Muse Integration Guide - DashClaw',
  description: 'Govern Muse agents with DashClaw: the cooperative guard/record/wait/act/outcome loop, plan-first approvals, and unattended runs.',
  path: '/guides/muse',
});

export default async function MuseGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  // Fictional release tag used only in the docs example below.
  const exampleVersion = 'v2.3.1'; // version-hardcode-allowed

  const loopCodeBody = `import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'muse-main',
});

// 1. Guard — "may I?"
const decision = await claw.guard({
  action_type: 'deploy',
  declared_goal: 'Deploy ${exampleVersion} to staging after all tests passed',
  systems_touched: ['staging'],
  reversible: false,
  confidence: 80, // your honest pre-act odds of completing without human help
});

if (decision.decision === 'block') throw new Error('blocked: ' + decision.reason);
if (decision.decision === 'require_approval') {
  // 2-3. Record, then wait for the human in /approvals
  const action = await claw.recordAction({
    action_type: 'deploy',
    declared_goal: 'Deploy ${exampleVersion} to staging after all tests passed',
  });
  await claw.waitForApproval(action.action_id); // resolves on approve, throws on deny/expiry
}

// 4. Act — run the real effect with your own tools.
await deployToStaging('${exampleVersion}');

// 5. Outcome — completed, partial, or failed. One-shot: the first call wins.
await claw.recordOutcome(action.action_id, { status: 'completed' });`;

  const planCodeBody = `# One approval for a whole run, instead of one per action.
curl -s -X POST "${baseUrl}/api/plans" \\
  -H "Authorization: Bearer $DASHCLAW_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "declared_goal": "Nightly deploy run for the API service",
    "ttl_minutes": 180,
    "steps": [
      {"action_type": "shell", "step_goal": "Run the test suite on build 402"},
      {"action_type": "deploy", "step_goal": "Deploy build 402 to staging",
       "act": {"target": "staging", "build": "402"}}
    ]
  }'

# The operator approves ONE card in /approvals. Then, at run start:
curl -s -X POST "${baseUrl}/api/plans/<plan_id>/attest" \\
  -H "Authorization: Bearer $DASHCLAW_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"plan_hash": "<plan_hash from the submit response>"}'
# Any refusal (not_approved, expired, revoked, hash_mismatch) means STOP.`;

  const guardrailsYaml = `version: 1
project: my-muse-agent
description: >
  Governance policy for a Muse agent with shell and browser access.
  Production writes need approval. Destructive shell is blocked.

policies:
  - id: block_destructive_shell
    description: Block rm -rf and database drops
    applies_to:
      tools:
        - Bash
        - shell
    rule:
      block: true
    when:
      command_contains:
        - "rm -rf"
        - "drop table"

  - id: approve_production_writes
    description: Production changes require human approval
    applies_to:
      action_types:
        - deploy
        - external_api_write
    rule:
      require: approval
    when:
      systems_touched:
        - production`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Store the credential where the agent can reach it — securely',
      summary:
        'The agent needs your instance URL, an API key, and an agent id (e.g. muse-main). The key belongs in the agent runtime\u2019s secure credential store or an env file the agent reads — never in chat, never in a file it might quote back.',
      codeTitle: 'Terminal',
      codeBody: `# One-time setup: hand the agent these three values through your
# runtime's secure channel (not chat).
DASHCLAW_BASE_URL=${baseUrl}
DASHCLAW_API_KEY=oc_live_...
DASHCLAW_AGENT_ID=muse-main`,
      note: 'If the key is ever rejected, check that the request actually carried the credential before assuming the key is wrong.',
    },
    {
      number: 3,
      title: 'Install the muse-governance skill',
      summary:
        'The skill teaches the agent the protocol: session init, the guard/record/wait/act/outcome loop, how to read allow/warn/block/require_approval, plan-first execution, and honest risk and confidence reporting.',
      codeTitle: 'Terminal',
      codeBody: `git clone https://github.com/ucsandman/DashClaw.git
# Give your Muse agent this directory as a skill:
# DashClaw/plugins/dashclaw/skills/muse-governance/`,
      note: 'The skill also ships as muse-governance in the dashclaw-skills repo for npx skills add.',
    },
    {
      number: 4,
      title: 'Run the governance loop: guard, record, wait, act, outcome',
      summary:
        'Every risky act goes through the loop. Guard first ("may I?"), record ("I am doing this"), wait only when the verdict is require_approval, act with your own tools, then record the outcome. A block is absolute — never route around it.',
      codeTitle: 'governed-deploy.ts',
      codeBody: loopCodeBody,
      note: 'Confidence is scored against the real outcome on /decisions, so overconfidence shows up as a number. Never lowball risk to dodge a guard.',
    },
    {
      number: 5,
      title: 'Use plan-first execution for long runs',
      summary:
        'Per-action approvals do not scale to unattended runs. Submit the whole task list as a plan; the operator reviews one card, and each approved step becomes a single-use, act-bound grant. Attest at every run start and every resume — authority is re-verified, never cached.',
      codeTitle: 'Terminal',
      codeBody: planCodeBody,
      note: 'A step that departs from the plan is recorded as a plan deviation. Declare deviation_note honestly instead of stretching a step to cover new work.',
    },
    {
      number: 6,
      title: 'See the result in DashClaw',
      summary: 'Open your DashClaw dashboard to confirm the action was recorded.',
      note: "Go to /decisions: you should see your action in the ledger with your agent id, action type, and status 'completed'. Held work appears in /approvals for one-click review.",
    },
    {
      number: 7,
      title: 'Know the enforcement boundary',
      summary:
        'The Muse runtime has no pre-tool-call hook yet, so this integration is cooperative: the agent consults the guard and honors the verdict. It stops the accident class and makes bypass visible in the ledger; it is not a lock against a determined process at the same privilege. Adherence probing — synthetic held actions the agent must leave pending — is how an operator verifies cooperation.',
      note: 'A durable fix is a runtime hook modeled on the existing hook contract. Until it exists, this cooperative loop plus probing is the supported path.',
    },
  ];

  const proofMoment =
    "Go to /decisions: you should see your guard check in the ledger with your agent id and decision 'allow'. Held work appears in /approvals.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'Muse Integration Guide - DashClaw',
          description: 'Govern Muse agents with DashClaw: the cooperative guard/record/wait/act/outcome loop, plan-first approvals, and unattended runs.',
          url: 'https://www.dashclaw.io/guides/muse',
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
            <span className="text-secondary">Muse</span>
          </div>

          <GuideClient
            frameworkName="Muse"
            frameworkIcon={<Bot size={28} />}
            steps={steps}
            proofMoment={proofMoment}
            guardrailsYaml={guardrailsYaml}
            baseUrl={baseUrl}
          />
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
