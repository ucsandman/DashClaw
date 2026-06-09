import { describe, expect, it } from 'vitest';
import {
  computeAutoRisk,
  computeComposite,
  evaluateCondition,
  extractRawValue,
  scoreAction,
  scoreDimensionValue,
  seedDefaultData,
} from '@/lib/scoringProfiles';

type SqlRows = Record<string, unknown>[];
type MockSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlRows>;
  json?: (value: unknown) => unknown;
};

// -- evaluateCondition ---------------------------------------------------

describe('evaluateCondition', () => {
  const action = {
    action_type: 'deploy',
    risk_score: 45,
    metadata: {
      environment: 'production',
      modifies_data: true,
      irreversible: false,
      empty: '',
      retries: 4,
      tags: 'critical,urgent',
    },
  };

  it('evaluates == against quoted and unquoted string targets', () => {
    expect(evaluateCondition("metadata.environment == 'production'", action)).toBe(true);
    expect(evaluateCondition('metadata.environment == "production"', action)).toBe(true);
    expect(evaluateCondition('metadata.environment == production', action)).toBe(true);
    expect(evaluateCondition("metadata.environment == 'staging'", action)).toBe(false);
  });

  it('parses boolean targets', () => {
    expect(evaluateCondition('metadata.modifies_data == true', action)).toBe(true);
    expect(evaluateCondition('metadata.irreversible == true', action)).toBe(false);
    expect(evaluateCondition('metadata.irreversible == false', action)).toBe(true);
  });

  it('parses numeric targets and compares == via string coercion', () => {
    expect(evaluateCondition('risk_score == 45', action)).toBe(true);
    expect(evaluateCondition('risk_score == 46', action)).toBe(false);
    expect(evaluateCondition('metadata.retries > 3', action)).toBe(true);
  });

  it('keeps an empty quoted target as the empty string', () => {
    expect(evaluateCondition("metadata.empty == ''", action)).toBe(true);
    expect(evaluateCondition("metadata.environment == ''", action)).toBe(false);
  });

  it('evaluates != operator', () => {
    expect(evaluateCondition("action_type != 'query'", action)).toBe(true);
    expect(evaluateCondition("action_type != 'deploy'", action)).toBe(false);
  });

  it('evaluates >= and <= before > and < (pattern priority)', () => {
    expect(evaluateCondition('risk_score >= 45', action)).toBe(true);
    expect(evaluateCondition('risk_score <= 45', action)).toBe(true);
    expect(evaluateCondition('risk_score > 45', action)).toBe(false);
    expect(evaluateCondition('risk_score < 45', action)).toBe(false);
    expect(evaluateCondition('risk_score > 40', action)).toBe(true);
    expect(evaluateCondition('risk_score < 50', action)).toBe(true);
  });

  it('evaluates contains case-insensitively and strips quotes from the target', () => {
    expect(evaluateCondition('metadata.tags contains CRITICAL', action)).toBe(true);
    expect(evaluateCondition("metadata.tags contains 'urgent'", action)).toBe(true);
    expect(evaluateCondition('metadata.tags contains debug', action)).toBe(false);
  });

  it('resolves nested field paths and missing fields', () => {
    const nested = { metadata: { deploy: { target: 'k8s' } } };
    expect(evaluateCondition("metadata.deploy.target == 'k8s'", nested)).toBe(true);
    expect(evaluateCondition("metadata.nonexistent == 'value'", action)).toBe(false);
    expect(evaluateCondition('metadata.missing.deep > 1', action)).toBe(false);
  });

  it('returns false for non-string, empty, or malformed conditions', () => {
    expect(evaluateCondition(null, action)).toBe(false);
    expect(evaluateCondition(undefined, action)).toBe(false);
    expect(evaluateCondition('', action)).toBe(false);
    expect(evaluateCondition(42, action)).toBe(false);
    expect(evaluateCondition('this is not a condition', action)).toBe(false);
  });
});

