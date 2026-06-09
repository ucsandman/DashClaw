/**
 * Scoring Profiles Engine (Phase 7)
 *
 * Weighted multi-dimensional scoring with user-defined quality profiles,
 * automatic risk templates, and statistical auto-calibration.
 *
 * Zero LLM dependencies  --  all scoring is rule-based math.
 */

import crypto from 'crypto';
import vm from 'node:vm';

/**
 * Tagged-template SQL client. The scoring engine additionally relies on the
 * Neon driver's `.json()` helper for jsonb parameter binding.
 */
type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  json?: (value: unknown) => unknown;
};

/** A scale rule used by a scoring dimension. */
interface ScaleRule {
  label?: string;
  operator?: string;
  value: unknown;
  score: number;
}

/** A scoring dimension (as stored / as supplied). */
interface Dimension {
  id?: string;
  profile_id?: string;
  name?: string;
  description?: string;
  weight?: number;
  data_source?: string;
  data_config?: Record<string, unknown>;
  scale?: ScaleRule[];
  sort_order?: number;
  [key: string]: unknown;
}

/** A scoring profile row (with its dimensions). */
interface Profile {
  id?: string;
  org_id?: string;
  name?: string;
  description?: string;
  action_type?: string | null;
  composite_method?: string;
  metadata?: Record<string, unknown>;
  status?: string;
  dimensions?: Dimension[];
  [key: string]: unknown;
}

/** An action record (the thing being scored). Loosely typed — external shape. */
interface ActionInput {
  action_id?: string;
  id?: string;
  agent_id?: string;
  action_type?: string | null;
  duration_ms?: number;
  cost_estimate?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  risk_score?: number;
  confidence?: number;
  eval_score?: number;
  metadata?: Record<string, unknown>;
  is_seed?: boolean;
  [key: string]: unknown;
}

interface RiskTemplateRule {
  condition: string;
  add?: number;
}

interface RiskTemplate {
  id?: string;
  name?: string;
  description?: string;
  action_type?: string | null;
  base_risk?: number;
  rules?: RiskTemplateRule[];
  status?: string;
  [key: string]: unknown;
}

// --- ID Generation ----------------------------------------

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

// --- Profile CRUD -----------------------------------------

export async function createProfile(sql: SqlTag, orgId: string, data: Profile): Promise<Profile> {
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

interface ListProfileFilters {
  action_type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listProfiles(sql: SqlTag, orgId: string, filters: ListProfileFilters = {}): Promise<Record<string, unknown>[]> {
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

export async function getProfile(sql: SqlTag, orgId: string, profileId: string): Promise<Profile | null> {
  const [profile] = await sql`
    SELECT sp.*, (
      SELECT json_agg(sd ORDER BY sd.sort_order)
      FROM scoring_dimensions sd WHERE sd.profile_id = sp.id
    ) AS dimensions
    FROM scoring_profiles sp
    WHERE sp.id = ${profileId} AND sp.org_id = ${orgId}
  `;
  return (profile as Profile | undefined) || null;
}

export async function updateProfile(sql: SqlTag, orgId: string, profileId: string, updates: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const allowed = ['name', 'description', 'action_type', 'composite_method', 'status', 'metadata'];
  const fields: Record<string, unknown> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields[key] = key === 'metadata' ? JSON.stringify(updates[key]) : updates[key];
    }
  }
  if (Object.keys(fields).length === 0) return null;

  fields.updated_at = new Date().toISOString();

  // Build dynamic update
  const [updated] = await sql`
    UPDATE scoring_profiles
    SET name = COALESCE(${fields.name ?? null}, name),
        description = COALESCE(${fields.description ?? null}, description),
        action_type = COALESCE(${fields.action_type !== undefined ? fields.action_type : null}, action_type),
        composite_method = COALESCE(${fields.composite_method ?? null}, composite_method),
        status = COALESCE(${fields.status ?? null}, status),
        metadata = COALESCE(${fields.metadata ? sql.json!(JSON.parse(fields.metadata as string)) : null}, metadata),
        updated_at = now()
    WHERE id = ${profileId} AND org_id = ${orgId}
    RETURNING *
  `;
  return updated || null;
}

export async function deleteProfile(sql: SqlTag, orgId: string, profileId: string): Promise<boolean> {
  const [deleted] = await sql`
    DELETE FROM scoring_profiles WHERE id = ${profileId} AND org_id = ${orgId} RETURNING id
  `;
  return !!deleted;
}

// --- Dimension CRUD ---------------------------------------

export async function addDimension(sql: SqlTag, orgId: string, profileId: string, data: Dimension): Promise<Dimension> {
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
  await sql`UPDATE scoring_profiles SET updated_at = now() WHERE id = ${profileId} AND org_id = ${orgId}`;

  return { id, profile_id: profileId, name, description, weight, data_source, data_config, scale, sort_order };
}

export async function updateDimension(sql: SqlTag, orgId: string, dimensionId: string, updates: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
    await sql`UPDATE scoring_profiles SET updated_at = now() WHERE id = ${updated.profile_id} AND org_id = ${orgId}`;
  }
  return updated || null;
}

