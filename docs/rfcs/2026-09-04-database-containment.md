# RFC: Database Containment (`allow_contained`, basis `db_branch`)

- **Status:** ACCEPTED (owner, 2026-09-04) — the first feature of the post-governed-autonomy bet recorded in THESIS.md ("Next bet — containment beyond files").
- **Date:** 2026-09-04
- **Amends:** RFC 2026-07-06-containment-verdicts, "Scope honesty" — the line *"SQL against live databases … stay on the `require_approval` rail"* is superseded for one provider by the mechanism below. Everything else in that RFC stands.
- **Constrained by:** `docs/architecture/enforcement-boundary.md` — mechanical enforcement exists only on hook-cooperating harnesses. v1 of this feature exists ONLY at the hook seam (Claude Code / Codex / Hermes `Bash` tool). Bare SDK/MCP callers never receive it (negotiation).
- **Surface budget:** zero change. No new routes, pages, MCP tools, SDK methods, CLI commands, or policy types. One new hook module file, mirrored into the plugin bundle.

## Summary

The containment verdict already turns a risky **file** mutation into a reversible one: the act runs in a git worktree, the operator reviews the diff once, and Promote raises a single-use, act-hash-bound grant for the merge. This RFC applies the identical shape to **Postgres mutations on Neon**: the act runs against an ephemeral Neon branch of the target database, the operator reviews the statement, the schema diff and the output once, and Promote raises a single-use, act-hash-bound grant to replay the same command against the real database.

Same lattice position, same negotiation rule, same lifecycle (`contained → awaiting_promotion → promoted | discarded`), same route, same card, same CLI. What changes is the staging medium and the promotion act.

## Why this and not a proxy

The 2026-09 outsider review proposed two things: an infrastructure proxy that forces every outbound call through DashClaw, and containment for non-file effects. The proxy is rejected again (it sees bytes, not the declared goal, and the enforcement-boundary ADR already killed it). Containment beyond files is accepted because it sits on the loop by construction: intercept → decide → contain → prove, with the human's one click at the end. The original containment RFC declined SQL because a live database had no cheap reversible medium. A Neon branch is that medium: copy-on-write, seconds to create, inherits the parent's roles and passwords, self-deletes on an expiry timestamp.

## Design

### Capability negotiation

A second capability string: `allow_contained:db`. The existing `allow_contained` string keeps its exact meaning (file basis only). Server rule in `finalizeContainment`:

| basis | required capability | otherwise |
|---|---|---|
| `file`, `shell_file_ops` | `allow_contained` | `require_approval`, breakdown `_containment.downgraded_to_interrupt` |
| `db_branch` | `allow_contained:db` | `require_approval`, same breakdown note |

An old hook that advertises only `allow_contained` can never receive a `db_branch` verdict. Skew only tightens, as before.

### Eligibility (server, `isContainableAct`)

A new basis `db_branch`, checked BEFORE the existing shell `apply` rule:

1. `act.kind === 'sql'` → eligible, basis `db_branch`. (Only hook callers advertise `allow_contained:db` in v1, so this branch is reachable for SDK callers only after a later RFC gives them a staging path.)
2. `act.kind === 'shell'` and the evidence classifier tagged the act with the new `database` flag (below), and the act carries no other disqualifying flag (`destructive`, `secret_exposure`, `remote_exec`, `vcs_dangerous`, `deploy`, `privilege`, `sensitive_path`, `device_write`, `protected_target`) → eligible, basis `db_branch`. `ddl` and `whereless` are NOT disqualifying: they are exactly the acts containment exists for.

Everything else falls through to the existing rules unchanged.

### Evidence classifier: shell acts that target a database

`classifyShell` gains one branch. A segment whose command slot is a Postgres client (`psql`, `pg_restore`, `prisma` with `db push|migrate deploy|migrate dev|migrate reset|db execute`, `drizzle-kit` with `push|migrate|drop`, `npx`/`pnpm`/`yarn`/`bunx` prefixes allowed) OR whose text carries a `postgres://` / `postgresql://` literal is a database act:

- flag `database` always;
- if the command carries inline SQL (`-c "…"`, `--command "…"`, `-f` is NOT inline, a heredoc body is), grade that SQL with the existing `classifySql` and take its `base_risk`, `derived_action_type`, `reversible_hint` and flags (`ddl`, `whereless`); the statement text is what the operator reviews;
- otherwise (migration tools, `-f file.sql`, `pg_restore`) grade `derived_action_type: 'migrate'`, `base_risk: 60`, `reversible_hint: false`.

