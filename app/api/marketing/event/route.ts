/**
 * POST /api/marketing/event
 *
 * Anonymous marketing-funnel telemetry endpoint. Accepts a small set of
 * event names defined by the marketing site refresh and persists them to
 * Redis via app/lib/marketingEvents.js. No PII, no cookies, no third
 * party trackers.
 *
 * Reachability: this route is in middleware.js PUBLIC_ROUTES because the
 * callers are anonymous marketing visitors (no API key, no session). The
 * demo branch in middleware.js also explicitly passes /api/marketing/*
 * requests through to this handler. Rate limiting and the 2 MB body cap
 * remain in force via the standard middleware path.
 *
 * Hardening:
 * - Event names are allowlisted. Anything else returns 400 without
 *   touching Redis.
 * - Properties is a flat object capped at 8 keys and 200 bytes per value.
 *   Anything larger is rejected. This prevents the endpoint becoming a
 *   spam log.
 * - The response is always JSON. Errors return a generic shape so the
 *   client cannot infer whether Redis is configured server-side.
 */

import { NextResponse } from 'next/server';
import { recordMarketingEvent } from '../../../lib/marketingEvents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALLOWED_EVENTS = new Set([
  'marketing_hero_cta_clicked',
  'marketing_hero_plugin_clicked',
  'marketing_github_clicked',
  'marketing_demo_evaluated',
  'marketing_explain_visited',
  'marketing_self_host_visited',
  'marketing_proof_visited',
  'marketing_vs_section_viewed',
]);

const MAX_PROPERTY_KEYS = 8;
const MAX_PROPERTY_VALUE_BYTES = 200;

type ValidatePropertiesResult =
  | { ok: true; value: Record<string, string | number | boolean> }
  | { ok: false; error: string };

function validateProperties(properties: unknown): ValidatePropertiesResult {
  if (properties == null) return { ok: true, value: {} };
  if (typeof properties !== 'object' || Array.isArray(properties)) {
    return { ok: false, error: 'properties must be a flat object' };
  }
  const props = properties as Record<string, unknown>;
  const keys = Object.keys(props);
  if (keys.length > MAX_PROPERTY_KEYS) {
    return { ok: false, error: `properties may not exceed ${MAX_PROPERTY_KEYS} keys` };
  }
  const cleaned: Record<string, string | number | boolean> = {};
  for (const k of keys) {
    const v = props[k];
    if (v == null) continue;
    if (typeof v === 'string') {
      if (Buffer.byteLength(v, 'utf8') > MAX_PROPERTY_VALUE_BYTES) {
        return { ok: false, error: `property "${k}" exceeds size cap` };
      }
      cleaned[k] = v;
      continue;
    }
    if (typeof v === 'number' || typeof v === 'boolean') {
      cleaned[k] = v;
      continue;
    }
    return { ok: false, error: `property "${k}" must be string, number, or boolean` };
  }
  return { ok: true, value: cleaned };
}

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const event = typeof body?.event === 'string' ? body.event : '';
  if (!ALLOWED_EVENTS.has(event)) {
    return NextResponse.json({ error: 'unknown_event' }, { status: 400 });
  }

  const propsResult = validateProperties(body?.properties);
  if (!propsResult.ok) {
    return NextResponse.json({ error: propsResult.error }, { status: 400 });
  }

  // Middleware sets x-client-ip when it trusts the proxy chain. Falling
  // back to null is fine; we are not building a per-IP profile, just
  // attaching the value the rest of the stack already trusts.
  const ip = request.headers.get('x-client-ip') || null;

  await recordMarketingEvent({
    event,
    properties: propsResult.value,
    ip,
  });

  // Always return 202 regardless of whether Redis persisted. The client
  // cannot distinguish "Redis not configured" from "event accepted"
  // without server-side knowledge, which keeps the endpoint cheap to
  // poll without leaking deployment state.
  return NextResponse.json({ ok: true }, { status: 202 });
}