// -- extractRawValue -----------------------------------------------------

describe('extractRawValue', () => {
  const dim = (source: string, config: Record<string, unknown> = {}) =>
    ({ data_source: source, data_config: config });

  it('reads top-level fields with metadata fallback', () => {
    expect(extractRawValue({ duration_ms: 4500 }, dim('duration_ms'))).toBe(4500);
    expect(extractRawValue({ metadata: { duration_ms: 3200 } }, dim('duration_ms'))).toBe(3200);
    expect(extractRawValue({ cost_estimate: 0.042 }, dim('cost_estimate'))).toBe(0.042);
    expect(extractRawValue({ metadata: { cost_estimate: 0.01 } }, dim('cost_estimate'))).toBe(0.01);
    expect(extractRawValue({ confidence: 0.92 }, dim('confidence'))).toBe(0.92);
    expect(extractRawValue({ metadata: { confidence: 0.5 } }, dim('confidence'))).toBe(0.5);
    expect(extractRawValue({ eval_score: 88 }, dim('eval_score'))).toBe(88);
    expect(extractRawValue({ metadata: { eval_score: 70 } }, dim('eval_score'))).toBe(70);
  });

  it('reads risk_score without a metadata fallback', () => {
    expect(extractRawValue({ risk_score: 65 }, dim('risk_score'))).toBe(65);
    expect(extractRawValue({ metadata: { risk_score: 65 } }, dim('risk_score'))).toBeNull();
  });

  it('sums tokens_total and falls back to metadata when the sum is zero', () => {
    expect(extractRawValue({ prompt_tokens: 500, completion_tokens: 200 }, dim('tokens_total'))).toBe(700);
    expect(extractRawValue({ prompt_tokens: 0, completion_tokens: 0, metadata: { tokens_total: 123 } }, dim('tokens_total'))).toBe(123);
    expect(extractRawValue({}, dim('tokens_total'))).toBeNull();
  });

  it('resolves metadata_field dot paths', () => {
    const action = { metadata: { result: { latency: 120 } } };
    expect(extractRawValue(action, dim('metadata_field', { field: 'result.latency' }))).toBe(120);
    expect(extractRawValue(action, dim('metadata_field', { field: 'nope.deep' }))).toBeNull();
    expect(extractRawValue(action, dim('metadata_field', {}))).toBeNull();
  });

  it('runs custom_function bodies in a sandbox and returns null on failure', () => {
    const action = { metadata: { errors: 3, warnings: 5 } };
    const ok = dim('custom_function', {
      function_body: 'return (action.metadata.errors || 0) + (action.metadata.warnings || 0);',
    });
    expect(extractRawValue(action, ok)).toBe(8);

    expect(extractRawValue({}, dim('custom_function', { function_body: 'throw new Error("boom");' }))).toBeNull();
    expect(extractRawValue({}, dim('custom_function', { function_body: 'while (true) {}' }))).toBeNull();
    expect(extractRawValue({}, dim('custom_function', {}))).toBeNull();
  });

  it('returns null for unknown or missing data_source', () => {
    expect(extractRawValue({ duration_ms: 1 }, dim('unknown_source'))).toBeNull();
    expect(extractRawValue({ duration_ms: 1 }, {})).toBeNull();
  });
});

// -- scoreDimensionValue -------------------------------------------------

