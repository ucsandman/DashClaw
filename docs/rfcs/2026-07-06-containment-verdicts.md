# RFC: Containment Verdicts (`allow_contained`)

- **Status:** PROPOSED (program: governed-autonomy, build order 3 of 3 — see `docs/plans/2026-07-06-governed-autonomy-program.md`)
- **Date:** 2026-07-06
- **Depends on:** calibration controller landed (shared `evaluate.ts` seam); **owner-roadmap v8.2 enforcement-liveness probe SHOULD be shipped first** — containment leans harder on the hook seam than any existing feature, and building it on an unproven seam repeats the v4.72.1 failure class. Preflight Plan Authorization (RFC 2026-07-06) should land first so the approvals surface already has the multi-card review pattern.
- **Constrained by:** `docs/architecture/enforcement-boundary.md` (ADR, accepted 2026-07-04) — mechanical enforcement exists ONLY on hook-cooperating harnesses. Containment claims nothing beyond that boundary.

## Summary

A new guard verdict between `warn` and `require_approval`: **execute now, but inside an isolated workspace, with effects staged**. The agent keeps moving at full speed; the human reviews a *diff of staged effects* once, asynchronously, and clicks Promote or Discard. Containment converts "risky" into "reversible" — the operator's job shifts from synchronous gatekeeper to asynchronous reviewer, which is exactly the product's brand posture (calm under pressure).

## Motivation

- Today's ladder forces a binary at the risky margin: interrupt the human (`require_approval`, latency tax) or let it through (`warn`, no takeback). Every competitor has the same binary. Nobody has "proceed reversibly, ratify the diff."
- Git worktrees make file-system containment nearly free on the exact surface DashClaw governs mechanically (Claude Code / Codex hooks).
- Composes with the calibration controller and preflight plans: θ can learn to prefer containment over interruption for mid-band risk, and a plan step previewed as `allow_contained` tells the operator upfront which steps will stage.

## Scope honesty (what containment can and cannot contain)

**Eligible effect class (v1): file-system mutations in a git repository, on a hook-cooperating harness.** That is: `Edit`/`Write`/`MultiEdit` tool calls, and `Bash` acts the evidence classifier already classes as file-mutating, when the working directory is a git repo.

**Explicitly NOT containable, ever emitted as `allow_contained` for:** HTTP calls, payments/x402, SQL against live databases, message sends, deploys — irreversible-by-nature effect classes stay on the `require_approval` rail. The server enforces this eligibility check; it is not a hook courtesy. If the evidence classifier cannot prove the act is file-scoped, the verdict falls back to `require_approval`.

## Design

### Severity ladder change

`DECISION_SEVERITY`: `allow < warn < allow_contained < require_approval < block`. `raiseDecision`/`sevOf` (`app/lib/guard/evaluate.ts:104`) work unchanged. **This is the single highest-blast-radius edit in the program** — run GitNexus `impact` on `sevOf`, `raiseDecision`, `DECISION_SEVERITY`, and `buildGuardResult`, and grep EVERY decision-string consumer: both SDKs, all hook variants (`hooks/`, `plugins/dashclaw/hooks/`, `.claude/hooks/`), the OpenClaw plugin, MCP server, UI badge components, policy simulate, OpenAPI schema, and the docs' decision tables.

### Backwards compatibility — capability negotiation (non-negotiable)

Old clients must never receive a verdict they don't understand. Guard callers advertise support: `context.client_capabilities: ['allow_contained']` (sent by updated hooks/SDKs only). Server rule in `buildGuardResult`:

- Caller advertises support → emit `allow_contained` + `containment` object.
- Caller does not → **emit `require_approval` instead**, with breakdown note `_containment: { downgraded_to_interrupt: true }`. Safe direction: an unaware client gets a stricter verdict, never a looser one.

This rule makes rollout monotonically safe across every SDK/hook version skew.

### Verdict sources (v1)

