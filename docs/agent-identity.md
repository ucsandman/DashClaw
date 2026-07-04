# Agent Identity — JWKS Verification (Phase 2)

DashClaw supports cryptographically verifiable agent identity via standard JWT
bearer tokens. Any OIDC-compatible issuer works — Keycloak, Auth0, a custom
JWKS server, or AgentLair.

## Phase 1 — who is asking (harness attribution)

Before any cryptography, every action carries a self-asserted `agent_id`.
Since v2.2 that identity is **per-harness**: each installer writes an
explicit `--agent-id <id>` flag onto its hook command line (Claude Code:
`claude-code` or the id chosen at install; Codex: `codex`; Hermes shims:
`DASHCLAW_HERMES_AGENT_ID` or `hermes`), and the hooks resolve identity as
**argv flag > `DASHCLAW_AGENT_ID` env > harness default** — so two harnesses
on one machine report two identities even when a machine-wide
`DASHCLAW_AGENT_ID` is exported. Claude Code sub-agents additionally get
composed identities (`<parent>:<type>`, default
`DASHCLAW_SUBAGENT_IDENTITY=distinct`); the server resolves their pairing,
targeted policies, and agent-scoped x402 budgets through the base parent
(`docs/rfcs/2026-06-01-subagent-fleet-identities.md`).

## Getting an identity (enroll first)

Identity is **additive** — DashClaw works without it (Phase 1 attributes actions
by the `agent_id` body field, derived as above). Add verifiable identity when
you want cryptographic proof of *who* acted. There are two enrollment paths:

**A. Public-key pairing (no identity provider required).** The simplest path for
self-hosters who don't run an OIDC issuer:

1. The agent generates a keypair and submits its public key: `POST /api/pairings`
   (Node SDK: `claw.createPairing(publicKeyPem, { algorithm, agentName })`;
   Python SDK: `claw.create_pairing(public_key_pem)`; MCP agents: the
   `dashclaw_pair` tool generates + stores the keypair locally and submits in
   one call). The call returns a `pairing_url`. Both SDKs can then poll with
   `waitForPairing(pairingId)` / `wait_for_pairing(pairing_id)`.
2. Open the `pairing_url` (or **Settings → Agent Identity** / **/identities**)
   and approve the request as an admin — this also sets the agent's permission
   level. Approval is what creates the identity row (`POST
   /api/pairings/{id}/approve`); a plain PATCH cannot approve. Pairing
   requests expire after `DASHCLAW_PAIRING_TTL_MINUTES` (default 15).
3. The agent signs its requests with the private key; approved keys appear under
   **/identities**.

**Operator-initiated pairing requests.** Admins can summon unidentified fleet
agents to pair from **/identities → Unidentified Agents → Request pairing**.
The request is delivered over the agent's message inbox (pull-based — the agent
sees it the next time it runs with DashClaw attached and checks
`dashclaw_inbox_list` / `claw.getInbox()`). The message body carries a fenced
JSON directive the agent can recognize:

```json
{
  "kind": "dashclaw.pairing_request",
  "agent_id": "<your agent id>",
  "dashboard_url": "<instance origin>",
  "action": "Generate a keypair, POST your PEM public key to /api/pairings, then await admin approval."
}
```

On seeing it, run enrollment path A above (MCP: `dashclaw_pair`), then mark the
message read (`dashclaw_messages_mark_read`).

**B. JWKS-verified JWT (bring your own issuer).** If you already run an
OIDC-compatible issuer (Keycloak, Auth0, AgentLair, or a custom JWKS server),
mint a JWT there and point DashClaw at the issuer via `DASHCLAW_ALLOWED_ISSUER`.
The agent attaches `Authorization: Bearer <JWT>`. Obtaining the token is the
issuer's job — DashClaw only *verifies* it (covered in the rest of this document).

## How it works

1. The agent attaches `Authorization: Bearer <JWT>` to DashClaw API calls.
2. DashClaw reads the `iss` claim from the JWT and fetches JWKS from
   `{iss}/.well-known/jwks.json` (cached for 1 hour).
