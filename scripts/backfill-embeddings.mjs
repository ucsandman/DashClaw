#!/usr/bin/env node

/**
 * Backfill action_embeddings for rows in action_records that have no matching
 * embedding row. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/backfill-embeddings.mjs                       (dry-run across all orgs)
 *   node scripts/backfill-embeddings.mjs --apply               (write)
 *   node scripts/backfill-embeddings.mjs --org org_xxx --apply (scope to one org)
 *   node scripts/backfill-embeddings.mjs --limit 500 --apply
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import { generateActionEmbedding } from '../app/lib/embeddings.js';
// dotenv is not a dependency of this package — use the repo env loader.
import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const orgIdx = args.indexOf('--org');
const targetOrg = orgIdx !== -1 ? args[orgIdx + 1] : null;
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) || 100 : 100;

async function backfill() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  console.log(`Starting embedding backfill (${apply ? 'APPLY' : 'DRY-RUN'}${targetOrg ? `, org=${targetOrg}` : ', all orgs'}, limit=${limit})...`);
  const sql = createSqlFromEnv();

  try {
    const actions = targetOrg
      ? await sql`
          SELECT ar.*
          FROM action_records ar
          LEFT JOIN action_embeddings ae ON ar.action_id = ae.action_id
          WHERE ae.action_id IS NULL
            AND ar.org_id = ${targetOrg}
          LIMIT ${limit}
        `
      : await sql`
          SELECT ar.*
          FROM action_records ar
          LEFT JOIN action_embeddings ae ON ar.action_id = ae.action_id
          WHERE ae.action_id IS NULL
          LIMIT ${limit}
        `;

    if (actions.length === 0) {
      console.log('All actions already have embeddings. Nothing to do.');
      return;
    }

    console.log(`Found ${actions.length} actions to index.`);
    if (!apply) {
      console.log('DRY-RUN — re-run with --apply to write embeddings.');
      return;
    }

    for (const action of actions) {
      process.stdout.write(`Indexing ${action.action_id}... `);
      try {
        const embedding = await generateActionEmbedding(action);
        if (embedding) {
          await sql`
            INSERT INTO action_embeddings (org_id, agent_id, action_id, embedding)
            VALUES (${action.org_id}, ${action.agent_id}, ${action.action_id}, ${JSON.stringify(embedding)}::vector)
          `;
          console.log('OK');
        } else {
          console.log('Skipped (no embedding)');
        }
      } catch (err) {
        console.log(`Error: ${err.message}`);
      }
    }

    console.log('\nBackfill complete!');
  } catch (err) {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    // Always release the connection pool so long-running serverless
    // environments (Neon) don't hold a slot open until GC.
    try {
      if (typeof sql.end === 'function') {
        await sql.end({ timeout: 5 });
      }
    } catch {
      // swallow — cleanup only
    }
  }
}

backfill();
