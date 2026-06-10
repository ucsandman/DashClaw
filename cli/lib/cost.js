// cli/lib/cost.js
//
// `dashclaw cost [--lens fleet|claude-code] [--period 7d|30d|90d]` — terminal
// readback over GET /api/finops/spend (the finops rollups). Defaults:
// lens=claude-code, period=7d — the wedge user's own Claude Code spend.

import { apiRequest } from './api.js';

export const VALID_LENSES = ['fleet', 'claude-code'];
export const VALID_PERIODS = ['7d', '30d', '90d'];
export const USAGE =
  'Usage: dashclaw cost [--lens fleet|claude-code] [--period 7d|30d|90d]\n' +
  '  Defaults: --lens claude-code --period 7d';

/** Validate flag values. Returns null when fine, or a usage-bearing message. */
export function validateCostFlags({ lens, period }) {
  if (!VALID_LENSES.includes(lens)) {
    return `Invalid --lens "${lens}". Valid: ${VALID_LENSES.join(', ')}.\n${USAGE}`;
  }
  if (!VALID_PERIODS.includes(period)) {
    return `Invalid --period "${period}". Valid: ${VALID_PERIODS.join(', ')}.\n${USAGE}`;
  }
  return null;
}

export async function fetchSpend(config, { lens, period }) {
  return apiRequest(config, 'GET', '/api/finops/spend', { query: { lens, period } });
}

const money = (n) => '$' + Number(n || 0).toFixed(2);

function table(rows) {
  // rows: [label, value][] — right-pad labels so values align.
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${label.padEnd(width + 2)}${value}`).join('\n');
}

function formatClaudeCode(data, period) {
  const cs = data.code_sessions || {};
  const total = Number(data.code_total_usd || 0);
  const sessions = Number(cs.session_count || 0);
  if (total === 0 && sessions === 0) {
    return (
      `No Claude Code spend recorded yet for ${period}.\n` +
      'Sessions are captured by the Stop hook (on by default, metadata-only;\n' +
      'opt-out: DASHCLAW_CODE_SESSIONS_ENABLED=0). Run a Claude Code session and check back.'
    );
  }
  const lines = [
    `Claude Code spend — last ${period}`,
    '',
    table([
      ['Total', money(total)],
      ['Sessions', String(sessions)],
      ['Cache saved', money(cs.total_cache_savings_usd)],
    ]),
  ];
  const projects = Array.isArray(cs.by_project) ? cs.by_project.filter((p) => Number(p.cost_usd || 0) > 0) : [];
  if (projects.length > 0) {
    lines.push('', '  By project:');
    lines.push(table(projects.map((p) => [`  ${p.project_name || p.project_id || 'unknown'}`, money(p.cost_usd)])));
  }
  lines.push('', `Summary: ${money(total)} across ${sessions} session(s) in the last ${period}.`);
  return lines.join('\n');
}

function formatFleet(data, period) {
  const agent = Number(data.agent?.total_cost_usd || 0);
  const x402 = Number(data.x402?.total_spend_usd || 0);
  const total = Number(data.fleet_total_usd || 0);
  if (total === 0) {
    return (
      `No fleet spend recorded yet for ${period}.\n` +
      'Agent spend lands when governed actions report tokens_in/tokens_out + model.'
    );
  }
  const lines = [
    `Fleet spend — last ${period}`,
    '',
    table([
      ['Agent LLM', money(agent)],
      ['x402 purchases', money(x402)],
      ['Total', money(total)],
    ]),
    '',
    `Summary: ${money(total)} fleet spend in the last ${period} (LLM ${money(agent)} + x402 ${money(x402)}).`,
  ];
  return lines.join('\n');
}

export function formatSpend(data, { lens, period }) {
  return lens === 'claude-code' ? formatClaudeCode(data, period) : formatFleet(data, period);
}

/**
 * Validate, fetch, format. Throws a usage-tagged Error on bad flags so the
 * caller prints usage and exits non-zero without a stack trace.
 */
export async function runCost(config, { lens = 'claude-code', period = '7d' } = {}, { fetcher = fetchSpend } = {}) {
  const invalid = validateCostFlags({ lens, period });
  if (invalid) {
    const err = new Error(invalid);
    err.usage = true;
    throw err;
  }
  const data = await fetcher(config, { lens, period });
  return formatSpend(data, { lens, period });
}
