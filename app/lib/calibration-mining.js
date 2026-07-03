// Pure logic for calibration-corpus mining (owner roadmap item 3; moved from
// scripts/lib for route reuse in v2.6b).
// Specs: docs/superpowers/specs/2026-07-02-calibration-corpus-v2-mining.md
//        docs/superpowers/specs/2026-07-02-calibration-proposals-human-surface-design.md
//
// Consumed by scripts/mine-calibration-candidates.mjs (DB/JSONL orchestration),
// scripts/add-calibration-vector.mjs (vector forge), and
// app/api/calibration/proposals (computed-on-read review surface). No DB, no
// fs, no network here — everything is unit-testable with synthetic rows
// (__tests__/unit/calibration-mining.test.js).

import crypto from 'node:crypto';
// Extensionless on purpose: riskThresholds is .ts — Turbopack won't map a
// .js specifier to .ts from a .js importer, while tsx (scripts), vitest, and
// Turbopack all resolve the extensionless form.
import { RISK_MEDIUM_MIN } from './riskThresholds';

const MAX_EVIDENCE = 10;

/**
 * Normalized event shape both sources map into:
 *   id               decision id / action id / sample event id
 *   origin           'decision' | 'sample'
 *   agent_id         string|null — who acted (synthetic-traffic filter input)
 *   action_id        string|null — linked action_records.action_id when known
 *                    (lets a proposal's ratify command use the forge's --action path)
 *   risk_score       number|null (final persisted score)
 *   decision         'allow'|'warn'|'block'|'require_approval'|null
 *   approved         boolean — a human approved the interruption
 *   denied           boolean — a human denied it
 *   outcome_status   action_records.outcome_status or sample outcome, or null
 *   bash_intent      classifier intent when known, or null
 *   action_type      string|null
 *   declared_goal    string|null
 *   command_shape    redacted shape string when known, or null
 *   risk_breakdown   guard_decisions.context._risk_breakdown when available
 */

