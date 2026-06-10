/**
 * Hand-rolled validation for ActionRecord and related entities.
 * No external dependencies - matches existing project style.
 */

const ACTION_TYPES = [
  'build', 'deploy', 'post', 'apply', 'security', 'message', 'api',
  'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config',
  'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other'
];

const ACTION_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'pending', 'pending_approval', 'blocked'];
const LOOP_TYPES = ['followup', 'question', 'dependency', 'approval', 'review', 'handoff', 'other'];
const LOOP_STATUSES = ['open', 'resolved', 'cancelled'];
const LOOP_PRIORITIES = ['low', 'medium', 'high', 'critical'];

const ACTION_RECORD_SCHEMA = {
  // Identity
  action_id:            { type: 'string', maxLength: 128 },
  agent_id:             { type: 'string', required: true, maxLength: 128 },
  agent_name:           { type: 'string', maxLength: 256 },
  swarm_id:             { type: 'string', maxLength: 128 },
  parent_action_id:     { type: 'string', maxLength: 128 },
  // Intent
  // action_type is a free-form string (max 128 chars). The ACTION_TYPES list
  // is retained for guard policy matching and UI display hints, but agent
  // frameworks use arbitrary tool names (read, write, bash, web_search, etc.)
  // that would be rejected by an enum constraint. Agents that want the
  // canonical list can check the /api/health response.
  action_type:          { type: 'string', required: true, maxLength: 128 },
  declared_goal:        { type: 'string', required: true, maxLength: 2000 },
  reasoning:            { type: 'string', maxLength: 4000 },
  authorization_scope:  { type: 'string', maxLength: 1000 },
  // Context
  trigger:              { type: 'string', maxLength: 1000 },
  systems_touched:      { type: 'array', maxItems: 50 },
  input_summary:        { type: 'string', maxLength: 4000 },
  // Action
  status:               { type: 'string', enum: ACTION_STATUSES },
  reversible:           { type: 'boolean' },
  risk_score:           { type: 'integer', min: 0, max: 100 },
  confidence:           { type: 'integer', min: 0, max: 100 },
  recommendation_id:    { type: 'string', maxLength: 128 },
  recommendation_applied: { type: 'boolean' },
  recommendation_override_reason: { type: 'string', maxLength: 500 },
  // Outcome (typically set via PATCH)
  output_summary:       { type: 'string', maxLength: 4000 },
  side_effects:         { type: 'array', maxItems: 50 },
  artifacts_created:    { type: 'array', maxItems: 100 },
  error_message:        { type: 'string', maxLength: 4000 },
  // Meta
  timestamp_start:      { type: 'string', maxLength: 64 },
  timestamp_end:        { type: 'string', maxLength: 64 },
  duration_ms:          { type: 'integer', min: 0 },
  cost_estimate:        { type: 'number', min: 0 },
  tokens_in:            { type: 'integer', min: 0 },
  tokens_out:           { type: 'integer', min: 0 },
  model:                { type: 'string', maxLength: 128 },
  // Idempotency — agent-supplied key. If a row already exists for
  // (org_id, idempotency_key), the create call returns that row instead
  // of inserting a duplicate. See docs/architecture/durable-execution-finality.md.
  idempotency_key:      { type: 'string', maxLength: 256 },
  // Originating agent session (sess_ prefix). Optional; when present it is
  // persisted on the action_record so /sessions can aggregate per-session
  // telemetry. See drizzle/0020_session_action_link.sql.
  session_id:           { type: 'string', maxLength: 128 },
  // Non-fabrication integrity (optional). The outbound content to verify and the
  // source-of-truth it must trace to. Forwarded into the guard context for a
  // non_fabrication policy; never persisted as action_records columns.
  content:              { type: 'string', maxLength: 50000 },
  source_of_truth:      { type: 'object' },
};

const OUTCOME_FIELDS = [
  'status', 'output_summary', 'side_effects', 'artifacts_created',
  'error_message', 'timestamp_end', 'duration_ms', 'cost_estimate',
  'tokens_in', 'tokens_out', 'model'
];

