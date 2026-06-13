import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getActionsFor } from '@/components/context-menu/actionRegistry';
import type { ActionContext, EntityTarget, MenuItem } from '@/components/context-menu/types';

function ent(type: string, id: string, data: Record<string, string> = {}): EntityTarget {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(data)) el.dataset[k] = v;
  return { type, id, el, data: el.dataset };
}

function ctxFor(entity: EntityTarget): ActionContext {
  return { entity, push: vi.fn(), refresh: vi.fn(), close: vi.fn() };
}

function find(items: MenuItem[], id: string): MenuItem {
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error(`menu item ${id} not found in [${items.map((i) => i.id).join(', ')}]`);
  return item;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function run(type: string, id: string, actionId: string, data: Record<string, string> = {}) {
  const e = ent(type, id, data);
  await find(getActionsFor(e), actionId).run(ctxFor(e));
}

describe('context-menu failure surfacing (no silent success)', () => {
  it('a 403 makes the action reject and does NOT refresh the page', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }));
    const e = ent('decision', 'act_1', { entityStatus: 'pending_approval' });
    const ctx = ctxFor(e);
    const deny = find(getActionsFor(e), 'deny');
    await expect(deny.run(ctx)).rejects.toThrow(/Forbidden/);
    expect(ctx.refresh).not.toHaveBeenCalled();
  });

  it('a 500 with a non-JSON body still rejects with the status code', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error('not json'); } }));
    const e = ent('decision', 'act_2', { entityStatus: 'pending_approval' });
    const ctx = ctxFor(e);
    const approve = find(getActionsFor(e), 'approve');
    await expect(approve.run(ctx)).rejects.toThrow(/500/);
    expect(ctx.refresh).not.toHaveBeenCalled();
  });
});

describe('context-menu governance routes', () => {
  it('decision deny → POST /api/approvals/:id {decision:deny}', async () => {
    await run('decision', 'act_1', 'deny', { entityStatus: 'pending_approval' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/approvals/act_1',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ decision: 'deny' }) }),
    );
  });

  it('assumption validate → PATCH /api/assumptions/:id {validated:true}', async () => {
    await run('assumption', 'asm_1', 'validate');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assumptions/asm_1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ validated: true }) }),
    );
  });

  it('assumption invalidate (with reason prompt) → PATCH {validated:false, invalidated_reason}', async () => {
    window.prompt = vi.fn(() => 'drifted from goal');
    await run('assumption', 'asm_2', 'invalidate');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assumptions/asm_2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ validated: false, invalidated_reason: 'drifted from goal' }),
      }),
    );
  });

  it('assumption invalidate aborts when the prompt is cancelled', async () => {
    window.prompt = vi.fn(() => null);
    await run('assumption', 'asm_3', 'invalidate');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loop cancel → PATCH /api/actions/loops/:id {status:cancelled}', async () => {
    await run('loop', 'loop_1', 'cancel');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/actions/loops/loop_1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }),
    );
  });

  it('loop resolve (with prompt) → PATCH {status:resolved, resolution}', async () => {
    window.prompt = vi.fn(() => 'done');
    await run('loop', 'loop_2', 'resolve');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/actions/loops/loop_2',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'resolved', resolution: 'done' }) }),
    );
  });

  it('capability delete → DELETE /api/capabilities/:id', async () => {
    await run('capability', 'cap_1', 'delete');
    expect(fetchMock).toHaveBeenCalledWith('/api/capabilities/cap_1', { method: 'DELETE' });
  });

  it('policy delete → DELETE /api/policies?id=', async () => {
    await run('policy', 'gp_1', 'delete');
    expect(fetchMock).toHaveBeenCalledWith('/api/policies?id=gp_1', { method: 'DELETE' });
  });

  it('webhook delete → DELETE /api/webhooks?id=', async () => {
    await run('webhook', 'wh_1', 'delete');
    expect(fetchMock).toHaveBeenCalledWith('/api/webhooks?id=wh_1', { method: 'DELETE' });
  });

  it('apiKey revoke → DELETE /api/keys?id= (and absent when already revoked)', async () => {
    await run('apiKey', 'key_1', 'revoke');
    expect(fetchMock).toHaveBeenCalledWith('/api/keys?id=key_1', { method: 'DELETE' });
    const revoked = getActionsFor(ent('apiKey', 'key_2', { entityStatus: 'revoked' }));
    expect(revoked.map((i) => i.id)).not.toContain('revoke');
  });

  it('secret mark-rotated → PATCH /api/secrets/:id {last_rotated_at}', async () => {
    await run('secret', 'sec_1', 'mark-rotated');
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/secrets/sec_1');
    expect(call).toBeTruthy();
    expect(call?.[1]?.method).toBe('PATCH');
    expect(typeof JSON.parse(call?.[1]?.body).last_rotated_at).toBe('string');
  });

  it('posture snooze + accept-risk → POST /api/posture/findings/:key/resolve', async () => {
    await run('postureFinding', 'PF.secrets.rotation', 'snooze');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/posture/findings/PF.secrets.rotation/resolve',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'snooze' }) }),
    );
    await run('postureFinding', 'PF.secrets.rotation', 'accept-risk');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/posture/findings/PF.secrets.rotation/resolve',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'accept_risk' }) }),
    );
  });

  it('knowledge delete → DELETE /api/knowledge/collections/:id', async () => {
    await run('knowledge', 'col_1', 'delete');
    expect(fetchMock).toHaveBeenCalledWith('/api/knowledge/collections/col_1', { method: 'DELETE' });
  });

  it('message mark-read + archive → PATCH /api/messages', async () => {
    await run('message', 'msg_1', 'mark-read');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/messages',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ message_ids: ['msg_1'], action: 'read' }) }),
    );
    await run('message', 'msg_1', 'archive');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/messages',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ message_ids: ['msg_1'], action: 'archive' }) }),
    );
  });
});
