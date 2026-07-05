export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSql } from '../../../../../lib/db';
import { getOrgId, getUserId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import { evaluateGuard } from '../../../../../lib/guard';
import { fireApprovalSurfaces } from '../../../../../lib/approvalSurfaces';
import { getWorkflowTemplate } from '../../../../../lib/repositories/workflow-templates.repository';
import { getModelStrategy } from '../../../../../lib/repositories/model-strategies.repository';
import {
  createActionRecord,
  createBlockedActionRecord,
  updateActionOutcome,
} from '../../../../../lib/repositories/actions.repository';
import { redactAny } from '../../../../../lib/security';
import { executeWorkflow } from '../../../../../lib/workflow-executor';
import { insertStepResult, updateStepResult } from '../../../../../lib/repositories/workflow-runs.repository';
import { createArtifact as createArtifactRecord } from '../../../../../lib/repositories/artifacts.repository';
import { checkQuotaFast, getOrgPlan, incrementMeter } from '../../../../../lib/usage';


export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    // 1. Load workflow template
    const template = await getWorkflowTemplate(sql, orgId, templateId);
    if (!template) {
      return NextResponse.json(
        { success: false, error: 'workflow_not_found' },
        { status: 404 },
      );
    }

    const steps = (template.steps as any[]) || [];
    if (steps.length === 0) {
      return NextResponse.json(
        { success: false, error: 'workflow_has_no_steps' },
        { status: 400 },
      );
    }

    const action_id = `act_${crypto.randomUUID()}`;
    const timestamp_start = new Date().toISOString();
    const variables = body.variables || {};
    const agentId = body.agent_id || 'anonymous';

    // 2. Guard evaluation
    const guardDecision = await evaluateGuard(
      orgId,
      {
        action_type: 'workflow_execute',
        risk_score: 50,
        agent_id: agentId,
        systems_touched: [`workflow:${template.slug}`],
        reversible: true,
        declared_goal: body.declared_goal || `Execute workflow: ${template.name}`,
      },
      sql,
    );

    // 3. DLP scan
    const dlpFindings: any[] = [];
    const inputSummary = redactAny(
      JSON.stringify(variables).slice(0, 500),
      dlpFindings,
    ) as string;

    // Attach reasoning at creation time so the outcome UPDATE only has to
    // write OUTCOME_FIELDS and can go through updateActionOutcome (matches
    // the resume route's pattern and respects the route-SQL guardrail).
    const reasoning = JSON.stringify({
      template_id: template.template_id,
      template_name: template.name,
    });

    const actionData = {
      agent_id: agentId,
      action_type: 'workflow_execute',
      declared_goal: body.declared_goal || `Execute workflow: ${template.name}`,
      systems_touched: [`workflow:${template.slug}`],
      reversible: true,
      risk_score: 50,
      confidence: 50,
      input_summary: inputSummary,
      trigger: `workflow:${template.template_id}`,
      reasoning,
    };

    // 4. Handle guard blocked
    if (guardDecision.decision === 'block') {
      await createBlockedActionRecord(sql, {
        orgId,
        action_id,
        data: actionData,
        guardDecision,
        signature: null,
        verified: false,
        timestamp_start,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'blocked_by_policy',
          guard_decision: {
            decision: guardDecision.decision,
            reasons: guardDecision.reasons || [],
            matched_policies: guardDecision.matched_policies || [],
          },
        },
        { status: 403 },
      );
    }

    // 4b. Handle guard require_approval — create a pending_approval record, notify
    // operators, and return 202. The workflow does NOT run until an operator
    // approves; the caller polls GET /api/actions/{id} for the outcome. (Mirrors
    // the capability-invoke route so require_approval policies actually gate workflows.)
    if (guardDecision.decision === 'require_approval') {
      const createdAction = await createActionRecord(sql, {
        orgId,
        action_id,
        data: { ...actionData, status: 'pending_approval' },
        actionStatus: 'pending_approval',
        costEstimate: 0,
        signature: null,
        verified: false,
        timestamp_start,
        // Separation of duties (drizzle/0055): trusted middleware principal.
        createdBy: getUserId(request) || null,
      });

      fireApprovalSurfaces(createdAction as unknown as Parameters<typeof fireApprovalSurfaces>[0], sql, orgId, guardDecision);

      return NextResponse.json(
        {
          success: false,
          error: 'pending_approval',
          action_id,
          message: `Workflow execution requires human approval. Poll GET /api/actions/${action_id} for status.`,
        },
        { status: 202 },
      );
    }

    // Quota check
    const plan = await getOrgPlan(orgId, sql);
    const wfQuota = await checkQuotaFast(orgId, 'workflow_executions', plan, sql);
    if (!wfQuota.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'quota_exceeded',
          code: 'QUOTA_EXCEEDED',
          resource: 'workflow_executions',
          usage: wfQuota.usage,
          limit: wfQuota.limit,
          message: 'Monthly workflow execution limit exceeded. Upgrade your plan to continue.',
          upgrade_url: '/usage',
        },
        { status: 402 },
      );
    }

    // 5. Resolve model strategy (snapshot at launch)
    let strategyConfig = null;
    if (template.model_strategy_id) {
      const strategy = await getModelStrategy(sql, orgId, template.model_strategy_id as string);
      if (strategy) {
        strategyConfig = strategy.config;
      }
    }

    // 6. Create parent action record
    await createActionRecord(sql, {
      orgId,
      action_id,
      data: actionData,
      actionStatus: 'running',
      costEstimate: 0,
      signature: null,
      verified: false,
      timestamp_start,
      createdBy: getUserId(request) || null,
    });

    // 7. Build step result persistence callback
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
          }).catch((err) => console.warn('[Execute] Artifact capture failed:', err.message));
        }
      }
    };

    // 8. Execute workflow. Any throw inside executeWorkflow (step handler
    // crash, DB write failure mid-run, quota error) used to fall through
    // to the outer catch below, which returned an error response but left
    // the parent action_records row in status='running' forever. The
    // workflow_stuck + stale_running_action signals then fired against it
    // on every cron tick. Wrap here so we always transition the parent to
    // a terminal state before the outer handler returns.
    let result;
    try {
      result = await executeWorkflow(
        sql,
        orgId,
        action_id,
        steps,
        variables,
        { strategyConfig, agentId, persistStepResult } as unknown as Parameters<typeof executeWorkflow>[5],
      );
    } catch (executeError) {
      const failTs = new Date().toISOString();
      try {
        await updateActionOutcome(sql, orgId, action_id, {
          status: 'failed',
          output_summary: (executeError as Error)?.message?.slice(0, 500) || 'Workflow execution threw',
          error_message: (executeError as Error)?.message || String(executeError),
          timestamp_end: failTs,
          duration_ms: Date.now() - Date.parse(timestamp_start),
        }, { gateStatus: 'running' });
      } catch (outcomeError) {
        console.error('[WORKFLOW_EXECUTE] failed to mark parent action as failed:', (outcomeError as Error)?.message);
      }
      throw executeError;
    }

    // 9. Update parent action outcome via repository (no direct SQL).
    // reasoning was set at creation time above; `steps` detail is visible
    // through the workflow_step_results rows persisted by persistStepResult.
    const timestamp_end = new Date().toISOString();
    const outputSummary = result.success
      ? JSON.stringify(result.result).slice(0, 500)
      : result.error;

    // Gate the terminal write on status='running'. An operator cancel
    // (POST .../runs/[id]/cancel) flips the parent running->cancelled via CAS
    // during the up-to-120s execution window; without the gate this write would
    // clobber the cancel back to completed/failed. The gate matches in the
    // normal path (the parent stays 'running' until this write), so behavior is
    // unchanged when no cancel raced.
    await updateActionOutcome(sql, orgId, action_id, {
      status: result.success ? 'completed' : 'failed',
      output_summary: outputSummary,
      error_message: result.success ? null : result.error,
      timestamp_end,
      duration_ms: result.total_elapsed_ms || 0,
    }, { gateStatus: 'running' });

    // Meter increment (fire-and-forget)
    void Promise.all([
      incrementMeter(orgId, 'workflow_executions', sql),
      incrementMeter(orgId, 'governed_actions', sql),
    ]).catch((err) => console.warn('[API] Meter increment failed:', err.message));

    // 10. Return response
    const status = result.success ? 200 : 500;
    return NextResponse.json(
      {
        success: result.success,
        action_id,
        steps: result.steps,
        result: result.result || undefined,
        error: result.error || undefined,
        total_elapsed_ms: result.total_elapsed_ms,
        governed: true,
        quota_warning: wfQuota.warning || undefined,
        security: {
          clean: dlpFindings.length === 0,
          findings_count: dlpFindings.length,
          critical_count: dlpFindings.filter((f) => f.severity === 'critical').length,
          categories: [...new Set(dlpFindings.map((f) => f.category))],
        },
      },
      { status },
    );
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW_EXECUTE');
  }
}
