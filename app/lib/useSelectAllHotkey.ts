import { useEffect } from 'react';

/**
 * Global Ctrl/Cmd+A → select-all on a list page. Suppressed while typing in a
 * field (input/textarea/select/contenteditable) so it never hijacks a real
 * text "select all". Pass `enabled=false` to opt a page out conditionally.
 */
export function useSelectAllHotkey(onSelectAll: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
        e.preventDefault();
        onSelectAll();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelectAll, enabled]);
}
