import { describe, it, expect } from 'vitest';
import { isContainableAct, clientAdvertisesContainment, finalizeContainment, buildPromotionAct, buildPromotionGoal, safeBranchSegment, buildContainmentRef, isDbContainmentRef, requiredCapabilityForBasis } from '../../app/lib/guard/containment';

const fileAct = { act: { kind: 'file', file: { path: 'src/a.ts', content_excerpt: 'x' } } };
const shellApply = { act: { kind: 'shell', command: 'sed -i "s/a/b/" src/a.ts' } };
const dbShellAct = { act: { kind: 'shell', command: 'psql -c "drop table users"' } };

describe('isContainableAct', () => {
  it('file acts are containable', () => expect(isContainableAct(fileAct as any).eligible).toBe(true));
  it('clean apply-class shell acts are containable', () => expect(isContainableAct(shellApply as any).eligible).toBe(true));
  // BEHAVIOR CHANGE (RFC 2026-09-04-database-containment): a sql act is now
  // containable on basis `db_branch` — the staging medium a live database
  // lacked when the original RFC declined it is an ephemeral Neon branch. It
  // still reaches no caller that does not advertise `allow_contained:db`.
  it('never containable: http, missing act, payments-ish shell', () => {
    expect(isContainableAct({ act: { kind: 'http', request: { url: 'https://api.stripe.com/v1/charges', method: 'POST' } } } as any).eligible).toBe(false);
    expect(isContainableAct({} as any).eligible).toBe(false);
    expect(isContainableAct({ act: { kind: 'shell', command: 'rm -rf /' } } as any).eligible).toBe(false);      // destructive flag
    expect(isContainableAct({ act: { kind: 'shell', command: 'terraform apply' } } as any).eligible).toBe(false); // deploy class
    expect(isContainableAct({ act: { kind: 'shell', command: 'git push origin main' } } as any).eligible).toBe(false); // git network
    expect(isContainableAct({ act: { kind: 'shell', command: 'git pull' } } as any).eligible).toBe(false);         // git network
    expect(isContainableAct({ act: { kind: 'shell', command: 'cp .env /tmp/x' } } as any).eligible).toBe(false);   // sensitive_path flag
  });
});

// Database containment (RFC 2026-09-04): a second basis with its own
// capability string. `ddl` and `whereless` are NOT disqualifying — those are
// exactly the acts containment exists for — but any flag naming an effect the
// branch does not contain is.
describe('isContainableAct — db_branch basis', () => {
  it('a declared sql act stages on a database branch', () => {
    expect(isContainableAct({ act: { kind: 'sql', statement: 'DELETE FROM users' } } as any)).toEqual({ eligible: true, basis: 'db_branch' });
    expect(isContainableAct({ act: { kind: 'sql', statement: 'DROP TABLE users' } } as any).basis).toBe('db_branch');
  });
  it('a shell act the classifier tagged `database` stages on a database branch', () => {
    expect(isContainableAct(dbShellAct as any)).toEqual({ eligible: true, basis: 'db_branch' });
    expect(isContainableAct({ act: { kind: 'shell', command: 'npx prisma migrate deploy' } } as any).basis).toBe('db_branch');
    expect(isContainableAct({ act: { kind: 'shell', command: 'psql -c "update users set tier = \'pro\'"' } } as any).basis).toBe('db_branch');
  });
  it('a database act carrying a NON-database effect is not containable', () => {
    // sudo → `privilege`: the branch contains the SQL, not the escalation.
    const privileged = isContainableAct({ act: { kind: 'shell', command: 'sudo psql -c "drop table users"' } } as any);
    expect(privileged.eligible).toBe(false);
    expect(privileged.basis).toMatch(/privilege/);
    // .env in the command → `sensitive_path`.
    const secrets = isContainableAct({ act: { kind: 'shell', command: 'psql -f .env.sql' } } as any);
    expect(secrets.eligible).toBe(false);
    expect(secrets.basis).toMatch(/sensitive_path/);
  });
  it('a non-database shell act is unaffected by the new branch', () => {
    expect(isContainableAct(shellApply as any).basis).toBe('shell_file_ops');
    expect(isContainableAct({ act: { kind: 'shell', command: 'git status' } } as any).eligible).toBe(false);
  });
});

