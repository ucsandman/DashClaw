import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// Every list page wired in Phase 4 must carry the shared selection system:
// useSelection + a header/row SelectCheckbox + a BulkActionBar. This static
// inventory guards against a page silently losing its multi-select wiring.
// code-sessions is intentionally excluded: it is a SERVER component
// (export default async function … headers()/server-side fetch), so client
// selection hooks can't be added without a client-component extraction —
// deferred as out of surgical scope for this phase.
const WIRED_PAGES: Array<[string, string]> = [
  ['identities', 'app/identities/page.tsx'],
  ['audit-log', 'app/audit-log/page.tsx'],
  ['assumptions', 'app/assumptions/page.tsx'],
  ['evaluations', 'app/evaluations/page.tsx'],
];

describe('multi-select coverage — wiring inventory', () => {
  it.each(WIRED_PAGES)('%s page wires useSelection + SelectCheckbox + BulkActionBar', (_label, rel) => {
    const code = src(rel);
    expect(code).toMatch(/useSelection/);
    expect(code).toMatch(/useSelectAllHotkey/);
    expect(code).toMatch(/SelectCheckbox/);
    expect(code).toMatch(/BulkActionBar/);
  });

  it('read-only logs (audit-log) expose only non-destructive bulk (Copy IDs, no delete fan-out)', () => {
    const code = src('app/audit-log/page.tsx');
    expect(code).toMatch(/Copy IDs/);
    // An immutable audit log must never fan out a destructive route.
    expect(code).not.toMatch(/bulkAction\([^)]*method:\s*['"]DELETE/);
  });

  it('mutating pages fan out over existing per-item routes via bulkAction', () => {
    expect(src('app/identities/page.tsx')).toMatch(/bulkAction/);
  });
});
