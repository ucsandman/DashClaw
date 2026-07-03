-- Fresh-install fix (same class as drizzle/0026): upsertAgentPresence
-- (agents.repository.ts) writes an updated_at column and upserts
-- ON CONFLICT (org_id, agent_id), but the drizzle/0000 table has neither the
-- column nor a unique constraint on that pair (its PK is agent_id alone) —
-- legacy databases got both out-of-band (their PK is composite
-- (org_id, agent_id)), which is why production worked while every fresh
-- install silently dropped ALL presence heartbeats:
--   [presence] heartbeat skipped: column "updated_at" of relation
--   "agent_presence" does not exist        (CI startup-smoke, 2026-07-02)
-- and, once the column exists, the upsert would still 42P10 without a
-- unique (org_id, agent_id). Both fixes are idempotent no-ops on legacy DBs.
ALTER TABLE "agent_presence" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();
--> statement-breakpoint
-- Guarded DO block instead of CREATE UNIQUE INDEX IF NOT EXISTS: legacy DBs
-- already satisfy the ON CONFLICT via their composite PRIMARY KEY, and a
-- name-only IF NOT EXISTS check would stack a redundant second unique index
-- on them. ::regclass resolves through the active search_path — the same
-- table the ALTER above targeted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'agent_presence'::regclass
      AND i.indisunique
      AND i.indnkeyatts = 2
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname)
        FROM unnest(i.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      ) = ARRAY['agent_id', 'org_id']
  ) THEN
    CREATE UNIQUE INDEX "agent_presence_org_agent_unique"
      ON "agent_presence" ("org_id", "agent_id");
  END IF;
END $$;