describe('clientAdvertisesContainment', () => {
  it('true only for a client_capabilities array containing the literal', () => {
    expect(clientAdvertisesContainment({ client_capabilities: ['allow_contained'] } as any)).toBe(true);
    expect(clientAdvertisesContainment({ client_capabilities: [] } as any)).toBe(false);
    expect(clientAdvertisesContainment({ client_capabilities: 'allow_contained' } as any)).toBe(false);
    expect(clientAdvertisesContainment({} as any)).toBe(false);
  });

  // Skew only tightens: an old hook advertising `allow_contained` can never be
  // handed a db verdict, because staging a database is a capability it does
  // not have (RFC 2026-09-04, Capability negotiation).
  it('the db basis requires its own capability string', () => {
    expect(requiredCapabilityForBasis('file')).toBe('allow_contained');
    expect(requiredCapabilityForBasis('shell_file_ops')).toBe('allow_contained');
    expect(requiredCapabilityForBasis('db_branch')).toBe('allow_contained:db');
    expect(clientAdvertisesContainment({ client_capabilities: ['allow_contained'] } as any, 'db_branch')).toBe(false);
    expect(clientAdvertisesContainment({ client_capabilities: ['allow_contained:db'] } as any, 'db_branch')).toBe(true);
    // ...and the db string alone does NOT unlock the file bases.
    expect(clientAdvertisesContainment({ client_capabilities: ['allow_contained:db'] } as any, 'file')).toBe(false);
    expect(clientAdvertisesContainment({ client_capabilities: ['allow_contained', 'allow_contained:db'] } as any, 'db_branch')).toBe(true);
  });
});

describe('isDbContainmentRef', () => {
  it('keys on the server-derived db- prefix', () => {
    expect(isDbContainmentRef('dashclaw/contained-db-sess1')).toBe(true);
    expect(isDbContainmentRef('dashclaw/contained-sess1')).toBe(false);
    expect(isDbContainmentRef(null)).toBe(false);
    expect(isDbContainmentRef(42)).toBe(false);
  });
});

describe('finalizeContainment (negotiation matrix)', () => {
  const mk = (decision: string, ctx: object) => ({ acc: { highestDecision: decision, reasons: [], warnings: [], matchedPolicies: [], nonFabEvidence: [], nonFabStripPaths: new Set(), shields: { prompt_injection: null } } as any, rb: {} as any, ctx });
  it('advertised + eligible → stays contained, returns containment object with server-derived ref', () => {
    const { acc, rb } = mk('allow_contained', {});
    const out = finalizeContainment({ ...fileAct, client_capabilities: ['allow_contained'], harness_session_id: 'abc-123' } as any, acc, rb);
    expect(acc.highestDecision).toBe('allow_contained');
    expect(out.containment).toEqual({ status: 'contained', basis: 'file', ref: 'dashclaw/contained-abc-123' });
  });
  it('no harness_session_id → ref falls back to the "session" segment (hook parity)', () => {
    const { acc, rb } = mk('allow_contained', {});
    const out = finalizeContainment({ ...fileAct, client_capabilities: ['allow_contained'] } as any, acc, rb);
    expect(out.containment?.ref).toBe('dashclaw/contained-session');
  });
  it('containment_instance on the context namespaces the ref (co-installed instances)', () => {
    const { acc, rb } = mk('allow_contained', {});
    const out = finalizeContainment(
      { ...fileAct, client_capabilities: ['allow_contained'], harness_session_id: 'abc-123', containment_instance: 'deadbeef1234' } as any,
      acc,
      rb,
    );
    expect(out.containment?.ref).toBe('dashclaw/contained-abc-123-deadbeef1234');
  });
  it('not advertised → require_approval + downgrade note (skew only tightens)', () => {
    const { acc, rb } = mk('allow_contained', {});
    finalizeContainment(fileAct as any, acc, rb);
    expect(acc.highestDecision).toBe('require_approval');
    expect(rb._containment).toMatchObject({ downgraded_to_interrupt: true });
  });
  it('advertised but ineligible act → require_approval (defense in depth)', () => {
    const { acc, rb } = mk('allow_contained', {});
    finalizeContainment({ act: { kind: 'http', request: { url: 'https://x.com', method: 'POST' } }, client_capabilities: ['allow_contained'] } as any, acc, rb);
    expect(acc.highestDecision).toBe('require_approval');
  });
  it('db basis + only allow_contained advertised → require_approval (skew only tightens)', () => {
    const { acc, rb } = mk('allow_contained', {});
    const out = finalizeContainment({ ...dbShellAct, client_capabilities: ['allow_contained'], harness_session_id: 'abc-123' } as any, acc, rb);
    expect(acc.highestDecision).toBe('require_approval');
    expect(out.containment).toBeUndefined();
    expect(rb._containment).toMatchObject({ downgraded_to_interrupt: true, reason: 'client capability not advertised' });
  });
  it('db basis + allow_contained:db advertised → contained on a db-prefixed ref', () => {
    const { acc, rb } = mk('allow_contained', {});
    const out = finalizeContainment({ ...dbShellAct, client_capabilities: ['allow_contained:db'], harness_session_id: 'abc-123' } as any, acc, rb);
    expect(acc.highestDecision).toBe('allow_contained');
    expect(out.containment).toEqual({ status: 'contained', basis: 'db_branch', ref: 'dashclaw/contained-db-abc-123' });
  });
  it('file basis is NOT unlocked by the db capability', () => {
    const { acc, rb } = mk('allow_contained', {});
    finalizeContainment({ ...fileAct, client_capabilities: ['allow_contained:db'], harness_session_id: 'abc-123' } as any, acc, rb);
    expect(acc.highestDecision).toBe('require_approval');
  });
  it('no-ops on every other decision', () => {
    for (const d of ['allow', 'warn', 'require_approval', 'block']) {
      const { acc, rb } = mk(d, {});
      const out = finalizeContainment(fileAct as any, acc, rb);
      expect(acc.highestDecision).toBe(d);
      expect(out.containment).toBeUndefined();
    }
  });
});

