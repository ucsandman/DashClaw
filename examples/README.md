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
| `anthropic-governed-agent` | Anthropic | Node.js | Deployment agent held for human approval |
| `claude-code-review-agent` | Anthropic | Node.js | Security fix approval gate |
| `codex-review-agent` | Codex CLI | AGENTS.md | Same security-fix gate, governed via the Codex harness |
| `openai-deploy-pipeline` | OpenAI | Node.js | Production deploy approval with CLI |
| `openai-agents-governed` | OpenAI Agents SDK | Node.js | PII cleanup agent held for human approval |
| `governed-chat-harness` | Anthropic Messages API | Node.js | Chat runtime routing every tool call through guard |
| `python-research-agent` | None (simulated) | Python | File write governance |
| `langgraph-governed` | LangGraph | Python | StateGraph governance node pattern |
| `crewai-governed` | CrewAI | Python | @tool decorator governance pattern |
| `autogen-governed` | AutoGen | Python | Governed tool calls via the 4-step loop |
| `pydantic-ai-governed` | Pydantic AI | Python | Governed agent tool via the 4-step loop |
| `vercel-ai-governed` | Vercel AI SDK | Node.js | governed() wrapper for tool execute functions |
| `managed-agent-governed` | Anthropic (Managed Agent) | Python | Cloud-hosted agent with custom governance tools |
| `managed-agent-mcp` | Anthropic (Managed Agent) | Python | Same, via the MCP server — zero custom tools |
| `kimi_dashclaw_test.py` | Moonshot (OpenAI-compat) | Python | Governing a non-Anthropic model |

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

### pydantic-ai-governed

A governed database-migration tool registered on a Pydantic AI agent via `tools=[...]`. Demonstrates the full 4-step loop including `wait_for_approval` HITL, plus the `TestModel` pattern for exercising the agent loop in tests. Requires Python 3.10+ and the DashClaw Python SDK. No LLM API key needed.

### vercel-ai-governed

A generic `governed()` higher-order function that wraps any Vercel AI SDK tool `execute` in the 4-step loop (guard → createAction → waitForApproval → updateOutcome), applied to a support agent's lookup and refund tools. Node.js 20+ and the DashClaw Node SDK. No LLM API key needed.

### Claude Managed Agents (MCP) ⭐ Recommended

`managed-agent-mcp/` — The simplest way to govern a Claude Managed Agent. Uses DashClaw's MCP server — one config line gives the agent 26 governance tools and 6 resources. ~120 lines. Optionally pair with the `dashclaw-governance` skill (`public/downloads/dashclaw-governance/`) to teach the agent the governance protocol and load org-specific policies/capabilities automatically.

### managed-agent-governed

A Claude Managed Agent running in Anthropic's cloud infrastructure with DashClaw as the governance layer. The agent has full access to bash, file I/O, and web search, but all external API calls, risky modifications, and significant decisions go through DashClaw custom tools (`dashclaw_guard`, `dashclaw_invoke`, `dashclaw_record`). Requires an Anthropic API key and a running DashClaw instance.

### Governing non-Anthropic models

`kimi_dashclaw_test.py` shows DashClaw governing a Moonshot AI (Kimi) agent that uses an OpenAI-compatible endpoint. The governance loop — guard check, action record, assumption registration, outcome update — is identical regardless of which model drives the agent. Set `MOONSHOT_API_KEY`, `DASHCLAW_BASE_URL`, and `DASHCLAW_API_KEY`, then run `python examples/kimi_dashclaw_test.py`.

### Market Intelligence Briefing (Full-Stack Demo)

Not an example you run externally — this seeds demo data directly into your DashClaw instance. Run `node scripts/seed-demo-capabilities.mjs` to create a knowledge collection, 5 capabilities, and 3 policies. See [DEMO.md](../DEMO.md).

## Prerequisites

All examples need:
- A running DashClaw instance (`npm run dev` from the repo root)
- `DASHCLAW_API_KEY` from your instance

Node examples additionally need Node.js 20+. Python examples need Python 3.10+.

Each example includes a `.env.example` file. Copy it to `.env` and fill in your keys before running.
