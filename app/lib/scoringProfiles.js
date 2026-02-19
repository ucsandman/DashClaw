/**
 * Scoring Profiles Engine (Phase 7)
 *
 * Weighted multi-dimensional scoring with user-defined quality profiles,
 * automatic risk templates, and statistical auto-calibration.
 *
 * Zero LLM dependencies  --  all scoring is rule-based math.
 */

import crypto from 'crypto';

// --- ID Generation ----------------------------------------

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

// --- Profile CRUD -----------------------------------------

export async function createProfile(sql, orgId, data) {
  const id = generateId('sp');
  const {
    name, description = '', action_type = null,
    composite_method = 'weighted_average', metadata = {},
  } = data;

  await sql`
    INSERT INTO scoring_profiles (id, org_id, name, description, action_type, composite_method, metadata)
    VALUES (${id}, ${orgId}, ${name}, ${description}, ${action_type}, ${composite_method}, ${JSON.stringify(metadata)})
  `;

  return { id, name, description, action_type, composite_method, metadata, status: 'active' };
}

export async function listProfiles(sql, orgId, filters = {}) {
  const { action_type, status = 'active', limit = 50, offset = 0 } = filters;

  if (action_type) {
    return sql`
      SELECT sp.*, (
        SELECT json_agg(sd ORDER BY sd.sort_order)
        FROM scoring_dimensions sd WHERE sd.profile_id = sp.id
      ) AS dimensions
      FROM scoring_profiles sp
      WHERE sp.org_id = ${orgId} AND sp.status = ${status}
        AND (sp.action_type = ${action_type} OR sp.action_type IS NULL)
      ORDER BY sp.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sql`
    SELECT sp.*, (
      SELECT json_agg(sd ORDER BY sd.sort_order)
      FROM scoring_dimensions sd WHERE sd.profile_id = sp.id
    ) AS dimensions
    FROM scoring_profiles sp
    WHERE sp.org_id = ${orgId} AND sp.status = ${status}
    ORDER BY sp.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function getProfile(sql, orgId, profileId) {
  const [profile] = await sql`
    SELECT sp.*, (
      SELECT json_agg(sd ORDER BY sd.sort_order)
      FROM scoring_dimensions sd WHERE sd.profile_id = sp.id
    ) AS dimensions
    FROM scoring_profiles sp
    WHERE sp.id = ${profileId} AND sp.org_id = ${orgId}
  `;
  return profile || null;
}

export async function updateProfile(sql, orgId, profileId, updates) {
  const allowed = ['name', 'description', 'action_type', 'composite_method', 'status', 'metadata'];
  const fields = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields[key] = key === 'metadata' ? JSON.stringify(updates[key]) : updates[key];
    }
  }
  if (Object.keys(fields).length === 0) return null;

  fields.updated_at = new Date().toISOString();

  const setClauses = Object.entries(fields)
    .map(([k]) => k)
    .join(', ');

  // Build dynamic update
  const [updated] = await sql`
    UPDATE scoring_profiles
    SET name = COALESCE(${fields.name ?? null}, name),
        description = COALESCE(${fields.description ?? null}, description),
        action_type = ${fields.action_type !== undefined ? fields.action_type : null},
        composite_method = COALESCE(${fields.composite_method ?? null}, composite_method),
        status = COALESCE(${fields.status ?? null}, status),
        metadata = COALESCE(${fields.metadata ? sql.json(JSON.parse(fields.metadata)) : null}, metadata),
        updated_at = now()
    WHERE id = ${profileId} AND org_id = ${orgId}
    RETURNING *
  `;
  return updated || null;
}

export async function deleteProfile(sql, orgId, profileId) {
  const [deleted] = await sql`
    DELETE FROM scoring_profiles WHERE id = ${profileId} AND org_id = ${orgId} RETURNING id
  `;
  return !!deleted;
}

// --- Dimension CRUD ---------------------------------------

