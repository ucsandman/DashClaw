CREATE TABLE IF NOT EXISTS "schema_migrations" (
  "filename" text PRIMARY KEY NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