3. The signature is verified using the matching key (`kid` → JWK lookup).
4. Expiry (`exp`), and optionally audience (`aud`), are validated.
5. If verification succeeds, the JWT `sub` claim becomes the canonical
   `agent_id` in the audit entry — cryptographic proof beats self-assertion.
6. The `verification_status` field in every guard response and audit record
   reflects the outcome.

## verification_status enum

| Value            | Meaning                                                   |
|------------------|-----------------------------------------------------------|
| `verified`       | Signature valid; `sub` used as `agent_id`. Requires `DASHCLAW_ALLOWED_ISSUER` — unreachable without it (v3.7 fail-closed) |
| `unverified`     | No JWT, no configured issuer (fail-closed since v4.49.0), or issuer temporarily unavailable (fail-soft) |
| `expired`        | Signature valid, but `exp` is in the past                 |
| `failed`         | Bad signature, malformed token, or `aud` mismatch         |
| `unknown_issuer` | `iss` does not match `DASHCLAW_ALLOWED_ISSUER`            |
| `exp_too_far`    | `exp` exceeds `DASHCLAW_JTI_MAX_TTL_SECONDS` (default 24h)|

## Phase 2b: replay protection

Phase 2 verifies *who* signed a token. Phase 2b prevents *reusing* one. A
captured `verified` token can otherwise be replayed against the same audience
inside its `exp` window — the signature stays valid until expiry. Adding `jti`
plus a "seen set" closes that gap.

> Design and shape by @piiiico in issue #120.

### How it works

