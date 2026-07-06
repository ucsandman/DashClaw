// app/lib/setup/sql-statements.mjs
//
// Shared statement preparation for every executor of the drizzle/*.sql chain
// (scripts/auto-migrate.mjs, POST /api/setup/migrate, doctor fix migrate).
//
// Splits on drizzle's `--> statement-breakpoint` and strips full-line `--`
// comments BEFORE the statements are sent to Postgres. The server converts
// incoming statement text — comments included — into the database encoding;
// a comment containing a character with no equivalent in that encoding (the
// "→" arrows in our migration comments vs a WIN1252 database, the default on
// fresh Windows embedded clusters) hard-fails the whole migration with 22P05
// (observed live: `npx dashclaw up` in Windows Sandbox stopped the chain at
// the first arrow, leaving a partial schema). Comments are for readers of the
// repo; the server never needs them.

/**
 * Strip full-line `--` comments from a single SQL statement, preserving
 * everything inside $$ dollar-quoted bodies (a line starting with `--` there
 * may be part of a function body or, worse, data).
 */
export function stripSqlLineComments(statement) {
  let inDollar = false;
  const kept = [];
  for (const line of String(statement).split('\n')) {
    if (!inDollar && /^\s*--/.test(line)) continue;
    const marks = line.match(/\$\$/g);
    if (marks && marks.length % 2 === 1) inDollar = !inDollar;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/**
 * Split concatenated drizzle SQL into executable statements: breakpoint
 * split, comment strip, empty drop (file-header comment blocks become empty
 * strings after stripping — previously they were sent to the server as
 * comment-only "statements").
 */
export function splitSqlStatements(sqlText) {
  return String(sqlText)
    .split('--> statement-breakpoint')
    .map((s) => stripSqlLineComments(s))
    .filter(Boolean);
}
