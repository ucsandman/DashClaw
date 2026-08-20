export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getOrgId, getOrgRole } from '../../../../lib/org';
import { getSql } from '../../../../lib/db';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { insertOrRevivePolicy } from '../../../../lib/repositories/guardrails.repository';
import { getSettings, upsertSetting } from '../../../../lib/repositories/settings.repository';
import { shapeKey, shapeIsGrantable, GRANT_DEFAULT_TTL_DAYS, GRANT_DEFAULT_MAX_RISK } from '../../../../lib/policy-shapes';
import { getWarnDecisionsSince, groupWarnDecisions } from '../../../../lib/repositories/policy-review.repository';
import { ingestApprovalAdjudication } from '../../../../lib/guard/calibration-feedback';

const VERDICTS = ['fine', 'always_allow', 'tighten', 'mark_all_reviewed', 'retro_fine', 'retro_stop'] as const;
type Verdict = (typeof VERDICTS)[number];

/** Same default window the review feed itself uses when no cursor is set. */
const DEFAULT_WINDOW_DAYS = 7;

const gpId = () => `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

type SqlTag = ReturnType<typeof getSql>;

/** The org's review-dismissal map (best-effort: corrupt JSON starts fresh). */
async function loadDismissed(sql: SqlTag, orgId: string): Promise<Record<string, string>> {
  const rows = await getSettings(sql, orgId, { key: 'policy_review_dismissed' });
  try {
    return JSON.parse((rows[0]?.value as string | null | undefined) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Dismiss one shape from the review feed — the shared half of every verdict. */
async function dismissShape(
  sql: SqlTag,
  orgId: string,
  dismissed: Record<string, string>,
  key: string,
  now: string,
): Promise<void> {
  dismissed[key] = now;
  await upsertSetting(sql, orgId, {
    key: 'policy_review_dismissed',
    value: JSON.stringify(dismissed),
  });
}

/**
 * POST /api/policies/review/verdict — act on a review-feed group (admin only).
 * Body: { verdict, shape?: { action_type, target_prefix? } }
 *  - fine:              dismiss the shape (review state only)
 *  - retro_fine:        dismiss the shape AND feed the calibration controller
 *                       one retrospective benign verdict for the group
 *  - retro_stop:        same, labeled dangerous — pulls the relief ceiling
 *                       back below the group's worst score
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
      await dismissShape(sql, orgId, await loadDismissed(sql, orgId), key, now);
      return NextResponse.json({ ok: true, dismissed: key });
    }

    // Retrospective verdicts (spec §2.5). The operator rules on a whole warn
    // GROUP after the fact, so the group is re-derived server-side from the
    // live feed rather than trusted from the client: the risk score the
    // controller learns from must come from the decisions themselves.
    if (verdict === 'retro_fine' || verdict === 'retro_stop') {
      const [cursorRows, dismissed] = await Promise.all([
        getSettings(sql, orgId, { key: 'policy_review_cursor' }),
        loadDismissed(sql, orgId),
      ]);
      const cursor =
        (cursorRows[0]?.value as string | null | undefined) ||
        new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000).toISOString();
      const warnRows = await getWarnDecisionsSince(sql, orgId, cursor);
      const group = groupWarnDecisions(warnRows, dismissed).find((g) => g.shape.key === key);
      if (!group) {
        return NextResponse.json({
          error: `"${label}" is no longer in the review feed — nothing to rule on.`,
          code: 'SHAPE_NOT_IN_FEED',
        }, { status: 404 });
      }

      // One adjudication per group verdict, at the group's WORST score, with
      // no owning agent — nobody was blocked on this, so no agent's e-process
      // moves. Ingest is best-effort by contract; the dismissal stands either
      // way so a controller outage cannot strand the item in the feed.
      const outcome = await ingestApprovalAdjudication(sql, orgId, {
        actionId: group.sample_id,
        agentId: null,
        riskScore: group.max_risk,
        approved: verdict === 'retro_fine',
        source: 'warn_review',
      });
      await dismissShape(sql, orgId, dismissed, key, now);
      return NextResponse.json({
        ok: true,
        dismissed: key,
        adjudicated: outcome != null,
        labeled_total: outcome?.state.labeledTotal ?? null,
        labeled_live: outcome?.state.labeledLive ?? null,
      });
    }

    if (verdict === 'always_allow') {
      // F1 (governance gap audit 2026-08-05): this exact spread — prefix only
      // when present — is where the audited instance's 19 unscoped blanket
      // grants came from, and an unscoped grant silently nullifies every
      // require_approval policy for its action_type. A grant must name WHAT
      // it covers; a target-less shape can't be always-allowed. The predicate is
      // shared with the /policies inbox so the surface never offers a verb this
      // rejects (field report 2026-08-11: three warn rows red at once).
      if (!shapeIsGrantable(prefix)) {
        return NextResponse.json({
          error: `"${label}" has no target scope — an unscoped grant would blanket-allow every "${shape.action_type}" action and silently disable any approval rule covering it. Review the individual actions, or write a scoped grant (action_type + target_prefix) from /policies.`,
          code: 'UNSCOPED_GRANT_REJECTED',
        }, { status: 400 });
      }
      const policy = await insertOrRevivePolicy(sql, orgId, {
        id: gpId(),
        name: `[Grant] ${label}`,
        policyType: 'allow_grant',
        rules: JSON.stringify({
          action_type: shape.action_type,
          target_prefix: prefix,
          // TTL from birth (F1): grants are leases, not permanent law.
          expires_at: new Date(Date.now() + GRANT_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          // Risk ceiling from birth: both grant-minting surfaces stamp it, so
          // enforcement never has to fall back to a default for a new grant.
          // Without it this verdict would authorize the shape at ANY score.
          max_risk: GRANT_DEFAULT_MAX_RISK,
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
    const policy = await insertOrRevivePolicy(sql, orgId, {
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
