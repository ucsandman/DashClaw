/**
 * Regression coverage for the calibration state lost-update bug: concurrent
 * ingestApprovalAdjudication calls used to read-modify-blind-write the whole
 * controller state document, so a second write in flight a few hundred ms
 * behind the first silently erased the first's fold (no error, no trace).
 *
 * saveCalibrationState now supports optimistic CAS (compare-and-swap against
 * the state last read; app/lib/repositories/calibration-state.repository.ts)
 * and calibration-feedback.ts retries — re-reading and re-folding, not just
 * re-writing the stale value — on a lost race, bounded by MAX_CAS_ATTEMPTS.
 *
 * This suite runs the REAL repository against an in-memory fake Postgres
 * (not a mock of the repository itself) so the CAS SQL shape is exercised,
 * plus a real concurrency race via a two-reader gate.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GuardSql } from '../../app/lib/guard/types';

// settings.repository runs for real against the fake db below (an empty
// `settings` table, matching a fresh org) rather than being mocked — the
// real getSettings() call is made via a dynamic `import()` inside the two
// functions under test, and mocking that import proved to race unreliably
// against the deliberately-concurrent calls this suite makes.
import {
  ingestApprovalAdjudication,
  ingestApprovalAdjudicationBatch,
} from '../../app/lib/guard/calibration-feedback';
import { getCalibrationState } from '../../app/lib/repositories/calibration-state.repository';
import { freshCalibrationState } from '../../app/lib/guard/calibration';
import type { CalibrationState } from '../../app/lib/guard/calibration';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fake of guard_calibration_state / guard_calibration_events —
// implements the actual query shapes the repository sends (SELECT, the two
// INSERT..ON CONFLICT variants, and the CAS UPDATE..WHERE state = ..RETURNING)
// so the test exercises the real jsonb-equality CAS logic, not a stub of it.
// ─────────────────────────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).sort();
  const bk = Object.keys(bo).sort();
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) => deepEqual(ao[k], bo[k]));
}

function makeFakeDb(opts: { gateSize?: number } = {}) {
  const table = new Map<string, CalibrationState>();
  const events: Record<string, unknown>[] = [];
  let writeCount = 0;
  let jamCas = false; // when true, every CAS write reports "lost the race"

  // N-reader gate: holds the first `gateSize` SELECTs until all have arrived,
  // then releases them together — the exact window the original bug needed
  // (every handler reads the same pre-write state before any writes back).
  // gateSize 1 (default) means "no artificial concurrency" — required for
  // the single-caller retry-bound tests below, where a real gate would
  // deadlock (a lone caller's own retries never supply a second reader).
  const gateSize = opts.gateSize ?? 1;
  let waiting: Array<() => void> = [];
  let armed = gateSize > 1;

  function text(strings: TemplateStringsArray): string {
    return strings.join(' | ');
  }

  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const t = text(strings);
    if (t.includes('CREATE TABLE') || t.includes('CREATE INDEX')) return [];
    if (t.includes('FROM settings')) return []; // no settings rows — mode 'off', default target rate

    if (t.includes('SELECT state FROM guard_calibration_state')) {
      const [orgId] = values as [string];
      const read = () => {
        const row = table.get(orgId);
        return row ? [{ state: row }] : [];
      };
      if (!armed) return read();
      return new Promise((resolve) => {
        waiting.push(() => resolve(read()));
        if (waiting.length === gateSize) {
          armed = false;
          const towake = waiting;
          waiting = [];
          towake.forEach((fn) => fn());
        }
      });
    }

    if (t.includes('INSERT INTO guard_calibration_state')) {
      const [orgId, stateJson] = values as [string, string];
      writeCount++;
      if (t.includes('DO NOTHING')) {
        if (jamCas || table.has(orgId)) return []; // conflict — CAS miss
        table.set(orgId, JSON.parse(stateJson));
        return [{ org_id: orgId }];
      }
      // Blind upsert (no expectedPrevState passed) — always lands.
      table.set(orgId, JSON.parse(stateJson));
      return [];
    }

    if (t.includes('UPDATE guard_calibration_state')) {
      const [stateJson, orgId, expectedJson] = values as [string, string, string];
      writeCount++;
      if (jamCas) return []; // simulate permanent contention
      const current = table.get(orgId);
      const expected = JSON.parse(expectedJson);
      if (current && deepEqual(current, expected)) {
        table.set(orgId, JSON.parse(stateJson));
        return [{ org_id: orgId }];
      }
      return []; // CAS miss — row moved since it was read
    }

    if (t.includes('INSERT INTO guard_calibration_events')) {
      const [org_id, action_id, agent_id, risk_score, theta_before, theta_after, label, loss, source] = values;
      events.push({ org_id, action_id, agent_id, risk_score, theta_before, theta_after, label, loss, source });
      return [];
    }

    throw new Error(`fake sql: unhandled query — ${t}`);
  }) as unknown as GuardSql;

  sql.query = (async (queryText: string, params?: unknown[]) => {
    if (queryText.includes('INSERT INTO guard_calibration_events')) {
      const p = params ?? [];
      for (let i = 0; i < p.length; i += 9) {
        const [org_id, action_id, agent_id, risk_score, theta_before, theta_after, label, loss, source] = p.slice(i, i + 9);
        events.push({ org_id, action_id, agent_id, risk_score, theta_before, theta_after, label, loss, source });
      }
      return [];
    }
    throw new Error(`fake sql.query: unhandled query — ${queryText}`);
  }) as GuardSql['query'];

  return {
    sql,
    seed: (orgId: string, state: CalibrationState) => table.set(orgId, state),
    finalState: (orgId: string) => table.get(orgId) ?? null,
    events,
    writeCount: () => writeCount,
    setJam: (v: boolean) => { jamCas = v; },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('concurrent ingestApprovalAdjudication — CAS lost-update fix', () => {
  it('two concurrent adjudications from the same starting state both land', async () => {
    const db = makeFakeDb({ gateSize: 2 });
    db.seed('org_race', freshCalibrationState());

    const [outA, outB] = await Promise.all([
      ingestApprovalAdjudication(db.sql, 'org_race', {
        actionId: 'ar_a', agentId: 'agent_a', riskScore: 85, approved: true, source: 'approval',
      }),
      ingestApprovalAdjudication(db.sql, 'org_race', {
        actionId: 'ar_b', agentId: 'agent_b', riskScore: 85, approved: false, source: 'approval',
      }),
    ]);

    // Neither adjudication was silently dropped by the second writer's
    // blind overwrite — both callers observe a successful outcome.
    expect(outA).not.toBeNull();
    expect(outB).not.toBeNull();

    const final = await getCalibrationState(db.sql, 'org_race');
    expect(final).not.toBeNull();
    // The bug: labeledTotal would be 1 (whichever write landed last), not 2.
    expect(final!.labeledTotal).toBe(2);
    expect(final!.labeledBenign).toBe(1);
    expect(final!.labeledDenied).toBe(1);
    // Both agents' e-process entries survived the fold (proof the loser's
    // retry re-read and re-applied on top of the winner's write, rather
    // than re-submitting its own stale computation).
    expect(final!.agents['agent_a']).toBeTruthy();
    expect(final!.agents['agent_b']).toBeTruthy();
  });

  it('the loser retries by re-reading and re-folding — a naive resubmit-the-stale-write retry would drop it', async () => {
    // A retry that just resends the SAME precomputed outcome (instead of
    // re-reading current state and re-running applyAdjudication on top of
    // it) can never satisfy the CAS check once the winner has written —
    // its `expectedPrevState` is permanently stale, so it would exhaust
    // MAX_CAS_ATTEMPTS and return null. The audit ledger (guard_calibration_
    // events) is the other place a silent drop would show up: both
    // adjudications must be persisted, not just the winner's.
    const db = makeFakeDb({ gateSize: 2 });
    db.seed('org_race2', freshCalibrationState());

    const [outA, outB] = await Promise.all([
      ingestApprovalAdjudication(db.sql, 'org_race2', {
        actionId: 'ar_a', agentId: null, riskScore: 85, approved: true, source: 'approval',
      }),
      ingestApprovalAdjudication(db.sql, 'org_race2', {
        actionId: 'ar_b', agentId: null, riskScore: 85, approved: false, source: 'approval',
      }),
    ]);

    expect(outA).not.toBeNull();
    expect(outB).not.toBeNull();

    const final = await getCalibrationState(db.sql, 'org_race2');
    expect(final!.labeledTotal).toBe(2);
    expect(final!.lossSum).toBe(1); // one false interruption (the benign-at-θ approval)

    const ids = db.events.map((e) => e.action_id).sort();
    expect(ids).toEqual(['ar_a', 'ar_b']);
  });
});

describe('ingestApprovalAdjudicationBatch — CAS lost-update fix', () => {
  it('a concurrent single ingest and a batch both land against the same starting state', async () => {
    const db = makeFakeDb({ gateSize: 2 });
    db.seed('org_race3', freshCalibrationState());

    const [single, batchCount] = await Promise.all([
      ingestApprovalAdjudication(db.sql, 'org_race3', {
        actionId: 'ar_solo', agentId: 'agent_x', riskScore: 90, approved: true, source: 'approval',
      }),
      ingestApprovalAdjudicationBatch(db.sql, 'org_race3', [
        { actionId: 'ar_bulk1', agentId: 'agent_y', riskScore: 60, approved: false, source: 'bulk_approval' },
        { actionId: 'ar_bulk2', agentId: 'agent_y', riskScore: 60, approved: false, source: 'bulk_approval' },
      ]),
    ]);

    expect(single).not.toBeNull();
    expect(batchCount).toBe(2);

    const final = await getCalibrationState(db.sql, 'org_race3');
    // 1 (solo) + 2 (bulk) = 3 adjudications folded — none lost to the race.
    expect(final!.labeledTotal).toBe(3);
    expect(final!.agents['agent_x']).toBeTruthy();
    expect(final!.agents['agent_y']).toBeTruthy();
    expect(final!.agents['agent_y']!.n).toBe(2);
  });
});

describe('CAS retry bound', () => {
  it('gives up after MAX_CAS_ATTEMPTS instead of retrying forever, and logs the drop', async () => {
    const db = makeFakeDb();
    db.seed('org_jammed', freshCalibrationState());
    db.setJam(true); // every CAS write reports a lost race, forever

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const out = await ingestApprovalAdjudication(db.sql, 'org_jammed', {
      actionId: 'ar_stuck', agentId: 'agent_z', riskScore: 85, approved: true, source: 'approval',
    });

    expect(out).toBeNull();
    // 5 attempts (MAX_CAS_ATTEMPTS) — bounded, not an infinite spin.
    expect(db.writeCount()).toBe(5);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CAS retry limit'),
      expect.objectContaining({ action_id: 'ar_stuck' }),
    );
    // State was never mutated — the drop is visible, not silent.
    expect(db.finalState('org_jammed')).toEqual(freshCalibrationState());
  });

  it('the batch path also gives up after MAX_CAS_ATTEMPTS and logs the drop', async () => {
    const db = makeFakeDb();
    db.seed('org_jammed2', freshCalibrationState());
    db.setJam(true);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const n = await ingestApprovalAdjudicationBatch(db.sql, 'org_jammed2', [
      { actionId: 'ar_b1', agentId: null, riskScore: 85, approved: true, source: 'bulk_approval' },
    ]);

    expect(n).toBe(0);
    expect(db.writeCount()).toBe(5);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CAS retry limit'),
      expect.objectContaining({ org_id: 'org_jammed2' }),
    );
  });
});
