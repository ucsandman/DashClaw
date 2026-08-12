/**
 * Enforcement-liveness probe for the OpenClaw seam (roadmap v8.2, per-seam
 * since drizzle/0072).
 *
 * Why this is TypeScript instead of the canonical `hooks/enforcement_liveness_probe.py`.
 * That script probes a seam it can SPAWN: it reads a harness config file, runs
 * the installed hook command as a subprocess, and emulates the harness's
 * contract around it. OpenClaw's seam has none of those parts. Governance here
 * is an in-process `before_tool_call` handler whose return value the gateway
 * obeys directly — there is no config file to read, no command to run, and no
 * exit code to interpret. A subprocess probe cannot reach it at all. So this
 * module reuses the python probe's CONTRACT (same synthetic held action, same
 * witness rule, same three verdicts, same POST payload) while driving the seam
 * the only way it can be driven: by calling it.
 *
 * The witness rule is preserved exactly, and it is the point. The verdict never
 * comes from what the guard DECIDED — the decision ledger is what kept lying in
 * v4.72.1. It comes from whether the held action executed: if the seam does not
 * veto, the probe performs the write the seam should have stopped, and the
 * file's existence is the evidence.
 *
 * Verdicts:
 *   held        the seam vetoed the synthetic action; the witness was never written.
 *   executed    the seam let it through and the witness file exists.
 *   unprovable  the seam ran but enforcement cannot be proven (no policy holds
 *               the probe action, or the probe could not run). Rendered broken
 *               on the surfaces — you cannot claim enforcement you cannot prove.
 */