const OPEN_LOOP_SCHEMA = {
  loop_id:      { type: 'string', maxLength: 128 },
  action_id:    { type: 'string', required: true, maxLength: 128 },
  loop_type:    { type: 'string', required: true, enum: LOOP_TYPES },
  description:  { type: 'string', required: true, maxLength: 2000 },
  status:       { type: 'string', enum: LOOP_STATUSES },
  priority:     { type: 'string', enum: LOOP_PRIORITIES },
  owner:        { type: 'string', maxLength: 256 },
  resolution:   { type: 'string', maxLength: 2000 },
};

const ASSUMPTION_SCHEMA = {
  assumption_id:       { type: 'string', maxLength: 128 },
  action_id:           { type: 'string', required: true, maxLength: 128 },
  assumption:          { type: 'string', required: true, maxLength: 2000 },
  basis:               { type: 'string', maxLength: 2000 },
  validated:           { type: 'boolean' },
  invalidated:         { type: 'boolean' },
  invalidated_reason:  { type: 'string', maxLength: 2000 },
};

// ── Shared predicates (keep each validator/conditional flat) ──
const isObjectLike = (value) => !!value && typeof value === 'object';
const isPlainObject = (value) => isObjectLike(value) && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const isFiniteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// One validator per schema field type. Each returns an error string or null.
// Mirrors the original per-type switch exactly (order of checks preserved).
const FIELD_TYPE_VALIDATORS = {
  string: (key, value, rule) => {
    if (typeof value !== 'string') return `${key} must be a string`;
    if (value.length === 0 && rule.required) return `${key} cannot be empty`;
    if (rule.maxLength && value.length > rule.maxLength) return `${key} exceeds max length of ${rule.maxLength}`;
    if (rule.enum && !rule.enum.includes(value)) return `${key} must be one of: ${rule.enum.join(', ')}`;
    return null;
  },
  integer: (key, value, rule) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return `${key} must be an integer`;
    if (rule.min !== undefined && value < rule.min) return `${key} must be >= ${rule.min}`;
    if (rule.max !== undefined && value > rule.max) return `${key} must be <= ${rule.max}`;
    return null;
  },
  number: (key, value, rule) => {
    if (typeof value !== 'number') return `${key} must be a number`;
    if (rule.min !== undefined && value < rule.min) return `${key} must be >= ${rule.min}`;
    if (rule.max !== undefined && value > rule.max) return `${key} must be <= ${rule.max}`;
    return null;
  },
  boolean: (key, value) => (typeof value !== 'boolean' ? `${key} must be a boolean` : null),
  array: (key, value, rule) => {
    if (!Array.isArray(value)) return `${key} must be an array`;
    if (rule.maxItems && value.length > rule.maxItems) return `${key} exceeds max items of ${rule.maxItems}`;
    // SECURITY: Validate individual array items are strings with bounded length
    for (let i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string') return `${key}[${i}] must be a string`;
      if (value[i].length > 500) return `${key}[${i}] exceeds max length of 500`;
    }
    return null;
  },
  // A free-form JSON object (e.g. a non_fabrication source-of-truth). Arrays
  // and null are not objects for this purpose.
  object: (key, value) => (isPlainObject(value) ? null : `${key} must be an object`),
};

function validateField(key, value, rule) {
  if (value === undefined || value === null) {
    return rule.required ? `${key} is required` : null;
  }

  const typeValidator = FIELD_TYPE_VALIDATORS[rule.type];
  return typeValidator ? typeValidator(key, value, rule) : null;
}

// Support both snake_case (schema key) and camelCase (DX preference). Fall back
// to the camelCase variant when the snake_case key is absent OR explicitly null,
// so a present camelCase value is not silently dropped by an explicit snake_case
// null (e.g. { risk_score: null, riskScore: 80 }).
function resolveFieldValue(src, key) {
  const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
  return (src[key] !== undefined && src[key] !== null) ? src[key] : src[camelKey];
}

