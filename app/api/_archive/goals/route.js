export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';
import { publishOrgEvent, EVENTS } from '../../../lib/events';

// sql initialized inside handler for serverless compatibility

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');

    // Get all goals (optionally filtered by agent) with total cost aggregated from action_records
    // We assume actions link to goals via their declared_goal containing the goal title (fuzzy) 
    // OR we can implement a more explicit goal_id on actions later.
    // For now, let's look for actions where parent_action_id links to a goal's "primary" action if tracked.
    // Actually, a simpler way: let's just aggregate cost from action_records where declared_goal or description mentions the goal title.
    // EVEN BETTER: Let's just return the goal.cost_estimate which we will update whenever an action is reported.
    
    const goals = agentId
      ? await sql`SELECT * FROM goals WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY created_at DESC`
      : await sql`SELECT * FROM goals WHERE org_id = ${orgId} ORDER BY created_at DESC`;

    // Calculate aggregated costs for each goal (mock logic for now, using the column we added)
    const goalsWithData = goals.map(g => ({
      ...g,
      total_cost: g.cost_estimate || 0
    }));

    // Get milestones for each goal
    const milestones = agentId
      ? await sql`SELECT * FROM milestones WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY created_at DESC`
      : await sql`SELECT * FROM milestones WHERE org_id = ${orgId} ORDER BY created_at DESC`;

    // Attach milestones to goals
    const goalsWithMilestones = goals.map(g => ({
      ...g,
      milestones: milestones.filter(m => m.goal_id === g.id)
    }));

    // Calculate stats
    const active = goals.filter(g => g.status === 'active').length;
    const completed = goals.filter(g => g.status === 'completed').length;
    const avgProgress = goals.length > 0 
      ? Math.round(goals.reduce((sum, g) => sum + (g.progress || 0), 0) / goals.length)
      : 0;

    const stats = {
      totalGoals: goals.length,
      active,
      completed,
      avgProgress,
      totalMilestones: milestones.length,
      completedMilestones: milestones.filter(m => m.status === 'completed').length
    };

    return NextResponse.json({
      goals: goalsWithMilestones,
      stats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    // SECURITY: Log detailed error server-side, return generic message to client
    console.error('Goals API error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching goals data', goals: [], stats: {} }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { title: 500, category: 200, description: 5000, status: 50 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { title, category, description, target_date, progress, status, agent_id } = body;

    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO goals (org_id, title, category, description, target_date, progress, status, agent_id, created_at)
      VALUES (
        ${orgId},
        ${title},
        ${category || null},
        ${description || null},
        ${target_date || null},
        ${progress || 0},
        ${status || 'active'},
        ${agent_id || null},
        ${new Date().toISOString()}
      )
      RETURNING *
    `;

    const goal = result[0];

    // Publish event
    await publishOrgEvent(EVENTS.GOAL_CREATED, {
      orgId,
      goal,
    });

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    console.error('Goals API POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating the goal' }, { status: 500 });
  }
}

