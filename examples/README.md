# DashClaw Examples

Terminal-first governance examples showing the full decision loop: guard check, action recording, approval gate, and outcome tracking.

## Two-terminal demo

The recommended way to run any example with an approval gate:

```bash
# Terminal 1: Run the agent
cd examples/openai-deploy-pipeline
npm install
node index.js

# Terminal 2: Approve when the gate fires
dashclaw approve act_<id shown in Terminal 1>
```

## Examples

| Example | SDK | Language | Governance Scenario |
|---|---|---|---|
| `openai-governed-agent` | OpenAI | Node.js | Customer refund email governance |
| `claude-code-review-agent` | Anthropic | Node.js | Security fix approval gate |
| `openai-deploy-pipeline` | OpenAI | Node.js | Production deploy approval with CLI |
| `python-research-agent` | None (simulated) | Python | File write governance |
| `langgraph-governed` | LangGraph | Python | StateGraph governance node pattern |
| `crewai-governed` | CrewAI | Python | @tool decorator governance pattern |
| `managed-agent-governed` | Anthropic (Managed Agent) | Python | Cloud-hosted agent with custom governance tools |

### openai-governed-agent

The original starter example. An OpenAI agent deploys a service to production. Shows guard, action, assumption, and outcome recording.

### claude-code-review-agent

A Claude-powered agent reviews `sample-auth.js` for security issues. The file write triggers `require_approval` because the target path matches the `auth` risk pattern. Works without an Anthropic API key (uses simulated review output).

### openai-deploy-pipeline

A CI/CD pipeline agent that runs pre-flight checks, gets an AI readiness assessment, and attempts a production deploy. The deploy action has risk 85 and is irreversible, which triggers the approval gate. Includes simulated rolling pod updates after approval.

### python-research-agent

A Python agent that researches a topic and writes a report. Demonstrates the Python SDK governance flow. Requires no AI API key at all.

### langgraph-governed

A LangGraph StateGraph with a `governance_node` that runs guard checks and records actions before the research node executes. Shows how to wire DashClaw into LangGraph's node-based execution model. Requires Python 3.10+ and the DashClaw Python SDK. No OPENAI_API_KEY needed.

### crewai-governed

A CrewAI agent using the `@tool` decorator to wrap governance calls around tool execution. Demonstrates guard → create_action → update_outcome flow within CrewAI's tool abstraction. Requires Python 3.10+ and the DashClaw Python SDK. No OPENAI_API_KEY needed.

### Claude Managed Agents (MCP) ⭐ Recommended

`managed-agent-mcp/` — The simplest way to govern a Claude Managed Agent. Uses DashClaw's MCP server — one config line gives the agent 30 governance tools and 6 resources. ~120 lines. Optionally pair with the `dashclaw-governance` skill (`public/downloads/dashclaw-governance/`) to teach the agent the governance protocol and load org-specific policies/capabilities automatically.

### managed-agent-governed

A Claude Managed Agent running in Anthropic's cloud infrastructure with DashClaw as the governance layer. The agent has full access to bash, file I/O, and web search, but all external API calls, risky modifications, and significant decisions go through DashClaw custom tools (`dashclaw_guard`, `dashclaw_invoke`, `dashclaw_record`). Requires an Anthropic API key and a running DashClaw instance.

### Market Intelligence Briefing (Full-Stack Demo)

Not an example you run externally — this seeds demo data directly into your DashClaw instance. Run `node scripts/seed-demo-capabilities.mjs` to create a knowledge collection, 5 capabilities, 3 policies, and a 5-step workflow. Then execute "Daily Market Briefing" from the Workflows page. See [DEMO.md](../DEMO.md).

## Prerequisites

All examples need:
- A running DashClaw instance (`npm run dev` from the repo root)
- `DASHCLAW_API_KEY` from your instance

Node examples additionally need Node.js 20+. Python examples need Python 3.10+.

Each example includes a `.env.example` file. Copy it to `.env` and fill in your keys before running.
