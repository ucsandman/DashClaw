import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Vercel AI SDK Integration Guide - DashClaw',
  description: 'Add governance to Vercel AI SDK tool calls with DashClaw in under 20 minutes.',
  path: '/guides/vercel-ai-sdk',
});

export default async function VercelAiSdkGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const guardrailsYaml = `version: 1
project: my-ai-sdk-agent
description: >
  Governance policy for an AI SDK support agent.
  Financial actions require approval.
  Read-only lookups are auto-allowed.

policies:
  - id: approve_financial_actions
    description: Refunds and charges require human approval
    applies_to:
      action_types:
        - financial
      systems:
        - stripe
    rule:
      require: approval

  - id: allow_reads
    description: Read-only lookups are low risk
    applies_to:
      action_types:
        - read
    rule:
      allow: true`;

  const governedWrapperCode = `import { tool } from 'ai';
import { z } from 'zod';
import { DashClaw } from 'dashclaw';

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'vercel-ai-support-agent',
});

// Wrap any AI SDK execute function in the DashClaw governance loop.
function governed({ actionType, riskScore, systemsTouched, goal, act }, execute) {
  return async (input) => {
    const declaredGoal = typeof goal === 'function' ? goal(input) : goal;
    return claw.runGoverned(
      act(input),
      {
        action_type: actionType,
        declared_goal: declaredGoal,
        risk_score: riskScore,
        systems_touched: systemsTouched,
      },
      () => execute(input),
    );
  };
}`;

  const toolsCode = `const refundOrder = tool({
  description: 'Issue a refund for a customer order',
  inputSchema: z.object({
    orderId: z.string().describe('The order to refund'),
    amountUsd: z.number().describe('Refund amount in USD'),
  }),
  execute: governed(
    {
      actionType: 'financial',
      riskScore: 70,
      systemsTouched: ['stripe'],
      goal: ({ orderId, amountUsd }) => \`Refund $\${amountUsd} for order \${orderId}\`,
      act: ({ orderId, amountUsd }) => ({
        kind: 'http',
        request: {
          method: 'POST',
          url: \`https://payments.example.test/orders/\${orderId}/refund\`,
          body_excerpt: JSON.stringify({ amountUsd }),
        },
      }),
    },
    async ({ orderId, amountUsd }) => \`Refunded $\${amountUsd} for order \${orderId}.\`,
  ),
});

// Hand the tools to generateText / streamText — every tool call the model
// makes runs through the governance wrapper first.
import { generateText, isStepCount } from 'ai';

const { text } = await generateText({
  model: 'anthropic/claude-sonnet-4-6',
  tools: { refundOrder, lookupOrder },
  stopWhen: isStepCount(5),
  prompt: 'Customer 8841 wants a refund on order ord_1289 for $129.',
});`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Install the DashClaw Node SDK and the AI SDK',
      summary: 'Add the packages to your project.',
      codeTitle: 'Terminal',
      codeBody: 'npm install dashclaw ai zod dotenv',
    },
    {
      number: 3,
      title: 'Set environment variables',
      summary:
        'Create a .env file with your DashClaw connection details. No LLM API key required for the example.',
      codeTitle: '.env',
      codeBody: `DASHCLAW_BASE_URL=${baseUrl}
DASHCLAW_API_KEY=oc_live_...`,
    },
    {
      number: 4,
      title: 'Write a governed() wrapper for tool execute functions',
      summary:
        'One wrapper passes the exact tool act and callback to runGoverned, which handles current policy, recording, approval, one execution claim, and outcome reporting.',
      codeTitle: 'governance.mjs',
      codeBody: governedWrapperCode,
      note: 'The callback runs only after DashClaw confirms protocol-1 execution authority for the exact action, agent, and scrubbed act.',
    },
    {
      number: 5,
      title: 'Define tools with governed execute functions',
      summary:
        'Wrap each tool at definition time, then hand the tools to generateText or streamText as usual: governance rides every model-initiated call.',
      codeTitle: 'agent.mjs',
      codeBody: toolsCode,
    },
    {
      number: 6,
      title: 'Run the governed example',
      summary:
        'Execute the example and watch the governance flow: a low-risk lookup (allowed) and a high-risk refund (may require approval).',
      codeTitle: 'Terminal',
      codeBody: 'npm start',
      note: 'No LLM API key needed: the example invokes the governed tools directly, exactly the way the model-driven tool-call step would. Only the DashClaw SDK calls are real.',
    },
    {
      number: 7,
      title: 'Clone the full example',
      summary: 'The complete runnable example is in the DashClaw repo.',
      codeTitle: 'Terminal',
      codeBody: `git clone https://github.com/ucsandman/DashClaw.git
cd DashClaw/examples/vercel-ai-governed
npm install
npm start`,
    },
  ];

  const proofMoment =
    "Go to /decisions: you should see two actions in the ledger for agent_id 'vercel-ai-support-agent': the read lookup completed, and the financial refund either completed (after approval) or pending.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'Vercel AI SDK Integration Guide - DashClaw',
          description: 'Add governance to Vercel AI SDK tool calls with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/vercel-ai-sdk',
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
            <span className="text-secondary">Vercel AI SDK</span>
          </div>

          <GuideClient
            frameworkName="Vercel AI SDK"
            frameworkIcon="▲"
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
