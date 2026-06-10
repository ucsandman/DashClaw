/**
 * Weekly memo generator. Pure — the route layer queries sessions, runs the
 * optimizer per session, deduplicates findings, and passes the pre-computed
 * data into `generateMemo(...)`.
 *
 * Ported from AgentLens (`src/memo.js`). Drops:
 *   - `writeMemoToDisk` — disk writes are CLI-only and not needed here.
 *   - The in-function DB queries — caller supplies `sessions`,
 *     `priorSessions`, `findings`, and `stuckLoopTotal`.
 */

import { cacheHitRate, formatUSD } from './pricing';
import { totalEstimatedMonthlySavings } from './optimizer';
import type { OptimizerFinding } from './optimizer';

const DEFAULT_WEEK_DAYS = 7;

interface MemoProject {
  slug?: string | null;
  [key: string]: unknown;
}

interface MemoSession {
  cost_usd?: number | string | null;
  cache_savings_usd?: number | string | null;
  input_tokens?: number | string | null;
  output_tokens?: number | string | null;
  cache_read_tokens?: number | string | null;
  cache_creation_tokens?: number | string | null;
  session_uuid?: string | null;
  message_count?: number | null;
  model_primary?: string | null;
  [key: string]: unknown;
}

interface MemoFinding {
  ruleId?: string;
  title?: string;
  description?: string;
  suggestedAction?: string;
  estimatedMonthlySavingsUsd?: number | null;
  [key: string]: unknown;
}

interface GenerateMemoInput {
  project: MemoProject;
  sessions?: MemoSession[];
  priorSessions?: MemoSession[];
  findings?: MemoFinding[];
  stuckLoopTotal?: number;
  weekDays?: number;
  now?: Date;
}

interface GenerateMemoResult {
  weekTag: string;
  markdown: string;
  summary: {
    sessions: number;
    totalSpend: number;
    totalCacheSavings: number;
    thisWeekHit: number;
    priorWeekHit: number;
    deltaPP: number;
    stuckLoopTotal: number;
    findings: MemoFinding[];
    totalSavings: number;
  };
}

/**
 * Render a Markdown memo for one project for a recent window.
 *
 * @param {Object} input
 * @param {Object} input.project          Project row, must have `slug`.
 * @param {Array}  input.sessions         Session rows in the current window.
 * @param {Array}  input.priorSessions    Session rows in the prior window.
 * @param {Array}  input.findings         Deduplicated optimizer findings.
 * @param {number} input.stuckLoopTotal   Total tool calls inside stuck loops.
 * @param {number} [input.weekDays=7]
 * @param {Date}   [input.now=new Date()]
 */
