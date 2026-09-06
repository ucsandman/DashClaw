import { beforeEach, describe, expect, it } from 'vitest';
import { listGuardDecisions, __resetHasReasonsColumnCache } from '@/lib/repositories/guard.repository';

// listGuardDecisions strips `context` from the list payload (it carries the
// evidence blob) and lifts the few fields readers need. Attestation
// (2026-09-06) — which MODEL and which HARNESS made the call — must come out
// of that blob here or no consumer of GET /api/guard ever sees it. That is
// exactly how the first cut of the /decisions chip shipped dead: the page read
// guardDecision.context.attested_model from a route that never sends context.

const ROWS = [
  {
    id: 'gd_1', org_id: 'org_t', agent_id: 'claude-code', action_type: 'file_delete', decision: 'allow', risk_score: 4,
    reasons: null, matched_policies: '[]', created_at: '2026-09-06T14:00:00Z',
    context: JSON.stringify({
      declared_goal: 'rm old cache',
      attested_model: 'claude-fable-5-1', harness: 'claude-code', harness_version: '2.1.263',
      _risk_breakdown: { base: 4 },
    }),
  },
  {
    id: 'gd_2', org_id: 'org_t', agent_id: 'codex', action_type: 'file_read', decision: 'allow', risk_score: 1,
    reasons: null, matched_policies: '[]', created_at: '2026-09-06T14:00:01Z',
    // Codex attests its harness but has no transcript to read a model from.
    context: JSON.stringify({ declared_goal: 'cat README', harness: 'codex' }),
  },
  {
    id: 'gd_3', org_id: 'org_t', agent_id: 'old-hook', action_type: 'file_read', decision: 'allow', risk_score: 1,
    reasons: null, matched_policies: '[]', created_at: '2026-09-06T14:00:02Z',
    context: '{not json',
  },
];

function fakeSql() {
  const query = async (text) => {
    if (/COUNT\(\*\) as total\b/.test(text)) return [{ total: String(ROWS.length) }];
    if (/total_24h/.test(text)) return [{ total_24h: 3, blocks_24h: 0, warns_24h: 0, approvals_24h: 0 }];
    if (/FROM guard_decisions/.test(text) && /ORDER BY created_at DESC/.test(text)) return ROWS;
    return []; // information_schema probes and anything else
  };
  // Also callable as a tagged template (hasReasonsColumn may use either form).
  return Object.assign(async () => [], { query });
}

describe('listGuardDecisions — attestation lift', () => {
  beforeEach(() => __resetHasReasonsColumnCache());

  it('lifts attested_model / harness / harness_version beside risk_breakdown and drops context', async () => {
    const { decisions, total } = await listGuardDecisions(fakeSql(), 'org_t', { limit: 10 });
    expect(total).toBe(3);

    const [full, codex, broken] = decisions;
    expect(full.attested_model).toBe('claude-fable-5-1');
    expect(full.harness).toBe('claude-code');
    expect(full.harness_version).toBe('2.1.263');
    expect(full.risk_breakdown).toEqual({ base: 4 });
    expect(full.context).toBeUndefined();

    expect(codex.harness).toBe('codex');
    expect(codex.attested_model).toBeNull();
    expect(codex.harness_version).toBeNull();

    // Malformed stored JSON degrades to nulls, never to a throw or a guess.
    expect(broken.attested_model).toBeNull();
    expect(broken.harness).toBeNull();
    expect(broken.risk_breakdown).toBeNull();
    expect(broken.context).toBeUndefined();
  });

  it('never lifts a non-string value as a model (a spoofed object stays null)', async () => {
    const sql = fakeSql();
    ROWS[0].context = JSON.stringify({ attested_model: { evil: true }, harness: 42 });
    try {
      const { decisions } = await listGuardDecisions(sql, 'org_t', { limit: 10 });
      expect(decisions[0].attested_model).toBeNull();
      expect(decisions[0].harness).toBeNull();
    } finally {
      ROWS[0].context = JSON.stringify({ attested_model: 'claude-fable-5-1', harness: 'claude-code', harness_version: '2.1.263' });
    }
  });
});
