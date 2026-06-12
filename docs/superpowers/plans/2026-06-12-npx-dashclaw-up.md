# `npx dashclaw up` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command (`npx dashclaw up`) takes a machine with only Node 20+ to a running localhost DashClaw with DB, secrets, minted key, and Claude Code hooks wired.

**Architecture:** All new logic lives in `@dashclaw/cli` as an `up`/`down` command group (`cli/lib/up/`). The CLI downloads the release tarball to `~/.dashclaw/app/<version>`, provisions Postgres (Docker → embedded → paste-URL ladder), then drives the app's own `scripts/setup.mjs` in a new non-interactive mode (no fork of setup logic), builds, starts `next start`, and chains into the existing `installClaude()` with the minted key. A checkpointed `~/.dashclaw/instance.json` makes `up` resumable and idempotent. The bare `dashclaw` SDK package gains a bin shim that forwards to `@dashclaw/cli`.

**Tech Stack:** Node 20 ESM, vitest (tests at `cli/test/` + `__tests__/unit/`, run by root `npx vitest run`), `tar` + `embedded-postgres` npm packages (new CLI deps), GitHub Actions 3-OS matrix.

**Spec:** `docs/superpowers/specs/2026-06-12-npx-dashclaw-up-design.md`

**Conventions for every task:** repo root is `C:\Projects\DashClaw`. Run tests with `npx vitest run <file>` from the repo root. Commit after each green task. Never log secrets. CLI files are plain JS ESM (no TS). Match `cli/lib/` style: small modules, dependency-injected `fetchImpl`/`prompt`/`logger` for testability (see `cli/lib/claude/install.js:268` for the house pattern).

---

### Task 1: Non-interactive mode for `scripts/setup.mjs`

The CLI must drive the app's own setup script — single source of truth for secrets/key-mint/migrations. Add `--yes`, `--database-url <url>`, `--json` flags.

**Files:**
- Create: `scripts/lib/setup-args.mjs`
- Modify: `scripts/setup.mjs` (functions `chooseDatabaseUrl` ~line 212, plus every `ask`/`askSecret` call site)
- Test: `__tests__/unit/setup-args.test.js`

- [ ] **Step 1: Write the failing test**

```js
// __tests__/unit/setup-args.test.js
import { describe, expect, it } from 'vitest';
import { parseSetupArgs } from '../../scripts/lib/setup-args.mjs';

describe('parseSetupArgs', () => {
  it('defaults to interactive', () => {
    expect(parseSetupArgs([])).toEqual({ yes: false, databaseUrl: null, json: false });
  });
  it('parses the non-interactive trio', () => {
    expect(parseSetupArgs(['--yes', '--database-url', 'postgresql://u:p@h:5433/db', '--json']))
      .toEqual({ yes: true, databaseUrl: 'postgresql://u:p@h:5433/db', json: true });
  });
  it('rejects a non-postgres database-url', () => {
    expect(() => parseSetupArgs(['--database-url', 'mysql://x'])).toThrow(/postgresql:\/\//);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run __tests__/unit/setup-args.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement `scripts/lib/setup-args.mjs`**

```js
// Parsed by scripts/setup.mjs AND unit-testable in isolation.
export function parseSetupArgs(argv) {
  const out = { yes: false, databaseUrl: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') out.yes = true;
    else if (a === '--json') out.json = true;
    else if (a === '--database-url') {
      const v = argv[++i];
      if (!v || !v.startsWith('postgresql://')) {
        throw new Error('--database-url must be a postgresql:// connection string');
      }
      out.databaseUrl = v;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test, verify PASS.**

- [ ] **Step 5: Inventory every prompt in `scripts/setup.mjs`.** Read the whole file and list each `ask(`/`askSecret(` call site (DB choice, any confirm prompts). This inventory drives Step 6 — paste it into the task notes.

- [ ] **Step 6: Wire the flags into `setup.mjs`.** At the top of `main()`:

```js
import { parseSetupArgs } from './lib/setup-args.mjs';
const cliArgs = parseSetupArgs(process.argv.slice(2));
```

Then, per the Step-5 inventory: (a) in `chooseDatabaseUrl(env)`, short-circuit before any prompt:

```js
if (cliArgs.databaseUrl) { env.DATABASE_URL = cliArgs.databaseUrl; return; }
```

(b) every remaining `await ask(q)` becomes `cliArgs.yes ? <its documented default> : await ask(q)` — use the default the prompt text already advertises; if a prompt has no default, the default for `--yes` is the safe choice (skip optional things, proceed on confirms). (c) at the very end of a successful run, when `cliArgs.json` is set, print exactly one JSON line to stdout (everything else the script prints must go to stderr in this mode — switch its `console.log` calls to `console.error` when `cliArgs.json`):

```js
if (cliArgs.json) {
  console.log(JSON.stringify({
    apiKey: env.DASHCLAW_API_KEY,
    adminPassword: env.DASHCLAW_LOCAL_ADMIN_PASSWORD ?? null,
  }));
}
```

- [ ] **Step 7: Manual verification against a throwaway DB** (uses your local dev Postgres or Docker):

Run: `node --import tsx scripts/setup.mjs --yes --database-url "postgresql://dashclaw:dashclaw@localhost:5433/dashclaw_setuptest" --json`
Expected: exits 0; stdout is ONE parseable JSON line with an `oc_live_`-prefixed `apiKey`; `.env.local` untouched fields preserved. Restore your `.env.local` afterward (`git checkout -- .env.local` is NOT enough — it's untracked; back it up first: `cp .env.local .env.local.bak` before, `mv .env.local.bak .env.local` after).

- [ ] **Step 8: Run gates for the touched area** — `npx vitest run __tests__/unit/setup-args.test.js` and `npm run lint`. PASS.

- [ ] **Step 9: Commit** — `git add scripts/lib/setup-args.mjs scripts/setup.mjs __tests__/unit/setup-args.test.js && git commit -m "feat(setup): non-interactive mode (--yes --database-url --json) for CLI orchestration"`

---

### Task 2: `up` argument parser

**Files:**
- Create: `cli/lib/up/args.js`
- Test: `cli/test/up/args.test.js`

- [ ] **Step 1: Write the failing test**

```js
// cli/test/up/args.test.js
import { describe, expect, it } from 'vitest';
import { parseUpArgs } from '../../lib/up/args.js';

describe('parseUpArgs', () => {
  it('defaults', () => {
    expect(parseUpArgs([])).toEqual({
      update: false, yes: false, noBrowser: false,
      db: null, dir: null, port: null, sourceDir: null,
    });
  });
  it('parses all flags', () => {
    expect(parseUpArgs(['--update', '--yes', '--no-browser', '--db', 'embedded', '--dir', '/x', '--port', '3210', '--source-dir', '.']))
      .toEqual({ update: true, yes: true, noBrowser: true, db: 'embedded', dir: '/x', port: 3210, sourceDir: '.' });
  });
  it('rejects unknown --db values', () => {
    expect(() => parseUpArgs(['--db', 'sqlite'])).toThrow(/docker, embedded, url/);
  });
  it('rejects a non-numeric port', () => {
    expect(() => parseUpArgs(['--port', 'abc'])).toThrow(/port/i);
  });
});
```

- [ ] **Step 2: Run it, verify FAIL** — `npx vitest run cli/test/up/args.test.js`.

- [ ] **Step 3: Implement `cli/lib/up/args.js`**

```js
const DB_MODES = ['docker', 'embedded', 'url'];

export function parseUpArgs(argv) {
  const out = { update: false, yes: false, noBrowser: false, db: null, dir: null, port: null, sourceDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update') out.update = true;
    else if (a === '--yes') out.yes = true;
    else if (a === '--no-browser') out.noBrowser = true;
    else if (a === '--db') {
      const v = argv[++i];
      if (!DB_MODES.includes(v)) throw new Error(`--db must be one of: ${DB_MODES.join(', ')} (docker, embedded, url)`);
      out.db = v;
    } else if (a === '--dir') out.dir = argv[++i] ?? null;
    else if (a === '--source-dir') out.sourceDir = argv[++i] ?? null;
    else if (a === '--port') {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw new Error('--port must be an integer 1-65535');
      out.port = v;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test, PASS.**
- [ ] **Step 5: Commit** — `git add cli/lib/up/args.js cli/test/up/args.test.js && git commit -m "feat(cli): up command flag parser"`

---

### Task 3: Instance state (`instance.json` checkpoints)

**Files:**
- Create: `cli/lib/up/instance.js`
- Test: `cli/test/up/instance.test.js`

- [ ] **Step 1: Write the failing test**

```js
// cli/test/up/instance.test.js
import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadInstance, saveInstance, checkpoint, STEPS } from '../../lib/up/instance.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dc-inst-')); });

