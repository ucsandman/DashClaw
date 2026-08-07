import { describe, it, expect } from 'vitest';
import {
  SYNTHETIC_AGENT_RE, SYNTHETIC_AGENT_LIKE_PATTERNS, isSyntheticAgentId,
} from '../../app/lib/synthetic-agents.js';

describe('synthetic-agents registry', () => {
  it('matches every known synthetic family incl. bench-agent-*', () => {
    for (const id of ['smoke-h-mr3qh44i', 'ci-smoke', 'sdk-live-test-agent', 'demo-e2e-verifier',
      'test', 'test-7', 'loadtest-mr6y5eev', 'bench-agent-bench_mr9e9luj', 'guide-capture-agent',
      'analytics-agent', 'openai-deployer-1', 'rogue-agent']) {
      expect(isSyntheticAgentId(id), id).toBe(true);
    }
  });
  it('never matches real fleet agents', () => {
    for (const id of ['ps-prospector', 'ps-researcher', 'openclaw', 'claude-code',
      'ship verification', 'moltfire-openclaw', 'testify-prod']) {
      expect(isSyntheticAgentId(id), id).toBe(false);
    }
  });
  it('regex and LIKE patterns agree (prefix construction)', () => {
    // every LIKE pattern is either exact or `prefix%`; each must be matched by the regex
    for (const p of SYNTHETIC_AGENT_LIKE_PATTERNS) {
      const probe = p.endsWith('%') ? p.slice(0, -1) + 'xyz' : p;
      expect(SYNTHETIC_AGENT_RE.test(probe), p).toBe(true);
    }
  });
});
