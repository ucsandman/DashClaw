/* ─── data ───
 * Only arrays actually rendered by the landing page live here
 * (frameworkQuickstarts via app/components/StackQuickstarts.tsx, signals via
 * app/page.tsx). Other landing copy is inline in app/page.tsx — add
 * capability copy there, not in a new export (an unrendered export here
 * ships nothing).
 */

export const frameworkQuickstarts = [
  {
    id: 'mcp',
    name: 'MCP Server',
    label: 'Zero-code governance',
    code: `// Add to claude_desktop_config.json
// or .mcp.json for Claude Code
{
  "mcpServers": {
    "dashclaw": {
      "command": "npx",
      "args": ["@dashclaw/mcp-server"],
      "env": {
        "DASHCLAW_URL": "https://your-instance.vercel.app",
        "DASHCLAW_API_KEY": "oc_live_..."
      }
    }
  }
}
// 29 governance tools + 6 resources
// No SDK. No code changes.`
  },
  {
    id: 'langchain',
    name: 'LangChain',
    label: 'Python tool guard',
    code: `from dashclaw import DashClaw
import os

claw = DashClaw(
    base_url=os.environ["DASHCLAW_BASE_URL"],
    api_key=os.environ["DASHCLAW_API_KEY"],
    agent_id="my-agent"
)

# Intercept tool execution
decision = claw.guard(
    action_type="deploy",
    risk_score=82
)

if decision["decision"] == "allow":
    run_agent_tool()`
  },
  {
    id: 'crewai',
    name: 'CrewAI',
    label: 'Agent task guard',
    code: `# Wrap sensitive agent tasks
decision = claw.guard(
    action_type="external_api_call",
    provider="stripe",
    risk_score=88
)

if decision["decision"] == "allow":
    crew.kickoff()`
  },
  {
    id: 'openai',
    name: 'OpenAI Tools',
    label: 'Node.js function guard',
    code: `import { DashClaw } from 'dashclaw'
const claw = new DashClaw({
  baseUrl: process.env.DASHCLAW_BASE_URL,
  apiKey: process.env.DASHCLAW_API_KEY,
  agentId: 'my-agent'
})

// Guard before calling the tool
const { decision } = await claw.guard({
  actionType: "deploy",
  riskScore: 90
})

if (decision === 'allow') {
  await openai.chat.completions.create(...)
}`
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    label: 'One-command install',
    code: `# No clone required — the CLI downloads the hooks bundle
# from your instance, wires ~/.claude/settings.json, and
# defaults to observe mode.
npm i -g @dashclaw/cli
dashclaw install claude            # prompts for endpoint + API key
dashclaw install claude --trial    # hosted signup, paste the key

# Governs Bash, Edit, Write, MultiEdit, Agent/Task, mcp__* tools.
# Flip to enforce: set DASHCLAW_HOOK_MODE=enforce in
# ~/.dashclaw/claude-hooks/.env`
  },
  {
    id: 'codex',
    name: 'Codex',
    label: 'PreToolUse hook + MCP',
    code: `# One command wires it all into ~/.codex/config.toml
$ dashclaw install codex --project .

# Managed block written to ~/.codex/config.toml:
approval_policy = "on-request"

[mcp_servers.dashclaw]
command = "python"
args = [".../dashclaw-mcp.js", "--agent-id", "codex"]

[[hooks.PreToolUse]]
matcher = "Bash|Edit|Write|MultiEdit"
[[hooks.PreToolUse.hooks]]
type = "command"
command = "python ~/.codex/hooks/dashclaw/dashclaw_pretool.py"

# Same hooks. Same audit ledger. agent_id = codex.`
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    label: '8 lifecycle hooks + live ingest',
    code: `# One install script wires 8 hooks into ~/.hermes/config.yaml
$ bash scripts/install-hermes-plugin.sh

# Managed block written to ~/.hermes/config.yaml:
hooks:
  pre_tool_call:  [...]  # guard / block / require_approval
  post_tool_call: [...]  # outcome recording
  pre_llm_call:   [...]  # per-turn policy + approval context injection
  post_llm_call:  [...]  # live ingest to /api/code-sessions/ingest-live
  on_session_start: [...] # cache warm
  on_session_end:   [...] # finalize: true -> optimizer + alerts pass
  transform_tool_result: [...] # redact API keys, JWTs, PEM blocks
  subagent_stop:    [...] # delegate_task ROI tracking

# Per-turn cost attribution. agent_id = hermes.`
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    label: 'Plugin — full governance loop',
    code: `// openclaw.config.json — the framework that
// inspired the "Claw" in DashClaw
{
  "plugins": {
    "entries": {
      "dashclaw-governance": {
        "enabled": true,
        "config": {
          "dashclawUrl": "https://your-instance.vercel.app",
          "dashclawApiKey": "oc_live_...",
          "agentId": "my-openclaw-agent",
          "failClosed": true
        }
      }
    }
  }
}
// Every tool call: guard -> record -> approval
// -> outcome. x402 spend gating included.`
  },
];

export const signals = [
  { name: 'Autonomy Spike', description: 'Agent taking too many actions without human checkpoints' },
  { name: 'High Impact, Low Oversight', description: 'Critical actions without sufficient review' },
  { name: 'Repeated Failures', description: 'Same action type failing multiple times' },
  { name: 'Stale Loop', description: 'Open loops unresolved past their expected timeline' },
  { name: 'Assumption Drift', description: 'Assumptions becoming stale or contradicted by outcomes' },
  { name: 'Stale Assumption', description: 'Assumptions not validated within expected timeframe' },
  { name: 'Stale Running Action', description: 'Actions stuck in running state for over 4 hours' },
];

/* ─── page ─── */
