import { NextResponse } from 'next/server';
import { listTemplates, createTemplate } from '../../../lib/prompt.js';

export async function GET(request) {
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

export async function POST(request) {
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
