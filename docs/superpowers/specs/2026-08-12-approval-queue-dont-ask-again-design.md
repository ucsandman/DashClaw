# Approval Queue — "Allow, don't ask again"

Date: 2026-08-12
Status: approved design, not yet planned
Surface: `/approvals`

## Problem

The approval queue interrupts a human for the same action shape over and over.
The screenshot that started this had 12 pending items, including the same `Edit`
to the same scratchpad `build.mjs` twice, both at risk 65, both flagged
"This file is outside your project folder."

The human has two buttons: **Allow** and **Deny**. Neither of them stops the
next identical interrupt. The muscle memory every Claude Code user brings —
"Yes, and don't ask again" — has no equivalent here.

## What already exists (and why this is a surface gap, not an engine gap)

The enforcement primitive is built and hardened. This is the
"capability exists, human surface doesn't" pattern from v5.17.2.

| Piece | Location | Status |
| --- | --- | --- |
| `allow_grant` policy type | `app/lib/guard/evaluate.ts` `applyAllowGrants()` | exists |
| Shape derivation (action → `(action_type, target_prefix)`) | `app/lib/policy-shapes.ts` `extractDecisionShape()` | exists |
| Unscoped-grant rejection | `policy-shapes.ts` `shapeIsGrantable()` | exists |
| Grant TTL / lease expiry | `policy-shapes.ts` `grantExpiresAt`, `grantIsExpired` | exists |
| Grant matching | `policy-shapes.ts` `grantMatches()` | exists |
| `ungrantable` rule opt-out | `evaluate.ts` `acc.gatingPolicies` | exists |
| Grant creation from a shape | `POST /api/policies/review/verdict` verdict `always_allow` | exists |
| Risk bands 40 / 70 | `app/lib/riskThresholds.ts` `RISK_HIGH_MIN` | exists |
| **Grant creation from an approval card** | — | **missing** |
| **Sweep of already-pending matches** | — | **missing** |
| **Revoke surface for grants you made** | — | **missing** |

`/policies` TriageInbox can already create a grant. But the interrupt lands on
`/approvals`. Sending the human to a different page to stop the interrupt fails
the zero-terminal / one-click test in `HUMAN-EXPERIENCE.md`.

`evaluate.ts` gets exactly one change: `applyAllowGrants()` takes the
already-computed risk score and honors a grant's `max_risk` ceiling (§8). No new
lookup, no phase reordering.

## Design

### 1. The button

A third button on the approval card action panel
(`app/approvals/page.tsx`, currently Allow / Deny at lines ~617-632).

```
┌─ RISK 65 ────────────────┐
│  ✓ Allow                 │
│  ✓ Allow, don't ask again│  ← new
│  ✗ Deny                  │
└──────────────────────────┘
```

Clicking it expands an inline panel on the card. Not a modal — the human must
keep seeing the exact command they are authorizing.

```
Stop asking about…

  (•) apply → …\claude\C--Projects-audit\60a86440-…\scratchpad\build.mjs
      covers this file only

  for [ 24h ▾ ]        1h · 24h · 7d · 30d

  ⚠ This also releases 1 waiting action that matches.

  [ Cancel ]                              [ Allow all 2 ]
```

Confirm performs one request that does three things:

1. Approves the current action.
2. Creates the `allow_grant` policy.
3. Releases every already-pending action whose shape matches the new grant.

The confirm button label carries the total (`Allow all 2`) so the blast radius
is on the button itself, not only in the warning line.

### 2. Scope — exact target only

The grant scope is exactly what `extractDecisionShape()` derives. No folder
widening, no segment picker.

This is deliberate. `targetPrefixOf()` shortens **hostnames only**; its comment
records that collapsing a filesystem path to its first segments is a
grant-widening bug — `C:/Users/sandm/Documents` became `C:/Users/`, and because
`prefixMatches` is a forward prefix match, a single approval authorized the whole
user profile.

Consequence, stated plainly: one grant covers one file. A different file in the
same folder still interrupts. We accept the extra clicks rather than reopen the
widening surface.

If a target-less shape somehow reaches the panel, the button does not render.
`shapeIsGrantable()` is the single predicate — the same one the review verdict
route enforces — so the surface never offers a verb the API would 400.

### 3. TTL

