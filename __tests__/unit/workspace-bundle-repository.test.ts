import { describe, expect, it, vi } from 'vitest';
import {
  BUNDLE_TABLES,
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  MAX_BUNDLE_ROWS,
  exportedColumns,
  exportWorkspaceBundle,
  stampTrialExported,
  importWorkspaceBundle,
  BundleValidationError,
} from '@/lib/repositories/workspace-bundle.repository';
import type { SqlTag } from '@/lib/types/db';

// v7.2 graduation path. The classification test pins the exact exported
// column set per table: adding a column to schema/schema.js makes it fail
// until the new column is consciously exported or denied — the deny-list
// can't rot silently (spec decision 1).

const PINNED_EXPORTS: Record<string, string[]> = {
  guard_policies: ['id', 'name', 'policy_type', 'rules', 'active', 'agent_ids', 'created_by', 'created_at', 'updated_at'],
  // idempotency_key is EXPORTED consciously: a client retry identifier, the
  // same class as action_records.idempotency_key below (already exported) —
  // not credential-shaped, and replay lookups additionally bind on org_id +
  // a 10-minute window, so imported history cannot satisfy a live replay.
  guard_decisions: ['id', 'agent_id', 'agent_name', 'verification_status', 'replay_status', 'act_status', 'act_hash', 'decision', 'reason', 'matched_policies', 'context', 'evidence', 'risk_score', 'action_type', 'idempotency_key', 'created_at', 'degraded'],
  // signature/verified are DENIED: they attest to the source instance's
  // signing key and must never present as natively verified after import.
  // containment_ref is DENIED: it names a git worktree branch local to the
  // exporting instance's filesystem. containment_status/resolved_by/
  // resolved_at are durable governance facts and ARE exported (same class
  // as outcome_status/created_by, already exported below).
  // enforcement_mode/executed_despite (v5.7.0, F0) are EXPORTED consciously:
  // durable governance facts about whether a verdict was enforced — exactly
  // the honesty record an exported ledger must keep (same class as
  // containment_status). Neither is credential-shaped or instance-local.
  action_records: ['action_id', 'agent_id', 'agent_name', 'swarm_id', 'parent_action_id', 'action_type', 'declared_goal', 'reasoning', 'authorization_scope', 'trigger', 'systems_touched', 'input_summary', 'status', 'reversible', 'risk_score', 'confidence', 'recommendation_id', 'recommendation_applied', 'recommendation_override_reason', 'output_summary', 'side_effects', 'artifacts_created', 'error_message', 'timestamp_start', 'timestamp_end', 'duration_ms', 'cost_estimate', 'tokens_in', 'tokens_out', 'model', 'approved_by', 'approved_at', 'created_by', 'approval_grant_used_at', 'act_content_hash', 'approval_expires_at', 'outcome_status', 'outcome_at', 'outcome_summary', 'outcome_error', 'outcome_progress', 'idempotency_key', 'session_id', 'guard_decision_id', 'close_source', 'containment_status', 'containment_resolved_by', 'containment_resolved_at', 'harness_session_id', 'subagent_uuid', 'enforcement_mode', 'executed_despite', 'created_at', 'updated_at'],
  open_loops: ['loop_id', 'action_id', 'loop_type', 'description', 'status', 'priority', 'owner', 'resolution', 'created_at', 'resolved_at'],
  assumptions: ['assumption_id', 'action_id', 'assumption', 'basis', 'validated', 'validated_at', 'invalidated', 'invalidated_reason', 'invalidated_at', 'created_at'],
  agent_identities: ['agent_id', 'public_key', 'algorithm', 'created_at', 'updated_at'],
};

/** Names that must never appear in any exported column list, by class. */
const FORBIDDEN_EVERYWHERE = ['org_id', 'jti', 'key_hash', 'value_encrypted', 'private_jwk', 'token_hash', 'code_hash'];

