// cli/lib/up/instance.js
//
// Checkpointed instance state for `dashclaw up`.
//
// ~/.dashclaw/instance.json is the resume contract: a fresh run executes steps
// in STEPS order, checkpointing each; a re-run skips completed steps; corrupt
// or missing state means a fresh install.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Canonical step order — the orchestrator re-runs from the first step NOT in `completed`. */
export const STEPS = ['app_fetched', 'deps_installed', 'db_ready', 'setup_done', 'built', 'connected'];

const fileFor = (dir) => join(dir, 'instance.json');

/** Returns the parsed instance object, or null if missing or corrupt. */
export function loadInstance(dir) {
  try {
    const raw = readFileSync(fileFor(dir), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null; // missing or corrupt — caller treats as fresh install
  }
}

/** Merges `data` into the existing instance (or creates it) and writes to disk. */
export function saveInstance(dir, data) {
  mkdirSync(dir, { recursive: true });
  const current = loadInstance(dir) ?? { completed: [] };
  const next = { ...current, ...data, completed: data.completed ?? current.completed ?? [] };
  // mode 0o600: instance.json stores apiKey + possibly a postgresql:// URL with
  // credentials. No-op on Windows; protects Linux/macOS (matches config.json).
  writeFileSync(fileFor(dir), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return next;
}

/** Appends `step` to `completed` (idempotent) and writes to disk. */
export function checkpoint(dir, step) {
  mkdirSync(dir, { recursive: true });
  const inst = loadInstance(dir) ?? { completed: [] };
  if (!inst.completed.includes(step)) inst.completed.push(step);
  writeFileSync(fileFor(dir), JSON.stringify(inst, null, 2) + '\n', { mode: 0o600 });
  return inst;
}
