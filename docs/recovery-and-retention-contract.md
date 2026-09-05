---
owner: Operations
last-verified: 2026-09-05
doc-type: contract
---

# Recovery and retention contract

DashClaw does not infer a recovery guarantee from a database provider's backup feature or from a pricing label. A service operator owns backup configuration, restore access, encryption-key escrow, drill cadence, and incident reconciliation. A self-hosted operator owns the same duties for their deployment.

## Objectives and ownership

Before offering an SLA, the service owner must record two measured objectives for the deployment:

- Recovery point objective (RPO): maximum tolerated time between the incident and the newest durable state present in the restored copy.
- Recovery time objective (RTO): maximum time from the recorded start of restoration until the disposable copy completes the verification drill.

The repository supplies no customer-facing RPO or RTO guarantee. For an initial internal rehearsal, the operator may use 24 hours (`86400` seconds) RPO and 8 hours (`28800` seconds) RTO as drill thresholds. Those values are test targets only until repeated provider-backed drills meet them and the service owner adopts them in a published service contract.

The incident commander owns effect reconciliation. Database restoration cannot establish whether a payment, deployment, email, webhook, or other external effect occurred before response loss. Every outstanding `running` or `pending_approval` claim must be reconciled with its effect-specific system before retrying it.

## What a recoverable set contains

A recoverable set includes:

1. A consistent Postgres backup containing action records, approval state, guard decisions, signing-key rows, webhook configuration, and delivery history.
2. The `ENCRYPTION_KEY` version needed to decrypt that backup, held separately from the database snapshot.
3. Any externally held `DASHCLAW_SIGNING_KEY_JWK` and provider credentials required to restart the service, held in the operator's secret manager.
4. The application version and migration level that created the snapshot.
5. The incident time, snapshot time, restore start time, and the operator who owns reconciliation.

Database data without its matching wrapping key is not a usable restore. A wrapping key stored only beside the database does not provide independent custody.

## Disposable restore drill

Restore the snapshot to a new nonproduction database. Do not point the drill at the source or production database. The verifier is read-only and refuses identical source and target database identities.

Set the required values in the process environment through the deployment's credential tooling. Do not add them to repository files or command history. Then run:

```powershell
node --import tsx scripts/drills/recovery-restore.mjs
```

Required names are `RECOVERY_DRILL_DATABASE_URL`, `RECOVERY_SOURCE_DATABASE_URL`, `RECOVERY_DRILL_ENVIRONMENT=nonproduction`, `RECOVERY_INCIDENT_AT`, `RECOVERY_SOURCE_SNAPSHOT_AT`, `RECOVERY_RESTORE_STARTED_AT`, `RECOVERY_RPO_OBJECTIVE_SECONDS`, and `RECOVERY_RTO_OBJECTIVE_SECONDS`.

The drill reports table counts, the exact outstanding action count with a sample of up to 100 rows, cryptographic verification of up to 100 recent evidence receipts, and measured RPO/RTO. The outstanding-action report includes `sample_count` and `truncated` so a bounded sample cannot be mistaken for the full reconciliation workload. It exits nonzero for missing signing keys, failed historical verification, or a missed objective. Outstanding claims produce `review`, because their existence is not data loss but requires effect-specific reconciliation. The output deliberately does not include private JWKs, webhook secrets, or database URLs.

A passing drill proves only that this supplied snapshot was readable and internally verifiable at that time. It does not prove that the provider will make a suitable snapshot available during a future incident, that every row beyond the bounded sample was checked, or that external effects agree with the restored ledger. Record those limitations with every drill result.

## Current retention behavior

- Plan and pricing history windows describe included access unless a deletion path explicitly says otherwise. They do not create a general action, approval, or evidence purge.
- Webhook delivery diagnostics are pruned after 30 days when new deliveries are logged.
- Synthetic test traffic and expired hosted trial workspaces have separate, explicit cleanup paths. Those paths do not define retention for ordinary governed history.
- Signing public keys and their lifecycle status remain available for historical verification. Compromised public keys remain in the status manifest but leave the trusted JWKS set.

No broad destructive purge is part of this contract. Adding one requires a defined record class, authorization owner, legal and product retention decision, recovery window, and a tested deletion audit trail.