export function generateMemo({
  project,
  sessions = [],
  priorSessions = [],
  findings = [],
  stuckLoopTotal = 0,
  weekDays = DEFAULT_WEEK_DAYS,
  now = new Date(),
}: GenerateMemoInput): GenerateMemoResult {
  if (!project || !project.slug) {
    throw new Error('generateMemo: project.slug is required');
  }

  // Postgres `numeric` columns arrive as strings over the Neon HTTP driver, so
  // `0 + "247.49"` would string-concatenate into NaN. Coerce every accumulated
  // field with Number() before summing. `integer` columns already come back as
  // numbers, but Number() is harmless on them and keeps the reducers uniform.
  const totalSpend = sessions.reduce((a, s) => a + (Number(s.cost_usd) || 0), 0);
  const totalCacheSavings = sessions.reduce((a, s) => a + (Number(s.cache_savings_usd) || 0), 0);

  const totalUsage = sessions.reduce((acc: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_creation_tokens: number }, s) => {
    acc.input_tokens += Number(s.input_tokens) || 0;
    acc.output_tokens += Number(s.output_tokens) || 0;
    acc.cache_read_tokens += Number(s.cache_read_tokens) || 0;
    acc.cache_creation_tokens += Number(s.cache_creation_tokens) || 0;
    return acc;
  }, { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 });

  const priorUsage = priorSessions.reduce((acc: { input_tokens: number; cache_read_tokens: number; cache_creation_tokens: number }, s) => {
    acc.input_tokens += Number(s.input_tokens) || 0;
    acc.cache_read_tokens += Number(s.cache_read_tokens) || 0;
    acc.cache_creation_tokens += Number(s.cache_creation_tokens) || 0;
    return acc;
  }, { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 });

  const thisWeekHit = cacheHitRate(totalUsage);
  const priorWeekHit = cacheHitRate(priorUsage);
  const deltaPP = (thisWeekHit - priorWeekHit) * 100;

  const top3 = [...sessions].sort((a, b) => (Number(b.cost_usd) || 0) - (Number(a.cost_usd) || 0)).slice(0, 3);

  const modelsSeen = new Set(sessions.map(s => s.model_primary).filter(Boolean));
  const priorModels = new Set(priorSessions.map(s => s.model_primary).filter(Boolean));
  const newModels = [...modelsSeen].filter(m => !priorModels.has(m));

  const totalSavings = totalEstimatedMonthlySavings(findings as unknown as OptimizerFinding[]);
  const weekTag = isoWeekTag(now);

  const lines: string[] = [];
  lines.push(`# Weekly Code Sessions memo — ${project.slug}`);
  lines.push('');
  lines.push(`**Week:** ${weekTag} (last ${weekDays} days · ${sessions.length} sessions)`);
  lines.push(`**Total spend:** ${formatUSD(totalSpend)} · **cache savings:** ${formatUSD(totalCacheSavings)}`);
  if (priorSessions.length) {
    const sign = deltaPP >= 0 ? '+' : '';
    lines.push(`**Cache hit rate:** ${(thisWeekHit * 100).toFixed(1)}% (${sign}${deltaPP.toFixed(1)} pp vs prior week)`);
  } else {
    lines.push(`**Cache hit rate:** ${(thisWeekHit * 100).toFixed(1)}% (no prior-week baseline yet)`);
  }
  lines.push('');
  lines.push('## Top 3 sessions by cost');
  if (!top3.length) {
    lines.push('_No sessions this week._');
  } else {
    for (const s of top3) {
      lines.push(`- \`${(s.session_uuid || '').slice(0, 8)}\` · ${formatUSD(Number(s.cost_usd) || 0)} · ${s.message_count || 0} msgs · ${s.model_primary || '—'}`);
    }
  }
  lines.push('');
  lines.push('## Repeated-run signals');
  lines.push(stuckLoopTotal
    ? `Total repeated-tool-run tool calls detected this week: **${stuckLoopTotal}**. Open each session and check the confidence label before treating any as a stuck loop.`
    : 'None detected.');
  lines.push('');
  lines.push('## Optimizer findings');
  if (!findings.length) {
    lines.push('No optimizer findings this week.');
  } else {
    lines.push(`**Estimated savings if you apply all:** ${formatUSD(totalSavings)}.`);
    lines.push('');
    for (const f of findings) {
      const est = (f.estimatedMonthlySavingsUsd != null) ? ` _(est ${formatUSD(f.estimatedMonthlySavingsUsd)})_` : '';
      lines.push(`- **${f.ruleId}**: ${f.title}${est}  \n  ${f.description}  \n  → ${f.suggestedAction || ''}`);
    }
  }
  lines.push('');
  lines.push('## What changed');
  const changes: string[] = [];
  if (priorSessions.length && deltaPP <= -10) changes.push(`Cache hit rate dropped ${deltaPP.toFixed(1)} pp vs prior week.`);
  if (newModels.length) changes.push(`New model(s) observed: ${newModels.join(', ')}.`);
  if (!changes.length) changes.push('No notable changes vs prior week.');
  for (const c of changes) lines.push(`- ${c}`);
  lines.push('');
  lines.push('---');
  lines.push(`_Generated by DashClaw Code Sessions at ${now.toISOString()}._`);

  return {
    weekTag,
    markdown: lines.join('\n') + '\n',
    summary: {
      sessions: sessions.length,
      totalSpend,
      totalCacheSavings,
      thisWeekHit,
      priorWeekHit,
      deltaPP,
      stuckLoopTotal,
      findings,
      totalSavings,
    },
  };
}

export function isoWeekTag(d: Date): string {
  // Returns YYYY-Www
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + (firstThursday.getUTCDay() + 6) % 7) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export function sanitizeSlug(s: unknown): string {
  return String(s || 'unknown').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 80);
}
