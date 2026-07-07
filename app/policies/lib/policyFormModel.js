const DEFAULT_FORM_STATE = {
  name: '',
  type: 'risk_threshold',
  action: 'block',
  threshold: 80,
  actionTypes: [],
  maxActions: 50,
  windowMinutes: 60,
  webhookUrl: '',
  webhookTimeout: 5000,
  webhookOnTimeout: 'require_approval',
  instruction: '',
  fallback: 'require_approval',
  // non_fabrication
  contentPath: 'content',
  sourcePath: 'source_of_truth',
  onViolation: 'block',
  // behavioral_anomaly
  similarityThreshold: 0.75,
  minHistory: 5,
  // permission_escalation
  enforce: true,
  // green_contract
  requiredLevel: 'workspace',
  // branch_freshness
  freshness: ['stale', 'diverged'],
  maxCommitsBehind: 0,
  // protected_path (Behavior Learning)
  protectedPaths: [],
  // agent_allowlist (Behavior Learning)
  allowedActionTypes: [],
  // require_evidence
  enforcement: 'require_approval',
  agentIds: [],
  // allow_grant
  actionType: '',
  targetPrefix: '',
  // optional inline test recipes (A1): [{ name, input, expect: { decision } }]
  tests: [],
};

// Single source of truth for the policy-type picker (label + one-line
// description), shared by the manual authoring panel and the generated-draft
// editor so both expose every backend-enforced type. Mirrors the canonical
// POLICY_TYPES list in app/lib/validate.js.
export const POLICY_TYPE_OPTIONS = [
  { value: 'risk_threshold', label: 'Risk Threshold', desc: 'Block or warn when risk score exceeds a threshold' },
  { value: 'require_approval', label: 'Require Approval', desc: 'Require approval for specific action types' },
  { value: 'block_action_type', label: 'Block Action Type', desc: 'Block specific action types entirely' },
  { value: 'warn_action_type', label: 'Warn Action Type', desc: 'Warn (but allow) when specific action types are attempted' },
  { value: 'allow_grant', label: 'Allow Grant', desc: 'Explicitly allow an action type, optionally scoped to a target prefix' },
  { value: 'rate_limit', label: 'Rate Limit', desc: 'Warn or block when an agent exceeds action frequency' },
  { value: 'webhook_check', label: 'Webhook Check', desc: 'Call an external endpoint for custom decision logic' },
  { value: 'permission_escalation', label: 'Permission Escalation', desc: 'Block actions whose required tool permission exceeds the agent’s approved pairing level' },
  { value: 'green_contract', label: 'Green Contract', desc: 'Gate actions (e.g. deploy) until tests reach a required green level' },
  { value: 'branch_freshness', label: 'Branch Freshness', desc: 'Block actions when the branch is stale/diverged or too many commits behind' },
  { value: 'non_fabrication', label: 'Non-Fabrication', desc: 'Block or route to approval outbound content that states a fact not traceable to its source-of-truth' },
  { value: 'protected_path', label: 'Protected Path', desc: 'Warn or require approval when an action touches sensitive paths (auth, secrets, billing, middleware, …)' },
  { value: 'agent_allowlist', label: 'Agent Allowlist', desc: 'Warn (or escalate) when an agent uses an action type outside its observed safe envelope' },
  { value: 'require_evidence', label: 'Evidence Required', desc: 'Escalate guard calls that declare intent without attaching the actual act (command, request, statement, or file write)' },
];

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseAgentIds(policy) {
  if (!policy?.agent_ids) return [];
  try {
    const parsed = JSON.parse(policy.agent_ids);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseRules(policy) {
  try {
    return JSON.parse(policy?.rules || policy?.config || '{}');
  } catch {
    return {};
  }
}

function actionListText(actionTypes = []) {
  const cleaned = Array.isArray(actionTypes)
    ? actionTypes.map((type) => cleanString(type)).filter(Boolean)
    : [];

  if (cleaned.length === 0) return 'selected actions';
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned.at(-1)}`;
}

function scopeText(agentIds = []) {
  return Array.isArray(agentIds) && agentIds.length > 0
    ? ` for ${agentIds.length} selected agent${agentIds.length === 1 ? '' : 's'}`
    : '';
}

export function createDefaultPolicyFormState() {
  return JSON.parse(JSON.stringify(DEFAULT_FORM_STATE));
}

// --- Small shared predicates/helpers (keep each compiler/summary builder flat) ---

// A numeric/text field counts as "present" when it is neither '' nor null/undefined.
const hasValue = (value) => value !== '' && value != null;

// filter(Boolean) only — drops falsy entries without trimming (summary counts).
const cleanList = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

// trim each entry then drop empties (compile payload for the protected_path list).
const cleanStringList = (value) =>
  (Array.isArray(value) ? value.map((entry) => cleanString(entry)).filter(Boolean) : []);

// Capitalized leading verb shared by most summaries ("Block" / "Warn on" /
// "Require approval for"). rate_limit uses a "when"-suffixed variant inline.
function actionVerb(action) {
  if (action === 'block') return 'Block';
  if (action === 'warn') return 'Warn on';
  return 'Require approval for';
}

function serializeAgentIds(agentIds) {
  return Array.isArray(agentIds) && agentIds.length > 0 ? JSON.stringify(agentIds) : null;
}

// --- Per-type handlers --------------------------------------------------------
// One entry per policy type, co-locating the two type-specific concerns:
//   compile(form)          -> the stored `rules` object
//   summary(form, scoped)  -> the human-readable sentence
// A single enumeration keeps both dispatchers flat (no per-function switch) and
// avoids two parallel type tables drifting apart.
const POLICY_TYPE_HANDLERS = {
  risk_threshold: {
    compile: (form) => ({ threshold: Number(form.threshold) || 0, action: form.action }),
    summary: (form, scoped) =>
      `${actionVerb(form.action)} actions when risk is ${Number(form.threshold) || 0} or higher${scoped}.`,
  },
  require_approval: {
    compile: (form) => ({ action_types: form.actionTypes || [], action: 'require_approval' }),
    summary: (form, scoped) => `Require approval for ${actionListText(form.actionTypes)} actions${scoped}.`,
  },
  block_action_type: {
    compile: (form) => ({ action_types: form.actionTypes || [], action: 'block' }),
    summary: (form, scoped) => `Block ${actionListText(form.actionTypes)} actions entirely${scoped}.`,
  },
  warn_action_type: {
    compile: (form) => ({ action_types: form.actionTypes || [] }),
    summary: (form, scoped) => `Warn on ${actionListText(form.actionTypes)} actions${scoped}.`,
  },
  allow_grant: {
    compile: (form) => {
      const rules = { action_type: cleanString(form.actionType) || '' };
      const prefix = cleanString(form.targetPrefix);
      if (prefix) rules.target_prefix = prefix;
      return rules;
    },
    summary: (form, scoped) => {
      const base = `Explicitly allow ${cleanString(form.actionType) || 'the action type'}`;
      const prefix = cleanString(form.targetPrefix);
      return `${base}${prefix ? ` to ${prefix}` : ''}${scoped}.`;
    },
  },
  rate_limit: {
    compile: (form) => ({
      max_actions: Number(form.maxActions) || 1,
      window_minutes: Number(form.windowMinutes) || 1,
      action: form.action,
    }),
    summary: (form, scoped) =>
      `${form.action === 'block' ? 'Block' : form.action === 'warn' ? 'Warn when' : 'Require approval when'} an agent exceeds ${Number(form.maxActions) || 1} actions in ${Number(form.windowMinutes) || 1} minutes${scoped}.`,
  },
  webhook_check: {
    compile: (form) => ({
      url: cleanString(form.webhookUrl),
      timeout_ms: Number(form.webhookTimeout) || 5000,
      on_timeout: form.webhookOnTimeout || 'require_approval',
    }),
    summary: (form, scoped) => {
      let host = cleanString(form.webhookUrl);
      try {
        host = new URL(form.webhookUrl).hostname;
      } catch {
        // keep raw string
      }
      return `Call ${host || 'the configured webhook'} before allowing the action. If the webhook times out, ${form.webhookOnTimeout || 'require_approval'} the action${scoped}.`;
    },
  },
  non_fabrication: {
    compile: (form) => ({
      ...(Array.isArray(form.actionTypes) && form.actionTypes.length > 0
        ? { action_types: form.actionTypes }
        : {}),
      content_path: cleanString(form.contentPath) || 'content',
      source_path: cleanString(form.sourcePath) || 'source_of_truth',
      on_violation: form.onViolation === 'require_approval' ? 'require_approval' : 'block',
    }),
    summary: (form, scoped) => {
      const nfScope = Array.isArray(form.actionTypes) && form.actionTypes.length > 0
        ? `${actionListText(form.actionTypes)} actions`
        : 'any action';
      return `${form.onViolation === 'require_approval' ? 'Require approval for' : 'Block'} ${nfScope} whose outbound content states a fact not traceable to its source-of-truth${scoped}.`;
    },
  },
  permission_escalation: {
    compile: (form) => ({ enforce: !!form.enforce, action: form.action }),
    summary: (form, scoped) =>
      form.enforce
        ? `${actionVerb(form.action)} actions whose required tool permission exceeds the agent’s approved pairing level${scoped}.`
        : `Permission-escalation policy is configured but disabled — set Enforce to activate it${scoped}.`,
  },
  green_contract: {
    compile: (form) => ({
      action_types: form.actionTypes || [],
      required_level: form.requiredLevel || 'workspace',
      action: form.action,
    }),
    summary: (form, scoped) =>
      `${actionVerb(form.action)} ${actionListText(form.actionTypes)} actions unless test status has reached “${form.requiredLevel || 'workspace'}”${scoped}.`,
  },
  branch_freshness: {
    compile: (form) => ({
      action_types: form.actionTypes || [],
      freshness: Array.isArray(form.freshness) && form.freshness.length > 0
        ? form.freshness
        : ['stale', 'diverged'],
      max_commits_behind: Math.max(0, Number(form.maxCommitsBehind) || 0),
      action: form.action,
    }),
    summary: (form, scoped) => {
      const states = (Array.isArray(form.freshness) ? form.freshness : ['stale', 'diverged']).join(' or ');
      return `${actionVerb(form.action)} ${actionListText(form.actionTypes)} actions when the branch is ${states} and more than ${Number(form.maxCommitsBehind) || 0} commits behind${scoped}.`;
    },
  },
  protected_path: {
    compile: (form) => ({
      paths: cleanStringList(form.protectedPaths),
      action: form.action === 'block' || form.action === 'warn' ? form.action : 'require_approval',
    }),
    summary: (form, scoped) => {
      const count = cleanList(form.protectedPaths).length;
      return `${actionVerb(form.action)} actions that touch ${count > 0 ? `${count} protected path pattern${count === 1 ? '' : 's'}` : 'protected paths'}${scoped}.`;
    },
  },
  agent_allowlist: {
    compile: (form) => ({
      allowed_action_types: cleanStringList(form.allowedActionTypes),
      // warn is the engine default; 'allow' would be a silent no-op so it is excluded.
      action: form.action === 'block' || form.action === 'require_approval' ? form.action : 'warn',
    }),
    summary: (form, scoped) => {
      const count = cleanList(form.allowedActionTypes).length;
      const verb = form.action === 'block' ? 'Block' : form.action === 'require_approval' ? 'Require approval for' : 'Warn on';
      return `${verb} actions whose type is outside the agent’s allowlist${count > 0 ? ` of ${count} action type${count === 1 ? '' : 's'}` : ''}${scoped}.`;
    },
  },
  require_evidence: {
    compile: (form) => ({
      action_types: cleanStringList(form.actionTypes),
      enforcement: form.enforcement === 'warn' || form.enforcement === 'block' ? form.enforcement : 'require_approval',
    }),
    summary: (form, scoped) => {
      const verb = form.enforcement === 'block' ? 'Block' : form.enforcement === 'warn' ? 'Warn on' : 'Require approval for';
      return `${verb} ${actionListText(form.actionTypes)} guard calls that declare intent without attaching the actual act${scoped}.`;
    },
  },
};

// --- Form state -> stored policy payload (compile) ---

export function compilePolicyPayload(formState) {
  const form = {
    ...createDefaultPolicyFormState(),
    ...formState,
  };

  const handler = POLICY_TYPE_HANDLERS[form.type];
  const rules = handler ? handler.compile(form) : {};

  // Carry optional inline test recipes through unchanged so they persist into
  // the stored rules JSON and feed POST /api/policies/test.
  if (Array.isArray(form.tests) && form.tests.length > 0) {
    rules.tests = form.tests;
  }

  return {
    name: cleanString(form.name),
    policy_type: form.type,
    rules: JSON.stringify(rules),
    agent_ids: serializeAgentIds(form.agentIds),
  };
}

// --- Stored policy -> form state (decompile) ---

// `||` truthy-fallback, `??` nullish-fallback, and array-or-default — each kept
// as a named helper so the field-by-field decode below stays flat (no inline
// conditionals contributing to this function's complexity).
const orVal = (value, fallback) => value || fallback;
const coalesce = (value, fallback) => value ?? fallback;
const arrOr = (value, fallback) => (Array.isArray(value) ? value : fallback);
const enforceOf = (rules) => (rules.enforce !== undefined ? !!rules.enforce : DEFAULT_FORM_STATE.enforce);

export function decompilePolicyForm(policy) {
  const rules = parseRules(policy);
  const policyType = policy?.policy_type || policy?.type || DEFAULT_FORM_STATE.type;

  return {
    ...createDefaultPolicyFormState(),
    name: cleanString(policy?.name),
    type: policyType,
    action: orVal(rules.action, 'block'),
    threshold: coalesce(rules.threshold, DEFAULT_FORM_STATE.threshold),
    actionTypes: arrOr(rules.action_types, []),
    maxActions: orVal(rules.max_actions, DEFAULT_FORM_STATE.maxActions),
    windowMinutes: orVal(rules.window_minutes, DEFAULT_FORM_STATE.windowMinutes),
    webhookUrl: orVal(rules.url, ''),
    webhookTimeout: orVal(rules.timeout_ms, DEFAULT_FORM_STATE.webhookTimeout),
    webhookOnTimeout: orVal(rules.on_timeout, DEFAULT_FORM_STATE.webhookOnTimeout),
    instruction: orVal(rules.instruction, ''),
    fallback: orVal(rules.fallback, DEFAULT_FORM_STATE.fallback),
    contentPath: orVal(rules.content_path, DEFAULT_FORM_STATE.contentPath),
    sourcePath: orVal(rules.source_path, DEFAULT_FORM_STATE.sourcePath),
    onViolation: orVal(rules.on_violation, DEFAULT_FORM_STATE.onViolation),
    similarityThreshold: coalesce(rules.similarity_threshold, DEFAULT_FORM_STATE.similarityThreshold),
    minHistory: coalesce(rules.min_history, DEFAULT_FORM_STATE.minHistory),
    enforce: enforceOf(rules),
    requiredLevel: orVal(rules.required_level, DEFAULT_FORM_STATE.requiredLevel),
    freshness: arrOr(rules.freshness, DEFAULT_FORM_STATE.freshness),
    maxCommitsBehind: coalesce(rules.max_commits_behind, DEFAULT_FORM_STATE.maxCommitsBehind),
    actionType: orVal(rules.action_type, ''),
    targetPrefix: orVal(rules.target_prefix, ''),
    protectedPaths: arrOr(rules.paths, DEFAULT_FORM_STATE.protectedPaths),
    allowedActionTypes: arrOr(rules.allowed_action_types, DEFAULT_FORM_STATE.allowedActionTypes),
    tests: arrOr(rules.tests, []),
    agentIds: parseAgentIds(policy),
  };
}

// --- Form state -> human-readable summary ---

export function buildPolicySummary(formState) {
  const form = {
    ...createDefaultPolicyFormState(),
    ...formState,
  };
  const scoped = scopeText(form.agentIds);

  const handler = POLICY_TYPE_HANDLERS[form.type];
  return handler ? handler.summary(form, scoped) : 'Configure a policy rule.';
}
