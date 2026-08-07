import { describe, it, expect } from 'vitest';
import {
  normalizeGoal,
  shapeKey,
  candidateId,
  benignEvidence,
  dangerEvidence,
  mineOverScoredBenign,
  mineUnderScoredDanger,
  mineRepeatedApprovals,
  suggestBounds,
  buildVectorEntry,
  serializeVectorEntry,
  appendVectorToFixtureText,
  isSyntheticEvent,
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
  suggestVectorName,
  buildProposals,
  renderProposalSummary,
} from '../../scripts/lib/calibration-mining.mjs';
import { RISK_MEDIUM_MIN } from '@/lib/riskThresholds.js';

const event = (overrides = {}) => ({
  id: 'act_gd_1',
  origin: 'decision',
  risk_score: null,
  decision: null,
  approved: false,
  denied: false,
  outcome_status: null,
  bash_intent: null,
  action_type: 'review',
  declared_goal: 'Bash: git show --stat HEAD',
  command_shape: null,
  risk_breakdown: null,
  ...overrides,
});

describe('shape keys', () => {
  it('prefers command_shape when present', () => {
    expect(shapeKey(event({ command_shape: 'git show *' }))).toBe('git show *');
  });

  it('normalizes ids and digits so identical shapes collide', () => {
    const a = event({ declared_goal: 'Deploy release 4.22 to production' });
    const b = event({ declared_goal: 'Deploy release 4.23 to production' });
    expect(shapeKey(a)).toBe(shapeKey(b));
  });

  it('normalizeGoal strips hashes', () => {
    expect(normalizeGoal('git show dfeac026a11')).toBe('git show #');
  });

  it('candidateId is deterministic and cv_-prefixed', () => {
    expect(candidateId('r1', 'k')).toBe(candidateId('r1', 'k'));
    expect(candidateId('r1', 'k')).toMatch(/^cv_[0-9a-f]{16}$/);
    expect(candidateId('r1', 'k')).not.toBe(candidateId('r2', 'k'));
  });
});

describe('evidence tiers', () => {
  it('benign: approval outranks everything; block disqualifies completion', () => {
    expect(benignEvidence(event({ approved: true }))).toBe('human_approved');
    expect(benignEvidence(event({ outcome_status: 'completed' }))).toBe('completed_success');
    expect(benignEvidence(event({ outcome_status: 'completed', decision: 'block' }))).toBe(null);
    expect(benignEvidence(event({ bash_intent: 'readonly' }))).toBe('readonly_intent');
    expect(benignEvidence(event())).toBe(null);
  });

  it('danger: denial, block, destructive intent', () => {
    expect(dangerEvidence(event({ denied: true }))).toBe('human_denied');
    expect(dangerEvidence(event({ decision: 'block' }))).toBe('blocked');
    expect(dangerEvidence(event({ bash_intent: 'destructive' }))).toBe('destructive_intent');
    expect(dangerEvidence(event())).toBe(null);
  });
});

describe('R1 over-scored benign', () => {
  it('fires on an approved interruption at/above the band', () => {
    const out = mineOverScoredBenign([event({ approved: true, risk_score: RISK_MEDIUM_MIN })]);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe('over_scored_benign');
    expect(out[0].suggested_label).toBe('benign');
    expect(out[0].evidence_tier).toBe('human_approved');
  });

  it('stays quiet below the band and without benign evidence', () => {
    expect(mineOverScoredBenign([event({ approved: true, risk_score: RISK_MEDIUM_MIN - 1 })])).toHaveLength(0);
    expect(mineOverScoredBenign([event({ risk_score: 90 })])).toHaveLength(0);
    expect(mineOverScoredBenign([event({ approved: true, risk_score: null })])).toHaveLength(0);
  });

  it('groups identical shapes and caps evidence at 10', () => {
    const events = Array.from({ length: 12 }, (_, i) =>
      event({ id: `act_gd_${i}`, approved: true, risk_score: 55 }),
    );
    const out = mineOverScoredBenign(events);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(12);
    expect(out[0].event_ids).toHaveLength(10);
    expect(out[0].truncated_events).toBe(2);
  });

  it('prefers a representative carrying a risk_breakdown', () => {
    const out = mineOverScoredBenign([
      event({ id: 'a', approved: true, risk_score: 55 }),
      event({ id: 'b', approved: true, risk_score: 55, risk_breakdown: { final: 55 } }),
    ]);
    expect(out[0].representative.id).toBe('b');
  });
});

