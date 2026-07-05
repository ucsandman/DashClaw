export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode } from '../../../lib/hosted/flag';
import { getTrialFunnel } from '../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../lib/db';

// v4.6 funnel truth: the trial activation funnel, aggregate-only (no org
// ids, slugs, or key prefixes ever leave the repository). Public like
// /api/hosted/capacity but discloses more (conversion rates, cohort trends)
// — an explicit spec decision, recorded there with the security review's
// sign-off note. Per-instance 60s memo: the funnel needs no real-time
// freshness, and an unauthenticated hot loop should hit memory, not the DB
// (security review, in-ship hardening).
let cached: { at: number; body: Record<string, unknown> } | null = null;
const FUNNEL_CACHE_MS = 60_000;

export async function GET() {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (cached && Date.now() - cached.at < FUNNEL_CACHE_MS) {
    return NextResponse.json(cached.body);
  }
  const funnel = await getTrialFunnel(getSql());
  const body = { hosted: true, ...funnel };
  cached = { at: Date.now(), body };
  return NextResponse.json(body);
}