/**
 * Core schema validator. The returned `data` is a permissive bag of validated
 * fields; callers read domain-specific keys off it (typed Record so the
 * still-JS validator interops with TS route callers during the migration).
 * @param {*} body
 * @param {*} schema
 * @returns {{ valid: boolean, data: Record<string, any>, errors: string[] }}
 */
function validate(body, schema) {
  const errors = [];
  const data = {};

  // A malformed request body can be `null` or a non-object: request.json()
  // returns the value null for the literal body `null` without throwing. Coerce
  // to an empty object so required-field checks produce a 400, not a TypeError
  // that surfaces as a generic 500.
  const src = (body && typeof body === 'object') ? body : {};

  for (const [key, rule] of Object.entries(schema)) {
    const value = resolveFieldValue(src, key);

    const error = validateField(key, value, rule);
    if (error) {
      errors.push(error);
    } else if (value != null) {
      data[key] = value;
    }
  }

  return {
    valid: errors.length === 0,
    data,
    errors
  };
}

export function validateActionRecord(body) {
  return validate(body, ACTION_RECORD_SCHEMA);
}

export function validateActionOutcome(body) {
  const outcomeSchema = {};
  for (const key of OUTCOME_FIELDS) {
    if (ACTION_RECORD_SCHEMA[key]) {
      outcomeSchema[key] = { ...ACTION_RECORD_SCHEMA[key], required: false };
    }
  }
  const result = validate(body, outcomeSchema);

  // Filter to only outcome fields
  const filtered = {};
  for (const key of OUTCOME_FIELDS) {
    if (result.data[key] !== undefined) filtered[key] = result.data[key];
  }
  result.data = filtered;

  // Must have at least one field
  if (result.valid && Object.keys(filtered).length === 0) {
    result.valid = false;
    result.errors.push('At least one outcome field is required: ' + OUTCOME_FIELDS.join(', '));
  }

  return result;
}

export function validateOpenLoop(body) {
  return validate(body, OPEN_LOOP_SCHEMA);
}

export function validateAssumption(body) {
  return validate(body, ASSUMPTION_SCHEMA);
}

const ASSUMPTION_UPDATE_SCHEMA = {
  validated:           { type: 'boolean', required: true },
  invalidated_reason:  { type: 'string', maxLength: 2000 },
};

export function validateAssumptionUpdate(body) {
  const result = validate(body, ASSUMPTION_UPDATE_SCHEMA);

  // Invalidating requires a reason
  if (result.valid && result.data.validated === false) {
    if (!result.data.invalidated_reason || result.data.invalidated_reason.trim().length === 0) {
      result.valid = false;
      result.errors.push('invalidated_reason is required when invalidating an assumption');
    }
  }

  return result;
}

// ── Guard & Policy validation ──

const GUARD_INPUT_SCHEMA = {
  action_type:     { type: 'string', required: true, maxLength: 128 },
  action:          { type: 'string', alias: 'action_type' }, // Alias for action_type
  risk_score:      { type: 'integer', min: 0, max: 100 },
  agent_id:        { type: 'string', maxLength: 128 },
  agent_name:      { type: 'string', maxLength: 256 },
  systems_touched: { type: 'array', maxItems: 50 },
  reversible:      { type: 'boolean' },
  declared_goal:   { type: 'string', maxLength: 2000 },
  intent:          { type: 'string', alias: 'declared_goal' }, // Alias for declared_goal
  // Phase 2c (issue #121): the resource an action-binding claim commits to.
  // Optional and only meaningful when DASHCLAW_ACT_BINDING is enabled and the
  // token carries a `urn:dashclaw:act-binding` claim. Part of the canonical
  // (action, target, goal) hash tuple.
  target:          { type: 'string', maxLength: 1024 },
  // Non-fabrication integrity (optional). The outbound content to verify and the
  // source-of-truth it must trace to, read by a non_fabrication guard policy.
  content:         { type: 'string', maxLength: 50000 },
  source_of_truth: { type: 'object' },
  // Hook/SDK-supplied governance signals the guard engine reads. Without these in
  // the schema, validate() strips them and green_contract / branch_freshness /
  // permission_escalation / protected_path silently no-op. `intel` carries the
  // branch/mcp/green/tool sub-objects (engine reads context.intel.*); `tool` is the
  // hook's top-level tool descriptor (permission_escalation falls back to it); and
  // `write_paths` is the path set a protected_path policy matches. Free-form
  // object / string-array — passed through, not deep-validated.
  intel:           { type: 'object' },
  tool:            { type: 'object' },
  write_paths:     { type: 'array', maxItems: 100 },
  // ?record=true parity: the hook's two-call flow persisted these on the
  // action record (subagent provenance + session swarm grouping). Accepted
  // here so the in-guard record keeps them; harmless without the param.
  trigger:         { type: 'string', maxLength: 1000 },
  swarm_id:        { type: 'string', maxLength: 128 },
};

