import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SIGNAL_TYPES } from '../../app/lib/signal-hash';

// SIGNAL_TYPES in signal-hash.ts is hand-maintained (the client can't import
// the server-only signals.ts). If someone mints an 18th signal type there and
// forgets the list, every dismissal of that type 400s at the shape gate in
// readDismissKeys. This pins the two files together by scraping the literals.
describe('SIGNAL_TYPES stays in sync with the types signals.ts mints', () => {
  const source = readFileSync(resolve(__dirname, '../../app/lib/signals.ts'), 'utf8');
  const minted = [...new Set([...source.matchAll(/type: '([a-z_]+)'/g)].map((m) => m[1]))];

  it('scrapes a sane number of minted types', () => {
    expect(minted.length).toBeGreaterThanOrEqual(15);
  });

  it('every minted signal type is dismissable (present in SIGNAL_TYPES)', () => {
    const missing = minted.filter((t) => !SIGNAL_TYPES.has(t));
    expect(missing).toEqual([]);
  });
});
