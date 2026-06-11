import { resolve } from "node:path";

/**
 * Resolve the `.offlocal/` home directory.
 *
 * Precedence:
 *   1. OFFLOCAL_HOME env var (absolute or relative to cwd) — points AT the
 *      .offlocal dir itself. Used by tests for isolation.
 *   2. <cwd>/.offlocal
 *
 * Local-first by design: state lives next to the project the agent works in.
 */
export function offlocalHome(): string {
  const override = process.env.OFFLOCAL_HOME;
  if (override && override.trim().length > 0) {
    return resolve(override);
  }
  return resolve(process.cwd(), ".offlocal");
}

export interface OfflocalPaths {
  home: string;
  state: string;
  memory: string;
  audit: string;
  config: string;
}

export function offlocalPaths(home = offlocalHome()): OfflocalPaths {
  return {
    home,
    state: resolve(home, "state.json"),
    memory: resolve(home, "memory.json"),
    audit: resolve(home, "audit.log"),
    config: resolve(home, "config.yaml"),
  };
}
