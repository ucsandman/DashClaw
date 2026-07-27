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
  timestamp_start:      { type: 'string', maxLength: 64, format: 'datetime' },
  timestamp_end:        { type: 'string', maxLength: 64, format: 'datetime' },
  duration_ms:          { type: 'integer', min: 0 },
  cost_estimate:        { type: 'number', min: 0 },
  tokens_in:            { type: 'integer', min: 0 },
  tokens_out:           { type: 'integer', min: 0 },
  model:                { type: 'string', maxLength: 128 },
  // Approvals lifecycle (drizzle/0039): how long the client will poll for an
  // approval decision, declared at request time. The server stamps
  // approval_expires_at = now + this + retry grace on pending_approval rows.
  approval_wait_seconds: { type: 'integer', min: 5, max: 86400 },
  // Idempotency — agent-supplied key. If a row already exists for
  // (org_id, idempotency_key), the create call returns that row instead
  // of inserting a duplicate. See docs/architecture/durable-execution-finality.md.
  idempotency_key:      { type: 'string', maxLength: 256 },
  // Originating agent session (sess_ prefix). Optional; when present it is
  // persisted on the action_record so /sessions can aggregate per-session
  // telemetry. See drizzle/0020_session_action_link.sql.
  session_id:           { type: 'string', maxLength: 128 },
  // Originating guard decision (act_gd_ prefix). Optional; when present it is
  // persisted so approval outcomes can be joined back to the policies that
  // required them (policy-tuning proposal loop). ?record=true stamps it
  // server-side; this field covers the separate two-call record flow.
  // See drizzle/0035_action_records_guard_decision_id.sql.
  guard_decision_id:    { type: 'string', maxLength: 64 },
  // Non-fabrication integrity (optional). The outbound content to verify and the
  // source-of-truth it must trace to. Forwarded into the guard context for a
  // non_fabrication policy; never persisted as action_records columns.
  content:              { type: 'string', maxLength: 50000 },
  source_of_truth:      { type: 'object' },
  // Evidence-first act (optional; same wire contract as the guard input —
  // validateActionRecord runs the same deep pass). Feeds the internal guard
  // evaluation AND the act_content_hash grant-binding stamp (drizzle/0056);
  // the act object itself is never persisted as an action_records column.
  act:                  { type: 'object' },
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
    // Timestamps must be Date-parseable; they are normalized to ISO in
    // validate() so text columns never hold strings that break ::timestamptz
    // casts downstream (signals, operations feed). Empty strings pass through
    // and fall back to "now" at the route layer.
    if (rule.format === 'datetime' && value.length > 0 && Number.isNaN(new Date(value).getTime())) {
      return `${key} must be a parseable timestamp (ISO 8601 recommended)`;
    }
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
      // Normalize datetime strings to ISO (e.g. a client sending
      // Date.toString() output like "Thu Jun 11 2026 ... GMT-0400 (...)").
      data[key] = (rule.format === 'datetime' && typeof value === 'string' && value.length > 0)
        ? new Date(value).toISOString()
        : value;
    }
  }

  return {
    valid: errors.length === 0,
    data,
    errors
  };
}

export function validateActionRecord(body) {
  const result = validate(body, ACTION_RECORD_SCHEMA);
  // Deep-validate the optional evidence `act` payload — identical contract to
  // validateGuardInput, so an act accepted at guard time is accepted at record
  // time (act-content grant binding depends on both sides seeing the same act).
  if (isPlainObject(result.data.act)) {
    const before = result.errors.length;
    validateActField(result.data.act, (msg) => result.errors.push(msg));
    if (result.errors.length > before) result.valid = false;
  }
  return result;
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
  // End-to-end idempotency: hooks/MCP/SDK derive a stable key per logical
  // action (see sdk/dashclaw.js deriveIdempotencyKey). The ?record=true branch
  // short-circuits on an existing (org_id, idempotency_key) action row, and a
  // duplicate guard call inside the replay window returns the prior decision
  // instead of writing (and flood/signal-counting) a second one.
  idempotency_key: { type: 'string', maxLength: 256 },
  // Approvals lifecycle (drizzle/0039): the client's approval poll window,
  // declared at request time so a require_approval row recorded via
  // ?record=true gets a truthful approval_expires_at stamp.
  approval_wait_seconds: { type: 'integer', min: 5, max: 86400 },
  // Evidence-first: the actual act the server classifies (shell/http/sql/file).
  // The generic object check runs here; validateGuardInput deep-validates the
  // per-kind payload family and size caps below.
  act:             { type: 'object' },
  // Containment negotiation: caller-advertised capabilities (e.g.
  // 'allow_contained'). Generic array type check runs here; validateGuardInput
  // deep-validates the count/length caps below (validateClientCapabilities).
  client_capabilities: { type: 'array' },
};

