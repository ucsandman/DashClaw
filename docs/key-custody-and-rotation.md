---
owner: Security and Operations
last-verified: 2026-09-05
doc-type: contract
---

# Signing and webhook key custody

This document defines what DashClaw protects, who owns each key, and how rotation changes verification. It is an operating contract, not a claim that database evidence remains trustworthy after every host compromise.

## Custody boundary

`ENCRYPTION_KEY` is the instance wrapping key. The service operator must keep it outside Postgres and include it in a separately protected recovery escrow. DashClaw uses AES-256-GCM with object-bound additional authenticated data:

- DB-backed issuer private JWKs bind to their `kid`.
- Webhook HMAC secrets bind to their organization and webhook ID.

This prevents a database-only reader from using the stored ciphertext or moving it to another row. It does not protect keys from a process that can read `ENCRYPTION_KEY`, from a compromised application runtime, or from an operator account that can change runtime configuration.

`DASHCLAW_SIGNING_KEY_JWK` remains the external-custody option. When present, DashClaw signs with that key and does not persist its private half. The operator owns backup, availability, access control, and rotation of that value. Public key material is not confidential.

DB-backed rotation is observed on the next signing operation because the runtime re-checks the active key before issuance. An environment-held signing key is process configuration; changing `DASHCLAW_SIGNING_KEY_JWK` requires a controlled restart of every service replica.

Releases before the custody migration stored webhook secrets and DB-backed private JWKs as plaintext. Runtime reads intentionally accept those rows so an upgrade does not stop deliveries or invalidate the current issuer. New writes are always encrypted. The operator must run the explicit migration after deploying the schema:

```powershell
node --import tsx scripts/custody-keys.mjs
node --import tsx scripts/custody-keys.mjs --apply --confirm ENCRYPT_CUSTODY_MATERIAL
```

The first command reports counts only. The second uses compare-and-swap updates and prints counts, never secret values. A production invocation also requires `--allow-production`. Review database backups and a rollback window before invoking it against a live instance.

## Signing lifecycle

Each DB signing key has one lifecycle state:

| State | Issues new evidence | Present in trusted `keys` | Present in `dashclaw_key_status` | Meaning |
|---|---:|---:|---:|---|
| `active` | Yes | Yes | Yes | Current issuer key. At most one DB key is active. |
| `retired` | No | Yes | Yes | Rotation without known compromise. Historical signatures remain verifiable. |
| `compromised` | No | No | Yes | Signing authority may have been copied. The public status preserves incident evidence without treating the key as trusted. |

`GET /.well-known/jwks.json` returns trusted active and retired public keys in `keys`. The additive `dashclaw_key_status` array contains all DB key states, including compromised key IDs and timestamps, without private material. Existing JWKS clients ignore the extension.

Rotate a healthy DB-backed issuer and retire its predecessor:

```powershell
node --import tsx scripts/custody-keys.mjs --apply --rotate-signing-key --confirm ENCRYPT_CUSTODY_MATERIAL
```

Mark a known key compromise:

```powershell
node --import tsx scripts/custody-keys.mjs --apply --rotate-signing-key --compromise-kid <kid> --confirm ENCRYPT_CUSTODY_MATERIAL
```

The command requires a replacement rotation whenever a key is marked compromised, so the DB-backed issuer is not left without an active key. The lifecycle update does not prove when compromise began. A signature whose key is marked compromised needs an external trusted timestamp or other corroboration before it can be accepted as pre-compromise evidence. Removing that key from trusted JWKS prevents routine verification from blessing new forgeries, while the status manifest retains the incident record. It cannot distinguish a legitimate old signature from a forged signature backdated after key theft.

Rotating `ENCRYPTION_KEY` is a separate operation. Stored ciphertext must be decrypted with the old wrapping key and re-encrypted with the new one during a controlled maintenance window. `custody-keys.mjs` does not automate that operation because losing the old key would make the existing material unrecoverable.
