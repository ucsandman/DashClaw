import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getActionsFor } from '@/components/context-menu/actionRegistry';
import type { ActionContext, EntityTarget } from '@/components/context-menu/types';

function ent(type: string, id: string, data: Record<string, string> = {}): EntityTarget {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
  return { type, id, el, data: el.dataset };
}

function makeCtx(entity: EntityTarget): ActionContext & { pushed: string[] } {
  const pushed: string[] = [];
  return { entity, pushed, push: (h) => pushed.push(h), refresh: vi.fn(), close: vi.fn() };
}

const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  clipboard.writeText.mockClear();
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: clipboard, configurable: true });
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getActionsFor — decision', () => {
  it('includes approve/deny only when pending_approval', () => {
    const pending = getActionsFor(ent('decision', 'act_1', { entityStatus: 'pending_approval' }));
    const ids = pending.map((i) => i.id);
    expect(ids).toContain('approve');
    expect(ids).toContain('deny');

    const done = getActionsFor(ent('decision', 'act_2', { entityStatus: 'completed' }));
    const doneIds = done.map((i) => i.id);
    expect(doneIds).not.toContain('approve');
    expect(doneIds).not.toContain('deny');
  });

  it('always exposes view, delete (danger), and generic copy/open', () => {
    const items = getActionsFor(ent('decision', 'act_1'));
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['view', 'guard', 'delete', 'copy-id', 'copy-link', 'open']));
    expect(items.find((i) => i.id === 'delete')?.danger).toBe(true);
  });

  it('approve calls POST /api/approvals/:id with allow', async () => {
    const items = getActionsFor(ent('decision', 'act_9', { entityStatus: 'pending_approval' }));
    const approve = items.find((i) => i.id === 'approve');
    const ctx = makeCtx(ent('decision', 'act_9'));
    await approve?.run(ctx);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/approvals/act_9',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'allow' }) }),
    );
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('delete calls DELETE /api/actions?action_id=', async () => {
    const items = getActionsFor(ent('decision', 'act_5'));
    const del = items.find((i) => i.id === 'delete');
    const ctx = makeCtx(ent('decision', 'act_5'));
    await del?.run(ctx);
    expect(global.fetch).toHaveBeenCalledWith('/api/actions?action_id=act_5', { method: 'DELETE' });
  });

  it('view + open navigate to the detail route', () => {
    const items = getActionsFor(ent('decision', 'act_7'));
    const ctx = makeCtx(ent('decision', 'act_7'));
    items.find((i) => i.id === 'view')?.run(ctx);
    items.find((i) => i.id === 'open')?.run(ctx);
    expect(ctx.pushed).toContain('/decisions/act_7');
  });
});

describe('getActionsFor — generic copy', () => {
  it('Copy ID writes the entity id to the clipboard', async () => {
    const items = getActionsFor(ent('decision', 'act_3'));
    const copy = items.find((i) => i.id === 'copy-id');
    await copy?.run(makeCtx(ent('decision', 'act_3')));
    expect(clipboard.writeText).toHaveBeenCalledWith('act_3');
  });

  it('an unknown entity type still gets at least Copy ID', () => {
    const items = getActionsFor(ent('mysteryThing', 'm_1'));
    expect(items.map((i) => i.id)).toContain('copy-id');
  });
});