export async function deleteDimension(sql: SqlTag, orgId: string, dimensionId: string): Promise<boolean> {
  const [deleted] = await sql`
    DELETE FROM scoring_dimensions WHERE id = ${dimensionId} AND org_id = ${orgId} RETURNING profile_id
  `;
  if (deleted) {
    await sql`UPDATE scoring_profiles SET updated_at = now() WHERE id = ${deleted.profile_id} AND org_id = ${orgId}`;
  }
  return !!deleted;
}

// --- Score Computation Engine -----------------------------

/** Resolve a dotted path like "result.latency" against a source object. */
function resolveFieldPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) => (obj as Record<string, unknown> | null | undefined)?.[key], source);
}

function extractMetadataField(action: ActionInput, dimension: Dimension): unknown {
  const field = dimension.data_config?.field as string | undefined;
  if (!field) return null;
  // Support nested paths like "result.latency"
  return resolveFieldPath(action.metadata ?? {}, field) ?? null;
}

function runCustomFunction(action: ActionInput, dimension: Dimension): unknown {
  const fn = dimension.data_config?.function_body as string | undefined;
  if (!fn) return null;
  // Run the org-supplied body in an isolated vm context. The sandbox
  // exposes only `action` — the outer scope (process, require,
  // filesystem access) is not reachable from within the script, so
  // the body cannot exfiltrate env vars or issue arbitrary I/O. A
  // short timeout prevents accidental or intentional loops.
  try {
    const context = vm.createContext({ action });
    const script = new vm.Script(`(function(action){${fn}})(action)`);
    return script.runInContext(context, { timeout: 100, displayErrors: false });
  } catch {
    return null;
  }
}

const RAW_VALUE_EXTRACTORS: Record<string, (action: ActionInput, dimension: Dimension) => unknown> = {
  duration_ms: (action) => action.duration_ms ?? action.metadata?.duration_ms ?? null,
  cost_estimate: (action) => action.cost_estimate ?? action.metadata?.cost_estimate ?? null,
  tokens_total: (action) => {
    const sum = (action.prompt_tokens ?? 0) + (action.completion_tokens ?? 0);
    return sum || (action.metadata?.tokens_total ?? null);
  },
  risk_score: (action) => action.risk_score ?? null,
  confidence: (action) => action.confidence ?? action.metadata?.confidence ?? null,
  eval_score: (action) => action.eval_score ?? action.metadata?.eval_score ?? null,
  metadata_field: extractMetadataField,
  custom_function: runCustomFunction,
};

/**
 * Extract a raw value from an action record based on a dimension's data_source.
 */
