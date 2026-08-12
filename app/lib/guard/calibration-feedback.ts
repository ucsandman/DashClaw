/**
 * Calibration feedback ingestion — the off-hot-path half of the calibrated
 * interruption controller. Called by the approval-resolution routes after a
 * human adjudicates a require_approval interruption:
 *
 *   approved → label 'benign'    (the interruption was, in hindsight, unnecessary)
 *   denied   → label 'dangerous' (the interruption was justified)
 *
 * Expired approvals produce NO label (the human never rendered a verdict) —
 * the selective-labeling boundary is explicit here, not assumed away.
 *
 * Ingestion runs regardless of controller mode ('off' means "don't assess on
 * the guard hot path", not "don't learn") so flipping shadow on starts from
 * real history instead of cold. Always best-effort: a calibration failure
 * must never fail the approval itself.
 */

import { baseAgentId } from '../agent-identity-resolve';
import type { GuardSql } from './types';
import { applyAdjudication, parseCalibrationSettings } from './calibration';
import type { AdjudicationOutcome } from './calibration';
import { invalidateGuardCalibrationCache } from './caches';
import {
  getCalibrationState,
  saveCalibrationState,
  insertCalibrationEvent,
  insertCalibrationEvents,
} from '../repositories/calibration-state.repository';
import type { CalibrationEventInsert } from '../repositories/calibration-state.repository';
import { freshCalibrationState } from './calibration';

export interface ApprovalAdjudication {
  actionId: string;
  agentId: string | null;
  /** The persisted action_records.risk_score of the interrupted action. */
  riskScore: number;
  approved: boolean;
  source: 'approval' | 'bulk_approval' | 'seed';
}

/**
 * Bound on the read-modify-write retry below. Two writers landing in the
 * same instant is the case this exists for; five losses in a row would mean
 * sustained contention far beyond that, so give up rather than spin.
 */
const MAX_CAS_ATTEMPTS = 5;

/**
 * Consume one resolved approval into the controller state. Returns the
 * outcome for logging, or null when ingestion failed (never throws).
 *
 * Read-modify-write against saveCalibrationState's optimistic CAS: two
 * approvals resolved a few hundred ms apart both read theta, fold their own
 * adjudication, and used to blind-overwrite — the second write silently
 * erased the first's fold. On a lost race, re-read the (now newer) state and
 * re-fold this adjudication on top of it, rather than retrying the stale
 * write, up to MAX_CAS_ATTEMPTS.
 */
export async function ingestApprovalAdjudication(
  sql: GuardSql,
  orgId: string,
  input: ApprovalAdjudication,
): Promise<AdjudicationOutcome | null> {
  try {
    const { getSettings } = await import('../repositories/settings.repository');
    const settingRows = (await getSettings(sql, orgId, { category: 'general' })) as Array<{ key?: unknown; value?: unknown }>;
    const settings = parseCalibrationSettings(settingRows);
    // Bind the e-process to the identity FAMILY (composed sub-agent ids fold
    // into their base), matching the budget/policy-scope precedent.
    const family = input.agentId ? (baseAgentId(input.agentId) ?? input.agentId) : null;

    let outcome: AdjudicationOutcome | null = null;
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const stateBefore = await getCalibrationState(sql, orgId);
      const state = stateBefore ?? freshCalibrationState();
      outcome = applyAdjudication(
        state,
        {
          riskScore: input.riskScore,
          label: input.approved ? 'benign' : 'dangerous',
          agentId: family,
        },
        settings,
        new Date().toISOString(),
      );
      const written = await saveCalibrationState(sql, orgId, outcome.state, stateBefore);
      if (written !== false) break;
      outcome = null; // lost the race — loop re-reads and re-folds
    }
    if (!outcome) {
      console.warn('[Calibration] adjudication dropped — CAS retry limit hit:', { org_id: orgId, agent_id: family, action_id: input.actionId });
      return null;
    }

    await insertCalibrationEvent(sql, orgId, {
      actionId: input.actionId,
      agentId: family,
      riskScore: input.riskScore,
      thetaBefore: outcome.thetaBefore,
      thetaAfter: outcome.thetaAfter,
      label: input.approved ? 'benign' : 'dangerous',
      loss: outcome.loss,
      source: input.source,
    });
    invalidateGuardCalibrationCache(orgId);
    if (outcome.alarmFired) {
      console.warn('[Calibration] agent e-process alarm fired:', { org_id: orgId, agent_id: family, action_id: input.actionId });
    }
    return outcome;
  } catch (err) {
    console.warn('[Calibration] adjudication ingest failed (approval unaffected):', (err as Error)?.message || err);
    return null;
  }
}

/**
 * Batch variant for bulk approval floods: one settings read, one state
 * read/write, chunked event inserts. Adjudications fold in arrival order, so
 * the resulting state is identical to ingesting them one at a time.
 *
 * Same CAS guard as the single path: if the write loses the race against a
 * concurrent writer (e.g. a lone /approvals resolution folding in between),
 * re-read the fresh state and re-fold the WHOLE batch on top of it — a plain
 * retry of the stale fold would reintroduce the lost-update bug — up to
 * MAX_CAS_ATTEMPTS.
 */
export async function ingestApprovalAdjudicationBatch(
  sql: GuardSql,
  orgId: string,
  inputs: ApprovalAdjudication[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  try {
    const { getSettings } = await import('../repositories/settings.repository');
    const settingRows = (await getSettings(sql, orgId, { category: 'general' })) as Array<{ key?: unknown; value?: unknown }>;
    const settings = parseCalibrationSettings(settingRows);
    const nowIso = new Date().toISOString();

    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const stateBefore = await getCalibrationState(sql, orgId);
      let state = stateBefore ?? freshCalibrationState();
      const events: CalibrationEventInsert[] = [];
      for (const input of inputs) {
        const family = input.agentId ? (baseAgentId(input.agentId) ?? input.agentId) : null;
        const outcome = applyAdjudication(
          state,
          { riskScore: input.riskScore, label: input.approved ? 'benign' : 'dangerous', agentId: family },
          settings,
          nowIso,
        );
        state = outcome.state;
        events.push({
          actionId: input.actionId,
          agentId: family,
          riskScore: input.riskScore,
          thetaBefore: outcome.thetaBefore,
          thetaAfter: outcome.thetaAfter,
          label: input.approved ? 'benign' : 'dangerous',
          loss: outcome.loss,
          source: input.source,
        });
      }
      const written = await saveCalibrationState(sql, orgId, state, stateBefore);
      if (written === false) continue; // lost the race — re-read and re-fold the batch
      await insertCalibrationEvents(sql, orgId, events);
      invalidateGuardCalibrationCache(orgId);
      return events.length;
    }
    console.warn('[Calibration] batch adjudication dropped — CAS retry limit hit:', { org_id: orgId, count: inputs.length });
    return 0;
  } catch (err) {
    console.warn('[Calibration] batch adjudication ingest failed (approvals unaffected):', (err as Error)?.message || err);
    return 0;
  }
}
