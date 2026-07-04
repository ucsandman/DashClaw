/**
 * Money columns are exact decimals, never float (trust & failure model ADR,
 * D3). drizzle/0021 created the x402 payment rail's money columns as REAL
 * (float32, ~7 significant digits) — accumulating micro-payments into window
 * sums loses precision exactly where the budget gates compare. A
 * normalization migration must convert every money column to numeric, and
 * this test pins the class: any REAL/float money column in the chain without
 * a numeric conversion fails the suite. Scores (value_score,
 * confidence_score) are not money and are exempt.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DRIZZLE_DIR = join(process.cwd(), 'drizzle');

// Column names that hold currency amounts. Extend when a new money column ships.
const MONEY_COLUMNS = new Set(['spend_amount', 'default_price']);

describe('drizzle money column types', () => {
  it('every REAL money column has a numeric conversion in a later migration', () => {
    const files = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql')).sort();
    const realMoney = [];
    const converted = new Set();

    for (const f of files) {
      const content = readFileSync(join(DRIZZLE_DIR, f), 'utf8');
      let table = null;
      for (const line of content.split('\n')) {
        const ct = line.match(/CREATE TABLE (?:IF NOT EXISTS )?"(\w+)"/);
        if (ct) table = ct[1];
        const col = line.match(/"(\w+)"\s+REAL/i);
        if (col && table && MONEY_COLUMNS.has(col[1])) {
          realMoney.push(`${table}.${col[1]}`);
        }
      }
      // Conversion entries: ('table', 'column') pairs inside a migration whose
      // name marks it as the money normalization.
      if (f.includes('money_numeric')) {
        for (const mm of content.matchAll(/\('(\w+)',\s*'(\w+)'\)/g)) {
          converted.add(`${mm[1]}.${mm[2]}`);
        }
      }
    }

    // Sanity: the scanner must see the known 0021 columns, or it proves nothing.
    expect(realMoney).toContain('x402_purchases.spend_amount');
    expect(realMoney).toContain('x402_endpoints.default_price');

    const missing = realMoney.filter((key) => !converted.has(key));
    expect(missing, `REAL money columns with no numeric conversion migration: ${missing.join(', ')}`).toEqual([]);
  });
});