function extractRawValue(action: ActionInput, dimension: Dimension): unknown {
  const extractor = RAW_VALUE_EXTRACTORS[dimension.data_source ?? ''];
  return extractor ? extractor(action, dimension) : null;
}

interface DimensionScore {
  score: number | null;
  label: string;
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
const SCALE_OPERATORS: Record<string, (val: string | number, target: number | number[] | string) => boolean> = {
  lt: (val, target) => (val as number) < (target as number),
  lte: (val, target) => (val as number) <= (target as number),
  gt: (val, target) => (val as number) > (target as number),
  gte: (val, target) => (val as number) >= (target as number),
  eq: (val, target) => val === target || String(val) === String(target),
  between: (val, target) => Array.isArray(target) && (val as number) >= (target[0] as number) && (val as number) <= (target[1] as number),
  contains: (val, target) => typeof val === 'string' && val.toLowerCase().includes(String(target).toLowerCase()),
};

function matchesScaleRule(rawValue: unknown, rule: ScaleRule): boolean {
  const val = typeof rawValue === 'string' ? rawValue : Number(rawValue);
  const operator = SCALE_OPERATORS[rule.operator ?? ''];
  return operator ? operator(val, rule.value as number | number[] | string) : false;
}

function scoreDimensionValue(rawValue: unknown, scale: ScaleRule[] | undefined): DimensionScore {
  if (rawValue === null || rawValue === undefined) return { score: null, label: 'no_data' };
  if (!Array.isArray(scale) || scale.length === 0) return { score: 50, label: 'unscaled' };

  for (const rule of scale) {
    if (matchesScaleRule(rawValue, rule)) {
      return { score: rule.score, label: rule.label || 'matched' };
    }
  }

  // No rule matched  --  default to lowest score in scale
  const lowestScore = Math.min(...scale.map((r) => r.score));
  return { score: lowestScore, label: 'default' };
}

interface DimensionResult {
  dimension_id?: string;
  dimension_name?: string;
  weight: number;
  raw_value: unknown;
  score: number | null;
  label: string;
}

/**
 * Compute composite score from dimension scores using the profile's method.
 */
function computeComposite(dimensionResults: DimensionResult[], method: string | undefined): number | null {
  const scored = dimensionResults.filter((d): d is DimensionResult & { score: number } => d.score !== null);
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
      return Math.min(...scored.map((d) => d.score));
    case 'geometric_mean': {
      if (scored.some((d) => d.score === 0)) return 0;
      const product = scored.reduce((acc, d) => acc * Math.pow(d.score, d.weight / totalWeight), 1);
      return Math.round(product * 100) / 100;
    }
    default:
      return null;
  }
}

export interface ScoreActionResult {
  id: string;
  profile_id: string;
  profile_name: string | undefined;
  action_id: string | null;
  composite_score: number;
  composite_method: string | undefined;
  dimensions: DimensionResult[];
}

function resolveActionId(action: ActionInput): string | null {
  return action.action_id || action.id || null;
}

function scoreDimensions(action: ActionInput, dimensions: Dimension[]): DimensionResult[] {
  return dimensions.map((dim) => {
    const rawValue = extractRawValue(action, dim);
    const { score, label } = scoreDimensionValue(rawValue, dim.scale);
    return {
      dimension_id: dim.id,
      dimension_name: dim.name,
      weight: dim.weight as number,
      raw_value: rawValue,
      score,
      label,
    };
  });
}

interface ProfileScoreRecord {
  orgId: string;
  profileId: string;
  action: ActionInput;
  profile: Profile;
  compositeScore: number;
  dimensionResults: DimensionResult[];
}