describe('scoreDimensionValue', () => {
  const durationScale = [
    { label: 'excellent', operator: 'lte', value: 2000, score: 100 },
    { label: 'good', operator: 'lte', value: 8000, score: 75 },
    { label: 'acceptable', operator: 'lte', value: 30000, score: 45 },
    { label: 'poor', operator: 'gt', value: 30000, score: 10 },
  ];

  it('returns the first matching rule, inclusive on boundaries', () => {
    expect(scoreDimensionValue(1500, durationScale)).toEqual({ score: 100, label: 'excellent' });
    expect(scoreDimensionValue(2000, durationScale)).toEqual({ score: 100, label: 'excellent' });
    expect(scoreDimensionValue(2001, durationScale)).toEqual({ score: 75, label: 'good' });
    expect(scoreDimensionValue(30000, durationScale)).toEqual({ score: 45, label: 'acceptable' });
    expect(scoreDimensionValue(30001, durationScale)).toEqual({ score: 10, label: 'poor' });
  });

  it('returns no_data for null/undefined and unscaled for a missing or empty scale', () => {
    expect(scoreDimensionValue(null, durationScale)).toEqual({ score: null, label: 'no_data' });
    expect(scoreDimensionValue(undefined, durationScale)).toEqual({ score: null, label: 'no_data' });
    expect(scoreDimensionValue(50, [])).toEqual({ score: 50, label: 'unscaled' });
    expect(scoreDimensionValue(50, undefined)).toEqual({ score: 50, label: 'unscaled' });
  });

  it('handles lt, gt, and gte operators', () => {
    const scale = [
      { label: 'low', operator: 'lt', value: 10, score: 90 },
      { label: 'high', operator: 'gte', value: 100, score: 30 },
      { label: 'over', operator: 'gt', value: 50, score: 60 },
    ];
    expect(scoreDimensionValue(9, scale).label).toBe('low');
    expect(scoreDimensionValue(100, scale).label).toBe('high');
    expect(scoreDimensionValue(51, scale).label).toBe('over');
  });

  it('handles eq via strict or string equality', () => {
    const scale = [{ label: 'exact', operator: 'eq', value: 'success', score: 100 }];
    expect(scoreDimensionValue('success', scale).score).toBe(100);
    const numScale = [{ label: 'five', operator: 'eq', value: 5, score: 80 }];
    expect(scoreDimensionValue(5, numScale).score).toBe(80);
    expect(scoreDimensionValue('5', numScale).score).toBe(80);
  });

  it('handles between (inclusive) and rejects non-array targets', () => {
    const scale = [{ label: 'in_range', operator: 'between', value: [10, 50], score: 80 }];
    expect(scoreDimensionValue(10, scale).score).toBe(80);
    expect(scoreDimensionValue(50, scale).score).toBe(80);
    expect(scoreDimensionValue(5, scale).label).toBe('default');
    const broken = [{ label: 'bad', operator: 'between', value: 10, score: 80 }];
    expect(scoreDimensionValue(20, broken).label).toBe('default');
  });

  it('handles contains case-insensitively for string values only', () => {
    const scale = [{ label: 'has_error', operator: 'contains', value: 'ERROR', score: 10 }];
    expect(scoreDimensionValue('Fatal error occurred', scale).score).toBe(10);
    expect(scoreDimensionValue(12345, scale).label).toBe('default');
  });

  it('falls back to the lowest score in the scale when nothing matches', () => {
    const scale = [
      { label: 'only_low', operator: 'lt', value: 5, score: 90 },
      { label: 'only_mid', operator: 'lt', value: 10, score: 60 },
    ];
    expect(scoreDimensionValue(100, scale)).toEqual({ score: 60, label: 'default' });
    const unknownOp = [{ label: 'weird', operator: 'regex', value: 'x', score: 35 }];
    expect(scoreDimensionValue(5, unknownOp)).toEqual({ score: 35, label: 'default' });
  });
});

// -- computeComposite ----------------------------------------------------

