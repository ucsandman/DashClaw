/**
 * Real PostgreSQL coverage for enforcement-liveness JSONB persistence.
 *
 * The suite uses one unique schema on every pooled connection's search_path.
 * It never reads or mutates application schemas and drops only its fixture
 * schema during teardown. No environment files are loaded by this test.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import {
  getLatestEnforcementLivenessRunForOrg,
  insertEnforcementLivenessRun,
  listEnforcementLivenessRunsForOrg,
  listLatestEnforcementLivenessRunPerRuntime,
} from '../../app/lib/repositories/enforcement-liveness.repository';
import type { EnforcementLivenessRunInput } from '../../app/lib/repositories/enforcement-liveness.repository';
import type { SqlTag } from '../../app/lib/types/db';

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const SHOULD_RUN = Boolean(DATABASE_URL);

type Db = ReturnType<typeof postgres>;

const HOOK = {
  installed: true,
  runtime_version: 'codex-cli fixture',
  hook_fingerprint: `sha256:${'b'.repeat(64)}`,
  settings_path: '/fixture/settings.json',
  timeout_seconds: 30,
  effective_timer_ms: 29_500,
  overflowed: false,
  mode: 'enforced',
  exit_code: 0,
  cancelled: false,
};
const WITNESS = { path: '/fixture/enforcement-liveness-witness.json', executed: false };
const CHECKS = [
  { id: 'hook-installed', title: 'Hook installed', status: 'pass' as const, detail: 'recognized', durationMs: 4 },
  { id: 'witness-absent', title: 'Witness file absent', status: 'pass' as const, detail: 'held', durationMs: 7 },
];
const RUN: EnforcementLivenessRunInput = {
  source: 'manual',
  runtime: 'codex',
  verdict: 'held',
  detail: 'probe action was held',
  hook: HOOK,
  witness: WITNESS,
  decision: 'require_approval',
  checks: CHECKS,
  startedAt: '2026-09-05T12:00:00.000Z',
  finishedAt: '2026-09-05T12:00:01.000Z',
};

describe.runIf(SHOULD_RUN)('enforcement liveness against PostgreSQL', () => {
  const schemaName = `liveness_regression_${randomUUID().replaceAll('-', '')}`;
  const prefix = randomUUID().replaceAll('-', '').slice(0, 12);
  let sequence = 0;
  let adminDb: Db | undefined;
  let scopedDb: Db | undefined;
  let repositorySql: SqlTag;

  const id = (suffix: string) => `elr_${prefix}_${suffix}_${sequence++}`;

  async function insertLegacyRow(input: {
    id: string;
    orgId: string;
    hookText?: string;
    witnessText?: string;
    checksText?: string;
    createdAt: Date;
  }) {
    await scopedDb!`
      INSERT INTO enforcement_liveness_runs (
        id, org_id, source, runtime, verdict, detail, hook, witness, decision,
        checks, started_at, finished_at, created_at
      ) VALUES (
        ${input.id}, ${input.orgId}, ${RUN.source}, ${RUN.runtime}, ${RUN.verdict},
        ${RUN.detail}, to_jsonb(${input.hookText ?? JSON.stringify(HOOK)}::text),
        to_jsonb(${input.witnessText ?? JSON.stringify(WITNESS)}::text), ${RUN.decision},
        to_jsonb(${input.checksText ?? JSON.stringify(CHECKS)}::text),
        ${RUN.startedAt}, ${RUN.finishedAt}, ${input.createdAt}
      )
    `;
  }

  function expectExactMetadata(run: unknown) {
    expect(run).toMatchObject({
      source: RUN.source,
      runtime: RUN.runtime,
      verdict: RUN.verdict,
      detail: RUN.detail,
      decision: RUN.decision,
      hook: HOOK,
      witness: WITNESS,
      checks: CHECKS,
    });
  }

  beforeAll(async () => {
    adminDb = postgres(DATABASE_URL!, { max: 1 });
    await adminDb`CREATE SCHEMA ${adminDb(schemaName)}`;
    scopedDb = postgres(DATABASE_URL!, {
      max: 4,
      connection: { search_path: schemaName },
    });
    repositorySql = scopedDb as unknown as SqlTag;

    const [scope] = await scopedDb`SELECT current_schema() AS name`;
    if (scope?.name !== schemaName) throw new Error(`fixture search_path did not select ${schemaName}`);
    await scopedDb.unsafe(`
      CREATE TABLE enforcement_liveness_runs (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        source text NOT NULL,
        runtime text NOT NULL DEFAULT 'unknown',
        verdict text NOT NULL,
        detail text NOT NULL,
        hook jsonb NOT NULL,
        witness jsonb NOT NULL,
        decision text,
        checks jsonb NOT NULL,
        started_at timestamptz NOT NULL,
        finished_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }, 30_000);

  afterAll(async () => {
    const errors: Error[] = [];
    try {
      await scopedDb?.end({ timeout: 5 });
    } catch (error) {
      errors.push(new Error('failed to close scoped liveness pool', { cause: error }));
    }
    try {
      if (adminDb) await adminDb`DROP SCHEMA IF EXISTS ${adminDb(schemaName)} CASCADE`;
    } catch (error) {
      errors.push(new Error(`failed to drop fixture schema ${schemaName}`, { cause: error }));
    }
    try {
      await adminDb?.end({ timeout: 5 });
    } catch (error) {
      errors.push(new Error('failed to close liveness admin pool', { cause: error }));
    }
    if (errors.length > 0) throw new AggregateError(errors, 'enforcement liveness fixture cleanup failed');
  });

  it('stores native JSONB metadata and returns it exactly through all three getters', async () => {
    const orgId = `org_native_${prefix}`;
    const inserted = await insertEnforcementLivenessRun(repositorySql, orgId, RUN);
    const [stored] = await scopedDb!`
      SELECT jsonb_typeof(hook) AS hook_type, jsonb_typeof(witness) AS witness_type,
        jsonb_typeof(checks) AS checks_type
      FROM enforcement_liveness_runs WHERE id = ${inserted.id}
    `;
    expect(stored).toEqual({ hook_type: 'object', witness_type: 'object', checks_type: 'array' });

    const latest = await getLatestEnforcementLivenessRunForOrg(repositorySql, orgId);
    const history = await listEnforcementLivenessRunsForOrg(repositorySql, orgId, 10);
    const perRuntime = await listLatestEnforcementLivenessRunPerRuntime(repositorySql, orgId);
    expectExactMetadata(latest);
    expect(history).toHaveLength(1);
    expectExactMetadata(history[0]);
    expect(perRuntime).toHaveLength(1);
    expectExactMetadata(perRuntime[0]);
  });

  it('decodes pre-existing string-encoded rows through every getter without rewriting or deleting them', async () => {
    const orgId = `org_legacy_${prefix}`;
    const legacyId = id('legacy');
    await insertLegacyRow({ id: legacyId, orgId, createdAt: new Date('2026-09-05T12:01:00.000Z') });

    const latest = await getLatestEnforcementLivenessRunForOrg(repositorySql, orgId);
    const history = await listEnforcementLivenessRunsForOrg(repositorySql, orgId, 10);
    const perRuntime = await listLatestEnforcementLivenessRunPerRuntime(repositorySql, orgId);
    expectExactMetadata(latest);
    expectExactMetadata(history[0]);
    expectExactMetadata(perRuntime[0]);

    const [stored] = await scopedDb!`
      SELECT count(*)::int AS row_count, min(jsonb_typeof(hook)) AS hook_type,
        min(jsonb_typeof(witness)) AS witness_type, min(jsonb_typeof(checks)) AS checks_type
      FROM enforcement_liveness_runs WHERE id = ${legacyId}
    `;
    expect(stored).toEqual({ row_count: 1, hook_type: 'string', witness_type: 'string', checks_type: 'string' });
  });

  it('rejects the newest malformed legacy row through every getter instead of falling back to healthy history', async () => {
    const orgId = `org_malformed_${prefix}`;
    await insertLegacyRow({
      id: id('healthy'),
      orgId,
      createdAt: new Date('2026-09-05T12:02:00.000Z'),
    });
    await insertLegacyRow({
      id: id('malformed'),
      orgId,
      checksText: '{not-json',
      createdAt: new Date('2026-09-05T12:03:00.000Z'),
    });

    await expect(getLatestEnforcementLivenessRunForOrg(repositorySql, orgId)).rejects.toThrow(
      /invalid stored enforcement liveness checks/i,
    );
    await expect(listEnforcementLivenessRunsForOrg(repositorySql, orgId, 10)).rejects.toThrow(
      /invalid stored enforcement liveness checks/i,
    );
    await expect(listLatestEnforcementLivenessRunPerRuntime(repositorySql, orgId)).rejects.toThrow(
      /invalid stored enforcement liveness checks/i,
    );
  });
});
