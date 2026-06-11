import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { DashClaw, ApprovalDeniedError } from 'dashclaw';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// -- DashClaw Setup -----------------------------------------------------------
const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL || 'http://localhost:3000',
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'deploy-agent',
});

const anthropic = new Anthropic();

// -- Simulated Infrastructure -------------------------------------------------
const SERVICES = {
  'api-gateway':     { status: 'healthy',  version: '2.0.9', cpu: 45, memory: 62 },
  'auth-service':    { status: 'healthy',  version: '1.4.2', cpu: 30, memory: 48 },
  'user-service':    { status: 'degraded', version: '3.1.0', cpu: 88, memory: 91 },
  'payment-service': { status: 'healthy',  version: '2.2.1', cpu: 22, memory: 35 },
};

const DEPLOYMENT_MANIFEST = {
  build: 'v2.1.0-rc3',
  target: 'production',
  services: ['api-gateway', 'auth-service', 'user-service'],
  changelog: [
    'feat: add rate limiting to API gateway',
    'fix: auth token refresh race condition',
    'perf: optimize user query N+1',
  ],
  ci_status: 'passed',
  test_coverage: '94.2%',
};

// -- Tools --------------------------------------------------------------------
const tools = [
  {
    name: 'check_deployment_manifest',
    description: 'Read the current deployment manifest to understand what will be deployed, including build version, target environment, affected services, and CI status.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'check_service_health',
    description: 'Check the current health status of a specific service, including CPU, memory, and version.',
    input_schema: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'Name of the service to check (api-gateway, auth-service, user-service, payment-service)' },
      },
      required: ['service_name'],
    },
  },
  {
    name: 'deploy_to_production',
    description: 'Execute the deployment to production. This is a critical, irreversible action that pushes the build to live servers.',
    input_schema: {
      type: 'object',
      properties: {
        build: { type: 'string', description: 'Build version to deploy' },
        services: { type: 'array', items: { type: 'string' }, description: 'Services to deploy' },
        justification: { type: 'string', description: 'Why this deployment should proceed' },
      },
      required: ['build', 'services', 'justification'],
    },
  },
];

function executeTool(name, input) {
  switch (name) {
    case 'check_deployment_manifest':
      return JSON.stringify(DEPLOYMENT_MANIFEST, null, 2);
    case 'check_service_health': {
      const svc = SERVICES[input.service_name];
      if (!svc) return JSON.stringify({ error: `Unknown service: ${input.service_name}` });
      return JSON.stringify({ service: input.service_name, ...svc });
    }
    case 'deploy_to_production':
      return JSON.stringify({
        status: 'deployed',
        build: input.build,
        services: input.services,
        timestamp: new Date().toISOString(),
      });
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// -- Agentic Loop with DashClaw Governance ------------------------------------

async function main() {
  console.log('\n=== Deployment Agent ===\n');

  const messages = [
    {
      role: 'user',
      content: 'Check the deployment manifest and service health for all affected services, then deploy build v2.1.0-rc3 to production if everything looks good. Explain your reasoning at each step.',
    },
  ];

  let actionId = null;

  // Manual agentic loop so we can intercept deploy_to_production for governance
  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are a deployment operations agent. You analyze infrastructure health and execute deployments.
Always check the manifest first, then check the health of ALL affected services before deploying.
If any service is degraded, note it but proceed if the deployment includes fixes for that service.
Explain your reasoning clearly at each step.`,
      tools,
      messages,
    });

    // Append assistant response to conversation
    messages.push({ role: 'assistant', content: response.content });

    // Print text blocks
    for (const block of response.content) {
      if (block.type === 'text') {
        console.log(block.text + '\n');
      }
    }

    // If no tool use, agent is done
    if (response.stop_reason !== 'tool_use') break;

    // Process tool calls
    const toolResults = [];

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      console.log(`[Tool] ${block.name}(${JSON.stringify(block.input)})`);

      // ---- DashClaw Governance Gate for deploy_to_production ----
      if (block.name === 'deploy_to_production') {
        console.log('\n--- DashClaw Governance ---\n');

        try {
          // 1. GUARD
          console.log('Checking deployment policy...');
          const decision = await claw.guard({
            action_type: 'deploy',
            declared_goal: `Deploy ${block.input.build} to production (${block.input.services.join(', ')})`,
            risk_score: 90,
            systems_touched: block.input.services,
            metadata: { justification: block.input.justification },
          });

          console.log(`Decision: ${(decision.decision || 'unknown').toUpperCase()}`);

          if (decision.decision === 'block') {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: `BLOCKED BY POLICY: ${decision.reason}` }),
            });
            continue;
          }

          // 2. ACTION
          const actionResult = await claw.createAction({
            action_type: 'deploy',
            declared_goal: `Deploy ${block.input.build} to production`,
            reasoning: block.input.justification,
            risk_score: 90,
          });
          actionId = actionResult.action?.action_id || actionResult.action_id;
          console.log(`Action recorded: ${actionId}`);

          // 3. ASSUMPTION
          await claw.recordAssumption({
            action_id: actionId,
            assumption: 'All CI checks have passed and affected services are ready for deployment',
            basis: `Manifest shows ci_status: passed, ${DEPLOYMENT_MANIFEST.test_coverage} test coverage`,
          });

          // 4. HITL
          if (decision.decision === 'require_approval') {
            console.log('\nWAITING FOR HUMAN APPROVAL...');
            console.log(`  Approve at: ${process.env.DASHCLAW_BASE_URL || 'http://localhost:3000'}/approvals`);
            console.log('  (The agent is paused until an operator approves or denies)\n');
            await claw.waitForApproval(actionId);
            console.log('Approved by operator!\n');
          }

          // 5. EXECUTE
          console.log('Deploying...');
          const toolOutput = executeTool(block.name, block.input);
          console.log(`  ${toolOutput}\n`);

          // 6. OUTCOME
          await claw.updateOutcome(actionId, {
            status: 'completed',
            output_summary: `Deployed ${block.input.build} to ${block.input.services.join(', ')}`,
          });

          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: toolOutput });

        } catch (error) {
          if (error.name === 'ApprovalDeniedError') {
            console.error(`\nDENIED BY OPERATOR: ${error.message}\n`);
            if (actionId) {
              await claw.updateOutcome(actionId, { status: 'failed', output_summary: `Denied: ${error.message}` });
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: `DENIED BY OPERATOR: ${error.message}` }),
            });
          } else {
            throw error;
          }
        }
      } else {
        // Non-governed tools run directly
        const toolOutput = executeTool(block.name, block.input);
        console.log(`  -> ${toolOutput}\n`);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: toolOutput });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  console.log('\nDeployment agent complete.');
  if (actionId) {
    console.log(`  View trace: ${process.env.DASHCLAW_BASE_URL || 'http://localhost:3000'}/decisions/${actionId}\n`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  console.log('\nTip: Make sure DashClaw is running at http://localhost:3000');
  console.log('Run with: DASHCLAW_BASE_URL=http://localhost:3000 node index.js');
});
