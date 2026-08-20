// app/policies/lib/misfireClient.ts
// The misfire escape hatch, operator side.
//
// A misfire is reported by GET /api/policies/loosening (`misfires`), so there
// is no fetch here — the inbox already reads that payload. What this module
// owns is the only two things a human can do about one:
//
//   "Stop asking about X"  → rules.shape_exceptions gains the shape key (A3).
//                            The line keeps enforcing everything else, and
//                            because it is a click it works on `ungrantable`
//                            lines that automatic relief must never touch.
//   "Keep asking"          → a 24h mute, held in this browser. Nothing is
//                            written to the policy: the operator said the
//                            interruption was RIGHT, and a report that is
//                            right must come back when it happens again.

export type { Misfire } from '../../lib/posture/loosening';

interface PolicyRow {
  id?: unknown;
  rules?: unknown;
}

function parseRules(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* fall through — an unreadable rules blob is not a reason to widen it */
    }
  }
  return {};
}

/** The stored rules for one policy. The list route has no id filter, so read
 *  the org's policies and pick the row — the alternative is a new route. */
async function currentRulesOf(policyId: string): Promise<Record<string, unknown>> {
  const res = await fetch('/api/policies');
  if (!res.ok) throw new Error(`Couldn't read the rule (${res.status})`);
  const body = await res.json().catch(() => ({}));
  const rows: PolicyRow[] = Array.isArray(body?.policies) ? body.policies : [];
  const row = rows.find((p) => p.id === policyId);
  if (!row) throw new Error('That rule no longer exists.');
  return parseRules(row.rules);
}

async function patchExceptions(
  policyId: string,
  next: string[],
  rules: Record<string, unknown>,
): Promise<void> {
  const res = await fetch('/api/policies', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: policyId, rules: { ...rules, shape_exceptions: next } }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Couldn't save the exception (${res.status})`);
  }
}

function existing(rules: Record<string, unknown>): string[] {
  const raw = rules.shape_exceptions;
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
}

/** Carve this one command shape out of this one line. Idempotent. */
export async function addShapeException(
  policyId: string,
  shapeKey: string,
  currentRules?: Record<string, unknown>,
): Promise<void> {
  const rules = currentRules ?? (await currentRulesOf(policyId));
  const list = existing(rules);
  if (list.includes(shapeKey)) return;
  await patchExceptions(policyId, [...list, shapeKey], rules);
}

/** Undo the carve-out — the Short List details view's Undo. */
export async function removeShapeException(
  policyId: string,
  shapeKey: string,
  currentRules?: Record<string, unknown>,
): Promise<void> {
  const rules = currentRules ?? (await currentRulesOf(policyId));
  const list = existing(rules);
  if (!list.includes(shapeKey)) return;
  await patchExceptions(policyId, list.filter((s) => s !== shapeKey), rules);
}

// ---------------------------------------------------------------------------
// "Keep asking" — a per-browser 24h mute. Deliberately not a server record:
// nothing about enforcement changed, so nothing about the org should change.
// ---------------------------------------------------------------------------

const MUTE_PREFIX = 'dashclaw.misfire.mute:';
const MUTE_MS = 24 * 60 * 60 * 1000;

function muteKey(policyId: string, shapeKey: string): string {
  return `${MUTE_PREFIX}${policyId}\n${shapeKey}`;
}

/** Storage is unavailable in private modes and previews — never throw over it. */
function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function muteMisfire(policyId: string, shapeKey: string, now = Date.now()): void {
  try {
    store()?.setItem(muteKey(policyId, shapeKey), String(now + MUTE_MS));
  } catch {
    /* a mute that cannot be saved just means the row returns — acceptable */
  }
}

export function unmuteMisfire(policyId: string, shapeKey: string): void {
  try {
    store()?.removeItem(muteKey(policyId, shapeKey));
  } catch {
    /* no-op */
  }
}

export function isMisfireMuted(policyId: string, shapeKey: string, now = Date.now()): boolean {
  try {
    const until = store()?.getItem(muteKey(policyId, shapeKey));
    if (!until) return false;
    const ms = Number(until);
    if (!Number.isFinite(ms) || ms <= now) {
      unmuteMisfire(policyId, shapeKey);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