// Evidence-first `act` payload — deep validation (caps + per-kind family).
// The generic object check in GUARD_INPUT_SCHEMA handles the non-object case;
// this enforces the wire contract (docs/superpowers/specs/2026-07-05-evidence-first-guard.md §1).
const ACT_KINDS = ['shell', 'http', 'sql', 'file'];
const ACT_MAX_BYTES = 16 * 1024;
const ACT_HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'CONNECT'];

function validateActField(act, addError) {
  let serialized;
  try {
    serialized = JSON.stringify(act);
  } catch {
    addError('act must be JSON-serializable');
    return;
  }
  if (serialized.length > ACT_MAX_BYTES) {
    addError('act exceeds max serialized size of 16KB (ACT_TOO_LARGE)');
    return;
  }
  if (!ACT_KINDS.includes(act.kind)) {
    addError(`act.kind must be one of: ${ACT_KINDS.join(', ')}`);
    return;
  }
  if (act.kind === 'shell') {
    if (typeof act.command !== 'string' || act.command.length === 0) addError('act.command must be a non-empty string for kind "shell"');
    else if (act.command.length > 8192) addError('act.command exceeds max length of 8192');
  } else if (act.kind === 'http') {
    if (!isPlainObject(act.request)) { addError('act.request must be an object for kind "http"'); return; }
    if (typeof act.request.method !== 'string' || !ACT_HTTP_METHODS.includes(act.request.method.toUpperCase())) addError('act.request.method must be a valid HTTP method');
    if (typeof act.request.url !== 'string' || act.request.url.length === 0) addError('act.request.url must be a non-empty string');
    else if (act.request.url.length > 2048) addError('act.request.url exceeds max length of 2048');
    if (act.request.body_excerpt !== undefined && (typeof act.request.body_excerpt !== 'string' || act.request.body_excerpt.length > 4096)) addError('act.request.body_excerpt must be a string of at most 4096 chars');
  } else if (act.kind === 'sql') {
    if (typeof act.statement !== 'string' || act.statement.length === 0) addError('act.statement must be a non-empty string for kind "sql"');
    else if (act.statement.length > 8192) addError('act.statement exceeds max length of 8192');
  } else if (act.kind === 'file') {
    if (!isPlainObject(act.file)) { addError('act.file must be an object for kind "file"'); return; }
    if (typeof act.file.path !== 'string' || act.file.path.length === 0) addError('act.file.path must be a non-empty string');
    else if (act.file.path.length > 1024) addError('act.file.path exceeds max length of 1024');
    if (act.file.content_excerpt !== undefined && (typeof act.file.content_excerpt !== 'string' || act.file.content_excerpt.length > 4096)) addError('act.file.content_excerpt must be a string of at most 4096 chars');
    if (act.file.bytes !== undefined && (!Number.isInteger(act.file.bytes) || act.file.bytes < 0)) addError('act.file.bytes must be a non-negative integer');
  }
}

// Containment negotiation (RFC 2026-07-06-containment-verdicts): the caller
// advertises support for allow_contained via context.client_capabilities. A
// version-skew safety valve, not a free-form bag — bounded to a handful of
// short capability strings.
function validateClientCapabilities(context, addError) {
  if (context.client_capabilities !== undefined) {
    if (!Array.isArray(context.client_capabilities)
      || context.client_capabilities.length > 8
      || !context.client_capabilities.every((c) => typeof c === 'string' && c.length > 0 && c.length <= 64)) {
      addError('client_capabilities must be an array of at most 8 capability strings (<=64 chars)');
    }
  }
}

