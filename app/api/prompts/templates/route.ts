import { NextResponse } from 'next/server';
import { getOrgRole } from '../../../lib/org';
import { listTemplates, createTemplate } from '../../../lib/prompt';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || undefined;
    const templates = await listTemplates(request, { category });
    return NextResponse.json({ templates });
  } catch (err) {
    console.error('[prompts/templates] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (getOrgRole(request) !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const template = await createTemplate(request, {
      name: body.name,
      description: body.description,
      category: body.category,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    console.error('[prompts/templates] POST error:', err);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}
