export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { deriveFleetEnforcementLiveness, ENFORCEMENT_LIVENESS_STALE_MS } from '../../lib/enforcement-liveness';
import {
  insertEnforcementLivenessRun,
  listEnforcementLivenessRunsForOrg,
  listLatestEnforcementLivenessRunPerRuntime,
  type EnforcementLivenessCheck,
  type EnforcementLivenessHook,
  type EnforcementLivenessWitness,
} from '../../lib/repositories/enforcement-liveness.repository';

/**
 * v8.2 enforcement liveness (docs/plans/owner-roadmap.md §v8.2).
 *
 * POST — hooks/enforcement_liveness_probe.py files its verdict here after
 * driving a synthetic action through the pretool hook seam on the governing
 * instance. Runs land in enforcement_liveness_runs only — never the
 * action/guard ledgers — so the probe's synthetic traffic is structurally
 * invisible to posture scoring and calibration mining.
 *
 * GET — latest runs for the caller's org (?limit=1..20, default 1), plus the
 * derived liveness state. The human surface is built separately; this
 * endpoint is the machine-readable twin.
 */

const MAX_CHECKS = 50;
const MAX_SHORT = 200;
const MAX_LONG = 1000;
const RUNTIME_VERSION_RE = /^(?:\d+(?:\.\d+){1,3}[0-9A-Za-z._+-]* \(Claude Code\)|codex-cli \d+(?:\.\d+){1,3}[0-9A-Za-z._+-]*|Hermes Agent v\d+(?:\.\d+){1,3}[0-9A-Za-z._+-]*(?: \([0-9.]+\))?)$/;
const HOOK_FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/;

function invalid(field: string, reason: string): NextResponse {
  return NextResponse.json({ error: `invalid ${field}: ${reason}` }, { status: 400 });
}

function isShortString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_SHORT;
}

