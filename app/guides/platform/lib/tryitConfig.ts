// Shared connection config for the guide's interactive panels (Try-It, policy
// playground). Lives only in the reader's browser localStorage — no baked-in
// keys, nothing sent anywhere except the base URL the reader configures.
export const TRYIT_LS_KEY = 'dashclaw-guide-tryit';

export interface TryItConfig {
  baseUrl: string;
  apiKey: string;
}

export function loadTryItConfig(): TryItConfig {
  if (typeof window === 'undefined') return { baseUrl: '', apiKey: '' };
  try {
    const raw = window.localStorage.getItem(TRYIT_LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return { baseUrl: window.location.origin, apiKey: '' };
}

export function saveTryItConfig(config: TryItConfig): void {
  try {
    window.localStorage.setItem(TRYIT_LS_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}
