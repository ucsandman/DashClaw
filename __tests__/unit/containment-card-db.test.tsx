import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ContainmentCard from '@/approvals/_components/ContainmentCard';

// Database containment (RFC 2026-09-04) — the HUMAN half. The card is the only
// place an operator sees what a database act staged, and the RFC's promise is
// specific: the branch id, the statement, the schema diff (or the note), the
// output tail, and a Promote button whose LABEL names the consequence. These
// assertions drive the real component against the real db artifact shape, so
// "it renders" is proven rather than asserted.

const DB_REF = 'dashclaw/contained-db-sess9f31-a1b2c3';
const FILE_REF = 'dashclaw/contained-sess9f31-a1b2c3';

const dbAction = {
  action_id: 'act_db_1',
  agent_id: 'migration-agent-1',
  agent_name: 'Migration Agent',
  action_type: 'code_change',
  declared_goal: 'Add the billing tier column to users',
  containment_ref: DB_REF,
  timestamp_start: new Date().toISOString(),
  containment_has_evidence: true,
  containment_evidence_ref: DB_REF,
};

const dbContent = {
  kind: 'db',
  ref: DB_REF,
  branch_id: 'br-demo-contained-9f31',
  db_name: 'appdb',
  statement: 'psql -c "ALTER TABLE users ADD COLUMN billing_tier text"',
  diff: '--- a/public.users\n+++ b/public.users\n+  billing_tier text',
  stdout_tail: 'ALTER TABLE',
};

function stubArtifacts(content: Record<string, unknown> | null) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ artifacts: content ? [{ artifact_type: 'patch', content }] : [] }),
  })));
}

const props = { siblingCount: 0, hasLaterSibling: false, canDecide: true, onResolvedAction: () => {} };

describe('ContainmentCard — database containment', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('names the consequence on the Promote button, from the ref alone (before any fetch)', () => {
    stubArtifacts(dbContent);
    render(<ContainmentCard action={dbAction as never} {...props} />);
    expect(screen.getByRole('button', { name: /Promote — replay on production/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Discard/ })).toBeTruthy();
    expect(screen.getByText('View database evidence')).toBeTruthy();
  });

  it('renders the branch, statement, schema diff and output tail when expanded', async () => {
    stubArtifacts(dbContent);
    render(<ContainmentCard action={dbAction as never} {...props} />);

    fireEvent.click(screen.getByText('View database evidence'));

    await waitFor(() => expect(screen.getByText('Database branch')).toBeTruthy());
    expect(screen.getByText('br-demo-contained-9f31')).toBeTruthy();
    expect(screen.getByText(/ALTER TABLE users ADD COLUMN billing_tier/)).toBeTruthy();
    expect(screen.getByText('Schema diff')).toBeTruthy();
    // Whitespace is normalized by the matcher — the assertion is that the
    // added schema line renders as its own diff line.
    expect(screen.getByText(/^\+ billing_tier text$/)).toBeTruthy();
    expect(screen.getByText('Output')).toBeTruthy();
  });

  it('shows the "schema unchanged" note when Neon reports no schema diff', async () => {
    stubArtifacts({ ...dbContent, diff: '', note: 'schema unchanged — data changes are not diffable; review the statement and its output' });
    render(<ContainmentCard action={dbAction as never} {...props} />);

    fireEvent.click(screen.getByText('View database evidence'));

    await waitFor(() => expect(screen.getByText(/schema unchanged/)).toBeTruthy());
  });

  it('a file containment still renders the diff view, unchanged', async () => {
    stubArtifacts({ ref: FILE_REF, stat: ' 1 file changed', diff: 'diff --git a/x b/x\n+added' });
    render(<ContainmentCard action={{ ...dbAction, containment_ref: FILE_REF, containment_evidence_ref: FILE_REF } as never} {...props} />);

    expect(screen.getByRole('button', { name: /^Promote$/ })).toBeTruthy();
    fireEvent.click(screen.getByText('View diff'));

    await waitFor(() => expect(screen.getByText(/diff --git/)).toBeTruthy());
    expect(screen.queryByText('Database branch')).toBeNull();
  });
});
