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
  ['activity', 'app/activity/page.tsx'],
  // Rows extracted to the client ProjectsTable (multi-select, phase 7) — the
  // tagging lives there now; the server page just passes rows in.
  ['code-sessions', 'app/code-sessions/ProjectsTable.tsx'],
  ['evaluations', 'app/evaluations/page.tsx'],
  ['integrations', 'app/integrations/page.tsx'],
  ['learning', 'app/learning/page.tsx'],
  ['model-strategies', 'app/model-strategies/page.tsx'],
  ['prompts', 'app/prompts/page.tsx'],
  ['team', 'app/team/page.tsx'],
  ['identities', 'app/identities/page.tsx'],
  ['security signals', 'app/security/page.tsx'],
  ['policies cockpit (ShieldList)', 'app/policies/components/ShieldList.tsx'],
  ['policies (RecentDigest)', 'app/policies/components/RecentDigest.tsx'],
  ['agent policies section', 'app/agents/[agentId]/components/AgentPoliciesSection.tsx'],
];

describe('context-menu coverage — tagging inventory', () => {
  it.each(TAGGED_FILES)('%s tags its entity rows with data-entity-type + data-entity-id', (_label, rel) => {
    const code = src(rel);
    expect(code).toMatch(/data-entity-type/);
    expect(code).toMatch(/data-entity-id/);
  });

  it('marks policy rows as right-clickable in PolicyCockpit (ShieldList) and AgentPoliciesSection', () => {
    expect(src('app/policies/components/ShieldList.tsx')).toMatch(/data-entity-type="policy"/);
    expect(src('app/agents/[agentId]/components/AgentPoliciesSection.tsx')).toMatch(/data-entity-type="policy"/);
  });
});

// ---------------------------------------------------------------------------
// Representative menus for newly covered types.
// ---------------------------------------------------------------------------
describe('context-menu coverage — representative menus', () => {
  it('codeSession menu offers Open (detail route) + Copy ID', () => {
    const ids = getActionsFor(ent('codeSession', 'proj_1')).map((i) => i.id);
    expect(ids).toContain('copy-id');
    expect(ids).toContain('open');
  });

  it('modelStrategy menu offers Delete + Open + Copy ID', () => {
    const ids = getActionsFor(ent('modelStrategy', 'str_1')).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['delete', 'open', 'copy-id']));
  });

  it('prompt menu offers Delete + Copy ID', () => {
    const ids = getActionsFor(ent('prompt', 'tpl_1')).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['delete', 'copy-id']));
  });

  it('teamMember menu offers Remove + Copy ID', () => {
    const ids = getActionsFor(ent('teamMember', 'u_1')).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['remove', 'copy-id']));
  });

  it('generic-only types still get Copy ID', () => {
    for (const t of ['integration', 'lesson', 'recommendation', 'signal', 'scorer', 'auditEvent', 'evaluation']) {
      expect(getActionsFor(ent(t, `${t}_1`)).map((i) => i.id)).toContain('copy-id');
    }
  });

  it('modelStrategy delete calls DELETE /api/model-strategies/:id', async () => {
    const del = getActionsFor(ent('modelStrategy', 'str_9')).find((i) => i.id === 'delete');
    await del?.run(ctx(ent('modelStrategy', 'str_9')));
    expect(global.fetch).toHaveBeenCalledWith('/api/model-strategies/str_9', { method: 'DELETE' });
  });

  it('prompt delete calls DELETE /api/prompts/templates/:id', async () => {
    const del = getActionsFor(ent('prompt', 'tpl_9')).find((i) => i.id === 'delete');
    await del?.run(ctx(ent('prompt', 'tpl_9')));
    expect(global.fetch).toHaveBeenCalledWith('/api/prompts/templates/tpl_9', { method: 'DELETE' });
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
