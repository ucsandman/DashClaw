export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSelfGovernanceStats } from '../../lib/repositories/self-governance.repository';
import { getSql } from '../../lib/db';

// v7.3 self-governance proof: public, aggregate-only evidence that this
// instance governs real work — /api/hosted/funnel precedent (public at the
// middleware layer, self-guarding here, per-instance 60s memo so an
// unauthenticated hot loop hits memory, not the DB). 404 unless the operator
// opts the instance in; only the instance governing this repo's maintenance
// does. Spec: docs/superpowers/specs/2026-07-05-self-governance-proof-v73.md.
let cached: { at: number; body: Record<string, unknown> } | null = null;
const CACHE_MS = 60_000;

export async function GET() {
  if (process.env.DASHCLAW_SELF_GOVERNANCE_PUBLIC !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(cached.body);
  }
  const stats = await getSelfGovernanceStats(getSql());
  const body = {
    selfGovernance: true,
    // Manifest-derived (next.config.js injects package.json's version); the
    // governing instance redeploys from main on every ship, so its running
    // version is the latest governed ship.
    version: process.env.NEXT_PUBLIC_DASHCLAW_VERSION || null,
    generatedAt: new Date().toISOString(),
    ...stats,
  };
  cached = { at: Date.now(), body };
  return NextResponse.json(body);
}
