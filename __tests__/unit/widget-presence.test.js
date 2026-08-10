// Desktop Presence reader — the never-fake-live rule against a real temp store.
// Spec: docs/decisions/2026-08-09-widget-pulse.md §7.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readDesktopPresence } from '../../app/lib/widget/presence';

let dir;
const NOW = Date.now();

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-presence-'));
  process.env.OPENCLAW_DESKTOP_PRESENCE_DIR = dir;
});

afterEach(() => {
  delete process.env.OPENCLAW_DESKTOP_PRESENCE_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeState(state) {
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
}

describe('readDesktopPresence', () => {
  it('missing store directory is unknown — never live', () => {
    process.env.OPENCLAW_DESKTOP_PRESENCE_DIR = path.join(dir, 'does-not-exist');
    expect(readDesktopPresence(NOW).verdict).toBe('unknown');
  });

  it('directory without state.json is never-started', () => {
    expect(readDesktopPresence(NOW).verdict).toBe('never-started');
  });

  it('corrupt state.json is unknown, not a guess', () => {
    fs.writeFileSync(path.join(dir, 'state.json'), '{not json');
    expect(readDesktopPresence(NOW).verdict).toBe('unknown');
  });

  it('active=false is inactive', () => {
    writeState({ active: false });
    expect(readDesktopPresence(NOW).verdict).toBe('inactive');
  });

  it('active with a fresh lastUpdated and a live pid is live', () => {
    writeState({
      active: true,
      pid: process.pid, // this test process — definitely alive
      frameIntervalMs: 3000,
      lastUpdated: new Date(NOW - 5_000).toISOString(),
    });
    expect(readDesktopPresence(NOW).verdict).toBe('live');
  });

  it('active but lastUpdated past the freshness threshold is stale', () => {
    writeState({
      active: true,
      pid: process.pid,
      frameIntervalMs: 3000,
      lastUpdated: new Date(NOW - 60_000).toISOString(), // > max(3*3s, 15s)
    });
    expect(readDesktopPresence(NOW).verdict).toBe('stale');
  });

  it('active with a dead pid is stale (crashed daemon leaves active=true behind)', () => {
    writeState({
      active: true,
      pid: 999999999, // ESRCH territory
      frameIntervalMs: 3000,
      lastUpdated: new Date(NOW - 1_000).toISOString(),
    });
    expect(readDesktopPresence(NOW).verdict).toBe('stale');
  });

  it('reports frame age from latest.jpg and whitelists the output shape', () => {
    writeState({
      active: true,
      pid: process.pid,
      frameIntervalMs: 3000,
      lastUpdated: new Date(NOW - 2_000).toISOString(),
      openClawExportPath: 'C:/secret/machine/path/frame.jpg',
    });
    fs.writeFileSync(path.join(dir, 'latest.jpg'), 'x');
    const status = readDesktopPresence(NOW);
    expect(status.verdict).toBe('live');
    expect(typeof status.frameAgeSeconds).toBe('number');
    // Whitelist: nothing from the raw state file (machine paths) leaks.
    expect(Object.keys(status).sort()).toEqual(['frameAgeSeconds', 'verdict']);
  });
});
