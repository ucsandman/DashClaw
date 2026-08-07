import { useCallback, useMemo, useState } from 'react';

export interface ListColumn<T> {
  key: string;
  label: string;
  accessor: (row: T) => string | number | null | undefined;
  /** appears in sort dropdown */
  sortable?: boolean;
  /** gets a distinct-value filter dropdown */
  filterable?: boolean;
  /** included in text search (default: true unless explicitly false) */
  searchable?: boolean;
}

export interface ListControlsState<T> {
  /** processed output */
  rows: T[];
  /**
   * Unfiltered input rows, exposed so ListControlsBar can build filter-dropdown
   * option lists from the full dataset rather than the currently filtered view
   * (otherwise picking one filter value would hide the others).
   */
  allRows: T[];
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  /** same key toggles direction */
  setSort: (key: string) => void;
  search: string;
  setSearch: (s: string) => void;
  /** columnKey -> selected value */
  filters: Record<string, string>;
  setFilter: (key: string, value: string | null) => void;
  clearAll: () => void;
  /** active filters + search (for badge) */
  activeCount: number;
}

interface ProcessState {
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  search: string;
  filters: Record<string, string>;
}

function isNumericLike(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value));
  return false;
}

export function processRows<T>(rows: T[], columns: ListColumn<T>[], state: ProcessState): T[] {
  const { sortKey, sortDir, search, filters } = state;

  const filterKeys = Object.keys(filters).filter((k) => filters[k]);
  let result = rows;

  if (filterKeys.length > 0) {
    result = result.filter((row) => {
      return filterKeys.every((key) => {
        const column = columns.find((c) => c.key === key);
        if (!column) return true;
        return String(column.accessor(row)) === filters[key];
      });
    });
  }

  const term = search.trim().toLowerCase();
  if (term) {
    const searchableColumns = columns.filter((c) => c.searchable !== false);
    result = result.filter((row) =>
      searchableColumns.some((c) => {
        const value = c.accessor(row);
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(term);
      })
    );
  }

  if (sortKey) {
    const column = columns.find((c) => c.key === sortKey);
    if (column) {
      const dirMultiplier = sortDir === 'desc' ? -1 : 1;
      result = result
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
          const av = column.accessor(a.row);
          const bv = column.accessor(b.row);
          const aNull = av === null || av === undefined;
          const bNull = bv === null || bv === undefined;

          if (aNull && bNull) return a.index - b.index;
          if (aNull) return 1;
          if (bNull) return -1;

          let cmp: number;
          if (isNumericLike(av) && isNumericLike(bv)) {
            cmp = Number(av) - Number(bv);
          } else {
            cmp = String(av).localeCompare(String(bv));
          }
          if (cmp === 0) return a.index - b.index;
          return cmp * dirMultiplier;
        })
        .map(({ row }) => row);
    }
  }

  return result;
}

export function useListControls<T>(
  rows: T[],
  columns: ListColumn<T>[],
  opts?: { defaultSortKey?: string; defaultSortDir?: 'asc' | 'desc' }
): ListControlsState<T> {
  // sortKey/sortDir live in one state object updated by a single pure functional
  // updater. Two separate useState calls (with setSortDir nested inside the
  // setSortKey updater) broke under React Strict Mode's double-invocation of
  // updaters in dev: both invocations read the same committed prevKey, so a
  // same-key click flipped sortDir twice and it never visibly toggled.
  const [sortState, setSortState] = useState<{ key: string | null; dir: 'asc' | 'desc' }>({
    key: opts?.defaultSortKey ?? null,
    dir: opts?.defaultSortDir ?? 'asc',
  });
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});

  const setSort = useCallback((key: string) => {
    setSortState((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }, []);

  const setFilter = useCallback((key: string, value: string | null) => {
    setFilters((prev) => {
      if (!value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  }, []);

  const clearAll = useCallback(() => {
    setSearch('');
    setFilters({});
  }, []);

  const processed = useMemo(
    () => processRows(rows, columns, { sortKey: sortState.key, sortDir: sortState.dir, search, filters }),
    [rows, columns, sortState, search, filters]
  );

  const activeCount = Object.keys(filters).length + (search.trim() ? 1 : 0);

  return {
    rows: processed,
    allRows: rows,
    sortKey: sortState.key,
    sortDir: sortState.dir,
    setSort,
    search,
    setSearch,
    filters,
    setFilter,
    clearAll,
    activeCount,
  };
}