export async function addDimension(sql, orgId, profileId, data) {
  const id = generateId('sd');
  const {
    name, description = '', weight = 1.0,
    data_source, data_config = {}, scale = [], sort_order = 0,
  } = data;

  await sql`
    INSERT INTO scoring_dimensions (id, org_id, profile_id, name, description, weight, data_source, data_config, scale, sort_order)
    VALUES (${id}, ${orgId}, ${profileId}, ${name}, ${description}, ${weight}, ${data_source}, ${JSON.stringify(data_config)}, ${JSON.stringify(scale)}, ${sort_order})
  `;

  // Touch parent profile
  await sql`UPDATE scoring_profiles SET updated_at = now() WHERE id = ${profileId}`;

  return { id, profile_id: profileId, name, description, weight, data_source, data_config, scale, sort_order };
}

export async function updateDimension(sql, orgId, dimensionId, updates) {
  const [updated] = await sql`
    UPDATE scoring_dimensions
    SET name = COALESCE(${updates.name ?? null}, name),
        description = COALESCE(${updates.description ?? null}, description),
        weight = COALESCE(${updates.weight ?? null}, weight),
        data_source = COALESCE(${updates.data_source ?? null}, data_source),
        data_config = COALESCE(${updates.data_config ? JSON.stringify(updates.data_config) : null}::jsonb, data_config),
        scale = COALESCE(${updates.scale ? JSON.stringify(updates.scale) : null}::jsonb, scale),
        sort_order = COALESCE(${updates.sort_order ?? null}, sort_order)
    WHERE id = ${dimensionId} AND org_id = ${orgId}
    RETURNING *
  `;
  if (updated) {
    await sql`UPDATE scoring_profiles SET updated_at = now() WHERE id = ${updated.profile_id}`;
  }
  return updated || null;
}

export async function deleteDimension(sql, orgId, dimensionId) {
  const [deleted] = await sql`
    DELETE FROM scoring_dimensions WHERE id = ${dimensionId} AND org_id = ${orgId} RETURNING profile_id
  `;
  if (deleted) {
    await sql`UPDATE scoring_profiles SET updated_at = now() WHERE id = ${deleted.profile_id}`;
  }
  return !!deleted;
}

// --- Score Computation Engine -----------------------------

/**
 * Extract a raw value from an action record based on a dimension's data_source.
 */
