#!/usr/bin/env node

import postgres from 'postgres';
import { assertDisposableRestoreTarget, evaluateRecoverySnapshot } from '../lib/recovery-drill.mjs';
import { verifyReceipt } from '../../app/lib/integrity/receipt.ts';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function secondsBetween(later, earlier, label) {
  const a = Date.parse(later);
  const b = Date.parse(earlier);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < b) throw new Error(`${label} timestamps are invalid or reversed`);
  return Math.round((a - b) / 1000);
}

function publicJwk(row) {
  return typeof row.public_jwk === 'string' ? JSON.parse(row.public_jwk) : row.public_jwk;
}

function verifyHistoricalRows(evidenceRows, keyRows) {
  const byKid = new Map(keyRows.map((row) => [row.kid, row]));
  return evidenceRows.flatMap((row) => {
    let evidence;
    try {
      evidence = typeof row.evidence === 'string' ? JSON.parse(row.evidence) : row.evidence;
    } catch {
      return [{ decision_id: row.decision_id, verified: false, reason: 'malformed evidence' }];
    }
    const entries = Array.isArray(evidence) ? evidence : [evidence];
    return entries.map((entry) => {
      try {
        const receipt = entry?.receipt;
        const kid = receipt?.signature?.kid;
        const key = byKid.get(kid);
        if (!key) return { decision_id: row.decision_id, kid, verified: false, reason: 'public key unavailable' };
        if (key.status === 'compromised') {
          return {
            decision_id: row.decision_id,
            kid,
            verified: false,
            reason: 'key marked compromised; issuance time requires external corroboration',
          };
        }
        const result = verifyReceipt(receipt, publicJwk(key));
        return {
          decision_id: row.decision_id,
          kid,
          verified: result.ok,
          ...(result.ok ? {} : { reason: result.reason || 'signature invalid' }),
        };
      } catch {
        return { decision_id: row.decision_id, verified: false, reason: 'malformed evidence' };
      }
    });
  });
}

async function main() {
  const targetUrl = requiredEnv('RECOVERY_DRILL_DATABASE_URL');
  const sourceUrl = requiredEnv('RECOVERY_SOURCE_DATABASE_URL');
  const environment = requiredEnv('RECOVERY_DRILL_ENVIRONMENT');
  assertDisposableRestoreTarget(targetUrl, sourceUrl, environment);

  const incidentAt = requiredEnv('RECOVERY_INCIDENT_AT');
  const snapshotAt = requiredEnv('RECOVERY_SOURCE_SNAPSHOT_AT');
  const restoreStartedAt = requiredEnv('RECOVERY_RESTORE_STARTED_AT');
  const rpoSeconds = Number(requiredEnv('RECOVERY_RPO_OBJECTIVE_SECONDS'));
  const rtoSeconds = Number(requiredEnv('RECOVERY_RTO_OBJECTIVE_SECONDS'));

  const sql = postgres(targetUrl, { max: 1, connect_timeout: 15, idle_timeout: 5 });
  try {
    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM action_records) AS actions,
        (SELECT COUNT(*)::int FROM action_records WHERE status = 'pending_approval') AS pending_approvals,
        (SELECT COUNT(*)::int FROM server_signing_keys) AS signing_keys,
        (SELECT COUNT(*)::int FROM webhooks) AS webhooks
    `;
    const outstandingClaims = await sql`
      SELECT action_id, status, updated_at, COUNT(*) OVER () AS outstanding_total
      FROM action_records
      WHERE status IN ('pending_approval', 'running')
      ORDER BY updated_at DESC
      LIMIT 100
    `;
    const evidenceRows = await sql`
      SELECT id AS decision_id, evidence
      FROM guard_decisions
      WHERE evidence IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 100
    `;
    const keyRows = await sql`
      SELECT kid, public_jwk, status, retired_at, compromised_at
      FROM server_signing_keys
      ORDER BY created_at DESC
    `;

    const result = evaluateRecoverySnapshot({
      counts: {
        actions: Number(counts?.actions || 0),
        pendingApprovals: Number(counts?.pending_approvals || 0),
        signingKeys: Number(counts?.signing_keys || 0),
        webhooks: Number(counts?.webhooks || 0),
      },
      outstandingClaims: outstandingClaims.map(({ outstanding_total, ...row }) => row),
      outstandingClaimCount: Number(outstandingClaims[0]?.outstanding_total || 0),
      historicalVerification: verifyHistoricalRows(evidenceRows, keyRows),
      measuredRpoSeconds: secondsBetween(incidentAt, snapshotAt, 'RPO'),
      measuredRtoSeconds: secondsBetween(new Date().toISOString(), restoreStartedAt, 'RTO'),
      objectives: { rpoSeconds, rtoSeconds },
    });

    console.log(`RECOVERY_DRILL ${JSON.stringify(result)}`);
    process.exitCode = result.status === 'pass' ? 0 : 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(`[recovery-drill] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
