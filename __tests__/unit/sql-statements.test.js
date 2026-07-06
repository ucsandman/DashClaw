// __tests__/unit/sql-statements.test.js
//
// splitSqlStatements / stripSqlLineComments — the shared drizzle-chain
// statement preparation used by auto-migrate, POST /api/setup/migrate, and
// the doctor migrate fix. The load-bearing property: NO comment text may
// reach the server, because the server converts statement text into the
// database encoding and non-ASCII comment characters (the "→" arrows in our
// migration comments) hard-fail with 22P05 on non-UTF8 databases — observed
// live as a partial schema on a fresh Windows Sandbox WIN1252 cluster.

import { describe, it, expect } from 'vitest';
import { splitSqlStatements, stripSqlLineComments } from '../../app/lib/setup/sql-statements.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('stripSqlLineComments', () => {
  it('removes full-line comments, keeps DDL', () => {
    const out = stripSqlLineComments('-- header → with arrow\nCREATE TABLE "t" ("id" text);\n-- trailer');
    expect(out).toBe('CREATE TABLE "t" ("id" text);');
  });

  it('preserves comment-looking lines inside $$ dollar-quoted bodies', () => {
    const stmt = 'DO $$\nBEGIN\n-- this line is part of the body\nNULL;\nEND $$;';
    expect(stripSqlLineComments(stmt)).toBe(stmt);
  });

  it('strips comments after a dollar-quoted body closes', () => {
    const out = stripSqlLineComments('DO $$\nBEGIN NULL; END $$;\n-- after body');
    expect(out).toBe('DO $$\nBEGIN NULL; END $$;');
  });
});

describe('splitSqlStatements', () => {
  it('splits on statement-breakpoint and drops comment-only chunks', () => {
    const ddl = [
      '-- file header only',
      '--> statement-breakpoint',
      'CREATE TABLE "a" ("id" text);',
      '--> statement-breakpoint',
      '-- note\nCREATE TABLE "b" ("id" text);',
    ].join('\n');
    expect(splitSqlStatements(ddl)).toEqual([
      'CREATE TABLE "a" ("id" text);',
      'CREATE TABLE "b" ("id" text);',
    ]);
  });

  it('the real drizzle chain yields zero statements containing non-ASCII characters', () => {
    // The regression this guards: any non-ASCII character reaching the server
    // in statement text breaks fresh installs on non-UTF8 databases. Comments
    // are stripped; anything left (identifiers, string literals) must be ASCII.
    const dir = resolve(process.cwd(), 'drizzle');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThan(0);
    const offenders = [];
    for (const f of files) {
      for (const stmt of splitSqlStatements(readFileSync(resolve(dir, f), 'utf8'))) {
        // eslint-disable-next-line no-control-regex
        if (/[^\x00-\x7F]/.test(stmt)) offenders.push(`${f}: ${stmt.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