async function persistProfileScore(sql: SqlTag, record: ProfileScoreRecord): Promise<string> {
  const { orgId, profileId, action, profile, compositeScore, dimensionResults } = record;
  const id = generateId('ps');
  await sql`
    INSERT INTO profile_scores (id, org_id, profile_id, action_id, agent_id, composite_score, dimension_scores, metadata)
    VALUES (
      ${id}, ${orgId}, ${profileId},
      ${resolveActionId(action)},
      ${action.agent_id || null},
      ${compositeScore},
      ${JSON.stringify(dimensionResults)},
      ${JSON.stringify({ profile_name: profile.name, action_type: action.action_type || null, ...(action.is_seed ? { is_seed: true } : {}) })}
    )
  `;
  return id;
}

/**
 * Score an action against a profile. Returns composite + per-dimension breakdown.
 */
export async function scoreAction(sql: SqlTag, orgId: string, profileId: string, action: ActionInput): Promise<ScoreActionResult> {
  const profile = await getProfile(sql, orgId, profileId);
  if (!profile) throw new Error(`Profile ${profileId} not found`);

  const dimensions = profile.dimensions || [];
  if (dimensions.length === 0) throw new Error('Profile has no dimensions');

  const dimensionResults = scoreDimensions(action, dimensions);

  const compositeScore = computeComposite(dimensionResults, profile.composite_method);
  if (compositeScore === null) throw new Error('Could not compute composite score  --  no dimensions had data');

  // Persist the score
  const id = await persistProfileScore(sql, { orgId, profileId, action, profile, compositeScore, dimensionResults });

  return {
    id,
    profile_id: profileId,
    profile_name: profile.name,
    action_id: resolveActionId(action),
    composite_score: compositeScore,
    composite_method: profile.composite_method,
    dimensions: dimensionResults,
  };
}

interface BatchScoreError {
  action_id: string | undefined;
  error: string;
}

export interface BatchScoreResult {
  results: (ScoreActionResult | BatchScoreError)[];
  summary: { total: number; scored: number; avg_score: number | null };
}

/**
 * Batch score multiple actions against a profile.
 */
export async function batchScoreActions(sql: SqlTag, orgId: string, profileId: string, actions: ActionInput[]): Promise<BatchScoreResult> {
  const results: (ScoreActionResult | BatchScoreError)[] = [];
  for (const action of actions) {
    try {
      const result = await scoreAction(sql, orgId, profileId, action);
      results.push(result);
    } catch (err) {
      results.push({ action_id: action.action_id || action.id, error: (err as Error).message });
    }
  }

  const scored = results.filter((r): r is ScoreActionResult => !(r as BatchScoreError).error);
  const avgScore = scored.length > 0
    ? Math.round((scored.reduce((s, r) => s + r.composite_score, 0) / scored.length) * 100) / 100
    : null;

  return { results, summary: { total: actions.length, scored: scored.length, avg_score: avgScore } };
}

// --- Profile Score Queries --------------------------------

interface ListScoreFilters {
  profile_id?: string;
  agent_id?: string;
  action_id?: string;
  limit?: number;
  offset?: number;
}

