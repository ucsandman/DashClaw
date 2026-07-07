# Human-experience retro-audit — maintainership era (v4.22.0–v4.33.0)

**Date:** 2026-07-02 · **Trigger:** Wes's direction after adopting
`HUMAN-EXPERIENCE.md`: "go back through everything you've done since the
project became yours and make sure it's aligned." · **Method:** four
parallel read-only auditors over the actual page components (not the docs),
one per ship group plus a dedicated marketing coverage sweep.

## Verdict table

| Ship | Product surface | Verdict |
|---|---|---|
| 0 Foundation (v4.21.x) | infra/maintainer tooling | PASS (correctly exempt) |
| 1 Tuning proposals (v4.22.0) | /policies review feed | **PASS — the model pattern** (Apply/Dismiss buttons, two-step confirm, inline reason) |
| 2 x402 budget gate (v4.23.0) | /policies + /policies/rules | Creation/edit fully form-driven (budget fields real, `PolicyRuleBuilderSection.tsx:606-723`). **3 visibility gaps** (below) |
| 3 Calibration mining (v4.24.0) | maintainer CLI | EXEMPT (dev tooling; the human review role is v2.6b) |
| 4 Advocate surface (v4.25.0) | AgentDefenseCard on both detail routes + replay badges | PASS |
| 5 Risk composition (v4.26.0) | RiskBreakdownPanel on detail, strip on /replay | PASS on detail routes; **gap:** nothing on the /decisions LIST |
| 6 June-deferral triage (v4.27.0) | /activity toggle, /evaluations empty-state, picker URL | PASS (all three verified wired) |
| v2.1 Degradation strip (v4.28.0) | /policies cockpit sentence | PASS (correctly display-only); **minor:** `by_day` fetched never rendered; org-wide only, no per-policy split |
| v2.2 Identity v2 (v4.29.0) | /agents parent grouping, /approvals identities | PASS (identity config = one-time dev act, correctly exempt) |
| v2.3 Approvals lifecycle (v4.30.0) | /approvals Expired section | PASS (expired = separate dimmed section, no buttons — stronger than disabling) |
| v2.4 Assumption invalidation (v4.31.0) | /assumptions chips + right-click invalidate | Chips PASS; **gap:** invalidate was right-click-only + `window.prompt()` |
| v2.5 Session retro (v4.32.0) | Retro card on /sessions/{id} | Renders correctly; **gap:** posture chip below the fold (5 blocks deep); no frontend-verify capture |
| v2.6 Calibration flywheel (v4.33.0) | GitHub Actions summary | **FAIL — the founding incident**; queued as v2.6b |

**Clause 4 (marketing ships with the feature): systematic FAIL across the
entire era.** The `/self-host` "What you just deployed" completeness grid
misses all 10 shipped capabilities; the rendered landing page misses all
10; `/docs` is missing tuning proposals, budget tiers, degradation
observability, `risk_breakdown`, and the new identity system entirely, and
carried one factually stale claim (waitForApproval outcomes). `/explain`
has the advocate section but not its successor (session retro). `/connect`
and `/guides/*` are legitimately out of scope. Verified accurate: MCP
tool/resource counts (33/6) everywhere; no stale route counts.

## Fixed in this audit's own commit (surgical)

1. `/policies` contract sentences now render the cumulative budget terms
   (`app/lib/policy-modes/contract.ts` — budget interrupt/block sentences,
   editable inline like the per-purchase ones; types widened in
   `contractClient.ts`, step values in `ContractPanel.tsx`).
2. `/policies/rules` list rows now describe x402 policies as sentences
   (`CustomTab.tsx formatRules` — was the raw string `x402_spend_limit`).
3. Session-retro posture visible without scrolling: `SessionRetroChip`
   exported and rendered in the /sessions/{id} header next to the status
   badge, anchored to the full card (`#session-retro`).
4. /assumptions has a visible **Invalidate…** control per card (was
   right-click-only) opening an inline reason field + Confirm/Cancel —
   the TuningProposals pattern, replacing `window.prompt()` for this path.
   The right-click menu path still works.
5. `/docs` waitForApproval description now documents the `expired` third
   outcome (`err.status === 'expired'`) — was factually stale vs
   `sdk/dashclaw.js:142-146`.

## Queued (each too large to do well inline)

- **v2.6b** (already queued): in-product calibration proposal review.
- **v2.6c** (new): x402 budget consumption visibility — "spent $X of $Y
  this window" meter on /spend/x402 (and the policy card), needs a read
  API for `sumWindowSpend` which is currently guard-only
  (`x402.repository.ts:315-330`).
- **v2.6d** (new): marketing & docs backfill — the 10-capability sweep of
  `/self-host` grid, landing page (incl. resolving the dead
  `landingData.js` imports), `/docs` missing sections, `/explain` retro
  section. One coherent build session under `.impeccable.md`.

## Minor punch list (fold into adjacent work, not separate ships)

- Risk-composition hint on the /decisions LIST rows (fold into v2.6c-era
  UI work or the next /decisions touch).
- Degradation `by_day` is fetched but unrendered; consider a per-policy
  split or drop the field (fold into the next /policies touch).
- Expired approvals could show *when* they expired (fold into next
  /approvals touch).
- `/connect` approval step doesn't mention the expired state (fold into
  v2.6d).
