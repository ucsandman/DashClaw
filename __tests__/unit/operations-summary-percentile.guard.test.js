import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Regression guard: the operations-summary "Latency p50/p95" card must compute
// TRUE percentiles via PERCENTILE_CONT WITHIN GROUP. A prior bug returned AVG as
// "p50" and MAX as "p95", so the UI's "Latency p95" was actually the single
// slowest outlier. This source-level guard fails loudly if anyone reverts the
// percentile query to AVG/MAX, since that mislabel is silent at runtime (the
// query still returns numbers) and no behavioral test would catch it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = path.resolve(__dirname, '../../app/api/operations/summary/route.ts');

describe('operations/summary latency percentile guard', () => {
  const src = readFileSync(ROUTE, 'utf8');

  it('uses PERCENTILE_CONT for the latency percentiles', () => {
    expect(src).toMatch(/PERCENTILE_CONT\s*\(\s*0\.5\s*\)\s*WITHIN GROUP/i);
    expect(src).toMatch(/PERCENTILE_CONT\s*\(\s*0\.95\s*\)\s*WITHIN GROUP/i);
  });

  it('does not mislabel AVG/MAX as latency percentiles', () => {
    // Guard against the specific regression: AVG(...) AS p50 / MAX(...) AS p95.
    expect(src).not.toMatch(/AVG\s*\([^)]*\)\s*(::int\s*)?AS\s+p50/i);
    expect(src).not.toMatch(/MAX\s*\([^)]*\)\s*(::int\s*)?AS\s+p95/i);
  });
});
