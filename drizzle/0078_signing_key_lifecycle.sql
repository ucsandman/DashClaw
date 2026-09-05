-- Signing-key lifecycle is separate from cryptographic verification. Active
-- keys issue new evidence, retired keys remain trusted for historical
-- verification, and compromised keys leave the trusted JWKS set while staying
-- visible in its public status manifest.

ALTER TABLE "server_signing_keys"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint

ALTER TABLE "server_signing_keys"
  ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMP;
--> statement-breakpoint

ALTER TABLE "server_signing_keys"
  ADD COLUMN IF NOT EXISTS "compromised_at" TIMESTAMP;
--> statement-breakpoint

UPDATE "server_signing_keys"
SET "status" = CASE WHEN "active" = 1 THEN 'active' ELSE 'retired' END
WHERE "status" = 'active'
   OR "status" IS NULL
   OR "status" NOT IN ('active', 'retired', 'compromised');
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "server_signing_keys_one_active_idx"
  ON "server_signing_keys" ((1))
  WHERE "status" = 'active';
--> statement-breakpoint

-- A data-modifying CTE cannot safely replace a row covered by the partial
-- unique index: its UPDATE and INSERT share one snapshot and can collide.
-- Keep rotation in one database transaction and serialize concurrent callers.
CREATE OR REPLACE FUNCTION public.rotate_server_signing_key(
  p_id TEXT,
  p_kid TEXT,
  p_alg TEXT,
  p_private_jwk TEXT,
  p_public_jwk TEXT,
  p_rotated_at TIMESTAMP,
  p_compromise_kid TEXT DEFAULT NULL,
  p_compromised_at TIMESTAMP DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  compromised_count INTEGER;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(4630497607110640177);

  IF EXISTS (SELECT 1 FROM public.server_signing_keys WHERE id = p_id) THEN
    RETURN FALSE;
  END IF;

  UPDATE public.server_signing_keys
  SET active = 0,
      status = 'retired',
      retired_at = COALESCE(retired_at, p_rotated_at)
  WHERE active = 1 AND status = 'active';

  IF p_compromise_kid IS NOT NULL THEN
    UPDATE public.server_signing_keys
    SET active = 0,
        status = 'compromised',
        compromised_at = COALESCE(compromised_at, p_compromised_at, p_rotated_at)
    WHERE kid = p_compromise_kid AND status != 'compromised';
    GET DIAGNOSTICS compromised_count = ROW_COUNT;
    IF compromised_count = 0 THEN
      RAISE EXCEPTION 'signing key selected for compromise was not found or was already compromised'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO public.server_signing_keys
    (id, kid, alg, private_jwk, public_jwk, active, status, retired_at, compromised_at)
  VALUES
    (p_id, p_kid, p_alg, p_private_jwk, p_public_jwk, 1, 'active', NULL, NULL);

  RETURN TRUE;
END;
$$;
