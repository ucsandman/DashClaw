// DashClaw reference work-order worker.
// Claims queued work orders, executes research_brief via Claude (or a
// deterministic mock when no ANTHROPIC_API_KEY is set), reports completion.
import { DashClaw } from 'dashclaw';
import dotenv from 'dotenv';

dotenv.config();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL || 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: process.env.WORKER_AGENT_ID || 'work-order-worker',
});

const POLL_MS = 5000;

async function executeResearchBrief(input) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      output: {
        title: `Research brief: ${input.topic}`,
        summary: `Deterministic mock brief for "${input.topic}" (set ANTHROPIC_API_KEY for a real one).`,
        findings: ['mock finding 1', 'mock finding 2'],
        sources: [],
        confidence: 0.1,
        limitations: ['generated without a live model'],
      },
      cost: { input_tokens: 0, output_tokens: 0, total_usd: 0 },
    };
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic();
  const model = process.env.MODEL || 'claude-sonnet-4-6';
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Write a research brief as pure JSON {"title","summary","findings":[],"sources":[],"confidence":0..1,"limitations":[]} on: ${input.topic}${input.scope ? `\nScope: ${input.scope}` : ''}`,
    }],
  });
  const text = msg.content.find((b) => b.type === 'text')?.text ?? '{}';
  const output = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  // Pricing here is indicative for the example; receipts record what you report.
  const totalUsd = (msg.usage.input_tokens * 3 + msg.usage.output_tokens * 15) / 1e6;
  return { output, cost: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens, total_usd: Number(totalUsd.toFixed(6)) } };
}

const HANDLERS = { research_brief: executeResearchBrief };

async function tick() {
  const { work_order: order } = await claw.claimWorkOrder({ types: Object.keys(HANDLERS) });
  if (!order) return;
  console.log(`claimed ${order.id} (${order.type})`);
  try {
    const { output, cost } = await HANDLERS[order.type](order.input);
    const res = await claw.completeWorkOrder(order.id, { status: 'completed', output, cost });
    console.log(`completed ${order.id} — receipt ${res.receipt.receipt_hash}`);
  } catch (err) {
    console.error(`failed ${order.id}:`, err.message);
    await claw.completeWorkOrder(order.id, { status: 'failed', error: { code: 'worker_error', message: err.message } });
  }
}

console.log(`work-order worker polling ${process.env.DASHCLAW_BASE_URL || 'http://localhost:3000'} every ${POLL_MS}ms (types: ${Object.keys(HANDLERS).join(', ')})`);
setInterval(() => tick().catch((err) => console.error('tick error:', err.message)), POLL_MS);
tick().catch((err) => console.error('tick error:', err.message));