const POLICY_TYPES = ['risk_threshold', 'require_approval', 'block_action_type', 'rate_limit', 'webhook_check', 'behavioral_anomaly', 'semantic_check', 'permission_escalation', 'green_contract', 'branch_freshness', 'non_fabrication', 'protected_path', 'x402_spend_limit'];
const GUARD_ACTIONS = ['allow', 'warn', 'block', 'require_approval'];

const POLICY_SCHEMA = {
  name:        { type: 'string', required: true, maxLength: 256 },
  policy_type: { type: 'string', required: true, enum: POLICY_TYPES },
  rules:       { type: 'string', required: true, maxLength: 4000 },
  active:      { type: 'integer', min: 0, max: 1 },
  agent_ids:   { type: 'string', maxLength: 4000 },
};

export function validateGuardInput(body) {
  // A null / non-object body must not crash here before validate() runs; coerce
  // it so the missing-required-field path returns a 400 rather than a 500.
  const safeBody = (body && typeof body === 'object') ? body : {};
  // Normalize aliases before validation
  const normalized = { ...safeBody };
  if (safeBody.action && !safeBody.action_type) normalized.action_type = safeBody.action;
  if (safeBody.intent && !safeBody.declared_goal) normalized.declared_goal = safeBody.intent;

  return validate(normalized, GUARD_INPUT_SCHEMA);
}

// A rules.tests entry must be { name: non-empty string, input: object,
// expect: { decision in GUARD_ACTIONS } }. Returns the first error or null.
function testRecipeError(t) {
  if (!isObjectLike(t) || !isNonEmptyString(t.name)) {
    return 'each rules.tests entry requires a non-empty name string';
  }
  if (!isPlainObject(t.input)) {
    return 'each rules.tests entry requires an input object';
  }
  if (!isObjectLike(t.expect) || !GUARD_ACTIONS.includes(t.expect.decision)) {
    return `each rules.tests entry requires expect.decision in: ${GUARD_ACTIONS.join(', ')}`;
  }
  return null;
}

// Optional inline test recipes: rules.tests is an array of
// { name, input (an example action context), expect: { decision } } that
// POST /api/policies/test runs through the real enforcement evaluator to prove
// the policy decides as intended. Validated here so malformed recipes cannot be
// stored; absent rules.tests leaves every existing policy valid.
function validatePolicyTestRecipes(rules, addError) {
  if (rules.tests === undefined) return;
  if (!Array.isArray(rules.tests)) {
    addError('rules.tests must be an array when present');
    return;
  }
  for (const t of rules.tests) {
    const err = testRecipeError(t);
    if (err) {
      addError(err);
      break;
    }
  }
}

const GREEN_CONTRACT_LEVELS = ['targeted', 'package', 'workspace', 'merge_ready'];

