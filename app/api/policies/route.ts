export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getOrgId, getOrgRole } from '../../lib/org';
import { validatePolicy } from '../../lib/validate';
import { getSql } from '../../lib/db';
import { apiErrorResponse } from '../../lib/apiErrors';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import { invalidateGuardPolicyCache } from '../../lib/guard';
import { GRANT_DEFAULT_TTL_DAYS } from '../../lib/policy-shapes';
import { deletePoliciesByIds, getActivePolicies } from '../../lib/repositories/guardrails.repository';
import {
  SHORT_LIST_CAP,
  ShortListFullError,
  countShortListLines,
  hasWatchTier,
  isShortListLine,
  noWatchTierMessage,
  parseRules,
  toWatchTier,
  watchPolicyType,
} from '../../lib/guardrails/short-list';

/** 409 body for both write paths — one source for the message and the code. */
function shortListFull() {
  const err = new ShortListFullError();
  return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
}

/** True when this org's Short List has no free slot (excluding `excludeId`). */
async function shortListIsFull(
  sql: ReturnType<typeof getSql>,
  orgId: string,
  excludeId?: string,
): Promise<boolean> {
  const active = await getActivePolicies(sql, orgId);
  const rows = (active as Array<{ id?: string; policy_type: string; rules: unknown; active?: unknown }>)
    .filter((r) => r.id !== excludeId);
  return countShortListLines(rows) >= SHORT_LIST_CAP;
}

type Admission =
  | { ok: true; rules: string; policyType: string }
  | { ok: false; reason: 'full' | 'no_watch_tier'; policyType: string };

/**
 * Short List admission (spec 2.3). A write only keeps its interrupting action
 * when it opts in with `rules.short_list: true` AND a slot is free; everything
 * else is stored in Watch, where it records without stopping the agent.
 *
 * A type with no warn tier cannot be watched at all, so it is refused rather
 * than stored with a demotion flag its evaluator would ignore.
 * @param excludeId the policy being updated, so a PATCH never counts itself.
 */
async function admitToShortList(
  sql: ReturnType<typeof getSql>,
  orgId: string,
  policyType: string,
  rulesText: string,
  excludeId?: string,
): Promise<Admission> {
  const rules = parseRules(rulesText);

  if (rules.short_list !== true) {
    if (!isShortListLine(policyType, rules)) return { ok: true, rules: rulesText, policyType };
    if (!hasWatchTier(policyType)) return { ok: false, reason: 'no_watch_tier', policyType };
    return {
      ok: true,
      rules: JSON.stringify(toWatchTier(rules, policyType)),
      policyType: watchPolicyType(policyType),
    };
  }

  if (await shortListIsFull(sql, orgId, excludeId)) return { ok: false, reason: 'full', policyType };
  return { ok: true, rules: rulesText, policyType };
}

/** Map a refused admission to its response. */
function admissionError(admission: Extract<Admission, { ok: false }>) {
  if (admission.reason === 'full') return shortListFull();
  return NextResponse.json(
    { error: noWatchTierMessage(admission.policyType), code: 'NO_WATCH_TIER' },
    { status: 409 },
  );
}

/**
 * GET /api/policies — List guard policies for the org.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const agentId = (request as Request & { nextUrl: URL }).nextUrl.searchParams.get('agent_id');

    const policies = await sql`
      SELECT * FROM guard_policies
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
    `;

    // If agent_id filter is provided, return only policies that apply to this agent
    if (agentId) {
      const filtered = policies.filter((p: { agent_ids?: string | null }) => {
        if (!p.agent_ids) return true; // null = all agents
        try {
          const scoped = JSON.parse(p.agent_ids);
          if (!Array.isArray(scoped) || scoped.length === 0) return true;
          return scoped.includes(agentId);
        } catch { return true; }
      });
      return NextResponse.json({ policies: filtered });
    }

    return NextResponse.json({ policies });
  } catch (err) {
    return apiErrorResponse(err, 'POLICIES GET');
  }
}

/**
 * POST /api/policies — Create a new guard policy (admin only).
 * Body: { name, policy_type, rules (JSON string), active? }
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { valid, data, errors } = validatePolicy(body);

    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const sql = getSql();
    const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();
    const active = data.active != null ? data.active : 1;

    const agentIds = data.agent_ids || null;

    // Grant TTL stamp (F1): every allow_grant carries an explicit expiry from
    // birth — default GRANT_DEFAULT_TTL_DAYS. The caller may set a shorter or
    // longer rules.expires_at deliberately; absence is never perpetual.
    if (data.policy_type === 'allow_grant') {
      try {
        const rules = JSON.parse(data.rules);
        if (!rules.expires_at) {
          rules.expires_at = new Date(Date.now() + GRANT_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
          data.rules = JSON.stringify(rules);
        }
      } catch (err) {
        // best-effort: validatePolicy already rejected unparseable rules, so
        // this can only fire on a shape it accepted — the grant simply keeps
        // whatever rules text it came with and ages out from created_at.
        console.warn('[POLICIES POST] grant TTL stamp skipped (rules not parseable):', (err as Error).message);
      }
    }

    const admission = await admitToShortList(sql, orgId, data.policy_type, data.rules);
    if (!admission.ok) {
      return admissionError(admission);
    }

    await sql`
      INSERT INTO guard_policies (id, org_id, name, policy_type, rules, active, agent_ids, created_by, created_at, updated_at)
      VALUES (${id}, ${orgId}, ${data.name}, ${admission.policyType}, ${admission.rules}, ${active}, ${agentIds}, ${body.created_by || null}, ${now}, ${now})
    `;

    const rows = await sql`SELECT * FROM guard_policies WHERE id = ${id}`;

    invalidateGuardPolicyCache(orgId);
    void publishOrgEvent(EVENTS.POLICY_UPDATED, { orgId, policy: rows[0], change_type: 'created' });

    return NextResponse.json({ policy: rows[0], policy_id: id }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === '23505' || (err as Error).message?.includes('guard_policies_org_name_unique')) {
      return NextResponse.json({ error: 'A policy with that name already exists' }, { status: 409 });
    }
    return apiErrorResponse(err, 'POLICIES POST');
  }
}

/**
 * PATCH /api/policies — Update a policy (admin only).
 * Body: { id, name?, rules?, active? }
 */
