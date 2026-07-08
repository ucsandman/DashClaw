import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight, Users } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'CrewAI Integration Guide - DashClaw',
  description: 'Add governance to CrewAI agents with DashClaw in under 20 minutes.',
  path: '/guides/crewai',
});

export default async function CrewAIGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const toolCodeBody = `from crewai.tools import tool
from dashclaw import DashClaw
import os

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="crewai-analyst-agent",
)

@tool("Analyze Customer Data")
def analyze_customer_data(query: str) -> str:
    """Analyze customer data. Governed by DashClaw policies."""

    # 1. GUARD: Check policy before executing
    result = claw.guard({
        "action_type": "data_analysis",
        "declared_goal": f"Analyze customer data: {query}",
        "risk_score": 40,
        "systems_touched": ["customer_database"],
    })

    if result.get("decision") == "block":
        reasons = result.get("reasons", [])
        return f"Blocked by governance policy: {', '.join(reasons)}"

    # 2. RECORD: Declare intent
    action = claw.create_action(
        "data_analysis",
        f"Analyze customer data: {query}",
        risk_score=40,
    )
    action_id = action["action_id"]

    # 3. EXECUTE: Your tool logic here
    analysis_result = f"Analysis of '{query}': 42 segments, avg satisfaction 4.2/5."

    # 4. OUTCOME: Report result
    claw.update_outcome(action_id, status="completed", output_summary=analysis_result)

    return analysis_result`;

  const guardrailsYaml = `version: 1
project: my-crewai-agent
description: >
  Governance policy for a CrewAI data analysis crew.
  Customer data analysis requires audit trail.
  External API calls require approval.

policies:
  - id: audit_data_analysis
    description: All data analysis tools must record an audit trail
    applies_to:
      tools:
        - Analyze Customer Data
        - Generate Report
    rule:
      allow: true

  - id: approve_external_calls
    description: External API calls require human approval
    applies_to:
      tools:
        - Send Email
        - Post to Slack
    rule:
      require: approval`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Install the DashClaw Python SDK and CrewAI',
      summary:
        'Create a virtual environment and install the required packages. Requires Python 3.10+ (Python 3.14+ is not supported by CrewAI).',
      codeTitle: 'Terminal',
      codeBody: `python -m venv venv
source venv/bin/activate  # On Windows: venv\\Scripts\\activate
pip install dashclaw crewai==1.11.0 python-dotenv`,
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
      title: 'Create a governed CrewAI tool with the @tool decorator',
      summary:
        'The @tool decorator creates a CrewAI tool. Inside the function, call DashClaw guard before executing, then record the action and outcome.',
      codeTitle: 'main.py',
      codeBody: toolCodeBody,
      note: 'The guard check runs before each tool execution. If the policy blocks, the tool returns early with the block reason. Otherwise it records the action, executes, and reports the outcome.',
    },
    {
      number: 5,
      title: 'Run the governed CrewAI tool',
      summary: 'Execute the example and watch the governance flow.',
      codeTitle: 'Terminal',
      codeBody: 'python main.py',
      note: 'No LLM API key needed: the example calls the tool directly. Only the DashClaw SDK calls are real.',
    },
    {
      number: 6,
      title: 'See the result in DashClaw',
      summary: 'Open your DashClaw dashboard to confirm the action was recorded.',
      note: "Go to /decisions: you should see your action in the ledger with action_type 'data_analysis', agent_id 'crewai-analyst-agent', and status 'completed'.",
    },
    {
      number: 7,
      title: 'Clone the full example',
      summary: 'The complete runnable example is in the DashClaw repo.',
      codeTitle: 'Terminal',
      codeBody: `git clone https://github.com/ucsandman/DashClaw.git
cd DashClaw/examples/crewai-governed
pip install -r requirements.txt
python main.py`,
      note: 'For production CrewAI integrations, the Python SDK also includes a DashClawCrewIntegration class (sdk-python/dashclaw/integrations/crewai.py) that provides automatic task callbacks for governing entire crews.',
    },
  ];

  const proofMoment =
    "Go to /decisions: you should see your action in the ledger with action_type 'data_analysis', agent_id 'crewai-analyst-agent', and status 'completed'.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'CrewAI Integration Guide - DashClaw',
          description: 'Add governance to CrewAI agents with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/crewai',
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
            <span className="text-secondary">CrewAI</span>
          </div>

          <GuideClient
            frameworkName="CrewAI"
            frameworkIcon={<Users size={28} />}
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
