import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useSelectAllHotkey } from '@/lib/useSelectAllHotkey';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function fireSelectAll(target: EventTarget = window) {
  const evt = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(evt);
  return evt;
}

describe('useSelectAllHotkey', () => {
  it('fires on Ctrl+A and prevents the default text select-all', () => {
    const onSelectAll = vi.fn();
    renderHook(() => useSelectAllHotkey(onSelectAll));
    const evt = fireSelectAll();
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(evt.defaultPrevented).toBe(true);
  });

  it('fires on Cmd+A (metaKey) too', () => {
    const onSelectAll = vi.fn();
    renderHook(() => useSelectAllHotkey(onSelectAll));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('is suppressed while typing in an input (does not hijack text select-all)', () => {
    const onSelectAll = vi.fn();
    renderHook(() => useSelectAllHotkey(onSelectAll));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(onSelectAll).not.toHaveBeenCalled();
  });

  it('ignores a plain "a" without a modifier', () => {
    const onSelectAll = vi.fn();
    renderHook(() => useSelectAllHotkey(onSelectAll));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onSelectAll).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const onSelectAll = vi.fn();
    renderHook(() => useSelectAllHotkey(onSelectAll, false));
    fireSelectAll();
    expect(onSelectAll).not.toHaveBeenCalled();
  });
});
