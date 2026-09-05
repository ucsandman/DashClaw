/**
 * Real PostgreSQL regression coverage for protocol-1 execution claims.
 *
 * The suite creates one unique schema and puts it on every pooled connection's
 * search_path. It never reads or mutates application schemas and drops only
 * that fixture schema in teardown. No environment files are loaded here.
 *
 * PowerShell: npx vitest run __tests__/integration/execution-claims.test.ts
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { claimActionExecution } from '../../app/lib/repositories/actions.repository.execution';
import type { SqlTag } from '../../app/lib/types/db';

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const SHOULD_RUN = Boolean(DATABASE_URL);

type Db = ReturnType<typeof postgres>;
type ActionFixture = {
  actionId: string;
  decisionId: string;
  orgId: string;
  agentId: string;
  actionType: string;
  declaredGoal: string;
  actHash: string;
  principalId: string;
};
type ActionOptions = Partial<Omit<ActionFixture, 'actionId' | 'decisionId'>> & {
  authority?: { kind: 'operator' | 'plan'; id: string } | 'self' | null;
  decision?: string;
  decisionContainmentRef?: string;
  containmentStatus?: string | null;
  containmentRef?: string | null;
  identityVerified?: boolean;
  executionProtocol?: number | null;
  parentActionId?: string | null;
};

describe.runIf(SHOULD_RUN)('execution claims against PostgreSQL', () => {
  const schemaName = `claim_regression_${randomUUID().replaceAll('-', '')}`;
  const prefix = randomUUID().replaceAll('-', '').slice(0, 12);
  const defaults = {
    orgId: 'org_fixture',
    agentId: 'agent_fixture',
    actionType: 'write',
    declaredGoal: 'fixture write',
    actHash: 'hash_fixture',
    principalId: 'key_fixture',
  };
  let sequence = 0;
  let adminDb: Db | undefined;
  let scopedDb: Db | undefined;
  let claimSql: SqlTag;

  const id = (kind: string, suffix: string) => `${kind}_${prefix}_${suffix}_${sequence++}`;

  async function insertDecision(fixture: ActionFixture, options: Pick<ActionOptions, 'authority' | 'decision' | 'decisionContainmentRef'> = {}) {
    const authority = options.authority === 'self'
      ? { kind: 'operator' as const, id: fixture.actionId }
      : (options.authority ?? null);
    const context = {
      _execution_authorization: authority,
      _execution_act_content_hash: fixture.actHash,
      ...(options.decisionContainmentRef
        ? { _execution_containment: { ref: options.decisionContainmentRef } }
        : {}),
    };
    await scopedDb!`
      INSERT INTO guard_decisions (id, org_id, agent_id, action_type, context, decision)
      VALUES (${fixture.decisionId}, ${fixture.orgId}, ${fixture.agentId}, ${fixture.actionType}, ${JSON.stringify(context)}, ${options.decision ?? 'allow'})
    `;
  }

  async function recordAction(suffix: string, options: ActionOptions = {}): Promise<ActionFixture> {
    const fixture: ActionFixture = {
      actionId: id('act', suffix),
      decisionId: id('decision', suffix),
      orgId: options.orgId ?? defaults.orgId,
      agentId: options.agentId ?? defaults.agentId,
      actionType: options.actionType ?? defaults.actionType,
      declaredGoal: options.declaredGoal ?? defaults.declaredGoal,
      actHash: options.actHash ?? defaults.actHash,
      principalId: options.principalId ?? defaults.principalId,
    };
    await insertDecision(fixture, options);
    await scopedDb!`
      INSERT INTO action_records (
        action_id, org_id, agent_id, action_type, declared_goal, act_content_hash,
        status, outcome_status, execution_protocol, guard_decision_id, created_by,
        identity_verified, containment_status, containment_ref, parent_action_id
      ) VALUES (
        ${fixture.actionId}, ${fixture.orgId}, ${fixture.agentId}, ${fixture.actionType},
        ${fixture.declaredGoal}, ${fixture.actHash}, 'running', 'pending',
        ${options.executionProtocol === undefined ? 1 : options.executionProtocol},
        ${fixture.decisionId}, ${fixture.principalId}, ${options.identityVerified ?? false},
        ${options.containmentStatus ?? null}, ${options.containmentRef ?? null},
        ${options.parentActionId ?? null}
      )
    `;
    return fixture;
  }

  async function addDecision(fixture: ActionFixture, options: Pick<ActionOptions, 'authority' | 'decision' | 'decisionContainmentRef'>) {
    const withDecision = { ...fixture, decisionId: id('decision', 'fresh') };
    await insertDecision(withDecision, options);
    return withDecision;
  }

  function claim(fixture: ActionFixture, overrides: Partial<Parameters<typeof claimActionExecution>[1]> = {}) {
    return claimActionExecution(claimSql, {
      orgId: fixture.orgId,
      actionId: fixture.actionId,
      agentId: fixture.agentId,
      attemptId: randomUUID(),
      actHash: fixture.actHash,
      decisionId: fixture.decisionId,
      principalId: fixture.principalId,
      identityVerified: false,
      ...overrides,
    });
  }

  async function approve(fixture: ActionFixture) {
    await scopedDb!`
      UPDATE action_records SET approved_by = 'operator', approved_at = NOW()
      WHERE action_id = ${fixture.actionId}
    `;
  }

  async function createPlanGrant(suffix: string, status = 'approved', expiresAt = new Date(Date.now() + 60_000)) {
    const planId = id('plan', suffix);
    const stepId = id('step', suffix);
    await scopedDb!`
      INSERT INTO plan_authorizations (plan_id, org_id, agent_id, status, expires_at)
      VALUES (${planId}, ${defaults.orgId}, ${defaults.agentId}, ${status}, ${expiresAt})
    `;
    await scopedDb!`
      INSERT INTO plan_authorization_steps (
        step_id, plan_id, org_id, action_type, step_goal, act_content_hash, grant_status
      ) VALUES (
        ${stepId}, ${planId}, ${defaults.orgId}, ${defaults.actionType},
        ${defaults.declaredGoal}, ${defaults.actHash}, 'approved'
      )
    `;
    return { planId, stepId };
  }

  beforeAll(async () => {
    adminDb = postgres(DATABASE_URL!, { max: 1 });
    await adminDb`CREATE SCHEMA ${adminDb(schemaName)}`;
    scopedDb = postgres(DATABASE_URL!, {
      max: 20,
      connection: { search_path: schemaName },
    });
    claimSql = {
      query: (text: string, params: unknown[] = []) => scopedDb!.unsafe(text, params as never[]),
    } as unknown as SqlTag;

    const [scope] = await scopedDb`SELECT current_schema() AS name`;
    if (scope?.name !== schemaName) throw new Error(`fixture search_path did not select ${schemaName}`);
    await scopedDb.unsafe(`
      CREATE TABLE guard_decisions (
        id text PRIMARY KEY, org_id text NOT NULL, agent_id text, action_type text,
        context text, decision text NOT NULL
      );
      CREATE TABLE action_records (
        action_id text PRIMARY KEY, org_id text NOT NULL, agent_id text NOT NULL,
        action_type text NOT NULL, declared_goal text, act_content_hash text,
        status text DEFAULT 'running', outcome_status text DEFAULT 'pending',
        execution_protocol integer DEFAULT 1, guard_decision_id text,
        execution_claimed_at timestamptz, execution_attempt_id text,
        execution_guard_decision_id text, created_by text,
        identity_verified boolean, approved_by text, approved_at timestamptz,
        approval_grant_used_at timestamptz, parent_action_id text,
        containment_status text, containment_ref text
      );
      CREATE TABLE plan_authorizations (
        plan_id text PRIMARY KEY, org_id text NOT NULL, agent_id text NOT NULL,
        status text NOT NULL, expires_at timestamptz
      );
      CREATE TABLE plan_authorization_steps (
        step_id text PRIMARY KEY, plan_id text NOT NULL, org_id text NOT NULL,
        action_type text NOT NULL, step_goal text NOT NULL, act_content_hash text,
        grant_status text NOT NULL, grant_used_at timestamptz, matched_action_id text
      );
    `);
  }, 30_000);

  afterAll(async () => {
    const errors: Error[] = [];
    try {
      await scopedDb?.end({ timeout: 5 });
    } catch (error) {
      errors.push(new Error('failed to close scoped claim pool', { cause: error }));
    }
    try {
      if (adminDb) await adminDb`DROP SCHEMA IF EXISTS ${adminDb(schemaName)} CASCADE`;
    } catch (error) {
      errors.push(new Error(`failed to drop fixture schema ${schemaName}`, { cause: error }));
    }
    try {
      await adminDb?.end({ timeout: 5 });
    } catch (error) {
      errors.push(new Error('failed to close claim admin pool', { cause: error }));
    }
    if (errors.length > 0) throw new AggregateError(errors, 'execution claim fixture cleanup failed');
  });

  it('allows exactly one of 20 concurrent claims and never reacquires a repeated nonce', async () => {
    const action = await recordAction('concurrent');
    const results = await Promise.all(Array.from({ length: 20 }, () => claim(action)));
    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
    expect(await claim(action, { attemptId: String(winners[0]!.execution_attempt_id) })).toBeNull();
  });

  it('rejects cross-org, agent, act, principal, unverified identity, and legacy protocol claims', async () => {
    const bound = await recordAction('bindings');
    expect(await claim(bound, { orgId: 'org_other' })).toBeNull();
    expect(await claim(bound, { agentId: 'agent_other' })).toBeNull();
    expect(await claim(bound, { actHash: 'hash_other' })).toBeNull();
    expect(await claim(bound, { principalId: 'key_other' })).toBeNull();

    const identityBound = await recordAction('identity', { identityVerified: true });
    expect(await claim(identityBound, { identityVerified: false })).toBeNull();
    expect(await claim(identityBound, { identityVerified: true })).not.toBeNull();

    const legacy = await recordAction('legacy', { executionProtocol: null });
    expect(await claim(legacy)).toBeNull();
  });

  it('keeps operator grants single-use for self and distinct targets and rolls back consumption on target failure', async () => {
    const self = await recordAction('operator_self', { authority: 'self' });
    await approve(self);
    expect(await claim(self)).not.toBeNull();
    expect(await claim(self)).toBeNull();

    const blocked = await recordAction('operator_blocked', { authority: 'self', decision: 'block' });
    await approve(blocked);
    expect(await claim(blocked)).toBeNull();

    const source = await recordAction('operator_source', { decision: 'require_approval' });
    await approve(source);
    const targets = await Promise.all([
      recordAction('operator_target_a', { authority: { kind: 'operator', id: source.actionId } }),
      recordAction('operator_target_b', { authority: { kind: 'operator', id: source.actionId } }),
    ]);
    const results = await Promise.all(targets.map((target) => claim(target)));
    expect(results.filter((result) => result !== null)).toHaveLength(1);

    const rollbackSource = await recordAction('rollback_source', { decision: 'require_approval' });
    await approve(rollbackSource);
    const rollbackTarget = await recordAction('rollback_target', {
      authority: { kind: 'operator', id: rollbackSource.actionId },
    });
    await scopedDb!.unsafe(`
      ALTER TABLE action_records ADD CONSTRAINT reject_failed_attempt
      CHECK (execution_attempt_id IS DISTINCT FROM 'fail-this-attempt')
    `);
    try {
      await expect(claim(rollbackTarget, { attemptId: 'fail-this-attempt' })).rejects.toThrow();
      const [sourceAfterFailure] = await scopedDb!`
        SELECT approval_grant_used_at FROM action_records WHERE action_id = ${rollbackSource.actionId}
      `;
      expect(sourceAfterFailure?.approval_grant_used_at).toBeNull();
      expect(await claim(rollbackTarget)).not.toBeNull();
    } finally {
      await scopedDb!.unsafe('ALTER TABLE action_records DROP CONSTRAINT IF EXISTS reject_failed_attempt');
    }
  });

  it('consumes one live plan step once and rejects expired or revoked plans', async () => {
    const live = await createPlanGrant('live');
    const targets = await Promise.all([
      recordAction('plan_target_a', { authority: { kind: 'plan', id: live.stepId } }),
      recordAction('plan_target_b', { authority: { kind: 'plan', id: live.stepId } }),
    ]);
    const results = await Promise.all(targets.map((target) => claim(target)));
    expect(results.filter((result) => result !== null)).toHaveLength(1);
    const [consumed] = await scopedDb!`
      SELECT grant_used_at, matched_action_id FROM plan_authorization_steps WHERE step_id = ${live.stepId}
    `;
    expect(consumed?.grant_used_at).not.toBeNull();
    expect(targets.map((target) => target.actionId)).toContain(consumed?.matched_action_id);

    const expired = await createPlanGrant('expired', 'approved', new Date(Date.now() - 60_000));
    const expiredTarget = await recordAction('plan_expired', { authority: { kind: 'plan', id: expired.stepId } });
    expect(await claim(expiredTarget)).toBeNull();

    const revoked = await createPlanGrant('revoked', 'revoked');
    const revokedTarget = await recordAction('plan_revoked', { authority: { kind: 'plan', id: revoked.stepId } });
    expect(await claim(revokedTarget)).toBeNull();
    const inactive = await scopedDb!`
      SELECT step_id, grant_used_at FROM plan_authorization_steps
      WHERE step_id IN (${expired.stepId}, ${revoked.stepId})
    `;
    expect(inactive).toHaveLength(2);
    expect(inactive.every((step) => step.grant_used_at === null)).toBe(true);
  });

  it('rejects a fresh containment requirement for a direct action and accepts the original containment target', async () => {
    const direct = await recordAction('direct_allow');
    const freshContained = await addDecision(direct, {
      decision: 'allow_contained',
      decisionContainmentRef: 'dashclaw/contained-fresh',
    });
    expect(await claim(freshContained)).toBeNull();

    const contained = await recordAction('contained_original', {
      decision: 'allow_contained',
      decisionContainmentRef: 'dashclaw/contained-original',
      containmentStatus: 'contained',
      containmentRef: 'dashclaw/contained-original',
    });
    expect(await claim(contained)).not.toBeNull();
  });
});