describe('instance state', () => {
  it('returns null when no instance exists', () => {
    expect(loadInstance(dir)).toBeNull();
  });
  it('round-trips and checkpoints in order', () => {
    saveInstance(dir, { version: '4.21.0', port: 3000, dbMode: 'embedded' });
    checkpoint(dir, 'db_ready');
    const inst = loadInstance(dir);
    expect(inst.version).toBe('4.21.0');
    expect(inst.completed).toEqual(['db_ready']);
  });
  it('checkpoint is idempotent', () => {
    saveInstance(dir, {});
    checkpoint(dir, 'db_ready');
    checkpoint(dir, 'db_ready');
    expect(loadInstance(dir).completed).toEqual(['db_ready']);
  });
  it('exposes the canonical step order', () => {
    expect(STEPS).toEqual(['app_fetched', 'deps_installed', 'db_ready', 'setup_done', 'built', 'connected']);
  });
  it('tolerates a corrupt file (returns null, does not throw)', () => {
    saveInstance(dir, {});
    const { writeFileSync } = require('node:fs');
    writeFileSync(join(dir, 'instance.json'), 'not-json');
    expect(loadInstance(dir)).toBeNull();
  });
});
```

(If `require` is unavailable under ESM vitest config, use `import { writeFileSync } from 'node:fs'` at top instead — keep the corrupt-file behavior assertion.)

- [ ] **Step 2: Run it, verify FAIL.**

- [ ] **Step 3: Implement `cli/lib/up/instance.js`**

```js
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Step order is the resume contract: `up` re-runs the first step NOT in `completed`.
export const STEPS = ['app_fetched', 'deps_installed', 'db_ready', 'setup_done', 'built', 'connected'];

const fileFor = (dir) => join(dir, 'instance.json');

export function loadInstance(dir) {
  try {
    const raw = readFileSync(fileFor(dir), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null; // missing or corrupt — caller treats as fresh install
  }
}

export function saveInstance(dir, data) {
  mkdirSync(dir, { recursive: true });
  const current = loadInstance(dir) ?? { completed: [] };
  const next = { ...current, ...data, completed: data.completed ?? current.completed ?? [] };
  writeFileSync(fileFor(dir), JSON.stringify(next, null, 2) + '\n');
  return next;
}

export function checkpoint(dir, step) {
  const inst = loadInstance(dir) ?? { completed: [] };
  if (!inst.completed.includes(step)) inst.completed.push(step);
  writeFileSync(fileFor(dir), JSON.stringify(inst, null, 2) + '\n');
  return inst;
}
```

- [ ] **Step 4: Run test, PASS.**
- [ ] **Step 5: Commit** — `git add cli/lib/up/instance.js cli/test/up/instance.test.js && git commit -m "feat(cli): checkpointed instance state for resumable up"`

---

### Task 4: Version resolve + tarball fetch/extract

**Files:**
- Create: `cli/lib/up/fetch-app.js`
- Test: `cli/test/up/fetch-app.test.js`
- Modify: `cli/package.json` (add `"tar": "^7.4.0"` to dependencies; run `npm install` inside `cli/`)

- [ ] **Step 1: Write the failing test**

```js
// cli/test/up/fetch-app.test.js
import { describe, expect, it, vi } from 'vitest';
import { resolveAppVersion, tarballUrl } from '../../lib/up/fetch-app.js';

describe('resolveAppVersion', () => {
  it('reads the latest platform version from the npm registry', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: '4.21.0' }), { status: 200 }));
    await expect(resolveAppVersion(fetchImpl)).resolves.toBe('4.21.0');
    expect(fetchImpl).toHaveBeenCalledWith('https://registry.npmjs.org/dashclaw/latest');
  });
  it('throws a clear error on registry failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(resolveAppVersion(fetchImpl)).rejects.toThrow(/registry/i);
  });
});

