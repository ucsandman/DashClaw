# OpenClaw Auto-Pairing Consumer — Design

**Date:** 2026-08-07
**Status:** Approved (Wes, 2026-08-07)
**Scope:** `packages/openclaw-plugin` only (explicit decision — see Non-goals)

## Problem

The `/identities` "Request pairing" button sends a pull-based inbox message
(`app/lib/pairing-request.ts`, kind `dashclaw.pairing_request`) telling the
agent to generate a keypair and POST its public key to `/api/pairings`. No
agent-side code consumes that message. For OpenClaw agents the button
therefore does nothing observable: the message lands, no pending pairing
appears, and the operator's click is dead until an LLM happens to read the
inbox and act on the directive.

## Goal

Operator clicks "Request pairing" → at the OpenClaw agent's next tool call,
the plugin generates a keypair locally, submits the public key, and the
pairing appears under Pending Pairings for one-click approval. Zero terminal
steps in the human role. Private key custody stays on the agent's machine.

## Decisions (locked)

1. **Auto-pairing is ON by default.** The operator's click is the consent —
   they operate the org that governs this agent. Approval still gates
   identity creation, so the worst case of an unwanted auto-pair is a pending
   row the admin ignores. New config flag `autoPairing: false` disables it.
2. **OpenClaw plugin only.** MCP-connected agents already have the
   `dashclaw_pair` tool and can act on the directive themselves. Claude
   Code / Codex / Hermes hooks runtimes are deferred deliberately (parity
   rule satisfied by recording this decision here).
3. **Server, button, message format, and the P10 invariant are unchanged.**
   Only `POST /api/pairings/{id}/approve` creates the identity.

## Design

### New unit: `packages/openclaw-plugin/src/auto-pairing.ts`

One-purpose module exporting `maybeAutoPair(client, config)` plus a
test-reset helper. Kept out of `index.ts` (~970 lines) so it is
independently testable.

### Trigger

In `handleBeforeToolCall`, after the client resolves successfully:
`void maybeAutoPair(client, config)` — fire-and-forget. It never blocks,
never throws into the tool-call path, and adds zero latency. A module-scope
flag, set **before** the first await, limits it to one attempt per gateway
process (per client key, matching the cached-client pattern).

### `maybeAutoPair` flow

1. Return if `config.autoPairing === false`.
2. Return if a private key already exists at
   `~/.dashclaw/identity/<sanitized agent_id>.pem` (same path and sanitizer
   as the MCP `dashclaw_pair` tool). Log once: already enrolled or pending;
   delete the pem to rotate.
3. `GET /api/messages?agent_id=<own>&direction=inbox&unread=true` via raw
   `fetch` with the `x-api-key` header (the Node SDK has no messages
   surface post-v5-cull; raw fetch avoids growing the SDK and the
   doc-count cascade).
4. Parse each unread body for the fenced ```json directive; accept only
   `kind === 'dashclaw.pairing_request'` and `agent_id === config.agentId`.
   No match → return silently.
5. Generate an RSA-2048 keypair in memory (`generateKeyPairSync`, spki/pkcs8
   PEM — identical spec to `dashclaw_pair`).
6. `client.createPairing(publicKeyPem)` (SDK method; sends
   `agent_id`, `public_key`, `algorithm: 'RSASSA-PKCS1-v1_5'`).
7. **Only on success**, write the private key to the pem path, mode 0600.
   POST-then-write ordering: a failed POST leaves no key file, so the next
   gateway start retries cleanly; write-then-POST would deadlock on step 2.
   If the write itself fails after a successful POST, warn loudly — the
   pending pairing has no usable private key and should be re-requested
   after fixing the disk issue.
8. `PATCH /api/messages` `{ message_ids, action: 'read', agent_id }`.
9. Log: `[dashclaw-governance] auto-pairing submitted (<pair_id>) — approve
   it on /identities`.
10. Every failure path is `console.warn`. The private key is never logged
    and never sent.

### Config

`openclaw.plugin.json` configSchema + uiHints gain:

```json
"autoPairing": {
  "type": "boolean",
  "default": true,
  "description": "Automatically answer operator pairing requests: generate a local keypair and submit the public key for admin approval. The private key never leaves this machine."
}
```

`resolveConfig` maps it as `cfg.autoPairing !== false`.

## Human surface

`/identities` (exists, unchanged): button flips to "Requested" on click;
after the agent's next tool call the pairing appears under Pending Pairings
with the one-click Approve. Operator role is two clicks total.

**Known limit (accepted):** delivery is pull-based. If the gateway is idle
after the click, nothing happens until its next tool call. No server→agent
push channel exists; building one is out of scope.

## Error handling

- DashClaw unreachable / messages GET fails → warn, retry naturally on next
  gateway start (flag is per-process).
- Duplicate protection: pem-exists check (step 2) stops re-submission after
  success; unread-only filter plus mark-read stops reprocessing the same
  message; the once-per-process flag stops same-process races.
- Re-pairing / key rotation: operator deletes the pem and clicks Request
  pairing again.

## Testing

Unit tests beside the existing plugin suite
(`__tests__/unit/packages/openclaw-plugin/`), using the same
mocked-global-fetch harness, with `node:fs`/`node:os` mocked for the pem
path:

1. Happy path: unread directive → keypair POSTed, pem written 0600, message
   PATCHed read, once per process.
2. `autoPairing: false` → no messages fetch at all.
3. Pem exists → no fetch, no POST.
4. Inbox has no directive (or directive for another agent) → no POST, no pem.
5. `createPairing` fails → no pem written, warn, no throw into tool call.
6. Directive parse matches `app/lib/pairing-request.ts` fence format.

Gates before push: `npm run lint`, `npx vitest run` (full), `npm run
typecheck` (changed .ts). No `app/**` change expected; if any lands,
`npx next build` too.

## Docs (same ship)

- `docs/agent-identity.md`: OpenClaw auto-pairing section + the flag.
- `packages/openclaw-plugin/README.md`: config flag + behavior.
- CHANGELOG at ship time (dashclaw-ship handles version/counts).

## Non-goals

- Server-side keypair generation (private key custody must stay agent-side).
- Push delivery of pairing requests.
- Auto-consumers for Claude Code / Codex / Hermes hooks runtimes (explicit
  deferral; MCP agents already have `dashclaw_pair`).
- New SDK message methods (raw fetch in the plugin instead).
