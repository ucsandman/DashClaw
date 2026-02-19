import { NextResponse } from 'next/server';
import { getTemplate, updateTemplate, deleteTemplate } from '../../../../lib/prompt.js';

export async function GET(request, { params }) {
  try {
    const template = await getTemplate(request, params.templateId);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json(template);
  } catch (err) {
    console.error('[prompts/templates/detail] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const body = await request.json();
    const updated = await updateTemplate(request, params.templateId, body);
    if (!updated) {
      return NextResponse.json({ error: 'Template not found or no changes' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[prompts/templates/detail] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    await deleteTemplate(request, params.templateId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('[prompts/templates/detail] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 });
  }
}
