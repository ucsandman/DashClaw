import { describe, it, expect } from 'vitest';
import { TOOL_DEFINITIONS, createToolHandlers } from '../../mcp-server/lib/tools.js';

const NEW_TOOLS = [
  'dashclaw_handoff_create',
  'dashclaw_handoff_latest',
  'dashclaw_handoff_consume',
  'dashclaw_secret_list',
  'dashclaw_secret_due',
  'dashclaw_secret_mark_rotated',
  'dashclaw_skill_scan',
  'dashclaw_loop_add',
  'dashclaw_loop_list',
  'dashclaw_loop_close',
  'dashclaw_learning_log',
  'dashclaw_learning_query',
  'dashclaw_decisions_recent',
  'dashclaw_assumption_record',
];

describe('MCP toolkit tools', () => {
  it('all 14 new toolkit tools are defined', () => {
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

  it('handoff_create handler POSTs /api/handoffs', async () => {
    let captured = null;
    const client = {
      fetch: async (path, opts) => {
        captured = { path, body: opts?.body };
        return { ok: true, json: async () => ({ id: 'hf_1' }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_handoff_create({ agent_id: 'hermes', bundle: { summary: 's' } });
    expect(captured.path).toMatch(/\/api\/handoffs$/);
  });

  it('handoff_latest handler GETs /api/handoffs/latest', async () => {
    let captured = null;
    const client = {
      fetch: async (path) => {
        captured = path;
        return { ok: true, json: async () => ({ id: 'hf_1' }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_handoff_latest({ agent_id: 'hermes' });
    expect(captured).toMatch(/\/api\/handoffs\/latest/);
  });

  it('skill_scan handler POSTs /api/skills/scan with skill_name + files', async () => {
    let captured = null;
    const client = {
      fetch: async (path, opts) => {
        captured = { path, body: JSON.parse(opts.body) };
        return { ok: true, json: async () => ({ id: 'scn_1', passed: true }) };
      },
    };
    const handlers = createToolHandlers(client);
    await handlers.dashclaw_skill_scan({ skill_name: 'test', files: { 'a.py': 'print(1)' } });
    expect(captured.path).toMatch(/\/api\/skills\/scan/);
    expect(captured.body.skill_name).toBe('test');
  });

  it('learning_query GETs /api/learning (the store learning_log feeds), not /api/learning/lessons', async () => {
    const captured = [];
    const client = {
      fetch: async (path) => {
        captured.push(path);
        return {
          ok: true,
          json: async () => ({
            decisions: [
              { decision: 'use neon for db', context: 'serverless', outcome: 'success' },
              { decision: 'use redis cache', context: 'latency', outcome: 'success' },
              { decision: 'pick Neon again', context: 'consistency', outcome: 'pending' },
            ],
            lessons: [{ id: 'lesson_1' }],
          }),
        };
      },
    };
    const handlers = createToolHandlers(client);
    const out = JSON.parse(await handlers.dashclaw_learning_query({ agent_id: 'hermes', query: 'neon' }));

    expect(captured[0]).toMatch(/\/api\/learning\?/);
    expect(captured[0]).not.toMatch(/\/api\/learning\/lessons/);
    expect(captured[0]).toMatch(/agent_id=hermes/);
    // q matches decision/context case-insensitively: 2 of 3 mention neon
    expect(out.decisions).toHaveLength(2);
    expect(out.lessons).toHaveLength(1);
  });

  it('learning_query honors limit by slicing decisions', async () => {
    const client = {
      fetch: async () => ({
        ok: true,
        json: async () => ({ decisions: [{ decision: 'a' }, { decision: 'b' }, { decision: 'c' }], lessons: [] }),
      }),
    };
    const handlers = createToolHandlers(client);
    const out = JSON.parse(await handlers.dashclaw_learning_query({ limit: 2 }));
    expect(out.decisions).toHaveLength(2);
  });

  it('server-configured agent_id wins on WRITE operations; READ filters respect explicit agent_id', async () => {
    // Identity vs Filter precedence:
    // - WRITE (dashclaw_handoff_create): server-agent wins (governance primitive)
    // - READ (loop_list/learning_query/etc): explicit filter wins ("show me moltfire's loops")
    const captured = [];
    const client = {
      agentId: 'server-agent',
      fetch: async (path, opts) => {
        captured.push({ path, body: opts?.body });
        return { ok: true, status: 200, json: async () => ({}) };
      },
    };
    const handlers = createToolHandlers(client);

    // READ filters: spoofed agent_id should appear in the request
    await handlers.dashclaw_loop_list({ agent_id: 'spoofed' });
    await handlers.dashclaw_learning_query({ agent_id: 'spoofed' });
    await handlers.dashclaw_decisions_recent({ agent_id: 'spoofed' });
    await handlers.dashclaw_secret_list({ agent_id: 'spoofed' });
    for (const c of captured) {
      expect(c.path).toMatch(/agent_id=spoofed/);
    }

    // WRITE identity: server-agent wins, spoofed is rejected
    captured.length = 0;
    await handlers.dashclaw_handoff_create({ agent_id: 'spoofed', bundle: { summary: 's' } });
    expect(JSON.parse(captured[0].body).agent_id).toBe('server-agent');
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
    await handlers.dashclaw_loop_list({ agent_id: 'bare-fallback' });
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
