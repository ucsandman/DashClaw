'use client';

import React from 'react';
import { Search, ArrowUpDown, X } from 'lucide-react';
import type { ListColumn, ListControlsState } from '../lib/useListControls';

const FIELD_CLASS =
  'bg-surface-tertiary border border-white/[0.06] rounded-lg px-2 py-1.5 text-xs text-secondary focus:outline-none focus:border-brand transition-colors';

export interface ListControlsBarProps<T> {
  columns: ListColumn<T>[];
  controls: ListControlsState<T>;
  searchPlaceholder?: string;
}

export function ListControlsBar<T>({ columns, controls, searchPlaceholder }: ListControlsBarProps<T>) {
  const { sortKey, sortDir, setSort, search, setSearch, filters, setFilter, clearAll, activeCount } = controls;

  const sortableColumns = columns.filter((c) => c.sortable);
  const filterableColumns = columns.filter((c) => c.filterable);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-3">
      <div className="relative">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none" />
        <input
          type="text"
          aria-label="Search"
          placeholder={searchPlaceholder ?? 'Search…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${FIELD_CLASS} w-40 pl-7`}
        />
      </div>

      {sortableColumns.length > 0 && (
        <select
          aria-label="Sort by"
          value={sortKey ?? ''}
          onChange={(e) => setSort(e.target.value)}
          className={FIELD_CLASS}
        >
          <option value="">Sort…</option>
          {sortableColumns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      )}

      {sortKey && (
        <button
          type="button"
          aria-label={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          onClick={() => setSort(sortKey)}
          className={`${FIELD_CLASS} flex items-center gap-1`}
        >
          <ArrowUpDown size={12} className={sortDir === 'desc' ? 'rotate-180' : ''} />
        </button>
      )}

      {filterableColumns.map((column) => {
        const values = Array.from(
          new Set(
            controls.allRows
              .map((row) => column.accessor(row))
              .filter((v): v is string | number => v !== null && v !== undefined)
              .map((v) => String(v))
          )
        ).sort();

        return (
          <select
            key={column.key}
            aria-label={`Filter by ${column.label}`}
            value={filters[column.key] ?? ''}
            onChange={(e) => setFilter(column.key, e.target.value || null)}
            className={FIELD_CLASS}
          >
            <option value="">All {column.label}</option>
            {values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        );
      })}

      {activeCount > 0 && (
        <button
          type="button"
          aria-label="Clear all filters"
          onClick={clearAll}
          className={`${FIELD_CLASS} flex items-center gap-1`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
