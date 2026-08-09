import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('migration 0070 — stripe_webhook_events idempotency ledger', () => {
  const sql = readFileSync(path.resolve('drizzle/0070_stripe_webhook_events.sql'), 'utf8');

  it('creates the ledger keyed by the Stripe event id', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS stripe_webhook_events/);
    expect(sql).toMatch(/event_id TEXT PRIMARY KEY/);
  });

  it('org_id is nullable and deliberately NOT a foreign key — events for deleted orgs still record their claim', () => {
    expect(sql).toMatch(/org_id TEXT,/);
    expect(sql).not.toMatch(/org_id TEXT[^,]*REFERENCES/);
  });

  it('separates statements with --> statement-breakpoint', () => {
    expect((sql.match(/-->\s*statement-breakpoint/g) || []).length).toBeGreaterThanOrEqual(1);
  });
});