export function normalizeGoal(goal) {
  if (!goal) return '';
  return String(goal)
    .toLowerCase()
    .replace(/[0-9a-f]{7,}/g, '#') // hashes, ids
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

// Synthetic-traffic filter (roadmap v2.6). The platform's own verification
// traffic is DESIGNED to trip policies (inflated client scores, deliberate
// blocks/denials), so mining it would calibrate the scorer against a fiction.
// Explicit families, one per generator in this repo — keep in sync with:
//   smoke-*              scripts/policy-smoke.mjs (agentFor -> `smoke-{tag}-{run}`)
//   ci-smoke             .github/workflows/up-smoke.yml
//   sdk-live-test-agent* .github/workflows/sdk-live.yml
//   demo-e2e-verifier    scripts/verify-demo-e2e.mjs
//   test, test-*         scripts/test-full-api.mjs, scripts/test-actions.mjs, dev suites
const SYNTHETIC_AGENT_RE = /^(smoke-|ci-smoke$|sdk-live-test-agent|demo-e2e-verifier$|test$|test-)/;

// SQL-side mirror of SYNTHETIC_AGENT_RE for consumers that must exclude
// synthetic rows BEFORE aggregation or LIMIT (posture repository, v3.1).
// A unit test pins regex↔patterns agreement so the two can't drift.
export const SYNTHETIC_AGENT_LIKE_PATTERNS = [
  'smoke-%', 'ci-smoke', 'sdk-live-test-agent%', 'demo-e2e-verifier', 'test', 'test-%',
];
export const SYNTHETIC_ACTION_TYPE_LIKE = 'smoke.%';

export function isSyntheticEvent(event) {
  const agent = event.agent_id;
  if (typeof agent === 'string' && SYNTHETIC_AGENT_RE.test(agent)) return true;
  // policy-smoke also uses run-unique action types under the `smoke.` prefix.
  if (typeof event.action_type === 'string' && event.action_type.startsWith('smoke.')) return true;
  return false;
}

// Row → normalized-event mappers, shared by the miner CLI and the
// /api/calibration/proposals loaders (v2.6b) so both surfaces mine the
// exact same event shape from the same SELECTs.
export function decisionRowToEvent(row) {
  return {
    id: row.id,
    origin: 'decision',
    agent_id: row.agent_id || null,
    action_id: row.action_id || null,
    risk_score: typeof row.risk_score === 'number' ? row.risk_score : null,
    decision: row.decision || null,
    approved: Boolean(row.approved),
    denied: Boolean(row.denied),
    outcome_status: row.outcome_status || null,
    bash_intent: row.bash_intent || null,
    action_type: row.action_type || null,
    declared_goal: row.declared_goal || row.context_goal || null,
    command_shape: null,
    risk_breakdown: row.risk_breakdown || null,
  };
}

export function sampleRowToEvent(row) {
  return {
    id: row.event_id || row.eventId || String(row.id ?? ''),
    origin: 'sample',
    agent_id: row.agent_id || row.agentId || null,
    action_id: null,
    risk_score: typeof row.risk_score === 'number' ? row.risk_score : null,
    decision: row.guard_decision || null,
    approved: false, // samples carry no approval outcomes
    denied: false,
    outcome_status: row.outcome_status || null,
    bash_intent: row.bash_intent || null,
    action_type: row.action_type || null,
    declared_goal: null,
    command_shape: row.command_shape || null,
    risk_breakdown: null,
  };
}

export function shapeKey(event) {
  if (event.command_shape) return event.command_shape;
  return `${event.action_type || 'other'}::${normalizeGoal(event.declared_goal)}`;
}

export function candidateId(rule, key) {
  return 'cv_' + crypto.createHash('sha256').update(`${rule}\n${key}`).digest('hex').slice(0, 16);
}

// Evidence tiers, strongest first. Returns the tier name or null.
export function benignEvidence(event) {
  if (event.approved) return 'human_approved';
  if (event.outcome_status === 'completed' && !event.denied && event.decision !== 'block') {
    return 'completed_success';
  }
  if (event.bash_intent === 'readonly') return 'readonly_intent';
  return null;
}

export function dangerEvidence(event) {
  if (event.denied) return 'human_denied';
  if (event.decision === 'block') return 'blocked';
  if (event.bash_intent === 'destructive') return 'destructive_intent';
  return null;
}

const TIER_ORDER = [
  'human_approved',
  'human_denied',
  'blocked',
  'completed_success',
  'destructive_intent',
  'readonly_intent',
];

function strongestTier(tiers) {
  for (const t of TIER_ORDER) if (tiers.has(t)) return t;
  return null;
}

function groupCandidates(rule, matches, suggestedLabel) {
  const groups = new Map();
  for (const { event, tier } of matches) {
    const key = shapeKey(event);
    let g = groups.get(key);
    if (!g) {
      g = { events: [], tiers: new Set(), representative: event };
      groups.set(key, g);
    }
    g.events.push(event);
    g.tiers.add(tier);
    // Prefer a representative that carries a breakdown (targets the fix);
    // tie-break on a linked action_id (enables the forge's --action path).
    if (!g.representative.risk_breakdown && event.risk_breakdown) {
      g.representative = event;
    } else if (
      Boolean(g.representative.risk_breakdown) === Boolean(event.risk_breakdown) &&
      !g.representative.action_id && event.action_id
    ) {
      g.representative = event;
    }
  }

  const out = [];
  for (const [key, g] of groups) {
    const scores = g.events.map((e) => e.risk_score).filter((s) => typeof s === 'number');
    out.push({
      id: candidateId(rule, key),
      rule,
      shape_key: key,
      suggested_label: suggestedLabel,
      evidence_tier: strongestTier(g.tiers),
      count: g.events.length,
      event_ids: g.events.slice(0, MAX_EVIDENCE).map((e) => e.id),
      truncated_events: Math.max(0, g.events.length - MAX_EVIDENCE),
      risk_min: scores.length ? Math.min(...scores) : null,
      risk_max: scores.length ? Math.max(...scores) : null,
      representative: {
        id: g.representative.id,
        origin: g.representative.origin,
        action_id: g.representative.action_id ?? null,
        action_type: g.representative.action_type ?? null,
        declared_goal: g.representative.declared_goal ?? null,
        command_shape: g.representative.command_shape ?? null,
        risk_score: g.representative.risk_score ?? null,
        risk_breakdown: g.representative.risk_breakdown ?? null,
      },
    });
  }
  // Deterministic order: strongest count first, then id.
  out.sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
  return out;
}

// R1: benign evidence but final score reached the interrupt band.
export function mineOverScoredBenign(events) {
  const matches = [];
  for (const event of events) {
    if (typeof event.risk_score !== 'number' || event.risk_score < RISK_MEDIUM_MIN) continue;
    const tier = benignEvidence(event);
    if (tier) matches.push({ event, tier });
  }
  return groupCandidates('over_scored_benign', matches, 'benign');
}

// R2: dangerous evidence but the score stayed below the interrupt band.
export function mineUnderScoredDanger(events) {
  const matches = [];
  for (const event of events) {
    if (typeof event.risk_score !== 'number' || event.risk_score >= RISK_MEDIUM_MIN) continue;
    const tier = dangerEvidence(event);
    if (tier) matches.push({ event, tier });
  }
  return groupCandidates('under_scored_danger', matches, 'risky');
}

// R3: the human keeps approving the exact same shape.
export function mineRepeatedApprovals(events, { minCount = 3 } = {}) {
  const matches = [];
  for (const event of events) {
    if (event.approved) matches.push({ event, tier: 'human_approved' });
  }
  return groupCandidates('repeated_approvals', matches, 'benign').filter(
    (c) => c.count >= minCount,
  );
}

function roundUpTo5(n) {
  return Math.ceil(n / 5) * 5;
}
function roundDownTo5(n) {
  return Math.floor(n / 5) * 5;
}

/**
 * Suggest fixture bounds from observed scores. When a score contradicts its
 * label (benign at/above the interrupt band, risky below it), the suggestion
 * is the band edge and requires_model_fix is set — appending such a vector
 * makes the golden suite red until the scorer is fixed in the same commit
 * (MAINTAINER.md calibration workflow, mechanized).
 */
export function suggestBounds(label, { clientScore = null, serverScore = null } = {}) {
  const result = { requires_model_fix: false };

  const boundFor = (score) => {
    if (label === 'benign') {
      if (score >= RISK_MEDIUM_MIN) {
        result.requires_model_fix = true;
        return { max_risk: RISK_MEDIUM_MIN - 1 };
      }
      return { max_risk: Math.min(roundUpTo5(score) + 5, RISK_MEDIUM_MIN - 1) };
    }
    if (score < RISK_MEDIUM_MIN) {
      result.requires_model_fix = true;
      return { min_risk: RISK_MEDIUM_MIN };
    }
    return { min_risk: Math.max(roundDownTo5(score) - 5, RISK_MEDIUM_MIN) };
  };

  if (typeof clientScore === 'number') result.client_expected = boundFor(clientScore);
  if (typeof serverScore === 'number') result.server_expected = boundFor(serverScore);
  return result;
}

// Canonical vector field order (matches the existing fixture entries).
const VECTOR_KEY_ORDER = [
  'name',
  'label',
  'source',
  'bash_command',
  'client_expected',
  'server_context',
  'server_expected',
];

export function buildVectorEntry({
  name,
  label,
  source,
  bash_command = null,
  client_expected = null,
  server_context = null,
  server_expected = null,
}) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`vector name must be kebab-case, got: ${JSON.stringify(name)}`);
  }
  if (label !== 'benign' && label !== 'risky') {
    throw new Error(`label must be benign|risky, got: ${JSON.stringify(label)}`);
  }
  if (!source) throw new Error('source (provenance) is required');
  if (!bash_command && !server_context) {
    throw new Error('vector must cover at least one layer (bash_command or server_context)');
  }
  const entry = { name, label, source };
  if (bash_command) entry.bash_command = bash_command;
  if (client_expected) entry.client_expected = client_expected;
  if (server_context) entry.server_context = server_context;
  if (server_expected) entry.server_expected = server_expected;
  return entry;
}