1. After signature verification succeeds, DashClaw extracts the `jti` claim.
2. It calls an atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING jti` against
   the `jwt_replay_log` table, keyed by `(issuer, jti)`.
3. A returned row means **first use**; an empty result means **replay detected**.
4. The outcome is recorded in `guard_decisions.replay_status` alongside
   `verification_status`. Replays force `decision = 'block'`.

### replay_status enum

| Value            | Meaning                                                          |
|------------------|------------------------------------------------------------------|
| `not_applicable` | No JWT (Phase 1 / legacy path)                                   |
| `disabled`       | Verified JWT but `DASHCLAW_JTI_REPLAY_PROTECTION=off`            |
| `unique`         | First time this `(issuer, jti)` was seen → guard proceeds        |
| `replayed`       | Same `(issuer, jti)` seen before → guard blocks                  |
| `not_present`    | Verified token did not include a `jti` claim (or jti > 1024 chars) |
| `unavailable`    | Replay store unreachable                                         |
| `exp_too_far`    | Token `exp` exceeds the configured TTL cap                       |

### Modes

Set `DASHCLAW_JTI_REPLAY_PROTECTION` to one of:

| Mode          | `replayed` | `not_present` | `unavailable` |
|---------------|------------|---------------|---------------|
| `off`         | allow      | allow         | allow (skipped) |
| `best_effort` | **block**  | allow         | allow         |
| `required`    | **block**  | **block**     | **block**     |

`required` is the default (v3.6, 2026-07-04 — graduated from `best_effort`
when the verified-JWT fleet was measurably empty, so no existing traffic was
affected): any uncertainty on verified traffic fails closed. The mode only
applies to JWKS-verified tokens — API-key callers resolve
`replay_status='not_applicable'` and are never blocked by this knob. Rollback
is one env var: `DASHCLAW_JTI_REPLAY_PROTECTION=best_effort` (the pre-v3.6
fail-soft posture).

> **Security note** — In `best_effort` mode, an issuer that doesn't emit `jti`
> (or strips it under attack) bypasses replay protection entirely. `required`
> mode closes that gap by denying any verified token that lacks a `jti`. Make
> sure your IdP always emits `jti` (and a bounded `exp`) so legitimate
> verified traffic isn't impacted.

### Storage and sweep

Rows in `jwt_replay_log` carry an `expires_at` mirroring the token's `exp`, so
each row becomes purgeable at the same instant the token does. Two sweeps run
in tandem:

- **Probabilistic in-line**: ~1% of writes trigger a `DELETE WHERE expires_at < now`.
- **Scheduled**: `GET /api/cron/jti-sweep` runs every 5 minutes via
  `.github/workflows/jti-sweep.yml`.

The table never accumulates rows beyond one TTL window of inactivity.

### Configuration

```bash
DASHCLAW_JTI_REPLAY_PROTECTION=required      # off | best_effort | required
DASHCLAW_JTI_MAX_TTL_SECONDS=86400           # cap on accepted exp (24h default)
```

## Phase 2c: action binding

Phase 2 verifies *who* signed a token. Phase 2b stops *reusing* one. Phase 2c
narrows *what* a single token can do: an issuer commits the token to one
intended `(action, target, goal)` tuple at mint time, and the guard records
whether the incoming call matches — so a token minted to `read` a record can't
be silently repurposed to `delete` a different one (e.g. by a prompt-injected
agent holding an over-broad token).

> **Position note.** `/api/guard` is an advisory decision point, not an inline
> enforcement point — it does not sit in the data path to the resource. So
> act-binding's primary value here is an **audit tripwire** ("this verified
> token's declared intent doesn't match the call it showed up on") plus an
> **opt-in block** for agents that voluntarily consult the guard. It is not a
> substitute for the resource server validating the binding itself.

### The binding claim

A namespaced claim — deliberately **not** `act`, which RFC 8693 reserves for a
nested actor object (`act.sub`) that a hash-shaped payload would corrupt for any
8693-aware verifier:

```json
"urn:dashclaw:act-binding": {
  "typ":  "action-binding/v1",
  "hash": "sha256:<base64url-digest>"
}
```

`hash` is a SHA-256 over the canonical tuple the issuer committed the token to.
Canonicalization is a constrained [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
profile: the three values are forced to strings, NFC-normalized, and serialized
with lexicographically ordered keys and no whitespace. Both the issuer and
DashClaw go through `app/lib/act-binding.js` so the bytes can't drift.

The guard hashes the incoming request context — `action_type` → `action`,
`target` → `target`, `declared_goal` → `goal` — and compares. (`target` is a new
optional guard-input field; the binding tuple needs a resource.)

### act_status enum

| Value             | Meaning                                                          |
|-------------------|-----------------------------------------------------------------|
| `not_applicable`  | No verified token (Phase 1 / unverified path)                   |
| `match`           | Claim present, digest matches the call                          |
| `mismatch`        | Claim present, digest does **not** match → guard can block      |
| `not_present`     | Verified token carried no binding claim                         |
| `unsupported_typ` | Binding `typ` not in `DASHCLAW_ACT_BINDING_TYP`                 |
| `ctx_incomplete`  | Request lacked `action`/`target`/`goal` to compute the digest   |

`act_status` is recorded on `guard_decisions` in **every** mode, including
`off` — that's the point: it's the observable that tells an operator their
issuer has started minting bindings and it's safe to enable enforcement.
`act_hash` logs the claim-side digest only (the unfakeable half).

### Modes

| Mode          | `mismatch` | `not_present` | `unsupported_typ` | `ctx_incomplete` |
|---------------|------------|---------------|-------------------|------------------|
| `off`         | record     | record        | record            | record           |
| `best_effort` | **block**  | record        | record            | record           |
| `required`    | **block**  | **block**     | **block**         | **block**        |

Default is `best_effort` (v3.6, 2026-07-04 — graduated from `off`): it only
ever blocks a *positive* `mismatch`, which requires a present binding claim,
so issuers that don't mint the claim see zero behavior change while an
actually repurposed token starts blocking. `required` stays opt-in (not the
default, unlike replay protection): it blocks `not_present`, which would make
minting the claim a precondition for adopting JWKS at all. Flip to `required`
once `act_status='match'` shows up in your `guard_decisions` — that signal is
recorded in every mode for exactly this purpose. Rollback is one env var:
`DASHCLAW_ACT_BINDING=off`.

### Configuration

```bash
DASHCLAW_ACT_BINDING=best_effort               # off | best_effort | required
DASHCLAW_ACT_BINDING_TYP=action-binding/v1     # accepted typ list (comma-separated)
```

## Resilience

DashClaw uses a fail-soft model: if the JWKS endpoint is unreachable or slow,
tokens resolve to `unverified` rather than `failed`. A downed identity provider
cannot block agent decisions. Phase 1 body-field attribution (`agent_id` /
`agent_name` in the request body) is always the fallback.

The JWKS fetcher includes:
- **1-hour cache** per issuer — eliminates per-request latency
- **Circuit breaker** — opens after 3 consecutive fetch failures; stays open
  for 30 s, then half-opens for retry
- **5-second fetch timeout** — prevents slow JWKS from adding audit latency

## Configuration

Set these environment variables. No YAML config file is needed.

```bash
# REQUIRED to enable verification (v3.7 fail-closed): with no issuer configured,
# bearer tokens never reach 'verified' — there is no trust anchor. Tokens from
# other issuers → verification_status = 'unknown_issuer'.
DASHCLAW_ALLOWED_ISSUER=https://idp.example.com