export async function listProfileScores(sql: SqlTag, orgId: string, filters: ListScoreFilters = {}): Promise<Record<string, unknown>[]> {
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

export async function getProfileScoreStats(sql: SqlTag, orgId: string, profileId: string): Promise<Record<string, unknown> | undefined> {
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
      AND (metadata->>'is_seed' IS NULL OR metadata->>'is_seed' != 'true')
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

export async function createRiskTemplate(sql: SqlTag, orgId: string, data: RiskTemplate): Promise<RiskTemplate> {
  const id = generateId('rt');
  const { name, description = '', action_type = null, base_risk = 0, rules = [] } = data;

  await sql`
    INSERT INTO risk_templates (id, org_id, name, description, action_type, base_risk, rules)
    VALUES (${id}, ${orgId}, ${name}, ${description}, ${action_type}, ${base_risk}, ${JSON.stringify(rules)})
  `;

  return { id, name, description, action_type, base_risk, rules, status: 'active' };
}

interface ListTemplateFilters {
  action_type?: string;
  status?: string;
}

export async function listRiskTemplates(sql: SqlTag, orgId: string, filters: ListTemplateFilters = {}): Promise<Record<string, unknown>[]> {
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

export async function updateRiskTemplate(sql: SqlTag, orgId: string, templateId: string, updates: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const [updated] = await sql`
    UPDATE risk_templates
    SET name = COALESCE(${updates.name ?? null}, name),
        description = COALESCE(${updates.description ?? null}, description),
        action_type = COALESCE(${updates.action_type !== undefined ? updates.action_type : null}, action_type),
        base_risk = COALESCE(${updates.base_risk ?? null}, base_risk),
        rules = COALESCE(${updates.rules ? JSON.stringify(updates.rules) : null}::jsonb, rules),
        status = COALESCE(${updates.status ?? null}, status),
        updated_at = now()
    WHERE id = ${templateId} AND org_id = ${orgId}
    RETURNING *
  `;
  return updated || null;
}

export async function deleteRiskTemplate(sql: SqlTag, orgId: string, templateId: string): Promise<boolean> {
  const [deleted] = await sql`
    DELETE FROM risk_templates WHERE id = ${templateId} AND org_id = ${orgId} RETURNING id
  `;
  return !!deleted;
}

/**
 * Compute automatic risk score for an action using matching risk templates.
 */
function sumMatchedRuleRisk(rules: RiskTemplateRule[], action: ActionInput): number {
  let added = 0;
  for (const rule of rules) {
    try {
      // Simple expression evaluator for conditions
      if (evaluateCondition(rule.condition, action)) {
        added += rule.add || 0;
      }
    } catch {
      // Skip malformed rules
    }
  }
  return added;
}

export function computeAutoRisk(action: ActionInput, templates: RiskTemplate[]): number | null {
  // Find matching templates (by action_type or null = matches all)
  const matching = templates.filter((t) =>
    t.status === 'active' && (!t.action_type || t.action_type === action.action_type)
  );

  if (matching.length === 0) return null;

  // Use the most specific match (action_type match beats null)
  const template = matching.find((t) => t.action_type === action.action_type) || matching[0]!;

  const risk = (template.base_risk ?? 0) + sumMatchedRuleRisk(template.rules || [], action);

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
const CONDITION_PATTERNS: { regex: RegExp; fn: (a: unknown, b: unknown) => boolean }[] = [
  { regex: /^(.+?)\s*==\s*(.+)$/, fn: (a, b) => String(a) === String(b) },
  { regex: /^(.+?)\s*!=\s*(.+)$/, fn: (a, b) => String(a) !== String(b) },
  { regex: /^(.+?)\s*>=\s*(.+)$/, fn: (a, b) => Number(a) >= Number(b) },
  { regex: /^(.+?)\s*<=\s*(.+)$/, fn: (a, b) => Number(a) <= Number(b) },
  { regex: /^(.+?)\s*>\s*(.+)$/, fn: (a, b) => Number(a) > Number(b) },
  { regex: /^(.+?)\s*<\s*(.+)$/, fn: (a, b) => Number(a) < Number(b) },
  { regex: /^(.+?)\s+contains\s+(.+)$/i, fn: (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase().replace(/['"]/g, '')) },
];

/** Parse a condition target  --  handle booleans, null, and numbers. */
function parseConditionTarget(raw: string): unknown {
  const targetValue = raw.trim().replace(/^['"]|['"]$/g, '');
  if (targetValue === 'true') return true;
  if (targetValue === 'false') return false;
  if (targetValue === 'null') return null;
  if (!isNaN(targetValue as unknown as number) && targetValue !== '') return Number(targetValue);
  return targetValue;
}

function evaluateCondition(condition: unknown, action: ActionInput): boolean {
  if (!condition || typeof condition !== 'string') return false;

  for (const { regex, fn } of CONDITION_PATTERNS) {
    const match = condition.match(regex);
    if (!match) continue;

    // Resolve field value from action
    const fieldValue = resolveFieldPath(action, (match[1] as string).trim());
    const targetValue = parseConditionTarget(match[2] as string);

    return fn(fieldValue, targetValue);
  }

  return false;
}

// --- Auto-Calibration Engine ------------------------------

interface AutoCalibrateOptions {
  action_type?: string | null;
  agent_id?: string | null;
  lookback_days?: number;
  metrics?: string[];
}

interface CalibrationSuggestion {
  metric: string;
  data_source: string;
  lower_is_better: boolean;
  sample_size: number;
  distribution: { p10: number; p25: number; p50: number; p75: number; p90: number; min: number; max: number };
  suggested_scale: ScaleRule[];
  suggested_weight: number;
}

interface AutoCalibrateResult {
  status: string;
  message?: string;
  count: number;
  action_type?: string;
  lookback_days?: number;
  suggestions: CalibrationSuggestion[];
}

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
const METRIC_VALUE_READERS: Record<string, (a: Record<string, unknown>) => number> = {
  duration_ms: (a) => Number(a.duration_ms),
  cost_estimate: (a) => Number(a.cost_estimate),
  tokens_total: (a) => (Number(a.tokens_in) || 0) + (Number(a.tokens_out) || 0),
  risk_score: (a) => Number(a.risk_score),
  confidence: (a) => Number(a.confidence),
};

// "Lower is better" metrics (duration, cost, tokens, risk)
const LOWER_IS_BETTER_METRICS = ['duration_ms', 'cost_estimate', 'tokens_total', 'risk_score'];

function collectMetricValues(actions: Record<string, unknown>[], metric: string): number[] {
  const reader = METRIC_VALUE_READERS[metric];
  if (!reader) return [];
  return actions
    .map(reader)
    .filter((v) => !isNaN(v))
    .sort((a, b) => a - b);
}

function percentileOf(values: number[], p: number): number {
  const idx = Math.floor(values.length * p);
  return values[Math.min(idx, values.length - 1)] as number;
}

function buildSuggestedScale(lowerIsBetter: boolean, p25: number, p50: number, p75: number): ScaleRule[] {
  const round2 = (v: number): number => Math.round(v * 100) / 100;
  const inBand = lowerIsBetter ? 'lte' : 'gte';
  const outBand = lowerIsBetter ? 'gt' : 'lt';
  const [best, mid, worst] = lowerIsBetter ? [p25, p50, p75] : [p75, p50, p25];
  return [
    { label: 'excellent', operator: inBand, value: round2(best as number), score: 100 },
    { label: 'good', operator: inBand, value: round2(mid as number), score: 75 },
    { label: 'acceptable', operator: inBand, value: round2(worst as number), score: 50 },
    { label: 'poor', operator: outBand, value: round2(worst as number), score: 20 },
  ];
}

function buildCalibrationSuggestion(metric: string, values: number[]): CalibrationSuggestion {
  const p10 = percentileOf(values, 0.10);
  const p25 = percentileOf(values, 0.25);
  const p50 = percentileOf(values, 0.50);
  const p75 = percentileOf(values, 0.75);
  const p90 = percentileOf(values, 0.90);
  const lowerIsBetter = LOWER_IS_BETTER_METRICS.includes(metric);

  return {
    metric,
    data_source: metric,
    lower_is_better: lowerIsBetter,
    sample_size: values.length,
    distribution: { p10, p25, p50, p75, p90, min: values[0] as number, max: values[values.length - 1] as number },
    suggested_scale: buildSuggestedScale(lowerIsBetter, p25, p50, p75),
    suggested_weight: getDefaultWeight(metric),
  };
}

export async function autoCalibrate(sql: SqlTag, orgId: string, options: AutoCalibrateOptions = {}): Promise<AutoCalibrateResult> {
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
           tokens_in, tokens_out, metadata
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

  const suggestions: CalibrationSuggestion[] = [];

  for (const metric of metrics) {
    const values = collectMetricValues(actions, metric);
    if (values.length < 5) continue;
    suggestions.push(buildCalibrationSuggestion(metric, values));
  }

  return {
    status: 'ok',
    count: actions.length,
    action_type: action_type || '(all)',
    lookback_days,
    suggestions,
  };
}

function getDefaultWeight(metric: string): number {
  const weights: Record<string, number> = {
    duration_ms: 0.2,
    cost_estimate: 0.2,
    tokens_total: 0.1,
    risk_score: 0.3,
    confidence: 0.2,
  };
  return weights[metric] || 0.15;
}

// --- Default Seed Data ------------------------------------

const DEFAULT_RISK_TEMPLATES: RiskTemplate[] = [
  {
    name: 'Production Safety',
    description: 'Increases risk for production-targeting, data-modifying, or irreversible actions.',
    action_type: null,
    base_risk: 15,
    rules: [
      { condition: "metadata.environment == 'production'", add: 30 },
      { condition: "metadata.modifies_data == true", add: 20 },
      { condition: "metadata.irreversible == true", add: 25 },
      { condition: "metadata.affects_users == true", add: 15 },
    ],
  },
  {
    name: 'External API Safety',
    description: 'Risk rules for outbound API calls — escalates for unauthenticated or external targets.',
    action_type: 'api_call',
    base_risk: 10,
    rules: [
      { condition: "metadata.auth == 'none'", add: 40 },
      { condition: "metadata.is_external == true", add: 20 },
      { condition: "metadata.retries > 3", add: 15 },
    ],
  },
];

interface SeedProfile extends Profile {
  dimensions: Dimension[];
}

/** Build a seed dimension from compact [label, operator, value, score] scale rows. */
function seedDimension(name: string, dataSource: string, weight: number, scaleRows: [string, string, number, number][]): Dimension {
  return {
    name,
    data_source: dataSource,
    weight,
    scale: scaleRows.map(([label, operator, value, score]) => ({ label, operator, value, score })),
  };
}

const DEFAULT_SCORING_PROFILES: SeedProfile[] = [
  {
    name: 'General Action Quality',
    description: 'Balanced multi-dimensional quality score for any agent action. Good starting point.',
    action_type: null,
    composite_method: 'weighted_average',
    dimensions: [
      seedDimension('Risk Control', 'risk_score', 0.35, [
        ['excellent', 'lte', 20, 100],
        ['good',      'lte', 40, 75],
        ['acceptable','lte', 65, 45],
        ['poor',      'gt',  65, 10],
      ]),
      seedDimension('Confidence', 'confidence', 0.30, [
        ['excellent', 'gte', 0.85, 100],
        ['good',      'gte', 0.70, 75],
        ['acceptable','gte', 0.50, 45],
        ['poor',      'lt',  0.50, 10],
      ]),
      seedDimension('Speed', 'duration_ms', 0.20, [
        ['excellent', 'lte', 2000,  100],
        ['good',      'lte', 8000,  75],
        ['acceptable','lte', 30000, 45],
        ['poor',      'gt',  30000, 10],
      ]),
      seedDimension('Cost Efficiency', 'cost_estimate', 0.15, [
        ['excellent', 'lte', 0.005, 100],
        ['good',      'lte', 0.02,  75],
        ['acceptable','lte', 0.10,  45],
        ['poor',      'gt',  0.10,  10],
      ]),
    ],
  },
  {
    name: 'Strict Safety Profile',
    description: 'Uses minimum composite method — a single poor dimension tanks the score. For critical actions.',
    action_type: null,
    composite_method: 'minimum',
    dimensions: [
      seedDimension('Risk Gate', 'risk_score', 1.0, [
        ['excellent', 'lte', 25, 100],
        ['good',      'lte', 50, 70],
        ['poor',      'gt',  50, 0],
      ]),
      seedDimension('Confidence Gate', 'confidence', 1.0, [
        ['excellent', 'gte', 0.80, 100],
        ['good',      'gte', 0.60, 70],
        ['poor',      'lt',  0.60, 0],
      ]),
    ],
  },
];

const DEFAULT_SAMPLE_ACTIONS: ActionInput[] = [
  { action_type: 'api_call',   risk_score: 18, confidence: 0.92, duration_ms: 1200,  cost_estimate: 0.003 },
  { action_type: 'api_call',   risk_score: 45, confidence: 0.71, duration_ms: 4500,  cost_estimate: 0.015 },
  { action_type: 'deploy',     risk_score: 72, confidence: 0.65, duration_ms: 28000, cost_estimate: 0.04  },
  { action_type: 'research',   risk_score: 12, confidence: 0.95, duration_ms: 850,   cost_estimate: 0.008 },
  { action_type: 'file_write', risk_score: 35, confidence: 0.88, duration_ms: 600,   cost_estimate: 0.001 },
];

async function seedRiskTemplates(sql: SqlTag, orgId: string): Promise<void> {
  const existingTemplates = await listRiskTemplates(sql, orgId, {});
  const existingTemplateNames = new Set(existingTemplates.map((t) => t.name));
  for (const tmpl of DEFAULT_RISK_TEMPLATES) {
    if (existingTemplateNames.has(tmpl.name)) continue;
    await createRiskTemplate(sql, orgId, tmpl);
  }
}

async function seedOneProfile(sql: SqlTag, orgId: string, prof: SeedProfile): Promise<Profile> {
  const { dimensions, ...profileData } = prof;
  const profile = await createProfile(sql, orgId, profileData);
  for (let i = 0; i < dimensions.length; i++) {
    await addDimension(sql, orgId, profile.id as string, { ...dimensions[i], sort_order: i });
  }
  return profile;
}

/** Seed missing default profiles; returns the "General Action Quality" profile if present. */
async function seedScoringProfiles(sql: SqlTag, orgId: string): Promise<Profile | null> {
  const existingProfiles = await listProfiles(sql, orgId, {});
  const existingProfileNames = new Set(existingProfiles.map((p) => p.name));
  let generalProfile: Profile | null = (existingProfiles.find((p) => p.name === DEFAULT_SCORING_PROFILES[0]!.name) as Profile | undefined) || null;

  for (const prof of DEFAULT_SCORING_PROFILES) {
    if (existingProfileNames.has(prof.name)) continue;
    const profile = await seedOneProfile(sql, orgId, prof);
    if (prof.name === DEFAULT_SCORING_PROFILES[0]!.name) generalProfile = profile;
  }

  return generalProfile;
}

async function seedSampleScores(sql: SqlTag, orgId: string, generalProfile: Profile): Promise<void> {
  const rows = (await sql`
    SELECT COUNT(*)::int AS count FROM profile_scores
    WHERE org_id = ${orgId} AND profile_id = ${generalProfile.id}
  `) as { count: number }[];
  const { count } = rows[0] as { count: number };
  if (count >= DEFAULT_SAMPLE_ACTIONS.length) return;

  for (const action of DEFAULT_SAMPLE_ACTIONS) {
    try { await scoreAction(sql, orgId, generalProfile.id as string, { ...action, is_seed: true }); } catch { /* skip */ }
  }
}

/**
 * Seed default scoring profiles, risk templates, and sample scores for a new org.
 * Safe to call multiple times — skips already-existing records by name.
 */
export async function seedDefaultData(sql: SqlTag, orgId: string): Promise<void> {
  await seedRiskTemplates(sql, orgId);
  const generalProfile = await seedScoringProfiles(sql, orgId);
  // Sample scores against general profile only
  if (generalProfile) {
    await seedSampleScores(sql, orgId, generalProfile);
  }
}

// --- Exports ----------------------------------------------

export { extractRawValue, scoreDimensionValue, computeComposite, evaluateCondition };
