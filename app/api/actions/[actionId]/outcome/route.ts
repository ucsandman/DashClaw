export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { EVENTS, publishOrgEvent } from '../../../../lib/events';
import { scanSensitiveData } from '../../../../lib/security';
import {
  getActionOutcome,
  setActionOutcome,
  getActionStatus,
} from '../../../../lib/repositories/actions.repository';

// Terminal states an agent is allowed to report. `lost_confirmation` is
// reserved for the system sweep (Phase 2) and rejected from this endpoint.
const AGENT_TERMINAL_STATES = new Set(['completed', 'partial', 'failed']);

// (R10) Lifecycle states for which reporting an execution outcome is illegitimate:
// the action was never dispatched for execution (blocked / not-yet-approved /
// cancelled) or already concluded as denied/failed. Without this gate the
// one-shot `outcome_status='pending'` guard alone let an agent stamp a
// 'completed' outcome onto a blocked or denied action.
const OUTCOME_FORBIDDEN_STATUSES = new Set(['blocked', 'pending_approval', 'cancelled', 'failed']);

const MAX_SUMMARY_LEN = 4000;
const MAX_ERROR_LEN = 4000;
const MAX_PROGRESS_BYTES = 8 * 1024;

function redactString(value: unknown, findings: unknown[]): unknown {
  if (typeof value !== 'string') return value;
  const scan = scanSensitiveData(value);
  if (!scan.clean) findings.push(...scan.findings);
  return scan.redacted ?? value;
}

function redactProgress(progress: unknown, findings: unknown[]): unknown {
  if (!progress || typeof progress !== 'object') return progress;
  if (Array.isArray(progress)) {
    return progress.map((v) => (typeof v === 'string' ? redactString(v, findings) : v));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(progress)) {
    out[k] = typeof v === 'string' ? redactString(v, findings) : v;
  }
  return out;
}

export async function GET(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;

    const outcome = await getActionOutcome(sql, orgId, actionId);
    if (!outcome) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }

    return NextResponse.json(outcome);
  } catch (error) {
    return apiErrorResponse(error, 'ACTION_OUTCOME_GET');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { actionId } = await params;
    const body = await request.json();

    const status = body?.status;
    if (!AGENT_TERMINAL_STATES.has(status)) {
      return NextResponse.json(
        {
          error: 'Invalid status',
          details: `status must be one of: ${[...AGENT_TERMINAL_STATES].join(', ')}`,
        },
        { status: 400 },
      );
    }

    let summary = body?.summary ?? null;
    let errorMessage = body?.error_message ?? null;
    let progress = body?.progress ?? null;

    if (status === 'failed' && !errorMessage) {
      return NextResponse.json(
        { error: 'error_message is required when status is "failed"' },
        { status: 400 },
      );
    }
    if (status === 'partial' && (progress == null || typeof progress !== 'object')) {
      return NextResponse.json(
        { error: 'progress (object) is required when status is "partial"' },
        { status: 400 },
      );
    }

    if (typeof summary === 'string' && summary.length > MAX_SUMMARY_LEN) {
      summary = summary.slice(0, MAX_SUMMARY_LEN);
    }
    if (typeof errorMessage === 'string' && errorMessage.length > MAX_ERROR_LEN) {
      errorMessage = errorMessage.slice(0, MAX_ERROR_LEN);
    }
    if (progress != null) {
      const size = Buffer.byteLength(JSON.stringify(progress), 'utf8');
      if (size > MAX_PROGRESS_BYTES) {
        return NextResponse.json(
          { error: `progress payload too large (${size} bytes; max ${MAX_PROGRESS_BYTES})` },
          { status: 400 },
        );
      }
    }

    // (R10) Gate on the action's lifecycle status BEFORE recording an outcome.
    // A blocked / not-yet-approved / cancelled / denied action must never accept
    // an agent-reported "completed" outcome.
    const lifecycle = await getActionStatus(sql, orgId, actionId);
    if (!lifecycle) {
      return NextResponse.json({ error: 'Action not found' }, { status: 404 });
    }
    if (OUTCOME_FORBIDDEN_STATUSES.has(lifecycle.status as string)) {
      return NextResponse.json(
        { error: `Cannot report an outcome for an action in status '${lifecycle.status}'`, current_status: lifecycle.status },
        { status: 409 },
      );
    }

    const dlpFindings: Array<{ severity?: string; category?: string }> = [];
    summary = redactString(summary, dlpFindings);
    errorMessage = redactString(errorMessage, dlpFindings);
    progress = redactProgress(progress, dlpFindings);

    const result = await setActionOutcome(sql, orgId, actionId, {
      status,
      summary,
      error_message: errorMessage,
      progress,
    });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return NextResponse.json({ error: 'Action not found' }, { status: 404 });
      }
      if (result.reason === 'conflict') {
        return NextResponse.json(
          { error: 'outcome already set', current_status: result.current_status },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Emit the same { orgId, action } envelope the PATCH route uses so the SSE
    // serializer (which reads payload.action) sends a populated frame. Without
    // the action key the frame serialized to `data: null` and every terminal
    // outcome update was dropped by live consumers.
    void publishOrgEvent(EVENTS.ACTION_UPDATED, {
      orgId,
      action: { action_id: actionId, ...(result.outcome as unknown as Record<string, unknown>) },
    });

    return NextResponse.json({
      outcome: result.outcome,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter((f) => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map((f) => f.category))],
      },
    });
  } catch (error) {
    return apiErrorResponse(error, 'ACTION_OUTCOME_POST');
  }
}
