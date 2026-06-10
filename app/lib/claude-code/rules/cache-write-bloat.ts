/**
 * CACHE_WRITE_BLOAT rule. Fires when cache writes outnumber reads by 3×+,
 * suggesting prompt-prefix churn that invalidates the cache every turn.
 */

import { priceFor } from '../pricing';

interface SessionLike {
  cache_creation_tokens?: number | null;
  cache_read_tokens?: number | null;
  model_primary?: string | null;
}

interface RuleContext {
  session?: SessionLike | null;
}

interface RuleFinding {
  ruleId: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction: string;
  estimatedMonthlySavingsUsd: number | null;
  evidence: {
    ratio: number | null;
    cacheWrite: number;
    cacheRead: number;
    excess: number;
    model: string | null | undefined;
  };
}

interface Rule {
  id: string;
  inspect: (context: RuleContext | null | undefined) => RuleFinding | null;
}

const ID = 'CACHE_WRITE_BLOAT';
const RATIO_THRESHOLD = 3.0;

function inspect(context: RuleContext | null | undefined): RuleFinding | null {
  const session = context && context.session;
  if (!session) return null;
  const cacheWrite = session.cache_creation_tokens || 0;
  const cacheRead = session.cache_read_tokens || 0;
  if (cacheWrite <= 0) return null;
  if (cacheRead === 0 && cacheWrite < 5000) return null;
  const ratio = cacheRead === 0 ? Infinity : cacheWrite / cacheRead;
  if (ratio < RATIO_THRESHOLD) return null;

  const p = priceFor(session.model_primary);
  const excessWrites = cacheRead === 0 ? cacheWrite : cacheWrite - (cacheRead * (RATIO_THRESHOLD - 0.5));
  const excess = Math.max(excessWrites, 0);
  const costOfExcess = (excess * (p.cache_write ?? 0)) / 1_000_000;

  return {
    ruleId: ID,
    severity: 'warn',
    title: 'Cache writes far outnumber reads',
    description: `Cache writes (${cacheWrite.toLocaleString()}) are ${ratio === Infinity ? 'unbounded' : ratio.toFixed(1) + '×'} cache reads (${cacheRead.toLocaleString()}). Likely AGENTS.md / SOUL.md / CLAUDE.md churn that invalidates the cache every turn.`,
    suggestedAction: 'Pin large stable instructions early in the prompt and avoid rewriting them mid-session. Move volatile state out of cached prefixes.',
    estimatedMonthlySavingsUsd: costOfExcess,
    evidence: { ratio: ratio === Infinity ? null : ratio, cacheWrite, cacheRead, excess, model: session.model_primary },
  };
}

const RULE: Rule = { id: ID, inspect };
export default RULE;
