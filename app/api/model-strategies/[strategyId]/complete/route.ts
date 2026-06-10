export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { getModelStrategy } from '../../../../lib/repositories/model-strategies.repository';
import { executeCompletion } from '../../../../lib/providers';

/**
 * POST /api/model-strategies/:strategyId/complete
 *
 * Execute a chat completion using the specified model strategy. Resolves
 * BYOK provider credentials from org settings, calls the primary provider,
 * falls back through the chain on failure, enforces budget caps, and returns
 * a normalized response with cost tracking.
 *
 * Body:
 *   messages: Array<{ role: 'system'|'user'|'assistant', content: string }>  (required)
 *   max_tokens?: number (default 1024)
 *   temperature?: number (default 0.7)
 *   task_mode?: string (optional — overrides primary with taskModes[mode])
 */
export async function POST(request: Request, { params }: { params: Promise<{ strategyId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { strategyId } = await params;

    const strategy = await getModelStrategy(sql, orgId, strategyId);
    if (!strategy) {
      return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
    }

    const body = await request.json();
    if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 });
    }

    // Validate messages shape
    for (const msg of body.messages) {
      if (!msg.role || !msg.content) {
        return NextResponse.json(
          { error: 'Each message must have role and content' },
          { status: 400 }
        );
      }
    }

    const result = await executeCompletion(sql, orgId, strategy.config as object, body.messages, {
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      task_mode: body.task_mode,
    });

    return NextResponse.json({
      ...result,
      strategy_id: strategy.strategy_id,
      strategy_name: strategy.name,
    });
  } catch (error) {
    // Surface provider chain failures as 502
    if ((error as { provider_errors?: unknown }).provider_errors) {
      return NextResponse.json(
        {
          error: (error as Error).message,
          provider_errors: (error as { provider_errors?: unknown }).provider_errors,
        },
        { status: 502 }
      );
    }
    return apiErrorResponse(error, 'MODEL STRATEGY COMPLETE');
  }
}
