/**
 * BAD_CACHE_HIT rule. Fires when ≥ SESSION_STREAK consecutive recent project
 * sessions show cache hit rate below HIT_FLOOR.
 */

import { cacheHitRate, priceFor } from '../pricing';

const ID = 'BAD_CACHE_HIT';
export const HIT_FLOOR = 0.50;
export const SESSION_STREAK = 3;

interface ProjectSession {
  session_uuid?: string;
  input_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd?: number;
  started_at?: unknown;
  model_primary?: string | null;
}

interface RuleContext {
  projectSessions?: ProjectSession[];
}

interface StreakSession {
  session_uuid: string | undefined;
  rate: number;
  cost_usd: number | undefined;
  started_at: unknown;
}

interface RuleFinding {
  ruleId: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction: string;
  estimatedMonthlySavingsUsd: number;
  evidence: { streak: number; threshold: number; streakSessions: StreakSession[] };
}

function inspect(context: RuleContext | null | undefined): RuleFinding | null {
  const sessions = (context && context.projectSessions) || [];
  if (sessions.length < SESSION_STREAK) return null;

  // `projectSessions` is assumed in chronological order (oldest first).
  const tail = sessions.slice(-Math.max(SESSION_STREAK, 5));
  let streak = 0;
  const streakSessions: StreakSession[] = [];
  for (let i = tail.length - 1; i >= 0; i--) {
    const s = tail[i] as ProjectSession;
    const rate = cacheHitRate({
      input_tokens: s.input_tokens,
      cache_read_tokens: s.cache_read_tokens,
      cache_creation_tokens: s.cache_creation_tokens,
    });
    if (rate < HIT_FLOOR) {
      streak += 1;
      streakSessions.unshift({ session_uuid: s.session_uuid, rate, cost_usd: s.cost_usd, started_at: s.started_at });
    } else {
      break;
    }
  }
  if (streak < SESSION_STREAK) return null;

  // Crude monthly savings estimate: assume we could lift the recent streak's
  // miss-tokens (treated as cache_creation) to cache_read pricing on the same
  // model. Use the most recent session's model as the reference.
  const ref = streakSessions[streakSessions.length - 1] as StreakSession;
  const recentSession = sessions[sessions.length - 1] as ProjectSession;
  const p = priceFor(recentSession.model_primary);
  let savings = 0;
  for (const ss of streakSessions) {
    const sFull: ProjectSession = sessions.find(x => x.session_uuid === ss.session_uuid) || {};
    const missTokens = (sFull.cache_creation_tokens || 0) + (sFull.input_tokens || 0);
    // Cast: ModelPricingEntry.cache_read is optional in the type, but priceFor()
    // returns entries that always define it; preserve the original direct
    // subtraction (no `?? 0`) so runtime arithmetic is byte-for-byte unchanged.
    savings += (missTokens * (p.input - (p.cache_read as number))) / 1_000_000;
  }

  return {
    ruleId: ID,
    severity: 'warn',
    title: `Cache hit rate below ${(HIT_FLOOR*100).toFixed(0)}% across ${streak} consecutive sessions`,
    description: `Recent project sessions are missing the cache more than they hit. Last session's hit rate: ${(ref.rate * 100).toFixed(1)}%.`,
    suggestedAction: 'Pin a stable system prompt prefix. Confirm tool definitions and CLAUDE.md content are not rotating between sessions. Verify `cache_control` is being applied to the largest stable block.',
    estimatedMonthlySavingsUsd: savings,
    evidence: { streak, threshold: HIT_FLOOR, streakSessions },
  };
}

const RULE = { id: ID, inspect };
export default RULE;
