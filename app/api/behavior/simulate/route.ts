export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { readSamples } from '../../../lib/behavior/sample-store';
import { analyzeSamples } from '../../../lib/behavior/analyzer';
import { simulateBehaviorPolicy } from '../../../lib/behavior/simulate';

/**
 * POST /api/behavior/simulate — Replay a behavior suggestion (or an edited
 * rule) against the recorded LOCAL samples and return the decision counts
 * (allow / warn / require_approval / block) plus likely false positives. This
 * backs the mandatory simulation-before-adopt review. @beta
 *
 * Body: { suggestion_id?: string, rule?: object }
 * Provide suggestion_id to simulate a current suggestion, or rule to preview an
 * edited rule. At least one is required.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { suggestion_id: suggestionId } = body || {};
    let rule = body && body.rule;

    const samples = await readSamples({});

    if (!rule) {
      if (!suggestionId) {
        return NextResponse.json({ error: 'suggestion_id or rule is required' }, { status: 400 });
      }
      const { suggestions } = analyzeSamples(samples, { dismissals: [] });
      const match = (suggestions as Array<Record<string, any>>).find((s) => s.id === suggestionId);
      if (!match) {
        return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
      }
      rule = match.rule;
    }

    if (!rule || !rule.kind) {
      return NextResponse.json({ error: 'rule.kind is required' }, { status: 400 });
    }

    // Scope simulation to the rule's agent when set, so an agent-specific
    // suggestion is measured against that agent's behavior.
    const scoped = rule.agent_id ? samples.filter((s: { agent_id?: string }) => s.agent_id === rule.agent_id) : samples;
    const result = simulateBehaviorPolicy(rule, scoped);

    return NextResponse.json({ suggestion_id: suggestionId || null, rule, simulation: result });
  } catch (err) {
    console.error('[behavior/simulate] POST error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