1. `risk_threshold` policy rules gain optional `contain_above` (int). Validation: must be strictly below the threshold that produces `require_approval` in that policy's rules (read the actual `risk_threshold` evaluator in `app/lib/guard/policy.ts` for the real field names before writing validation). Score in [contain_above, interrupt threshold) → evaluator returns action `allow_contained` — only when the act passes the server eligibility check above; otherwise it returns `require_approval` as today.
2. That's it for v1. Calibration-controller integration (θ band for containment) is explicitly future work — do not touch `runCalibrationController`.

### Server-side state

No new tables. `action_records` gains columns (migration — next free drizzle number): `containment_status` (`null` | `contained` | `awaiting_promotion` | `promoted` | `discarded`), `containment_ref` (text — branch/worktree identifier; since the v5.6.x security follow-up it is stamped server-side at guard `?record=true` time from the payload's `harness_session_id`, no longer reported by the hook), `containment_resolved_by`/`_at`. Staged diffs are stored through the **existing artifacts system** (`/api/artifacts`, linked to the action) — do not invent a new blob store.

New route: `POST /api/actions/[actionId]/containment` (operator-authenticated, mirroring approvals auth): `{ verdict: 'promote' | 'discard' }` → flips `containment_status` to `awaiting_promotion`→`promoted` or →`discarded`, stamps resolver. All SQL through `actions.repository.ts`.

**Promotion is itself governed.** The merge that lands staged effects into the real tree is a new guarded action (`action_type: 'containment_promote'`, act = the merge command) — it flows through guard like everything else, and the operator's promote click creates a standard operator-approval grant covering exactly that merge (reuse `applyOperatorApprovalGrant` machinery by writing the grant fields the same way the approvals route does — read that route, don't reimplement). This closes the loop with zero new grant machinery.

### Hook mechanics (Claude Code pretool — the hard part)

