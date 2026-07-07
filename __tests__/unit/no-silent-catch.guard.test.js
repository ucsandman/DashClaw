import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Regression guard: interactive UI code (app/**/*.tsx|jsx) must not swallow a
// failure silently. A bare `catch {}` / `catch (e) {}` with an empty body, or a
// `.catch(() => {})` with an empty arrow body, hides a failed fetch/mutation —
// the exact silent-error class swept out in 4.7.5. New ones must surface the
// failure (error state + Retry for loads, inline error/toast for mutations, or
// console.warn-with-context for background refreshes) instead of disappearing.
//
// The ALLOWLIST is genuinely-intentional fire-and-forget best-effort in
// interactive code (browser-API niceties that must never throw into the UI:
// app-badge, marketing ping, clipboard, service-worker registration). Adding a
// file here requires a real justification — it is the escape hatch, not the norm.
// Server routes (app/api/**) and libs (app/lib/**) are out of scope: they are
// .ts (not scanned here) and legitimately use best-effort catches.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '../../app');

const ALLOWLIST = new Set([
  'approve/page.tsx',           // navigator.setAppBadge/clearAppBadge — best-effort, must not throw into UI
  'components/SetupBanner.tsx',  // marketing-site reachability ping — silently ignored by design
]);

// Empty `catch {}` / `catch (e) {}` (whitespace/newlines only between braces).
const BARE_CATCH = /catch\s*(\([^)]*\))?\s*\{\s*\}/;
// Empty `.catch(() => {})` / `.catch((e) => {})`.
const EMPTY_ARROW_CATCH = /\.catch\(\s*\([^)]*\)\s*=>\s*\{\s*\}\s*\)/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('silent-catch regression guard (interactive code)', () => {
  const files = walk(APP_DIR);

  it('finds interactive source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no bare empty catch / empty .catch(() => {}) in app/**/*.{tsx,jsx} outside the intentional allowlist', () => {
    const violations = [];
    for (const file of files) {
      const rel = path.relative(APP_DIR, file).replace(/\\/g, '/');
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      if (BARE_CATCH.test(src) || EMPTY_ARROW_CATCH.test(src)) violations.push(rel);
    }
    expect(
      violations,
      `Bare empty catch in interactive code — surface the failure (error state + Retry / inline error / console.warn-with-context) or, if genuinely best-effort, add to the ALLOWLIST with justification:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Server-side write surfaces (roadmap v3.3): a silently-swallowed error around
// a DB write is the silent-death bug class the doctor write-canary hunts at
// runtime — this guard kills it at the source. In app/api/** routes and
// app/lib/repositories/** (the ONLY layer allowed to touch SQL, per
// route-sql:check), every catch must either surface the failure
// (console.warn/error with context, structured error response) or rethrow.
// Comment-only catch bodies count: `catch { /* skip */ }` swallows exactly as
// silently as `catch {}` — a vague comment is not telemetry.
//
// The escape hatch is LINE-level, not file-level: a comment-only catch passes
// only when its comment carries the `best-effort:` pragma with a real reason,
// e.g. `catch { /* best-effort: corrupt stored JSON — fall back to default */ }`.
// A file-level allowlist would blind the guard to every FUTURE catch in that
// file; the pragma keeps whole files protected and makes intent auditable at
// the site (`grep -rn "best-effort:" app/` is the exemption ledger).
//
// app/api/_archive/** is excluded (legacy platform surface, not extended).

// Catch whose body is only whitespace and/or comments — swallows silently
// unless the comment declares the best-effort pragma.
const SILENT_CATCH = /catch\s*(\([^)]*\))?\s*\{(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*\}/g;

function walkServer(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '_archive') continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkServer(full));
    else if (/\.(js|ts)$/.test(name) && !/\.(test|spec)\.(js|ts)$/.test(name)) out.push(full);
  }
  return out;
}

describe('silent-catch regression guard (server-side write surfaces)', () => {
  const serverFiles = [
    ...walkServer(path.join(APP_DIR, 'api')),
    ...walkServer(path.join(APP_DIR, 'lib', 'repositories')),
  ];

  it('finds server source files to scan', () => {
    expect(serverFiles.length).toBeGreaterThan(100);
  });

  it('has no silent catch (empty or comment-only without the best-effort pragma) in app/api/** and app/lib/repositories/**', () => {
    const violations = [];
    for (const file of serverFiles) {
      const rel = path.relative(APP_DIR, file).replace(/\\/g, '/');
      const src = readFileSync(file, 'utf8');
      for (const match of src.match(SILENT_CATCH) || []) {
        if (!match.includes('best-effort:')) violations.push(`${rel}: ${match.replace(/\s+/g, ' ')}`);
      }
      if (EMPTY_ARROW_CATCH.test(src)) violations.push(`${rel}: empty .catch(() => {})`);
    }
    expect(
      violations,
      `Silent catch in server-side write surface — surface the failure (console.warn/error with context, or rethrow), or mark a genuinely-benign fallback with the pragma: catch { /* best-effort: <reason> */ }\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
