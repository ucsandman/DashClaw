# The graduation path: the cap becomes a door — Roadmap v7.2 (spec 2026-07-05)

Roadmap v7.2 (`docs/plans/owner-roadmap.md`). A hosted trial currently ends
in data loss: the org's policies, decisions, actions, agents, and
assumptions evaporate with the workspace. This ship gives the trial a
carry-out — export the governance record as a bundle, import it into an
owned instance — and teaches funnel truth the new conversion event:
**graduated**.

Build-time recon (two sweeps, 2026-07-05) verified every mechanic below
against the actual schema, middleware, CLI, and UI; nothing here is
assumed from the roadmap text. Corrections to the roadmap's sketch are
called out inline.

## Decisions (with the alternatives weighed)

1. **The bundle carries the durable governance record, nothing
   credential-shaped.** In scope: `guard_policies`, `guard_decisions`,
   `action_records`, `open_loops`, `assumptions`, `agent_identities`
   (public keys are verification material, safe). Out of scope, by class:
   - **Credentials and credential-equivalents — never**: `api_keys`
     (`key_hash` is replayable), OAuth token/code hashes, the instance
     signing key (`server_signing_keys.private_jwk`). Keys are minted
     fresh on the owned instance.
   - **Managed secret values — never** (write-only invariant; ciphertext
     is AAD-bound to the source `org_id` and would be inert anyway).
     `governed_secrets` stays out of v1 entirely — metadata-only export
     invites confusion about whether values moved.
   - **Ephemeral telemetry — skipped**: `agent_presence`, activity logs,
     drift/posture snapshots. The record is what the org decided, not its
     heartbeats.
   - `guard_decisions.jti` (replay nonce) is dropped from exported rows —
     forensic to the source instance, meaningless on the target.
   - `action_records.signature` and `.verified` are dropped (security
     review, 2026-07-05): they attest to the *source* instance's signing
     key, cannot re-verify on the target, and must never render as
     natively verified after import. Imported rows get schema defaults.
   - Import is deliberately **not transactional** (per-row inserts): a
     mid-bundle failure leaves a partial import, and the idempotent
     re-run completes it — recovery is `dashclaw import` again, which
     the security review accepted as the v1 posture.
2. **Export = `GET /api/workspace/export`, org-scoped, admin role.**
   Recon: trial browser sessions already carry `x-org-role: admin` via
   middleware, so the exact `policies/import` gate (`getOrgId` +
   `getOrgRole === 'admin'`) works unmodified — no new auth machinery.
   The route is not hosted-gated: an owned instance can export too (the
   same bundle is the backup/portability story), but the graduation stamp
   below only applies to hosted trials.
3. **Export stamps graduation.** First successful export sets
   `organizations.trial_exported_at` (hosted-mode orgs only; idempotent —
   the earliest stamp wins). Funnel semantics: **graduated = the org took
   its record out**. We deliberately do not require a confirmed import on
   another instance — that event happens outside our visibility, and
   claiming it would violate funnel truth. The annotation name renders as
   `graduated`; the column records the fact (`trial_exported_at`).
4. **Import = `POST /api/workspace/import`, admin-gated, idempotent.**
   Same auth pattern. Rows are remapped to the *target* org
   (`getOrgId(request)`), text PKs preserved (`ON CONFLICT DO NOTHING`
   makes re-import safe), serial PKs assigned fresh, `agent_identities`
   upserted on `(org_id, agent_id)` DO NOTHING. Returns per-table
   imported/skipped counts. Bundle `format`/`version` checked first;
   unknown versions rejected loudly.
5. **The human's export step is one click.** A client component
   (`ExportWorkspaceButton`) on the `/connect` trial card fetches the
   route riding the trial session cookie (the `FirstGovernedActionCard`
   pattern) and saves the file. *Roadmap correction:* the roadmap said
   "/setup, /connect" — recon shows `/setup` has no per-user trial card
   (it is the public deployment-truth surface); the button ships on
   `/connect` only, which is where trial humans actually are.
6. **Import rides the terminal the instance is born in — an explicit
   HUMAN-EXPERIENCE decision.** New CLI subcommand `dashclaw import
   <bundle.json>` posts the bundle over HTTP with the freshly-minted API
   key (`apiRequest` pattern, consistent with every post-`up` command).
   The roadmap's own text pins this: the terminal appears only where the
   owned instance is born, and `npx dashclaw up` is already that
   documented moment. No import UI in v1 (recorded decision, not a
   default); revisit if a real user asks.