This closes a pre-existing under-grade (today `psql -c "DROP TABLE users"` classifies as `other`/30 with no flags). It is honest grading, not a new hold: the default packs' mass-destructive line keys on `protected_target` (2026-08-21), which this branch never sets, so a fresh install's behavior on `psql` does not change. Golden vectors are added for the new class, both sides (benign `psql -c "select 1"` stays ≤ 20; `psql -c "drop table x"` ≥ 70).

### Ref, branch name, session state

- Server-derived ref, never client-supplied: `dashclaw/contained-db-<seg>[-<inst>]`, built by `buildContainmentRef(sessionId, instance, basis)`. The `db-` prefix keeps a session's DB branch distinct from its file worktree and lets every consumer (route, CLI, hook, card) branch on `ref.startsWith('dashclaw/contained-db-')`. The existing ref-shape regex (`^dashclaw\/contained-[A-Za-z0-9-]{1,64}$`) is unchanged; the segment cap shrinks by three to fit.
- Neon branch name = the ref with `/` replaced by `-`.
- One branch per harness session, lazily created on the first `db_branch` verdict and reused for the rest of the session, exactly like the worktree. The reviewed diff is therefore session-branch state, which the ContainmentCard already explains for files.
- Hook session state (same tempdir/instance-suffix scheme as the worktree state): `{ ref, project_id, parent_branch_id, branch_id, host, db_name, created_at, expires_at }`.

### Target resolution (hook, PreToolUse)

The production connection is `DATABASE_URL` in the hook's environment, else `DATABASE_URL` read from `<WORKSPACE>/.env.local` then `<WORKSPACE>/.env` (one key, never logged, never sent anywhere). If none resolves, or the host is not `*.neon.tech`, the hook simply does not advertise `allow_contained:db` for that call and the verdict lands as `require_approval`, today's behavior.

**A command that carries a `postgres(ql)://` connection-string literal is never advertised as db-containable** (build finding, 2026-09-04): the ledger's sensitive-data scan redacts the credential inside the recorded act, so the replay could never be byte-exact, and a grant bound to a redacted act must not exist. Such commands stay on the approval rail. The hook module keeps a literal-rewrite path for a future design that records a credential-free act.

Two implementation facts the build surfaced, recorded so the RFC matches the code: `action_records` stores only `act_content_hash`, so the original act for the replay is read from `guard_decisions.context.act` via `guard_decision_id` (route and CLI read the same field, so the grant hash binds); a db ref whose act cannot be recovered answers `409 CONTAINMENT_ACT_MISSING` instead of ever falling through to a merge act. The minted db grant carries the original action's `risk_score` and `reversible: false`.

Endpoint id = host up to the first `.` (must start with `ep-`). Project id = `NEON_PROJECT_ID` if set, else the first project from `GET /projects` (paginated) for which `GET /projects/{id}/endpoints/{endpoint_id}` returns 200. Parent branch id = that endpoint's `branch_id`. Cached in session state after the first resolution.

### Branch lifecycle (hook)

- Create: `POST /projects/{pid}/branches` with `{ branch: { parent_id, name, expires_at }, endpoints: [{ type: 'read_write' }] }`. `expires_at` = now + `DASHCLAW_DB_CONTAINMENT_TTL_HOURS` (default 72). The response's `endpoints[0].host` is the branch host.
- Branch connection URL = the production URL with only the host replaced. Neon child branches inherit the parent's roles and passwords, so nothing else changes.
- Rewrite (Claude Code `updatedInput`, the mechanism the file path already proved on v2.1.220): if the command contains the production URL literal, every occurrence is replaced by the branch URL; otherwise the command is prefixed with `DATABASE_URL='<branch_url>' PGHOST='<branch_host>' ` (single-quoted, shell-escaped). Harnesses without an input-rewrite channel get the same instructive exit-2 the file path uses today ("re-run against …"), with the branch host named and the password never printed.
- Cleanup: expiry. `dashclaw contained apply` and the dashboard Discard do not need a Neon key. A branch a session never finished with disappears on its own.
- Kill switches: `DASHCLAW_CONTAINMENT=0` (existing, covers both media); `DASHCLAW_DB_CONTAINMENT=0` (new, DB only). No `NEON_API_KEY` in the hook's environment means the capability is never advertised.

### Evidence (hook, PostToolUse)

After the contained command runs, the hook fetches `GET /projects/{pid}/branches/{branch_id}/compare_schema?base_branch_id={parent}&db_name={db}` and posts ONE `patch` artifact (same `artifact_type` so the route's evidence binding and the card's fetch stay unchanged) with:

```json
{
  "kind": "db",
  "ref": "dashclaw/contained-db-…",
  "diff": "<schema diff from Neon, may be empty>",
  "statement": "<the command as run against the branch, credentials scrubbed>",
  "stdout_tail": "<last 4 KB of the tool's output, credentials scrubbed>",
  "project_id": "…", "branch_id": "…", "parent_branch_id": "…", "db_name": "…",
  "note": "schema unchanged — data changes are not diffable; review the statement and its output"
}
```

`_scrub_act_text` must redact the password component of any `postgres(ql)://user:pass@host` URL before anything reaches the artifact or the log. Then the existing flip: `PATCH containment_status=awaiting_promotion, containment_ref=ref, agent_id`. The Stop hook's awaiting-promotion sweep covers a missed flip exactly as for files.

### Promotion (route + CLI)

`buildPromotionAct(containmentRef, originalAct)`:

- file ref → `{ kind: 'shell', command: 'git merge --no-ff <ref>' }` (unchanged);
- db ref → the action's **original recorded act**, byte-for-byte. The guard recorded the pre-rewrite command at `?record=true` time, so the replay target is the production database the agent originally addressed.

The synthetic `containment_promote` grant is minted exactly as today (single-use, act-content-hash bound, born `running`, stamped with the operator's verdict). Its `risk_score` is the original action's score rather than the file path's constant 20, because the replay IS the risky act.

`dashclaw contained apply <actionId>` for a db ref: same server-truth checks (`promoted`, ref shape), then `guard()` with the original act, then run the original command via the shell from the repo root with the operator's own environment, then print the output. Nothing to clean up (expiry).

The evidence-binding check (`content.ref === containment_ref`) is unchanged and now also binds the replay to the reviewed statement.

### Human surface (HUMAN-EXPERIENCE.md, the four answers)

1. **Where does a human SEE it?** `/approvals`, the existing ContainmentCard, reached the way every contained action is reached today. A `kind: 'db'` artifact renders as: "Database branch" header with the branch id; the statement in a code block; the schema diff, or the "schema unchanged" note; the output tail; the two existing buttons. `/decisions/[actionId]` shows the same evidence.
2. **Is it discoverable?** Same card, same inbox, same nav. The Promote button reads "Promote — replay on production" for a db card so the consequence is on the button.
3. **Is every human step a CLICK?** Promote / Discard are the existing buttons. `dashclaw contained apply` remains the agent's/operator's replay step, as it is for the git merge today.
4. **Verified rendered?** Demo mode gains one db-kind contained fixture so the card renders without a Neon account; the ship verifies it with frontend-verify.

### Rollout safety

- No behavior change for any installation that does not set `NEON_API_KEY` in the hook's environment (capability never advertised → today's `require_approval`).
- No behavior change for non-Neon databases (host check).
- Skew matrix: old server + new hook → server never emits `db_branch`, hook never sees it; new server + old hook → hook never advertises `allow_contained:db`, server downgrades to `require_approval`.
- A branch is never promoted by data copy or restore. Promotion is always a replay of the reviewed statement, so concurrent production writes between staging and promotion are never overwritten.

## Not in v1 (recorded so they are not silently promised)

- SDK/MCP callers staging their own branch (needs a client-side driver contract).
- Data diffs (Neon has no data-diff API; the statement, the schema diff and the output are the evidence).
- Non-Neon providers. The basis is named `db_branch`, not `neon`, so a second provider (Xata, PlanetScale, Supabase branching) is a hook-side driver, not a server change.
- Automatic branch deletion on Discard (expiry covers it; a `dashclaw contained discard` that deletes early is a follow-up if branches pile up in practice).

## Files

Server: `app/lib/guard/containment.ts`, `app/lib/guard/evidence.ts`, `app/api/actions/[actionId]/containment/route.ts`, `app/approvals/_components/ContainmentCard.tsx`, `app/decisions/[actionId]/page.tsx` (evidence render), `app/lib/demo/demoMiddleware.ts` (db fixture), `cli/bin/dashclaw.js`.
Hook: `hooks/dashclaw_pretool.py`, `hooks/dashclaw_posttool.py`, new `hooks/dashclaw_db_containment.py` (Neon client + detector + rewrite + scrub), `scripts/refresh-bundles.mjs` (mirror list), `.env.example`, `hooks/README.md`.
Tests: `__tests__/unit/guard-containment-*.test.*`, `__tests__/unit/containment-route.test.ts`, `__tests__/fixtures/risk-calibration-golden-vectors.json`, hook pytest suite, CLI node:test.
Docs: `docs/architecture/runtime-api.md` (containment section), `docs/concepts.md`, `README.md` lattice paragraph, `app/explain/sections.tsx`, `docs/sdk-parity.md` (no SDK change, note the capability string), THESIS.md amendment (already written), CHANGELOG via ship.