function isLongString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_LONG;
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return invalid('body', 'expected a JSON object');

    const { source, runtime, verdict, detail, hook, witness, decision, checks, startedAt, finishedAt } =
      body as Record<string, unknown>;

    if (verdict !== 'held' && verdict !== 'executed' && verdict !== 'unprovable') {
      return invalid('verdict', "expected 'held', 'executed', or 'unprovable'");
    }
    if (source !== undefined && !isShortString(source)) {
      return invalid('source', `expected a string of 1..${MAX_SHORT} chars`);
    }
    // Which seam reported (drizzle/0072). Kept OPEN rather than an enum: new
    // runtimes get parity before this route does, and rejecting an unrecognised
    // seam would silently drop its liveness verdict — the one signal we most
    // need from a runtime nobody has wired up yet.
    if (runtime !== undefined && !isShortString(runtime)) {
      return invalid('runtime', `expected a string of 1..${MAX_SHORT} chars`);
    }
    if (!isLongString(detail)) return invalid('detail', `expected a string of 1..${MAX_LONG} chars`);
    if (decision !== undefined && decision !== null && (typeof decision !== 'string' || decision.length > MAX_SHORT)) {
      return invalid('decision', `expected a string of at most ${MAX_SHORT} chars, or null`);
    }
    for (const [field, value] of [['startedAt', startedAt], ['finishedAt', finishedAt]] as const) {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        return invalid(field, 'expected an ISO timestamp');
      }
    }

    if (!hook || typeof hook !== 'object') return invalid('hook', 'expected an object');
    const h = hook as Record<string, unknown>;
    if (typeof h.installed !== 'boolean') return invalid('hook.installed', 'expected a boolean');
    const cleanHook: EnforcementLivenessHook = { installed: h.installed };
    if (h.runtime_version !== undefined) {
      if (h.runtime_version !== 'unavailable' &&
          (typeof h.runtime_version !== 'string' || h.runtime_version.length > 120 || !RUNTIME_VERSION_RE.test(h.runtime_version))) {
        return invalid('hook.runtime_version', "expected a measured runtime version, or 'unavailable'");
      }
      cleanHook.runtime_version = h.runtime_version;
    }
    if (h.hook_fingerprint !== undefined) {
      if (h.hook_fingerprint !== 'unavailable' &&
          (typeof h.hook_fingerprint !== 'string' || !HOOK_FINGERPRINT_RE.test(h.hook_fingerprint))) {
        return invalid('hook.hook_fingerprint', "expected a sha256 digest, or 'unavailable'");
      }
      cleanHook.hook_fingerprint = h.hook_fingerprint;
    }
    if (h.settings_path !== undefined) {
      if (!isLongString(h.settings_path)) return invalid('hook.settings_path', `expected a string of 1..${MAX_LONG} chars`);
      cleanHook.settings_path = h.settings_path;
    }
    if (h.timeout_seconds !== undefined) {
      if (typeof h.timeout_seconds !== 'number' || !Number.isFinite(h.timeout_seconds)) {
        return invalid('hook.timeout_seconds', 'expected a finite number');
      }
      cleanHook.timeout_seconds = h.timeout_seconds;
    }
    if (h.effective_timer_ms !== undefined) {
      if (typeof h.effective_timer_ms !== 'number' || !Number.isFinite(h.effective_timer_ms)) {
        return invalid('hook.effective_timer_ms', 'expected a finite number');
      }
      cleanHook.effective_timer_ms = h.effective_timer_ms;
    }
    if (h.overflowed !== undefined) {
      if (typeof h.overflowed !== 'boolean') return invalid('hook.overflowed', 'expected a boolean');
      cleanHook.overflowed = h.overflowed;
    }
    if (h.mode !== undefined) {
      if (!isShortString(h.mode)) return invalid('hook.mode', `expected a string of 1..${MAX_SHORT} chars`);
      cleanHook.mode = h.mode;
    }
    if (h.exit_code !== undefined) {
      if (h.exit_code !== null && (typeof h.exit_code !== 'number' || !Number.isFinite(h.exit_code))) {
        return invalid('hook.exit_code', 'expected a finite number, or null');
      }
      cleanHook.exit_code = h.exit_code;
    }
    if (h.cancelled !== undefined) {
      if (typeof h.cancelled !== 'boolean') return invalid('hook.cancelled', 'expected a boolean');
      cleanHook.cancelled = h.cancelled;
    }

    if (!witness || typeof witness !== 'object') return invalid('witness', 'expected an object');
    const w = witness as Record<string, unknown>;
    if (!isLongString(w.path)) return invalid('witness.path', `expected a string of 1..${MAX_LONG} chars`);
    if (typeof w.executed !== 'boolean') return invalid('witness.executed', 'expected a boolean');
    const cleanWitness: EnforcementLivenessWitness = { path: w.path, executed: w.executed };

    if (!Array.isArray(checks) || checks.length < 1 || checks.length > MAX_CHECKS) {
      return invalid('checks', `expected an array of 1..${MAX_CHECKS} probe results`);
    }
    const cleanChecks: EnforcementLivenessCheck[] = [];
    for (const c of checks) {
      if (!c || typeof c !== 'object') return invalid('checks', 'each entry must be an object');
      const { id, title, status: cStatus, detail: cDetail, durationMs } = c as Record<string, unknown>;
      if (!isShortString(id)) return invalid('checks[].id', `expected a string of 1..${MAX_SHORT} chars`);
      if (!isShortString(title)) return invalid('checks[].title', `expected a string of 1..${MAX_SHORT} chars`);
      if (cStatus !== 'pass' && cStatus !== 'fail' && cStatus !== 'info') {
        return invalid('checks[].status', "expected 'pass', 'fail', or 'info'");
      }
      if (cDetail !== undefined && (typeof cDetail !== 'string' || cDetail.length > MAX_LONG)) {
        return invalid('checks[].detail', `expected a string of at most ${MAX_LONG} chars`);
      }
      if (durationMs !== undefined && (typeof durationMs !== 'number' || !Number.isFinite(durationMs))) {
        return invalid('checks[].durationMs', 'expected a finite number');
      }
      cleanChecks.push({
        id, title, status: cStatus,
        ...(cDetail !== undefined ? { detail: cDetail } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
    }

    const { id } = await insertEnforcementLivenessRun(sql, orgId, {
      source: (source as string | undefined) ?? 'manual',
      runtime: (runtime as string | undefined) ?? 'unknown',
      verdict,
      detail,
      hook: cleanHook,
      witness: cleanWitness,
      decision: (decision as string | undefined) ?? null,
      checks: cleanChecks,
      startedAt: startedAt as string,
      finishedAt: finishedAt as string,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'ENFORCEMENT LIVENESS POST');
  }
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const raw = new URL(request.url).searchParams.get('limit');
    const parsed = raw === null ? 1 : Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      return invalid('limit', 'expected an integer between 1 and 20');
    }
    const [runs, perSeam] = await Promise.all([
      listEnforcementLivenessRunsForOrg(sql, orgId, parsed),
      listLatestEnforcementLivenessRunPerRuntime(sql, orgId),
    ]);
    // `state` is now the FLEET rollup (worst seam wins), not the newest row.
    // Before drizzle/0072 it was the newest row across all seams, so a dead
    // Codex seam reported healthy behind a fresh Claude Code run. `seams`
    // carries the per-runtime breakdown so a consumer can name the dead one.
    const fleet = deriveFleetEnforcementLiveness(perSeam);
    return NextResponse.json({
      runs,
      stale_after_ms: ENFORCEMENT_LIVENESS_STALE_MS,
      state: fleet.state,
      seams: fleet.seams,
    });
  } catch (error) {
    return apiErrorResponse(error, 'ENFORCEMENT LIVENESS GET');
  }
}