describe('computeComposite', () => {
  const dims = [
    { weight: 0.3, raw_value: 1, score: 100, label: 'a' },
    { weight: 0.4, raw_value: 1, score: 75, label: 'b' },
    { weight: 0.3, raw_value: 1, score: 50, label: 'c' },
  ];

  it('computes weighted_average with weight normalization and 2-decimal rounding', () => {
    expect(computeComposite(dims, 'weighted_average')).toBe(75);
    const mixed = [
      { weight: 0.5, raw_value: 1, score: 80, label: 'a' },
      { weight: 0.3, raw_value: null, score: null, label: 'no_data' },
      { weight: 0.2, raw_value: 1, score: 60, label: 'b' },
    ];
    // (80*0.5 + 60*0.2) / 0.7 = 74.285714... -> 74.29
    expect(computeComposite(mixed, 'weighted_average')).toBe(74.29);
  });

  it('computes minimum and geometric_mean', () => {
    expect(computeComposite(dims, 'minimum')).toBe(50);
    const expected = Math.round(
      Math.pow(100, 0.3) * Math.pow(75, 0.4) * Math.pow(50, 0.3) * 100
    ) / 100;
    expect(computeComposite(dims, 'geometric_mean')).toBe(expected);
    const withZero = [
      { weight: 0.5, raw_value: 1, score: 100, label: 'a' },
      { weight: 0.5, raw_value: 1, score: 0, label: 'b' },
    ];
    expect(computeComposite(withZero, 'geometric_mean')).toBe(0);
  });

  it('returns null for no scored dimensions, zero total weight, or unknown methods', () => {
    expect(computeComposite([], 'weighted_average')).toBeNull();
    expect(computeComposite([{ weight: 0, raw_value: 1, score: 50, label: 'a' }], 'weighted_average')).toBeNull();
    expect(computeComposite(dims, 'unknown_method')).toBeNull();
  });
});

// -- scoreAction -----------------------------------------------------------

describe('scoreAction', () => {
  const profileRow = {
    id: 'sp_test',
    name: 'Test Profile',
    composite_method: 'weighted_average',
    dimensions: [
      {
        id: 'sd_speed', name: 'Speed', weight: 0.6, data_source: 'duration_ms',
        scale: [
          { label: 'fast', operator: 'lte', value: 1000, score: 100 },
          { label: 'slow', operator: 'gt', value: 1000, score: 20 },
        ],
      },
      {
        id: 'sd_risk', name: 'Risk', weight: 0.4, data_source: 'risk_score',
        scale: [
          { label: 'low', operator: 'lte', value: 30, score: 100 },
          { label: 'high', operator: 'gt', value: 30, score: 0 },
        ],
      },
    ],
  };

  function makeSql(row: Record<string, unknown> | null) {
    const inserts: unknown[][] = [];
    const sql: MockSql = async (strings, ...values) => {
      const text = strings.join('?');
      if (text.includes('INSERT INTO profile_scores')) {
        inserts.push(values);
        return [];
      }
      if (text.includes('FROM scoring_profiles sp')) return row ? [row] : [];
      return [];
    };
    return { sql, inserts };
  }

  it('scores all dimensions, computes the composite, and persists the breakdown', async () => {
    const { sql, inserts } = makeSql(profileRow);
    const action = { action_id: 'act_1', agent_id: 'ag_1', action_type: 'deploy', duration_ms: 500, risk_score: 80 };

    const result = await scoreAction(sql, 'org_1', 'sp_test', action);

    expect(result.composite_score).toBe(60); // 100*0.6 + 0*0.4
    expect(result.profile_id).toBe('sp_test');
    expect(result.profile_name).toBe('Test Profile');
    expect(result.action_id).toBe('act_1');
    expect(result.composite_method).toBe('weighted_average');
    expect(result.dimensions).toEqual([
      { dimension_id: 'sd_speed', dimension_name: 'Speed', weight: 0.6, raw_value: 500, score: 100, label: 'fast' },
      { dimension_id: 'sd_risk', dimension_name: 'Risk', weight: 0.4, raw_value: 80, score: 0, label: 'high' },
    ]);

    expect(inserts).toHaveLength(1);
    const values = inserts[0]!;
    expect(values[1]).toBe('org_1');
    expect(values[2]).toBe('sp_test');
    expect(values[3]).toBe('act_1');
    expect(values[4]).toBe('ag_1');
    expect(values[5]).toBe(60);
    expect(JSON.parse(String(values[6]))).toEqual(result.dimensions);
    expect(JSON.parse(String(values[7]))).toEqual({ profile_name: 'Test Profile', action_type: 'deploy' });
  });

  it('falls back to action.id then null for action_id and flags seed actions in metadata', async () => {
    const { sql, inserts } = makeSql(profileRow);
    const result = await scoreAction(sql, 'org_1', 'sp_test', { id: 'row_9', duration_ms: 1, risk_score: 1, is_seed: true });
    expect(result.action_id).toBe('row_9');
    expect(JSON.parse(String(inserts[0]![7]))).toEqual({ profile_name: 'Test Profile', action_type: null, is_seed: true });
  });

  it('throws for a missing profile, a profile without dimensions, and no scoreable data', async () => {
    await expect(scoreAction(makeSql(null).sql, 'org_1', 'sp_x', {})).rejects.toThrow('Profile sp_x not found');
    await expect(
      scoreAction(makeSql({ id: 'sp_e', name: 'Empty', dimensions: null }).sql, 'org_1', 'sp_e', {})
    ).rejects.toThrow('Profile has no dimensions');
    await expect(scoreAction(makeSql(profileRow).sql, 'org_1', 'sp_test', {})).rejects.toThrow(/composite score/);
  });
});

