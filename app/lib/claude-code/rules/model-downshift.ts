/**
 * MODEL_DOWNSHIFT rule.
 * A session is a downshift candidate when:
 *   - model_primary is a premium-tier model (Opus or Fable family)
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
  // Premium tier = Opus or Fable family (fable-5 prices above opus 4.x).
  if (!/opus|fable/i.test(model)) return null;
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

  const tierLabel = /fable/i.test(model) ? 'Fable' : 'Opus';
  const premium = priceFor(model);
  const sonnet = priceFor('claude-sonnet-4-6');
  const premiumCost = (input * premium.input + output * premium.output + cacheWrite * premium.cache_write! + cacheRead * premium.cache_read!) / 1_000_000;
  const sonnetCost = (input * sonnet.input + output * sonnet.output + cacheWrite * sonnet.cache_write! + cacheRead * sonnet.cache_read!) / 1_000_000;
  const saving = premiumCost - sonnetCost;
  if (saving <= 0) return null;

  return {
    ruleId: ID,
    severity: 'info',
    title: `${tierLabel} session may have been overkill`,
    description: `This session ran on ${tierLabel} (${model}) with a mean output of ${meanOutput.toFixed(0)} tokens/message across ${messages} messages. Sonnet would likely have produced equivalent quality at roughly $${saving.toFixed(2)} cheaper.`,
    suggestedAction: 'Try the same goal on Sonnet next time, or set MODEL=claude-sonnet-4-6 for refactor/short-output sessions.',
    estimatedMonthlySavingsUsd: saving,
    evidence: {
      model,
      messages,
      meanOutput,
      opusCost: premiumCost,
      sonnetCost,
    },
  };
}

const RULE = { id: ID, inspect };
export default RULE;