# Optional: require this value in the JWT 'aud' claim.
# Mismatch → verification_status = 'failed'.
DASHCLAW_JWT_AUDIENCE=dashclaw.production.example.com
```

Both env vars are optional. Without them DashClaw accepts tokens from any
issuer and does not validate the audience — useful during development.

## JWT token schema

```json
{
  "iss": "https://idp.example.com",
  "sub": "agt_7f3a2b",
  "agent_name": "review-worker-3",
  "aud": "dashclaw.example.com",
  "exp": 1744300800,
  "iat": 1744300500,
  "jti": "txn_a8f3..."
}
```

| Claim        | Required | Used by DashClaw                          |
|--------------|----------|-------------------------------------------|
| `iss`        | Yes      | JWKS discovery (`{iss}/.well-known/jwks.json`) |
| `sub`        | Yes      | Canonical `agent_id` when verified        |
| `agent_name` | No       | Human-readable label in audit entries     |
| `aud`        | No       | Validated when `DASHCLAW_JWT_AUDIENCE` set |
| `exp`        | No       | Checked before JWKS fetch (fast path)     |
| `jti`        | No       | Replay-protection key (Phase 2b, shipped) |

## Supported algorithms

EdDSA (Ed25519), RS256/384/512, ES256/384/512.

## SDK usage

```javascript
import DashClaw from 'dashclaw';

const dashclaw = new DashClaw({
  baseUrl: 'https://dashclaw.example.com',
  apiKey: 'dc_key_...',
  // Phase 1 trust-on-assertion (still works):
  agentId: 'agt_7f3a2b',
  agentName: 'deploy-checker',
  // Phase 2 JWKS verification — pass your AAT as a bearer token:
  authToken: '<your-jwt-from-your-idp>',
});

const result = await dashclaw.guard({ action_type: 'deploy' });
console.log(result.verification_status); // 'verified' | 'unverified' | ...
```

## Example: AgentLair

AgentLair (agentlair.dev) issues Ed25519-signed JWTs (Agent Audit Tokens)
with a persistent `sub` (stable `agent_id`) and publishes JWKS at
`https://agentlair.dev/.well-known/jwks.json`.

To use AgentLair as your identity provider:

```bash
DASHCLAW_ALLOWED_ISSUER=https://agentlair.dev
DASHCLAW_JWT_AUDIENCE=dashclaw.example.com  # optional
```

No other changes are needed — the standard bearer token flow works as-is.

## Example: Keycloak

```bash
DASHCLAW_ALLOWED_ISSUER=https://keycloak.example.com/realms/agents
# JWT iss must match exactly. JWKS auto-discovered from:
# https://keycloak.example.com/realms/agents/.well-known/jwks.json
```

## Example: Auth0

```bash
DASHCLAW_ALLOWED_ISSUER=https://your-tenant.auth0.com/
# JWKS auto-discovered from:
# https://your-tenant.auth0.com/.well-known/jwks.json
```

## Backward compatibility

Phase 2 is fully additive. Existing integrations using Phase 1 body-field
attribution continue to work without any changes. The only difference is that
`verification_status` will be `unverified` instead of absent.
