export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { readSamples, readDismissals, writeDismissal } from '../../../lib/behavior/sample-store';
import { analyzeSamples } from '../../../lib/behavior/analyzer';
import { simulateBehaviorPolicy } from '../../../lib/behavior/simulate';
import { behaviorRuleToGuardPolicy } from '../../../lib/behavior/policy-model';
import { validatePolicy } from '../../../lib/validate.js';
import { insertPolicy } from '../../../lib/repositories/guardrails.repository';
import { EVENTS, publishOrgEvent } from '../../../lib/events';

const EDITABLE_RULE_KEYS = ['action', 'risk_threshold', 'paths', 'max_reloads', 'window_minutes', 'max_failures', 'min_tier'];

/**
 * GET /api/behavior/suggestions — Analyze LOCAL behavior samples into per-agent
 * envelopes + evidence-backed policy suggestions. Deterministic; honors local
 * dismiss suppression. Optional ?agent_id filter. @beta
 */
export async function GET(request: NextRequest) {
  try {
    const agentId = request.nextUrl.searchParams.get('agent_id');
    const samples = await readSamples({});
    const dismissals = await readDismissals();
    const result = analyzeSamples(samples, { dismissals });
    let { agents, suggestions } = result;
    if (agentId) {
      agents = agents.filter((a: { agent_id?: string }) => a.agent_id === agentId);
      suggestions = suggestions.filter((s: { agent_id?: string }) => s.agent_id === agentId);
    }
    return NextResponse.json({
      agents,
      suggestions,
      dismissed: result.dismissed,
      sample_count: samples.length,
    });
  } catch (err) {
    console.error('[behavior/suggestions] GET error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/behavior/suggestions — Act on a suggestion.
 * Body: { action: 'adopt' | 'dismiss', suggestion_id, ... }
 *   dismiss: { reason?, suppress_similar? } — records a local dismissal.
 *   adopt:   { acknowledged_simulation: true, edited? } — REQUIRES simulation
 *            review. Enforceable suggestions create an INACTIVE guard-policy
 *            draft (active=0, never auto-enforced). Advisory suggestions are
 *            recorded as accepted observations (no policy). @beta
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => ({}));
    const { action, suggestion_id: suggestionId, reason, suppress_similar: suppressSimilar, acknowledged_simulation: acknowledged, edited } = body || {};

    if (!suggestionId) {
      return NextResponse.json({ error: 'suggestion_id is required' }, { status: 400 });
    }

    const samples = await readSamples({});
    const { suggestions } = analyzeSamples(samples, { dismissals: [] });
    const suggestion = (suggestions as Array<Record<string, any>>).find((s) => s.id === suggestionId);
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    if (action === 'dismiss') {
      const record = {
        signature: suggestion.id,
        agent_id: suggestion.agent_id,
        type: suggestion.type,
        target: suggestion.target,
        reason: reason || null,
        status: 'dismissed',
        suppress_similar: !!suppressSimilar,
        ts: new Date().toISOString(),
      };
      await writeDismissal(record);
      return NextResponse.json({ dismissed: true, record });
    }

    if (action === 'adopt') {
      // Build the effective (possibly edited) rule — only whitelisted params.
      const rule = { ...suggestion.rule };
      if (edited && typeof edited === 'object') {
        for (const k of EDITABLE_RULE_KEYS) {
          if (edited[k] !== undefined) rule[k] = edited[k];
        }
      }

      // Simulation-before-adopt gate: the operator must have reviewed a
      // simulation, and there must be samples backing the decision.
      if (acknowledged !== true) {
        return NextResponse.json({ error: 'Simulation review required before adopting. Run a simulation and resend with acknowledged_simulation: true.' }, { status: 400 });
      }
      const scoped = rule.agent_id ? samples.filter((s: { agent_id?: string }) => s.agent_id === rule.agent_id) : samples;
      const simulation = simulateBehaviorPolicy(rule, scoped);
      if (simulation.total === 0) {
        return NextResponse.json({ error: 'No samples to simulate against — capture more agent usage before adopting.' }, { status: 400 });
      }

      // Advisory suggestions never create a guard policy in V1; record the
      // acceptance so it stops re-surfacing.
      if (suggestion.advisory) {
        const record = {
          signature: suggestion.id,
          agent_id: suggestion.agent_id,
          type: suggestion.type,
          target: suggestion.target,
          reason: reason || 'accepted advisory',
          status: 'accepted_advisory',
          suppress_similar: true,
          ts: new Date().toISOString(),
        };
        await writeDismissal(record);
        return NextResponse.json({
          adopted: true,
          advisory: true,
          simulation,
          note: 'Recorded as an accepted observation. Advisory suggestions are observe-only in V1 (the guard engine cannot evaluate sequence- or model-aware rules at a single check).',
        });
      }

      // Enforceable suggestion → create an INACTIVE guard-policy draft.
      const draft = behaviorRuleToGuardPolicy(rule, { agentId: suggestion.agent_id });
      if (!draft) {
        return NextResponse.json({ error: 'Suggestion is not enforceable' }, { status: 400 });
      }
      const rulesJson = JSON.stringify(draft.rules);
      const policyBody = { name: draft.name, policy_type: draft.policy_type, rules: rulesJson, active: 0, agent_ids: draft.agent_ids };
      const validation = validatePolicy(policyBody);
      if (!validation.valid) {
        return NextResponse.json({ error: 'Invalid policy', details: validation.errors }, { status: 400 });
      }

      const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
      const policy = await insertPolicy(sql, orgId, {
        id,
        name: draft.name,
        policyType: draft.policy_type,
        rules: rulesJson,
        agentIds: draft.agent_ids,
        active: 0,
      });

      // Best-effort activity event so the draft shows up on the Policies surface
      // feed; never fail adoption on a publish error.
      try {
        if (EVENTS && EVENTS.POLICY_UPDATED) {
          publishOrgEvent(EVENTS.POLICY_UPDATED, { orgId, change_type: 'created', policy_id: id, source: 'behavior-coach' });
        }
      } catch { /* non-fatal */ }

      return NextResponse.json({
        adopted: true,
        advisory: false,
        policy,
        simulation,
        note: 'Created as an INACTIVE draft (active=0). Enforcement is never enabled automatically — activate it from Policies when ready.',
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use "adopt" or "dismiss".' }, { status: 400 });
  } catch (err) {
    console.error('[behavior/suggestions] POST error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
