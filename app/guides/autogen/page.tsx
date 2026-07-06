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
  title: 'AutoGen Integration Guide - DashClaw',
  description: 'Add governance to AutoGen agents with DashClaw in under 20 minutes.',
  path: '/guides/autogen',
});

export default async function AutoGenGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const guardrailsYaml = `version: 1
project: my-autogen-agent
description: >
  Governance policy for an AutoGen deploy agent.
  Production deploys require approval.
  Staging deploys are auto-allowed.

policies:
  - id: approve_production_deploys
    description: Production deploys require human approval
    applies_to:
      action_types:
        - deploy
      systems:
        - production
    rule:
      require: approval

  - id: allow_staging
    description: Staging deploys are low risk
    applies_to:
      systems:
        - staging
    rule:
      allow: true`;

  const governedToolCode = `import os
from dotenv import load_dotenv
from dashclaw import DashClaw

load_dotenv()

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="autogen-deploy-agent",
)


def governed_deploy_tool(environment: str) -> str:
    """Deploy to an environment. Governed by DashClaw policies."""

    # 1. GUARD: Check policy before executing
    result = claw.guard({
        "action_type": "deploy",
        "declared_goal": f"Deploy to {environment}",
        "risk_score": 70 if environment == "production" else 30,
        "systems_touched": [environment],
        "reversible": environment != "production",
    })
    decision = result.get("decision", "allow")
    if decision == "block":
        return f"BLOCKED: {', '.join(result.get('reasons', []))}"

    # 2. RECORD: Declare intent
    action = claw.create_action(
        "deploy",
        f"Deploy to {environment}",
        risk_score=70 if environment == "production" else 30,
        systems_touched=[environment],
    )
    action_id = action["action_id"]

    # 3. HITL: Wait for approval if required
    if decision == "require_approval":
        try:
            claw.wait_for_approval(action_id, timeout=120, interval=5)
        except Exception as e:
            claw.update_outcome(action_id, status="cancelled", error_message=str(e))
            return f"DENIED: {e}"

    # 4. ASSUMPTION + EXECUTE + OUTCOME
    claw.register_assumption(
        action_id,
        f"Tests pass on {environment}",
        basis="CI pipeline green for current branch",
    )
    deploy_result = f"Successfully deployed to {environment}."
    claw.update_outcome(action_id, status="completed", output_summary=deploy_result)
    return deploy_result`;

  const registerToolCode = `# Register the governed function as an AutoGen tool — the governance
# loop runs identically when the model invokes it.
from autogen_agentchat.agents import AssistantAgent
from autogen_ext.models.openai import OpenAIChatCompletionClient

agent = AssistantAgent(
    name="deploy_agent",
    model_client=OpenAIChatCompletionClient(model="gpt-5.2"),
    tools=[governed_deploy_tool],
    system_message="You manage deployments. Use the deploy tool.",
)`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Install the DashClaw Python SDK and AutoGen',
      summary: 'Create a virtual environment and install the required packages.',
      codeTitle: 'Terminal',
      codeBody: `python -m venv venv
source venv/bin/activate  # On Windows: venv\\Scripts\\activate
pip install dashclaw "autogen-agentchat>=0.4.0" python-dotenv`,
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
      title: 'Wrap your tool in the 4-step governance loop',
      summary:
        'The tool checks DashClaw guard before executing, records the action, waits for approval when required, and reports the outcome.',
      codeTitle: 'main.py',
      codeBody: governedToolCode,
      note: "The guard decision drives the flow: 'block' returns early, 'require_approval' pauses for a human click on /approvals, 'allow' proceeds straight to execution.",
    },
    {
      number: 5,
      title: 'Register the governed tool on your AutoGen agent',
      summary:
        'Pass the governed function in the tools list — AutoGen inspects the signature and docstring; the governance loop runs on every model-initiated call.',
      codeTitle: 'agent.py',
      codeBody: registerToolCode,
    },
    {
      number: 6,
      title: 'Run the governed example',
      summary: 'Execute the example and watch the governance flow: a staging deploy (allowed) and a production deploy (may require approval).',
      codeTitle: 'Terminal',
      codeBody: 'python main.py',
      note: 'No OPENAI_API_KEY needed — the example runs the governance flow directly. Only the DashClaw SDK calls are real.',
    },
    {
      number: 7,
      title: 'Clone the full example',
      summary: 'The complete runnable example is in the DashClaw repo.',
      codeTitle: 'Terminal',
      codeBody: `git clone https://github.com/ucsandman/DashClaw.git
cd DashClaw/examples/autogen-governed
pip install -r requirements.txt
python main.py`,
    },
  ];

  const proofMoment =
    "Go to /decisions — you should see two actions in the ledger with action_type 'deploy', agent_id 'autogen-deploy-agent': the staging deploy completed, and the production deploy either completed (after approval) or pending.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'AutoGen Integration Guide - DashClaw',
          description: 'Add governance to AutoGen agents with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/autogen',
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
            <span className="text-secondary">AutoGen</span>
          </div>

          <GuideClient
            frameworkName="AutoGen"
            frameworkIcon="🤖"
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
