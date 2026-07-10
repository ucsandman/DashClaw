/**
 * Protected-path matching for the guard engine's `protected_path` policy type
 * (a catastrophe-pack default: destructive touches to auth/middleware/billing/
 * secrets/cron config). Guard-owned so the decide step carries its own matcher
 * independent of any retired behavior-learning tooling.
 *
 * Paths are normalized to forward slashes with any leading `./` stripped before
 * matching, so workspace-relative sample paths and absolute live-guard targets
 * compare consistently. Globs support `**` (any depth, crosses `/`) and `*`
 * (single segment, does not cross `/`).
 */

/**
 * Canonical protected groups. Each group maps a label to a set of globs of
 * high-blast-radius surfaces: auth, middleware, billing, secrets, and
 * cron/gateway config. Globs are intentionally broad (`**`) so a touch
 * anywhere in the tree is caught regardless of the agent's cwd.
 */
export const PROTECTED_PATH_GROUPS: Record<string, string[]> = {
  auth: ['**/auth/**', '**/auth.js', '**/auth.mjs', 'app/login/**', 'app/api/auth/**', '**/authConfig*'],
  middleware: ['middleware.js', 'middleware.ts', '**/middleware.js', '**/middleware.ts'],
  billing: ['**/billing.js', '**/billing/**', 'app/api/billing/**', '**/stripe*'],
  secrets: ['**/secrets/**', '**/.env', '**/.env.*', '**/*.pem', '**/id_rsa*', '**/*.key', 'app/secrets/**'],
  'cron/gateway': ['**/cron/**', 'vercel.json', '**/gateway*', '**/openclaw.json', 'docker-compose.yml', 'Dockerfile'],
};

/** Flattened default protected globs (every group). */
export const DEFAULT_PROTECTED_PATHS: string[] = Object.values(PROTECTED_PATH_GROUPS).flat();

/** Normalize a filesystem path for glob matching. */
export function normalizePath(p: unknown): string {
  if (p == null) return '';
  let s = String(p).trim().replace(/\\/g, '/');
  // Drop a Windows drive prefix (C:/...) so absolute live-guard paths and
  // relative sample paths compare on the same axis.
  s = s.replace(/^[a-zA-Z]:\//, '/');
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

/** Translate a `**`/`*` glob into an anchored, ReDoS-safe RegExp. */
export function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let re = '^';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '*') {
      if (normalized[i + 1] === '*') {
        // `**` (optionally followed by `/`) matches across path segments.
        i++;
        if (normalized[i + 1] === '/') i++;
        re += '.*';
      } else {
        // `*` matches within a single segment.
        re += '[^/]*';
      }
    } else if (c !== undefined && '\\^$.|?+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  re += '$';
  return new RegExp(re);
}

/**
 * True when `path` matches any glob in `patterns`. Also matches when a non-`**`
 * pattern targets a basename or trailing sub-path (so `middleware.js` matches
 * `app/something/middleware.js`), which is the intuitive operator expectation.
 */
export function matchesProtectedPath(path: unknown, patterns: unknown): boolean {
  if (!path || !Array.isArray(patterns) || patterns.length === 0) return false;
  const norm = normalizePath(path);
  if (!norm) return false;
  for (const pattern of patterns) {
    if (!pattern) continue;
    const re = globToRegExp(pattern);
    if (re.test(norm)) return true;
    // A bare relative pattern (no leading `**`) should still catch the file when
    // it lives deeper in the tree than the agent's cwd-relative path implies.
    if (!String(pattern).startsWith('**') && !String(pattern).startsWith('/')) {
      const suffixRe = globToRegExp('**/' + pattern);
      if (suffixRe.test(norm)) return true;
    }
  }
  return false;
}
