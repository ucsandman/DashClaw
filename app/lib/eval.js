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
import { isLLMAvailable, tryLLMComplete } from './llm.js';

function generateId(prefix) {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Execute a single scorer against an action record.
 *
 * @param {Object} scorer - { scorer_type, config (JSON string or object) }
 * @param {Object} action - action_records row
 * @returns {{ score: number|null, label: string|null, reasoning: string|null, error: string|null }}
 */
export function executeScorer(scorer, action) {
  let config;
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

function _executeRegex(config, action) {
  try {
    const pattern = new RegExp(config.pattern || '', config.flags || 'i');
    const target = String(action.outcome || '');
    const matched = pattern.test(target);
    return {
      score: matched ? (config.match_score ?? 1.0) : (config.no_match_score ?? 0.0),
      label: matched ? 'match' : 'no_match',
      reasoning: matched ? `Outcome matched pattern /${config.pattern}/` : `Outcome did not match pattern /${config.pattern}/`,
      error: null,
    };
  } catch (err) {
    return { score: null, label: null, reasoning: null, error: `Regex error: ${err.message}` };
  }
}

function _executeContains(config, action) {
  try {
    const keywords = config.keywords || [];
    const mode = config.mode || 'any';
    const target = String(action.outcome || '').toLowerCase();

    const matches = keywords.filter((kw) => target.includes(String(kw).toLowerCase()));
    const passed = mode === 'all' ? matches.length === keywords.length : matches.length > 0;

    return {
      score: passed ? (config.match_score ?? 1.0) : (config.no_match_score ?? 0.0),
      label: passed ? 'contains' : 'missing',
      reasoning: passed
        ? `Found keywords: ${matches.join(', ')}`
        : `Missing keywords (mode: ${mode}): ${keywords.filter((k) => !matches.includes(k)).join(', ')}`,
      error: null,
    };
  } catch (err) {
    return { score: null, label: null, reasoning: null, error: `Contains error: ${err.message}` };
  }
}

function _executeNumericRange(config, action) {
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
    return { score: null, label: null, reasoning: null, error: `Numeric range error: ${err.message}` };
  }
}

function _executeCustomFunction(config, action) {
  try {
    const expression = config.expression || 'null';
    // Safe sandbox: only pass specific action fields as arguments
    const fn = new Function(
      'outcome', 'action_type', 'risk_score', 'declared_goal', 'status',
      `'use strict'; return (${expression});`
    );

    let result = fn(
      action.outcome || '',
      action.action_type || '',
      parseFloat(action.risk_score) || 0,
      action.declared_goal || '',
      action.status || ''
    );

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
    return { score: null, label: null, reasoning: null, error: `Custom function error: ${err.message}` };
  }
}

async function _executeLLMJudge(config, action) {
  if (!isLLMAvailable()) {
    return {
      score: null,
      label: null,
      reasoning: null,
      error:
        'AI provider not configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY to enable LLM-as-judge scoring.',
    };
  }

  const template = config.prompt_template || 'Rate the quality of this agent action from 0.0 to 1.0.

Action: {action_type}
Goal: {declared_goal}
Outcome: {outcome}
Status: {status}

Respond with JSON: { "score": number, "label": string, "reasoning": string }';

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
    const parsed = JSON.parse(result);
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
      const score = parseFloat(numMatch[1]);
      return { score, label: score >= 0.5 ? 'pass' : 'fail', reasoning: result, error: null };
    }
    return { score: null, label: null, reasoning: result, error: 'Could not parse score from LLM response' };
  }
}

/**
 * Execute a full evaluation run: score all matching actions with a scorer.
 *
 * @param {Function} sql - DB connection
 * @param {string} orgId
 * @param {string} runId
 * @returns {Promise<{ success: boolean, scored: number, errors: number, avgScore: number|null }>}
 */
export async function executeEvalRun(sql, orgId, runId) {
  // Fetch run details
  const [run] = await sql`
    SELECT er.*, es.scorer_type, es.config AS scorer_config
    FROM eval_runs er
    LEFT JOIN eval_scorers es ON er.scorer_id = es.id
    WHERE er.id = ${runId} AND er.org_id = ${orgId}
  `;

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
      WHERE id = ${runId}
    `;
    return { success: false, scored: 0, errors: 1, avgScore: null };
  }

  // Mark as running
  await sql`
    UPDATE eval_runs SET status = 'running', started_at = ${new Date().toISOString()}
    WHERE id = ${runId}
  `;

  // Build action query from filter_criteria
  let filterCriteria = {};
  try {
    filterCriteria = run.filter_criteria ? JSON.parse(run.filter_criteria) : {};
  } catch { /* ignore parse errors */ }

  // Fetch matching actions
  let actions;
  if (filterCriteria.agent_id) {
    actions = await sql`
      SELECT * FROM action_records
      WHERE org_id = ${orgId} AND agent_id = ${filterCriteria.agent_id}
      ORDER BY timestamp_start DESC
      LIMIT 500
    `;
  } else {
    actions = await sql`
      SELECT * FROM action_records
      WHERE org_id = ${orgId}
      ORDER BY timestamp_start DESC
      LIMIT 500
    `;
  }

  const scorer = {
    scorer_type: run.scorer_type,
    config: run.scorer_config,
  };

  let scored = 0;
  let errors = 0;
  let totalScore = 0;
  const now = new Date().toISOString();

  // Update total
  await sql`UPDATE eval_runs SET total_actions = ${actions.length} WHERE id = ${runId}`;

  for (const action of actions) {
    let result;
    if (scorer.scorer_type === 'llm_judge') {
      result = await executeScorer(scorer, action);
    } else {
      result = executeScorer(scorer, action);
    }

    if (result.error || result.score === null) {
      errors++;
      continue;
    }

    const scoreId = generateId('ev_');
    await sql`
      INSERT INTO eval_scores (id, org_id, action_id, scorer_id, scorer_name, score, label, reasoning, evaluated_by, created_at)
      VALUES (
        ${scoreId}, ${orgId}, ${action.action_id || action.id},
        ${run.scorer_id}, ${run.name || 'unnamed'},
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
        WHERE id = ${runId}
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
    WHERE id = ${runId}
  `;

  return { success: true, scored, errors, avgScore };
}
