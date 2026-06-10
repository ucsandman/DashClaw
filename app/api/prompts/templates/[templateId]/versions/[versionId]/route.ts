import { NextResponse } from 'next/server';
import { getOrgRole } from '../../../../../../lib/org';
import { getVersion, activateVersion } from '../../../../../../lib/prompt';

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const { versionId } = await params;
    const version = await getVersion(request, versionId);
    if (!version) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json(version);
  } catch (err) {
    console.error('[prompts/versions/detail] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch version' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  if (getOrgRole(request) !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const { versionId } = await params;
    // POST to a version = activate it
    const activated = await activateVersion(request, versionId);
    if (!activated) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json({ ...activated, message: 'Version activated' });
  } catch (err) {
    console.error('[prompts/versions/detail] POST error:', err);
    return NextResponse.json({ error: 'Failed to activate version' }, { status: 500 });
  }
}
