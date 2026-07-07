import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS, createToolHandlers } from '../../mcp-server/lib/tools.js';

const NEW_TOOLS = [
  'dashclaw_secret_list',
  'dashclaw_secret_due',
  'dashclaw_secret_mark_rotated',
  'dashclaw_decisions_recent',
  'dashclaw_assumption_record',
];

describe('MCP toolkit tools', () => {
  it('all 5 new toolkit tools are defined', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    for (const tool of NEW_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it('every new tool has description, inputSchema with type=object', () => {
    for (const name of NEW_TOOLS) {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('every new tool has a handler', () => {
    const client = {
      fetch: async () => ({ ok: true, json: async () => ({}) }),
    };
    const handlers = createToolHandlers(client);
    for (const name of NEW_TOOLS) {
      expect(typeof handlers[name]).toBe('function');
    }
  });

  it('READ filters respect the explicit agent_id over the server default', async () => {
    // On query tools agent_id is a FILTER: an explicit tool-call filter must
    // win over the server-configured agent id ("show me moltfire's decisions").
    const captured = [];
    const client = {
      agentId: 'server-agent',
      fetch: async (path, opts) => {
        captured.push({ path, body: opts?.body });
        return { ok: true, status: 200, json: async () => ({}) };
      },
    };
    const handlers = createToolHandlers(client);

    await handlers.dashclaw_decisions_recent({ agent_id: 'spoofed' });
    await handlers.dashclaw_secret_list({ agent_id: 'spoofed' });
    for (const c of captured) {
      expect(c.path).toMatch(/agent_id=spoofed/);
    }
  });

  it('toolkit handlers fall back to LLM-supplied agent_id when the server has no default', async () => {
    const captured = [];
    const client = {
      agentId: '',
      fetch: async (path) => {
        captured.push(path);
        return { ok: true, json: async () => ({}) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_decisions_recent({ agent_id: 'bare-fallback' });
    expect(captured[0]).toMatch(/agent_id=bare-fallback/);
  });

  it('decisions_recent handler builds query params', async () => {
    let captured = null;
    const client = {
      fetch: async (path) => {
        captured = path;
        return { ok: true, json: async () => ({ decisions: [] }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_decisions_recent({ agent_id: 'hermes', action_type: 'deploy', limit: 10 });
    expect(captured).toMatch(/agent_id=hermes/);
    expect(captured).toMatch(/action_type=deploy/);
    expect(captured).toMatch(/limit=10/);
  });
});