describe('tarballUrl', () => {
  it('builds the codeload URL for the version tag', () => {
    expect(tarballUrl('4.21.0'))
      .toBe('https://codeload.github.com/ucsandman/DashClaw/tar.gz/refs/tags/v4.21.0');
  });
});
```

- [ ] **Step 2: Run it, verify FAIL.**

- [ ] **Step 3: Implement `cli/lib/up/fetch-app.js`**

```js
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as tar from 'tar';

const REPO = 'ucsandman/DashClaw';

export async function resolveAppVersion(fetchImpl = fetch) {
  const res = await fetchImpl('https://registry.npmjs.org/dashclaw/latest');
  if (!res.ok) throw new Error(`npm registry lookup failed (${res.status}) — check your network and retry.`);
  const { version } = await res.json();
  if (!version) throw new Error('npm registry returned no version for dashclaw.');
  return version;
}

export function tarballUrl(version) {
  return `https://codeload.github.com/${REPO}/tar.gz/refs/tags/v${version}`;
}

/**
 * Download + extract the app for `version` into `${baseDir}/app/${version}`.
 * The GitHub tarball wraps everything in a `DashClaw-<version>/` folder —
 * strip 1 level so the app root lands directly in the target dir.
 * Skips cleanly if the target already exists (resume case).
 */
