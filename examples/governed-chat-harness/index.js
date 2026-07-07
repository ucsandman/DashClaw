import 'dotenv/config';
import readline from 'node:readline';
import Anthropic from '@anthropic-ai/sdk';
import { DashClaw } from 'dashclaw';
import { tools } from './tools.js';
import { GovernedAgent } from './harness.js';

const BASE_URL = process.env.DASHCLAW_BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.DASHCLAW_API_KEY;
const AGENT_ID = process.env.DASHCLAW_AGENT_ID || 'claude-chat-harness';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const GUARD_UNAVAILABLE = process.env.DASHCLAW_GUARD_UNAVAILABLE_POLICY || 'warn';

if (!API_KEY) {
  console.error('Missing DASHCLAW_API_KEY. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY.');
  process.exit(1);
}

const claw = new DashClaw({
  baseUrl: BASE_URL,
  apiKey: API_KEY,
  agentId: AGENT_ID,
  agentName: 'Claude Chat Harness',
});
const anthropic = new Anthropic();

const agent = new GovernedAgent({
  claw,
  anthropic,
  model: MODEL,
  system: 'You are a helpful assistant. Use the available tools when they help, and explain what you are doing.',
  tools,
  guardUnavailablePolicy: GUARD_UNAVAILABLE,
});

const messages = [];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\nGoverned chat harness. Every tool call is recorded to DashClaw.');
console.log(`Agent: ${AGENT_ID}   Model: ${MODEL}`);
console.log(`Ledger: ${BASE_URL}/decisions`);
console.log('Type your message, or "exit" to quit.\n');

function ask() {
  rl.question('you > ', async (line) => {
    const text = (line || '').trim();
    if (text === 'exit' || text === 'quit') return rl.close();
    if (!text) return ask();

    messages.push({ role: 'user', content: text });
    try {
      const { text: reply, actionIds } = await agent.run(messages);
      console.log(`\nclaude > ${reply.trim()}\n`);
      if (actionIds.length) {
        const latest = actionIds[actionIds.length - 1];
        console.log(`[DashClaw] recorded ${actionIds.length} action(s) this session. Latest: ${BASE_URL}/decisions/${latest}\n`);
      }
    } catch (err) {
      console.error(`Error: ${err.message || err}\n`);
    }
    ask();
  });
}

ask();

rl.on('close', () => {
  console.log('\nDone. Open your Decisions Ledger to see this session.');
  process.exit(0);
});
