# v3.5 Approval-flood guard — spec revision and closeout audit

**Date:** 2026-07-04
**Status:** Decided (maintainer, under Wes's 2026-07-03 shaping delegation)
**Revises:** docs/superpowers/specs/2026-06-11-w3-push-value-surfaces-design.md (W3)
**Roadmap item:** v3.5 (docs/plans/owner-roadmap.md)

## Discovery that reshapes the item

Roadmap v3.5's drafting evidence (2026-07-03) claimed the W3 flood design
"was never built; the sweep found no trace in the log or ledger." **That
claim is false.** The interruption budget / approval flood guard shipped
complete in **v4.15.0 (2026-06-12)** — the day after the spec — and is
documented in CHANGELOG.md under that version:

- Detection: `app/lib/approval-flood.ts` over `guard_decisions` via
  `getRecentApprovalCountsByPolicy` (per-policy budget default 10 per
  15-minute window, fleet-wide 30; org-settings overrides
  `DASHCLAW_INTERRUPT_BUDGET` / `_WINDOW_MIN` / `_BUDGET_FLEET`, documented
  in `.env.example`).
- Collapse: `fireApprovalSurfaces` (`app/lib/approvalSurfaces.ts`)
  suppresses per-action Telegram/Discord prompts while a matched policy or
  the fleet is tripped; ONE flood notification goes out via
  `deliverNativeNotifications`; machine webhooks never suppressed; every
  failure path fails open to per-action behavior.
- Resolution: `GET /api/approvals/floods` (evaluate-on-read, hysteresis
  clears below half budget), `POST /api/approvals/bulk` (admin-only, cap
  500, per-row race guard, audited), `ApprovalFloodBanner` mounted on
  /approvals and /policies with armed two-step Pause rule / Approve all /
  Deny all.
- Signal: `approval_flood` (red) in `computeSignals`, policy_id in the
  dedup hash. Fleet digest (W3 G2) also shipped in the same release.

So v3.5 is not a build — it is a **closeout audit**: verify the shipped
implementation against the v3.5 acceptance bar, close the real gaps, and
record the three owner questions the June spec left open.

## Audit against the v3.5 acceptance bar

| Requirement | Verdict |
|---|---|
| Bulk actions honor approval-expiry semantics (v2.3) | **Already true.** `POST /api/approvals/bulk` sweeps expired approvals before matching (`sweepExpiredApprovals`, bulk/route.ts) and `listPendingApprovalIdsByActionTypes` excludes overdue rows — an approval whose client stopped waiting can never be bulk-released. |
| Constitution §1: blocks never bulk-released | **Structurally true.** Bulk matches only `pending_approval` action_records by a policy's compiled `action_types`; blocked actions never enter that state. `protected_path` policies are refused with a 400. |
| Transports send the collapsed form, not 50 pings | **Already true**, pinned by `approval-surfaces-flood.test.js` (suppression) and `approval-flood.test.js` (one notification per newly tripped budget). |
| Smoke pins flood detection | **GAP — built in this revision** (U scenarios, see below). |
| Seeded 50-approval burst renders one banner, truthful counts, individually actionable | **GAP — rendered proof executed in this revision.** |

### New gap found by the audit (the real v3.5 work)

**Flood detection counts synthetic traffic.** `getRecentApprovalCountsByPolicy`
predates v3.1 and has no synthetic exclusion. Consequences on a live org:

1. A policy-smoke run's `require_approval` guard decisions count toward the
   **fleet** budget (default 30). When fleet trips, `fireApprovalSurfaces`
   suppresses per-action pings for **all** policies — synthetic traffic can
   silence real approval notifications for real actions.
2. A tripped flood mints a red `approval_flood` signal and an adapter
   notification — operator-facing noise minted by synthetic traffic, the
   exact bug class v3.1 killed in posture and mining.

**Decision:** apply the shared v3.1 predicate (`SYNTHETIC_ACTION_TYPE_LIKE`,
`SYNTHETIC_AGENT_LIKE_PATTERNS` from `app/lib/calibration-mining.js`) inside
the flood counting query, mirroring the SQL idiom already used by
`posture.repository.ts` and `tightening.repository.ts`. Synthetic traffic can
then never trip a flood, suppress a real ping, or mint the signal — the same
structural-truth posture as the live canary (verdicts in their own table) and
posture (SQL-level exclusion).

## The three owner questions — decided (maintainer, recorded)

1. **Budget defaults (10 per policy / 15 min; 30 fleet-wide): KEEP.**
   v2.1–v2.3 made single interruptions precise; a genuinely flooding policy
   is a misconfiguration event, and 10 interrupts in 15 minutes is already a
   generous humane bound. No live evidence since 2026-06-12 shows the
   defaults tripping on legitimate traffic. Org-settings overrides exist for
   fleets that need different bounds.
2. **Digest cadence: KEEP the shipped default** (`DASHCLAW_DIGEST_INTERVAL_HOURS`
   default 24, `0` disables; delivery no-ops for orgs without adapter
   credentials). This matches the June proposal's "on only where adapters are
   configured" — no new noise channel without an explicit setup step.
3. **Pause rule does NOT bulk-deny pending actions: KEEP, with a stronger
   rationale than June's.** The June proposal left pending approvals to the
   agent-side wait timeout. Since v2.3, approval expiry is first-class:
   pending rows expire truthfully (`approval_expires_at`), render in the
   Expired section, and return 410 on late action. Leaving them pending is
   now the *principled* answer, not the lazy one — no silent mass-deny, and
   the ledger stays truthful about what happened.

## Work executed under this revision

1. Synthetic exclusion in `getRecentApprovalCountsByPolicy` + unit tests
   pinning it (including LIKE-pattern agreement with the JS predicate).
2. Policy-smoke **U scenarios**: U1 drives a >budget synthetic
   `require_approval` burst and asserts the floods endpoint does NOT report
   it (the exclusion is the assertion — same pass-on-rejection spirit as the
   live canary's Turnstile probe); U2 pins `POST /api/approvals/bulk`
   truthful `{resolved, failed, matched}` mechanics on smoke approvals.
   Positive trip/suppress/hysteresis paths stay pinned by the five existing
   unit test files.
3. Rendered proof: a seeded non-synthetic 50-approval burst renders as ONE
   flood banner on /approvals with truthful counts, pending list still
   individually actionable; seeded rows cleaned up afterward.
4. Roadmap v3.5 status corrected with the written reason (the drafting
   claim was wrong); CHANGELOG + maintainer log entries.

## Explicitly not done (and why)

- No new flood features (digest rework, new channels, decision-mix anomaly
  detector): the shipped surface already meets G1–G3; YAGNI holds.
- No browser-grade canary probe for the banner: the smoke + unit + rendered
  proof triangle covers it; the live canary's scope (v3.4) is host
  reachability, not per-feature UI.
