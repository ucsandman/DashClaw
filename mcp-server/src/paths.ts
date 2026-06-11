import { resolve } from "node:path";

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
export function localHome(): string {
  const override = process.env.DASHCLAW_LOCAL_HOME;
  if (override && override.trim().length > 0) {
    return resolve(override);
  }
  return resolve(process.cwd(), ".dashclaw-local");
}

export interface LocalPaths {
  home: string;
  state: string;
  memory: string;
  audit: string;
  config: string;
}

export function localPaths(home = localHome()): LocalPaths {
  return {
    home,
    state: resolve(home, "state.json"),
    memory: resolve(home, "memory.json"),
    audit: resolve(home, "audit.log"),
    config: resolve(home, "config.yaml"),
  };
}