function extractRawValue(action, dimension) {
  switch (dimension.data_source) {
    case 'duration_ms':
      return action.duration_ms ?? action.metadata?.duration_ms ?? null;
    case 'cost_estimate':
      return action.cost_estimate ?? action.metadata?.cost_estimate ?? null;
    case 'tokens_total': {
      const sum = (action.prompt_tokens ?? 0) + (action.completion_tokens ?? 0);
      return sum || (action.metadata?.tokens_total ?? null);
    }
    case 'risk_score':
      return action.risk_score ?? null;
    case 'confidence':
      return action.confidence ?? action.metadata?.confidence ?? null;
    case 'eval_score':
      return action.eval_score ?? action.metadata?.eval_score ?? null;
    case 'metadata_field': {
      const field = dimension.data_config?.field;
      if (!field) return null;
      // Support nested paths like "result.latency"
      return field.split('.').reduce((obj, key) => obj?.[key], action.metadata ?? {}) ?? null;
    }
    case 'custom_function': {
      const fn = dimension.data_config?.function_body;
      if (!fn) return null;
      try {
        const func = new Function('action', fn);
        return func(action);
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

/**
 * Score a raw value against a dimension's scale.
 * Scale is an array of { label, operator, value, score } sorted by priority.
 *
 * Operators: lt, lte, gt, gte, eq, between, contains
 * Score: 0-100 (maps to the quality level)
 *
 * Example scale:
 * [
 *   { label: "excellent", operator: "lt", value: 30000, score: 100 },
 *   { label: "good", operator: "lt", value: 60000, score: 75 },
 *   { label: "acceptable", operator: "lt", value: 120000, score: 50 },
 *   { label: "poor", operator: "gte", value: 120000, score: 20 },
 * ]
 */
function scoreDimensionValue(rawValue, scale) {
  if (rawValue === null || rawValue === undefined) return { score: null, label: 'no_data' };
  if (!Array.isArray(scale) || scale.length === 0) return { score: 50, label: 'unscaled' };

  for (const rule of scale) {
    let matched = false;
    const val = typeof rawValue === 'string' ? rawValue : Number(rawValue);
    const target = rule.value;

    switch (rule.operator) {
      case 'lt': matched = val < target; break;
      case 'lte': matched = val <= target; break;
      case 'gt': matched = val > target; break;
      case 'gte': matched = val >= target; break;
      case 'eq': matched = val === target || String(val) === String(target); break;
      case 'between': matched = val >= target[0] && val <= target[1]; break;
      case 'contains':
        matched = typeof val === 'string' && val.toLowerCase().includes(String(target).toLowerCase());
        break;
      default: matched = false;
    }

    if (matched) {
      return { score: rule.score, label: rule.label || 'matched' };
    }
  }

  // No rule matched  --  default to lowest score in scale
  const lowestScore = Math.min(...scale.map(r => r.score));
  return { score: lowestScore, label: 'default' };
}

/**
 * Compute composite score from dimension scores using the profile's method.
 */
function computeComposite(dimensionResults, method) {
  const scored = dimensionResults.filter(d => d.score !== null);
  if (scored.length === 0) return null;

  // Normalize weights to sum to 1
  const totalWeight = scored.reduce((sum, d) => sum + d.weight, 0);

  switch (method) {
    case 'weighted_average': {
      if (totalWeight === 0) return null;
      const sum = scored.reduce((acc, d) => acc + (d.score * d.weight / totalWeight), 0);
      return Math.round(sum * 100) / 100;
    }
    case 'minimum':
      return Math.min(...scored.map(d => d.score));
    case 'geometric_mean': {
      if (scored.some(d => d.score === 0)) return 0;
      const product = scored.reduce((acc, d) => acc * Math.pow(d.score, d.weight / totalWeight), 1);
      return Math.round(product * 100) / 100;
    }
    default:
      return null;
  }
}

/**
 * Score an action against a profile. Returns composite + per-dimension breakdown.
 */
export async function scoreAction(sql, orgId, profileId, action) {
  const profile = await getProfile(sql, orgId, profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  const dimensions = profile.dimensions || [];
  if (dimensions.length === 0) throw new Error('Profile has no dimensions');

  const dimensionResults = dimensions.map(dim => {
    const rawValue = extractRawValue(action, dim);
    const { score, label } = scoreDimensionValue(rawValue, dim.scale);
    return {
      dimension_id: dim.id,
      dimension_name: dim.name,
      weight: dim.weight,
      raw_value: rawValue,
      score,
      label,
    };
  });

  const compositeScore = computeComposite(dimensionResults, profile.composite_method);
  if (compositeScore === null) throw new Error('Could not compute composite score  --  no dimensions had data');

  // Persist the score
  const id = generateId('ps');
  await sql`
    INSERT INTO profile_scores (id, org_id, profile_id, action_id, agent_id, composite_score, dimension_scores, metadata)
    VALUES (
      ${id}, ${orgId}, ${profileId},
      ${action.action_id || action.id || null},
      ${action.agent_id || null},
      ${compositeScore},
      ${JSON.stringify(dimensionResults)},
      ${JSON.stringify({ profile_name: profile.name, action_type: action.action_type || null })}
    )
  `;

  return {
    id,
    profile_id: profileId,
    profile_name: profile.name,
    action_id: action.action_id || action.id || null,
    composite_score: compositeScore,
    composite_method: profile.composite_method,
    dimensions: dimensionResults,
  };
}

/**
 * Batch score multiple actions against a profile.
 */
export async function batchScoreActions(sql, orgId, profileId, actions) {
  const results = [];
  for (const action of actions) {
    try {
      const result = await scoreAction(sql, orgId, profileId, action);
      results.push(result);
    } catch (err) {
      results.push({ action_id: action.action_id || action.id, error: err.message });
    }
  }

  const scored = results.filter(r => !r.error);
  const avgScore = scored.length > 0
    ? Math.round((scored.reduce((s, r) => s + r.composite_score, 0) / scored.length) * 100) / 100
    : null;

  return { results, summary: { total: actions.length, scored: scored.length, avg_score: avgScore } };
}

// --- Profile Score Queries --------------------------------

export async function listProfileScores(sql, orgId, filters = {}) {
  const { profile_id, agent_id, action_id, limit = 50, offset = 0 } = filters;

  return sql`
    SELECT ps.*, sp.name AS profile_name
    FROM profile_scores ps
    JOIN scoring_profiles sp ON sp.id = ps.profile_id
    WHERE ps.org_id = ${orgId}
      ${profile_id ? sql`AND ps.profile_id = ${profile_id}` : sql``}
      ${agent_id ? sql`AND ps.agent_id = ${agent_id}` : sql``}
      ${action_id ? sql`AND ps.action_id = ${action_id}` : sql``}
    ORDER BY ps.scored_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export async function getProfileScoreStats(sql, orgId, profileId) {
  const [stats] = await sql`
    SELECT
      COUNT(*)::int AS total_scores,
      ROUND(AVG(composite_score)::numeric, 2)::float AS avg_score,
      ROUND(MIN(composite_score)::numeric, 2)::float AS min_score,
      ROUND(MAX(composite_score)::numeric, 2)::float AS max_score,
      ROUND(STDDEV(composite_score)::numeric, 2)::float AS stddev_score,
      COUNT(DISTINCT agent_id)::int AS unique_agents,
      COUNT(DISTINCT action_id)::int AS unique_actions
    FROM profile_scores
    WHERE org_id = ${orgId} AND profile_id = ${profileId}
  `;
  return stats;
}

// --- Risk Templates ---------------------------------------

/**
 * Risk template rules format:
 * [
 *   { condition: "metadata.environment == 'production'", add: 20 },
 *   { condition: "metadata.modifies_data == true", add: 15 },
 *   { condition: "metadata.irreversible == true", add: 25 },
 *   { condition: "action_type == 'delete'", add: 30 },
 * ]
 */

export async function createRiskTemplate(sql, orgId, data) {
  const id = generateId('rt');
  const { name, description = '', action_type = null, base_risk = 0, rules = [] } = data;

  await sql`
    INSERT INTO risk_templates (id, org_id, name, description, action_type, base_risk, rules)
    VALUES (${id}, ${orgId}, ${name}, ${description}, ${action_type}, ${base_risk}, ${JSON.stringify(rules)})
  `;

  return { id, name, description, action_type, base_risk, rules, status: 'active' };
}

export async function listRiskTemplates(sql, orgId, filters = {}) {
  const { action_type, status = 'active' } = filters;

  if (action_type) {
    return sql`
      SELECT * FROM risk_templates
      WHERE org_id = ${orgId} AND status = ${status}
        AND (action_type = ${action_type} OR action_type IS NULL)
      ORDER BY updated_at DESC
    `;
  }

  return sql`
    SELECT * FROM risk_templates
    WHERE org_id = ${orgId} AND status = ${status}
    ORDER BY updated_at DESC
  `;
}

export async function updateRiskTemplate(sql, orgId, templateId, updates) {
  const [updated] = await sql`
    UPDATE risk_templates
    SET name = COALESCE(${updates.name ?? null}, name),
        description = COALESCE(${updates.description ?? null}, description),
        action_type = ${updates.action_type !== undefined ? updates.action_type : null},
        base_risk = COALESCE(${updates.base_risk ?? null}, base_risk),
        rules = COALESCE(${updates.rules ? JSON.stringify(updates.rules) : null}::jsonb, rules),
        status = COALESCE(${updates.status ?? null}, status),
        updated_at = now()
    WHERE id = ${templateId} AND org_id = ${orgId}
    RETURNING *
  `;
  return updated || null;
}

export async function deleteRiskTemplate(sql, orgId, templateId) {
  const [deleted] = await sql`
    DELETE FROM risk_templates WHERE id = ${templateId} AND org_id = ${orgId} RETURNING id
  `;
  return !!deleted;
}

/**
 * Compute automatic risk score for an action using matching risk templates.
 */
export function computeAutoRisk(action, templates) {
  // Find matching templates (by action_type or null = matches all)
  const matching = templates.filter(t =>
    t.status === 'active' && (!t.action_type || t.action_type === action.action_type)
  );

  if (matching.length === 0) return null;

  // Use the most specific match (action_type match beats null)
  const template = matching.find(t => t.action_type === action.action_type) || matching[0];

  let risk = template.base_risk;

  for (const rule of (template.rules || [])) {
    try {
      // Simple expression evaluator for conditions
      const matched = evaluateCondition(rule.condition, action);
      if (matched) {
        risk += rule.add || 0;
      }
    } catch {
      // Skip malformed rules
    }
  }

  return Math.max(0, Math.min(100, risk));
}

/**
 * Simple safe condition evaluator. Supports:
 * - "field == value"
 * - "field != value"
 * - "field > value"
 * - "field >= value"
 * - "field < value"
 * - "field <= value"
 * - "field contains value"
 */
function evaluateCondition(condition, action) {
  if (!condition || typeof condition !== 'string') return false;

  const patterns = [
    { regex: /^(.+?)\s*==\s*(.+)$/, fn: (a, b) => String(a) === String(b) },
    { regex: /^(.+?)\s*!=\s*(.+)$/, fn: (a, b) => String(a) !== String(b) },
    { regex: /^(.+?)\s*>=\s*(.+)$/, fn: (a, b) => Number(a) >= Number(b) },
    { regex: /^(.+?)\s*<=\s*(.+)$/, fn: (a, b) => Number(a) <= Number(b) },
    { regex: /^(.+?)\s*>\s*(.+)$/, fn: (a, b) => Number(a) > Number(b) },
    { regex: /^(.+?)\s*<\s*(.+)$/, fn: (a, b) => Number(a) < Number(b) },
    { regex: /^(.+?)\s+contains\s+(.+)$/i, fn: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase().replace(/['"]/g, '')) },
  ];

  for (const { regex, fn } of patterns) {
    const match = condition.match(regex);
    if (match) {
      const fieldPath = match[1].trim();
      let targetValue = match[2].trim().replace(/^['"]|['"]$/g, '');

      // Resolve field value from action
      const fieldValue = fieldPath.split('.').reduce((obj, key) => obj?.[key], action);

      // Parse target  --  handle booleans and numbers
      if (targetValue === 'true') targetValue = true;
      else if (targetValue === 'false') targetValue = false;
      else if (targetValue === 'null') targetValue = null;
      else if (!isNaN(targetValue) && targetValue !== '') targetValue = Number(targetValue);

      return fn(fieldValue, targetValue);
    }
  }

  return false;
}

// --- Auto-Calibration Engine ------------------------------

/**
 * Analyze historical action data and suggest dimension thresholds.
 * Uses percentile analysis  --  no LLM needed.
 *
 * Returns suggested scales based on actual data distribution:
 * - excellent: top 10% (p90+)
 * - good: top 25% (p75-p90)
 * - acceptable: middle 50% (p25-p75)
 * - poor: bottom 25% (<p25)
 */
export async function autoCalibrate(sql, orgId, options = {}) {
  const {
    action_type = null,
    agent_id = null,
    lookback_days = 30,
    metrics = ['duration_ms', 'cost_estimate', 'tokens_total', 'risk_score', 'confidence'],
  } = options;

  const cutoff = new Date(Date.now() - lookback_days * 86400000).toISOString();

  // Fetch historical data
  const actions = await sql`
    SELECT action_type, risk_score, confidence, duration_ms, cost_estimate,
           prompt_tokens, completion_tokens, metadata
    FROM action_records
    WHERE org_id = ${orgId}
      AND created_at >= ${cutoff}
      ${action_type ? sql`AND action_type = ${action_type}` : sql``}
      ${agent_id ? sql`AND agent_id = ${agent_id}` : sql``}
    ORDER BY created_at DESC
    LIMIT 10000
  `;

  if (actions.length < 10) {
    return {
      status: 'insufficient_data',
      message: `Need at least 10 actions, found ${actions.length}`,
      count: actions.length,
      suggestions: [],
    };
  }

  const suggestions = [];

  for (const metric of metrics) {
    const values = actions
      .map(a => {
        switch (metric) {
          case 'duration_ms': return a.duration_ms;
          case 'cost_estimate': return a.cost_estimate;
          case 'tokens_total': return (a.prompt_tokens || 0) + (a.completion_tokens || 0);
          case 'risk_score': return a.risk_score;
          case 'confidence': return a.confidence;
          default: return null;
        }
      })
      .filter(v => v !== null && v !== undefined && !isNaN(v))
      .sort((a, b) => a - b);

    if (values.length < 5) continue;

    const percentile = (p) => {
      const idx = Math.floor(values.length * p);
      return values[Math.min(idx, values.length - 1)];
    };

    const p10 = percentile(0.10);
    const p25 = percentile(0.25);
    const p50 = percentile(0.50);
    const p75 = percentile(0.75);
    const p90 = percentile(0.90);

    // For "lower is better" metrics (duration, cost, tokens, risk)
    const lowerIsBetter = ['duration_ms', 'cost_estimate', 'tokens_total', 'risk_score'].includes(metric);

    let scale;
    if (lowerIsBetter) {
      scale = [
        { label: 'excellent', operator: 'lte', value: Math.round(p25 * 100) / 100, score: 100 },
        { label: 'good', operator: 'lte', value: Math.round(p50 * 100) / 100, score: 75 },
        { label: 'acceptable', operator: 'lte', value: Math.round(p75 * 100) / 100, score: 50 },
        { label: 'poor', operator: 'gt', value: Math.round(p75 * 100) / 100, score: 20 },
      ];
    } else {
      // For "higher is better" metrics (confidence)
      scale = [
        { label: 'excellent', operator: 'gte', value: Math.round(p75 * 100) / 100, score: 100 },
        { label: 'good', operator: 'gte', value: Math.round(p50 * 100) / 100, score: 75 },
        { label: 'acceptable', operator: 'gte', value: Math.round(p25 * 100) / 100, score: 50 },
        { label: 'poor', operator: 'lt', value: Math.round(p25 * 100) / 100, score: 20 },
      ];
    }

    suggestions.push({
      metric,
      data_source: metric,
      lower_is_better: lowerIsBetter,
      sample_size: values.length,
      distribution: { p10, p25, p50, p75, p90, min: values[0], max: values[values.length - 1] },
      suggested_scale: scale,
      suggested_weight: getDefaultWeight(metric),
    });
  }

  return {
    status: 'ok',
    count: actions.length,
    action_type: action_type || '(all)',
    lookback_days,
    suggestions,
  };
}

function getDefaultWeight(metric) {
  const weights = {
    duration_ms: 0.2,
    cost_estimate: 0.2,
    tokens_total: 0.1,
    risk_score: 0.3,
    confidence: 0.2,
  };
  return weights[metric] || 0.15;
}

// --- Exports ----------------------------------------------

export { extractRawValue, scoreDimensionValue, computeComposite, evaluateCondition };