export async function PATCH(request: Request) {
  try {
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: 'Policy id is required' }, { status: 400 });
    }

    const sql = getSql();
    const now = new Date().toISOString();

    // Build dynamic SET clause
    const sets = [];
    const params: unknown[] = [body.id, orgId];
    let idx = 3;

    if (body.name != null) {
      sets.push(`name = $${idx++}`);
      params.push(body.name);
    }
    // The stored row is needed both to validate a rules change against the
    // right type and to cap-check a reactivation, so read it once.
    let existingRow: { policy_type?: string; rules?: unknown } | undefined;
    if (body.rules != null || body.active != null) {
      // SECURITY: Validate rules through the same validation as POST. If the
      // policy does not exist in this org, return 404 *before* the UPDATE
      // so we never accept unvalidated rules into the SQL parameter array.
      const existing = await sql.query(
        'SELECT policy_type, rules FROM guard_policies WHERE id = $1 AND org_id = $2',
        [body.id, orgId]
      );
      if (existing.length === 0) {
        return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
      }
      existingRow = existing[0];
    }

    if (body.rules != null) {
      const storedType = existingRow?.policy_type as string;
      const policyType = body.policy_type || storedType;
      const rulesStr = typeof body.rules === 'string' ? body.rules : JSON.stringify(body.rules);
      const { valid, errors } = validatePolicy({ name: body.name || 'temp', policy_type: policyType, rules: rulesStr });
      if (!valid) {
        return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
      }
      const admission = await admitToShortList(sql, orgId, policyType, rulesStr, body.id);
      if (!admission.ok) {
        return admissionError(admission);
      }
      sets.push(`rules = $${idx++}`);
      params.push(admission.rules);
      // Write the type whenever admission lands somewhere other than the type
      // already stored — this carries the PROMOTE direction too ("Hold instead"
      // on a warn_action_type row must actually become require_approval).
      if (admission.policyType !== storedType) {
        sets.push(`policy_type = $${idx++}`);
        params.push(admission.policyType);
      }
    }
    if (body.active != null) {
      // Reactivating a dormant Short List line consumes a slot exactly like
      // creating one, so it is capped the same way.
      if (body.active && body.rules == null) {
        const storedType = existingRow?.policy_type as string;
        const storedRules = parseRules(existingRow?.rules);
        if (isShortListLine(storedType, storedRules) && await shortListIsFull(sql, orgId, body.id)) {
          return shortListFull();
        }
      }
      sets.push(`active = $${idx++}`);
      params.push(body.active ? 1 : 0);
    }
    if (body.agent_ids !== undefined) {
      sets.push(`agent_ids = $${idx++}`);
      params.push(body.agent_ids != null
        ? (typeof body.agent_ids === 'string' ? body.agent_ids : JSON.stringify(body.agent_ids))
        : null);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    sets.push(`updated_at = $${idx++}`);
    params.push(now);

    const query = `UPDATE guard_policies SET ${sets.join(', ')} WHERE id = $1 AND org_id = $2 RETURNING *`;
    const rows = await sql.query(query, params);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    invalidateGuardPolicyCache(orgId);
    void publishOrgEvent(EVENTS.POLICY_UPDATED, { orgId, policy: rows[0], change_type: 'updated' });

    return NextResponse.json({ policy: rows[0] });
  } catch (err) {
    return apiErrorResponse(err, 'POLICIES PATCH');
  }
}

/**
 * DELETE /api/policies — Delete a policy (admin only).
 * Query: ?id=gp_xxx
 */
export async function DELETE(request: Request) {
  try {
    const orgId = getOrgId(request);
    const role = getOrgRole(request);

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const policyId = (request as Request & { nextUrl: URL }).nextUrl.searchParams.get('id');
    const policyIds = (request as Request & { nextUrl: URL }).nextUrl.searchParams.get('ids');

    if (!policyId && !policyIds) {
      return NextResponse.json({ error: 'Policy id or ids is required' }, { status: 400 });
    }

    const sql = getSql();

    // Bulk delete: ?ids=gp_1,gp_2,gp_3
    if (policyIds) {
      const idList = policyIds.split(',').map(id => id.trim()).filter(Boolean);
      if (idList.length === 0) {
        return NextResponse.json({ error: 'No valid ids provided' }, { status: 400 });
      }
      const rows = await deletePoliciesByIds(sql, orgId, idList);
      invalidateGuardPolicyCache(orgId);
      for (const row of rows) {
        void publishOrgEvent(EVENTS.POLICY_UPDATED, { orgId, policy_id: row.id, change_type: 'deleted' });
      }
      return NextResponse.json({ deleted: rows.length, ids: rows.map((r) => (r as { id: string }).id) });
    }

    // Single delete: ?id=gp_xxx
    const rows = await deletePoliciesByIds(sql, orgId, [policyId as string]);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Policy not found' }, { status: 404 });
    }

    invalidateGuardPolicyCache(orgId);
    void publishOrgEvent(EVENTS.POLICY_UPDATED, { orgId, policy_id: policyId, change_type: 'deleted' });

    return NextResponse.json({ deleted: true, id: policyId });
  } catch (err) {
    return apiErrorResponse(err, 'POLICIES DELETE');
  }
}
