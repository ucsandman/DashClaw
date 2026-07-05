// CLAUDE.md: every entry point must surface async rejections.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  process.exit(1);
});

// Env comes from the caller (setup.mjs / _run-with-env) or ./_load-env.mjs —
// `dotenv` is not a dependency of this package, so importing 'dotenv/config'
// crashes on fresh installs where npm didn't hoist it transitively.
import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  console.log('🚀 Starting Behavioral AI Migration...');
  const sql = createSqlFromEnv();

  try {
    console.log('1. Enabling pgvector extension...');
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;

    console.log('2. Creating action_embeddings table...');
    await sql`
      CREATE TABLE IF NOT EXISTS action_embeddings (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        embedding vector(1536),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    console.log('3. Creating vector search index (HNSW)...');
    // Using HNSW for fast approximate nearest neighbor search
    await sql`
      CREATE INDEX IF NOT EXISTS action_embeddings_vector_idx 
      ON action_embeddings 
      USING hnsw (embedding vector_cosine_ops)
    `;

    console.log('4. Adding org_id + action_id index...');
    await sql`CREATE INDEX IF NOT EXISTS idx_action_embeddings_org_agent ON action_embeddings(org_id, agent_id)`;

    console.log('✅ Behavioral AI Migration complete!');
    console.log('You can now add "behavioral_anomaly" policies to your Guard configuration.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    if (err.message.includes('permission denied')) {
      console.error('Tip: Ensure your Neon user has permission to CREATE EXTENSION.');
    }
    process.exit(1);
  }
}

migrate();