On `allow_contained` for an eligible tool call, the hook redirects execution into a **containment worktree**: one per session, lazily created at first contained action — `git worktree add <repo>/.dashclaw/contained/<session_id> -b dashclaw/contained-<session_id>` (gitignore `.dashclaw/` — verify it's ignored, add if not).

Two implementation strategies; **verify harness support at build time and pick, do not assume** (dispatch a claude-code-guide subagent to confirm the current PreToolUse output contract):

- **Primary — input rewrite:** if the installed Claude Code version supports PreToolUse `hookSpecificOutput.updatedInput`, rewrite `Edit`/`Write`/`MultiEdit` file paths into the worktree, and for eligible `Bash`, rewrite cwd. Transparent to the agent.
- **Fallback — instructive deny:** exit 2 with a precise, actionable message: `Contained: re-run this edit against <worktree path> (containment ref <ref>). Effects will be staged for operator promotion.` Cooperative redirection — the agent redoes the action in the worktree; the retry guard call passes (path now inside the containment ref, server records the containment_ref).

Posttool: after a contained mutation, the hook computes `git diff` in the worktree and posts it as an artifact on the action (size-capped; reuse the artifact upload path the hooks already use for evidence if one exists — check before adding). `dashclaw_stop`/session-end marks the session's contained actions `awaiting_promotion` if diffs exist.

CLI: `dashclaw contained list|diff|apply` — `apply` runs after the dashboard shows Promoted: it performs the governed merge (the `containment_promote` action) and cleans up the worktree. The AGENT or developer runs this; the human's role remains clicks only (HUMAN-EXPERIENCE: the human judges, the machine merges).

**Codex/Hermes parity:** mirror capability advertisement + eligibility handling; if a harness cannot redirect, its hook simply never advertises `allow_contained` and gets `require_approval` — graceful, no special-casing.

### SDK surface

Node: `resolveContainment(actionId, verdict)`, `listContained(opts)`; the guard response type gains `containment`. Python parity (`resolve_containment`, `list_contained`). SDKs do NOT advertise `client_capabilities: ['allow_contained']` by default in v1 — only callers that actually implement staging opt in (a bare SDK caller has no worktree machinery; giving it `allow_contained` would just be a confusing `allow`).

### UI surface (HUMAN-EXPERIENCE.md — answered in writing)

1. **Where does a human SEE it?** `/approvals` gains a **Containment** tab: cards showing agent, action, containment ref, and the staged **diff rendered inline** (artifact-backed), with `Promote` / `Discard` buttons. `/decisions` rows show a `contained` badge with status chip (contained / awaiting promotion / promoted / discarded). `/replay/[actionId]` shows the containment lifecycle in the causal chain. `/mission-control` intervention queue counts awaiting-promotion items.
2. **Discoverable?** Same inbox the operator already lives in; awaiting-promotion items ride the existing notification bridges (summary + link; promote/discard clicks are dashboard-only in v1 — a diff should be read before ratifying).
3. **Every human step a CLICK?** Yes: Promote and Discard are buttons; the diff renders in the page. The merge execution is the agent/CLI's job, not the human's.
4. **Verified rendered?** frontend-verify drives `/approvals` Containment tab with a seeded awaiting-promotion action + diff artifact; asserts diff renders and both buttons mutate state.

Design per `.impeccable.md`: diff view uses the existing mono stack and status tokens; orange only on the awaiting-promotion attention cue.

## Invariants (charter compliance)

1. `allow_contained` is STRICTLY tighter than `warn` and strictly looser than `require_approval`; nothing may emit it for an act the server cannot prove file-scoped.
2. Unaware clients always receive `require_approval` in its place — version skew can only tighten.
3. `block` is never downgraded by anything here; promotion approval covers only the merge act, act-hash-bound, single-use.
4. Every containment lifecycle transition is stamped, attributable, and visible in `/replay`.
5. Hook containment failure (worktree creation fails, not a git repo) → the hook treats the verdict as `require_approval` locally and reports why. Fail toward interruption, never toward ungoverned execution.

## Testing & verification gates

- Unit (vitest): severity ladder ordering exhaustive; capability-negotiation matrix (advertised × verdict); eligibility check per evidence class (file-write yes; HTTP/SQL/payment/deploy never — assert each); `contain_above` validation + band boundaries; containment route auth + status transitions (illegal transitions rejected); promotion grant covers exactly the merge act hash.
- Hook tests (existing Python hook test pattern — find and follow it): redirect strategy selection, fallback message content, non-git-repo fail-toward-interrupt, diff artifact posting.
- `scripts/policy-smoke.mjs`: live section — policy with `contain_above` → guarded eligible call returns contained (capability advertised) vs require_approval (not advertised); promote → merge action allowed once; second merge attempt interrupts.
- Full gates: `npm run lint`, `npx vitest run`, `npx next build`, `npm run typecheck`, `npm run db:migrate` idempotent, `scripts/check-doc-counts.mjs --strict`.
- frontend-verify on `/approvals` (Containment tab), `/decisions`, `/replay/[actionId]`.
- End-to-end proof (dashclaw-ship gate): a real Claude Code session with enforce-mode hooks performs a contained edit, the diff appears in the dashboard, promote lands it. Claims proven live (MAINTAINER charter).

## Documentation contract (same ship)

Decision-value tables in `docs/architecture/runtime-api.md`, both SDK READMEs, OpenAPI schema, plugin docs — every place the allow/warn/block/require_approval quartet is enumerated (grep for `require_approval` across README/PROJECT_DETAILS/docs and update each list). `enforcement-boundary.md` gains a paragraph: containment is the productive use of the mechanical seam, still bounded by the same ADR. Routes +1, SDK methods +2/+2, CLI subcommand — update cited counts. Marketing site: this is the headline feature of the three; blurb + a short diff-review screenshot in the same ship. Version bump via `npm run version:set`.

## Open questions (resolve at build time, do not guess)

1. Current Claude Code PreToolUse `updatedInput` support and exact schema — verify via claude-code-guide agent against the installed version; the strategy choice hangs on it.
2. Diff artifact size cap and truncation UX for large staged changes (recommend: cap inline render, full diff downloadable via existing artifact download).
3. Should `warn` + `contain_above` co-trigger produce both the warning and containment? (Recommend yes — warnings are additive by design.)
4. Worktree GC policy for discarded/stale containment refs (recommend: `dashclaw contained gc` + a stop-hook sweep; decide, document, test).
