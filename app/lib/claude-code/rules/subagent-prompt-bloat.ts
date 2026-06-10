/**
 * SUBAGENT_PROMPT_BLOAT rule. Heuristic: identical previews across multiple
 * subagent-style invocations suggest a shared prefix above the threshold.
 */

import { priceFor } from '../pricing';

interface SubagentInvocation {
  parentTool?: string | null;
  prefixHash?: string | null;
  prefix?: string | null;
  prefixTokens?: number | null;
}

interface SessionLike {
  model_primary?: string | null;
}

interface RuleContext {
  subagentInvocations?: SubagentInvocation[] | null;
  session?: SessionLike | null;
}

interface OffenderGroup {
  count: number;
  prefixTokens: number;
  parentTool: string;
}

interface RuleFinding {
  ruleId: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction: string;
  estimatedMonthlySavingsUsd: number;
  evidence: { offenders: OffenderGroup[] };
}

interface Rule {
  id: string;
  inspect: (context: RuleContext | null | undefined) => RuleFinding | null;
}

const ID = 'SUBAGENT_PROMPT_BLOAT';
export const PREFIX_THRESHOLD_TOKENS = 8000;
export const MIN_INVOCATIONS = 2;

function inspect(context: RuleContext | null | undefined): RuleFinding | null {
  const invocations = (context && context.subagentInvocations) || [];
  if (invocations.length < MIN_INVOCATIONS) return null;

  const groups = new Map<string, OffenderGroup>();
  for (const inv of invocations) {
    const key = `${inv.parentTool || 'Agent'}::${(inv.prefixHash || inv.prefix || '').slice(0, 64)}`;
    const entry = groups.get(key) || { count: 0, prefixTokens: inv.prefixTokens || 0, parentTool: inv.parentTool || 'Agent' };
    entry.count += 1;
    entry.prefixTokens = Math.max(entry.prefixTokens, inv.prefixTokens || 0);
    groups.set(key, entry);
  }

  const offenders: OffenderGroup[] = [];
  for (const [, g] of groups) {
    if (g.count >= MIN_INVOCATIONS && g.prefixTokens >= PREFIX_THRESHOLD_TOKENS) {
      offenders.push(g);
    }
  }
  if (!offenders.length) return null;

  const session = context && context.session;
  const p = priceFor(session && session.model_primary);
  let est = 0;
  for (const o of offenders) {
    // Approximate saving from trimming the shared prefix in half:
    const tokensTrimmable = o.prefixTokens * 0.5 * o.count;
    est += (tokensTrimmable * p.input) / 1_000_000;
  }

  return {
    ruleId: ID,
    severity: 'warn',
    title: 'Subagent prompts are reusing a large shared prefix',
    description: `${offenders.length} subagent prompt group(s) share a prefix above ${PREFIX_THRESHOLD_TOKENS} tokens across ${offenders.reduce((a, o) => a + o.count, 0)} invocations.`,
    suggestedAction: 'Trim the shared subagent prefix: drop redundant context, move stable instructions to a system prompt, or use prompt caching with a fixed prefix.',
    estimatedMonthlySavingsUsd: est,
    evidence: { offenders },
  };
}

const RULE: Rule = { id: ID, inspect };
export default RULE;
