-- v4.6 funnel truth: frozen funnel milestones for hosted trial workspaces.
-- deleteHostedWorkspace hard-deletes an expired trial org and every
-- FK-referencing child row; without this snapshot the activation funnel
-- (mint → first key used → first governed action → retained week 1)
-- undercounts mints as history is purged — survivorship bias. Deliberately
-- NO foreign key to organizations: the catalog-driven child sweep deletes
-- every referencing row, and this one must survive it. Written fail-closed
-- inside deleteHostedWorkspace before the child sweep.
CREATE TABLE IF NOT EXISTS "hosted_trial_snapshots" (
  "org_id" text PRIMARY KEY,
  "minted_at" timestamptz NOT NULL,
  "deleted_at" timestamptz NOT NULL DEFAULT now(),
  "key_used" boolean NOT NULL DEFAULT false,
  "first_action_at" timestamptz,
  "last_action_at" timestamptz,
  "action_count" integer NOT NULL DEFAULT 0,
  "retained_week1" boolean NOT NULL DEFAULT false
);