const POLICY_TYPES = ['risk_threshold', 'require_approval', 'block_action_type', 'warn_action_type', 'allow_grant', 'rate_limit', 'webhook_check', 'permission_escalation', 'green_contract', 'branch_freshness', 'non_fabrication', 'protected_path', 'agent_allowlist', 'require_evidence', 'delegation_constraint'];
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

  const result = validate(normalized, GUARD_INPUT_SCHEMA);

  // Deep-validate the optional evidence `act` payload. validate() only copies
  // act into data when it passed the generic object check, so a present-but-
  // non-object act already errored and data.act is absent — skip the deep pass.
  if (isPlainObject(result.data.act)) {
    const before = result.errors.length;
    validateActField(result.data.act, (msg) => result.errors.push(msg));
    if (result.errors.length > before) result.valid = false;
  }

  const beforeCaps = result.errors.length;
  validateClientCapabilities(result.data, (msg) => result.errors.push(msg));
  if (result.errors.length > beforeCaps) result.valid = false;

  return result;
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
  risk_threshold: (rules, addError) => {
    if (typeof rules.threshold !== 'number' || rules.threshold < 0 || rules.threshold > 100) {
      addError('risk_threshold policy requires rules.threshold (0-100)');
    }
    if (rules.contain_above !== undefined) {
      if (!Number.isInteger(rules.contain_above) || rules.contain_above < 0 || rules.contain_above > 100) {
        addError('risk_threshold rules.contain_above must be an integer 0-100');
      } else if (typeof rules.threshold === 'number' && rules.contain_above >= rules.threshold) {
        addError('risk_threshold rules.contain_above must be strictly below rules.threshold');
      }
      if (rules.action !== 'require_approval') {
        addError("risk_threshold rules.contain_above requires rules.action 'require_approval' (containment sits below the interrupt rail)");
      }
    }
  },
  require_approval: (rules, addError, policyType) => validateActionTypesRequired(rules, addError, policyType),
  block_action_type: (rules, addError, policyType) => validateActionTypesRequired(rules, addError, policyType),
  warn_action_type: (rules, addError, policyType) => validateActionTypesRequired(rules, addError, policyType),
  allow_grant: (rules, addError) => {
    if (!isNonEmptyString(rules.action_type)) {
      addError('allow_grant policy requires rules.action_type string');
    }
    if (rules.target_prefix !== undefined && rules.target_prefix !== null && (
      typeof rules.target_prefix !== 'string' || rules.target_prefix.length === 0 || rules.target_prefix.length > 256
    )) {
      addError('allow_grant rules.target_prefix must be a non-empty string (<=256 chars)');
    }
  },
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
  agent_allowlist: (rules, addError) => {
    // Behavior Learning: per-agent action-type allowlist. rules.allowed_action_types
    // is a non-empty array of strings (the observed safe envelope); rules.action
    // defaults to 'warn' and must be a raising action (never 'allow', which would
    // make the policy a silent no-op). The generic GUARD_ACTIONS check above still
    // runs; this narrows it to exclude 'allow'.
    if (!Array.isArray(rules.allowed_action_types) || rules.allowed_action_types.length === 0) {
      addError('agent_allowlist policy requires a non-empty rules.allowed_action_types array');
    } else if (!rules.allowed_action_types.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 128)) {
      addError('agent_allowlist rules.allowed_action_types must be non-empty strings (<=128 chars)');
    }
    if (rules.action !== undefined && !['warn', 'require_approval', 'block'].includes(rules.action)) {
      addError('agent_allowlist rules.action must be one of warn, require_approval, block when present');
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
  require_evidence: (rules, addError) => {
    // Evidence-first (17th type). action_types scopes it (empty/absent = all);
    // enforcement is the escalation applied when a matching call was graded
    // from self-declared intent (no act attached). Both optional.
    if (rules.action_types !== undefined && !Array.isArray(rules.action_types)) {
      addError('require_evidence policy rules.action_types must be an array when present');
    }
    if (rules.enforcement !== undefined && !['warn', 'require_approval', 'block'].includes(rules.enforcement)) {
      addError('require_evidence policy rules.enforcement must be one of warn, require_approval, block when present');
    }
  },
  delegation_constraint: (rules, addError) => {
    // Authority attenuation for composed subagents (parent:child ids). All
    // fields optional except the matcher pair; only present checks enforce.
    if (rules.parent !== undefined && (typeof rules.parent !== 'string' || rules.parent.length === 0 || rules.parent.length > 128)) {
      addError('delegation_constraint rules.parent must be a non-empty string (<=128 chars) or omitted (treated as "*")');
    } else if (typeof rules.parent === 'string' && rules.parent.includes(':')) {
      // The evaluator compares parent against the BASE segment of a composed
      // id — a parent containing ':' can never match, so an active policy
      // would silently govern nothing. Fail the write instead.
      addError('delegation_constraint rules.parent must be a base agent id (no ":") — constraints match the segment before the first colon');
    }
    if (rules.child_types !== undefined && (!Array.isArray(rules.child_types) || rules.child_types.length === 0
      || !rules.child_types.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 64))) {
      addError('delegation_constraint rules.child_types must be a non-empty array of strings (<=64 chars) when present');
    }
    if (rules.max_risk_score !== undefined && (typeof rules.max_risk_score !== 'number' || rules.max_risk_score < 0 || rules.max_risk_score > 100)) {
      addError('delegation_constraint rules.max_risk_score must be a number 0-100');
    }
    for (const key of ['allowed_action_types', 'blocked_action_types']) {
      if (rules[key] !== undefined && rules[key] !== null
        && (!Array.isArray(rules[key]) || !rules[key].every((t) => typeof t === 'string' && t.length > 0 && t.length <= 128))) {
        addError(`delegation_constraint rules.${key} must be null or an array of non-empty strings`);
      }
      if (Array.isArray(rules[key]) && rules[key].length > 50) {
        addError(`delegation_constraint rules.${key} must have at most 50 entries`);
      }
    }
    if (rules.blocked_path_globs !== undefined
      && (!Array.isArray(rules.blocked_path_globs) || !rules.blocked_path_globs.every((p) => typeof p === 'string' && p.length > 0 && p.length <= 256))) {
      addError('delegation_constraint rules.blocked_path_globs must be an array of non-empty glob strings (<=256 chars)');
    }
    if (Array.isArray(rules.blocked_path_globs) && rules.blocked_path_globs.length > 50) {
      addError('delegation_constraint rules.blocked_path_globs must have at most 50 entries');
    }
    if (rules.max_depth !== undefined && (!Number.isInteger(rules.max_depth) || rules.max_depth < 1 || rules.max_depth > 8)) {
      addError('delegation_constraint rules.max_depth must be an integer 1-8');
    }
    if (rules.escalate_action !== undefined && !['require_approval', 'block'].includes(rules.escalate_action)) {
      addError('delegation_constraint rules.escalate_action must be require_approval or block (attenuation only tightens)');
    }
    if (rules.require_verified_parent !== undefined && typeof rules.require_verified_parent !== 'boolean') {
      addError('delegation_constraint rules.require_verified_parent must be a boolean');
    }
  },
};

