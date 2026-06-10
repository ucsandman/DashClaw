-- 0033: Codify compliance_exports + compliance_schedules into the migration
-- chain. These tables previously existed ONLY via the side script
-- scripts/migrate-compliance-export.mjs, so fresh `npm run db:migrate` deploys
-- 500'd on /compliance/exports. DDL mirrors that script exactly and stays
-- IF NOT EXISTS because some deploys already created them via the script.
CREATE TABLE IF NOT EXISTS "compliance_exports" (
  "id"            text PRIMARY KEY,
  "org_id"        text NOT NULL,
  "name"          text NOT NULL,
  "frameworks"    jsonb NOT NULL DEFAULT '[]',
  "format"        text DEFAULT 'markdown',
  "window_days"   integer DEFAULT 30,
  "include_evidence" boolean DEFAULT TRUE,
  "include_remediation" boolean DEFAULT TRUE,
  "include_trends" boolean DEFAULT FALSE,
  "status"        text DEFAULT 'pending',
  "report_content" text DEFAULT '',
  "evidence_summary" jsonb DEFAULT '{}',
  "snapshot_ids"  jsonb DEFAULT '[]',
  "file_size_bytes" integer DEFAULT 0,
  "error_message" text DEFAULT '',
  "requested_by"  text DEFAULT 'user',
  "started_at"    timestamptz,
  "completed_at"  timestamptz,
  "created_at"    timestamptz DEFAULT NOW()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_schedules" (
  "id"            text PRIMARY KEY,
  "org_id"        text NOT NULL,
  "name"          text NOT NULL,
  "frameworks"    jsonb NOT NULL DEFAULT '[]',
  "format"        text DEFAULT 'markdown',
  "window_days"   integer DEFAULT 30,
  "cron_expression" text NOT NULL,
  "include_evidence" boolean DEFAULT TRUE,
  "include_remediation" boolean DEFAULT TRUE,
  "include_trends" boolean DEFAULT FALSE,
  "enabled"       boolean DEFAULT TRUE,
  "last_run_at"   timestamptz,
  "next_run_at"   timestamptz,
  "last_export_id" text DEFAULT '',
  "created_at"    timestamptz DEFAULT NOW(),
  "updated_at"    timestamptz DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compliance_exports_org" ON "compliance_exports" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compliance_exports_status" ON "compliance_exports" ("org_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compliance_exports_created" ON "compliance_exports" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compliance_schedules_org" ON "compliance_schedules" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_compliance_schedules_enabled" ON "compliance_schedules" ("org_id", "enabled");