export async function downloadAndExtract({ version, baseDir, fetchImpl = fetch, logger = console }) {
  const target = join(baseDir, 'app', version);
  if (existsSync(join(target, 'package.json'))) {
    logger.error(`✓ App ${version} already present at ${target}`);
    return target;
  }
  mkdirSync(target, { recursive: true });
  const res = await fetchImpl(tarballUrl(version));
  if (!res.ok || !res.body) {
    rmSync(target, { recursive: true, force: true });
    throw new Error(`Download failed (${res.status}) for ${tarballUrl(version)} — does tag v${version} exist?`);
  }
  await pipeline(Readable.fromWeb(res.body), tar.x({ cwd: target, strip: 1 }));
  if (!existsSync(join(target, 'package.json'))) {
    rmSync(target, { recursive: true, force: true });
    throw new Error('Extracted tarball did not contain package.json — aborting.');
  }
  return target;
}
```

- [ ] **Step 4: Run unit tests, PASS** (`downloadAndExtract` is covered by the CI smoke + a local fixture check next step).

- [ ] **Step 5: Fixture check for extraction.** Create a tiny tarball and add this test to the same file:

```js
import { mkdtempSync, mkdirSync as mk, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { downloadAndExtract } from '../../lib/up/fetch-app.js';

describe('downloadAndExtract', () => {
  it('strips the wrapper dir and verifies package.json', async () => {
    const work = mkdtempSync(join(tmpdir(), 'dc-tar-'));
    mk(join(work, 'DashClaw-9.9.9'), { recursive: true });
    writeFileSync(join(work, 'DashClaw-9.9.9', 'package.json'), '{"name":"x"}');
    const tarPath = join(work, 'app.tgz');
    await tar.c({ gzip: true, file: tarPath, cwd: work }, ['DashClaw-9.9.9']);
    const { readFileSync } = await import('node:fs');
    const body = readFileSync(tarPath);
    const fetchImpl = async () => new Response(body, { status: 200 });
    const out = await downloadAndExtract({ version: '9.9.9', baseDir: work, fetchImpl, logger: { error() {} } });
    expect(out.endsWith(join('app', '9.9.9'))).toBe(true);
  });
});
```

Run: `npx vitest run cli/test/up/fetch-app.test.js` → PASS.

- [ ] **Step 6: Commit** — `git add cli/lib/up/fetch-app.js cli/test/up/fetch-app.test.js cli/package.json cli/package-lock.json && git commit -m "feat(cli): release tarball fetch + extract for up"`

---

### Task 5: Database ladder (Docker → embedded → URL)

**Files:**
- Create: `cli/lib/up/db.js`
- Test: `cli/test/up/db.test.js`
- Modify: `cli/package.json` (add `"embedded-postgres": "^17.5.0"`)

- [ ] **Step 1: VERIFY the embedded-postgres API before coding.** Use Context7 (`resolve-library-id` → `query-docs` for `embedded-postgres`) or the package README on npm. Confirm: constructor options (`databaseDir`, `user`, `password`, `port`, `persistent`), and the method names `initialise()`, `start()`, `createDatabase(name)`, `stop()`. If any differ, adjust the code in Step 4 to the real API — the test in Step 2 mocks the module, so it pins OUR wrapper's contract, not theirs.

- [ ] **Step 2: Write the failing test**

```js
// cli/test/up/db.test.js
import { describe, expect, it, vi } from 'vitest';
import { chooseDbMode, dockerCommandFor } from '../../lib/up/db.js';

describe('chooseDbMode', () => {
  it('honors an explicit --db flag', async () => {
    await expect(chooseDbMode({ flagDb: 'embedded', dockerAvailable: true })).resolves.toBe('embedded');
  });
  it('defaults to docker when docker is available and --yes', async () => {
    await expect(chooseDbMode({ flagDb: null, dockerAvailable: true, yes: true })).resolves.toBe('docker');
  });
  it('defaults to embedded when docker is absent and --yes', async () => {
    await expect(chooseDbMode({ flagDb: null, dockerAvailable: false, yes: true })).resolves.toBe('embedded');
  });
  it('prompts interactively otherwise', async () => {
    const promptFn = vi.fn(async () => '3');
    await expect(chooseDbMode({ flagDb: null, dockerAvailable: true, yes: false, promptFn })).resolves.toBe('url');
  });
});

describe('dockerCommandFor', () => {
  it('mirrors docker-compose.yml (postgres:16-alpine, port 5433, named volume)', () => {
    const { args } = dockerCommandFor();
    expect(args).toContain('postgres:16-alpine');
    expect(args.join(' ')).toContain('5433:5432');
    expect(args.join(' ')).toContain('dashclaw_pgdata');
  });
});
```

- [ ] **Step 3: Run it, verify FAIL.**

- [ ] **Step 4: Implement `cli/lib/up/db.js`**

```js
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export const LOCAL_DB_URL = 'postgresql://dashclaw:dashclaw@localhost:5433/dashclaw';
const CONTAINER = 'dashclaw-pg';

export function dockerAvailableSync() {
  return spawnSync('docker', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
}

export async function chooseDbMode({ flagDb, dockerAvailable, yes = false, promptFn }) {
  if (flagDb) return flagDb;
  if (yes) return dockerAvailable ? 'docker' : 'embedded';
  const lines = [
    'Database — pick one:',
    dockerAvailable ? '  1. Docker Postgres (Docker detected)   [default]' : '  1. Docker Postgres (Docker NOT detected)',
    `  2. Embedded Postgres (no Docker needed, ~40 MB download)${dockerAvailable ? '' : '   [default]'}`,
    '  3. I have a postgresql:// URL',
  ];
  const def = dockerAvailable ? '1' : '2';
  const answer = (await promptFn(`${lines.join('\n')}\nChoice [${def}]: `)).trim() || def;
  return { 1: 'docker', 2: 'embedded', 3: 'url' }[answer] ?? (dockerAvailable ? 'docker' : 'embedded');
}

export function dockerCommandFor() {
  return {
    cmd: 'docker',
    args: [
      'run', '-d', '--name', CONTAINER,
      '-e', 'POSTGRES_USER=dashclaw', '-e', 'POSTGRES_PASSWORD=dashclaw', '-e', 'POSTGRES_DB=dashclaw',
      '-p', '5433:5432', '-v', 'dashclaw_pgdata:/var/lib/postgresql/data',
      'postgres:16-alpine',
    ],
  };
}

function dockerStartOrRun(logger) {
  const shell = process.platform === 'win32';
  // Existing container (any state) → start it; else create it.
  const ps = spawnSync('docker', ['ps', '-aq', '--filter', `name=^${CONTAINER}$`], { encoding: 'utf8', shell });
  if ((ps.stdout || '').trim()) {
    execFileSync('docker', ['start', CONTAINER], { stdio: 'ignore', shell });
  } else {
    const { cmd, args } = dockerCommandFor();
    execFileSync(cmd, args, { stdio: 'ignore', shell });
  }
  logger.error('✓ Docker Postgres running (container dashclaw-pg, port 5433)');
}

/**
 * Provision per mode. Returns { databaseUrl, stop } — stop() is a no-op for
 * docker (left running) and url; for embedded it stops the child server.
 */
export async function provisionDatabase({ mode, baseDir, promptFn, logger = console }) {
  if (mode === 'url') {
    const url = (await promptFn('postgresql:// connection string: ')).trim();
    if (!url.startsWith('postgresql://')) throw new Error('That is not a postgresql:// URL.');
    return { databaseUrl: url, stop: async () => {} };
  }
  if (mode === 'docker') {
    dockerStartOrRun(logger);
    await waitForPort(5433, 30_000);
    return { databaseUrl: LOCAL_DB_URL, stop: async () => {} };
  }
  // embedded
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: join(baseDir, 'pg'),
    user: 'dashclaw', password: 'dashclaw', port: 5433, persistent: true,
  });
  await pg.initialise();
  await pg.start();
  try { await pg.createDatabase('dashclaw'); } catch { /* exists on resume — fine */ }
  logger.error('✓ Embedded Postgres running (port 5433, data in ~/.dashclaw/pg)');
  return { databaseUrl: LOCAL_DB_URL, stop: () => pg.stop() };
}