7. **Fresh-install DDL gap fixed in the same ship.** Recon found
   `hosted_trial_snapshots` missing from the `CRITICAL_TABLES_DDL`
   fallback in `app/api/setup/migrate/route.ts` (pre-existing; the
   fallback only fires when `drizzle/` isn't bundled). The fallback gains
   the full table plus the new columns.

## Schema (drizzle/0057_graduation_path.sql + schema.js + fallback DDL)

- `organizations` + `trial_exported_at timestamptz` (NULL = never
  exported).
- `hosted_trial_snapshots` + `exported_at timestamptz` (frozen at
  deletion by `snapshotTrialFunnelFacts`, like every other milestone).

## Bundle format (v1)

```json
{
  "format": "dashclaw-workspace-bundle",
  "version": 1,
  "exported_at": "<iso>",
  "org": { "id": "<source org id>", "name": "<org name>" },
  "counts": { "guard_policies": 3, "guard_decisions": 41, "...": 0 },
  "tables": {
    "guard_policies": [ { "...": "row objects, snake_case columns" } ],
    "guard_decisions": [],
    "action_records": [],
    "open_loops": [],
    "assumptions": [],
    "agent_identities": []
  }
}
```

Download filename: `dashclaw-workspace-<org-prefix>-<yyyy-mm-dd>.json`
(Content-Disposition). Source org id ships in the bundle for provenance;
the importer never trusts it for scoping.

## Funnel truth

- Facts gain `graduatedAtMs` (live: `organizations.trial_exported_at`;
  archived: `hosted_trial_snapshots.exported_at`; NULL = not graduated,
  never guessed).
- `computeFunnelAggregates` annotations gain `graduated: number` —
  an annotation under the funnel, not a new step (v5.3 rule), truthful
  zeros included. `/setup`'s funnel card renders it.
- `snapshotTrialFunnelFacts` freezes `exported_at` before deletion.

## Surfaces and proof

- **Route hygiene**: both routes go through a repository
  (`workspace-bundle.repository.js` or equivalent) — `route-sql:check`
  stays at zero direct SQL.
- **Smoke**: new lettered section **AE** in `scripts/policy-smoke.mjs`
  following the AA–AC convention: hosted-off → export behaves like any
  authed route (no hosted leak), unauthenticated → 401; detailed
  contract math stays in vitest (AC precedent).
- **Tests**: repository round-trip (export shape excludes forbidden
  columns — a test enumerates the deny-list), import idempotency (twice
  → second run all-skipped), funnel math with graduated (truthful
  zeros), route auth (403 non-admin), button render.
- **Live proof (acceptance)**: one real migration — mint/act on a local
  hosted-mode instance, click the button, `dashclaw import` the bundle
  into a second fresh instance, and see the decisions/policies in its UI.
- **Docs + marketing, same ship**: `/self-host` gains the carry-out
  line; trial copy on the landing/connect pages mentions the record is
  yours to take; README/QUICK-START touched only where trial or `up` are
  described; counts re-checked (`check-doc-counts --strict`).
- **Security review before ship**: `dashclaw-security-reviewer` pass on
  the diff (new authed routes, export surface). The deny-list in
  decision 1 is the review's first checklist item.

## HUMAN-EXPERIENCE answers (contract at build time, not gate time)

1. **Where does a human SEE it?** `/connect`, on the trial workspace
   card — the page every trial human lands on and returns to. The button
   sits beside the cap/usage line it rescues.
2. **Is it discoverable?** Yes — same card that shows "N of M governed
   actions used"; no deep URL, no docs required to find it.
3. **Is every human step a CLICK?** Export: one click → file downloads.
   Import: terminal at instance birth, per decision 6 — the explicit,
   recorded exception the roadmap itself specifies.
4. **Was it verified rendered?** frontend-verify drives `/connect` in a
   trial session and confirms the button renders and the download fires;
   the live-proof run exercises the full path end to end.

## Acceptance (from the roadmap, unchanged)

One real migration proven live; the button rendered and verified; the
funnel annotation live with truthful zeros; docs and marketing updated in
the same ship.
