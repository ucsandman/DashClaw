/**
 * MODEL_DOWNSHIFT rule.
 * A session is a downshift candidate when:
 *   - model_primary is an Opus tier model
 *   - mean output tokens per message ≤ 1200
 *   - total usage ≤ 250k tokens
 *   - message_count ≥ 3 (excludes single-shot sessions)
 */

import { priceFor } from '../pricing';

const ID = 'MODEL_DOWNSHIFT';

// The session payload inspected by this rule — sourced from DB / aggregation,
// treated as dynamic external data.
type RuleContext = { session?: Record<string, any> } | null | undefined;

function inspect(context: RuleContext) {
  const session = context && context.session;
  if (!session) return null;
  const model = session.model_primary || '';
  if (!/opus/i.test(model)) return null;
  const messages = session.message_count || 0;
  if (messages < 3) return null;

  const input = session.input_tokens || 0;
  const output = session.output_tokens || 0;
  const cacheRead = session.cache_read_tokens || 0;
  const cacheWrite = session.cache_creation_tokens || 0;
  const totalUsage = input + output + cacheRead + cacheWrite;
  if (totalUsage > 250_000) return null;
  const meanOutput = output / messages;
  if (meanOutput > 1200) return null;

  const opus = priceFor(model);
  const sonnet = priceFor('claude-sonnet-4-6');
  const opusCost = (input * opus.input + output * opus.output + cacheWrite * opus.cache_write! + cacheRead * opus.cache_read!) / 1_000_000;
  const sonnetCost = (input * sonnet.input + output * sonnet.output + cacheWrite * sonnet.cache_write! + cacheRead * sonnet.cache_read!) / 1_000_000;
  const saving = opusCost - sonnetCost;
  if (saving <= 0) return null;

  return {
    ruleId: ID,
    severity: 'info',
    title: 'Opus session may have been overkill',
    description: `This session ran on Opus (${model}) with a mean output of ${meanOutput.toFixed(0)} tokens/message across ${messages} messages. Sonnet would likely have produced equivalent quality at roughly $${saving.toFixed(2)} cheaper.`,
    suggestedAction: 'Try the same goal on Sonnet next time, or set MODEL=claude-sonnet-4-6 for refactor/short-output sessions.',
    estimatedMonthlySavingsUsd: saving,
    evidence: {
      model,
      messages,
      meanOutput,
      opusCost,
      sonnetCost,
    },
  };
}

const RULE = { id: ID, inspect };
export default RULE;
