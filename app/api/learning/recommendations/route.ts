export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import {
  listLearningEpisodes,
  listLearningRecommendations,
} from '../../../lib/repositories/learningLoop.repository';
import {
  getLearningRecommendationMetrics,
  rebuildLearningRecommendations,
  recordLearningRecommendationEvents,
  scoreAndStoreActionEpisode,
} from '../../../lib/learningLoop.service';

function parseBoundedInt(value: unknown, fieldName: string, min: number, max: number, fallback: number, errors: string[]): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    errors.push(`${fieldName} must be an integer`);
    return fallback;
  }
  if (parsed < min || parsed > max) {
    errors.push(`${fieldName} must be between ${min} and ${max}`);
    return fallback;
  }
  return parsed;
}

function parseBoundedIntSafe(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function validatePostBody(body: any) {
  const errors: string[] = [];
  const data: {
    agentId: string | undefined;
    actionType: string | undefined;
    actionId: string | undefined;
    lookbackDays: number;
    episodeLimit: number;
    minSamples: number;
  } = {
    agentId: undefined,
    actionType: undefined,
    actionId: undefined,
    lookbackDays: 30,
    episodeLimit: 5000,
    minSamples: 5,
  };

  if (body.agent_id !== undefined) {
    if (typeof body.agent_id !== 'string' || body.agent_id.length === 0 || body.agent_id.length > 128) {
      errors.push('agent_id must be a non-empty string up to 128 chars');
    } else {
      data.agentId = body.agent_id;
    }
  }

  if (body.action_type !== undefined) {
    if (typeof body.action_type !== 'string' || body.action_type.length === 0 || body.action_type.length > 128) {
      errors.push('action_type must be a non-empty string up to 128 chars');
    } else {
      data.actionType = body.action_type;
    }
  }

  if (body.action_id !== undefined) {
    if (typeof body.action_id !== 'string' || body.action_id.length === 0 || body.action_id.length > 128) {
      errors.push('action_id must be a non-empty string up to 128 chars');
    } else {
      data.actionId = body.action_id;
    }
  }

  data.lookbackDays = parseBoundedInt(body.lookback_days, 'lookback_days', 1, 365, 30, errors);
  data.episodeLimit = parseBoundedInt(body.episode_limit, 'episode_limit', 100, 10000, 5000, errors);
  data.minSamples = parseBoundedInt(body.min_samples, 'min_samples', 2, 100, 5, errors);

  return { valid: errors.length === 0, errors, data };
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const role = getOrgRole(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id') || undefined;
    const actionType = searchParams.get('action_type') || undefined;
    const includeInactive = searchParams.get('include_inactive') === 'true';
    const includeMetrics = searchParams.get('include_metrics') === 'true';
    const trackEvents = searchParams.get('track_events') === 'true';
    const lookbackDays = parseBoundedIntSafe(searchParams.get('lookback_days'), 1, 365, 30);
    const limit = parseBoundedIntSafe(searchParams.get('limit'), 1, 200, 50);

    const recommendations = await listLearningRecommendations(sql, orgId, {
      agentId,
      actionType,
      limit,
      includeInactive: includeInactive && (role === 'admin' || role === 'service'),
    });

    if (trackEvents && agentId && recommendations.length > 0) {
      const events = recommendations.map((rec: any) => ({
        recommendation_id: rec.id,
        agent_id: agentId,
        event_type: 'fetched',
        details: {
          action_type: rec.action_type,
          confidence: rec.confidence,
        },
      }));
      void recordLearningRecommendationEvents(sql, orgId, events).catch((err: unknown) => {
        console.warn('[Learning] Failed to record recommendation events:', (err as Error).message);
      });
    }

    let metrics = undefined;
    if (includeMetrics) {
      const episodes = await listLearningEpisodes(sql, orgId, {
        agentId,
        actionType,
        lookbackDays,
        limit: 10000,
      });
      metrics = await getLearningRecommendationMetrics(sql, orgId, {
        recommendations,
        episodes,
        agentId,
        actionType,
        lookbackDays,
      });
    }

    return NextResponse.json({
      recommendations,
      metrics,
      lookback_days: lookbackDays,
      total: recommendations.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Learning recommendations GET error:', error);
    // If the learning-loop schema hasn't been migrated yet, treat as "feature disabled" instead of hard-failing the UI.
    if (String((error as { code?: string })?.code || '').includes('42P01') || String((error as Error)?.message || '').includes('does not exist')) {
      return NextResponse.json({
        recommendations: [],
        metrics: null,
        lookback_days: 30,
        total: 0,
        schema_missing: true,
        lastUpdated: new Date().toISOString(),
      });
    }
    return NextResponse.json(
      { error: 'An error occurred while fetching learning recommendations', recommendations: [], total: 0 },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin' && role !== 'service') {
      return NextResponse.json(
        { error: 'Admin or service role required' },
        { status: 403 }
      );
    }

    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => ({}));

    const { valid, errors, data } = validatePostBody(body);
    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    let scoredEpisode = null;
    if (data.actionId) {
      scoredEpisode = await scoreAndStoreActionEpisode(sql, orgId, data.actionId);
    }

    const rebuilt = await rebuildLearningRecommendations(sql, orgId, {
      agentId: data.agentId,
      actionType: data.actionType,
      lookbackDays: data.lookbackDays,
      episodeLimit: data.episodeLimit,
      minSamples: data.minSamples,
    });

    return NextResponse.json({
      scored_episode: scoredEpisode,
      episodes_scanned: rebuilt.episodes_scanned,
      recommendations: rebuilt.recommendations,
      total: rebuilt.recommendations.length,
      rebuilt_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Learning recommendations POST error:', error);
    return NextResponse.json(
      { error: 'An error occurred while rebuilding learning recommendations' },
      { status: 500 }
    );
  }
}
