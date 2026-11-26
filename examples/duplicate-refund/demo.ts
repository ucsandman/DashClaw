import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GuardSql, PolicyRow } from '../../app/lib/guard/types';

const policyId = 'demo_no_second_refund';
const refundedPrefix = '/demo-store/refunded';
const policy: PolicyRow = {
  id: policyId,
  name: 'Order already refunded',
  policy_type: 'block_action_type',
  rules: JSON.stringify({ action_types: ['refund'], target_prefix: refundedPrefix }),
};

type Receipt = {
  decisionId: string;
  verdict: 'allow' | 'block';
  reason: string | null;
  policyIds: string[];
  target: string;
  attempt: string;
};

// Fixture persistence only. Feed the real guard the same row shape it gets
// from Postgres, and capture its real guard_decisions insert. Surprise writes
// or schema drift fail closed; this adapter does not implement a policy.
function memorySql(org: string, receipts: Receipt[]): GuardSql {
  const tag = async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const statement = strings.join('?').trim().replace(/\s+/g, ' ');
    if (/^SELECT\b.*\bFROM guard_policies\b/i.test(statement)) {
      assert.deepEqual(params, [org]);
      return [{ ...policy }];
    }
    if (/^SELECT\b.*\bFROM (settings|risk_templates|guard_calibration_state|plan_authorization_steps|plan_authorizations)\b/i.test(statement)) {
      assert.ok(params.includes(org), 'unexpected tenant');
      return []; // No external verdict, LLM configuration, or overrides.
    }
    const insert = /^INSERT INTO guard_decisions \(([^)]+)\)/i.exec(statement);
    if (insert) {
      const definition = insert[1];
      assert.ok(definition, 'expected decision insert columns');
      const columns = definition.split(',').map((column) => column.trim());
      assert.equal(columns.length, params.length);
      const row = Object.fromEntries(columns.map((name, i) => [name, params[i]]));
      assert.equal(row.org_id, org);
      assert.equal(row.degraded, false, 'do not record a degraded demo verdict');
      assert.equal(typeof row.id, 'string');
      assert.ok(row.decision === 'allow' || row.decision === 'block');
      assert.ok(row.reason === null || typeof row.reason === 'string');
      const ids: unknown = JSON.parse(String(row.matched_policies));
      assert.ok(Array.isArray(ids) && ids.every((id) => typeof id === 'string'));
      const context = JSON.parse(String(row.context));
      const target: unknown = context.target;
      assert.equal(typeof context.idempotency_key, 'string');
      assert.equal(typeof target, 'string');
      receipts.push({
        decisionId: row.id as string, verdict: row.decision,
        reason: row.reason, policyIds: ids as string[], target: target as string,
        attempt: context.idempotency_key,
      });
      return [];
    }
    throw new Error('Unknown statement in demo persistence adapter');
  };
  return Object.assign(tag, { query: async () => { throw new Error('Unexpected demo query'); } });
}

export async function runRefundDemo() {
  // This demo is a standalone process, not a hosted Dashboard integration.
  // Force the shared event module to use memory before it is loaded.
  process.env.REALTIME_BACKEND = 'memory';
  const { evaluateGuard } = await import('../../app/lib/guard/evaluate');

  const organization = `demo_refund_${randomUUID()}`;
  const orderId = 'DEMO-1042';
  const cents = 4_200;
  const receipts: Receipt[] = [];
  const sql = memorySql(organization, receipts);
  const refundKey = `full-refund:${orderId}`;
  const ledger = new Map<string, { orderId: string; cents: number; decisionId: string }>();
  for (const attempt of [1, 2]) {
    // This boundary reads the store state. The untrusted requester never
    // supplies action_type, target, amount or the already-refunded flag.
    const target = ledger.has(refundKey) ? `${refundedPrefix}/${orderId}` : `/demo-store/open/${orderId}`;
    const guard = await evaluateGuard(organization, {
      action_type: 'refund', target, reversible: false,
      declared_goal: `Refund order ${orderId} for ${cents} demo cents`,
      idempotency_key: `demo-attempt-${attempt}`,
    }, sql);
    const receipt = receipts.at(-1);
    assert.equal(receipt?.decisionId, guard.decision_id, 'require matching guard evidence');
    if (guard.decision === 'allow' && guard.degraded !== true) {
      // Synchronous check-and-write models an atomic idempotent endpoint.
      // If the guard incorrectly permits the retry, fail the demo rather than
      // silently counting the store's protection as a guard success.
      assert.ok(!ledger.has(refundKey), 'guard allowed a duplicate; fake store refused it');
      ledger.set(refundKey, { orderId, cents, decisionId: guard.decision_id });
    } else if (guard.degraded || guard.decision !== 'block') {
      throw new Error('Unexpected or degraded guard outcome; no refund executed for this attempt.');
    }
  }
  assert.deepEqual(receipts.map((r) => r.verdict), ['allow', 'block']);
  const [first, second] = receipts;
  assert.ok(first && second, 'expected two guard receipts');
  assert.notEqual(first.decisionId, second.decisionId);
  assert.deepEqual(second.policyIds, [policyId]);
  assert.equal(ledger.size, 1);
  return { orderId, refundKey, receipts, ledger: [...ledger.values()] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const demo = await runRefundDemo();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(demo, null, 2));
  } else {
    printDemo(demo);
  }
}

function printDemo(demo: Awaited<ReturnType<typeof runRefundDemo>>) {
  console.log('DashClaw | Duplicate refund check');
  console.log('Synthetic store. No payment API. No real money.\n');
  console.log(`Refund intent: ${demo.refundKey}\n`);
  for (const [index, receipt] of demo.receipts.entries()) {
    const title = index === 0 ? 'Initial request' : 'Duplicate retry';
    console.log(`${title}: ${receipt.verdict.toUpperCase()}`);
    console.log(`  Attempt:  ${receipt.attempt}`);
    console.log(`  Decision: ${receipt.decisionId}`);
    console.log(`  Target:   ${receipt.target}`);
    console.log(`  Policy:   ${receipt.policyIds.join(', ') || 'none matched'}`);
    if (receipt.reason) console.log(`  Reason:   ${receipt.reason}`);
  }
  console.log(`\nFake ledger: ${demo.ledger.length} refund for ${demo.orderId}; $42.00 in demo funds only.`);
}