Default **24h**, not the 30-day `GRANT_DEFAULT_TTL_DAYS`. "Stop bugging me" is
usually about today's task. Menu: 1h / 24h / 7d / 30d. The chosen value is
written to `rules.expires_at` at creation, matching the existing grant shape.

### 4. Guardrails

| Guard | Behavior |
| --- | --- |
| Risk ≥ `RISK_HIGH_MIN` (70) | Button is replaced by the line "needs a human every time", with a `why?` link to the risk breakdown. No new constant is introduced. |
| Gating policy has `rules.ungrantable` | Button renders disabled and names the rule that refuses. |
| Guard decision was `block` | Not applicable — blocked actions are never in the pending approval list, and `applyAllowGrants` can never clear a block. |
| Every auto-allow | Recorded in `/decisions`, attributed to the grant policy id. Grants make approval *unattended*, never *invisible*. |

### 5. Sweep semantics

The already-pending queue is swept on confirm.

- **Preview count** is computed client-side from the pending list the page has
  already loaded, using `extractDecisionShape` + `grantMatches`. Cheap, instant,
  no extra round trip.
- **Authoritative sweep** is recomputed server-side inside the same request. The
  client number is a preview only; if it disagrees with the server, the server
  wins and the response returns the real count for the toast.
- Each released action is written as its own approval decision. There is no bulk
  "resolved by grant" record that hides the individual actions.
- The sweep never touches actions gated by an `ungrantable` policy, even when
  the shape matches.
- The sweep never releases an action at or above the grant's `max_risk`. This is
  the same predicate enforcement uses (§8), so the queue and the guard agree.

## 8. Enforcement ceiling — `rules.max_risk`

The UI ceiling in §4 decides which cards offer the button. On its own that
authorizes nothing, because `applyAllowGrants()` downgrades a matching
`require_approval` to `allow` regardless of risk score. A grant created at
risk 65 would auto-allow a **risk 90** action of the same shape for its whole
lifetime. This spec closes that.

### Rule shape

Every new grant is stamped with `rules.max_risk`, from **both** creating
surfaces — the new approval-card route and the existing `/policies` review
verdict route. The value is `RISK_HIGH_MIN` (70). There is no slider: the card
only offers the button below 70, so "this grant covers routine-risk actions of
this shape, not high-risk ones" is the only meaning it can have.

```json
{
  "action_type": "apply",
  "target_prefix": "C:\\Users\\…\\scratchpad\\build.mjs",
  "expires_at": "2026-08-13T15:22:41.000Z",
  "max_risk": 70,
  "_grant": true
}
```

### Enforcement

`applyAllowGrants()` gains the already-computed `adjustedRiskScore` as a
parameter. It is in scope at the call site (`evaluate.ts` line ~1117), so no
phase reordering and no extra lookup — this stays off the hot path's critical
work.

A grant whose ceiling the action exceeds is skipped, and the skip is recorded:

```
<policy name>: grant does not cover risk 90 (ceiling 70)
```

The warning matters. A silent skip would read to the operator as "my grant
stopped working" with nothing in the decision record to explain it.

### Legacy grants — a deliberate behavior change

A grant with no `max_risk` (every grant created before this change, including
those from `/policies` TriageInbox) defaults to `RISK_HIGH_MIN`. Missing means
70, not unlimited.

This **tightens** existing grants: one that previously covered a risk 90 action
now stops at 70, and that action interrupts a human again. That is the safe
direction and the correct one for a governance runtime, but it is a real change
in behavior for existing installs, not a no-op. It ships in the CHANGELOG under
a behavior-change heading, and the reasoning is:

- The alternative — defaulting missing to unlimited — leaves the exact hole this
  section exists to close, and leaves it open indefinitely, since nothing ever
  rewrites an old grant's rules.
- The blast radius is bounded by the two properties grants already had: they are
  target-scoped, and they expire. Every legacy grant ages out within
  `GRANT_DEFAULT_TTL_DAYS` (30) of its `created_at` regardless.
- Failing toward "ask the human" is the product's whole thesis.

Precedent grants (`rules.precedent_flags`) go through the same ceiling. A
precedent is an ordinary `allow_grant` with a different scoping mechanism, and
nothing about server-authored evidence flags argues for exemption from a risk
bound.

### 6. Revoke surface

A compact strip at the top of `/approvals`, above the pending section:

