export const dynamic = 'force-dynamic';
export const maxDuration = 120;

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSql } from '../../../../../../../lib/db';
import { getOrgId } from '../../../../../../../lib/org';
import { apiErrorResponse } from '../../../../../../../lib/apiErrors';
import { evaluateGuard } from '../../../../../../../lib/guard';
import { getWorkflowTemplate } from '../../../../../../../lib/repositories/workflow-templates.repository';
import {
  getWorkflowRun,
  buildResumeContext,
  insertStepResult,
  updateStepResult,
} from '../../../../../../../lib/repositories/workflow-runs.repository';
import {
  createActionRecord,
  updateActionOutcome,
} from '../../../../../../../lib/repositories/actions.repository';
import { createArtifact as createArtifactRecord } from '../../../../../../../lib/repositories/artifacts.repository';
import { executeWorkflow } from '../../../../../../../lib/workflow-executor';

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string; runActionId: string }> }) {
  try {
    const { templateId, runActionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => ({}));

    // 1. Load original run
    const originalRun = await getWorkflowRun(sql, orgId, runActionId);
    if (!originalRun) {
      return NextResponse.json({ error: 'run_not_found' }, { status: 404 });
    }

    if (originalRun.status !== 'failed') {
      return NextResponse.json(
        { error: 'only_failed_runs', message: 'Only failed runs can be resumed.' },
        { status: 400 },
      );
    }

    // 2. Load template
    const template = await getWorkflowTemplate(sql, orgId, templateId);
    if (!template) {
      return NextResponse.json({ error: 'workflow_not_found' }, { status: 404 });
    }

    const steps = (template.steps as any[]) || [];
    if (steps.length === 0) {
      return NextResponse.json({ error: 'workflow_has_no_steps' }, { status: 400 });
    }

    // 3. Build resume context
    const fromStepId = body.from_step || null;
    const resumeCtx = buildResumeContext(originalRun.steps as any[], fromStepId);
    if (!resumeCtx) {
      return NextResponse.json(
        { error: 'nothing_to_resume', message: 'All steps completed or no steps to resume.' },
        { status: 400 },
      );
    }

    const action_id = `act_${crypto.randomUUID()}`;
    const timestamp_start = new Date().toISOString();
    const agentId = body.agent_id || originalRun.agent_id || 'anonymous';
    const variables = body.variables || {};

    // 4. Guard evaluation
    const guardDecision = await evaluateGuard(
      orgId,
      {
        action_type: 'workflow_execute',
        risk_score: 40,
        agent_id: agentId,
        systems_touched: [`workflow:${template.slug}`],
        reversible: true,
        declared_goal: `Resume workflow: ${template.name} (from step ${resumeCtx.resumeFromIndex})`,
      },
      sql,
    );

    if (guardDecision.decision === 'block') {
      return NextResponse.json(
        { error: 'blocked_by_policy', guard_decision: guardDecision },
        { status: 403 },
      );
    }

    // 5. Create parent action record for new run
    // Set reasoning at creation time so we avoid a direct SQL UPDATE later
    const reasoning = JSON.stringify({
      template_id: template.template_id,
      template_name: template.name,
      resumed_from: runActionId,
      resume_step_index: resumeCtx.resumeFromIndex,
    });

    await createActionRecord(sql, {
      orgId,
      action_id,
      data: {
        agent_id: agentId,
        action_type: 'workflow_execute',
        declared_goal: `Resume workflow: ${template.name}`,
        systems_touched: [`workflow:${template.slug}`],
        reversible: true,
        risk_score: 40,
        confidence: 50,
        input_summary: `Resumed from ${runActionId} at step ${resumeCtx.resumeFromIndex}`,
        trigger: `workflow:${template.template_id}`,
        reasoning,
      },
      actionStatus: 'running',
      costEstimate: 0,
      signature: null,
      verified: false,
      timestamp_start,
    });

    // 6. Build step result persistence callback
    const persistStepResult = async (stepData: any) => {
      if (stepData.status === 'running') {
        await insertStepResult(sql, {
          stepResultId: `sr_${crypto.randomUUID()}`,
          runActionId: action_id,
          orgId,
          templateId,
          stepData,
        });
      } else {
        await updateStepResult(sql, {
          runActionId: action_id,
          orgId,
          stepData,
        });

        // Auto-capture step output as artifact
        if (stepData.status === 'completed' && stepData.output_json) {
          createArtifactRecord(sql, orgId, {
            artifact_type: 'json',
            name: `Step output: ${stepData.step_name || stepData.step_id}`,
            content_json: stepData.output_json,
            source_action_id: action_id,
            source_step_id: stepData.step_id,
            source_agent_id: agentId,
            tags: ['auto-captured', 'workflow-step-output'],
          }).catch((err) => console.warn('[Resume] Artifact capture failed:', err.message));
        }
      }
    };

    // For reused steps, insert directly (they don't go through running->completed flow)
    const originalPersist = persistStepResult;
    const resumePersist = async (stepData: any) => {
      if (stepData.status === 'reused') {
        await insertStepResult(sql, {
          stepResultId: `sr_${crypto.randomUUID()}`,
          runActionId: action_id,
          orgId,
          templateId,
          stepData: { ...stepData, started_at: timestamp_start },
        });
        await updateStepResult(sql, {
          runActionId: action_id,
          orgId,
          stepData,
        });
        return;
      }
      return originalPersist(stepData);
    };

    // 7. Execute with resume context. Mirror the execute route: a throw inside
    // executeWorkflow (DB write failure mid-run, quota error) must still
    // transition the parent action out of 'running', otherwise it lingers and
    // the workflow_stuck signal fires against it on every cron tick.
    let result;
    try {
      result = await executeWorkflow(
        sql,
        orgId,
        action_id,
        steps,
        variables,
        {
          strategyConfig: null,
          agentId,
          persistStepResult: resumePersist,
          resumeContext: resumeCtx,
        } as unknown as Parameters<typeof executeWorkflow>[5],
      );
    } catch (executeError) {
      try {
        await updateActionOutcome(sql, orgId, action_id, {
          status: 'failed',
          output_summary: (executeError as Error)?.message?.slice(0, 500) || 'Workflow resume threw',
          error_message: (executeError as Error)?.message || String(executeError),
          timestamp_end: new Date().toISOString(),
        }, { gateStatus: 'running' });
      } catch (outcomeError) {
        console.error('[WORKFLOW_RESUME] failed to mark parent action as failed:', (outcomeError as Error)?.message);
      }
      throw executeError;
    }

    // 8. Update parent action outcome via repository (no direct SQL). Gated on
    // status='running' for the same cancel-race reason as the execute route.
    const timestamp_end = new Date().toISOString();
    await updateActionOutcome(sql, orgId, action_id, {
      status: result.success ? 'completed' : 'failed',
      output_summary: result.success ? JSON.stringify(result.result).slice(0, 500) : result.error,
      error_message: result.success ? null : result.error,
      timestamp_end,
      duration_ms: result.total_elapsed_ms || 0,
    }, { gateStatus: 'running' });

    return NextResponse.json({
      success: result.success,
      action_id,
      resumed_from: runActionId,
      resume_step_index: resumeCtx.resumeFromIndex,
      steps: result.steps,
      result: result.result || undefined,
      error: result.error || undefined,
      total_elapsed_ms: result.total_elapsed_ms,
    });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW_RESUME');
  }
}
