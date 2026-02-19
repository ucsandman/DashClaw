import { NextResponse } from 'next/server';
import { getVersion, activateVersion } from '../../../../../../lib/prompt.js';

export async function GET(request, { params }) {
  try {
    const version = await getVersion(request, params.versionId);
    if (!version) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json(version);
  } catch (err) {
    console.error('[prompts/versions/detail] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch version' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    // POST to a version = activate it
    const activated = await activateVersion(request, params.versionId);
    if (!activated) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json({ ...activated, message: 'Version activated' });
  } catch (err) {
    console.error('[prompts/versions/detail] POST error:', err);
    return NextResponse.json({ error: 'Failed to activate version' }, { status: 500 });
  }
}
