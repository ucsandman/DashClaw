export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import {
  getWorkflowTemplate,
  launchWorkflowTemplate,
} from '../../../../../lib/repositories/workflow-templates.repository';
import { getModelStrategy } from '../../../../../lib/repositories/model-strategies.repository';

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { templateId } = await params;

    let body: any = {};
    try {
      body = (await request.json()) || {};
    } catch {
      body = {};
    }

    const template = await getWorkflowTemplate(sql, orgId, templateId);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Resolve linked model strategy (if any) into a frozen snapshot at launch time.
    let resolvedStrategy = null;
    if (template.model_strategy_id) {
      try {
        const strategy = await getModelStrategy(sql, orgId, template.model_strategy_id as string);
        if (strategy) {
          resolvedStrategy = {
            strategy_id: strategy.strategy_id,
            name: strategy.name,
            config: strategy.config,
          };
        }
      } catch (err) {
        // Strategy resolution must not block launch — but a dead lookup should be visible.
        console.warn('[WORKFLOWS/LAUNCH] strategy resolution failed:', err instanceof Error ? err.message : String(err));
      }
    }

    const launch = await launchWorkflowTemplate(sql, orgId, templateId, {
      agent_id: body.agent_id || 'workflow_launcher',
      declared_goal: body.declared_goal,
      resolvedStrategy,
    });

    return NextResponse.json({ launch }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW TEMPLATE LAUNCH');
  }
}
