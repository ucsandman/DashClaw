import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getActionsFor, detailPathFor } from '@/components/context-menu/actionRegistry';
import type { EntityTarget } from '@/components/context-menu/types';

function ent(type: string, id: string): EntityTarget {
  const el = document.createElement('div');
  return { type, id, el, data: el.dataset };
}

beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
});

// Every entity type from the recon gap inventory must resolve to at least one
// menu item (Copy ID at minimum) — never empty/undefined for a known type.
const GAP_TYPES = [
  'codeSession', 'evaluation', 'integration', 'lesson', 'recommendation', 'signal',
  'modelStrategy', 'prompt', 'teamMember', 'identity', 'drift', 'auditEvent',
];

describe('actionRegistry coverage', () => {
  it.each(GAP_TYPES)('returns at least Copy ID for %s', (type) => {
    const items = getActionsFor(ent(type, `${type}_1`));
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i) => i.id)).toContain('copy-id');
  });

  it('maps policy to the cockpit highlight route', () => {
    expect(detailPathFor('policy', 'pol_1')).toBe('/policies?policy=pol_1');
  });

  it('maps codeSession + modelStrategy to their detail routes', () => {
    expect(detailPathFor('codeSession', 'proj_1')).toBe('/code-sessions/proj_1');
    expect(detailPathFor('modelStrategy', 'str_1')).toBe('/model-strategies/str_1');
  });

  it('returns null for a known type that has no detail route', () => {
    expect(detailPathFor('signal', 'sig_1')).toBeNull();
  });
});
