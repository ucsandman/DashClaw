'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';

interface DocsSidebarItem {
  href?: string;
  label?: string;
  indent?: boolean;
}

interface DocsSidebarClientProps {
  items?: DocsSidebarItem[];
}

export default function DocsSidebarClient({ items = [] }: DocsSidebarClientProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalizedQuery) return items;
    return items.filter((item) => {
      const label = String(item.label || '').toLowerCase();
      const href = String(item.href || '').toLowerCase();
      return label.includes(normalizedQuery) || href.includes(normalizedQuery);
    });
  }, [items, normalizedQuery]);

  return (
    <nav className="hidden lg:block sticky top-24 w-56 shrink-0 self-start max-h-[calc(100vh-120px)] overflow-y-auto pr-4 scrollbar-hide hover:scrollbar-default transition-all">
      <div className="mb-3">
        <div className="text-xs text-text-tertiary font-medium uppercase tracking-wider mb-2">On this page</div>
        <div className="relative mb-3">
          <input
            type="search"
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Search methods…"
            className="w-full rounded-full border border-border-hover bg-surface-primary px-3 py-1.5 pr-8 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <Search
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
        </div>
      </div>

      <ul className="space-y-1.5 text-sm pb-8">
        {filtered.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className={`block truncate text-text-secondary hover:text-text-primary transition-colors ${
                item.indent ? 'pl-3 text-xs' : ''
              }`}
              title={item.label}
            >
              {item.label}
            </a>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="pt-2 text-[11px] text-text-tertiary">No matches. Try a different name.</li>
        )}
      </ul>
    </nav>
  );
}
