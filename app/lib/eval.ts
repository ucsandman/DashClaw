/**
 * Evaluation execution engine for DashClaw.
 *
 * Scorer types:
 * - regex, contains, numeric_range, custom_function: 100% LLM-free (pure code)
 * - llm_judge: OPTIONAL   requires AI provider configured via env vars
 *
 * DESIGN: Every scorer type except llm_judge works without any external dependency.
 * llm_judge gracefully returns an error when no provider is configured.
 */

import crypto from 'crypto';
import vm from 'node:vm';
import { isLLMAvailable, tryLLMComplete } from './llm';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

interface ScorerResult {
  score: number | null;
  label: string | null;
  reasoning: string | null;
  error: string | null;
}

interface Scorer {
  scorer_type?: string;
  config?: string | Record<string, unknown> | null;
}

// Scorer config and action rows are dynamic (parsed JSON / DB rows). Kept loose
// to mirror the runtime, which reads arbitrary fields by name.
type ScorerConfig = Record<string, any>;
type ActionRow = Record<string, any>;

function generateId(prefix: string): string {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Execute a single scorer against an action record.
 *
 * @param scorer - { scorer_type, config (JSON string or object) }
 * @param action - action_records row
 */
export function executeScorer(scorer: Scorer, action: ActionRow): ScorerResult | Promise<ScorerResult> {
  let config: ScorerConfig;
  try {
    config = typeof scorer.config === 'string' ? JSON.parse(scorer.config) : (scorer.config || {});
  } catch {
    return { score: null, label: null, reasoning: null, error: 'Invalid scorer config JSON' };
  }

  switch (scorer.scorer_type) {
    case 'regex':
      return _executeRegex(config, action);
    case 'contains':
      return _executeContains(config, action);
    case 'numeric_range':
      return _executeNumericRange(config, action);
    case 'custom_function':
      return _executeCustomFunction(config, action);
    case 'llm_judge':
      // Async   caller must await. Returns a promise.
      return _executeLLMJudge(config, action);
    default:
      return { score: null, label: null, reasoning: null, error: `Unknown scorer type: ${scorer.scorer_type}` };
  }
}

function _executeRegex(config: ScorerConfig, action: ActionRow): ScorerResult {
  try {
    // ReDoS guard: admin-supplied patterns can exhibit catastrophic backtracking
    // on crafted targets (e.g. /(a+)+b/ vs 'aaaa…aaaa'). Node's regex engine is
    // synchronous and has no built-in timeout, so run the match inside a vm
    // context with a 100ms ceiling — a runaway pattern aborts with a thrown
    // error rather than pegging the worker.
    const source = String(config.pattern || '');
    const flags = String(config.flags || 'i');
    const target = String(action.outcome || '').slice(0, 100_000);
    const matched = vm.runInNewContext(
      'new RegExp(src, flags).test(target)',
      { src: source, flags, target },
      { timeout: 100 }
    );
    return {
      score: matched ? (config.match_score ?? 1.0) : (config.no_match_score ?? 0.0),
      label: matched ? 'match' : 'no_match',
      reasoning: matched ? `Outcome matched pattern /${config.pattern}/` : `Outcome did not match pattern /${config.pattern}/`,
      error: null,
    };
  } catch (err) {
    return { score: null, label: null, reasoning: null, error: `Regex error: ${(err as Error).message}` };
  }
}

function _executeContains(config: ScorerConfig, action: ActionRow): ScorerResult {
  try {
    const keywords = config.keywords || [];
    const mode = config.mode || 'any';
    const target = String(action.outcome || '').toLowerCase();

    const matches = keywords.filter((kw: unknown) => target.includes(String(kw).toLowerCase()));
    const passed = mode === 'all' ? matches.length === keywords.length : matches.length > 0;

    return {
      score: passed ? (config.match_score ?? 1.0) : (config.no_match_score ?? 0.0),
      label: passed ? 'contains' : 'missing',
      reasoning: passed
        ? `Found keywords: ${matches.join(', ')}`
        : `Missing keywords (mode: ${mode}): ${keywords.filter((k: unknown) => !matches.includes(k)).join(', ')}`,
      error: null,
    };
  } catch (err) {
    return { score: null, label: null, reasoning: null, error: `Contains error: ${(err as Error).message}` };
  }
}

function _executeNumericRange(config: ScorerConfig, action: ActionRow): ScorerResult {
  try {
    const field = config.field || 'risk_score';
    const value = parseFloat(action[field]);

    if (isNaN(value)) {
      return { score: null, label: 'no_data', reasoning: `Field '${field}' is not a number`, error: null };
    }

    const min = config.min ?? -Infinity;
    const max = config.max ?? Infinity;
    const inRange = value >= min && value <= max;

    return {
      score: inRange ? (config.in_range_score ?? 1.0) : (config.out_of_range_score ?? 0.0),
      label: inRange ? 'in_range' : 'out_of_range',
      reasoning: `${field}=${value} ${inRange ? 'is' : 'is not'} in range [${min}, ${max}]`,
      error: null,
    };
  } catch (err) {
    return { score: null, label: null, reasoning: null, error: `Numeric range error: ${(err as Error).message}` };
  }
}

// A custom_function scorer's expression may reference only these five action
// fields (plus the literals true/false/null). IMPORTANT: node:vm is NOT a
// security sandbox — an expression like `this.constructor.constructor('return
// process')()` would escape the context and reach the host realm (process.env,
// require, the filesystem). So before the string ever reaches vm.Script we
// reject anything that could reach a host object: no computed member access
// (`[`/`]`), no template literals (backtick), no escapes (`\`), and every
// identifier OUTSIDE a string literal must be in the allow-list below. Ordinary
// scorers — `risk_score > 0.7 ? 1 : 0`, `outcome === 'success' ? 1 : 0` — pass.
const ALLOWED_SCORER_IDENTS = new Set([
  // the five exposed action fields + literals
  'outcome', 'action_type', 'risk_score', 'declared_goal', 'status',
  'true', 'false', 'null',
  // safe String/Number members + Math/Number globals so realistic scorers work
  // (`outcome.length`, `Math.max(risk_score, 0)`). None of these reach a
  // constructor: the escape names constructor/__proto__/prototype/Function/eval/
  // require/process/globalThis are simply ABSENT from this allow-list, so an
  // expression that references any of them is rejected (deny-by-default).
  'length', 'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf',
  'slice', 'substring', 'charAt', 'toLowerCase', 'toUpperCase', 'trim',
  'toFixed', 'toString',
  'Math', 'Number', 'parseInt', 'parseFloat', 'isNaN',
  'abs', 'min', 'max', 'round', 'floor', 'ceil', 'pow', 'sqrt', 'sign',
]);

function _isSafeScorerExpression(expr: string): boolean {
  if (typeof expr !== 'string' || expr.length === 0 || expr.length > 500) return false;
  if (/[[\]`\\]/.test(expr)) return false; // no computed member access, template literals, or escapes
  let i = 0;
  while (i < expr.length) {
    const c = expr[i] as string;
    if (c === '"' || c === "'") {
      // Skip a string literal — its contents are inert data (escapes banned above).
      const quote = c;
      i++;
      while (i < expr.length && expr[i] !== quote) i++;
      if (i >= expr.length) return false; // unterminated string
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_$]/.test(expr[j] as string)) j++;
      if (!ALLOWED_SCORER_IDENTS.has(expr.slice(i, j))) return false;
      i = j;
      continue;
    }
    i++;
  }
  return true;
}

function _executeCustomFunction(config: ScorerConfig, action: ActionRow): ScorerResult {
  try {
    const expression = config.expression || 'null';
    // Restrict to a numeric/comparison expression over the five action fields
    // BEFORE it reaches the (non-sandbox) vm — see _isSafeScorerExpression.
    if (!_isSafeScorerExpression(expression)) {
      return {
        score: null,
        label: null,
        reasoning: null,
        error: 'Custom expression rejected: only outcome, action_type, risk_score, declared_goal, status with numeric/comparison operators are allowed',
      };
    }
    const context = vm.createContext({
      outcome: action.outcome || '',
      action_type: action.action_type || '',
      risk_score: parseFloat(action.risk_score) || 0,
      declared_goal: action.declared_goal || '',
      status: action.status || '',
    });
    const script = new vm.Script(`'use strict'; (${expression})`);
    let result = script.runInContext(context, { timeout: 100, displayErrors: false });

    if (typeof result !== 'number' || isNaN(result)) {
      return { score: null, label: null, reasoning: `Expression returned non-number: ${result}`, error: null };
    }

    // Clamp to 0.0-1.0
    result = Math.max(0, Math.min(1, result));

    return {
      score: result,
      label: result >= 0.5 ? 'pass' : 'fail',
      reasoning: `Custom expression returned ${result}`,
      error: null,
    };
  } catch (err) {
    return { score: null, label: null, reasoning: null, error: `Custom function error: ${(err as Error).message}` };
  }
}

async function _executeLLMJudge(config: ScorerConfig, action: ActionRow): Promise<ScorerResult> {
  if (!isLLMAvailable()) {
    return {
      score: null,
      label: null,
      reasoning: null,
      error:
        'AI provider not configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY to enable LLM-as-judge scoring.',
    };
  }

  const template = config.prompt_template || `Rate the quality of this agent action from 0.0 to 1.0.

Action: {action_type}
Goal: {declared_goal}
Outcome: {outcome}
Status: {status}

Respond with JSON: { "score": number, "label": string, "reasoning": string }`;

  const prompt = template
    .replace('{action_type}', action.action_type || '')
    .replace('{declared_goal}', action.declared_goal || '')
    .replace('{outcome}', action.outcome || '')
    .replace('{status}', action.status || '')
    .replace('{risk_score}', String(action.risk_score || ''))
    .replace('{agent_id}', action.agent_id || '');

  const { result, error } = await tryLLMComplete(prompt, {
    maxTokens: 300,
    temperature: 0,
    model: config.model,
  });

  if (error) {
    return { score: null, label: null, reasoning: null, error: `LLM judge error: ${error}` };
  }

  // Parse the LLM response   try JSON first, then extract a number
  try {
    const parsed = JSON.parse(result as string);
    const score = Math.max(0, Math.min(1, parseFloat(parsed.score) || 0));
    return {
      score,
      label: parsed.label || (score >= 0.5 ? 'pass' : 'fail'),
      reasoning: parsed.reasoning || result,
      error: null,
    };
  } catch {
    // Fallback: try to extract a number from the response
    const numMatch = result?.match(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/);
    if (numMatch) {
      const score = parseFloat(numMatch[1] as string);
      return { score, label: score >= 0.5 ? 'pass' : 'fail', reasoning: result, error: null };
    }
    return { score: null, label: null, reasoning: result, error: 'Could not parse score from LLM response' };
  }
}

/**
 * Execute a full evaluation run: score all matching actions with a scorer.
 *
 * @param sql - DB connection
 * @param orgId
 * @param runId
 */
export async function executeEvalRun(
  sql: SqlClient,
  orgId: string,
  runId: string,
): Promise<{ success: boolean; scored: number; errors: number; avgScore: number | null } | undefined> {
  // Fetch run details. es.name is aliased — er.* already carries the RUN's
  // `name`, and writing that into eval_scores.scorer_name (the old bug) broke
  // the scorer filter + by_scorer stats for every run-generated score.
  const [run] = (await sql`
    SELECT er.*, es.scorer_type, es.config AS scorer_config, es.name AS scorer_display_name
    FROM eval_runs er
    LEFT JOIN eval_scorers es ON er.scorer_id = es.id
    WHERE er.id = ${runId} AND er.org_id = ${orgId}
  `) as Array<Record<string, any>>;

  if (!run) {
    return { success: false, scored: 0, errors: 1, avgScore: null };
  }

  // Check if llm_judge without LLM
  if (run.scorer_type === 'llm_judge' && !isLLMAvailable()) {
    await sql`
      UPDATE eval_runs SET
        status = 'failed',
        error_message = 'AI provider not configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY to enable LLM-as-judge scoring.',
        completed_at = ${new Date().toISOString()}
      WHERE id = ${runId} AND org_id = ${orgId}
    `;
    return { success: false, scored: 0, errors: 1, avgScore: null };
  }

  // Atomic compare-and-set: only transition to running if still pending.
  // A duplicate POST (double-click, retry) would otherwise reset a
  // completed/running row back to running and double-write eval_scores.
  const transitioned = await sql`
    UPDATE eval_runs SET status = 'running', started_at = ${new Date().toISOString()}
    WHERE id = ${runId} AND org_id = ${orgId} AND status = 'pending'
    RETURNING id
  `;
  if (transitioned.length === 0) {
    // Another executor won the race or the run was already finalized.
    // Bail out silently — no scores will be written under this handle.
    return;
  }

  // Build action query from filter_criteria
  let filterCriteria: Record<string, any> = {};
  try {
    filterCriteria = run.filter_criteria ? JSON.parse(run.filter_criteria) : {};
  } catch { /* ignore parse errors */ }

  // Fetch matching actions
  let actions: Array<Record<string, any>>;
  if (filterCriteria.agent_id) {
    actions = (await sql`
      SELECT * FROM action_records
      WHERE org_id = ${orgId} AND agent_id = ${filterCriteria.agent_id}
      ORDER BY timestamp_start DESC
      LIMIT 500
    `) as Array<Record<string, any>>;
  } else {
    actions = (await sql`
      SELECT * FROM action_records
      WHERE org_id = ${orgId}
      ORDER BY timestamp_start DESC
      LIMIT 500
    `) as Array<Record<string, any>>;
  }

  const scorer: Scorer = {
    scorer_type: run.scorer_type,
    config: run.scorer_config,
  };

  let scored = 0;
  let errors = 0;
  let totalScore = 0;
  const now = new Date().toISOString();

  // Update total
  await sql`UPDATE eval_runs SET total_actions = ${actions.length} WHERE id = ${runId} AND org_id = ${orgId}`;

  for (const action of actions) {
    let result: ScorerResult;
    if (scorer.scorer_type === 'llm_judge') {
      result = await executeScorer(scorer, action);
    } else {
      result = executeScorer(scorer, action) as ScorerResult;
    }

    if (result.error || result.score === null) {
      errors++;
      continue;
    }

    const scoreId = generateId('ev_');
    await sql`
      INSERT INTO eval_scores (id, org_id, action_id, scorer_id, run_id, scorer_name, score, label, reasoning, evaluated_by, created_at)
      VALUES (
        ${scoreId}, ${orgId}, ${action.action_id || action.id},
        ${run.scorer_id}, ${runId}, ${run.scorer_display_name || 'unnamed'},
        ${result.score}, ${result.label}, ${result.reasoning},
        ${scorer.scorer_type === 'llm_judge' ? 'llm_judge' : 'auto'},
        ${now}
      )
    `;

    totalScore += result.score;
    scored++;

    // Update progress every 10 items
    if (scored % 10 === 0) {
      await sql`
        UPDATE eval_runs SET scored_count = ${scored}
        WHERE id = ${runId} AND org_id = ${orgId}
      `;
    }
  }

  const avgScore = scored > 0 ? totalScore / scored : null;

  // Finalize
  await sql`
    UPDATE eval_runs SET
      status = 'completed',
      scored_count = ${scored},
      avg_score = ${avgScore},
      summary = ${JSON.stringify({ scored, errors, avg_score: avgScore })},
      completed_at = ${new Date().toISOString()}
    WHERE id = ${runId} AND org_id = ${orgId}
  `;

  return { success: true, scored, errors, avgScore };
}