// One validator per policy type — each pushes type-specific errors via addError.
// Mirrors the original per-type switch exactly (check order + messages preserved).
const POLICY_TYPE_VALIDATORS = {
  behavioral_anomaly: (rules, addError) => {
    if (typeof rules.similarity_threshold !== 'number' || rules.similarity_threshold < 0 || rules.similarity_threshold > 1) {
      addError('behavioral_anomaly policy requires rules.similarity_threshold (0.0-1.0)');
    }
  },
  semantic_check: (rules, addError) => {
    if (!isNonEmptyString(rules.instruction)) {
      addError('semantic_check policy requires rules.instruction string');
    }
  },
  risk_threshold: (rules, addError) => {
    if (typeof rules.threshold !== 'number' || rules.threshold < 0 || rules.threshold > 100) {
      addError('risk_threshold policy requires rules.threshold (0-100)');
    }
  },
  require_approval: (rules, addError, policyType) => validateActionTypesRequired(rules, addError, policyType),
  block_action_type: (rules, addError, policyType) => validateActionTypesRequired(rules, addError, policyType),
  protected_path: (rules, addError) => {
    // Path-scoped approval/warn gate (Behavior Learning). rules.paths is a
    // non-empty array of globs; rules.action defaults to require_approval and
    // is validated by the generic GUARD_ACTIONS check above when present.
    if (!Array.isArray(rules.paths) || rules.paths.length === 0) {
      addError('protected_path policy requires a non-empty rules.paths array');
    } else if (!rules.paths.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 256)) {
      addError('protected_path rules.paths must be non-empty strings (<=256 chars)');
    }
  },
  rate_limit: (rules, addError) => {
    if (typeof rules.max_actions !== 'number' || rules.max_actions <= 0) {
      addError('rate_limit policy requires rules.max_actions > 0');
    }
    if (typeof rules.window_minutes !== 'number' || rules.window_minutes <= 0) {
      addError('rate_limit policy requires rules.window_minutes > 0');
    }
  },
  webhook_check: (rules, addError) => {
    if (typeof rules.url !== 'string') {
      addError('webhook_check policy requires rules.url as a string');
    } else {
      const urlErr = isValidWebhookUrl(rules.url);
      if (urlErr) addError(urlErr);
    }
    if (rules.timeout_ms !== undefined && (typeof rules.timeout_ms !== 'number' || rules.timeout_ms < 1000 || rules.timeout_ms > 10000)) {
      addError('webhook_check rules.timeout_ms must be 1000-10000');
    }
    if (rules.on_timeout !== undefined && !['allow', 'block'].includes(rules.on_timeout)) {
      addError('webhook_check rules.on_timeout must be "allow" or "block"');
    }
  },
  non_fabrication: (rules, addError) => {
    // All fields optional (sensible defaults applied at evaluation time:
    // applies to all action types, content_path='content',
    // source_path='source_of_truth', on_violation='block').
    if (rules.action_types !== undefined && !Array.isArray(rules.action_types)) {
      addError('non_fabrication policy rules.action_types must be an array when present');
    }
    if (rules.on_violation !== undefined && !['block', 'require_approval'].includes(rules.on_violation)) {
      addError('non_fabrication policy rules.on_violation must be "block" or "require_approval"');
    }
    if (rules.content_path !== undefined && typeof rules.content_path !== 'string') {
      addError('non_fabrication policy rules.content_path must be a string');
    }
    if (rules.source_path !== undefined && typeof rules.source_path !== 'string') {
      addError('non_fabrication policy rules.source_path must be a string');
    }
  },
  green_contract: (rules, addError) => {
    // rules.required_level is mandatory — without it the guard comparison
    // resolves to GREEN_RANK[undefined] ?? 0 = 0, so every observed level
    // passes (0 >= 0), and the policy silently no-ops at enforcement.
    if (!GREEN_CONTRACT_LEVELS.includes(rules.required_level)) {
      addError(`green_contract policy requires rules.required_level to be one of: ${GREEN_CONTRACT_LEVELS.join(', ')}`);
    }
    if (rules.action_types !== undefined && !Array.isArray(rules.action_types)) {
      addError('green_contract policy rules.action_types must be an array when present');
    }
  },
  branch_freshness: (rules, addError) => {
    // Sensible defaults at enforcement: freshness=['stale','diverged'], max_commits_behind=0.
    // Validate optional overrides when present.
    if (rules.freshness !== undefined && !Array.isArray(rules.freshness)) {
      addError('branch_freshness policy rules.freshness must be an array when present');
    }
    if (rules.max_commits_behind !== undefined && (typeof rules.max_commits_behind !== 'number' || rules.max_commits_behind < 0)) {
      addError('branch_freshness policy rules.max_commits_behind must be a non-negative number');
    }
    if (rules.action_types !== undefined && !Array.isArray(rules.action_types)) {
      addError('branch_freshness policy rules.action_types must be an array when present');
    }
  },
  permission_escalation: (rules, addError) => {
    // rules.enforce controls whether the policy fires; without it the guard
    // returns null immediately (informational by default). Validate the
    // override for rules.action when present (covered by the generic
    // GUARD_ACTIONS check above), no required fields.
    if (rules.enforce !== undefined && typeof rules.enforce !== 'boolean') {
      addError('permission_escalation policy rules.enforce must be a boolean when present');
    }
  },
  x402_spend_limit: (rules, addError) => {
    // x402 spend governance. All fields optional (the engine treats absent
    // max_spend_usd / approval_threshold as Infinity and absent lists as
    // empty), but when present they must be well-typed. Without this case the
    // policy could not be authored through the validated /api/policies route
    // even though the guard engine enforces it (audit B5).
    if (rules.max_spend_usd !== undefined && !isFiniteNonNegative(rules.max_spend_usd)) {
      addError('x402_spend_limit policy rules.max_spend_usd must be a finite, non-negative number when present');
    }
    if (rules.approval_threshold !== undefined && !isFiniteNonNegative(rules.approval_threshold)) {
      addError('x402_spend_limit policy rules.approval_threshold must be a finite, non-negative number when present');
    }
    if (rules.allowed_providers !== undefined && !Array.isArray(rules.allowed_providers)) {
      addError('x402_spend_limit policy rules.allowed_providers must be an array when present');
    }
    if (rules.blocked_providers !== undefined && !Array.isArray(rules.blocked_providers)) {
      addError('x402_spend_limit policy rules.blocked_providers must be an array when present');
    }
  },
};