```
🔕 3 things you told me to stop asking about
   apply → …\scratchpad\build.mjs      23h left   [ Revoke ]
   api   → api.stripe.com              6d left    [ Revoke ]
   apply → …\media\render.mjs          41m left   [ Revoke ]
```

The strip is hidden when the org has no active grants. Revoke deactivates the
policy row. Creating a mute in one click while revoking it needs a trip to
`/policies` would fail the human-operability contract.

### 7. New API surface

One new route. It takes an **action id**, not a shape — the card knows the
action, and deriving the shape server-side keeps the client from proposing its
own scope.

```
POST /api/approvals/[actionId]/grant
body: { ttl_hours: 1 | 24 | 168 | 720 }

201 → { ok, policy, approved_action_id, released: <count>, released_ids: [...] }
400 → UNSCOPED_GRANT_REJECTED   (shape has no target prefix)
403 → GRANT_RISK_CEILING        (risk_score >= 70)
403 → GRANT_REFUSED_BY_POLICY   (a gating policy is ungrantable)
```

Reuses `insertOrRevivePolicy` and the F1 rejection copy from
`app/api/policies/review/verdict/route.ts`. No direct SQL in the route — pending
lookup and the sweep go through `actions.repository` and `guardrails.repository`.

Revoke reuses the existing policy deactivate path rather than adding a route.

## Human-experience answers (required by `CLAUDE.md`)

1. **Where does a human SEE it?** On every approval card at `/approvals`, the
   hero surface. No new page, no deep link.
2. **Is it discoverable?** It sits between the two buttons the human already
   clicks. The revoke strip is at the top of the same page.
3. **Is every human step a CLICK?** Yes — create, scope, set TTL, confirm, and
   revoke are all buttons. Zero terminal commands, zero `/policies` trips.
4. **Verified rendered?** Required before done: drive `/approvals` with
   `frontend-verify`, confirm the third button renders, the panel opens, the
   count preview is correct, the queue shrinks by the expected number, and the
   revoke strip appears and clears.

## Testing

- **Unit (UI gate)** — risk ceiling at exactly 69 / 70 / 71; `ungrantable`
  refusal; unscoped shape rejection; TTL written to `rules.expires_at` for each
  menu value; `max_risk` stamped by both creating surfaces.
- **Unit (enforcement)** — `applyAllowGrants` honors `max_risk`: a matching grant
  downgrades at risk 69, does not at 70 or 90, and pushes the explanatory
  warning when it declines. A grant with **no** `max_risk` behaves as 70.
  A precedent grant obeys the same ceiling. Blocks stay absolute at every risk.
- **Unit** — sweep selects matching pending actions and excludes above-ceiling
  and `ungrantable`-gated ones, using the same predicate as enforcement.
- **Regression** — existing `allow_grant` tests that assert a downgrade at a risk
  score ≥ 70 will now fail by design. Each one is re-read and re-pointed, not
  bulk-edited: a test that meant "grants downgrade" keeps its intent at a lower
  score; a test that meant "grants downgrade *anything*" is the bug this closes
  and gets inverted.
- **Route** — the four documented response codes.
- **Component** — button hidden above the ceiling; preview count matches the
  server count for a fixture queue.
- **Rendered** — `frontend-verify` pass on `/approvals` as above.
- **Demo route** — `/approvals` already has a demo entry; the new route needs a
  demo dispatch entry or it 403s blank in demo mode.

## Explicitly out of scope

- Folder / prefix widening of file-path grants (see §2).
- Global snooze or quiet hours.
- Duplicate collapsing in the queue.
- Pausing the underlying rule from the card. The root-cause fix stays on
  `/policies`; this feature treats the symptom on purpose.
- Any change to the flood / interrupt-budget logic in `app/lib/approval-flood.ts`.
- Any `evaluate.ts` change beyond the `max_risk` ceiling in §8.
- An operator-adjustable ceiling. `RISK_HIGH_MIN` is the one number.

## Relationship to approval flood

`approval-flood.ts` suppresses **notifications** when a policy exceeds the
interrupt budget. It never resolves approvals. Its own notification copy tells
the human to "pause the rule or bulk-resolve" — a `/policies` trip. This feature
gives that copy a real destination: the flood notification should later point at
the card button. That copy change is a follow-up, not part of this spec.
