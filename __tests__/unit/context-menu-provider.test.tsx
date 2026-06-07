import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ContextMenuProvider } from '@/components/context-menu/ContextMenuProvider';

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function dispatchContextMenu(el: Element): MouseEvent {
  const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 });
  act(() => {
    el.dispatchEvent(evt);
  });
  return evt;
}

describe('ContextMenuProvider — augment-only interception', () => {
  it('preventDefault + opens the menu when right-clicking a DashClaw item', () => {
    const { container } = render(
      <ContextMenuProvider>
        <div data-entity-type="decision" data-entity-id="act_1" data-entity-status="pending_approval">
          <span id="row-child">row</span>
        </div>
      </ContextMenuProvider>,
    );
    const child = container.querySelector('#row-child')!;
    const evt = dispatchContextMenu(child);
    expect(evt.defaultPrevented).toBe(true);
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    // governance + generic items rendered
    const labels = [...document.body.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent);
    expect(labels.join(' ')).toContain('Approve');
    expect(labels.join(' ')).toContain('View decision');
  });

  it('does NOT preventDefault over blank space (native menu preserved)', () => {
    const { container } = render(
      <ContextMenuProvider>
        <div id="blank">just some text, no entity</div>
      </ContextMenuProvider>,
    );
    const blank = container.querySelector('#blank')!;
    const evt = dispatchContextMenu(blank);
    expect(evt.defaultPrevented).toBe(false);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('does NOT intercept over an input (native editing preserved)', () => {
    const { container } = render(
      <ContextMenuProvider>
        <div data-entity-type="decision" data-entity-id="act_2">
          <input id="field" defaultValue="copy me" />
        </div>
      </ContextMenuProvider>,
    );
    const field = container.querySelector('#field')!;
    const evt = dispatchContextMenu(field);
    expect(evt.defaultPrevented).toBe(false);
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('Escape closes the open menu', () => {
    const { container } = render(
      <ContextMenuProvider>
        <div data-entity-type="decision" data-entity-id="act_3">row</div>
      </ContextMenuProvider>,
    );
    dispatchContextMenu(container.querySelector('[data-entity-type]')!);
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('ArrowDown moves focus and Enter activates (then closes)', async () => {
    const { container } = render(
      <ContextMenuProvider>
        <div data-entity-type="decision" data-entity-id="act_4">row</div>
      </ContextMenuProvider>,
    );
    dispatchContextMenu(container.querySelector('[data-entity-type]')!);
    const items = [...document.body.querySelectorAll('[role="menuitem"]')];
    expect(items.length).toBeGreaterThan(1);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    // second item is now the active (tabIndex 0) item
    expect(items[1]?.getAttribute('tabindex')).toBe('0');
    // Enter runs the (async) action then closes — flush the microtask via async act.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('mousedown outside closes the menu', () => {
    const { container } = render(
      <ContextMenuProvider>
        <div data-entity-type="decision" data-entity-id="act_5">row</div>
      </ContextMenuProvider>,
    );
    dispatchContextMenu(container.querySelector('[data-entity-type]')!);
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });
});