// Dispatch via a Map so a user-controlled policy_type cannot reach an inherited
// prototype member (CodeQL js/unvalidated-dynamic-method-call). Object.entries
// captures only own enumerable keys; Map.get of an unknown key returns undefined.
const POLICY_TYPE_VALIDATOR_MAP = new Map(Object.entries(POLICY_TYPE_VALIDATORS));

// require_approval and block_action_type share the same action_types check; the
// error message names the actual policy type.
function validateActionTypesRequired(rules, addError, policyType) {
  if (!Array.isArray(rules.action_types) || rules.action_types.length === 0) {
    addError(`${policyType} policy requires rules.action_types array`);
  }
}

export function validatePolicy(body) {
  const safeBody = (body && typeof body === 'object') ? body : {};
  // Wire-format tolerance: accept the natural JSON shapes — rules as an object,
  // active as a boolean, agent_ids as an array — and normalize to the stored
  // forms (JSON strings / 0-1 integer) so raw-HTTP integrators aren't forced to
  // pre-stringify. The legacy string/integer forms keep working unchanged.
  const normalized = { ...safeBody };
  if (isPlainObject(safeBody.rules)) normalized.rules = JSON.stringify(safeBody.rules);
  if (typeof safeBody.active === 'boolean') normalized.active = safeBody.active ? 1 : 0;
  if (Array.isArray(safeBody.agent_ids)) normalized.agent_ids = JSON.stringify(safeBody.agent_ids);
  const result = validate(normalized, POLICY_SCHEMA);
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

  // CodeQL js/unvalidated-dynamic-method-call: membership guard (Map.has) plus a
  // typeof-function check before the dynamic invocation — the documented sanitizer.
  // Unknown/invalid policy_type → no validator runs.
  if (POLICY_TYPE_VALIDATOR_MAP.has(result.data.policy_type)) {
    const typeValidator = POLICY_TYPE_VALIDATOR_MAP.get(result.data.policy_type);
    if (typeof typeValidator === 'function') {
      typeValidator(rules, addError, result.data.policy_type);
    }
  }

  return result;
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

/**
 * Fleet attribution (v4.3): accept a client-supplied id string ≤ 200 chars,
 * else null. The repository re-applies the same bound as the authoritative gate.
 */
export function boundedIdField(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

/**
 * Client enforcement posture: the hook stamps how it will TREAT this guard
 * decision (enforce = blocks physically stop the tool call; observe = blocks
 * are logged only; warn = printed but not stopped). Attribution-only — never
 * affects evaluation — but it is the server's only window into whether the
 * client actually enforces. Unknown values normalize to null ("unreported"),
 * never to a mode: a garbled value must not read as either posture.
 */
const ENFORCEMENT_MODES = new Set(['enforce', 'observe', 'warn', 'off']);
export function enforcementModeField(value) {
  if (typeof value !== 'string') return null;
  const mode = value.trim().toLowerCase();
  return ENFORCEMENT_MODES.has(mode) ? mode : null;
}

export { ACTION_TYPES, ACTION_STATUSES, LOOP_TYPES, LOOP_STATUSES, LOOP_PRIORITIES, OUTCOME_FIELDS, POLICY_TYPES, DEFAULT_MAX_LENGTH };
