import Anthropic from '@anthropic-ai/sdk';
import { DashClaw, ApprovalDeniedError, GuardBlockedError } from 'dashclaw';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import path from 'path';

dotenv.config();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

async function main() {
  const baseUrl = process.env.DASHCLAW_BASE_URL || 'http://localhost:3000';
  const apiKey = process.env.DASHCLAW_API_KEY;
  if (!apiKey || apiKey === 'your_dashclaw_api_key') {
    console.error('Missing DASHCLAW_API_KEY in .env');
    process.exit(0);
  }

  // --- Setup ---
  const claw = new DashClaw({
    baseUrl,
    apiKey,
    agentId: 'claude-reviewer',
  });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const simulateAI = !anthropicKey || anthropicKey === 'your_anthropic_api_key';
  const anthropic = simulateAI ? null : new Anthropic({ apiKey: anthropicKey });

  const targetFile = 'examples/claude-code-review-agent/sample-auth.js';
  console.log(`\n🤖 Claude Code Review Agent\n   Reviewing: ${targetFile}\n`);

  let actionId = null;

  try {
    // --- Step 1: Guard check before reading ---
    console.log('[1/6] Guard check: read access...');
    const readDecision = await claw.guard({
      action_type: 'review',
      declared_goal: `Review ${targetFile} for security issues`,
      risk_score: 30,
    });

    if (readDecision.decision === 'block') {
      console.log(`      Blocked: ${readDecision.reasons?.[0] || 'policy violation'}`);
      process.exit(0);
    }
    console.log('      Guard: Read access permitted');

    // --- Step 2: Read the file ---
    const filePath = path.resolve(targetFile);
    const fileContent = await readFile(filePath, 'utf-8');
    console.log(`[2/6] File loaded (${fileContent.length} chars)`);

    // --- Step 3: AI review ---
    let reviewResult;
    if (simulateAI) {
      reviewResult =
        'FINDING: Line 8 — hardcoded secret detected. The variable API_SECRET is assigned a ' +
        'literal string value. This should be loaded from environment variables instead.\n' +
        "SUGGESTED FIX: Replace `const API_SECRET = 'sk-hardcoded-secret-123'` with " +
        '`const API_SECRET = process.env.API_SECRET`';
    } else {
      const msg = await anthropic.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        system: 'You are a security-focused code reviewer. Be concise. Identify the most critical issue and suggest a fix.',
        messages: [
          { role: 'user', content: `Review this code for security issues:\n\n${fileContent}` },
        ],
      });
      reviewResult = msg.content[0].text;
    }
    console.log('[3/6] Review complete');
    console.log(`      ${reviewResult.slice(0, 200)}`);

    // --- Step 4: Guard check before writing ---
    console.log('\n[4/6] Guard check: write access...');
    const writeDecision = await claw.guard({
      action_type: 'security',
      declared_goal: `Apply security fix to ${targetFile}`,
      risk_score: 75,
      reversible: true,
      systems_touched: ['filesystem'],
    });

    // --- Step 5: Create action record ---
    const result = await claw.createAction({
      action_type: 'security',
      declared_goal: `Apply security fix to ${targetFile}`,
      reasoning: reviewResult.slice(0, 300),
      risk_score: 75,
      reversible: true,
      systems_touched: ['filesystem'],
    });
    actionId = result.action?.action_id || result.action_id;
    console.log(`[5/6] Action recorded: ${actionId}`);
    console.log(`      Replay: ${baseUrl}/replay/${actionId}`);

    // --- Step 6: Handle the guard decision ---
    const decision = writeDecision.decision;

    if (decision === 'block') {
      console.log(`\n      Blocked by policy: ${writeDecision.reasons?.[0] || 'policy violation'}`);
      console.log('      The code review was recorded but the fix was not applied.');
      console.log(`      View decision: ${baseUrl}/replay/${actionId}`);
      await claw.updateOutcome(actionId, {
        status: 'failed',
        output_summary: 'Blocked by guard policy',
      });
      process.exit(0);
    }

    if (decision === 'require_approval') {
      console.log('');
      console.log('+== DashClaw Approval Required =====================+');
      console.log(`  Action ID:   ${actionId}`);
      console.log('  Agent:       claude-reviewer');
      console.log('  Action:      security (file write)');
      console.log(`  File:        ${targetFile}`);
      console.log('  Risk Score:  75');
      console.log('');
      console.log(`  Replay:      ${baseUrl}/replay/${actionId}`);
      console.log('');
      console.log(`  Approve:     dashclaw approve ${actionId}`);
      console.log(`  Deny:        dashclaw deny ${actionId}`);
      console.log('');
      console.log('  Waiting for approval... (60s timeout)');
      console.log('+===================================================+');

      try {
        await claw.waitForApproval(actionId, { timeout: 60000, interval: 3000 });
        console.log('\n      Approved by operator. Proceeding...');
      } catch (err) {
        if (err.name === 'ApprovalDeniedError') {
          console.log('\n      Denied by operator. Fix not applied.');
          await claw.updateOutcome(actionId, {
            status: 'failed',
            output_summary: 'Denied by operator',
          });
          process.exit(0);
        }
        throw err;
      }
    }

    // --- Apply fix (simulated) ---
    console.log(`\n[6/6] [Simulated] Would write fix to ${targetFile}`);
    await claw.updateOutcome(actionId, {
      status: 'completed',
      output_summary: 'Security fix applied successfully',
    });
    console.log(`      Fix applied. Full audit trail at: ${baseUrl}/replay/${actionId}\n`);
  } catch (error) {
    if (error.name === 'GuardBlockedError') {
      console.error(`\n      BLOCKED BY POLICY: ${error.message}`);
    } else if (error.name === 'ApprovalDeniedError') {
      console.error(`\n      DENIED BY OPERATOR: ${error.message}`);
    } else {
      console.error(`\n      Error: ${error.message}`);
    }
    if (actionId) {
      try {
        await claw.updateOutcome(actionId, {
          status: 'failed',
          output_summary: `Error: ${error.message}`,
        });
      } catch { /* best effort */ }
    }
  }
}

main();