// Serialize one vector in the fixture's exact style: 4-space entry indent,
// 6-space fields, nested objects inline.
export function serializeVectorEntry(entry) {
  const lines = ['    {'];
  const keys = VECTOR_KEY_ORDER.filter((k) => entry[k] !== undefined);
  keys.forEach((key, i) => {
    const comma = i < keys.length - 1 ? ',' : '';
    const value = entry[key];
    if (value !== null && typeof value === 'object') {
      const inner = Object.entries(value)
        .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(', ');
      lines.push(`      ${JSON.stringify(key)}: { ${inner} }${comma}`);
    } else {
      lines.push(`      ${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
    }
  });
  lines.push('    }');
  return lines.join('\n');
}

// --- Proposal mode (roadmap v2.6) -------------------------------------------
// Turns mined candidates into ready-to-ratify proposals. No scorer runs here:
// the forge (calibration:add) runs both scorers at ratification time, so
// propose mode stays runnable in a bare CI job (no Python, no app build).

function extractBashCommand(rep) {
  if (typeof rep.declared_goal === 'string' && rep.declared_goal.startsWith('Bash: ')) {
    const cmd = rep.declared_goal.slice('Bash: '.length).trim();
    if (cmd) return cmd;
  }
  return null;
}

export function suggestVectorName(rep, rule) {
  const base =
    extractBashCommand(rep) || rep.declared_goal || rep.command_shape || rep.action_type || rule;
  const name = String(base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return name && /^[a-z0-9]/.test(name) ? name : `${rule.replace(/_/g, '-')}-candidate`;
}

const shellQuote = (s) => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;

/**
 * candidatesByRule: the miner's { over_scored_benign, under_scored_danger,
 * repeated_approvals } object. Returns a flat proposals array, one per
 * candidate, each carrying provenance and (when reconstructible) the exact
 * forge invocation. `needs_manual_context` marks candidates whose redacted
 * shape can't be turned into a runnable command — the human supplies it.
 *
 * topPerRule caps each rule to its strongest candidates (they arrive sorted
 * count-desc) so a weekly batch stays reviewable — a live 30d run produced
 * 5.8k raw candidates. 0 = unlimited. The renderer reports what was cut.
 */
export function buildProposals(candidatesByRule, { windowDays, generatedAt, topPerRule = 15 }) {
  const date = String(generatedAt).slice(0, 10);
  const proposals = [];
  for (const [rule, candidates] of Object.entries(candidatesByRule)) {
    const kept = topPerRule > 0 ? candidates.slice(0, topPerRule) : candidates;
    for (const c of kept) {
      const rep = c.representative || {};
      const provenance = `mined ${date} (window ${windowDays}d): ${rule} ${c.id}, ${c.count} event(s), tier ${c.evidence_tier}`;
      const name = suggestVectorName(rep, rule);
      const bashCommand = extractBashCommand(rep);

      let ratify = null;
      if (rep.action_id) {
        ratify = `npm run calibration:add -- --action ${rep.action_id} --label ${c.suggested_label} --name ${name} --source ${shellQuote(provenance)}`;
      } else if (bashCommand) {
        ratify = `npm run calibration:add -- --command ${shellQuote(bashCommand)} --label ${c.suggested_label} --name ${name} --source ${shellQuote(provenance)}`;
      }

      proposals.push({
        candidate_id: c.id,
        rule,
        suggested_label: c.suggested_label,
        suggested_name: name,
        evidence_tier: c.evidence_tier,
        count: c.count,
        risk_min: c.risk_min,
        risk_max: c.risk_max,
        event_ids: c.event_ids,
        representative: rep,
        provenance,
        ratify_command: ratify,
        needs_manual_context: !ratify,
      });
    }
  }
  return proposals;
}

const mdEscape = (s) => String(s).replace(/\|/g, '\\|').replace(/`/g, "'");

/**
 * GitHub-flavored markdown rendering of a proposal report, written for
 * $GITHUB_STEP_SUMMARY. Shows input counts + the synthetic exclusion line so
 * a reviewer sees coverage honestly (no silent drops).
 */
export function renderProposalSummary(report) {
  const { inputs = {}, proposals = [] } = report;
  const lines = [
    `# Calibration vector proposals — ${String(report.generated_at || '').slice(0, 10)}`,
    '',
    `Window: ${report.window_days}d · decisions ${inputs.decisions ?? 0}${inputs.decisions_truncated_at_limit ? ' (hit the query limit — narrow the window for full coverage)' : ''} · local samples ${inputs.local_samples ?? 0} · uploaded samples ${inputs.uploaded_samples ?? 0} · **synthetic excluded: ${inputs.synthetic_excluded ?? 0}**`,
    '',
    'A human ratifies each proposal locally via its forge command (both scorers',
    'run there), reviews the printed vector, then re-runs with `--write` and',
    'commits per the MAINTAINER.md calibration protocol. Nothing auto-applies.',
    '',
  ];
  if (!proposals.length) {
    lines.push('No candidates in this window.');
    return lines.join('\n') + '\n';
  }
  const byRule = new Map();
  for (const p of proposals) {
    if (!byRule.has(p.rule)) byRule.set(p.rule, []);
    byRule.get(p.rule).push(p);
  }
  for (const [rule, list] of byRule) {
    const totalForRule = report.candidates?.[rule]?.length ?? list.length;
    const scope =
      totalForRule > list.length
        ? `top ${list.length} of ${totalForRule} candidates (strongest first; full list: local run with --top 0)`
        : `${list.length} proposal(s)`;
    lines.push(`## ${rule} — ${scope} (label: ${list[0].suggested_label})`, '');
    lines.push('| candidate | count | tier | risk | shape | ratify |');
    lines.push('|---|---|---|---|---|---|');
    for (const p of list) {
      const rep = p.representative || {};
      const shape = rep.command_shape || rep.declared_goal || rep.action_type || '(no shape)';
      const risk = p.risk_min === p.risk_max ? `${p.risk_min}` : `${p.risk_min}–${p.risk_max}`;
      const ratify = p.ratify_command
        ? `\`${mdEscape(p.ratify_command)}\``
        : '_needs manual context (redacted shape)_';
      lines.push(
        `| ${p.candidate_id} | ${p.count} | ${p.evidence_tier} | ${risk} | ${mdEscape(String(shape).slice(0, 80))} | ${ratify} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Append a vector to the fixture text, preserving the file's byte format.
 * Returns the new text. Throws on duplicate name or if the result no longer
 * parses (format drift guard).
 */
export function appendVectorToFixtureText(fixtureText, entry) {
  const fixture = JSON.parse(fixtureText);
  if (!Array.isArray(fixture.vectors)) throw new Error('fixture has no vectors array');
  if (fixture.vectors.some((v) => v.name === entry.name)) {
    throw new Error(`vector name already exists in fixture: ${entry.name}`);
  }
  const anchor = fixtureText.lastIndexOf('\n  ]');
  if (anchor === -1) throw new Error('could not locate the vectors array closing bracket');
  const updated =
    fixtureText.slice(0, anchor) + ',\n' + serializeVectorEntry(entry) + fixtureText.slice(anchor);
  const reparsed = JSON.parse(updated);
  if (reparsed.vectors.length !== fixture.vectors.length + 1) {
    throw new Error('append produced an unexpected vector count');
  }
  return updated;
}
