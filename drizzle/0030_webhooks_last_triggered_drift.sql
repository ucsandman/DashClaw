-- 0030: resolve the webhooks last-trigger column drift.
--
-- The live, runtime-used column is `last_triggered_at` (TEXT, created in
-- drizzle/0000). schema/schema.js mistakenly declared `last_trigger_at`
-- (timestamp), and 0028 "codified" that phantom as a second, always-NULL
-- column. schema.js now points at the real column; drop the dead duplicate.
ALTER TABLE "webhooks" DROP COLUMN IF EXISTS "last_trigger_at";
