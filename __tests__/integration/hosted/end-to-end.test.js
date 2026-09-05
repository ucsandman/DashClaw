/**
 * End-to-end integration test for hosted workspace provisioning.
 *
 * Gated by INTEGRATION_DATABASE_URL — the suite is skipped entirely when that
 * variable is unset so default `npm run test` runs never depend on a live DB
 * or dev server. To run:
 *   1. Start a hosted-mode server with HOSTED_DRILL_TOKEN and an operator key.
 *   2. Run: `INTEGRATION_DATABASE_URL="$DATABASE_URL" INTEGRATION_ADMIN_API_KEY="$DASHCLAW_API_KEY" \
 *           HOSTED_DRILL_TOKEN="$HOSTED_DRILL_TOKEN" TEST_BASE_URL=http://localhost:3000 \
 *           npm run test -- --run __tests__/integration/hosted/end-to-end.test.js`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const SHOULD_RUN = !!process.env.INTEGRATION_DATABASE_URL;
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ADMIN_API_KEY = process.env.INTEGRATION_ADMIN_API_KEY || '';
const MINT_HEADERS = {
  'content-type': 'application/json',
  ...(process.env.HOSTED_DRILL_TOKEN
    ? { 'x-hosted-drill-token': process.env.HOSTED_DRILL_TOKEN }
    : {}),
};

describe.runIf(SHOULD_RUN)('hosted workspace end-to-end', () => {
  let workspaceId;
  let apiKey;
  let sql;
  const fixtureWorkspaceIds = new Set();

  async function provisionFixtureWorkspace() {
    const res = await fetch(`${BASE}/api/hosted/workspaces`, {
      method: 'POST',
      headers: MINT_HEADERS,
      body: '{}',
    });
    const body = await res.json();
    if (typeof body.workspace_id === 'string') fixtureWorkspaceIds.add(body.workspace_id);
    expect(res.status).toBe(200);
    return body;
  }

  beforeAll(() => {
    if (!ADMIN_API_KEY) {
      throw new Error('INTEGRATION_ADMIN_API_KEY is required for the hosted admin happy path');
    }
    process.env.DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
    process.env.DASHCLAW_HOSTED = 'true';
    sql = postgres(process.env.DATABASE_URL, { max: 1 });
  });

  afterAll(async () => {
    const cleanupErrors = [];
    if (sql) {
      for (const fixtureId of fixtureWorkspaceIds) {
        try {
          await sql`DELETE FROM guard_policies WHERE org_id = ${fixtureId}`;
          await sql`DELETE FROM api_keys WHERE org_id = ${fixtureId}`;
          await sql`DELETE FROM organizations WHERE id = ${fixtureId}`;
        } catch (error) {
          cleanupErrors.push(new Error(`failed to tear down fixture workspace ${fixtureId}`, { cause: error }));
        }
      }
      try {
        await sql.end({ timeout: 5 });
      } catch (error) {
        cleanupErrors.push(new Error('failed to close integration database connection', { cause: error }));
      }
    }
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'hosted fixture cleanup failed');
  });

  it('provisions a workspace and returns a usable api key', async () => {
    const body = await provisionFixtureWorkspace();
    workspaceId = body.workspace_id;
    apiKey = body.api_key;
    expect(workspaceId).toMatch(/^org_/);
    expect(apiKey).toMatch(/^oc_live_/);
    expect(body.endpoint).toBeTypeOf('string');
    expect(body.expires_at).toBeTypeOf('string');
    expect(body.trial_action_cap).toBe(10000);
    expect(body.key_prefix).toMatch(/^oc_live_/);
    expect(body.next_steps_url).toContain(workspaceId);
  });

  it('uses the key to authenticate against a protected API route', async () => {
    const res = await fetch(`${BASE}/api/actions`, {
      headers: { 'x-api-key': apiKey },
    });
    expect(res.status).toBe(200);
  });

  it('hitting the action cap returns 403 with "action cap" error', async () => {
    // Create a fresh trial, tighten its cap, and use its uncached key. Keeping
    // the primary workspace healthy preserves the later admin happy path.
    const fresh = await provisionFixtureWorkspace();
    await sql`
      UPDATE organizations
      SET trial_action_cap = 1, trial_actions_used = 1
      WHERE id = ${fresh.workspace_id}
    `;

    const res = await fetch(`${BASE}/api/actions`, {
      method: 'POST',
      headers: {
        'x-api-key': fresh.api_key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ agent_id: 'a', action_type: 'test', summary: 'x' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/action cap/i);

  });

  it('expired trial returns 403 with "trial expired" error', async () => {
    // Use another fresh workspace to avoid cache pollution
    const fresh = await provisionFixtureWorkspace();
    await sql`
      UPDATE organizations
      SET trial_ends_at = '2000-01-01T00:00:00Z'
      WHERE id = ${fresh.workspace_id}
    `;

    const res = await fetch(`${BASE}/api/actions`, {
      headers: { 'x-api-key': fresh.api_key },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/trial.*expired/i);
  });

  it('admin GET returns workspace details', async () => {
    const res = await fetch(`${BASE}/api/hosted/workspaces/${workspaceId}`, {
      method: 'GET',
      headers: { 'x-api-key': ADMIN_API_KEY },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspace_id).toBe(workspaceId);
    expect(body.trial_actions_used).toBeGreaterThanOrEqual(0);
  });
});
