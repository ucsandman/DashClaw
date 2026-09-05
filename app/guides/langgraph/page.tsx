import { headers } from 'next/headers';
import Link from 'next/link';
import { ChevronRight, GitBranch } from 'lucide-react';

import PublicNavbar from '../../components/PublicNavbar';
import PublicFooter from '../../components/PublicFooter';
import GuideClient from '../GuideClient';
import { getGuideBaseUrl } from '../../lib/guideContent';
import type { Metadata } from 'next';
import { marketingPageMetadata } from '../../lib/marketingSeo';
import JsonLd from '../../components/JsonLd';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = marketingPageMetadata({
  title: 'LangGraph Integration Guide - DashClaw',
  description: 'Add governance to LangGraph agents with DashClaw in under 20 minutes.',
  path: '/guides/langgraph',
});

export default async function LangGraphGuidePage() {
  const headerStore = await headers();
  const host = headerStore.get('host') || 'localhost:3000';
  const baseUrl = getGuideBaseUrl(host);

  const guardrailsYaml = `version: 1
project: my-langgraph-agent
description: >
  Governance policy for a LangGraph research agent.
  High-risk external writes require approval.
  Low-risk reads are auto-allowed.

policies:
  - id: approve_external_writes
    description: Writing to external systems requires human approval
    applies_to:
      tools:
        - api.post
        - file.write
        - database.insert
    rule:
      require: approval

  - id: allow_research
    description: Read-only research is low risk
    applies_to:
      tools:
        - web.search
        - document.read
    rule:
      allow: true`;

  const governanceNodeCode = `import os

from dashclaw import DashClaw
from langgraph.graph import StateGraph, END
from typing import TypedDict

class AgentState(TypedDict):
    topic: str
    research_result: str

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="langgraph-research-agent",
)

def governed_research_node(state: AgentState) -> AgentState:
    """Keep the research effect inside DashClaw's claimed callback."""
    topic = state["topic"]
    result = claw.run_governed(
        {
            "kind": "http",
            "request": {
                "method": "GET",
                "url": "https://research.example.test/search",
                "body_excerpt": topic,
            },
        },
        {
            "action_type": "research",
            "declared_goal": f"Research topic: {topic}",
            "risk_score": 30,
        },
        lambda: f"Research findings for {topic}",  # replace with real work
    )
    return {**state, "research_result": result}

# Wire the graph
graph = StateGraph(AgentState)
graph.add_node("research", governed_research_node)
graph.set_entry_point("research")
graph.add_edge("research", END)
app = graph.compile()`;

  const steps = [
    {
      number: 1,
      title: 'Deploy DashClaw',
      summary: 'Get a running instance. Click the Vercel deploy button or run locally.',
      note: 'Already have an instance? Skip to Step 2.',
    },
    {
      number: 2,
      title: 'Install the DashClaw Python SDK and LangGraph',
      summary: 'Create a virtual environment and install the required packages.',
      codeTitle: 'Terminal',
      codeBody: `python -m venv venv
source venv/bin/activate  # On Windows: venv\\Scripts\\activate
pip install dashclaw langgraph==1.1.3 langchain-core==1.2.21 python-dotenv`,
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
      title: 'Keep the effect inside a governed LangGraph node',
      summary:
        'The node passes the exact research act and callback to run_governed. DashClaw handles current policy, recording, approval, one execution claim, and outcome reporting.',
      codeTitle: 'main.py',
      codeBody: governanceNodeCode,
      note: 'Do not split guard and effect across graph nodes. The effect callback must stay behind the execution claim.',
    },
    {
      number: 5,
      title: 'Run the governed LangGraph agent',
      summary: 'Execute the example and watch the governance flow.',
      codeTitle: 'Terminal',
      codeBody: 'python main.py',
      note: 'No OPENAI_API_KEY needed: the example simulates LLM output. Only the DashClaw SDK calls are real.',
    },
    {
      number: 6,
      title: 'See the result in DashClaw',
      summary: 'Open your DashClaw dashboard to confirm the action was recorded.',
      note: "Go to /decisions: you should see your action in the ledger with action_type 'research', agent_id 'langgraph-research-agent', and status 'completed'.",
    },
    {
      number: 7,
      title: 'Clone the full example',
      summary: 'The complete runnable example is in the DashClaw repo.',
      codeTitle: 'Terminal',
      codeBody: `git clone https://github.com/ucsandman/DashClaw.git
cd DashClaw/examples/langgraph-governed
pip install -r requirements.txt
python main.py`,
      note: 'The repository example is an older cooperative guard-and-record graph. It records policy and approval state, but it does not claim execution authority. Use the run_governed node pattern above for real effects.',
    },
  ];

  const proofMoment =
    "Go to /decisions: you should see your action in the ledger with action_type 'research', agent_id 'langgraph-research-agent', and status 'completed'.";

  return (
    <div className="min-h-screen text-white">
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: 'LangGraph Integration Guide - DashClaw',
          description: 'Add governance to LangGraph agents with DashClaw in under 20 minutes.',
          url: 'https://www.dashclaw.io/guides/langgraph',
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
            <span className="text-secondary">LangGraph</span>
          </div>

          <GuideClient
            frameworkName="LangGraph"
            frameworkIcon={<GitBranch size={28} />}
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
