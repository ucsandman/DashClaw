/**
 * Vercel AI SDK + DashClaw Governance Example
 *
 * Wraps an AI SDK tool's execute function in the DashClaw 4-step loop:
 * guard → createAction → recordAssumption → updateOutcome.
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
// key from (agent, type, goal, session) so blind retries dedupe — without a
// per-run session id, re-running this script inside an hour would replay the
// previous (already-completed) action instead of creating a new one.
const RUN_ID = `demo-${Date.now()}`;

/**
 * Wrap any AI SDK execute function in the DashClaw governance loop.
 * The wrapper is generic: pass the action metadata once, reuse it for
 * every tool you define.
 */
function governed({ actionType, riskScore, systemsTouched, goal }, execute) {
  return async (input) => {
    const declaredGoal = typeof goal === 'function' ? goal(input) : goal;

    // 1. GUARD: policy check before executing
    const { decision, reasons } = await claw.guard({
      action_type: actionType,
      declared_goal: declaredGoal,
      risk_score: riskScore,
      systems_touched: systemsTouched,
    });
    console.log(`Guard decision: ${decision}`);

    if (decision === 'block') {
      return `BLOCKED: ${(reasons || []).join(', ')}`;
    }

    // 2. RECORD: declare intent
    const { action } = await claw.createAction({
      action_type: actionType,
      declared_goal: declaredGoal,
      risk_score: riskScore,
      systems_touched: systemsTouched,
      session_id: RUN_ID,
    });
    console.log(`Action recorded: ${action.action_id}`);

    // 3. HITL: wait for approval if required
    if (decision === 'require_approval') {
      console.log(`Waiting for human approval of ${action.action_id}...`);
      try {
        await claw.waitForApproval(action.action_id, { timeout: 120000, interval: 5000 });
        console.log('Approved!');
      } catch (err) {
        await claw.updateOutcome(action.action_id, {
          status: 'cancelled',
          error_message: String(err?.message || err),
        });
        return `DENIED: ${err?.message || err}`;
      }
    }

    // 4. EXECUTE + OUTCOME
    try {
      const result = await execute(input);
      await claw.updateOutcome(action.action_id, {
        status: 'completed',
        output_summary: typeof result === 'string' ? result : JSON.stringify(result),
      });
      return result;
    } catch (err) {
      await claw.updateOutcome(action.action_id, {
        status: 'failed',
        error_message: String(err?.message || err),
      });
      throw err;
    }
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
