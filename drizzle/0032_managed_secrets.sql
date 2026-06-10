-- 0032: Managed secrets — optional encrypted value + per-secret delivery opt-in.
--
-- governed_secrets gains an OPTIONAL encrypted value (AES-256-GCM via
-- app/lib/encryption.ts, AAD-bound to `${orgId}:${secretId}` so ciphertext
-- cannot be spliced across orgs or rows even though one shared ENCRYPTION_KEY
-- encrypts all orgs' data — AAD binding is the accepted mitigation for the
-- shared-key model). Values are WRITE-ONLY: no API path ever reveals the
-- plaintext; delivery to agents is opt-in PER SECRET via delivery_enabled
-- and only through the API-key-authed GET /api/secrets/env endpoint.
ALTER TABLE "governed_secrets" ADD COLUMN IF NOT EXISTS "value_encrypted" text;
--> statement-breakpoint
ALTER TABLE "governed_secrets" ADD COLUMN IF NOT EXISTS "value_algo" text;
--> statement-breakpoint
ALTER TABLE "governed_secrets" ADD COLUMN IF NOT EXISTS "value_set_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "governed_secrets" ADD COLUMN IF NOT EXISTS "delivery_enabled" integer NOT NULL DEFAULT 0;