// -- computeAutoRisk -------------------------------------------------------

describe('computeAutoRisk', () => {
  const templates = [
    {
      id: 'rt_all', name: 'All', action_type: null, base_risk: 10, status: 'active',
      rules: [{ condition: "metadata.environment == 'production'", add: 30 }],
    },
    {
      id: 'rt_deploy', name: 'Deploy', action_type: 'deploy', base_risk: 20, status: 'active',
      rules: [
        { condition: 'risk_score > 50', add: 25 },
        { condition: 'metadata.irreversible == true', add: 60 },
      ],
    },
    { id: 'rt_off', name: 'Off', action_type: 'deploy', base_risk: 99, status: 'archived', rules: [] },
  ];

  it('returns null when no active template matches', () => {
    expect(computeAutoRisk({ action_type: 'api_call' }, [])).toBeNull();
    expect(computeAutoRisk({ action_type: 'api_call' }, [templates[2]!])).toBeNull();
  });

  it('prefers an exact action_type match over the wildcard template', () => {
    expect(computeAutoRisk({ action_type: 'deploy', risk_score: 60 }, templates)).toBe(45); // 20 + 25
    expect(computeAutoRisk({ action_type: 'query' }, templates)).toBe(10); // wildcard base only
  });

  it('adds matched rule weights and clamps the result to [0, 100]', () => {
    const action = { action_type: 'deploy', risk_score: 60, metadata: { irreversible: true } };
    expect(computeAutoRisk(action, templates)).toBe(100); // 20 + 25 + 60 clamped
    expect(computeAutoRisk({ action_type: 'x' }, [{ action_type: null, base_risk: -5, status: 'active', rules: [] }])).toBe(0);
  });

  it('treats missing base_risk/rules and malformed conditions as no-ops', () => {
    expect(computeAutoRisk({ action_type: 'x' }, [{ action_type: null, status: 'active' }])).toBe(0);
    const malformed = [{
      action_type: null, base_risk: 7, status: 'active',
      rules: [{ condition: 12345 as unknown as string, add: 50 }, { condition: 'not a condition', add: 50 }],
    }];
    expect(computeAutoRisk({ action_type: 'x' }, malformed)).toBe(7);
  });
});

// -- seedDefaultData -------------------------------------------------------

