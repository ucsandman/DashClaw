/**
 * MCP guard-context parity (Organ 3, Phase 2).
 *
 * The MCP server's dashclaw_guard tool forwards target / write_paths /
 * content / tool toward hook parity. These tests pin the server side of that
 * contract: validateGuardInput must NOT strip those fields, and a
 * protected_path policy must actually fire on an MCP-shaped payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { validateGuardInput } from '@/lib/validate.js';
import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

// The exact payload shape mcp-server/src/tools.ts dashclaw_guard sends.
const MCP_PAYLOAD = {
  action_type: 'code_change',
  declared_goal: 'Update auth middleware',
  risk_score: 60,
  agent_id: 'mcp-agent',
  systems_touched: ['codebase'],
  reversible: true,
  target: 'app/lib/auth.ts',
  write_paths: ['app/lib/auth.ts', '.env'],
  content: "const KEY = 'sk-not-really';",
  tool: { name: 'Write' },
};

describe('MCP guard-context parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
  });

  it('validateGuardInput preserves the enriched MCP fields (no silent strip)', () => {
    const { valid, data, errors } = validateGuardInput(MCP_PAYLOAD);
    expect(errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(data.target).toBe('app/lib/auth.ts');
    expect(data.write_paths).toEqual(['app/lib/auth.ts', '.env']);
    expect(data.content).toBe(MCP_PAYLOAD.content);
    expect(data.tool).toEqual({ name: 'Write' });
  });

  it('a protected_path policy fires on the MCP-shaped payload', async () => {
    const sql = createSqlMock({
      taggedResponses: [[
        {
          id: 'gp_pp',
          name: 'Protect env files',
          policy_type: 'protected_path',
          rules: JSON.stringify({ paths: ['.env'], action: 'require_approval' }),
        },
      ]],
    });
    const { data } = validateGuardInput(MCP_PAYLOAD);
    const result = await evaluateGuard('org_mcp1', data, sql);
    expect(result.decision).toBe('require_approval');
    expect(result.reason).toContain('Protected path touched');
  });
});
