# OpenClaw Auto-Pairing Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/identities` "Request pairing" click self-serve for OpenClaw agents: the plugin consumes the `dashclaw.pairing_request` inbox directive, generates a keypair locally, and submits the public key so the pairing appears for one-click approval.

**Architecture:** New one-purpose module `auto-pairing.ts` in the OpenClaw plugin, fired-and-forgotten from `before_tool_call` once per gateway process. Raw `fetch` for the two messages calls (the Node SDK has no messages surface post-v5-cull); the SDK's existing `createPairing` for the pairing POST. Server untouched.

**Tech Stack:** TypeScript (plugin, tsc → dist), Node 20 (`node:crypto` RSA-2048, global fetch), vitest with the existing mocked-global-fetch harness.

**Spec:** `docs/superpowers/specs/2026-08-07-openclaw-auto-pairing-design.md`

## Global Constraints

- Auto-pairing default ON; disabled only by `autoPairing: false` in plugin config.
- Private key: `~/.dashclaw/identity/<sanitized agent_id>.pem`, mode 0o600, sanitizer `replace(/[^A-Za-z0-9._-]/g, '_')` — identical to MCP `dashclaw_pair`.
- POST-then-write ordering (failed POST leaves no pem → clean retry next gateway start).
- Every failure is `console.warn`; nothing may throw into or block the tool-call path. Private key never logged, never sent.
- Directive fence contract must match `app/lib/pairing-request.ts` (`/```json\s*([\s\S]*?)```/`, `kind === 'dashclaw.pairing_request'`).
- No new SDK methods. No server changes. No hardcoded version numbers.
- PEM header literals: write them SPLIT (`'-----BEGIN ' + 'PRIVATE KEY-----'`) in tests/assertions — the repo's secrets hook blocks files containing the contiguous private-key header.
- Gates before push: `npm run lint`, `npx vitest run` (full suite), plugin `npm run typecheck`, plugin `npm run build` (dist is committed).

---

### Task 1: `auto-pairing.ts` module + unit tests

**Files:**
- Create: `packages/openclaw-plugin/src/auto-pairing.ts`
- Create: `__tests__/unit/packages/openclaw-plugin/src/auto-pairing.test.js`
- Modify: `packages/openclaw-plugin/src/dashclaw.d.ts` (add `createPairing` to the `DashClaw` class declaration)

**Interfaces:**
- Consumes: `DashClaw` client instance (only `.createPairing(publicKeyPem)`), global `fetch`.
- Produces (Task 2 relies on these exact exports):
  - `maybeAutoPair(client: DashClaw, config: AutoPairConfig): Promise<void>`
  - `interface AutoPairConfig { dashclawUrl: string; dashclawApiKey: string; agentId: string; autoPairing: boolean }`
  - `__resetAutoPairing(): void` (test-only)

- [ ] **Step 1: Declare `createPairing` in `dashclaw.d.ts`**

Inside `export class DashClaw { ... }`, after `updateSession`, add:

```ts
    createPairing(
      publicKeyPem: string,
      opts?: { algorithm?: string; agentName?: string }
    ): Promise<{ pairing?: { id?: string; status?: string }; [key: string]: unknown }>;
```

- [ ] **Step 2: Write the failing tests**

Create `__tests__/unit/packages/openclaw-plugin/src/auto-pairing.test.js`:

```js
import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:fs', () => ({ ...fsMock, default: fsMock }));

const osMock = vi.hoisted(() => ({ homedir: vi.fn(() => '/fakehome') }));
vi.mock('node:os', () => ({ ...osMock, default: osMock }));

const { maybeAutoPair, __resetAutoPairing } = await import(
  '../../../../../packages/openclaw-plugin/src/auto-pairing.ts'
);

const AGENT_ID = 'openclaw-test';
// Split so the contiguous PEM header never appears in this file (secrets hook).
const PUBLIC_PEM_HEADER = '-----BEGIN ' + 'PUBLIC KEY-----';
const PRIVATE_PEM_HEADER = '-----BEGIN ' + 'PRIVATE KEY-----';

function config(overrides = {}) {
  return {
    dashclawUrl: 'https://dashclaw.test',
    dashclawApiKey: 'dc_test',
    agentId: AGENT_ID,
    autoPairing: true,
    ...overrides,
  };
}

function directiveBody(agentId = AGENT_ID) {
  return [
    'An operator asked this agent to enroll an identity.',
    '',
    '```json',
    JSON.stringify(
      {
        kind: 'dashclaw.pairing_request',
        agent_id: agentId,
        dashboard_url: 'https://dashclaw.test',
        action: 'Generate a keypair, POST your PEM public key to /api/pairings, then await admin approval.',
      },
      null,
      2
    ),
    '```',
  ].join('\n');
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

