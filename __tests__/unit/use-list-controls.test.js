import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { processRows, useListControls } from '@/lib/useListControls';

const columns = [
  { key: 'name', label: 'Name', accessor: (r) => r.name, sortable: true },
  { key: 'count', label: 'Actions', accessor: (r) => r.count, sortable: true },
  { key: 'status', label: 'Status', accessor: (r) => r.status, filterable: true },
];

const rows = [
  { name: 'beta', count: 10, status: 'ok' },
  { name: 'alpha', count: 200, status: 'ok' },
  { name: 'gamma', count: 3, status: 'failed' },
  { name: 'delta', count: null, status: 'ok' },
];

const baseState = { sortKey: null, sortDir: 'asc', search: '', filters: {} };

describe('processRows', () => {
  it('preserves original order when no sortKey is set', () => {
    const result = processRows(rows, columns, baseState);
    expect(result.map((r) => r.name)).toEqual(['beta', 'alpha', 'gamma', 'delta']);
  });

  it('sorts strings ascending', () => {
    const result = processRows(rows, columns, { ...baseState, sortKey: 'name', sortDir: 'asc' });
    expect(result.map((r) => r.name)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('sorts numbers descending with null always last', () => {
    const result = processRows(rows, columns, { ...baseState, sortKey: 'count', sortDir: 'desc' });
    expect(result.map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });

  it('sorts numbers ascending with null always last', () => {
    const result = processRows(rows, columns, { ...baseState, sortKey: 'count', sortDir: 'asc' });
    expect(result.map((r) => r.name)).toEqual(['gamma', 'beta', 'alpha', 'delta']);
  });

  it('searches case-insensitively across searchable columns', () => {
    const result = processRows(rows, columns, { ...baseState, search: 'gam' });
    expect(result.map((r) => r.name)).toEqual(['gamma']);
  });

  it('filters by exact column value', () => {
    const result = processRows(rows, columns, { ...baseState, filters: { status: 'failed' } });
    expect(result.map((r) => r.name)).toEqual(['gamma']);
  });

  it('composes filter and search with AND', () => {
    const result = processRows(rows, columns, {
      ...baseState,
      search: 'gam',
      filters: { status: 'failed' },
    });
    expect(result.map((r) => r.name)).toEqual(['gamma']);

    const noMatch = processRows(rows, columns, {
      ...baseState,
      search: 'gam',
      filters: { status: 'ok' },
    });
    expect(noMatch.map((r) => r.name)).toEqual([]);
  });
});

describe('useListControls setSort', () => {
  // Regression test for a Strict Mode bug: setSort previously nested
  // setSortDir(...) inside the setSortKey(prevKey => ...) functional updater.
  // React Strict Mode double-invokes updater functions in dev; both
  // invocations saw the same committed prevKey, so a same-key click fired
  // the direction flip twice and it canceled out (never visibly toggled).
  // Rendering under React.StrictMode reproduces that double-invocation here.
  const strictWrapper = ({ children }) => React.createElement(React.StrictMode, null, children);

  it('toggles direction on repeated same-key setSort calls under Strict Mode', () => {
    const { result } = renderHook(() => useListControls(rows, columns), { wrapper: strictWrapper });

    act(() => {
      result.current.setSort('name');
    });
    expect(result.current.sortKey).toBe('name');
    expect(result.current.sortDir).toBe('asc');

    act(() => {
      result.current.setSort('name');
    });
    expect(result.current.sortKey).toBe('name');
    expect(result.current.sortDir).toBe('desc');
  });
});
