export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { NextResponse } from 'next/server';
import { isHostedMode, hostedConfig } from '../../../lib/hosted/flag';
import { countActiveTrials } from '../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../lib/db';
export async function GET() {
  if (!isHostedMode()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const max = hostedConfig().maxActiveTrials;
  const active = await countActiveTrials(getSql());
  return NextResponse.json({ full: active >= max, active, max });
}
