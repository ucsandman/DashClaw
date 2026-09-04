#!/usr/bin/env node

/**
 * Runner for the Python SDK live validation suite.
 * Finds a Python 3 interpreter (cross-platform), sets PYTHONPATH,
 * and runs scripts/test-sdk-live-python.py.
 *
 * Env vars DASHCLAW_URL, DASHCLAW_API_KEY, and DASHCLAW_AGENT_ID
 * are passed through from the current environment.
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCandidates } from './lib/python-candidates.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const scriptPath = path.join('scripts', 'test-sdk-live-python.py');

function tryRun(cmd, args) {
  const pythonPathEntries = [path.join(process.cwd(), 'sdk-python')];
  if (process.env.PYTHONPATH) {
    pythonPathEntries.push(process.env.PYTHONPATH);
  }

  const result = spawnSync(cmd, [...args, scriptPath], {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      PYTHONPATH: pythonPathEntries.join(path.delimiter),
    },
  });

  if (typeof result.status === 'number') {
    return result.status;
  }
  return null;
}

function main() {
  const candidates = getCandidates();

  for (const candidate of candidates) {
    const status = tryRun(candidate.cmd, candidate.args);
    if (typeof status === 'number') {
      process.exit(status);
    }
  }

  console.error('Unable to find a Python 3 interpreter.');
  console.error('Set PYTHON to a valid interpreter path and retry.');
  process.exit(1);
}

main();
