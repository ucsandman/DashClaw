import { NextResponse } from 'next/server';
import { getOrgRole } from '../../../../../lib/org';
import { listVersions, createVersion, getTemplate } from '../../../../../lib/prompt';

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const versions = await listVersions(request, templateId);
    return NextResponse.json({ versions });
  } catch (err) {
    console.error('[prompts/versions] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  if (getOrgRole(request) !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const { templateId } = await params;
    const template = await getTemplate(request, templateId);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    const body = await request.json();
    if (!body.content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    const version = await createVersion(request, templateId, {
      content: body.content,
      model_hint: body.model_hint,
      parameters: body.parameters,
      changelog: body.changelog,
    });
    if (!version) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json(version, { status: 201 });
  } catch (err) {
    console.error('[prompts/versions] POST error:', err);
    return NextResponse.json({ error: 'Failed to create version' }, { status: 500 });
  }
}
