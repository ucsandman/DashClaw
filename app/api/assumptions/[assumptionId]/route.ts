export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { redactAny } from '../../../lib/security';
import { getAssumption, updateAssumption } from '../../../lib/repositories/assumptions.repository';
import { notifyAssumptionInvalidated } from '../../../lib/assumption-notify';


export async function GET(request: Request, { params }: { params: Promise<{ assumptionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { assumptionId } = await params;

    const assumption = await getAssumption(sql, orgId, assumptionId);

    if (!assumption) {
      return NextResponse.json({ error: 'Assumption not found' }, { status: 404 });
    }

    return NextResponse.json({ assumption });
  } catch (error) {
    console.error('Assumption detail GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching the assumption' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ assumptionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { assumptionId } = await params;
    const body = await request.json();

    const { validated, invalidated_reason } = body;

    if (validated !== true && validated !== false) {
      return NextResponse.json(
        { error: 'validated is required and must be a boolean' },
        { status: 400 }
      );
    }

    // Invalidating requires a reason
    if (validated === false && (!invalidated_reason || typeof invalidated_reason !== 'string' || invalidated_reason.trim().length === 0)) {
      return NextResponse.json(
        { error: 'invalidated_reason is required when invalidating an assumption' },
        { status: 400 }
      );
    }

    if (invalidated_reason && invalidated_reason.length > 2000) {
      return NextResponse.json(
        { error: 'invalidated_reason exceeds max length of 2000' },
        { status: 400 }
      );
    }

    const existing = await getAssumption(sql, orgId, assumptionId);
    if (!existing) {
      return NextResponse.json({ error: 'Assumption not found' }, { status: 404 });
    }

    if (existing.invalidated === 1) {
      return NextResponse.json({ error: 'Assumption is already invalidated' }, { status: 409 });
    }

    const now = new Date().toISOString();

    if (validated === true) {
      // Validate the assumption
      const result = await updateAssumption(sql, orgId, assumptionId, {
        validated: true,
        validated_at: now
      });
      return NextResponse.json({ assumption: result });
    } else {
      // Invalidate the assumption
      // SECURITY: redact likely secrets before storing invalidation reason.
      const dlpFindings: Array<{ severity?: string; category?: string }> = [];
      const safeReason = redactAny(invalidated_reason.trim(), dlpFindings);
      const result = await updateAssumption(
        sql,
        orgId,
        assumptionId,
        {
          invalidated: true,
          invalidated_reason: safeReason as string,
          invalidated_at: now,
        },
        { gateInvalidated: true },
      );
      if (!result) {
        // Compare-and-set failed — another concurrent PATCH won the race
        // and invalidated this assumption first. Surface 409 rather than
        // silently clobbering the first writer's reason.
        return NextResponse.json(
          { error: 'Assumption is already invalidated' },
          { status: 409 },
        );
      }
      // Advocate v2a: tell the owning agent its assumption was invalidated.
      // The notification is best-effort — the invalidation is already committed.
      let notification: { message_id: string } | null = null;
      let notificationError: string | null = null;
      try {
        notification = await notifyAssumptionInvalidated(sql, orgId, {
          agent_id: (existing.agent_id as string) ?? null,
          assumption_id: String(existing.assumption_id ?? assumptionId),
          assumption: String(existing.assumption ?? ''),
          invalidated_reason: safeReason as string,
          invalidated_at: now,
          action_id: (existing.action_id as string) ?? null,
        });
      } catch (err) {
        console.error('Assumption invalidation notify failed:', err);
        notificationError = 'notification_failed';
      }
      return NextResponse.json({
        assumption: result,
        security: {
          clean: dlpFindings.length === 0,
          findings_count: dlpFindings.length,
          critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
          categories: [...new Set(dlpFindings.map(f => f.category))],
        },
        ...(notification ? { notification } : {}),
        ...(notificationError ? { notification_error: notificationError } : {}),
      });
    }
  } catch (error) {
    console.error('Assumption detail PATCH error:', error);
    return NextResponse.json({ error: 'An error occurred while updating the assumption' }, { status: 500 });
  }
}
