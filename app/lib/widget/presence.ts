/**
 * Desktop Presence reader for the Pulse widget (server-side only — fs access).
 *
 * Ports `_compute_status` from the presence CLI
 * (clawd/tools/desktop-presence/desktop_presence_cli.py). The store is
 * machine-local; on hosted deployments the directory simply does not exist and
 * the verdict is `unknown`. Rule P1 (docs/decisions/2026-08-09-widget-pulse.md §7):
 * absence of a verdict is NEVER rendered as live, and unreadable state is
 * `unknown`, never a guess.
 *
 * Output is whitelisted to { verdict, frameAgeSeconds } — the raw state file
 * carries machine paths (openClawExportPath etc.) that must not reach clients.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { PresenceVerdict } from './pulse';

const FRESH_FLOOR_SECONDS = 15;

export interface PresenceStatus {
  verdict: PresenceVerdict;
  frameAgeSeconds: number | null;
}

function storeDir(): string {
  // Same env var the presence CLI honors.
  return process.env.OPENCLAW_DESKTOP_PRESENCE_DIR || path.join(os.homedir(), '.openclaw', 'desktop-presence');
}

function fileAgeSeconds(filePath: string, nowMs: number): number | null {
  try {
    const st = fs.statSync(filePath);
    return Math.max(0, Math.round((nowMs - st.mtimeMs) / 1000));
  } catch {
    return null;
  }
}

function pidAlive(pid: unknown): boolean | null {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return null;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is not ours — alive.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

export function readDesktopPresence(nowMs: number = Date.now()): PresenceStatus {
  const dir = storeDir();
  const statePath = path.join(dir, 'state.json');
  const frameAgeSeconds = fileAgeSeconds(path.join(dir, 'latest.jpg'), nowMs);

  let dirExists = false;
  try {
    dirExists = fs.existsSync(dir);
  } catch {
    dirExists = false;
  }
  if (!dirExists) return { verdict: 'unknown', frameAgeSeconds: null };

  if (!fs.existsSync(statePath)) return { verdict: 'never-started', frameAgeSeconds };

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (!state || typeof state !== 'object') throw new Error('not an object');
  } catch {
    // Unreadable/corrupt store: unknown, never a fake verdict.
    return { verdict: 'unknown', frameAgeSeconds };
  }

  if (!state.active) return { verdict: 'inactive', frameAgeSeconds };

  const alive = pidAlive(state.pid);
  if (alive === false) return { verdict: 'stale', frameAgeSeconds };

  const intervalS = Number(state.frameIntervalMs || 3000) / 1000;
  const threshold = Math.max(3 * intervalS, FRESH_FLOOR_SECONDS);
  const lastUpdated = state.lastUpdated ? new Date(String(state.lastUpdated)).getTime() : NaN;
  const stateAgeS = Number.isFinite(lastUpdated) ? (nowMs - lastUpdated) / 1000 : null;
  if (stateAgeS == null || stateAgeS > threshold) return { verdict: 'stale', frameAgeSeconds };

  return { verdict: 'live', frameAgeSeconds };
}
