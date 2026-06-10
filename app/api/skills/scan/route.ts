import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { scanSkillContent, hashContent } from '../../../lib/skill-scanner';
import { getCachedScan, upsertScan } from '../../../lib/repositories/skill-scan-results.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const body = await req.json().catch(() => ({}));
    if (!body.skill_name) return NextResponse.json({ error: 'skill_name required' }, { status: 400 });
    if (!body.files || typeof body.files !== 'object' || Object.keys(body.files).length === 0) {
      return NextResponse.json({ error: 'files (non-empty object) required' }, { status: 400 });
    }

    const targetHash = hashContent(body.files);
    const cached = await getCachedScan(sql, orgId, body.skill_name, targetHash);
    if (cached) {
      return NextResponse.json({
        id: cached.id,
        skill_name: cached.skill_name,
        target_hash: cached.target_hash,
        findings: cached.findings,
        passed: cached.passed,
        cached: true,
      });
    }

    const { findings, passed } = scanSkillContent(body.files);
    const result = await upsertScan(sql, orgId, {
      skillName: body.skill_name,
      targetHash,
      findings,
      passed,
    });
    return NextResponse.json({
      id: result?.id,
      skill_name: result?.skill_name,
      target_hash: result?.target_hash,
      findings: result?.findings,
      passed: result?.passed,
      cached: false,
    });
  } catch (err) {
    return apiErrorResponse(err, 'SKILL_SCAN');
  }
}