async function waitForPort(port, timeoutMs) {
  const net = await import('node:net');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Postgres did not accept connections on :${port} within ${timeoutMs / 1000}s.`);
}
```

- [ ] **Step 5: Run tests, PASS.** (Embedded path is exercised for real by the CI smoke in Task 9 — `--db embedded` on all 3 OSes.)
- [ ] **Step 6: Commit** — `git add cli/lib/up/db.js cli/test/up/db.test.js cli/package.json cli/package-lock.json && git commit -m "feat(cli): database ladder for up (docker/embedded/url)"`

---

### Task 6: Build, start, health-wait, open

**Files:**
- Create: `cli/lib/up/run.js`
- Test: `cli/test/up/run.test.js`

- [ ] **Step 1: Write the failing test**

```js
// cli/test/up/run.test.js
import { describe, expect, it, vi } from 'vitest';
import { waitForHealth } from '../../lib/up/run.js';

describe('waitForHealth', () => {
  it('resolves once /api/health returns 200', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => new Response('{}', { status: ++calls < 3 ? 503 : 200 }));
    await waitForHealth({ baseUrl: 'http://localhost:3999', fetchImpl, timeoutMs: 5_000, intervalMs: 1 });
    expect(calls).toBe(3);
  });
  it('throws after the timeout with the last status', async () => {
    const fetchImpl = vi.fn(async () => new Response('x', { status: 500 }));
    await expect(
      waitForHealth({ baseUrl: 'http://localhost:3999', fetchImpl, timeoutMs: 20, intervalMs: 5 }),
    ).rejects.toThrow(/health.*500/i);
  });
  it('treats network errors as not-yet-up, not fatal', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => { if (++calls < 2) throw new Error('ECONNREFUSED'); return new Response('{}', { status: 200 }); });
    await waitForHealth({ baseUrl: 'http://localhost:3999', fetchImpl, timeoutMs: 5_000, intervalMs: 1 });
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, verify FAIL.**

- [ ] **Step 3: Implement `cli/lib/up/run.js`**

```js
import { spawn, spawnSync } from 'node:child_process';

const shell = process.platform === 'win32';

function npm(args, cwd, logger) {
  logger.error(`→ npm ${args.join(' ')}`);
  const res = spawnSync('npm', args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], shell });
  if (res.status !== 0) throw new Error(`npm ${args[0]} failed (exit ${res.status}). Re-run \`npx dashclaw up\` to resume from this step.`);
}

export function installDeps(appDir, logger = console) {
  try { npm(['ci', '--no-audit', '--no-fund'], appDir, logger); }
  catch { npm(['install', '--no-audit', '--no-fund'], appDir, logger); } // lockfile mismatch fallback
}

export function buildApp(appDir, logger = console) {
  npm(['run', 'build'], appDir, logger);
}

/** Start `next start` as a detached-from-stdin child; returns the child. .env.local in appDir is loaded by Next itself. */
export function startServer({ appDir, port, logger = console }) {
  logger.error(`→ Starting server on :${port}`);
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    cwd: appDir, stdio: ['ignore', 'inherit', 'inherit'], shell,
  });
  return child;
}

export async function waitForHealth({ baseUrl, fetchImpl = fetch, timeoutMs = 60_000, intervalMs = 1000 }) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`${baseUrl}/api/health`);
      if (res.status === 200) return;
      lastStatus = res.status;
    } catch { lastStatus = 'connection refused'; }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Server health check failed: /api/health last answered ${lastStatus}. Check the server output above.`);
}

export function openBrowser(url, logger = console) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); }
  catch { logger.error(`Open ${url} in your browser.`); }
}
```

- [ ] **Step 4: Run test, PASS.**
- [ ] **Step 5: Commit** — `git add cli/lib/up/run.js cli/test/up/run.test.js && git commit -m "feat(cli): build/start/health-wait/open for up"`

---

### Task 7: Orchestrator + `up`/`down` wiring

**Files:**
- Create: `cli/lib/up/index.js`
- Modify: `cli/bin/dashclaw.js` (imports at top; two new `case`s in the top-level `switch (command)` — find it via `grep -n "case 'doctor'" cli/bin/dashclaw.js` and add alongside; also add `up`/`down` lines to the help text)
- Test: `cli/test/up/orchestrator.test.js`

- [ ] **Step 1: Write the failing test** — the orchestrator takes every effect as an injected dependency, so the test pins step order, checkpoint/resume, and the chain into installClaude:

```js
// cli/test/up/orchestrator.test.js
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUp } from '../../lib/up/index.js';
import { loadInstance, saveInstance, checkpoint } from '../../lib/up/instance.js';

function makeDeps(overrides = {}) {
  return {
    resolveAppVersion: vi.fn(async () => '9.9.9'),
    downloadAndExtract: vi.fn(async ({ baseDir }) => join(baseDir, 'app', '9.9.9')),
    installDeps: vi.fn(),
    chooseDbMode: vi.fn(async () => 'embedded'),
    provisionDatabase: vi.fn(async () => ({ databaseUrl: 'postgresql://x', stop: vi.fn() })),
    runSetupScript: vi.fn(async () => ({ apiKey: 'oc_live_test', adminPassword: 'pw' })),
    buildApp: vi.fn(),
    startServer: vi.fn(() => ({ pid: 4242, on: vi.fn() })),
    waitForHealth: vi.fn(async () => {}),
    installClaude: vi.fn(async () => {}),
    openBrowser: vi.fn(),
    promptFn: vi.fn(async () => ''), // Enter on every prompt
    logger: { error: vi.fn(), log: vi.fn() },
    dockerAvailable: false,
    ...overrides,
  };
}

let baseDir;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'dc-up-')); });

describe('runUp', () => {
  it('runs the full pipeline in order and checkpoints every step', async () => {
    const deps = makeDeps();
    await runUp({ args: { yes: true, db: 'embedded', noBrowser: true }, baseDir, deps });
    const inst = loadInstance(baseDir);
    expect(inst.completed).toEqual(['app_fetched', 'deps_installed', 'db_ready', 'setup_done', 'built', 'connected']);
    expect(deps.installClaude).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'http://localhost:3000', apiKey: 'oc_live_test',
    }));
    expect(deps.openBrowser).not.toHaveBeenCalled(); // --no-browser
  });

  it('resumes: completed steps are skipped', async () => {
    const deps = makeDeps();
    saveInstance(baseDir, { version: '9.9.9', port: 3000, dbMode: 'embedded', appDir: join(baseDir, 'app', '9.9.9') });
    checkpoint(baseDir, 'app_fetched');
    checkpoint(baseDir, 'deps_installed');
    await runUp({ args: { yes: true, db: 'embedded', noBrowser: true }, baseDir, deps });
    expect(deps.downloadAndExtract).not.toHaveBeenCalled();
    expect(deps.installDeps).not.toHaveBeenCalled();
    expect(deps.provisionDatabase).toHaveBeenCalled();
  });

  it('boot mode: a fully-completed instance just provisions DB + starts + opens', async () => {
    const deps = makeDeps();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded', apiKey: 'oc_live_test',
      appDir: join(baseDir, 'app', '9.9.9'),
      completed: ['app_fetched', 'deps_installed', 'db_ready', 'setup_done', 'built', 'connected'],
    });
    await runUp({ args: { yes: true, noBrowser: false }, baseDir, deps });
    expect(deps.downloadAndExtract).not.toHaveBeenCalled();
    expect(deps.runSetupScript).not.toHaveBeenCalled();
    expect(deps.startServer).toHaveBeenCalled();
    expect(deps.openBrowser).toHaveBeenCalled();
  });

  it('skips connect when the user declines', async () => {
    const deps = makeDeps({ promptFn: vi.fn(async () => 'n') });
    await runUp({ args: { yes: false, db: 'embedded', noBrowser: true }, baseDir, deps });
    expect(deps.installClaude).not.toHaveBeenCalled();
    // 'connected' checkpoint still set — declining is a completed decision, not a pending step
    expect(loadInstance(baseDir).completed).toContain('connected');
  });
});
```

