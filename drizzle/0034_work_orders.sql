CREATE TABLE IF NOT EXISTS work_order_types (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  display_name TEXT,
  description TEXT,
  input_schema JSONB NOT NULL DEFAULT '{}',
  output_schema JSONB NOT NULL DEFAULT '{}',
  default_max_cost_usd NUMERIC,
  default_timeout_seconds INTEGER NOT NULL DEFAULT 600,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS work_order_types_org_type_unique ON work_order_types (org_id, type);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL,
  type_version TEXT NOT NULL DEFAULT '1.0',
  input JSONB NOT NULL DEFAULT '{}',
  input_hash TEXT,
  max_cost_usd NUMERIC NOT NULL,
  timeout_seconds INTEGER NOT NULL DEFAULT 600,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_by TEXT,
  claimed_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  guard_decision JSONB DEFAULT '{}',
  approval_action_id TEXT,
  error_code TEXT,
  error_details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS work_orders_org_status_idx ON work_orders (org_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS work_orders_org_type_idx ON work_orders (org_id, type);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS work_order_receipts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  receipt JSONB NOT NULL DEFAULT '{}',
  receipt_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS work_order_receipts_work_order_unique ON work_order_receipts (work_order_id);
