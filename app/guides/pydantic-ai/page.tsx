import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight, Hexagon } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'Pydantic AI Integration Guide - DashClaw',
  description: 'Add governance to Pydantic AI agents with DashClaw in under 20 minutes.',
  path: '/guides/pydantic-ai',
});

export default async function PydanticAiGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const guardrailsYaml = `version: 1
project: my-pydantic-ai-agent
description: >
  Governance policy for a Pydantic AI database agent.
  Production migrations require approval.
  Staging migrations are auto-allowed.

policies:
  - id: approve_production_migrations
    description: Production database migrations require human approval
    applies_to:
      action_types:
        - database_migration
      systems:
        - postgres
    rule:
      require: approval

  - id: allow_staging
    description: Staging migrations are low risk
    applies_to:
      action_types:
        - database_migration
    rule:
      allow: true`;

  const governedToolCode = `import os
from dotenv import load_dotenv
from dashclaw import DashClaw

load_dotenv()

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="pydantic-ai-db-agent",
)


def governed_run_migration(migration_name: str, production: bool) -> str:
    """Run a database migration. Governed by DashClaw policies."""
    risk = 75 if production else 25
    goal = f"Run migration {migration_name} on {'production' if production else 'staging'}"

    # 1. GUARD: Check policy before executing
    result = claw.guard({
        "action_type": "database_migration",
        "declared_goal": goal,
        "risk_score": risk,
        "systems_touched": ["postgres"],
        "reversible": not production,
    })
    decision = result.get("decision", "allow")
    if decision == "block":
        return f"BLOCKED: {', '.join(result.get('reasons', []))}"

    # 2. RECORD: Declare intent
    action = claw.create_action(
        "database_migration", goal,
        risk_score=risk, systems_touched=["postgres"],
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
        f"Migration {migration_name} is idempotent",
        basis="Migration uses IF NOT EXISTS guards throughout",
    )
    migration_result = f"Migration {migration_name} applied successfully."
    claw.update_outcome(action_id, status="completed", output_summary=migration_result)
    return migration_result`;

  const registerToolCode = `# Register the governed function as a Pydantic AI tool — the governance
# loop runs identically when the model invokes it.
from pydantic_ai import Agent

agent = Agent(
    'anthropic:claude-sonnet-4-6',
    tools=[governed_run_migration],
    instructions='You manage database migrations. Use the tool to run them.',
)

result = agent.run_sync('Apply the add-indexes migration to staging')
print(result.output)

# For tests: override the model with TestModel — it exercises the full
# agent loop, tools included, without an LLM API key.
#
#   from pydantic_ai.models.test import TestModel
#   with agent.override(model=TestModel()):
#       agent.run_sync('Apply the add-indexes migration to staging')`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Install the DashClaw Python SDK and Pydantic AI',
      summary: 'Create a virtual environment and install the required packages.',
      codeTitle: 'Terminal',
      codeBody: `python -m venv venv
source venv/bin/activate  # On Windows: venv\\Scripts\\activate
pip install dashclaw pydantic-ai python-dotenv`,
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
      title: 'Register the governed tool on your Pydantic AI agent',
      summary:
        'Pass the governed function in the tools list: Pydantic AI builds the tool schema from the signature and docstring; the governance loop runs on every model-initiated call.',
      codeTitle: 'agent.py',
      codeBody: registerToolCode,
    },
    {
      number: 6,
      title: 'Run the governed example',
      summary:
        'Execute the example and watch the governance flow: a staging migration (allowed) and a production migration (may require approval).',
      codeTitle: 'Terminal',
      codeBody: 'python main.py',
      note: 'No LLM API key needed: the example runs the governance flow directly. Only the DashClaw SDK calls are real.',
    },
    {
      number: 7,
      title: 'Clone the full example',
      summary: 'The complete runnable example is in the DashClaw repo.',
      codeTitle: 'Terminal',
      codeBody: `git clone https://github.com/ucsandman/DashClaw.git
cd DashClaw/examples/pydantic-ai-governed
pip install -r requirements.txt
python main.py`,
    },
  ];

  const proofMoment =
    "Go to /decisions: you should see two actions in the ledger with action_type 'database_migration', agent_id 'pydantic-ai-db-agent': the staging migration completed, and the production migration either completed (after approval) or pending.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'Pydantic AI Integration Guide - DashClaw',
          description: 'Add governance to Pydantic AI agents with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/pydantic-ai',
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
            <span className="text-secondary">Pydantic AI</span>
          </div>

          <GuideClient
            frameworkName="Pydantic AI"
            frameworkIcon={<Hexagon size={28} />}
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
