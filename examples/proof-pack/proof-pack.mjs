import {
  ApprovalDeniedError,
  DashClaw,
  GuardBlockedError,
} from 'dashclaw';

const baseUrl = process.env.DASHCLAW_BASE_URL || 'http://localhost:3000';
const agentId = 'proof-pack-demo';
const declaredGoal = 'Send a governed proof-of-connection action';

if (!process.env.DASHCLAW_API_KEY) {
  throw new Error('Set DASHCLAW_API_KEY before running this example.');
}

const claw = new DashClaw({
  baseUrl,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId,
  agentName: 'Proof Pack demo',
});

async function main() {
  // 1. Ask whether this action is allowed. This is advisory on the SDK path,
  // so honor a block before attempting the action.
  const decision = await claw.guard({
    action_type: 'api_call',
    declared_goal: declaredGoal,
    risk_score: 20,
  });
  if (decision.decision === 'block') throw new GuardBlockedError(decision);

  // 2. Create the durable action record. This is the row shown in DashClaw.
  const { action, action_id } = await claw.createAction({
    action_type: 'api_call',
    declared_goal: declaredGoal,
    risk_score: 20,
  });
  const dashboardUrl = new URL(`/decisions/${action_id}`, baseUrl).toString();
  console.log(`Action recorded: ${dashboardUrl}`);

  // 3. The server decides whether an operator must approve the real action.
  if (action?.status === 'pending_approval') {
    console.log(`Waiting for approval: ${new URL('/approvals', baseUrl)}`);
    try {
      await claw.waitForApproval(action_id, { timeout: 300_000 });
    } catch (error) {
      if (error instanceof ApprovalDeniedError) {
        console.log(`Approval denied. Review the record: ${dashboardUrl}`);
        return;
      }
      throw error;
    }
  }

  // 4. Do a tiny, deterministic piece of work and close the evidence loop.
  try {
    const proof = { connected: true, completedAt: new Date().toISOString() };
    await claw.recordAssumption({
      action_id,
      assumption: 'The configured API key belongs to the intended DashClaw workspace.',
    });
    await claw.updateOutcome(action_id, {
      status: 'completed',
      output_summary: JSON.stringify(proof),
    });
    console.log(`Proof complete: ${dashboardUrl}`);
  } catch (error) {
    await claw.updateOutcome(action_id, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