describe('bundle column classification', () => {
  it.each(BUNDLE_TABLES.map((s) => [s.name, s] as const))(
    '"%s" exports exactly the pinned column set',
    (name, spec) => {
      expect(exportedColumns(spec)).toEqual(PINNED_EXPORTS[name]);
    },
  );

  it('no exported table carries a credential-shaped or instance-local column', () => {
    for (const spec of BUNDLE_TABLES) {
      const cols = exportedColumns(spec);
      for (const bad of FORBIDDEN_EVERYWHERE) expect(cols).not.toContain(bad);
    }
  });

  it('credential tables are not bundle tables at all', () => {
    const names = BUNDLE_TABLES.map((s) => s.name);
    for (const forbidden of ['api_keys', 'governed_secrets', 'oauth_access_tokens', 'server_signing_keys']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

type Call = { text: string; params?: unknown[] };
function makeSql(responder: (text: string, params?: unknown[]) => unknown[]): { sql: SqlTag; calls: Call[] } {
  const calls: Call[] = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    return responder(text, params);
  });
  return { sql: { query } as unknown as SqlTag, calls };
}

describe('exportWorkspaceBundle', () => {
  it('returns a versioned bundle with per-table org-scoped rows and counts', async () => {
    const { sql, calls } = makeSql((text) => {
      if (text.includes('FROM organizations')) return [{ id: 'org_a', name: 'Acme' }];
      if (text.includes('FROM guard_policies')) return [{ id: 'gp_1', name: 'p' }];
      return [];
    });
    const bundle = await exportWorkspaceBundle(sql, 'org_a');
    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(bundle.org).toEqual({ id: 'org_a', name: 'Acme' });
    expect(bundle.counts.guard_policies).toBe(1);
    expect(bundle.counts.action_records).toBe(0);
    expect(bundle.tables.guard_policies).toEqual([{ id: 'gp_1', name: 'p' }]);
    // Every table SELECT is org-scoped and never SELECT *.
    for (const call of calls.filter((c) => !c.text.includes('FROM organizations'))) {
      expect(call.text).toContain('WHERE org_id = $1');
      expect(call.text).not.toContain('SELECT *');
      expect(call.params).toEqual(['org_a']);
    }
  });

  it('throws on unknown org', async () => {
    const { sql } = makeSql(() => []);
    await expect(exportWorkspaceBundle(sql, 'org_missing')).rejects.toThrow('org not found');
  });
});

describe('stampTrialExported', () => {
  it('stamps hosted trials idempotently (earliest wins) and skips non-hosted orgs', async () => {
    const { sql, calls } = makeSql(() => [{ trial_exported_at: '2026-07-05' }]);
    expect(await stampTrialExported(sql, 'org_a')).toBe(true);
    expect(calls[0]!.text).toContain('COALESCE(trial_exported_at, NOW())');
    expect(calls[0]!.text).toContain('hosted_mode = TRUE');

    const notHosted = makeSql(() => []);
    expect(await stampTrialExported(notHosted.sql, 'org_b')).toBe(false);
  });
});

const emptyBundle = (tables: Record<string, unknown[]> = {}) => ({
  format: BUNDLE_FORMAT,
  version: BUNDLE_VERSION,
  exported_at: '2026-07-05T00:00:00.000Z',
  org: { id: 'org_src', name: 'src' },
  counts: {},
  tables,
});

describe('importWorkspaceBundle validation', () => {
  const { sql } = makeSql(() => []);

  it('rejects non-objects, wrong format, and wrong version', async () => {
    await expect(importWorkspaceBundle(sql, 'org_t', null)).rejects.toThrow(BundleValidationError);
    await expect(importWorkspaceBundle(sql, 'org_t', { ...emptyBundle(), format: 'nope' })).rejects.toThrow(/format/);
    await expect(importWorkspaceBundle(sql, 'org_t', { ...emptyBundle(), version: 99 })).rejects.toThrow(/version/);
  });

  it('rejects a non-array table and oversized bundles', async () => {
    await expect(
      importWorkspaceBundle(sql, 'org_t', emptyBundle({ guard_policies: 'x' as unknown as unknown[] })),
    ).rejects.toThrow(/must be an array/);
    const rows = new Array(MAX_BUNDLE_ROWS + 1).fill({ id: 'gp' });
    await expect(importWorkspaceBundle(sql, 'org_t', emptyBundle({ guard_policies: rows }))).rejects.toThrow(/rows/);
  });
});

describe('importWorkspaceBundle inserts', () => {
  it('global-unique tables use ON CONFLICT DO NOTHING; imported vs skipped follows RETURNING', async () => {
    let first = true;
    const { sql, calls } = makeSql(() => {
      const rows = first ? [1] : [];
      first = false;
      return rows as unknown[];
    });
    const { counts } = await importWorkspaceBundle(sql, 'org_t', emptyBundle({
      guard_policies: [
        { id: 'gp_1', name: 'a', policy_type: 't', rules: '{}' },
        { id: 'gp_1', name: 'a', policy_type: 't', rules: '{}' },
      ],
    }));
    expect(counts.guard_policies).toEqual({ imported: 1, skipped: 1 });
    expect(calls[0]!.text).toContain('ON CONFLICT (id) DO NOTHING');
    expect(calls[0]!.params?.[0]).toBe('org_t'); // re-scoped to the TARGET org
  });

  it('guard_policies also guards on the org-scoped name — a same-name policy under a foreign id is skipped, not a 23505', async () => {
    // Regression (2026-07-07 hosted drill): the trial's default pack rides the
    // bundle with fresh UUIDs but the SAME names the target org already has;
    // ON CONFLICT (id) never fires and the insert died on
    // guard_policies_org_name_unique. The insert must carry a NOT EXISTS on
    // (org_id, name) alongside the id conflict target.
    const { sql, calls } = makeSql(() => []); // no row returned = skipped by NOT EXISTS
    const { counts } = await importWorkspaceBundle(sql, 'org_t', emptyBundle({
      guard_policies: [{ id: 'gp_foreign', name: 'Block Mass-Destructive Operations', policy_type: 't', rules: '{}' }],
    }));
    expect(counts.guard_policies).toEqual({ imported: 0, skipped: 1 });
    expect(calls[0]!.text).toContain('ON CONFLICT (id) DO NOTHING');
    expect(calls[0]!.text).toMatch(/WHERE NOT EXISTS[\s\S]*org_id = \$1 AND "name" = \$\d+/);
    expect(calls[0]!.params?.at(-1)).toBe('Block Mass-Destructive Operations');
  });

  it('serial-PK tables fall back to org-scoped WHERE NOT EXISTS on the dedupe key', async () => {
    const { sql, calls } = makeSql(() => [1]);
    const { counts } = await importWorkspaceBundle(sql, 'org_t', emptyBundle({
      open_loops: [{ loop_id: 'loop_1', action_id: 'act_1', loop_type: 'followup', description: 'd' }],
    }));
    expect(counts.open_loops).toEqual({ imported: 1, skipped: 0 });
    expect(calls[0]!.text).toContain('WHERE NOT EXISTS');
    expect(calls[0]!.text).toContain('org_id = $1 AND "loop_id" = $2');
    expect(calls[0]!.params?.slice(0, 2)).toEqual(['org_t', 'loop_1']);
  });

  it('rows missing their dedupe key are skipped, never inserted', async () => {
    const { sql, calls } = makeSql(() => [1]);
    const { counts } = await importWorkspaceBundle(sql, 'org_t', emptyBundle({
      action_records: [{ declared_goal: 'no action_id' }],
    }));
    expect(counts.action_records).toEqual({ imported: 0, skipped: 1 });
    expect(calls).toHaveLength(0);
  });

  it('unknown row keys are dropped — only schema-classified columns are inserted', async () => {
    const { sql, calls } = makeSql(() => [1]);
    await importWorkspaceBundle(sql, 'org_t', emptyBundle({
      agent_identities: [{ agent_id: 'ag_1', public_key: 'pk', evil_column: 'x' }],
    }));
    expect(calls[0]!.text).not.toContain('evil_column');
    expect(calls[0]!.text).toContain('ON CONFLICT (org_id, agent_id) DO NOTHING');
  });
});