import { mkdirSync, existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** `smoke-` is the established synthetic marker: these guard rows are excluded
 *  from every aggregate, exactly as the python probe's agent id is. */
export const PROBE_AGENT_ID = 'smoke-liveness-probe';
export const PROBE_RUNTIME = 'openclaw';
const THROTTLE_MS = 12 * 60 * 60 * 1000;

export interface SeamResult {
  block?: boolean;
  blockReason?: string;
}

export interface ProbeCheck {
  id: string;
  title: string;
  status: 'pass' | 'fail';
  detail?: string;
  durationMs?: number;
}

export interface LivenessRun {
  source: string;
  runtime: string;
  verdict: 'held' | 'executed' | 'unprovable';
  detail: string;
  witness: { path: string; executed: boolean };
  checks: ProbeCheck[];
  startedAt: string;
  finishedAt: string;
}

export interface ProbeOptions {
  /** Drives the REAL before_tool_call handler with the synthetic event. */
  driveSeam: (event: {
    toolName: string;
    params: Record<string, unknown>;
    toolCallId: string;
    runId: string;
  }) => Promise<SeamResult | void>;
  dashclawUrl: string;
  dashclawApiKey: string;
  source?: string;
  /** Overridable so tests do not touch the real home directory. */
  witnessRoot?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

function probeRoot(): string {
  return join(homedir(), '.dashclaw', 'liveness-probe');
}

/**
 * Once per 12h, mirroring the python probe's SessionStart throttle. Returns
 * true when this session should probe, and stamps the marker as it does so —
 * a failure to stamp never blocks the run.
 */
export function shouldProbeNow(root: string = probeRoot(), now: number = Date.now()): boolean {
  const marker = join(root, '.last-run-openclaw');
  try {
    if (now - statSync(marker).mtimeMs < THROTTLE_MS) return false;
  } catch {
    // no marker yet: first run in this install
  }
  try {
    mkdirSync(root, { recursive: true });
    writeFileSync(marker, String(now), 'utf8');
  } catch {
    // a throttle we cannot record is still a probe worth running
  }
  return true;
}

/**
 * The synthetic held action: a Write to a probe-owned `.env` path outside the
 * workspace. Identical in shape to the python probe's, so both seams are
 * judged against the same class of action — the path trips sensitive-path and
 * outside-workspace risk boosts and matches protected-path/.env policy rules,
 * while remaining a file the probe owns and may safely create when the seam
 * fails open (broken enforcement is exactly when it WILL be written).
 */
function syntheticEvent(witnessPath: string, runId: string) {
  return {
    toolName: 'Write',
    params: {
      file_path: witnessPath,
      content: `DashClaw enforcement-liveness probe witness ${runId} — if this file exists, an action the policy should have held EXECUTED.`,
    },
    toolCallId: `elp-${runId}`,
    runId: `liveness-probe-${runId}`,
  };
}

export async function runLivenessProbe(options: ProbeOptions): Promise<LivenessRun> {
  const now = options.now ?? Date.now;
  const startedAt = new Date(now()).toISOString();
  const t0 = now();
  // Not crypto: this only has to be unique per run so concurrent probes do not
  // share a witness path.
  const runId = `${now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const witnessDir = join(options.witnessRoot ?? probeRoot(), runId);
  const witnessPath = join(witnessDir, '.env');
  const checks: ProbeCheck[] = [];

  let verdict: LivenessRun['verdict'];
  let detail: string;
  let witnessExecuted = false;

  const seamT0 = now();
  let seam: SeamResult | void = undefined;
  let seamError: string | null = null;
  try {
    seam = await options.driveSeam(syntheticEvent(witnessPath, runId));
  } catch (err) {
    seamError = err instanceof Error ? err.message : String(err);
  }
  const seamMs = now() - seamT0;

  if (seamError) {
    // The handler threw. OpenClaw treats a throwing hook as non-blocking, so
    // the tool would have proceeded — same fail-open reading the python probe
    // applies to a hook that cannot run.
    verdict = 'unprovable';
    detail = `The governance hook threw instead of deciding (${seamError}) — the gateway would have let the action proceed, and enforcement cannot be proven this run.`;
    checks.push({ id: 'seam', title: 'before_tool_call threw', status: 'fail', detail, durationMs: seamMs });
  } else if (seam && seam.block) {
    verdict = 'held';
    detail = seam.blockReason
      ? `Probe action vetoed at the seam: ${seam.blockReason}`
      : 'Probe action vetoed at the seam; the witness was never executed.';
    checks.push({ id: 'seam', title: 'Hook held the synthetic action', status: 'pass', detail, durationMs: seamMs });
  } else {
    // The seam let it through: execute the witness, exactly as the gateway
    // would have. Its existence is the evidence — never the ledger.
    try {
      mkdirSync(witnessDir, { recursive: true });
      writeFileSync(witnessPath, `executed by openclaw liveness probe ${runId} at ${new Date(now()).toISOString()}\n`, 'utf8');
      witnessExecuted = existsSync(witnessPath);
    } catch {
      witnessExecuted = false;
    }
    verdict = 'unprovable';
    detail =
      'No policy held the probe action — the seam ran and allowed it. Add or scope a policy that blocks writes to *.env (protected paths or risk_threshold) so enforcement is provable.';
    checks.push({
      id: 'seam',
      title: 'Hook let the synthetic action proceed',
      status: 'fail',
      detail,
      durationMs: seamMs,
    });
  }

  checks.push({
    id: 'witness',
    title: 'Witness: did the held action execute?',
    status: witnessExecuted ? 'fail' : 'pass',
    detail: `${witnessPath} ${witnessExecuted ? 'EXISTS — the action executed' : 'absent'}`,
  });

  try {
    rmSync(witnessDir, { recursive: true, force: true });
  } catch {
    // best effort — a leftover witness never changes a verdict already decided
  }

  const run: LivenessRun = {
    source: options.source ?? 'session-start',
    runtime: PROBE_RUNTIME,
    verdict,
    detail,
    witness: { path: witnessPath, executed: witnessExecuted },
    checks,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
  };

  await reportRun(run, options);
  void t0;
  return run;
}

async function reportRun(run: LivenessRun, options: ProbeOptions): Promise<void> {
  const base = (options.dashclawUrl || '').replace(/\/+$/, '');
  if (!base || !options.dashclawApiKey) return;
  const doFetch = options.fetchImpl ?? fetch;
  try {
    await doFetch(`${base}/api/enforcement-liveness`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': options.dashclawApiKey },
      body: JSON.stringify(run),
    });
  } catch (err) {
    // A verdict we cannot file is not a reason to break session start. The
    // seam going quiet is itself rendered `stale` by the fleet rollup.
    console.warn(
      `[dashclaw-governance] liveness verdict not reported: ${err instanceof Error ? err.message : 'unknown'}`
    );
  }
}
