// cli/test/contained.test.js
//
// Tests for cli/lib/contained.js — the ref/act/evidence helpers behind
// `dashclaw contained diff|apply`. The database branch (RFC
// 2026-09-04-database-containment) is the reason these live in a module: the
// promotion act for a db ref is the action's ORIGINAL recorded act, and
// getting that wrong means the CLI's guard call never matches the operator's
// pre-approved grant.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTAINMENT_REF_PATTERN,
  isDbContainmentRef,
  buildPromotionGoal,
  buildPromotionAct,
  containmentWorktreePath,
  originalActOf,
  actCommandOf,
  hasRedactionMarker,
  formatDbEvidence,
} from '../lib/contained.js';

const FILE_REF = 'dashclaw/contained-sess1-abc123';
const DB_REF = 'dashclaw/contained-db-sess1-abc123';
const ORIGINAL_ACT = { kind: 'shell', command: 'psql -c "drop table users"' };

test('the ref pattern is unchanged and accepts both media', () => {
  assert.equal(CONTAINMENT_REF_PATTERN.test(FILE_REF), true);
  assert.equal(CONTAINMENT_REF_PATTERN.test(DB_REF), true);
  assert.equal(CONTAINMENT_REF_PATTERN.test('dashclaw/contained-../../etc'), false);
  assert.equal(CONTAINMENT_REF_PATTERN.test('refs/heads/main'), false);
});

test('isDbContainmentRef keys on the server-derived db- prefix only', () => {
  assert.equal(isDbContainmentRef(DB_REF), true);
  assert.equal(isDbContainmentRef(FILE_REF), false);
  assert.equal(isDbContainmentRef(null), false);
  assert.equal(isDbContainmentRef(undefined), false);
});

test('a file ref promotes with the canonical merge act', () => {
  assert.equal(buildPromotionGoal('act_123'), 'containment promote act_123');
  assert.deepEqual(buildPromotionAct(FILE_REF), {
    kind: 'shell',
    command: `git merge --no-ff ${FILE_REF}`,
  });
  // The original act is ignored for a file ref — the merge IS the promotion.
  assert.deepEqual(buildPromotionAct(FILE_REF, ORIGINAL_ACT), {
    kind: 'shell',
    command: `git merge --no-ff ${FILE_REF}`,
  });
  assert.equal(containmentWorktreePath(FILE_REF), '.dashclaw/contained/sess1-abc123');
});

test('a db ref promotes with the original recorded act, byte-for-byte', () => {
  assert.deepEqual(buildPromotionAct(DB_REF, ORIGINAL_ACT), ORIGINAL_ACT);
});

test('a db ref with no original act throws instead of merging a branch that does not exist', () => {
  assert.throws(() => buildPromotionAct(DB_REF), /original recorded act/);
  assert.throws(() => buildPromotionAct(DB_REF, null), /original recorded act/);
  assert.throws(() => buildPromotionAct(DB_REF, 'psql -c "select 1"'), /original recorded act/);
});

test('originalActOf reads the act off the linked guard decision, not the action row', () => {
  const detail = {
    action: { action_id: 'act_1', containment_ref: DB_REF, risk_score: 75 },
    guard_decision: { context: { agent_id: 'a1', act: ORIGINAL_ACT } },
  };
  assert.deepEqual(originalActOf(detail), ORIGINAL_ACT);
  assert.equal(actCommandOf(originalActOf(detail)), 'psql -c "drop table users"');
});

test('originalActOf returns null when the decision link or the act is missing', () => {
  assert.equal(originalActOf({ action: {} }), null);
  assert.equal(originalActOf({ action: {}, guard_decision: { context: null } }), null);
  assert.equal(originalActOf({ action: {}, guard_decision: { context: {} } }), null);
  assert.equal(originalActOf(null), null);
  // A non-shell act is recoverable but not replayable from the CLI.
  const sqlAct = { kind: 'sql', statement: 'DROP TABLE users' };
  assert.deepEqual(originalActOf({ guard_decision: { context: { act: sqlAct } } }), sqlAct);
  assert.equal(actCommandOf(sqlAct), null);
  assert.equal(actCommandOf({ kind: 'shell', command: '   ' }), null);
});

test('a redacted command is refused rather than executed', () => {
  assert.equal(hasRedactionMarker('psql [REDACTED:database_url] -c "select 1"'), true);
  assert.equal(hasRedactionMarker('psql -c "select 1"'), false);
  assert.equal(hasRedactionMarker(null), false);
});

test('formatDbEvidence prints the branch, statement, schema diff and output tail', () => {
  const out = formatDbEvidence({
    kind: 'db',
    ref: DB_REF,
    branch_id: 'br-cool-dawn-123',
    db_name: 'appdb',
    statement: 'psql -c "alter table users add column tier text"',
    diff: '+ ALTER TABLE users ADD COLUMN tier text;',
    stdout_tail: 'ALTER TABLE',
  });
  assert.match(out, /Database branch: br-cool-dawn-123 · db appdb/);
  assert.match(out, new RegExp(`Containment ref: ${DB_REF.replace('/', '\\/')}`));
  assert.match(out, /Statement:\npsql -c "alter table users add column tier text"/);
  assert.match(out, /Schema diff:\n\+ ALTER TABLE users ADD COLUMN tier text;/);
  assert.match(out, /Output \(tail\):\nALTER TABLE/);
});

test('formatDbEvidence falls back to the note when the schema diff is empty', () => {
  const out = formatDbEvidence({ kind: 'db', ref: DB_REF, diff: '   ', note: 'schema unchanged — review the statement' });
  assert.match(out, /Schema diff:\nschema unchanged — review the statement/);
  assert.match(out, /Database branch: \(branch id not captured\)/);
  assert.match(out, /Statement:\n\(not captured\)/);
  // Its own default when the hook posted no note either.
  assert.match(formatDbEvidence({ diff: '' }), /data changes are not diffable/);
});
