export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { fetchDigestData } from '../../../lib/repositories/digest.repository';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const date = searchParams.get('date'); // null = recent (no date filter)

    const raw = await fetchDigestData(sql, orgId, { agentId, date });

    const actions = raw.actions;
    const decisions = raw.decisions;
    const lessons = raw.lessons;
    const content = raw.content;
    const ideas = raw.ideas;
    const interactions = raw.interactions;
    const goals = raw.goals;

    // Compute stats
    const completedActions = actions.filter(a => a.status === 'completed').length;
    const failedActions = actions.filter(a => a.status === 'failed').length;
    const avgRisk = actions.length > 0
      ? Math.round(actions.reduce((sum, a) => sum + (a.risk_score || 0), 0) / actions.length)
      : 0;

    return NextResponse.json({
      date: date || null,
      agent_id: agentId || null,
      digest: {
        actions: {
          total: actions.length,
          completed: completedActions,
          failed: failedActions,
          avg_risk: avgRisk,
          items: actions.slice(0, 20).map(a => ({
            action_id: a.action_id,
            action_type: a.action_type,
            declared_goal: a.declared_goal,
            status: a.status,
            risk_score: a.risk_score,
            timestamp_start: a.timestamp_start,
          })),
        },
        decisions: {
          total: decisions.length,
          items: decisions.slice(0, 10).map(d => ({
            id: d.id,
            decision: d.decision,
            outcome: d.outcome,
            timestamp: d.timestamp,
          })),
        },
        lessons: {
          total: lessons.length,
          items: lessons.slice(0, 10).map(l => ({
            id: l.id,
            lesson: l.lesson || l.content,
            timestamp: l.timestamp,
          })),
        },
        content: {
          total: content.length,
          items: content.slice(0, 10).map(c => ({
            id: c.id,
            title: c.title,
            platform: c.platform,
            status: c.status,
            created_at: c.created_at,
          })),
        },
        ideas: {
          total: ideas.length,
          items: ideas.slice(0, 10).map(i => ({
            id: i.id,
            title: i.title,
            score: i.score,
            captured_at: i.captured_at,
          })),
        },
        interactions: {
          total: interactions.length,
          items: interactions.slice(0, 10).map(i => ({
            id: i.id,
            summary: i.summary,
            direction: i.direction,
            created_at: i.created_at,
          })),
        },
        goals: {
          total: goals.length,
          items: goals.slice(0, 10).map(g => ({
            id: g.id,
            title: g.title,
            progress: g.progress,
            status: g.status,
            created_at: g.created_at,
          })),
        },
      },
      summary: {
        total_activities: actions.length + decisions.length + lessons.length + content.length + ideas.length + interactions.length + goals.length,
        action_count: actions.length,
        decision_count: decisions.length,
        lesson_count: lessons.length,
        content_count: content.length,
        idea_count: ideas.length,
        interaction_count: interactions.length,
        goal_count: goals.length,
      },
    });
  } catch (error) {
    console.error('Digest GET error:', error);
    return NextResponse.json({ error: 'An error occurred while generating digest' }, { status: 500 });
  }
}