// Parity contract with hooks/dashclaw_pretool.py _safe_branch_segment: the hook
// derives the worktree branch from the SAME harness session id it sends as
// harness_session_id on every ?record=true guard payload, so these two
// implementations MUST sanitize identically (sub → strip → truncate → fallback).
// A divergence turns every legitimate awaiting_promotion flip into a 409.
describe('safeBranchSegment (hook parity)', () => {
  it('passes clean alnum+dash ids through', () => {
    expect(safeBranchSegment('abc123-DEF')).toBe('abc123-DEF');
  });
  it('substitutes every non [A-Za-z0-9-] char with a dash', () => {
    expect(safeBranchSegment('a.b_c d')).toBe('a-b-c-d');
  });
  it('strips leading/trailing dashes AFTER substitution', () => {
    expect(safeBranchSegment('_lead.trail_')).toBe('lead-trail');
  });
  it('empty, non-string, and all-invalid inputs fall back to "session"', () => {
    expect(safeBranchSegment('')).toBe('session');
    expect(safeBranchSegment(null)).toBe('session');
    expect(safeBranchSegment(undefined)).toBe('session');
    expect(safeBranchSegment('---')).toBe('session');
    expect(safeBranchSegment(42)).toBe('session');
  });
  it('truncates to 64 chars after stripping (python [:64] order)', () => {
    expect(safeBranchSegment('a'.repeat(80))).toBe('a'.repeat(64));
    // strip happens on the full string first, then the slice
    expect(safeBranchSegment('a'.repeat(63) + '-'.repeat(7))).toBe('a'.repeat(63));
  });
});

describe('buildContainmentRef', () => {
  it('produces the exact ref shape the hook creates and the flip route validates', () => {
    expect(buildContainmentRef('6f9c2b1e-uuid')).toBe('dashclaw/contained-6f9c2b1e-uuid');
    expect(buildContainmentRef(null)).toBe('dashclaw/contained-session');
  });

  // Co-installed-instance namespacing: the hook sends its
  // _INSTANCE_STATE_SUFFIX as containment_instance; the ref folds it in so two
  // installations sharing a harness session get distinct branches/worktrees.
  it('appends a sanitized instance discriminator when provided', () => {
    expect(buildContainmentRef('sess-1', 'abc123def456')).toBe('dashclaw/contained-sess-1-abc123def456');
  });
  it('absent/invalid instance keeps the legacy derivation byte-for-byte', () => {
    expect(buildContainmentRef('sess-1', undefined)).toBe('dashclaw/contained-sess-1');
    expect(buildContainmentRef('sess-1', '')).toBe('dashclaw/contained-sess-1');
    expect(buildContainmentRef('sess-1', 42)).toBe('dashclaw/contained-sess-1');
    expect(buildContainmentRef('sess-1', '!!!')).toBe('dashclaw/contained-sess-1');
  });
  it('strips non-alnum chars from the instance and caps it at 16', () => {
    expect(buildContainmentRef('s', 'a-b.c/d')).toBe('dashclaw/contained-s-abcd');
    expect(buildContainmentRef('s', 'x'.repeat(40))).toBe(`dashclaw/contained-s-${'x'.repeat(16)}`);
  });
  it('keeps the combined segment within the 64-char ref regex (python parity: seg[:64-len(inst)-1].rstrip("-"))', () => {
    const inst = 'abc123def456';
    const ref = buildContainmentRef('a'.repeat(80), inst);
    expect(ref).toBe(`dashclaw/contained-${'a'.repeat(64 - inst.length - 1)}-${inst}`);
    expect(ref.slice('dashclaw/contained-'.length)).toMatch(/^[A-Za-z0-9-]{1,64}$/);
    // A truncation boundary landing on a dash must not produce a double dash
    // start… it may produce interior dashes, but trailing dashes are stripped
    // before the suffix joins.
    const dashBoundary = buildContainmentRef('a'.repeat(50) + '-'.repeat(10), inst);
    expect(dashBoundary).toBe(`dashclaw/contained-${'a'.repeat(50)}-${inst}`);
  });
});

