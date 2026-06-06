const LAYOUT_STORAGE_KEY = 'dashclaw_dashboard_layouts';
const NAMED_LAYOUTS_KEY = 'dashclaw_named_layouts';
// Bumped 9 → 10: a prior min height of 2 rows (160px) let cards be dragged/saved
// small enough to clip their content. Raising minH to 3 only stops *new* shrinks;
// bumping the version discards already-saved layouts so returning users get the
// roomier defaults instead of a stuck collapsed grid.
const LAYOUT_VERSION = 10;

type LayoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadLayouts(
  storage: LayoutStorage | null | undefined = globalThis?.localStorage,
): unknown {
  try {
    if (!storage) return null;
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== LAYOUT_VERSION) return null;
    return parsed.layouts;
  } catch {
    return null;
  }
}

export function saveLayouts(
  layouts: unknown,
  storage: LayoutStorage | null | undefined = globalThis?.localStorage,
): void {
  try {
    if (storage) {
      storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, layouts }));
    }
  } catch {
    // ignore storage errors
  }
}

export function clearLayouts(
  storage: LayoutStorage | null | undefined = globalThis?.localStorage,
): void {
  try {
    if (storage) {
      storage.removeItem(LAYOUT_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function loadNamedLayouts(
  storage: LayoutStorage | null | undefined = globalThis?.localStorage,
): Record<string, unknown> {
  try {
    if (!storage) return {};
    const raw = storage.getItem(NAMED_LAYOUTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveNamedLayout(
  name: string,
  layouts: unknown,
  storage: LayoutStorage | null | undefined = globalThis?.localStorage,
): void {
  try {
    if (!storage) return;
    const named = loadNamedLayouts(storage);
    named[name] = { layouts, savedAt: new Date().toISOString() };
    storage.setItem(NAMED_LAYOUTS_KEY, JSON.stringify(named));
  } catch {
    // ignore storage errors
  }
}

export function deleteNamedLayout(
  name: string,
  storage: LayoutStorage | null | undefined = globalThis?.localStorage,
): void {
  try {
    if (!storage) return;
    const named = loadNamedLayouts(storage);
    delete named[name];
    storage.setItem(NAMED_LAYOUTS_KEY, JSON.stringify(named));
  } catch {
    // ignore storage errors
  }
}
