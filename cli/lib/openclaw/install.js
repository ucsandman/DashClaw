// cli/lib/openclaw/install.js

/**
 * Upsert KEY=value in .env content. Replaces an existing assignment in place so
 * the file never grows a second definition of the same key (the last one would
 * silently win). A commented-out line is not an assignment and is left alone.
 */
export function upsertEnvVar(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(source)) {
    return ensureTrailingNewline(source.replace(pattern, () => line));
  }
  const base = source.length === 0 || source.endsWith('\n') ? source : `${source}\n`;
  return ensureTrailingNewline(base + line);
}

function ensureTrailingNewline(s) {
  return s.endsWith('\n') ? s : `${s}\n`;
}
