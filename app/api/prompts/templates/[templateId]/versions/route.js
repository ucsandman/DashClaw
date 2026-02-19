import { NextResponse } from 'next/server';
import { listVersions, createVersion, getTemplate } from '../../../../../lib/prompt.js';

export async function GET(request, { params }) {
  try {
    const versions = await listVersions(request, params.templateId);
    return NextResponse.json({ versions });
  } catch (err) {
    console.error('[prompts/versions] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const template = await getTemplate(request, params.templateId);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    const body = await request.json();
    if (!body.content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    const version = await createVersion(request, params.templateId, {
      content: body.content,
      model_hint: body.model_hint,
      parameters: body.parameters,
      changelog: body.changelog,
    });
    return NextResponse.json(version, { status: 201 });
  } catch (err) {
    console.error('[prompts/versions] POST error:', err);
    return NextResponse.json({ error: 'Failed to create version' }, { status: 500 });
  }
}
