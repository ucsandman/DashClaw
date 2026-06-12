export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getOrgId, getOrgRole } from '../../../../lib/org';
import { getSql } from '../../../../lib/db';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { insertPolicy } from '../../../../lib/repositories/guardrails.repository';
import { getSettings, upsertSetting } from '../../../../lib/repositories/settings.repository';
import { shapeKey } from '../../../../lib/policy-shapes';

const VERDICTS = ['fine', 'always_allow', 'tighten', 'mark_all_reviewed'] as const;
type Verdict = (typeof VERDICTS)[number];

const gpId = () => `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

/**
 * POST /api/policies/review/verdict — act on a review-feed group (admin only).
 * Body: { verdict, shape?: { action_type, target_prefix? } }
 *  - fine:              dismiss the shape (review state only)
 *  - always_allow:      create an allow_grant for the shape
 *  - tighten:           create require_approval (host/type shapes) or protected_path (path shapes)
 *  - mark_all_reviewed: advance the org review cursor to now
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({})) as {
      verdict?: string;
      shape?: { action_type?: string; target_prefix?: string | null };
    };
    const verdict = body.verdict as Verdict;
    if (!VERDICTS.includes(verdict)) {
      return NextResponse.json(
        { error: `verdict must be one of: ${VERDICTS.join(', ')}` },
        { status: 400 },
      );
    }

    const sql = getSql();
    const now = new Date().toISOString();

    if (verdict === 'mark_all_reviewed') {
      await upsertSetting(sql, orgId, { key: 'policy_review_cursor', value: now });
      return NextResponse.json({ ok: true, cursor: now });
    }

    const shape = body.shape;
    if (!shape || typeof shape.action_type !== 'string' || !shape.action_type) {
      return NextResponse.json({ error: 'shape.action_type is required' }, { status: 400 });
    }
    // Length parity with the canonical validators in validate.js (action_type ≤128,
    // target_prefix ≤256) — this route inserts policies directly, bypassing
    // validatePolicy, and oversized rules would bloat the guard hot-path.
    if (shape.action_type.length > 128) {
      return NextResponse.json({ error: 'shape.action_type must be 128 characters or fewer' }, { status: 400 });
    }
    if (typeof shape.target_prefix === 'string' && shape.target_prefix.length > 256) {
      return NextResponse.json({ error: 'shape.target_prefix must be 256 characters or fewer' }, { status: 400 });
    }

    const prefix =
      typeof shape.target_prefix === 'string' && shape.target_prefix
        ? shape.target_prefix
        : null;
    const key = shapeKey(shape.action_type, prefix);
    const label = prefix ? `${shape.action_type} → ${prefix}` : shape.action_type;

    if (verdict === 'fine') {
      // Fetch existing dismissed map, parse (reset on corrupt), set dismissed[key] = now
      const dismissedRows = await getSettings(sql, orgId, { key: 'policy_review_dismissed' });
      let dismissed: Record<string, string> = {};
      try {
        const raw = dismissedRows[0]?.value as string | null | undefined;
        dismissed = JSON.parse(raw || '{}') as Record<string, string>;
      } catch {
        // Corrupt — start fresh
      }
      dismissed[key] = now;
      await upsertSetting(sql, orgId, {
        key: 'policy_review_dismissed',
        value: JSON.stringify(dismissed),
      });
      return NextResponse.json({ ok: true, dismissed: key });
    }

    if (verdict === 'always_allow') {
      const policy = await insertPolicy(sql, orgId, {
        id: gpId(),
        name: `[Grant] ${label}`,
        policyType: 'allow_grant',
        rules: JSON.stringify({
          action_type: shape.action_type,
          ...(prefix ? { target_prefix: prefix } : {}),
          _grant: true,
        }),
      });
      return NextResponse.json({ ok: true, policy }, { status: 201 });
    }

    // tighten: path shapes (prefix contains '/') become protected_path;
    // host/type shapes become require_approval, narrowed to the shape's
    // target_prefix when one exists (dropping it would gate the whole
    // action_type org-wide — that mistake once routed every routine swarm
    // action into approval).
    const isPath = !!prefix && prefix.includes('/');
    const policy = await insertPolicy(sql, orgId, {
      id: gpId(),
      name: `[Tightened] ${label}`,
      policyType: isPath ? 'protected_path' : 'require_approval',
      rules: isPath
        ? JSON.stringify({ paths: [`${prefix}**`], action: 'require_approval', _tightened: true })
        : JSON.stringify({
            action_types: [shape.action_type],
            ...(prefix ? { target_prefix: prefix } : {}),
            _tightened: true,
          }),
    });
    return NextResponse.json({ ok: true, policy }, { status: 201 });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505' || e.message?.includes('guard_policies_org_name_unique')) {
      return NextResponse.json({ error: 'A rule for this shape already exists' }, { status: 409 });
    }
    return apiErrorResponse(err, 'POLICY_REVIEW_VERDICT POST');
  }
}
