/**
 * Sequential workflow executor.
 * Iterates steps, manages rolling context, dispatches to type-specific handlers,
 * creates child action records for each step.
 */

import crypto from 'crypto';
import { resolveVars } from './template-vars';
import { evaluateCondition } from './workflow-condition';
import {
  handleKnowledgeSearch,
  handleCapabilityInvoke,
  handlePrompt,
} from './step-handlers';
import { createActionRecord } from './repositories/actions.repository';
import { calculateBackoffDelay, sleep } from './capability-invoke';

/** SQL executor used by this module (Neon/postgres tagged-template form). */
type SqlClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  queryCalls?: unknown[];
};

interface RetryPolicy {
  max_retries?: number;
  backoff?: string;
  base_delay_ms?: number;
  max_delay_ms?: number;
}

interface WorkflowStep {
  id: string;
  type: string;
  name?: string;
  config?: Record<string, unknown>;
  condition?: unknown;
  retry_policy?: RetryPolicy;
  continue_on_failure?: boolean;
}

interface ResumeContext {
  priorSteps?: Record<string, { output?: unknown } | undefined>;
}

type PersistStepResult = (result: Record<string, unknown>) => Promise<unknown>;

interface WorkflowContext {
  agentId?: string;
  persistStepResult?: PersistStepResult | null;
  resumeContext?: ResumeContext | null;
  // Resolved model-strategy config, passed through to handlePrompt; routes
  // (model-strategy execute/resume) supply it, other callers leave it unset.
  strategyConfig?: unknown;
}

interface StepResult {
  step_id: string;
  type: string;
  status: string;
  elapsed_ms: number;
  error?: string;
  retry_metadata?: { total_attempts: number; retried: boolean };
}

interface WorkflowResult {
  success: boolean;
  steps: StepResult[];
  result?: unknown;
  error?: string;
  total_elapsed_ms: number;
}

const STEP_RISK_SCORES: Record<string, number> = {
  knowledge_search: 10,
  capability_invoke: 20,
  prompt: 20,
};

