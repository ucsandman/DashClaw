/**
 * Fresh-vs-legacy schema drift guard (the guard_decisions.created_at bug class).
 *
 * drizzle/0000 created dozens of *_at columns as TEXT while schema/schema.js
 * (and app/api/setup/migrate) declare timestamp — so the physical column type
 * depends on which installer ran. Queries that forget a ::timestamptz cast
 * then fail ONLY on fresh drizzle-chain installs (42883), and best-effort
 * catches turn that into silently dead subsystems (the guard idempotency
 * replay was one).
 *
 * This test pins the class shut:
 *   every (table, *_at column) that any migration creates as TEXT while
 *   schema.js declares it timestamp() MUST be converted by a normalization
 *   migration (drizzle/*normalize_text_timestamps*.sql).
 *
 * Adding a new text *_at column that schema.js types as timestamp fails this
 * test until a normalization entry covers it. Columns that are text in BOTH
 * (e.g. organizations.trial_ends_at) are consistent by design and exempt.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DRIZZLE_DIR = join(ROOT, 'drizzle');

function collectTextTimestampColumns() {
  const pairs = [];
  const files = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (f.includes('normalize_text_timestamps')) continue;
    const content = readFileSync(join(DRIZZLE_DIR, f), 'utf8');
    let table = null;
    for (const line of content.split('\n')) {
      const ct = line.match(/CREATE TABLE "(\w+)"/);
      if (ct) table = ct[1];
      const col = line.match(/"(\w*_at)" text/);
      if (col && table) pairs.push({ table, column: col[1] });
    }
  }
  return pairs;
}

function schemaTimestampColumns() {
  const schema = readFileSync(join(ROOT, 'schema', 'schema.js'), 'utf8');
  const blocks = schema.split(/(?=export const \w+ = pgTable\()/);
  const byTable = new Map();
  for (const b of blocks) {
    const m = b.match(/pgTable\(\s*'(\w+)'/);
    if (m) byTable.set(m[1], b);
  }
  return (table, column) => {
    const block = byTable.get(table);
    return Boolean(block && block.includes(`timestamp('${column}'`));
  };
}

function normalizedPairs() {
  const covered = new Set();
  const files = readdirSync(DRIZZLE_DIR).filter(
    (f) => f.endsWith('.sql') && f.includes('normalize_text_timestamps'),
  );
  for (const f of files) {
    const content = readFileSync(join(DRIZZLE_DIR, f), 'utf8');
    for (const m of content.matchAll(/\('(\w+)',\s*'(\w+)'/g)) {
      covered.add(`${m[1]}.${m[2]}`);
    }
  }
  return covered;
}

describe('drizzle text-timestamp drift', () => {
  it('every text *_at column that schema.js types as timestamp is covered by a normalization migration', () => {
    const isTimestampInSchema = schemaTimestampColumns();
    const drifted = collectTextTimestampColumns().filter(({ table, column }) =>
      isTimestampInSchema(table, column),
    );

    // Sanity: the known 0000 drift must be visible to the scanner, or the
    // test is scanning nothing and proving nothing.
    expect(drifted.map((d) => `${d.table}.${d.column}`)).toContain('guard_decisions.created_at');

    const covered = normalizedPairs();
    const missing = drifted
      .map((d) => `${d.table}.${d.column}`)
      .filter((key) => !covered.has(key));

    expect(missing, `text columns schema.js declares as timestamp but no normalization migration converts: ${missing.join(', ')}`).toEqual([]);
  });
});
