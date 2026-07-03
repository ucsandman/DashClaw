// Calibration proposals human surface (roadmap v2.6b) — repository tests.
// Spec: docs/superpowers/specs/2026-07-02-calibration-proposals-human-surface-design.md
import { describe, it, expect, vi } from 'vitest';
import {
  loadDecisionEventsForOrg,
  loadUploadedSampleEventsForOrg,
  getProposalDecisions,
  upsertProposalDecision,
  deleteProposalDecision,
  markProposalForged,
} from '../../app/lib/repositories/calibration.repository';

function mockSql(rows) {
  const fn = vi.fn(async () => rows);
  fn.query = vi.fn(async () => rows);
  return fn;
}

/** sql.query resolves each call with the next entry of `sequence`. */
function mockSqlSequence(sequence) {
  const fn = vi.fn();
  let i = 0;
  fn.query = vi.fn(async () => sequence[Math.min(i++, sequence.length - 1)]);
  return fn;
}

describe('loadDecisionEventsForOrg', () => {
  it('org-scopes the query and normalizes rows to events', async () => {
    const sql = mockSql([
      {
        id: 'gd_1',
        agent_id: 'codex',
        action_id: 'act_9',
        risk_score: 55,
        decision: 'require_approval',
        approved: true,
        denied: false,
        outcome_status: 'completed',
        bash_intent: null,
        action_type: 'code.edit',
        declared_goal: null,
        context_goal: 'edit file',
        risk_breakdown: { base: 40 },
      },
    ]);
    const { events, truncated } = await loadDecisionEventsForOrg(sql, 'org1', 30);
    expect(truncated).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'gd_1',
      origin: 'decision',
      approved: true,
      denied: false,
      declared_goal: 'edit file', // context_goal fallback
      action_id: 'act_9',
    });
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain('gd.org_id = $1');
    expect(text).toContain('guard_decisions');
    // created_at is TEXT on fresh drizzle schemas — the cast is what keeps
    // this query alive on CI/self-host Postgres (42883 without it).
    expect(text).toContain('gd.created_at::timestamptz >');
    expect(sql.query.mock.calls[0][1]).toEqual(['org1', 30, 20000]);
  });

  it('reports truncation when the row count hits the limit', async () => {
    const rows = [{ id: 'gd_1' }, { id: 'gd_2' }];
    const sql = mockSql(rows);
    const { truncated } = await loadDecisionEventsForOrg(sql, 'org1', 30, 2);
    expect(truncated).toBe(true);
  });
});

describe('loadUploadedSampleEventsForOrg', () => {
  it('org-scopes and maps sample rows', async () => {
    const sql = mockSql([
      {
        event_id: 'ev_1',
        agent_id: 'claude-code',
        risk_score: 20,
        guard_decision: 'allow',
        outcome_status: 'completed',
        bash_intent: 'readonly',
        action_type: 'bash.command',
        command_shape: 'git status',
      },
    ]);
    const events = await loadUploadedSampleEventsForOrg(sql, 'org1', 30);
    expect(events[0]).toMatchObject({
      id: 'ev_1',
      origin: 'sample',
      decision: 'allow',
      command_shape: 'git status',
      approved: false,
    });
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain('org_id = $1');
    expect(text).toContain('behavior_samples');
    expect(text).toContain('ts::timestamptz >');
    expect(sql.query.mock.calls[0][1]).toEqual(['org1', 30, 20000]);
  });
});

describe('upsertProposalDecision', () => {
  it('upserts on (org_id, proposal_id) and clears forge state on re-decision', async () => {
    const row = { id: 1, proposal_id: 'cv_0123456789abcdef', decision: 'ratified' };
    const sql = mockSql([row]);
    const out = await upsertProposalDecision(sql, 'org1', {
      proposalId: 'cv_0123456789abcdef',
      rule: 'over_scored_benign',
      decision: 'ratified',
      suggestedLabel: 'benign',
      suggestedName: 'git-status',
      provenance: 'mined 2026-07-02 (window 30d): over_scored_benign cv_0123456789abcdef, 3 event(s), tier human_approved',
      ratifyCommand: 'npm run calibration:add -- --action act_9 --label benign --name git-status --source "x"',
      representative: { action_type: 'bash.command' },
      reason: null,
      decidedBy: 'user_1',
    });
    expect(out).toEqual(row);
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain('ON CONFLICT (org_id, proposal_id) DO UPDATE');
    expect(text).toContain('forged_at = NULL');
    expect(text).toContain('vector_name = NULL');
    expect(sql.query.mock.calls[0][1][0]).toBe('org1');
  });
});

describe('getProposalDecisions', () => {
  it('returns all rows for the org, newest first', async () => {
    const sql = mockSql([{ proposal_id: 'cv_a' }, { proposal_id: 'cv_b' }]);
    const rows = await getProposalDecisions(sql, 'org1');
    expect(rows).toHaveLength(2);
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain('org_id = $1');
    expect(text).toContain('ORDER BY decided_at DESC');
  });
});

describe('deleteProposalDecision', () => {
  it('returns true when a row was deleted', async () => {
    const sql = mockSql([{ id: 1 }]);
    expect(await deleteProposalDecision(sql, 'org1', 'cv_0123456789abcdef')).toBe(true);
  });
  it('returns false when nothing matched', async () => {
    const sql = mockSql([]);
    expect(await deleteProposalDecision(sql, 'org1', 'cv_0123456789abcdef')).toBe(false);
  });
});

describe('markProposalForged', () => {
  it("returns 'ok' and stamps forged_at + vector_name on a ratified row", async () => {
    const sql = mockSql([{ id: 1 }]);
    const res = await markProposalForged(sql, 'org1', 'cv_0123456789abcdef', 'git-status');
    expect(res).toBe('ok');
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain("decision = 'ratified'");
    expect(text).toContain('forged_at = now()');
    expect(sql.query.mock.calls[0][1]).toEqual(['org1', 'cv_0123456789abcdef', 'git-status']);
  });

  it("returns 'not_found' when no decision row exists", async () => {
    const sql = mockSqlSequence([[], []]);
    expect(await markProposalForged(sql, 'org1', 'cv_0123456789abcdef', 'x')).toBe('not_found');
  });

  it("returns 'not_ratified' when the row exists but is dismissed", async () => {
    const sql = mockSqlSequence([[], [{ decision: 'dismissed' }]]);
    expect(await markProposalForged(sql, 'org1', 'cv_0123456789abcdef', 'x')).toBe('not_ratified');
  });
});
