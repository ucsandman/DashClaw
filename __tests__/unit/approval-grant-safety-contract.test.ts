import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repository = readFileSync(new URL('../../app/lib/repositories/actions.repository.approvals.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../app/api/approvals/[actionId]/grant/route.ts', import.meta.url), 'utf8');

describe('approval grant safety contract', () => {
  it('reads redacted context through the guard decision relation', () => {
    expect(repository).toMatch(/JOIN guard_decisions gd[\s\S]+gd\.id = ar\.guard_decision_id[\s\S]+gd\.org_id = ar\.org_id/);
    expect(repository).toContain('gd.context');
  });

  it('uses database-clock expiry and creator predicates on every approval transition', () => {
    expect(repository.match(/approval_expires_at >= NOW\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(repository).toContain("created_by IS DISTINCT FROM");
  });

  it('offers a bounded GET preview and reads siblings before policy mutation', () => {
    expect(route).toContain('export async function GET');
    expect(route).toContain('matching_count');
    expect(route).toContain('truncated');
    const prepare = route.indexOf('async function prepareGrant');
    expect(route.indexOf('listPendingApprovalsForGrant', prepare)).toBeLessThan(route.indexOf('createApprovalGrant(', prepare));
  });
});