// require_approval and block_action_type share the same action_types check; the
// error message names the actual policy type.
function validateActionTypesRequired(rules, addError, policyType) {
  if (!Array.isArray(rules.action_types) || rules.action_types.length === 0) {
    addError(`${policyType} policy requires rules.action_types array`);
  }
}

export function validatePolicy(body) {
  const result = validate(body, POLICY_SCHEMA);
  if (!result.valid) return result;

  // Validate rules JSON structure
  let rules;
  try {
    rules = JSON.parse(result.data.rules);
  } catch {
    result.valid = false;
    result.errors.push('rules must be valid JSON');
    return result;
  }

  const addError = (msg) => {
    result.valid = false;
    result.errors.push(msg);
  };

  if (rules.action && !GUARD_ACTIONS.includes(rules.action)) {
    addError(`rules.action must be one of: ${GUARD_ACTIONS.join(', ')}`);
    return result;
  }

  validatePolicyTestRecipes(rules, addError);

  const typeValidator = POLICY_TYPE_VALIDATORS[result.data.policy_type];
  if (typeValidator) typeValidator(rules, addError, result.data.policy_type);

  return result;
}

// ── x402 purchase validation (R4) ──
// The x402 purchase route previously did only a presence check on required
// fields, letting Number(x)||0 admit negative/Infinity spend, arbitrary
// currency strings, and unbounded free text. This schema rejects those at the
// boundary so a malformed/hostile purchase never reaches the spend-limit guard
// or the ledger.
const X402_MAX_SPEND_USD = 1_000_000;
const X402_REQUIRED = ['agent_id', 'provider', 'declared_goal', 'purchase_reason', 'context_gap', 'expected_value'];
const X402_TEXT_LIMITS = {
  agent_id: 128, agent_name: 256, provider: 256, provider_id: 128, endpoint_id: 128,
  declared_goal: 2000, purchase_reason: 2000, context_gap: 2000, expected_value: 2000,
  alternatives_considered: 4000, payment_method: 64, currency: 16,
  wallet_reference: 512, payment_reference: 512,
};

function collectX402Required(src, errors) {
  const missing = X402_REQUIRED.filter((k) => src[k] == null || src[k] === '');
  if (missing.length) errors.push(`Missing required fields: ${missing.join(', ')}`);
}