async function executeStep(
  sql: SqlClient,
  orgId: string,
  step: WorkflowStep,
  context: { variables: Record<string, unknown>; steps: Record<string, unknown> },
  workflowContext: WorkflowContext,
): Promise<unknown> {
  const resolvedConfig = resolveVars(step.config || {}, context);

  switch (step.type) {
    case 'knowledge_search':
      return handleKnowledgeSearch(sql, orgId, resolvedConfig as { collection_id?: string; query?: string; top_k?: number });
    case 'capability_invoke':
      return handleCapabilityInvoke(sql, orgId, resolvedConfig as { capability_id?: string; body?: unknown });
    case 'prompt':
      return handlePrompt(sql, orgId, resolvedConfig as { prompt_template?: string; system_prompt?: string; max_tokens?: number; temperature?: number }, workflowContext);
    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

export async function executeWorkflow(
  sql: SqlClient,
  orgId: string,
  parentActionId: string,
  steps: WorkflowStep[],
  variables: Record<string, unknown> | null | undefined,
  workflowContext: WorkflowContext,
): Promise<WorkflowResult> {
  const context: { variables: Record<string, unknown>; steps: Record<string, unknown> } = {
    variables: variables || {},
    steps: {},
  };
  const persistStepResult = workflowContext.persistStepResult || null;
  const resumeContext = workflowContext.resumeContext || null;

  // Pre-load prior step outputs for resume
  if (resumeContext?.priorSteps) {
    for (const [stepId, data] of Object.entries(resumeContext.priorSteps)) {
      context.steps[stepId] = data;
    }
  }

  const stepResults: StepResult[] = [];
  const start = Date.now();

  for (const step of steps) {
    const stepStart = Date.now();
    const stepActionId = `act_${crypto.randomUUID()}`;

    // Resume: a step is "reused" iff its ID has a captured output from the
    // prior run. Using step.id instead of positional index means template
    // edits between the original run and the resume — new steps inserted,
    // deleted, or reordered — don't misalign the reuse decision. The old
    // `indexOf(step) < resumeContext.resumeFromIndex` check would re-run
    // previously-completed steps whenever a step was inserted ahead of them,
    // and would silently skip new steps whose index happened to sit below
    // the original resumeFromIndex.
    if (resumeContext?.priorSteps?.[step.id]) {
      const stepIndex = steps.indexOf(step);
      const priorOutput = resumeContext.priorSteps[step.id]?.output || null;

      await createActionRecord(sql, {
        orgId,
        action_id: stepActionId,
        data: {
          agent_id: workflowContext.agentId || 'anonymous',
          action_type: `workflow_step:${step.type}`,
          declared_goal: `Step: ${step.name || step.id}`,
          parent_action_id: parentActionId,
          risk_score: 0,
          confidence: 100,
          systems_touched: [`workflow_step:${step.type}`],
          reversible: true,
          input_summary: 'Reused from prior run',
        },
        actionStatus: 'reused',
        costEstimate: 0,
        signature: null,
        verified: false,
        timestamp_start: new Date().toISOString(),
      });

      if (persistStepResult) {
        await persistStepResult({
          step_id: step.id,
          step_index: stepIndex,
          step_type: step.type,
          step_name: step.name || step.id,
          status: 'reused',
          output_json: priorOutput,
          duration_ms: 0,
          finished_at: new Date().toISOString(),
        }).catch((err: unknown) => console.warn('[Executor] Step result write failed:', (err as Error)?.message));
      }

      stepResults.push({
        step_id: step.id,
        type: step.type,
        status: 'reused',
        elapsed_ms: 0,
      });
      continue;
    }

    // Condition evaluation — skip if falsy
    if (step.condition) {
      const { shouldRun } = evaluateCondition(step.condition as string | null | undefined, context);
      if (!shouldRun) {
        const stepIndex = steps.indexOf(step);

        await createActionRecord(sql, {
          orgId,
          action_id: stepActionId,
          data: {
            agent_id: workflowContext.agentId || 'anonymous',
            action_type: `workflow_step:${step.type}`,
            declared_goal: `Step: ${step.name || step.id}`,
            parent_action_id: parentActionId,
            risk_score: 0,
            confidence: 100,
            systems_touched: [`workflow_step:${step.type}`],
            reversible: true,
            input_summary: 'Condition not met',
          },
          actionStatus: 'skipped',
          costEstimate: 0,
          signature: null,
          verified: false,
          timestamp_start: new Date().toISOString(),
        });

        if (persistStepResult) {
          await persistStepResult({
            step_id: step.id,
            step_index: stepIndex,
            step_type: step.type,
            step_name: step.name || step.id,
            status: 'skipped',
            duration_ms: 0,
            finished_at: new Date().toISOString(),
          }).catch((err: unknown) => console.warn('[Executor] Step result write failed:', (err as Error)?.message));
        }

        stepResults.push({
          step_id: step.id,
          type: step.type,
          status: 'skipped',
          elapsed_ms: 0,
        });
        continue;
      }
    }

    // Create child action record
    await createActionRecord(sql, {
      orgId,
      action_id: stepActionId,
      data: {
        agent_id: workflowContext.agentId || 'anonymous',
        action_type: `workflow_step:${step.type}`,
        declared_goal: `Step: ${step.name || step.id}`,
        parent_action_id: parentActionId,
        risk_score: STEP_RISK_SCORES[step.type] || 20,
        confidence: 50,
        systems_touched: [`workflow_step:${step.type}`],
        reversible: true,
        input_summary: JSON.stringify(resolveVars(step.config || {}, context)).slice(0, 500),
      },
      actionStatus: 'running',
      costEstimate: 0,
      signature: null,
      verified: false,
      timestamp_start: new Date().toISOString(),
    });

    const stepIndex = steps.indexOf(step);

    if (persistStepResult) {
      await persistStepResult({
        step_id: step.id,
        step_index: stepIndex,
        step_type: step.type,
        step_name: step.name || step.id,
        status: 'running',
        input_json: resolveVars(step.config || {}, context),
        started_at: new Date().toISOString(),
      }).catch((err: unknown) => console.warn('[Executor] Step result write failed:', (err as Error)?.message));
    }

    const maxRetries = step.retry_policy?.max_retries || 0;
    const backoff = step.retry_policy?.backoff || 'none';
    const baseDelayMs = step.retry_policy?.base_delay_ms || 1000;
    const maxDelayMs = step.retry_policy?.max_delay_ms || 30000;
    let lastError: Error | null = null;
    let succeeded = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const output = await executeStep(sql, orgId, step, context, workflowContext);
        const stepElapsed = Date.now() - stepStart;

        const retryPrefix = attempt > 0 ? `[retried: ${attempt + 1} attempts] ` : '';
        // Persist token counts when the step returned them (prompt steps do;
        // other step types don't). Without this, every workflow prompt step
        // records zero tokens and analytics report a false zero-token gap.
        const out = output as { tokens_in?: unknown; tokens_out?: unknown } | null | undefined;
        const tokensIn = Number.isFinite(out?.tokens_in) ? (out!.tokens_in as number) : 0;
        const tokensOut = Number.isFinite(out?.tokens_out) ? (out!.tokens_out as number) : 0;
        await sql`
          UPDATE action_records
          SET status = 'completed',
              output_summary = ${retryPrefix + JSON.stringify(output).slice(0, 500 - retryPrefix.length)},
              timestamp_end = ${new Date().toISOString()},
              duration_ms = ${stepElapsed},
              tokens_in = ${tokensIn},
              tokens_out = ${tokensOut}
          WHERE action_id = ${stepActionId} AND org_id = ${orgId}
        `;

        context.steps[step.id] = { output };

        if (persistStepResult) {
          await persistStepResult({
            step_id: step.id,
            step_index: stepIndex,
            step_type: step.type,
            step_name: step.name || step.id,
            status: 'completed',
            output_json: output,
            retry_count: attempt,
            duration_ms: stepElapsed,
            finished_at: new Date().toISOString(),
          }).catch((err: unknown) => console.warn('[Executor] Step result write failed:', (err as Error)?.message));
        }

        stepResults.push({
          step_id: step.id,
          type: step.type,
          status: 'completed',
          elapsed_ms: stepElapsed,
          ...(attempt > 0 ? { retry_metadata: { total_attempts: attempt + 1, retried: true } } : {}),
        });
        succeeded = true;
        break;
      } catch (err) {
        lastError = err as Error;

        if (attempt < maxRetries) {
          const delay = calculateBackoffDelay(attempt, backoff, baseDelayMs, maxDelayMs);
          if (delay > 0) await sleep(delay);
          continue;
        }
      }
    }

    if (!succeeded) {
      const stepElapsed = Date.now() - stepStart;
      const retryPrefix = maxRetries > 0 ? `[retried: ${maxRetries + 1} attempts] ` : '';

      await sql`
        UPDATE action_records
        SET status = 'failed',
            error_message = ${retryPrefix + lastError!.message.slice(0, 500 - retryPrefix.length)},
            timestamp_end = ${new Date().toISOString()},
            duration_ms = ${stepElapsed}
        WHERE action_id = ${stepActionId} AND org_id = ${orgId}
      `;

      stepResults.push({
        step_id: step.id,
        type: step.type,
        status: 'failed',
        error: lastError!.message,
        elapsed_ms: stepElapsed,
        ...(maxRetries > 0 ? { retry_metadata: { total_attempts: maxRetries + 1, retried: true } } : {}),
      });

      if (persistStepResult) {
        await persistStepResult({
          step_id: step.id,
          step_index: stepIndex,
          step_type: step.type,
          step_name: step.name || step.id,
          status: 'failed',
          error_message: lastError!.message,
          retry_count: maxRetries,
          duration_ms: stepElapsed,
          finished_at: new Date().toISOString(),
        }).catch((err: unknown) => console.warn('[Executor] Step result write failed:', (err as Error)?.message));
      }

      if (step.continue_on_failure) {
        continue;
      }

      return {
        success: false,
        steps: stepResults,
        error: `Step ${step.id} failed: ${lastError!.message}`,
        total_elapsed_ms: Date.now() - start,
      };
    }
  }

  // All steps completed — return final step output as result
  const lastStep = steps[steps.length - 1]!;
  const lastStepId = lastStep.id;
  const result = (context.steps[lastStepId] as { output?: unknown } | undefined)?.output || {};

  return {
    success: true,
    steps: stepResults,
    result,
    total_elapsed_ms: Date.now() - start,
  };
}