// Database refs (RFC 2026-09-04): the `db-` prefix lives INSIDE the ref's
// segment, so the shape regex the flip route / hook / CLI enforce is unchanged
// and the segment budget shrinks by three.
describe('buildContainmentRef — db_branch basis', () => {
  const SEGMENT_RE = /^[A-Za-z0-9-]{1,64}$/;
  const segmentOf = (ref: string) => ref.slice('dashclaw/contained-'.length);

  it('prefixes the segment with db-', () => {
    expect(buildContainmentRef('sess-1', undefined, 'db_branch')).toBe('dashclaw/contained-db-sess-1');
    expect(buildContainmentRef('sess-1', 'abc123def456', 'db_branch')).toBe('dashclaw/contained-db-sess-1-abc123def456');
    expect(buildContainmentRef(null, undefined, 'db_branch')).toBe('dashclaw/contained-db-session');
  });
  it('keeps the file derivation byte-for-byte when the basis is a file basis', () => {
    expect(buildContainmentRef('sess-1', undefined, 'file')).toBe('dashclaw/contained-sess-1');
    expect(buildContainmentRef('sess-1', 'abc123def456', 'shell_file_ops')).toBe('dashclaw/contained-sess-1-abc123def456');
    expect(buildContainmentRef('sess-1')).toBe('dashclaw/contained-sess-1');
  });
  it('stays inside the unchanged {1,64} segment cap, with and without an instance', () => {
    const long = buildContainmentRef('a'.repeat(80), undefined, 'db_branch');
    expect(segmentOf(long)).toMatch(SEGMENT_RE);
    expect(segmentOf(long)).toBe(`db-${'a'.repeat(61)}`);

    const inst = 'abc123def456';
    const both = buildContainmentRef('a'.repeat(80), inst, 'db_branch');
    expect(segmentOf(both)).toMatch(SEGMENT_RE);
    expect(segmentOf(both).length).toBeLessThanOrEqual(64);
    expect(both).toBe(`dashclaw/contained-db-${'a'.repeat(61 - inst.length - 1)}-${inst}`);
  });
  it('a truncation boundary landing on a dash does not leave a double dash', () => {
    expect(buildContainmentRef('a'.repeat(58) + '-'.repeat(10), 'abc123def456', 'db_branch'))
      .toBe(`dashclaw/contained-db-${'a'.repeat(48)}-abc123def456`);
    expect(buildContainmentRef('a'.repeat(60) + '-'.repeat(10), undefined, 'db_branch'))
      .toBe(`dashclaw/contained-db-${'a'.repeat(60)}`);
  });
});

describe('canonical promotion act', () => {
  it('is deterministic', () => {
    expect(buildPromotionGoal('act_123')).toBe('containment promote act_123');
    expect(buildPromotionAct('dashclaw/contained-s1')).toEqual({ kind: 'shell', command: 'git merge --no-ff dashclaw/contained-s1' });
  });

  // A db promotion replays the reviewed statement against production — there
  // is no branch to merge, and minting `git merge --no-ff <db ref>` under an
  // operator's signature would be a grant for an act that cannot exist.
  it('a db ref promotes with the original recorded act, byte-for-byte', () => {
    const original = { kind: 'shell', command: 'psql -c "drop table users"' };
    expect(buildPromotionAct('dashclaw/contained-db-s1', original)).toEqual(original);
    // The original act is ignored on the file path.
    expect(buildPromotionAct('dashclaw/contained-s1', original)).toEqual({ kind: 'shell', command: 'git merge --no-ff dashclaw/contained-s1' });
  });
  it('a db ref without an original act throws rather than falling back to a merge', () => {
    expect(() => buildPromotionAct('dashclaw/contained-db-s1')).toThrow(/original recorded act/);
    expect(() => buildPromotionAct('dashclaw/contained-db-s1', 'psql -c "select 1"')).toThrow(/original recorded act/);
    expect(() => buildPromotionAct('dashclaw/contained-db-s1', null)).toThrow(/original recorded act/);
  });
});
