/**
 * Resolve the `.dashclaw-local/` home directory.
 *
 * Precedence:
 *   1. DASHCLAW_LOCAL_HOME env var (absolute or relative to cwd) — points AT the
 *      .dashclaw-local dir itself. Used by tests for isolation.
 *   2. <cwd>/.dashclaw-local
 *
 * Local-first by design: state lives next to the project the agent works in.
 */
export declare function localHome(): string;
export interface LocalPaths {
    home: string;
    state: string;
    memory: string;
    audit: string;
    config: string;
}
export declare function localPaths(home?: string): LocalPaths;
