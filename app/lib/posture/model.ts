import type {
  RiskLevel, GovernableUnit, CoverageResult, Decision,
  Adjustments, Dimension, DimensionScore, PostureScore,
} from './types';

const RISK_MULTIPLIER: Record<RiskLevel, number> = { low: 1, medium: 3, high: 8, critical: 16 };

export function riskFactor(level: RiskLevel): number { return RISK_MULTIPLIER[level]; }

export function bucketRiskScore(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

// Deterministic FNV-1a 32-bit hash → 8-hex. Stable finding keys across scans
// (NO Date.now / Math.random — keys must be reproducible, like Policy Coach
// ids). Lives here (not findings.ts) so the tightening engine (v3.2) can
// derive the mirrored finding key without a findings↔tightening import cycle.
export function stableKey(parts: string[]): string {
  const s = parts.join(':');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function frequencyFactor(count: number): number {
  return 1 + Math.log10(1 + Math.max(0, count));
}

export function unitWeight(u: GovernableUnit): number {
  const reversibility = u.reversible ? 1 : 2;
  const spend = u.hasSpendExposure ? 2 : 1;
  return riskFactor(u.riskLevel) * reversibility * spend * frequencyFactor(u.observedCount);
}

// allow_contained = reversible friction (an agent proceeded inside a sandbox/dry-run
// envelope, not a hard stop) — same coverage weight as warn.
const GRADE: Record<Decision, 0 | 0.5 | 1> = { allow: 0, warn: 0.5, allow_contained: 0.5, require_approval: 1, block: 1 };

// Evidence-first guard (docs/superpowers/specs/2026-07-05-evidence-first-guard.md
// §6): on the enforcement dimension, coverage earned from a self-declared
// action_type/risk (no `act` attached, server never re-derived it) counts for
// half as much as coverage grounded in server-classified evidence — a
// mechanical hook decision with act evidence counts as evidence too, since
// the server classifies uniformly regardless of transport. `intentSource` is
// optional so existing callers (and the pre-existing test suite) are
// unaffected; omit it, or return null/'evidence', for full-strength grading.
export function gradeCoverage(
  u: GovernableUnit,
  replay: (unitKey: string) => Decision,
  infraOk: (u: GovernableUnit) => boolean,
  intentSource?: (u: GovernableUnit) => 'evidence' | 'declared' | null,
): CoverageResult {
  const decision = replay(u.key);
  const baseGrade = GRADE[decision];
  const ok = infraOk(u);
  let grade = ok ? baseGrade : 0;
  if (grade > 0 && u.dimension === 'enforcement' && intentSource?.(u) === 'declared') {
    grade = grade * 0.5;
  }
  return { grade, hasFiringPolicy: baseGrade > 0, infraOk: ok };
}

const DIMENSIONS: Dimension[] = ['identity','enforcement','spend','auditability','approval','data_protection'];

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }

export function applyIncidentCap(score: number, adj: Adjustments): { score: number; cappedBy: 'incident' | null } {
  const hasHighIncident = adj.incidents.some((i) => i.riskLevel === 'high' || i.riskLevel === 'critical');
  if (hasHighIncident) return { score: Math.min(score, 60), cappedBy: 'incident' };
  return { score, cappedBy: null };
}

export function computeScore(
  units: GovernableUnit[],
  // unitKey -> coverage grade in [0, 1]. May be a gradeCoverage result (0/0.5/1)
  // or a pre-computed float; values are clamped to [0,1] below.
  coverageByKey: Record<string, number>,
  adj: Adjustments,
): PostureScore {
  const byDim = new Map<Dimension, { covered: number; total: number }>();
  for (const d of DIMENSIONS) byDim.set(d, { covered: 0, total: 0 });

  for (const u of units) {
    const w = unitWeight(u);
    let grade = clamp01(coverageByKey[u.key] ?? 0);
    if (adj.coachOpenGapUnitKeys.includes(u.key)) grade = Math.min(grade, 0.5); // observed uncovered risk
    const bucket = byDim.get(u.dimension)!;
    bucket.total += w;
    bucket.covered += grade * w;
  }

  // spec §4.3: approval follow-through feeds the approval dimension specifically
  // (resolved-vs-abandoned ratio), not the overall score. It naturally flows into
  // the global roll-up weighted by the approval dimension's risk mass.
  const approvalBucket = byDim.get('approval')!;
  approvalBucket.covered *= clamp01(adj.approvalFollowThrough);

  const dimensions: DimensionScore[] = DIMENSIONS.map((d) => {
    const { covered, total } = byDim.get(d)!;
    return { dimension: d, score: total === 0 ? 100 : Math.round((covered / total) * 100), weight: total };
  });

  const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
  const rawCovered = DIMENSIONS.reduce((s, d) => s + byDim.get(d)!.covered, 0);
  // No observable units means nothing to govern; treat as fully covered rather than penalizing.
  const score = totalWeight === 0 ? 100 : Math.round((rawCovered / totalWeight) * 100);

  const capped = applyIncidentCap(score, adj);
  const status: PostureScore['status'] =
    capped.score >= 85 ? 'healthy' : capped.score >= 60 ? 'needs_attention' : 'at_risk';
  return { score: capped.score, status, dimensions, cappedBy: capped.cappedBy };
}
