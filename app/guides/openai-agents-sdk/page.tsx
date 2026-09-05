import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight, Zap } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'OpenAI Agents SDK Integration Guide - DashClaw',
  description: 'Add governance to OpenAI Agents SDK with DashClaw in under 20 minutes.',
  path: '/guides/openai-agents-sdk',
});

export default async function OpenAIAgentsSdkGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const governanceLoopSnippet = `import 'dotenv/config';
import { DashClaw } from 'dashclaw';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-openai-agent',
});

const result = await claw.runGoverned(
  { kind: 'file', file: { path: 'report.csv' } },
  {
    action_type: 'data_export',
    declared_goal: 'Export customer report to CSV',
    risk_score: 45,
    systems_touched: ['customer_database'],
  },
  async () => 'Exported 150 customer records to report.csv',
);

console.log(result);`;

  const guardrailsYaml = `version: 1
project: my-openai-agent
description: >
  Governance policy for an OpenAI Agents SDK data agent.
  High-risk deletions require approval. Reads are auto-allowed.

policies:
  - id: approve_deletions
    description: Require human approval for any delete operation
    applies_to:
      tools:
        - delete_records
        - drop_table
    rule:
      require: approval

  - id: auto_allow_reads
    description: Read operations are low risk
    applies_to:
      tools:
        - scan_for_pii
        - list_records
    rule:
      allow: true`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Install the DashClaw SDK',
      summary: 'Add the DashClaw Node.js SDK to your agent project.',
      codeTitle: 'Terminal',
      codeBody: 'npm install dashclaw dotenv',
    },
    {
      number: 3,
      title: 'Set environment variables',
      summary: 'Create a .env file in your agent project root.',
      codeTitle: '.env',
      codeBody: `DASHCLAW_BASE_URL=${baseUrl}
DASHCLAW_API_KEY=oc_live_...`,
    },
    {
      number: 4,
      title: 'Put the export callback behind runGoverned',
      summary:
        "Pass the exact export act and callback to runGoverned. It binds current policy, one persisted action, approval, one execution claim, and outcome reporting.",
      codeTitle: 'governed-agent.js',
      codeBody: governanceLoopSnippet,
      note: 'The repository OpenAI Agents example uses an older cooperative guard-and-record loop around simulated data. Use this runGoverned pattern when the callback can cause a real effect.',
    },
    {
      number: 5,
      title: 'Run the governed agent',
      summary: 'Execute your agent and watch the governance flow.',
      codeTitle: 'Terminal',
      codeBody: 'node --env-file=.env governed-agent.js',
    },
    {
      number: 6,
      title: 'See the result in DashClaw',
      summary: 'Open your DashClaw dashboard to confirm the action was recorded.',
      note: "Go to /decisions: you should see your action in the ledger with action_type 'data_export', status 'completed', and the output summary you provided.",
    },
  ];

  const proofMoment =
    "Go to /decisions: you should see your action in the ledger with action_type 'data_export', agent_id 'my-openai-agent', and status 'completed'.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'OpenAI Agents SDK Integration Guide - DashClaw',
          description: 'Add governance to OpenAI Agents SDK with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/openai-agents-sdk',
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
            <span className="text-secondary">OpenAI Agents SDK</span>
          </div>

          <GuideClient
            frameworkName="OpenAI Agents SDK"
            frameworkIcon={<Zap size={28} />}
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
