import { describe, it, expect, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { commandShapeKey } from '@/lib/policy-shapes';

// Halt/predictive settings ride a repository read at the top of evaluateGuard;
// without this mock the REAL getSettings would consume the first taggedResponse
// meant for the policy loader (mock calls are ordered). Same pattern as
// guard-characterization.test.js.
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard } from '@/lib/guard.js';

let orgCounter = 0;
const freshOrg = () => `org_shape_exc_${++orgCounter}`;

function makePolicy(type: string, rules: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

const makeSql = (policies: unknown[]) => createSqlMock({ taggedResponses: [policies] });

describe('rules.shape_exceptions — the misfire escape hatch', () => {
  it('pins the shape grain: `git log --date=format:%Y` reduces to "git log"', () => {
    expect(commandShapeKey('Bash: git log --date=format:%Y')).toBe('git log');
  });

  it('skips the policy for an excepted command shape', async () => {
    const sql = makeSql([
      makePolicy('require_approval', { action_types: ['security'], shape_exceptions: ['git log'] }),
    ]);
    const result = await evaluateGuard(
      freshOrg(),
      { action_type: 'security', declared_goal: 'Bash: git log --date=format:%Y', agent_id: 'a1' },
      sql,
    );
    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toEqual([]);
    expect(result.warnings[0]).toMatch(/skipped: shape "git log" is an exception you added/);
  });

  it('still fires for a command shape not in the exception list', async () => {
    const sql = makeSql([
      makePolicy('require_approval', { action_types: ['security'], shape_exceptions: ['git log'] }),
    ]);
    const result = await evaluateGuard(
      freshOrg(),
      { action_type: 'security', declared_goal: 'Bash: rm -rf build', agent_id: 'a1' },
      sql,
    );
    expect(result.decision).toBe('require_approval');
    expect(result.matched_policies).toEqual(['gp_require_approval']);
  });
});
