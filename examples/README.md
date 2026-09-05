# DashClaw Examples

Terminal-first examples for three different trust boundaries:

- `runGoverned` / `run_governed` examples claim one protocol-1 execution attempt before the callback.
- Hook examples rely on the host interception seam and negotiate claims with the server.
- Lower-level guard and record examples are cooperative demonstrations. Their effects stay simulated unless the README says a registered capability is invoked through `dashclaw_invoke`.

## Two-terminal demo

Use two terminals to observe the approval flow in a simulated example:

```bash
# Terminal 1: Run the agent
cd examples/openai-deploy-pipeline
npm install
node index.js

# Terminal 2: Approve when the gate fires
dashclaw approve act_<id shown in Terminal 1>
```

## Examples

| Example | SDK | Language | Scenario | Effect boundary |
|---|---|---|---|---|
| `proof-pack` | DashClaw | Node.js + Python | Decision, action, approval, outcome, dashboard link | Cooperative; no business effect |
| `openai-governed-agent` | OpenAI | Node.js | Deployment simulation | `runGoverned` claim |
| `anthropic-governed-agent` | Anthropic | Node.js | Deployment approval simulation | Cooperative |
| `claude-code-review-agent` | Anthropic | Node.js | Security-fix approval simulation | Cooperative |
| `codex-review-agent` | Codex CLI | AGENTS.md | Security-fix gate | Codex host hook |
| `openai-deploy-pipeline` | OpenAI | Node.js | Production-deploy simulation | Cooperative |
| `openai-agents-governed` | OpenAI Agents SDK | Node.js | PII cleanup simulation | Cooperative |
| `governed-chat-harness` | Anthropic Messages API | Node.js | Chat runtime tool routing | Cooperative tool loop |
| `python-research-agent` | None (simulated) | Python | File-write simulation | Cooperative |
| `langgraph-governed` | LangGraph | Python | StateGraph governance state | Cooperative |
| `crewai-governed` | CrewAI | Python | `@tool` callback governance | `run_governed` claim |
| `autogen-governed` | AutoGen | Python | Deploy simulation | Cooperative |
| `pydantic-ai-governed` | Pydantic AI | Python | Migration simulation | Cooperative |
| `vercel-ai-governed` | Vercel AI SDK | Node.js | Governed tool execute functions | `runGoverned` claim |
| `managed-agent-governed` | Anthropic (Managed Agent) | Python | Custom governance tools | `dashclaw_invoke` for registered capabilities; other tools cooperative |
| `managed-agent-mcp` | Anthropic (Managed Agent) | Python | Governance tools over MCP | `dashclaw_invoke` for registered capabilities; other tools cooperative |
| `kimi_dashclaw_test.py` | Moonshot (OpenAI-compatible) | Python | Non-Anthropic model demonstration | Cooperative |

### openai-governed-agent

The canonical Node helper example. It simulates a deployment inside
`runGoverned`, including current policy, optional approval, one execution claim,
and explicit completion confirmation.

### proof-pack

The recommended first integration. It has no model-provider dependency and no
business side effect. It exercises the cooperative decision, action, approval,
and outcome paths and prints the durable decision-record link. Use it to prove that an instance and API key work
before wiring DashClaw into a real agent.

### claude-code-review-agent

A Claude-powered agent reviews `sample-auth.js` for security issues. The file write triggers `require_approval` because the target path matches the `auth` risk pattern. Works without an Anthropic API key (uses simulated review output).

### openai-deploy-pipeline

A CI/CD pipeline agent that runs pre-flight checks, gets an AI readiness assessment, and attempts a simulated production deploy. The deploy action has risk 85 and is irreversible, so policy can require approval or block it. Includes simulated rolling pod updates when policy and any required approval allow it.

### python-research-agent

A Python agent that researches a topic and writes a report. Demonstrates the Python SDK governance flow. Requires no AI API key at all.

### langgraph-governed

A LangGraph StateGraph that carries cooperative guard and action state between nodes. The research is simulated. Keep a real effect inside one `run_governed` node instead of splitting policy and execution across nodes. Requires Python 3.10+ and the DashClaw Python SDK. No OPENAI_API_KEY needed.

### crewai-governed

A CrewAI agent using `@tool` callbacks backed by `run_governed`. Each simulated tool carries an exact act through policy, recording, optional approval, one execution claim, callback, and outcome. Requires Python 3.10+ and the DashClaw Python SDK. No OPENAI_API_KEY needed.

### pydantic-ai-governed

A simulated database-migration tool registered on a Pydantic AI agent via `tools=[...]`. It demonstrates cooperative policy, approval, and audit calls plus the `TestModel` pattern. Move a real migration into `run_governed`. Requires Python 3.10+ and the DashClaw Python SDK. No LLM API key needed.

### vercel-ai-governed

A generic `governed()` higher-order function that passes each Vercel AI SDK tool's exact act and `execute` callback to `runGoverned`. The lookup and refund are simulated. Node.js 20+ and the DashClaw Node SDK. No LLM API key needed.

### Claude Managed Agents (MCP)

`managed-agent-mcp/` gives the agent 17 governance tools and 3 resources through one MCP configuration. Ordinary tools remain cooperative. Registered capabilities invoked through `dashclaw_invoke` use the server-side effect boundary. Optionally pair it with the `dashclaw-governance` skill to load the protocol and org-specific policy context.

### managed-agent-governed

A Claude Managed Agent with DashClaw custom tools. Guard and record calls for built-in bash, file I/O, and web search are cooperative. Registered external APIs invoked through `dashclaw_invoke` use DashClaw's server-side guard, claim, effect, and outcome seam. Requires an Anthropic API key and a running DashClaw instance.

### Governing non-Anthropic models

`kimi_dashclaw_test.py` shows cooperative DashClaw policy and audit calls around a Moonshot AI (Kimi) agent that uses an OpenAI-compatible endpoint. Set `MOONSHOT_API_KEY`, `DASHCLAW_BASE_URL`, and `DASHCLAW_API_KEY`, then run `python examples/kimi_dashclaw_test.py`.

### DashClaw demo guide

For a hosted operator walkthrough, packaged Docker simulation, and safe SDK integration exercise, see [DEMO.md](../DEMO.md).

## Prerequisites

All examples need:
- A running DashClaw instance (`npm run dev` from the repo root)
- `DASHCLAW_API_KEY` from your instance

Node examples additionally need Node.js 20+. Python examples need Python 3.10+.

Each example includes a `.env.example` file. Copy it to `.env` and fill in your keys before running.