describe('R2 under-scored danger', () => {
  it('fires on denied / destructive-intent events below the band', () => {
    expect(mineUnderScoredDanger([event({ denied: true, risk_score: 10 })])).toHaveLength(1);
    const out = mineUnderScoredDanger([event({ bash_intent: 'destructive', risk_score: 20 })]);
    expect(out).toHaveLength(1);
    expect(out[0].suggested_label).toBe('risky');
  });

  it('stays quiet at/above the band or without danger evidence', () => {
    expect(mineUnderScoredDanger([event({ denied: true, risk_score: 80 })])).toHaveLength(0);
    expect(mineUnderScoredDanger([event({ outcome_status: 'completed', risk_score: 10 })])).toHaveLength(0);
  });
});

describe('R3 repeated approvals', () => {
  it('fires at minCount identical approved shapes', () => {
    const events = [1, 2, 3].map((i) => event({ id: `a${i}`, approved: true, risk_score: 20 }));
    const out = mineRepeatedApprovals(events);
    expect(out).toHaveLength(1);
    expect(out[0].rule).toBe('repeated_approvals');
    expect(out[0].count).toBe(3);
  });

  it('stays quiet below minCount or across different shapes', () => {
    const two = [1, 2].map((i) => event({ id: `a${i}`, approved: true }));
    expect(mineRepeatedApprovals(two)).toHaveLength(0);
    const different = [1, 2, 3].map((i) =>
      event({ id: `a${i}`, approved: true, declared_goal: `unrelated goal variant ${'x'.repeat(i)}` }),
    );
    expect(mineRepeatedApprovals(different)).toHaveLength(0);
  });
});

describe('suggestBounds', () => {
  it('benign score inside band: round up to 5 plus headroom', () => {
    expect(suggestBounds('benign', { clientScore: 5 })).toEqual({
      requires_model_fix: false,
      client_expected: { max_risk: 10 },
    });
    expect(suggestBounds('benign', { serverScore: 12 }).server_expected).toEqual({ max_risk: 20 });
  });

  it('benign score contradicting the label: band edge + model fix', () => {
    const out = suggestBounds('benign', { serverScore: 55 });
    expect(out.server_expected).toEqual({ max_risk: RISK_MEDIUM_MIN - 1 });
    expect(out.requires_model_fix).toBe(true);
  });

  it('risky score at/above band: round down minus headroom, floored at band', () => {
    expect(suggestBounds('risky', { clientScore: 82 }).client_expected).toEqual({ min_risk: 75 });
    expect(suggestBounds('risky', { clientScore: 42 }).client_expected).toEqual({ min_risk: RISK_MEDIUM_MIN });
  });

  it('risky score contradicting the label: band edge + model fix', () => {
    const out = suggestBounds('risky', { clientScore: 15 });
    expect(out.client_expected).toEqual({ min_risk: RISK_MEDIUM_MIN });
    expect(out.requires_model_fix).toBe(true);
  });
});

describe('synthetic-traffic filter (v2.6)', () => {
  it('fires on every synthetic agent family', () => {
    for (const agent_id of [
      'smoke-ping-mcgz1x2a', // policy-smoke agentFor()
      'ci-smoke', // up-smoke.yml
      'sdk-live-test-agent-py', // sdk-live.yml
      'demo-e2e-verifier', // verify-demo-e2e.mjs
      'test', // dev suites
      'test-guard-agent',
      'loadtest-mr6y5eev', // guard-load.mjs (v4.1)
      'bench-agent-bench_mr9e9luj', // scripts/bench-guard-hotpath.mjs
      'guide-capture-agent', // scripts/regen-platform-guide-examples.mjs
      'analytics-agent', // homepage LiveDemo presets (real rows under session auth)
      'openai-deployer-1',
      'rogue-agent',
    ]) {
      expect(isSyntheticEvent(event({ agent_id }))).toBe(true);
    }
  });

  it('fires on smoke.*/loadtest.*/liveproof.* action types regardless of agent', () => {
    expect(isSyntheticEvent(event({ agent_id: 'claude-code', action_type: 'smoke.risky' }))).toBe(true);
    expect(isSyntheticEvent(event({ agent_id: 'claude-code', action_type: 'loadtest.read' }))).toBe(true);
    expect(isSyntheticEvent(event({ agent_id: 'claude-code', action_type: 'liveproof.drift' }))).toBe(true);
  });

  it('stays quiet on real traffic, including near-miss names', () => {
    for (const agent_id of [
      'claude-code',
      'codex',
      'hermes',
      'codex:test-writer', // composed subagent identity — parent is real
      'latest-deployer', // contains "test" but not as a prefix family
      'smokey', // not the smoke- family
      null,
    ]) {
      expect(isSyntheticEvent(event({ agent_id }))).toBe(false);
    }
    expect(isSyntheticEvent(event({ agent_id: 'claude-code', action_type: 'deploy' }))).toBe(false);
  });
});

