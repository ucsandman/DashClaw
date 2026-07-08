import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getActionsFor } from '@/components/context-menu/actionRegistry';
import { resolveEntityTarget, isEditableTarget } from '@/components/context-menu/resolveEntityTarget';
import type { ActionContext, EntityTarget } from '@/components/context-menu/types';

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function ent(type: string, id: string, data: Record<string, string> = {}): EntityTarget {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
  return { type, id, el, data: el.dataset };
}
function ctx(entity: EntityTarget): ActionContext {
  return { entity, push: () => {}, refresh: vi.fn(), close: () => {} };
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

// ---------------------------------------------------------------------------
// Inventory: every recon gap page/inline-row must tag its entities so the
// global ContextMenuProvider resolves a right-click on it.
// ---------------------------------------------------------------------------
const TAGGED_FILES: Array<[string, string]> = [
  ['integrations', 'app/integrations/page.tsx'],
  ['identities', 'app/identities/page.tsx'],
];

describe('context-menu coverage — tagging inventory', () => {
  it.each(TAGGED_FILES)('%s tags its entity rows with data-entity-type + data-entity-id', (_label, rel) => {
    const code = src(rel);
    expect(code).toMatch(/data-entity-type/);
    expect(code).toMatch(/data-entity-id/);
  });

  // The "One Ledger, Many Lenses" /policies redesign (2026-07-08) replaced
  // ContractPanel with Ledger.tsx as the owner of policy rows. Ledger tags each
  // table row with data-entity-type="policy" + data-entity-id so the global
  // ContextMenuProvider still resolves a right-click (Delete policy, Copy ID, …).
  it('tags policy rows in the Ledger for the right-click context menu', () => {
    const code = src('app/policies/components/Ledger.tsx');
    expect(code).toMatch(/data-entity-type="policy"/);
    expect(code).toMatch(/data-entity-id=/);
  });
});

// ---------------------------------------------------------------------------
// Representative menus for newly covered types.
// ---------------------------------------------------------------------------
describe('context-menu coverage — representative menus', () => {
  it('teamMember menu offers Remove + Copy ID', () => {
    const ids = getActionsFor(ent('teamMember', 'u_1')).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['remove', 'copy-id']));
  });

  it('generic-only types still get Copy ID', () => {
    for (const t of ['integration', 'lesson', 'recommendation', 'signal', 'scorer', 'auditEvent', 'evaluation']) {
      expect(getActionsFor(ent(t, `${t}_1`)).map((i) => i.id)).toContain('copy-id');
    }
  });

  it('teamMember remove calls DELETE /api/team/:id', async () => {
    const remove = getActionsFor(ent('teamMember', 'u_9')).find((i) => i.id === 'remove');
    await remove?.run(ctx(ent('teamMember', 'u_9')));
    expect(global.fetch).toHaveBeenCalledWith('/api/team/u_9', { method: 'DELETE' });
  });
});

// ---------------------------------------------------------------------------
// Resolver still resolves newly tagged rows; native menu preserved over inputs.
// ---------------------------------------------------------------------------
describe('context-menu coverage — resolver', () => {
  it('resolveEntityTarget finds a newly tagged modelStrategy row', () => {
    const row = document.createElement('div');
    row.dataset.entityType = 'modelStrategy';
    row.dataset.entityId = 'str_42';
    const child = document.createElement('span');
    row.appendChild(child);
    const resolved = resolveEntityTarget(child);
    expect(resolved).toEqual(expect.objectContaining({ type: 'modelStrategy', id: 'str_42' }));
  });

  it('isEditableTarget keeps the native menu over inputs', () => {
    const input = document.createElement('input');
    expect(isEditableTarget(input)).toBe(true);
    const div = document.createElement('div');
    expect(isEditableTarget(div)).toBe(false);
  });
});
