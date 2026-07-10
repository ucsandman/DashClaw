/* ─── data ───
 * Only arrays actually rendered by the landing page live here
 * (frameworkQuickstarts via app/components/StackQuickstarts.tsx). Other
 * landing copy is inline in app/page.tsx — add capability copy there, not in
 * a new export (an unrendered export here ships nothing).
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
// 15 governance tools + 3 resources
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

# Attach the real act: the server classifies
# from evidence, which can only raise risk.
decision = claw.guard({
    "action_type": "shell",
    "act": {"kind": "shell",
            "command": "git push --force origin main"},
})

if decision["decision"] == "allow":
    run_agent_tool()`
  },
  {
    id: 'crewai',
    name: 'CrewAI',
    label: 'Agent task guard',
    code: `# Wrap sensitive agent tasks
decision = claw.guard({
    "action_type": "external_api_call",
    "declared_goal": "Charge the customer via Stripe",
    "systems_touched": ["stripe"],
})

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

// Guard with the real act attached: risk is
// classified server-side from the evidence
const { decision } = await claw.guard({
  action_type: 'sql',
  act: { kind: 'sql', statement: 'DROP TABLE users' },
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
    label: '6 lifecycle hooks + redaction',
    code: `# One install script wires 6 hooks into ~/.hermes/config.yaml
$ bash scripts/install-hermes-plugin.sh

# Managed block written to ~/.hermes/config.yaml:
hooks:
  pre_tool_call:  [...]  # guard: block / require_approval
  post_tool_call: [...]  # outcome recording
  pre_llm_call:   [...]  # policy + pending-approval context injection
  on_session_start: [...] # policy cache warm
  transform_tool_result: [...] # redact API keys, JWTs, PEM blocks
  subagent_stop:  [...]  # delegate_task exits recorded as actions

# Same hooks. Same audit ledger. agent_id = hermes.`
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
// Every tool call: guard -> record -> approval -> outcome.`
  },
];

/* ─── page ─── */