- [ ] **Step 2: Run it, verify FAIL.**

- [ ] **Step 3: Implement `cli/lib/up/index.js`**

```js
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseUpArgs } from './args.js';
import { loadInstance, saveInstance, checkpoint, STEPS } from './instance.js';
import * as fetchApp from './fetch-app.js';
import * as db from './db.js';
import * as runMod from './run.js';
import { installClaude as realInstallClaude } from '../claude/install.js';
import { ask } from '../config.js';

const DEFAULT_PORT = 3000;

/** Drive the app's own setup script non-interactively; returns its --json payload. */
export async function runSetupScriptReal({ appDir, databaseUrl, logger }) {
  logger.error('→ Generating secrets, minting API key, applying migrations…');
  const res = spawnSync('node', ['--import', 'tsx', 'scripts/setup.mjs', '--yes', '--json', '--database-url', databaseUrl], {
    cwd: appDir, encoding: 'utf8', shell: process.platform === 'win32',
  });
  if (res.status !== 0) throw new Error(`setup failed:\n${res.stderr?.slice(-2000)}`);
  const lastLine = res.stdout.trim().split('\n').at(-1);
  return JSON.parse(lastLine); // { apiKey, adminPassword }
}

const realDeps = () => ({
  resolveAppVersion: fetchApp.resolveAppVersion,
  downloadAndExtract: fetchApp.downloadAndExtract,
  installDeps: runMod.installDeps,
  chooseDbMode: db.chooseDbMode,
  provisionDatabase: db.provisionDatabase,
  runSetupScript: runSetupScriptReal,
  buildApp: runMod.buildApp,
  startServer: runMod.startServer,
  waitForHealth: runMod.waitForHealth,
  installClaude: realInstallClaude,
  openBrowser: runMod.openBrowser,
  promptFn: ask,
  logger: console,
  dockerAvailable: db.dockerAvailableSync(),
});

export async function runUp({ args, baseDir = join(homedir(), '.dashclaw'), deps = realDeps() }) {
  const { logger } = deps;
  let inst = loadInstance(baseDir) ?? saveInstance(baseDir, { completed: [] });
  const done = (s) => inst.completed?.includes(s);
  const port = args.port ?? inst.port ?? DEFAULT_PORT;
  const baseUrl = `http://localhost:${port}`;

  if (args.update) inst = saveInstance(baseDir, { completed: [] }); // full refresh keeps pgdata

  // 1. Fetch app
  let appDir = inst.appDir;
  if (!done('app_fetched') || !appDir) {
    const version = args.sourceDir ? 'source' : await deps.resolveAppVersion();
    appDir = args.sourceDir ?? await deps.downloadAndExtract({ version, baseDir, logger });
    inst = saveInstance(baseDir, { version, appDir, port });
    inst = checkpoint(baseDir, 'app_fetched');
  }

  // 2. Dependencies
  if (!done('deps_installed')) {
    deps.installDeps(appDir, logger);
    inst = checkpoint(baseDir, 'deps_installed');
  }

  // 3. Database (always re-provision on boot — it is idempotent and restarts stopped DBs)
  const dbMode = inst.dbMode ?? await deps.chooseDbMode({
    flagDb: args.db, dockerAvailable: deps.dockerAvailable, yes: args.yes, promptFn: deps.promptFn,
  });
  const { databaseUrl, stop: stopDb } = await deps.provisionDatabase({ mode: dbMode, baseDir, promptFn: deps.promptFn, logger });
  if (!done('db_ready')) {
    inst = saveInstance(baseDir, { dbMode, databaseUrl });
    inst = checkpoint(baseDir, 'db_ready');
  }

  // 4. Setup (secrets, key, migrations — the app's own script)
  let apiKey = inst.apiKey;
  if (!done('setup_done')) {
    const out = await deps.runSetupScript({ appDir, databaseUrl, logger });
    apiKey = out.apiKey;
    inst = saveInstance(baseDir, { apiKey });
    if (out.adminPassword) logger.error(`✓ Local admin password (printed once, also in ${join(appDir, '.env.local')}): ${out.adminPassword}`);
    inst = checkpoint(baseDir, 'setup_done');
  }

  // 5. Build
  if (!done('built')) {
    deps.buildApp(appDir, logger);
    inst = checkpoint(baseDir, 'built');
  }

  // 6. Start + health
  const child = deps.startServer({ appDir, port, logger });
  saveInstance(baseDir, { pid: child.pid });
  await deps.waitForHealth({ baseUrl });
  logger.error(`✓ Server running at ${baseUrl}   (Ctrl+C stops it; \`dashclaw up\` restarts it)`);

  // 7. Connect Claude Code
  if (!done('connected')) {
    const yn = args.yes ? 'y' : (await deps.promptFn('Connect Claude Code now? [Y/n] ')).trim().toLowerCase();
    if (yn !== 'n' && yn !== 'no') {
      await deps.installClaude({ endpoint: baseUrl, apiKey });
    }
    checkpoint(baseDir, 'connected'); // a decision either way completes the step
  }

  // 8. Open
  if (!args.noBrowser) deps.openBrowser(`${baseUrl}/setup`, logger);
  logger.error(`Done. First steps: ${baseUrl}/connect`);
  return { child, stopDb, baseUrl };
}