/** Stub global fetch; records {url, path, method, body} per call. */
function installFetchMock(messages = []) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const request = {
        url: String(url),
        path: new URL(String(url)).pathname,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(request);
      if (request.path === '/api/messages' && request.method === 'GET') {
        return jsonResponse({ messages, total: messages.length, unread_count: messages.length });
      }
      if (request.path === '/api/messages' && request.method === 'PATCH') {
        return jsonResponse({ updated: request.body.message_ids.length });
      }
      return jsonResponse({ ok: true });
    })
  );
  return calls;
}

function fakeClient() {
  return { createPairing: vi.fn(async () => ({ pairing: { id: 'pair_1', status: 'pending' } })) };
}

beforeEach(() => {
  __resetAutoPairing();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  fsMock.existsSync.mockReturnValue(false);
  osMock.homedir.mockReturnValue('/fakehome');
});

describe('maybeAutoPair', () => {
  it('happy path: submits public key, stores private key 0600, marks message read, runs once per process', async () => {
    const calls = installFetchMock([{ id: 'msg_1', body: directiveBody() }]);
    const client = fakeClient();

    await maybeAutoPair(client, config());

    // Public PEM POSTed via SDK; private key never passed anywhere but writeFileSync.
    assert.equal(client.createPairing.mock.calls.length, 1);
    const publicPem = client.createPairing.mock.calls[0][0];
    assert.ok(publicPem.startsWith(PUBLIC_PEM_HEADER));

    // Private key written to the identity path with mode 600.
    assert.equal(fsMock.writeFileSync.mock.calls.length, 1);
    const [pemPath, privatePem, opts] = fsMock.writeFileSync.mock.calls[0];
    assert.ok(String(pemPath).replace(/\\/g, '/').endsWith('.dashclaw/identity/openclaw-test.pem'));
    assert.ok(privatePem.startsWith(PRIVATE_PEM_HEADER));
    assert.equal(opts.mode, 0o600);

    // Message marked read for this agent.
    const patch = calls.find((c) => c.path === '/api/messages' && c.method === 'PATCH');
    assert.ok(patch, 'expected PATCH /api/messages');
    assert.deepEqual(patch.body.message_ids, ['msg_1']);
    assert.equal(patch.body.action, 'read');
    assert.equal(patch.body.agent_id, AGENT_ID);

    // Second call in the same process is a no-op (per-process guard).
    await maybeAutoPair(client, config());
    assert.equal(client.createPairing.mock.calls.length, 1);
  });

  it('autoPairing false: no network at all', async () => {
    installFetchMock([{ id: 'msg_1', body: directiveBody() }]);
    const client = fakeClient();
    await maybeAutoPair(client, config({ autoPairing: false }));
    assert.equal(globalThis.fetch.mock.calls.length, 0);
    assert.equal(client.createPairing.mock.calls.length, 0);
  });

  it('private key already exists: no network, no overwrite', async () => {
    fsMock.existsSync.mockReturnValue(true);
    installFetchMock([{ id: 'msg_1', body: directiveBody() }]);
    const client = fakeClient();
    await maybeAutoPair(client, config());
    assert.equal(globalThis.fetch.mock.calls.length, 0);
    assert.equal(client.createPairing.mock.calls.length, 0);
    assert.equal(fsMock.writeFileSync.mock.calls.length, 0);
  });

  it('no directive for this agent (other-agent directive + plain message): no pairing, no pem, nothing marked read', async () => {
    const calls = installFetchMock([
      { id: 'msg_1', body: directiveBody('someone-else') },
      { id: 'msg_2', body: 'plain message, no fence' },
    ]);
    const client = fakeClient();
    await maybeAutoPair(client, config());
    assert.equal(client.createPairing.mock.calls.length, 0);
    assert.equal(fsMock.writeFileSync.mock.calls.length, 0);
    assert.ok(!calls.some((c) => c.method === 'PATCH'));
  });

  it('createPairing failure: no pem written, warns, never throws', async () => {
    installFetchMock([{ id: 'msg_1', body: directiveBody() }]);
    const client = { createPairing: vi.fn(async () => { throw new Error('boom'); }) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await maybeAutoPair(client, config()); // must resolve, not reject

    assert.equal(fsMock.writeFileSync.mock.calls.length, 0);
    assert.ok(warn.mock.calls.some(([m]) => String(m).includes('auto-pairing')));
    warn.mockRestore();
  });

  it('messages GET failure: warns, never throws, retryable (guard is per-process only)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 500)));
    const client = fakeClient();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await maybeAutoPair(client, config());
    assert.equal(client.createPairing.mock.calls.length, 0);
    assert.ok(warn.mock.calls.some(([m]) => String(m).includes('auto-pairing')));
    warn.mockRestore();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run __tests__/unit/packages/openclaw-plugin/src/auto-pairing.test.js`
Expected: FAIL — cannot resolve `packages/openclaw-plugin/src/auto-pairing.ts`.

- [ ] **Step 4: Implement the module**

Create `packages/openclaw-plugin/src/auto-pairing.ts`:

```ts
/**
 * Auto-pairing consumer — answers the operator's /identities "Request
 * pairing" click without an LLM in the loop.
 *
 * On the first tool call per gateway process the plugin checks this agent's
 * DashClaw inbox for a `dashclaw.pairing_request` directive (the fenced-JSON
 * contract in app/lib/pairing-request.ts). When one targets this agent it
 * generates an RSA-2048 keypair locally, POSTs the public PEM via the SDK's
 * createPairing, stores the private key at
 * ~/.dashclaw/identity/<agent_id>.pem (mode 600 — same path as the MCP
 * dashclaw_pair tool), and marks the message read. Identity creation still
 * happens only when an admin approves the pairing on /identities.
 *
 * Custody rule: the private key never leaves this machine and is never
 * logged. Failure rule: every error is a console.warn — this path must
 * never throw into or block a tool call.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import type { DashClaw } from 'dashclaw';

export const PAIRING_REQUEST_KIND = 'dashclaw.pairing_request';

export interface AutoPairConfig {
  dashclawUrl: string;
  dashclawApiKey: string;
  agentId: string;
  autoPairing: boolean;
}

interface InboxMessage {
  id: string;
  body?: unknown;
}

// One attempt per gateway process per (url, agent). Added BEFORE the first
// await so concurrent tool calls cannot double-run the flow. Per-process on
// purpose: a transient failure retries at the next gateway start.
let attempted = new Set<string>();

/** Test-only: reset the per-process attempt guard. */
export function __resetAutoPairing(): void {
  attempted = new Set();
}

export function identityKeyPath(agentId: string): string {
  const safe = agentId.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(homedir(), '.dashclaw', 'identity', `${safe}.pem`);
}

/** Same fence contract as app/lib/pairing-request.ts. */
function directiveTargets(body: unknown, agentId: string): boolean {
  if (typeof body !== 'string') return false;
  const match = body.match(/```json\s*([\s\S]*?)```/);
  if (!match || !match[1]) return false;
  try {
    const parsed = JSON.parse(match[1]) as { kind?: string; agent_id?: string } | null;
    return parsed?.kind === PAIRING_REQUEST_KIND && parsed.agent_id === agentId;
  } catch {
    return false;
  }
}

function apiUrl(config: AutoPairConfig, pathAndQuery: string): string {
  return `${config.dashclawUrl.replace(/\/+$/, '')}${pathAndQuery}`;
}

async function fetchUnreadInbox(config: AutoPairConfig): Promise<InboxMessage[]> {
  const res = await fetch(
    apiUrl(
      config,
      `/api/messages?agent_id=${encodeURIComponent(config.agentId)}&direction=inbox&unread=true&limit=50`
    ),
    { headers: { 'x-api-key': config.dashclawApiKey } }
  );
  if (!res.ok) throw new Error(`messages GET failed (${res.status})`);
  const data = (await res.json()) as { messages?: InboxMessage[] };
  return Array.isArray(data.messages) ? data.messages : [];
}

async function markRead(config: AutoPairConfig, messageIds: string[]): Promise<void> {
  const res = await fetch(apiUrl(config, '/api/messages'), {
    method: 'PATCH',
    headers: { 'x-api-key': config.dashclawApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_ids: messageIds, action: 'read', agent_id: config.agentId }),
  });
  if (!res.ok) throw new Error(`messages PATCH failed (${res.status})`);
}

export async function maybeAutoPair(client: DashClaw, config: AutoPairConfig): Promise<void> {
  if (!config.autoPairing) return;
  const key = `${config.dashclawUrl}|${config.agentId}`;
  if (attempted.has(key)) return;
  attempted.add(key);

  try {
    const pemPath = identityKeyPath(config.agentId);
    if (existsSync(pemPath)) {
      // Already enrolled or pending. Deleting the pem + clicking Request
      // pairing again is the rotation path.
      return;
    }

    const inbox = await fetchUnreadInbox(config);
    const requests = inbox.filter((m) => directiveTargets(m.body, config.agentId));
    if (requests.length === 0) return;

    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const created = await client.createPairing(publicKey);
    const pairingId =
      (created as { pairing?: { id?: string } }).pairing?.id ??
      (created as { id?: string }).id ??
      '(pending)';

    // POST-then-write: a failed POST leaves no pem, so the next gateway
    // start retries cleanly. A failed write AFTER a successful POST is the
    // one loud case — that pending pairing has no usable private key.
    try {
      mkdirSync(dirname(pemPath), { recursive: true });
      writeFileSync(pemPath, privateKey, { mode: 0o600 });
    } catch (err) {
      console.warn(
        `[dashclaw-governance] auto-pairing: submitted pairing ${pairingId} but FAILED to store ` +
          `the private key at ${pemPath}: ${errText(err)}. Reject that pairing on /identities, ` +
          `fix the disk issue, and click Request pairing again.`
      );
      return; // leave the message unread so a later gateway start retries
    }

    await markRead(config, requests.map((m) => m.id));
    console.log(
      `[dashclaw-governance] auto-pairing submitted (${pairingId}) — approve it on /identities. ` +
        `Private key stored at ${pemPath} (never sent).`
    );
  } catch (err) {
    console.warn(`[dashclaw-governance] auto-pairing skipped: ${errText(err)}`);
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/unit/packages/openclaw-plugin/src/auto-pairing.test.js`
Expected: PASS (6 tests). RSA keygen makes 2 of them take ~200ms each — normal.

- [ ] **Step 6: Typecheck the plugin**

Run (from `packages/openclaw-plugin`): `npm run typecheck`
Expected: clean. If tsc demands an import extension (NodeNext resolution), keep the import style consistent with how Task 2 imports the module into `index.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/openclaw-plugin/src/auto-pairing.ts packages/openclaw-plugin/src/dashclaw.d.ts __tests__/unit/packages/openclaw-plugin/src/auto-pairing.test.js
git commit -m "feat(openclaw-plugin): auto-pairing consumer module"
```

---

### Task 2: Wire into `index.ts` + config flag + manifest

**Files:**
- Modify: `packages/openclaw-plugin/src/index.ts` (PluginConfig, resolveConfig, handleBeforeToolCall)
- Modify: `packages/openclaw-plugin/openclaw.plugin.json` (configSchema + uiHints)
- Modify: `__tests__/unit/packages/openclaw-plugin/src/index.test.js` (mock the module; add wiring test)

**Interfaces:**
- Consumes from Task 1: `maybeAutoPair(client, config)` where config includes `{ dashclawUrl, dashclawApiKey, agentId, autoPairing }`.
- Produces: `PluginConfig.autoPairing: boolean` (default true, `cfg.autoPairing !== false`).

- [ ] **Step 1: Add the wiring test (failing first)**

In `__tests__/unit/packages/openclaw-plugin/src/index.test.js`, next to the existing `mockRuntime` hoisted mock, add a mock for the auto-pairing module so the real one (fs + homedir + extra fetches) never runs inside the existing harness:

```js
const autoPairMock = vi.hoisted(() => ({ maybeAutoPair: vi.fn(async () => {}) }));

vi.mock('../../../../../packages/openclaw-plugin/src/auto-pairing.ts', () => ({
  maybeAutoPair: autoPairMock.maybeAutoPair,
}));
```

(If the mock fails to intercept because `index.ts` imports with a different specifier, use that exact specifier form — the mock path must resolve to the same file id vitest sees from `index.ts`.)

Clear it in the existing `beforeEach`/`registerPlugin` reset path (`autoPairMock.maybeAutoPair.mockClear()`), then add:

```js
describe('auto-pairing wiring', () => {
  it('fires maybeAutoPair on before_tool_call with autoPairing defaulted true', async () => {
    installFetchMock();
    const { api } = await registerPlugin();
    await api.emit('before_tool_call', { toolName: 'read', params: {}, toolCallId: 'tc_ap', runId: 'run_ap' });
    assert.equal(autoPairMock.maybeAutoPair.mock.calls.length, 1);
    const [, cfg] = autoPairMock.maybeAutoPair.mock.calls[0];
    assert.equal(cfg.autoPairing, true);
    assert.equal(cfg.agentId, 'openclaw-test');
  });

  it('passes autoPairing false through from plugin config', async () => {
    installFetchMock();
    const { api } = await registerPlugin({ pluginConfig: { autoPairing: false } });
    await api.emit('before_tool_call', { toolName: 'read', params: {}, toolCallId: 'tc_ap2', runId: 'run_ap2' });
    const [, cfg] = autoPairMock.maybeAutoPair.mock.calls.at(-1);
    assert.equal(cfg.autoPairing, false);
  });
});
```

(Match the file's actual `registerPlugin` return shape — adjust destructuring if it returns the api differently.)

Run: `npx vitest run __tests__/unit/packages/openclaw-plugin/src/index.test.js`
Expected: the two new tests FAIL (maybeAutoPair never called); existing tests still PASS.

- [ ] **Step 2: Implement the wiring in `index.ts`**

Add the import (match the file's local-import style; use the `.js` extension if the tsconfig is NodeNext):

```ts
import { maybeAutoPair } from './auto-pairing';
```

In `interface PluginConfig`, after `failClosed: boolean;`:

```ts
  autoPairing: boolean;
```

In `resolveConfig`, next to `failClosed`:

```ts
  const autoPairing = cfg.autoPairing !== false; // default true
```

and add `autoPairing,` to the returned object.

In `handleBeforeToolCall`, immediately after the client resolves:

```ts
  const client = getBeforeClient(config);
  if ('result' in client) return client.result;

  // Fire-and-forget: answers a pending operator pairing request once per
  // gateway process. Never blocks or fails the tool call.
  void maybeAutoPair(client.value, config);

  await maybeStartSession(event, client.value, config);
```

- [ ] **Step 3: Run the plugin test files**

Run: `npx vitest run __tests__/unit/packages/openclaw-plugin/src/index.test.js __tests__/unit/packages/openclaw-plugin/src/auto-pairing.test.js`
Expected: ALL PASS, including all pre-existing index tests.

- [ ] **Step 4: Add the manifest flag**

In `packages/openclaw-plugin/openclaw.plugin.json` `configSchema.properties`, after `failClosed`:

```json
      "autoPairing": {
        "type": "boolean",
        "default": true,
        "description": "Automatically answer operator pairing requests from the DashClaw /identities page: generate a local keypair and submit the public key for admin approval. The private key is stored at ~/.dashclaw/identity/<agentId>.pem and never leaves this machine. Set false to require manual pairing (MCP dashclaw_pair or SDK createPairing)."
      },
```

And in `uiHints`, after `failClosed`:

```json
    "autoPairing": { "label": "Auto-answer pairing requests", "advanced": true },
```

- [ ] **Step 5: Typecheck + build the plugin (dist is committed)**

Run (from `packages/openclaw-plugin`): `npm run typecheck && npm run build`
Expected: clean; `dist/auto-pairing.js` (+ .d.ts) appears and `dist/index.js` references it.

- [ ] **Step 6: Commit**

```bash
git add packages/openclaw-plugin/src/index.ts packages/openclaw-plugin/openclaw.plugin.json packages/openclaw-plugin/dist __tests__/unit/packages/openclaw-plugin/src/index.test.js
git commit -m "feat(openclaw-plugin): fire auto-pairing on first tool call, autoPairing config flag"
```

---

### Task 3: Docs + full gates

**Files:**
- Modify: `docs/agent-identity.md` (auto-pairing section in the operator-request flow)
- Modify: `packages/openclaw-plugin/README.md` (config row + behavior note)

**Interfaces:**
- Consumes: the shipped behavior from Tasks 1–2 (flag name `autoPairing`, pem path, two-click operator flow).
- Produces: nothing downstream; CHANGELOG/version/counts happen at ship time via dashclaw-ship.

- [ ] **Step 1: Update `docs/agent-identity.md`**

Read the file first; in the section describing operator-initiated pairing requests (the inbox directive), add a subsection (match the doc's heading style):

```markdown
### OpenClaw agents answer automatically

The `@dashclaw/openclaw-plugin` (>= the version shipping this feature) consumes
the pairing directive without an LLM in the loop. On the agent's first tool
call after you click **Request pairing**, the plugin:

1. reads its unread inbox and finds the `dashclaw.pairing_request` directive,
2. generates an RSA-2048 keypair locally — the private key is written to
   `~/.dashclaw/identity/<agent_id>.pem` (mode 600) and never leaves the
   machine,
3. POSTs the public key to `/api/pairings` and marks the message read.

The pairing then appears under **Pending Pairings** on `/identities` for your
one-click approval. Approval remains the only step that creates the identity.

- Disable with `autoPairing: false` in the plugin config.
- Key rotation: delete the `.pem` file, then click **Request pairing** again.
- The trigger is the agent's next tool call — an idle gateway does nothing
  until it runs a tool (delivery is pull-based by design).

Other runtimes: MCP-connected agents answer the same directive with the
`dashclaw_pair` tool; Node/Python SDK agents use `createPairing` /
`create_pairing`.
```

- [ ] **Step 2: Update `packages/openclaw-plugin/README.md`**

Read the file first. Add `autoPairing` to its config option table/list (same wording as the manifest description, condensed), and a short "Automatic identity pairing" section stating: click Request pairing on `/identities` → plugin submits the public key at the next tool call → approve under Pending Pairings; private key stays at `~/.dashclaw/identity/<agentId>.pem`; disable via `autoPairing: false`.

- [ ] **Step 3: Full gates — run and READ the output**

```bash
npm run lint
npx vitest run
```

From `packages/openclaw-plugin`: `npm run typecheck` (already done in Task 2 — rerun if any .ts changed since).
Expected: all green. No `app/**` change → `next build` not required. If `scripts/check-doc-counts.mjs --strict` is wired into pre-commit it must pass (no counted surfaces change in this plan).

- [ ] **Step 4: Commit**

```bash
git add docs/agent-identity.md packages/openclaw-plugin/README.md
git commit -m "docs: OpenClaw auto-pairing flow and autoPairing flag"
```

---

## Verification (definition of done)

1. All three task commits green through the gates above.
2. Human surface check: `/identities` needs no change — confirm live that after clicking Request pairing and the agent's next tool call, the pairing appears under Pending Pairings and Approve works (this is the rendered-proof step; do it against the local dev server or Wes's live instance with moltfire).
3. Ship via `dashclaw-ship` (version bump, CHANGELOG, plugin version/publish decision, marketing surfaces) — separate step, on Wes's go.
