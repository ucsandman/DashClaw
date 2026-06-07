import { useCallback, useMemo, useState } from 'react';

export interface UseSelection {
  /** Currently selected ids, insertion order. */
  selectedIds: string[];
  selectedSet: Set<string>;
  isSelected: (id: string) => boolean;
  /** Add/remove one id. */
  toggle: (id: string) => void;
  /** Select every current item, or clear if all are already selected. */
  toggleAll: () => void;
  clear: () => void;
  /** True when every current item id is selected (and there is at least one). */
  allSelected: boolean;
  count: number;
  /** Select the contiguous range of items between two ids (shift-click). */
  selectRange: (fromId: string, toId: string) => void;
  /** Replace the selection with an explicit id list. */
  setSelected: (ids: string[]) => void;
}

/**
 * Generic, item-agnostic multi-select. Set-based (carries the richer semantics
 * the /decisions page already relies on) and works for any list/table/grid by
 * supplying a `getId` accessor. Selection survives item re-ordering; ids that
 * leave the list simply stop counting toward `allSelected`.
 */
export function useSelection<T>(items: T[], getId: (item: T) => string): UseSelection {
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => new Set());

  const ids = useMemo(() => items.map(getId), [items, getId]);

  const isSelected = useCallback((id: string) => selectedSet.has(id), [selectedSet]);

  const toggle = useCallback((id: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedSet(new Set()), []);

  const allSelected = ids.length > 0 && ids.every((id) => selectedSet.has(id));

  const toggleAll = useCallback(() => {
    setSelectedSet((prev) => {
      const all = ids.length > 0 && ids.every((id) => prev.has(id));
      return all ? new Set() : new Set(ids);
    });
  }, [ids]);

  const selectRange = useCallback(
    (fromId: string, toId: string) => {
      const a = ids.indexOf(fromId);
      const b = ids.indexOf(toId);
      if (a === -1 || b === -1) return;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      setSelectedSet((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          const id = ids[i];
          if (id !== undefined) next.add(id);
        }
        return next;
      });
    },
    [ids],
  );

  const setSelected = useCallback((arr: string[]) => setSelectedSet(new Set(arr)), []);

  const selectedIds = useMemo(() => [...selectedSet], [selectedSet]);

  return {
    selectedIds,
    selectedSet,
    isSelected,
    toggle,
    toggleAll,
    clear,
    allSelected,
    count: selectedSet.size,
    selectRange,
    setSelected,
  };
}