function collectX402TextFields(src, errors, data) {
  for (const [k, max] of Object.entries(X402_TEXT_LIMITS)) {
    if (src[k] == null) continue;
    if (typeof src[k] !== 'string') { errors.push(`${k} must be a string`); continue; }
    if (src[k].length > max) { errors.push(`${k} exceeds max length of ${max}`); continue; }
    data[k] = src[k];
  }
}

// Spend amount: accept cost_estimate (preferred) or spend_amount; must be a
// finite, non-negative number within a sane ceiling. Number(x)||0 is NOT used
// because it silently turns Infinity into Infinity and -5 into -5.
function collectX402Spend(src, errors, data) {
  data.spend_amount = 0;
  const rawSpend = src.cost_estimate ?? src.spend_amount;
  if (rawSpend == null || rawSpend === '') return;

  const n = typeof rawSpend === 'number' ? rawSpend : Number(rawSpend);
  if (!Number.isFinite(n)) {
    errors.push('spend amount (cost_estimate/spend_amount) must be a finite number');
  } else if (n < 0) {
    errors.push('spend amount must be non-negative');
  } else if (n > X402_MAX_SPEND_USD) {
    errors.push(`spend amount exceeds maximum of ${X402_MAX_SPEND_USD}`);
  } else {
    data.spend_amount = n;
  }
}

function collectX402Currency(src, errors, data) {
  // Currency: a short alphanumeric code; defaulted downstream when absent.
  if (src.currency == null || src.currency === '') return;
  if (typeof src.currency !== 'string' || !/^[A-Za-z0-9]{2,16}$/.test(src.currency)) {
    errors.push('currency must be a short alphanumeric code (2-16 chars)');
  } else {
    data.currency = src.currency.toUpperCase();
  }
}

function collectX402Scores(src, errors, data) {
  // Client risk_score (optional): may only raise the authoritative score later.
  if (src.risk_score != null) {
    const r = Number(src.risk_score);
    if (!Number.isFinite(r) || r < 0 || r > 100) errors.push('risk_score must be a number between 0 and 100');
    else data.risk_score = r;
  }
  if (src.confidence_score != null) {
    const c = Number(src.confidence_score);
    if (!Number.isFinite(c)) errors.push('confidence_score must be a finite number');
    else data.confidence_score = c;
  }
}

export function validateX402Purchase(body) {
  const src = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const errors = [];
  const data = {};

  collectX402Required(src, errors);
  collectX402TextFields(src, errors, data);
  collectX402Spend(src, errors, data);
  collectX402Currency(src, errors, data);
  collectX402Scores(src, errors, data);

  return { valid: errors.length === 0, data, errors };
}

// Extract the embedded IPv4 from an IPv4-mapped IPv6 address in either the
// dotted form (::ffff:192.168.1.1) or the canonical hex form (::ffff:c0a8:101).
// Node's WHATWG URL parser canonicalizes to hex, so the dotted regex alone
// is not enough to catch an attacker wrapping a private RFC1918 address.
function extractIPv4FromMappedV6(host) {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    if (high > 0xffff || low > 0xffff) return null;
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  }
  return null;
}

const IPV4_PRIVATE_PATTERNS = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
];

