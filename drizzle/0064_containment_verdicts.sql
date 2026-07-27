-- Containment Verdicts (RFC 2026-07-06): staged-effect lifecycle on action_records.
-- Idempotent and fresh-install-safe (matches 0045/0055/0056 column-add idiom).
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "containment_status" text;
--> statement-breakpoint
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "containment_ref" text;
--> statement-breakpoint
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "containment_resolved_by" text;
--> statement-breakpoint
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "containment_resolved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "action_records" DROP CONSTRAINT IF EXISTS "action_records_containment_status_check";
--> statement-breakpoint
ALTER TABLE "action_records" ADD CONSTRAINT "action_records_containment_status_check"
  CHECK ("containment_status" IS NULL OR "containment_status" IN ('contained', 'awaiting_promotion', 'promoted', 'discarded'));
