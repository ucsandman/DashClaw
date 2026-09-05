/**
 * Vercel AI SDK + DashClaw Governance Example
 *
 * Wraps an AI SDK tool's execute function in DashClaw's persisted-action loop.
 *
 * Handles require_approval (HITL) and block decisions.
 * No LLM API key required — the demo invokes the governed tool directly,
 * exactly the way generateText's tool-call step would. The commented
 * generateText block at the bottom shows the production wiring.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { DashClaw } from 'dashclaw';
import dotenv from 'dotenv';
dotenv.config();

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL || 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'vercel-ai-support-agent',
});

// Each demo run is a distinct logical action. The SDK derives an idempotency
// key from (agent, type, goal, session) to deduplicate the action record.
// A per-run session keeps separate demo runs distinct; record deduplication
// alone is not an exactly-once guarantee for external effects.
const RUN_ID = `demo-${Date.now()}`;

/**
 * Wrap any AI SDK execute function in the DashClaw governance loop.
 * The wrapper is generic: pass the action metadata once, reuse it for
 * every tool you define.
 */
function governed({ actionType, riskScore, systemsTouched, goal, act }, execute) {
  return async (input) => {
    const declaredGoal = typeof goal === 'function' ? goal(input) : goal;
    const exactAct = typeof act === 'function' ? act(input) : act;
    return claw.runGoverned(
      exactAct,
      {
        action_type: actionType,
        declared_goal: declaredGoal,
        risk_score: riskScore,
        systems_touched: systemsTouched,
        session_id: RUN_ID,
      },
      () => execute(input),
    );
  };
}

// ── AI SDK tools with governed execute functions ────────────────────────────

const refundOrder = tool({
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
      goal: ({ orderId, amountUsd }) => `Refund $${amountUsd} for order ${orderId}`,
      act: ({ orderId, amountUsd }) => ({
        kind: 'http',
        request: {
          method: 'POST',
          url: 'https://api.stripe.test/v1/refunds',
          body_excerpt: JSON.stringify({ orderId, amountUsd }),
        },
      }),
    },
    async ({ orderId, amountUsd }) =>
      `Refunded $${amountUsd} for order ${orderId}.`, // simulated — no real charge
  ),
});

const lookupOrder = tool({
  description: 'Look up an order by id',
  inputSchema: z.object({
    orderId: z.string(),
  }),
  execute: governed(
    {
      actionType: 'read',
      riskScore: 10,
      systemsTouched: ['orders_db'],
      goal: ({ orderId }) => `Look up order ${orderId}`,
      act: ({ orderId }) => ({
        kind: 'http',
        request: {
          method: 'GET',
          url: `https://orders.example.test/orders/${encodeURIComponent(orderId)}`,
        },
      }),
    },
    async ({ orderId }) => ({ orderId, status: 'shipped', totalUsd: 129.0 }), // simulated
  ),
});

// ── Production wiring: hand the tools to generateText / streamText ──────────
//
//   import { generateText, isStepCount } from 'ai';
//   const { text } = await generateText({
//     model: 'anthropic/claude-sonnet-4-6',
//     tools: { refundOrder, lookupOrder },
//     stopWhen: isStepCount(5),
//     prompt: 'Customer 8841 wants a refund on order ord_1289 for $129.',
//   });
//
// Every tool call the model makes runs through the governance wrapper first.

async function main() {
  console.log('=== Vercel AI SDK + DashClaw Governance Example ===\n');

  console.log('--- Look up order (low risk) ---');
  const order = await lookupOrder.execute({ orderId: 'ord_1289' });
  console.log('Result:', order, '\n');

  console.log('--- Refund order (high risk, may require approval) ---');
  const refund = await refundOrder.execute({ orderId: 'ord_1289', amountUsd: 129 });
  console.log('Result:', refund, '\n');

  const base = process.env.DASHCLAW_BASE_URL || 'http://localhost:3000';
  console.log(`View governed decisions: ${base}/decisions`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
