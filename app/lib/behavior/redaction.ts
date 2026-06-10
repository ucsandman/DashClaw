/**
 * Defensive JS-side redaction for behavior samples. The Python recorder is the
 * primary redactor (it scrubs before anything touches disk), but samples are
 * read back from local files that could have been hand-edited or produced by a
 * third-party emitter (OpenClaw/MoltFire), so the analyzer re-scrubs on ingest.
 *
 * Reuses the single source of truth for secret patterns
 * (`optimal-files/secret-scan.js`) so the recorder, code-sessions, and behavior
 * samples never drift apart on what counts as a secret.
 */

import { scanForSecrets } from '../claude-code/optimal-files/secret-scan';

const MAX_FIELD = 400; // hard cap on any string field length in a sample
const MAX_LIST = 50; // hard cap on path-list lengths

/** Scrub secrets out of a string and bound its length. */
export function redactString<T>(value: T): T | string {
  if (value == null) return value;
  const scanned = scanForSecrets(String(value));
  let out = scanned.redacted;
  if (out.length > MAX_FIELD) out = out.slice(0, MAX_FIELD);
  return out;
}

/** Redact a single path: strip secrets, normalize slashes, bound length. */
export function redactPath<T>(value: T): T | string {
  if (value == null) return value;
  return redactString(String(value).replace(/\\/g, '/'));
}

const STRING_FIELDS = [
  'command_shape', 'declared_goal', 'project', 'agent_name', 'error_type',
];
const PATH_LIST_FIELDS = ['read_paths', 'write_paths'];

/**
 * Defensively re-redact a parsed sample object in place-ish (returns a new
 * object). Never throws — a malformed sample yields a best-effort scrub.
 */
export function redactSample<T>(sample: T): T {
  if (!sample || typeof sample !== 'object') return sample;
  const out = { ...(sample as Record<string, unknown>) };
  for (const f of STRING_FIELDS) {
    if (typeof out[f] === 'string') out[f] = redactString(out[f]);
  }
  for (const f of PATH_LIST_FIELDS) {
    if (Array.isArray(out[f])) {
      out[f] = (out[f] as unknown[]).slice(0, MAX_LIST).map(redactPath).filter((p) => typeof p === 'string');
    }
  }
  // The intel sub-object can carry a free-form bash command summary; scrub it.
  const intel = out.intel as Record<string, unknown> | undefined;
  if (intel && typeof intel === 'object' && intel.bash) {
    const bash = { ...(intel.bash as Record<string, unknown>) };
    if (typeof bash.command_preview === 'string') bash.command_preview = redactString(bash.command_preview);
    out.intel = { ...intel, bash };
  }
  return out as T;
}
