import {
  ApprovalDeniedError,
  DashClaw,
  ExecutionClaimError,
  GuardBlockedError,
  OutcomeConfirmationError,
} from 'dashclaw';
import dotenv from 'dotenv';
dotenv.config();

/**
 * 🚀 DASHCLAW STARTER: OPENAI GOVERNED DEPLOY AGENT
 *
 * Scenario: A deployment agent wants to push auth-service-v2 to production.
 *
 * This example uses runGoverned so the policy decision, persisted action,
 * approval, execution claim, callback, and outcome share one exact act.
 */

async function main() {
  const apiKey = process.env.DASHCLAW_API_KEY;
  if (!apiKey || apiKey === 'your_dashclaw_api_key') {
    console.error("❌ Missing DASHCLAW_API_KEY in .env");
    return;
  }

  // Initialize DashClaw
  const claw = new DashClaw({
    baseUrl: process.env.DASHCLAW_BASE_URL || 'http://localhost:3000',
    apiKey: apiKey,
    agentId: 'openai-deployer-1',
  });

  // Initialize OpenAI (Optional but shown for "Real Agent" flow)
  // Lazy-loaded so the package only resolves when a real key is present.
  const openaiKey = process.env.OPENAI_API_KEY;
  const hasOpenAI = openaiKey && openaiKey !== 'sk-fake-key';
  let openai = null;
  if (hasOpenAI) {
    const { default: OpenAI } = await import('openai');
    openai = new OpenAI({ apiKey: openaiKey });
  }

  const deployTarget = 'production';
  const serviceName = 'auth-service-v2';
  const goal = `Deploy ${serviceName} to ${deployTarget}`;

  console.log(`\n🤖 Agent Goal: ${goal}`);

  try {
    console.log('Checking policies and persisted action state through DashClaw...');
    await claw.runGoverned(
      {
        kind: 'shell',
        command: `simulate-deploy --service ${serviceName} --target ${deployTarget}`,
      },
      {
        action_type: 'deploy',
        declared_goal: goal,
        risk_score: 85,
        reversible: false,
        systems_touched: ['kubernetes', 'production-api'],
      },
      async () => {
        if (openai) {
          console.log(`\nGenerating a simulated deployment status for ${serviceName}...`);
          const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 100,
            messages: [
              { role: 'system', content: 'Return a short simulated deployment status. Do not perform a deployment.' },
              { role: 'user', content: `Simulate deploying ${serviceName} to ${deployTarget}. Respond in one sentence.` },
            ],
          });
          console.log(`Agent response: ${response.choices[0].message.content}`);
        } else {
          console.log('\nSimulating locally. No deployment or external write occurs.');
          await new Promise(r => setTimeout(r, 1000));
          console.log(`${serviceName} simulation completed.`);
        }
      },
    );

    console.log('\nGoverned simulation completed and its outcome was confirmed by DashClaw.');

  } catch (error) {
    if (error instanceof GuardBlockedError) {
      console.error(`\n❌ BLOCKED BY POLICY: ${error.message}`);
    } else if (error instanceof ApprovalDeniedError) {
      console.error(`\n❌ DENIED BY OPERATOR: ${error.message}`);
    } else if (error instanceof ExecutionClaimError || error instanceof OutcomeConfirmationError) {
      console.error(`\nExecution state is uncertain for ${error.actionId}. Reconcile it in DashClaw before retrying.`);
    } else {
      console.error(`\n❌ Error: ${error.message}`);
    }
  }
}

main();