// Block localhost, private IPs, and zero-host variants. Tested against the bare
// (bracket-stripped, lowercased) hostname.
const BLOCKED_WEBHOOK_HOST_PATTERNS = [
  /^localhost$/i,
  /^0\./,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,                           // IPv6 loopback shorthand
  /^0:0:0:0:0:0:0:0$/,              // IPv6 all-zeros (full notation)
  /^::$/,                            // IPv6 all-zeros (compressed)
  /^(fc|fd)[0-9a-f]{2}:/i,          // fc00::/7 (unique local IPv6)
  /^fe[89ab][0-9a-f]:/i,            // fe80::/10 (link-local IPv6)
  // IPv4-mapped IPv6 (::ffff:x.x.x.x). Cover every private range, not
  // just loopback — without these, an attacker reaches RFC1918 hosts by
  // wrapping the address (e.g. https://[::ffff:192.168.1.1]/admin).
  /^::ffff:0\./i,                    // 0.0.0.0/8 ("this network")
  /^::ffff:10\./i,                   // 10.0.0.0/8 (private)
  /^::ffff:127\./i,                  // 127.0.0.0/8 (loopback)
  /^::ffff:169\.254\./i,             // 169.254.0.0/16 (link-local)
  /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./i, // 172.16.0.0/12 (private)
  /^::ffff:192\.168\./i,             // 192.168.0.0/16 (private)
  /^::ffff:7f[0-9a-f]{2}:/i,        // IPv4-mapped loopback (hex, e.g. 7f00:1 = 127.0.1)
  /^::ffff:0:127\./i,                // IPv4-translated loopback
  /^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:0*1$/i,  // Full notation ::1
  /\.local$/i,
  /\.internal$/i,
  /\.test$/i,
  /\.invalid$/i,
  /\.onion$/i,
];

// SECURITY: Node's URL normalizes IPv6 addresses with surrounding brackets in
// hostname (e.g. "[fc00::1]"). Strip brackets and lowercase so all IPv6 regexes
// work consistently against the bare address string.
function normalizeHost(hostname) {
  const rawHost = hostname.toLowerCase();
  return rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
}

function isBlockedWebhookHost(host) {
  if (!host || BLOCKED_WEBHOOK_HOST_PATTERNS.some((p) => p.test(host))) return true;
  // Defeat IPv4-mapped IPv6 (::ffff:c0a8:101 → 192.168.1.1) by extracting the
  // embedded IPv4 and rerunning the private-range check against it. The regex
  // list above catches the dotted form; this catches the hex form Node emits
  // after canonicalization.
  const mappedV4 = extractIPv4FromMappedV6(host);
  return !!(mappedV4 && IPV4_PRIVATE_PATTERNS.some((p) => p.test(mappedV4)));
}

// SECURITY: Optional allowlist of trusted domains, configured via env. Returns
// true when no allowlist is set, or the host (or a subdomain of it) is listed.
function isWebhookHostAllowlisted(host) {
  const allowedDomains = process.env.WEBHOOK_ALLOWED_DOMAINS
    ? process.env.WEBHOOK_ALLOWED_DOMAINS.split(',').map((d) => d.trim().toLowerCase())
    : [];
  if (allowedDomains.length === 0) return true;
  if (allowedDomains.includes(host)) return true;
  return allowedDomains.some((domain) => host.endsWith('.' + domain));
}

/**
 * SECURITY: Centralized SSRF protection for webhooks.
 * Returns null if valid, or a string error message if invalid.
 */
export function isValidWebhookUrl(url) {
  if (!url || typeof url !== 'string') return 'URL is required';
  if (!url.startsWith('https://')) return 'URL must use HTTPS';

  try {
    const host = normalizeHost(new URL(url).hostname);

    if (isBlockedWebhookHost(host)) {
      return 'URL cannot point to localhost, private networks, or invalid domains';
    }
    if (!isWebhookHostAllowlisted(host)) {
      return 'URL domain is not on the trusted allowlist';
    }

    return null;
  } catch {
    return 'Invalid URL format';
  }
}

/**
 * SECURITY: Enforce max length on string fields to prevent storage abuse.
 * Returns { ok: true, truncated } or { ok: false, error }.
 * Truncates instead of rejecting — use validateRequiredLength for hard limits.
 */
const DEFAULT_MAX_LENGTH = 5000;

export function enforceFieldLimits(body, limits = {}) {
  const errors = [];
  for (const [field, maxLen] of Object.entries(limits)) {
    if (body[field] != null && typeof body[field] === 'string' && body[field].length > maxLen) {
      errors.push(`${field} exceeds max length of ${maxLen}`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export { ACTION_TYPES, ACTION_STATUSES, LOOP_TYPES, LOOP_STATUSES, LOOP_PRIORITIES, OUTCOME_FIELDS, POLICY_TYPES, DEFAULT_MAX_LENGTH };
