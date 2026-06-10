/**
 * Behavior-sample source selector. The Policy Coach analyzes whichever source
 * has data:
 *
 *  - 'local'    — the JSONL files the recorder writes on THIS machine. Always
 *                 preferred when it returns >0 samples (richer evidence: real
 *                 paths, not hashes). NOTE: the local-file path is
 *                 machine-global BY NATURE — the filesystem has no org axis, so
 *                 whoever runs this server sees the same files regardless of
 *                 API key. That is the pre-existing local trust model.
 *  - 'uploaded' — the org-scoped behavior_samples/behavior_dismissals tables
 *                 fed by the opt-in anonymized upload (BEHAVIOR_UPLOAD_ENABLED).
 *                 Every DB read here is scoped to the CALLER's org — this path
 *                 must never leak behavior across workspaces.
 *
 * Routes surface the choice as `sample_source` so the UI can show provenance.
 */

import { readSamples, readDismissals, writeDismissal } from './sample-store';
import {
  listBehaviorSamples,
  listBehaviorDismissals,
  upsertBehaviorDismissal,
} from '../repositories/behavior.repository';
import type { SqlTag } from '../types/db';

export type SampleSource = 'local' | 'uploaded';

export interface LoadedSamples {
  samples: Record<string, unknown>[];
  dismissals: Record<string, unknown>[];
  source: SampleSource;
}

/**
 * Load samples + dismissals from the preferred source: local files when they
 * hold any samples, else the org-scoped uploaded tables. Dismissals always
 * come from the SAME source as the samples so suppression stays consistent.
 */
export async function loadBehaviorSamples(
  sql: SqlTag,
  orgId: string,
  { limit }: { limit?: number } = {}
): Promise<LoadedSamples> {
  const local = await readSamples(limit ? { limit } : {});
  if (local.length > 0) {
    return { samples: local, dismissals: await readDismissals(), source: 'local' };
  }
  const [samples, dismissals] = await Promise.all([
    listBehaviorSamples(sql, orgId, limit ? { limit } : {}),
    listBehaviorDismissals(sql, orgId),
  ]);
  return { samples, dismissals, source: 'uploaded' };
}

/**
 * Record a dismissal/accepted-advisory against the source the suggestion was
 * derived from: the local .dismissals.json for local samples, the org-scoped
 * behavior_dismissals table for uploaded ones.
 */
export async function recordBehaviorDismissal(
  sql: SqlTag,
  orgId: string,
  source: SampleSource,
  record: Record<string, unknown>
): Promise<void> {
  if (source === 'local') {
    await writeDismissal(record);
    return;
  }
  await upsertBehaviorDismissal(sql, orgId, record);
}
