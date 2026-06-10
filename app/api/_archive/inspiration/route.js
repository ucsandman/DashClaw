export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';

// sql initialized inside handler for serverless compatibility

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    // Get all ideas
    const ideas = await sql`SELECT * FROM ideas WHERE org_id = ${orgId} ORDER BY captured_at DESC LIMIT 50`;

    // Calculate stats
    const pending = ideas.filter(i => i.status === 'pending').length;
    const shipped = ideas.filter(i => i.status === 'shipped').length;
    const avgScore = ideas.length > 0 
      ? Math.round(ideas.reduce((sum, i) => sum + (i.score || 0), 0) / ideas.length)
      : 0;

    const stats = {
      totalIdeas: ideas.length,
      pending,
      shipped,
      avgScore,
      topIdeas: ideas.filter(i => i.score >= 70).length
    };

    return NextResponse.json({
      ideas,
      stats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    // SECURITY: Log detailed error server-side, return generic message to client
    console.error('Inspiration API error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching inspiration data', ideas: [], stats: {} }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { title: 500, description: 5000, category: 200, source: 500, status: 50 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { title, description, category, score, status, source, fun_factor, learning_potential, income_potential } = body;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const funVal = parseInt(fun_factor || 0, 10);
    const learnVal = parseInt(learning_potential || 0, 10);
    const incomeVal = parseInt(income_potential || 0, 10);
    const hasSubScores = fun_factor !== undefined || learning_potential !== undefined || income_potential !== undefined;
    const computedScore = score !== undefined ? score : (hasSubScores ? Math.round((funVal + learnVal + incomeVal) / 3) : 50);

    const result = await sql`
      INSERT INTO ideas (org_id, title, description, category, score, status, source, fun_factor, learning_potential, income_potential, captured_at)
      VALUES (
        ${orgId},
        ${title},
        ${description || null},
        ${category || null},
        ${computedScore},
        ${status || 'pending'},
        ${source || null},
        ${funVal},
        ${learnVal},
        ${incomeVal},
        ${new Date().toISOString()}
      )
      RETURNING *
    `;

    return NextResponse.json({ idea: result[0] }, { status: 201 });
  } catch (error) {
    console.error('Inspiration API POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating the idea' }, { status: 500 });
  }
}

