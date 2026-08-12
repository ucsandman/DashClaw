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
/** `smoke-` is the established synthetic marker: these guard rows are excluded
 *  from every aggregate, exactly as the python probe's agent id is. */
export declare const PROBE_AGENT_ID = "smoke-liveness-probe";
export declare const PROBE_RUNTIME = "openclaw";
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
    witness: {
        path: string;
        executed: boolean;
    };
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
/**
 * Once per 12h, mirroring the python probe's SessionStart throttle. Returns
 * true when this session should probe, and stamps the marker as it does so —
 * a failure to stamp never blocks the run.
 */
export declare function shouldProbeNow(root?: string, now?: number): boolean;
export declare function runLivenessProbe(options: ProbeOptions): Promise<LivenessRun>;