describe('SQL LIKE mirror of the synthetic filter (v3.1)', () => {
  // Minimal SQL LIKE semantics: % = any run of chars, anchored both ends.
  const likeMatch = (pattern, s) =>
    new RegExp(`^${pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(s);

  it('SYNTHETIC_AGENT_LIKE_PATTERNS agrees with SYNTHETIC_AGENT_RE on every family and near-miss', () => {
    const corpus = [
      // positives (one per family)
      'smoke-ping-mcgz1x2a', 'ci-smoke', 'sdk-live-test-agent-py', 'demo-e2e-verifier', 'test', 'test-guard-agent',
      'loadtest-mr6y5eev', 'bench-agent-bench_mr9e9luj', 'guide-capture-agent', 'analytics-agent', 'openai-deployer-1', 'rogue-agent',
      // negatives / near-misses
      'claude-code', 'codex', 'hermes', 'codex:test-writer', 'latest-deployer', 'smokey',
      'ci-smoke-extra', 'demo-e2e-verifier-2', 'guide-capture-agent-2', 'testing', 'attest', 'loadtester', 'payload-test',
      'analytics-agent-2', 'rogue-agents', 'openai-deployer-11',
    ];
    for (const agent_id of corpus) {
      const viaSql = SYNTHETIC_AGENT_LIKE_PATTERNS.some((p) => likeMatch(p, agent_id));
      const viaRe = isSyntheticEvent(event({ agent_id }));
      expect(viaSql, `pattern/regex drift on "${agent_id}"`).toBe(viaRe);
    }
  });

  it('SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS agrees with the JS prefix rule (v4.1 families)', () => {
    const viaSql = (t) => SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS.some((p) => likeMatch(p, t));
    for (const [actionType, expected] of [
      ['smoke.risky', true],
      ['smoke.retro.drift.mr4bbqfo', true],
      ['loadtest.read', true],
      ['liveproof.base', true],
      ['liveproof.drift', true],
      ['deploy', false],
      ['smokeless', false],
      ['loadtest', false], // bare name without the dot is not the family
      ['liveproofing', false],
    ]) {
      expect(viaSql(actionType), `LIKE verdict on "${actionType}"`).toBe(expected);
      // and the JS-side isSyntheticEvent agrees with the SQL verdict
      expect(
        isSyntheticEvent(event({ agent_id: 'claude-code', action_type: actionType })),
        `regex/LIKE drift on "${actionType}"`,
      ).toBe(expected);
    }
  });
});

describe('proposal mode (v2.6)', () => {
  const opts = { windowDays: 30, generatedAt: '2026-07-02T06:00:00.000Z' };

  it('suggestVectorName derives kebab-case from the Bash goal', () => {
    expect(suggestVectorName(event({ declared_goal: 'Bash: git show --stat HEAD' }), 'r1')).toBe(
      'git-show-stat-head',
    );
    expect(suggestVectorName({ action_type: 'deploy' }, 'r1')).toBe('deploy');
    expect(suggestVectorName({}, 'over_scored_benign')).toBe('over-scored-benign');
    // Unkebabable shape falls back to a rule-derived name.
    expect(suggestVectorName({ declared_goal: '!!!' }, 'over_scored_benign')).toBe(
      'over-scored-benign-candidate',
    );
  });

  it('uses the --action forge path when the representative has a linked action', () => {
    const candidates = mineOverScoredBenign([
      event({ approved: true, risk_score: 55, action_id: 'ar_abc123' }),
    ]);
    const [p] = buildProposals({ over_scored_benign: candidates }, opts);
    expect(p.ratify_command).toContain('--action ar_abc123');
    expect(p.ratify_command).toContain('--label benign');
    expect(p.provenance).toContain('mined 2026-07-02 (window 30d): over_scored_benign');
    expect(p.needs_manual_context).toBe(false);
  });

  it('falls back to --command from a Bash goal, quoted', () => {
    const candidates = mineUnderScoredDanger([
      event({ denied: true, risk_score: 10, declared_goal: 'Bash: rm -rf "build dir"' }),
    ]);
    const [p] = buildProposals({ under_scored_danger: candidates }, opts);
    expect(p.ratify_command).toContain('--command "rm -rf \\"build dir\\""');
    expect(p.suggested_label).toBe('risky');
  });

  it('marks unreconstructible candidates as needing manual context', () => {
    const candidates = mineOverScoredBenign([
      event({
        approved: true,
        risk_score: 55,
        declared_goal: 'apply a config change',
        command_shape: 'sed -i * *',
        origin: 'sample',
      }),
    ]);
    const [p] = buildProposals({ over_scored_benign: candidates }, opts);
    expect(p.ratify_command).toBe(null);
    expect(p.needs_manual_context).toBe(true);
  });

  it('caps proposals at topPerRule (strongest first) and reports the cut in the summary', () => {
    const candidates = mineOverScoredBenign([
      ...[1, 2, 3].map((i) => event({ id: `a${i}`, approved: true, risk_score: 55 })),
      event({ id: 'b1', approved: true, risk_score: 55, declared_goal: 'another shape entirely' }),
    ]);
    expect(candidates).toHaveLength(2);
    const proposals = buildProposals({ over_scored_benign: candidates }, { ...opts, topPerRule: 1 });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].count).toBe(3); // the strongest survived the cap
    const md = renderProposalSummary({
      generated_at: opts.generatedAt,
      window_days: 30,
      inputs: {},
      candidates: { over_scored_benign: candidates },
      proposals,
    });
    expect(md).toContain('top 1 of 2 candidates');
    // --top 0 lifts the cap.
    expect(buildProposals({ over_scored_benign: candidates }, { ...opts, topPerRule: 0 })).toHaveLength(2);
  });

  it('renderProposalSummary shows exclusion counts and per-rule tables', () => {
    const candidates = mineOverScoredBenign([
      event({ approved: true, risk_score: 55, action_id: 'ar_abc123' }),
    ]);
    const report = {
      generated_at: '2026-07-02T06:00:00.000Z',
      window_days: 30,
      inputs: { decisions: 100, local_samples: 0, uploaded_samples: 40, synthetic_excluded: 25 },
      proposals: buildProposals({ over_scored_benign: candidates }, opts),
    };
    const md = renderProposalSummary(report);
    expect(md).toContain('synthetic excluded: 25');
    expect(md).toContain('## over_scored_benign — 1 proposal(s) (label: benign)');
    expect(md).toContain('--action ar_abc123');
    expect(md).toContain('Nothing auto-applies');
  });

  it('renders an honest empty state', () => {
    const md = renderProposalSummary({
      generated_at: '2026-07-02T06:00:00.000Z',
      window_days: 30,
      inputs: { decisions: 0, local_samples: 0, uploaded_samples: 0, synthetic_excluded: 0 },
      proposals: [],
    });
    expect(md).toContain('No candidates in this window.');
  });
});

describe('vector entries and fixture append', () => {
  const fixtureText = `{
  "_comment": ["test"],
  "vectors": [
    {
      "name": "existing-vector",
      "label": "benign",
      "source": "seed",
      "bash_command": "git status",
      "client_expected": { "intent": "readonly", "max_risk": 10 }
    }
  ]
}
`;

  it('buildVectorEntry validates name, label, source, and layer coverage', () => {
    expect(() => buildVectorEntry({ name: 'Bad Name', label: 'benign', source: 's', bash_command: 'x' })).toThrow(/kebab-case/);
    expect(() => buildVectorEntry({ name: 'ok', label: 'meh', source: 's', bash_command: 'x' })).toThrow(/benign\|risky/);
    expect(() => buildVectorEntry({ name: 'ok', label: 'benign', source: '', bash_command: 'x' })).toThrow(/source/);
    expect(() => buildVectorEntry({ name: 'ok', label: 'benign', source: 's' })).toThrow(/at least one layer/);
  });

  it('serializes in the fixture style (inline nested objects)', () => {
    const entry = buildVectorEntry({
      name: 'npm-ci',
      label: 'benign',
      source: 'mined 2026-07-02',
      bash_command: 'npm ci',
      client_expected: { intent: 'package_management', max_risk: 30 },
    });
    const text = serializeVectorEntry(entry);
    expect(text).toContain('"client_expected": { "intent": "package_management", "max_risk": 30 }');
    expect(text.startsWith('    {')).toBe(true);
    expect(text.endsWith('    }')).toBe(true);
  });

  it('appends preserving format and refuses duplicates', () => {
    const entry = buildVectorEntry({
      name: 'npm-ci',
      label: 'benign',
      source: 'mined 2026-07-02',
      bash_command: 'npm ci',
      client_expected: { intent: 'package_management', max_risk: 30 },
    });
    const updated = appendVectorToFixtureText(fixtureText, entry);
    const parsed = JSON.parse(updated);
    expect(parsed.vectors).toHaveLength(2);
    expect(parsed.vectors[1].name).toBe('npm-ci');
    // Original bytes untouched before the append point.
    expect(updated.startsWith(fixtureText.slice(0, fixtureText.indexOf('\n  ]')))).toBe(true);
    expect(() => appendVectorToFixtureText(updated, entry)).toThrow(/already exists/);
  });
});
