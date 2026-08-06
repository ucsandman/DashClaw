// Pure template functions for rendering per-stack integration snippets.
// Given a provisioning result (endpoint, apiKey, workspaceId), returns
// { language, code } the UI renders as a copy-paste block.
//
// All templates reference only packages that exist today (published on npm/PyPI)
// or use DashClaw's own /api/mcp endpoint via URL-mode MCP (no client package needed).

export const STACK_OPTIONS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'URL-mode MCP entry in ~/.claude/settings.json — the full governance toolset, zero install.',
  },
  {
    id: 'mcp',
    label: 'Claude Desktop / MCP host',
    description: 'URL-mode MCP config for Claude Desktop, Cursor, Zed, or any MCP-compatible client.',
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    description: 'Plugin install + config for the OpenClaw runtime.',
  },
  {
    id: 'langchain',
    label: 'LangChain',
    description: 'Python initializer that wraps your chain with DashClaw governance.',
  },
];

function claudeCode({ endpoint, apiKey }) {
  return `{
  "mcpServers": {
    "dashclaw": {
      "url": "${endpoint}/api/mcp",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`;
}

function mcp({ endpoint, apiKey }) {
  return `{
  "mcpServers": {
    "dashclaw": {
      "url": "${endpoint}/api/mcp",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`;
}

function openclaw({ endpoint, apiKey }) {
  return `# 1) Install the plugin:
openclaw plugins install @dashclaw/openclaw-plugin

# 2) Add the env vars before the gateway starts (e.g. in your OpenClaw env file):
export DASHCLAW_URL="${endpoint}"
export DASHCLAW_API_KEY="${apiKey}"

# 3) Enable "dashclaw-governance" in your openclaw.json plugin entries
#    (see the package README for config options). Restart the gateway to pick it up.`;
}

function langchain({ endpoint, apiKey }) {
  return `# pip install dashclaw
import os
from dashclaw import DashclawClient

os.environ["DASHCLAW_URL"] = "${endpoint}"
os.environ["DASHCLAW_API_KEY"] = "${apiKey}"

client = DashclawClient()
# Wrap each tool call:
#   decision = client.guard(agent_id="my-agent", action_type="...", ...)
#   if decision.allow: ... ; client.record_outcome(...)`;
}

const RENDERERS = {
  'claude-code': { language: 'json', fn: claudeCode },
  mcp: { language: 'json', fn: mcp },
  openclaw: { language: 'bash', fn: openclaw },
  langchain: { language: 'python', fn: langchain },
};

export function renderTemplate(stackId, { endpoint, apiKey, workspaceId }) {
  const entry = RENDERERS[stackId];
  if (!entry) throw new Error(`unknown stack: ${stackId}`);
  return {
    language: entry.language,
    code: entry.fn({ endpoint, apiKey, workspaceId }),
  };
}
