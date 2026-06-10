export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';

export async function POST(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { snippetId } = params;
    const now = new Date().toISOString();

    const result = await sql`
      UPDATE snippets
      SET use_count = use_count + 1, last_used = ${now}
      WHERE id = ${snippetId} AND org_id = ${orgId}
      RETURNING *
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'Snippet not found' }, { status: 404 });
    }

    return NextResponse.json({ snippet: result[0] });
  } catch (error) {
    console.error('Snippet use POST error:', error);
    return NextResponse.json({ error: 'An error occurred while recording snippet use' }, { status: 500 });
  }
}
