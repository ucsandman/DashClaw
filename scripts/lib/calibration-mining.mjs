// Pure logic for calibration-corpus mining (owner roadmap item 3).
// Spec: docs/superpowers/specs/2026-07-02-calibration-corpus-v2-mining.md
//
// Consumed by scripts/mine-calibration-candidates.mjs (DB/JSONL orchestration)
// and scripts/add-calibration-vector.mjs (vector forge). No DB, no fs, no
// network here — everything is unit-testable with synthetic rows
// (__tests__/unit/calibration-mining.test.js).

import crypto from 'node:crypto';
import { RISK_MEDIUM_MIN } from '../../app/lib/riskThresholds.js';

const MAX_EVIDENCE = 10;

/**
 * Normalized event shape both sources map into:
 *   id               decision id / action id / sample event id
 *   origin           'decision' | 'sample'
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
    // Prefer a representative that carries a breakdown (targets the fix).
    if (!g.representative.risk_breakdown && event.risk_breakdown) g.representative = event;
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
