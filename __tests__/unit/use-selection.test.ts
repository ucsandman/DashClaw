import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSelection } from '@/lib/useSelection';

afterEach(cleanup);

interface Row {
  id: string;
}
const rows: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const getId = (r: Row) => r.id;

describe('useSelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    expect(result.current.count).toBe(0);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.allSelected).toBe(false);
  });

  it('toggles a single id on and off', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    act(() => result.current.toggle('b'));
    expect(result.current.isSelected('b')).toBe(true);
    expect(result.current.count).toBe(1);
    act(() => result.current.toggle('b'));
    expect(result.current.isSelected('b')).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it('toggleAll selects every item, then clears when all are selected', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(4);
    expect(result.current.allSelected).toBe(true);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
    expect(result.current.allSelected).toBe(false);
  });

  it('clear removes all selection', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    act(() => result.current.toggleAll());
    act(() => result.current.clear());
    expect(result.current.count).toBe(0);
  });

  it('selectRange selects a contiguous slice regardless of direction', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    act(() => result.current.selectRange('b', 'd'));
    expect(result.current.selectedSet).toEqual(new Set(['b', 'c', 'd']));
    // reverse order selects the same range
    act(() => result.current.clear());
    act(() => result.current.selectRange('d', 'b'));
    expect(result.current.selectedSet).toEqual(new Set(['b', 'c', 'd']));
  });

  it('selectRange is a no-op for unknown ids', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    act(() => result.current.selectRange('x', 'y'));
    expect(result.current.count).toBe(0);
  });

  it('setSelected replaces the selection', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    act(() => result.current.setSelected(['a', 'c']));
    expect(result.current.selectedIds.sort()).toEqual(['a', 'c']);
    act(() => result.current.setSelected(['b']));
    expect(result.current.selectedIds).toEqual(['b']);
  });

  it('allSelected is false for an empty item list', () => {
    const { result } = renderHook(() => useSelection<Row>([], getId));
    expect(result.current.allSelected).toBe(false);
    act(() => result.current.toggleAll());
    expect(result.current.count).toBe(0);
  });

  it('selectClick toggles without shift and tracks the anchor for a shift-range', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    act(() => result.current.selectClick('b')); // anchor = b
    expect(result.current.isSelected('b')).toBe(true);
    act(() => result.current.selectClick('d', true)); // shift → b..d
    expect(result.current.selectedSet).toEqual(new Set(['b', 'c', 'd']));
  });

  it('selectClick with shift but no prior anchor just toggles', () => {
    const { result } = renderHook(() => useSelection(rows, getId));
    act(() => result.current.selectClick('c', true));
    expect(result.current.selectedSet).toEqual(new Set(['c']));
  });
});
