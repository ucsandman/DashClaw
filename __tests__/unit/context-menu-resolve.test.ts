import { describe, it, expect, afterEach } from 'vitest';
import { resolveEntityTarget, isEditableTarget } from '@/components/context-menu/resolveEntityTarget';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveEntityTarget', () => {
  it('resolves the nearest [data-entity-type] ancestor from a nested node', () => {
    document.body.innerHTML = `
      <div data-entity-type="decision" data-entity-id="act_1" data-entity-status="pending_approval">
        <span class="inner"><button id="child">x</button></span>
      </div>`;
    const child = document.getElementById('child');
    const resolved = resolveEntityTarget(child);
    expect(resolved).not.toBeNull();
    expect(resolved?.type).toBe('decision');
    expect(resolved?.id).toBe('act_1');
    expect(resolved?.data.entityStatus).toBe('pending_approval');
  });

  it('returns null when there is no entity ancestor', () => {
    document.body.innerHTML = `<div><p id="plain">just text</p></div>`;
    expect(resolveEntityTarget(document.getElementById('plain'))).toBeNull();
  });

  it('returns null when type or id is missing', () => {
    document.body.innerHTML = `<div data-entity-type="decision" id="noid">no id</div>`;
    expect(resolveEntityTarget(document.getElementById('noid'))).toBeNull();
  });

  it('returns null for a non-Element target', () => {
    expect(resolveEntityTarget(null)).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('is true for input, textarea, select', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.createElement(tag);
      expect(isEditableTarget(el)).toBe(true);
    }
  });

  it('is true inside a contenteditable region', () => {
    document.body.innerHTML = `<div contenteditable="true"><span id="ce">edit me</span></div>`;
    expect(isEditableTarget(document.getElementById('ce'))).toBe(true);
  });

  it('is false for a plain div', () => {
    const el = document.createElement('div');
    expect(isEditableTarget(el)).toBe(false);
  });
});