describe('seedDefaultData', () => {
  type DimensionRow = {
    id: unknown; profile_id: unknown; name: unknown; weight: unknown;
    data_source: unknown; scale: unknown; scale_json: string; sort_order: unknown;
  };

  function inMemorySql() {
    const templates: Record<string, unknown>[] = [];
    const profiles: Record<string, unknown>[] = [];
    const dimensions: DimensionRow[] = [];
    const scores: unknown[][] = [];

    const withDimensions = (profile: Record<string, unknown>) => ({
      ...profile,
      dimensions: dimensions.filter((d) => d.profile_id === profile.id),
    });

    const sql: MockSql = async (strings, ...values) => {
      const text = strings.join('?');
      if (text.includes('INSERT INTO risk_templates')) {
        templates.push({ id: values[0], name: values[2], action_type: values[4], base_risk: values[5] });
        return [];
      }
      if (text.includes('FROM risk_templates')) return templates;
      if (text.includes('INSERT INTO scoring_profiles')) {
        profiles.push({ id: values[0], name: values[2], composite_method: values[5] });
        return [];
      }
      if (text.includes('INSERT INTO scoring_dimensions')) {
        dimensions.push({
          id: values[0], profile_id: values[2], name: values[3], weight: values[5],
          data_source: values[6], scale: JSON.parse(String(values[8])),
          scale_json: String(values[8]), sort_order: values[9],
        });
        return [];
      }
      if (text.includes('UPDATE scoring_profiles')) return [];
      if (text.includes('AS count FROM profile_scores')) {
        return [{ count: scores.filter((s) => s[2] === values[1]).length }];
      }
      if (text.includes('INSERT INTO profile_scores')) {
        scores.push(values);
        return [];
      }
      if (text.includes('WHERE sp.id')) {
        const profile = profiles.find((p) => p.id === values[0]);
        return profile ? [withDimensions(profile)] : [];
      }
      if (text.includes('FROM scoring_profiles sp')) return profiles.map(withDimensions);
      throw new Error(`Unhandled query: ${text}`);
    };

    return { sql, templates, profiles, dimensions, scores };
  }

  it('seeds the default templates, profiles, dimensions, and sample scores for a fresh org', async () => {
    const db = inMemorySql();
    await seedDefaultData(db.sql, 'org_test');

    expect(db.templates.map((t) => t.name)).toEqual(['Production Safety', 'External API Safety']);
    expect(db.templates.map((t) => t.base_risk)).toEqual([15, 10]);

    expect(db.profiles.map((p) => p.name)).toEqual(['General Action Quality', 'Strict Safety Profile']);
    expect(db.profiles.map((p) => p.composite_method)).toEqual(['weighted_average', 'minimum']);

    expect(db.dimensions.map((d) => [d.name, d.data_source, d.weight, d.sort_order])).toEqual([
      ['Risk Control', 'risk_score', 0.35, 0],
      ['Confidence', 'confidence', 0.3, 1],
      ['Speed', 'duration_ms', 0.2, 2],
      ['Cost Efficiency', 'cost_estimate', 0.15, 3],
      ['Risk Gate', 'risk_score', 1, 0],
      ['Confidence Gate', 'confidence', 1, 1],
    ]);

    // Byte-exact persisted scale for the first dimension (locks key order too).
    expect(db.dimensions[0]!.scale_json).toBe(
      '[{"label":"excellent","operator":"lte","value":20,"score":100},'
      + '{"label":"good","operator":"lte","value":40,"score":75},'
      + '{"label":"acceptable","operator":"lte","value":65,"score":45},'
      + '{"label":"poor","operator":"gt","value":65,"score":10}]'
    );

    // Exact composite scores characterize the seed scales + sample actions end-to-end.
    expect(db.scores.map((s) => s[5])).toEqual([100, 64.5, 32.75, 96.25, 91.25]);
    expect(JSON.parse(String(db.scores[0]![7]))).toMatchObject({
      profile_name: 'General Action Quality',
      action_type: 'api_call',
      is_seed: true,
    });
  });

  it('is idempotent — a second run inserts nothing new', async () => {
    const db = inMemorySql();
    await seedDefaultData(db.sql, 'org_test');
    await seedDefaultData(db.sql, 'org_test');

    expect(db.templates).toHaveLength(2);
    expect(db.profiles).toHaveLength(2);
    expect(db.dimensions).toHaveLength(6);
    expect(db.scores).toHaveLength(5);
  });
});