export async function runDown({ baseDir = join(homedir(), '.dashclaw'), logger = console }) {
  const inst = loadInstance(baseDir);
  if (!inst) { logger.error('No DashClaw instance found.'); return; }
  if (inst.pid) {
    try { process.kill(inst.pid); logger.error(`✓ Stopped server (pid ${inst.pid})`); }
    catch { logger.error('Server was not running.'); }
    saveInstance(baseDir, { pid: null });
  }
  if (inst.dbMode === 'docker') {
    spawnSync('docker', ['stop', 'dashclaw-pg'], { stdio: 'ignore', shell: process.platform === 'win32' });
    logger.error('✓ Stopped Docker Postgres');
  }
  // Embedded PG runs as a child of `up` and dies with it; nothing to do here.
}

export async function upCommand(argv) {
  const args = parseUpArgs(argv);
  const { child, stopDb } = await runUp({ args });
  const shutdown = async () => { try { await stopDb(); } catch { /* already down */ } process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise((resolve) => child.on('exit', resolve)); // foreground until server exits
  await stopDb();
}
```

- [ ] **Step 4: Run the orchestrator test, PASS.**

- [ ] **Step 5: Wire the bin.** In `cli/bin/dashclaw.js`: add to imports `import { upCommand, runDown } from '../lib/up/index.js';` and in the top-level `switch (command)` (next to `case 'doctor'`):

```js
case 'up':
  await upCommand(args.slice(1));
  break;
case 'down':
  await runDown({});
  break;
```

Add to the help output: `up      Install + start a local DashClaw (one command, resumable)` and `down    Stop the local DashClaw server (and Docker DB if we started it)`.

- [ ] **Step 6: Smoke the wiring** — `node cli/bin/dashclaw.js up --help 2>&1 | head -3` should not crash with import errors (it will start parsing; `--help` lands in unknown-flag tolerance — acceptable; the real assertion is no module-resolution error).

- [ ] **Step 7: Run the full CLI test dir** — `npx vitest run cli/test/` → PASS.
- [ ] **Step 8: Commit** — `git add cli/lib/up/index.js cli/test/up/orchestrator.test.js cli/bin/dashclaw.js && git commit -m "feat(cli): npx dashclaw up — one-command local install orchestrator"`

---

### Task 8: SDK bin shim (`npx dashclaw up`)

The bare `dashclaw` npm package is the Node SDK. Adding a bin makes `npx dashclaw <args>` forward to `@dashclaw/cli`. SDK library surface unchanged.

**Files:**
- Create: `sdk/bin/dashclaw-shim.js`
- Modify: `sdk/package.json` (add `"bin": { "dashclaw": "./bin/dashclaw-shim.js" }`; ensure `bin/` is included in published files — check the `files` field)
- Test: `__tests__/unit/sdk-bin-shim.test.js`

- [ ] **Step 1: Write the failing test**

```js
// __tests__/unit/sdk-bin-shim.test.js
import { describe, expect, it } from 'vitest';
import { shimSpawnArgs } from '../../sdk/bin/dashclaw-shim.js';

describe('sdk bin shim', () => {
  it('forwards argv to @dashclaw/cli via npm exec', () => {
    expect(shimSpawnArgs(['up', '--yes'])).toEqual({
      cmd: 'npm',
      args: ['exec', '--yes', '--', '@dashclaw/cli', 'up', '--yes'],
    });
  });
});
```

- [ ] **Step 2: Run it, verify FAIL.**

- [ ] **Step 3: Implement `sdk/bin/dashclaw-shim.js`**

```js
#!/usr/bin/env node
// `npx dashclaw <args>` lands here (the SDK owns the bare npm name).
// Forward everything to @dashclaw/cli so there is exactly one real CLI.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function shimSpawnArgs(argv) {
  return { cmd: 'npm', args: ['exec', '--yes', '--', '@dashclaw/cli', ...argv] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { cmd, args } = shimSpawnArgs(process.argv.slice(2));
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  process.exit(res.status ?? 1);
}
```

(If `sdk/` is CommonJS — check `sdk/package.json` `"type"` — convert to `require('node:child_process')` + `module.exports.shimSpawnArgs` and adjust the entry check to `require.main === module`; keep the same behavior and test.)

- [ ] **Step 4: Run test, PASS.**
- [ ] **Step 5: Add the bin to `sdk/package.json`** and verify packaging: `cd sdk && npm pack --dry-run 2>&1 | grep -i bin` must list `bin/dashclaw-shim.js`.
- [ ] **Step 6: Commit** — `git add sdk/bin/dashclaw-shim.js sdk/package.json __tests__/unit/sdk-bin-shim.test.js && git commit -m "feat(sdk): bin shim so npx dashclaw forwards to @dashclaw/cli"`

**Note:** this marks SDK source changed — the contracts/release-plan gate will demand a republish note at the next release. That is expected; `dashclaw-ship` handles it.

---

### Task 9: 3-OS CI smoke (`up` end-to-end with embedded Postgres)

**Files:**
- Create: `.github/workflows/up-smoke.yml`

- [ ] **Step 1: Write the workflow.** It exercises the REAL pipeline against the current checkout (`--source-dir .` skips the tarball; everything else — embedded PG download, setup.mjs, build, next start, health — is real):

```yaml
name: up-smoke
on:
  pull_request:
    paths: ['cli/**', 'scripts/setup.mjs', 'scripts/lib/**', '.github/workflows/up-smoke.yml']
  workflow_dispatch:

jobs:
  up:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Install CLI deps
        run: npm ci --no-audit --no-fund
        working-directory: cli
      - name: Run up (embedded DB, non-interactive, no browser)
        run: node cli/bin/dashclaw.js up --yes --db embedded --no-browser --source-dir . &
        shell: bash
      - name: Wait for health
        run: |
          for i in $(seq 1 120); do
            if curl -fsS http://localhost:3000/api/health > /dev/null 2>&1; then exit 0; fi
            sleep 5
          done
          echo "server never became healthy"; exit 1
        shell: bash
      - name: Record one governed action with the minted key
        run: |
          KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.dashclaw/instance.json','utf8')).apiKey)")
          curl -fsS -X POST http://localhost:3000/api/actions \
            -H "x-api-key: $KEY" -H "content-type: application/json" \
            -d '{"agent_id":"ci-smoke","action_type":"test","declared_goal":"up-smoke verification"}'
        shell: bash
      - name: Down
        run: node cli/bin/dashclaw.js down
        shell: bash
```

- [ ] **Step 2: Verify locally what CI will do** (closest local equivalent, Windows):

Run: `node cli/bin/dashclaw.js up --yes --db embedded --no-browser --source-dir . ` in one terminal; once healthy, `curl http://localhost:3000/api/health` → 200; then `node cli/bin/dashclaw.js down`. NOTE: this writes to your real `~/.dashclaw` — back up `~/.dashclaw/instance.json` and `~/.dashclaw/config.json` first and restore after.

- [ ] **Step 3: Commit** — `git add .github/workflows/up-smoke.yml && git commit -m "ci: 3-OS end-to-end smoke for npx dashclaw up"`

- [ ] **Step 4: Push and READ the Actions result for all 3 OSes.** Fix what fails (likely suspects: embedded-postgres binary quirks per OS, Windows path quoting, port timing). Do not proceed to Task 10 with a red matrix.

---

### Task 10: Docs

**Files:**
- Modify: `QUICK-START.md` (Step 1 Option A), `README.md` (top fold), `cli/README.md` (command table)

- [ ] **Step 1: QUICK-START.md** — replace Option A's clone/setup/dev steps with:

```markdown
### Option A: Local (one command)

```bash
npx dashclaw up
```

Everything is interactive-with-defaults: it installs the app to `~/.dashclaw`, provisions Postgres
(Docker if you have it, embedded otherwise), generates secrets, mints your API key, applies
migrations, starts the server at http://localhost:3000, and offers to wire Claude Code hooks.
Re-run `npx dashclaw up` any time to start it again; `npx dashclaw down` stops it.

<details><summary>Working from a clone instead (contributors)</summary>

```bash
git clone https://github.com/ucsandman/DashClaw.git && cd DashClaw
npm install && npm run setup && npm run dev
```
</details>
```

- [ ] **Step 2: README.md top fold** — put `npx dashclaw up` as the first install command (above the deploy button), one line of what it does. Read `.impeccable.md` first (copy change on a marketing surface); keep tokens/styling untouched.
- [ ] **Step 3: cli/README.md** — add `up`/`down` to the command table with the flags (`--update --yes --no-browser --db docker|embedded|url --dir --port --source-dir`).
- [ ] **Step 4: Doc gates** — `node scripts/check-doc-counts.mjs --strict` and `npm run docs:check` → both PASS (if a CLI-command count is gated anywhere, update it in the same commit).
- [ ] **Step 5: Commit** — `git add QUICK-START.md README.md cli/README.md && git commit -m "docs: npx dashclaw up is the local install path"`

---

### Task 11: Version bump + full gates

**Files:**
- Modify: `cli/package.json` (`"version": "0.5.0"`)

- [ ] **Step 1: Bump CLI to 0.5.0** (it ships `up`; folds the owed 0.4.0 publish into one event). Do NOT touch the platform/SDK unified version here — that bumps at the next `dashclaw-ship`.
- [ ] **Step 2: Full gates, in order, READING output:** `npm run lint` → `npm run typecheck` → `npx vitest run` (full suite) → `npm run build` → `cd mcp-server && npx vitest run` (its suite is part of the repo gate) → `node scripts/check-doc-counts.mjs --strict`. ALL PASS before the next step.
- [ ] **Step 3: Commit** — `git add cli/package.json && git commit -m "chore(cli): 0.5.0 — npx dashclaw up"`
- [ ] **Step 4: Push** — `git push origin main`, then verify the `up-smoke` workflow is green on main for all 3 OSes.
- [ ] **Step 5: Hand back the owner tail (do NOT attempt):** `npm publish` for `@dashclaw/cli` 0.5.0 and the SDK (bin shim) — both OTP-gated; they fold into the launch-sprint release tail runbook.

---

## Self-review (done at planning time)

- **Spec coverage:** command + shim (T7/T8), tarball install path (T4), DB ladder w/ embedded (T5), setup reuse non-interactive (T1), build/start/health/open (T6), resume/idempotent boot + down (T3/T7), connect chaining (T7), 3-OS CI (T9), docs + launch integration (T10/T11). Port-collision prompt from the spec is deferred into `waitForHealth` failure messaging + `--port` flag — acceptable v1 (explicit flag exists); noted as a conscious cut.
- **Placeholders:** none — every step has code or an exact command.
- **Type consistency:** `runUp({args, baseDir, deps})`, `deps.runSetupScript({appDir, databaseUrl, logger}) → {apiKey, adminPassword}`, `provisionDatabase → {databaseUrl, stop}`, `STEPS` array — checked against each task's code.
- **Known execution-time verifications:** embedded-postgres real API (T5 Step 1), sdk package `"type"` (T8 Step 3), exact `switch` location in `cli/bin/dashclaw.js` (T7 Step 5).
