# Decision: DashClaw Pulse (/widget) — OWED

- **Date:** 2026-08-09
- **Status:** adopted (slice 1, read-only)
- **Decided by:** Wes (directive: replace the culled status-widget PWA with a new, purpose-built ambient surface; design chosen by a 9-agent tournament — 5 divergent concepts, 3-lens judge panel, 1 synthesis)
- **Surface-budget impact:** +1 app page (/widget), +1 API route (GET /api/widget/pulse) — ceilings amended in THESIS.md and contracts/surface-budget.json in the same commit.
- **Relation to the v5 cull:** the status-widget PWA named in the THESIS kill list stays dead (no PWA, no manifest, no prefs, no settings, no approve/deny, no stat tiles, no log). This is a different, smaller instrument built to the spec below.

---

# DashClaw Pulse — Final Design Spec (slice 1)

**Concept:** `OWED` (winner), with grafts from `Dispatch`, `PORCHLIGHT`, `Paper Tape`, `THE LEVEL`.
**Surface:** `/widget` — frameless, always-on-top browser window, 300–400px wide × 200–700px tall.
**Slice 1 is read-only.**

---

## 0. Tally, winner, and how the disagreement was resolved

| Concept | glanceability | codebase-fit | thesis-fit | Total |
|---|---|---|---|---|
| **OWED** | **9** (winner) | **9** (winner) | 6 | **24** |
| Dispatch | 7 | 8 | **8** (winner) | 23 |
| PORCHLIGHT | 7 | 8 | 7 | 22 |
| THE LEVEL | 6 | 6 | 4 | 16 |
| Paper Tape | 5 | 5 | 5 | 15 |

**Winner: OWED**, 2 of 3 judges and the highest total.

**The disagreement.** The thesis judge ranked OWED 4th of 5 and picked Dispatch, on two specific objections — not on taste:

1. **OWED's posture precedence hides the approval moment.** OWED inherited `elevated > approval`, so a red signal firing while approvals wait *replaces* the pending count with the signal count. The approval moment is the product; it cannot be pre-empted.
2. **OWED cannot say "how long."** `2 waiting` renders identically at 20 seconds and 40 minutes, and dwell is the operator's actual liability.

Both are true and both are fixable **without touching OWED's spine** (ink proportional to obligation; luminance/shape as the peripheral channel; activity never touches the alert channel). Neither is fixable in Dispatch — its weakness is that prose is a foveal channel and a 3px rule is the thinnest pre-attentive target in the field, which is structural.

**Resolution:**
- Precedence is inverted to **approval outranks signals** (PORCHLIGHT's ruling: the actionable one wins), and the displaced obligation becomes a subordinate left rail (Paper Tape's margin change-bar). One obligation speaks; the other annotates. Never dropped, never silent.
- **Dwell** (PORCHLIGHT) becomes the escalation axis: a risk-scaled patience budget drives the ring from brand to error and drives which pending row owns the caption.
- **Dispatch's honesty machinery is grafted wholesale** — calm requires positive heartbeat evidence, no present-tense claim survives 90s of silence, a failed sub-query never renders as zero, and the whole thing is one pure function with an invariant test. This is where Dispatch beat everyone and it costs OWED nothing.

**Rejected grafts** (all three judges agreed): PORCHLIGHT's watch strip, Paper Tape's tick field, THE LEVEL's chapter ring. All re-import the rejected widget's constant ink and constant motion.

---

## 1. The spine (do not violate)

1. **Absence equals health.** Every element is *missing* when things are fine. Calm is a dark slab with three marks. Ink is proportional to obligation.
2. **The peripheral channel is luminance and shape, never hue alone.** The alert target is the window perimeter — the largest object available. It must work in grayscale, off-axis, at 2 metres.
3. **Activity is not urgency.** A fleet doing 400 actions/hour moves a 3px strip at the bottom edge and *nothing else*. The ring and the glyph never react to work.
4. **Zero chroma at rest.** No brand orange anywhere on this surface unless something is owed. The peripheral check is "is there any colour", which is cheaper than "is the edge brighter".
5. **Unknown never renders as calm.** A dead pipe, a stopped hook, a failed query, and an empty fleet each get their own silhouette. Weak knowledge renders *weaker* (dim/dashed), never *louder*.

---

## 2. Final ASCII mocks

### 2.1 CALM / ACTIVE — 360 × 560 (this is ~95% of an afternoon)

```
 ╭──────────────────────────────────────────────╮  ring 3px, r12
 │                                              │  --color-border (calm)
 │                                              │  --color-border-hover (active)
 │                                              │  NO CHROMA ANYWHERE
 │                                              │
 │                                              │
 │                                              │
 │                    ────                      │  GLYPH: solid em-dash
 │                                              │  clamp(48px,34cqh,132px)
 │                                              │  weight 300, text-disabled
 │        nothing owed · 3 agents live          │  CAPTION 13px text-tertiary
 │                                              │
 │                                              │
 │                                              │
 │                                              │
 │                                              │
 │                                              │
 │▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▓▓▓▓▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁│  BASELINE 3px bg-tertiary
 ╰──────────────────────────────────────────────╯  ▓ = 60px lit segment,
                                                     L→R over 900ms, one per
 whole field = one button → opens /approvals.        SSE event. Bottom edge.
 no header, no logo, no pill, no tiles, no list,     Never enters the glyph zone.
 no log, no footer, no connection label.
```

### 2.2 OWED — APPROVAL WAITING (+ 2 red signals demoted to the rail)

```
 ╔══════════════════════════════════════════════╗  ring 3px --color-brand,
 ║▐                                             ║  SOLID MATTE. no glow, no
 ║▐                                             ║  blur, no gradient.
 ║▐                                             ║  ▐ RAIL 2px --color-error,
 ║▐                                             ║    left edge, `!2` head.
 ║▐                                             ║    Signals annotate; they
 ║▐                   ██                        ║    never take the glyph
 ║▐                  ████                       ║    while an approval waits.
 ║▐                    ██                       ║
 ║▐                  ██████                     ║  GLYPH: pending count,
 ║▐                                             ║  --color-brand, tabular-nums
 ║▐    db_migrate · atlas · held 6m             ║  CAPTION: the row that owns
 ║▐                                             ║  the highest dwell ratio
 ║▐                                             ║
 ║▐                                             ║  FIELD: bg-primary. NO tint.
 ║▐▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁║
 ╚══════════════════════════════════════════════╝

 entry: ring cross-fades 240ms, then ONE 700ms luminance swell
 (55%→100%→85%), then holds. Never loops while inside budget.
```

### 2.3 OWED — OVERDUE / ELEVATED (the master caution)

```
 ╔══════════════════════════════════════════════╗  ring --color-error,
 ║                                              ║  BREATHING 2.4s ease-in-out,
 ║                                              ║  opacity .55 ↔ 1.0.
 ║                                              ║  THE ONLY LOOP IN THE PRODUCT.
 ║                                              ║
 ║                   ██                         ║  Two ways to reach this ring:
 ║                  ████                        ║   (a) approval past its
 ║                    ██                        ║       patience budget
 ║                  ██████                      ║   (b) red signals with NO
 ║                 ▔▔▔▔▔▔▔                      ║       approval waiting
 ║                                              ║
 ║   overdue 24m · deploy_prod · atlas          ║  ▔ 3px underline bar under
 ║                                              ║  the glyph = SIGNALS own it
 ║                                              ║  (shape channel — never
 ║                                              ║  orange-vs-red alone).
 ║▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▓▓▓▓▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁║  Overdue approval = plain
 ╚══════════════════════════════════════════════╝  numeral. Signals = numeral
                                                    + bar. Different glyphs.
 prefers-reduced-motion: globals.css kills the breathe GLOBALLY.
 MANDATORY static tell → a second inner 1px error ring.
 ╔══════════════════════════════════════════════╗
 ║ ┌──────────────────────────────────────────┐ ║  DOUBLE RING = elevated.
 ║ │                                          │ ║  Without this the master
                                                    caution silently disarms.
```

### 2.4 STALE / OFFLINE (no confirmed feed > 90s)

```
 ╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮  ring 3px DASHED,
 ┊ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ┊  --color-text-disabled @40%
 ┊╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲┊  NO CHROMA — degradation is
 ┊ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ┊  never an alarm colour.
 ┊╲ ╲ ╲ ╲ ╲ ╲ ╌╌╌╌╌╌╌╌╌╌╌ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲┊
 ┊ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ┊  GLYPH: hatched dash.
 ┊╲ ╲  link lost 2m · last confirmed 14:22 ╲ ╲┊  CAPTION: past tense, stamped.
 ┊ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ╲ ┊  4px diagonal hatch, white 4%.
 ┊▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁┊  BASELINE inert (no pulses).
 ╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯

 On reconnect: REFETCH the snapshot BEFORE repainting posture.
 The widget must never flash a stale calm.
```

### 2.5 UNCONFIRMED — nothing owed, but no heartbeat evidence

```
 ╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮  ring dashed, text-disabled
 ┊                                          ◇  ┊  @55% — DIMMER than calm.
 ┊                                              ┊  "we can't confirm" renders
 ┊                                              ┊  WEAKER, never louder.
 ┊                    ┈┈┈┈                      ┊  GLYPH: hollow dash.
 ┊                                              ┊  A dead fleet must never
 ┊       no agent check-in · 3h                 ┊  share a silhouette with a
 ┊                                              ┊  healthy one.
 ┊▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁┊  ◇ presence notch, dashed
 ╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯    outline = verdict unknown
```

### 2.6 REVEAL LAYER (hover / focus / tap-pin) — the only place detail lives

```
 ╔══════════════════════════════════════════════╗
 ║                     ██                       ║  glyph slides up 28px and
 ║                    ████                      ║  shrinks to 68px over 160ms
 ║                      ██                      ║
 ║                    ██████                    ║
 ║                                              ║
 ║   2 waiting · oldest 6m                      ║  13px text-secondary
 ║   ──────────────────────────────────────     ║  1px --color-border
 ║   db_migrate    atlas      risk 88    6m     ║  risk ≥80 in text-error
 ║   ┌──────────────────────────────────────┐   ║
 ║   │                                      │   ║  ← SLICE 2 APPROVE/DENY
 ║   └──────────────────────────────────────┘   ║    LANDS HERE. 36px row
 ║   deploy_prod   atlas      risk 74    1m     ║    already reserved. ZERO
 ║   ──────────────────────────────────────     ║    layout change.
 ║   ! 2 red signals unreviewed                 ║  the demoted obligation,
 ║   ◇ desktop presence unknown                 ║  named in words
 ║▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁║
 ╚══════════════════════════════════════════════╝
 fadeSlideIn 120ms (existing keyframe). Fades out on blur.
```

### 2.7 SHRUNK — 300 × 220

```
 ╭────────────────────────────────╮   glyph clamps via clamp(48px,34cqh,132px)
 │                            ◇   │   caption survives to 240px tall, then drops
 │             ────               │   ring, rail, notch, glyph, baseline are
 │        nothing owed · 3        │   NEVER dropped at any size
 │▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁│   text never below 13px — only graphics shrink
 ╰────────────────────────────────╯
```

---

## 3. Section-by-section layout

Container queries (`container-type: size` on the field), **not** media queries. `useTileSize` (`app/hooks/useTileSize.ts`) already exists if a JS measurement is needed.

| # | Element | Geometry | Rendered when |
|---|---|---|---|
| 1 | **Ring** | `position:fixed; inset:0; border:3px solid; border-radius:12px; pointer-events:none` | Always |
| 2 | **Inner ring** (reduced-motion tell) | `inset:3px; border:1px solid var(--color-error); border-radius:9px` | Only when the breathe state applies **and** `prefers-reduced-motion: reduce` |
| 3 | **Signal rail** | `left:3px; top:12px; bottom:12px; width:2px`, `!N` head as 13px mono above it | Only when signals exist **and** do not own the glyph |
| 4 | **Presence notch** | 10px rotated square, `top:12px; right:12px` | Only when presence verdict ≠ `live` |
| 5 | **Glyph** | Centred stack, `font-size: clamp(48px, 34cqh, 132px)`, weight 300, `tabular-nums`, `line-height:1` | Always |
| 6 | **Caption** | 13px, `text-align:center`, single line, `text-overflow:ellipsis`, `max-width: calc(100% - 48px)`, `margin-top:14px` | Always; dropped below 240px container height |
| 7 | **Baseline strip** | `position:fixed; left:0; right:0; bottom:0; height:3px; overflow:hidden` | Always |
| 8 | **Reveal layer** | `position:fixed; inset:3px; padding:16px; background:var(--color-bg-primary)` at 0.96 opacity | On `:hover`, `:focus-within`, or tap-pin only |

**Stack:** the field is a flex column, `align-items:center; justify-content:center; padding-bottom:64px`, so the glyph+caption block sits above optical centre and the reveal has room below it. **The glyph's resting position never moves between states** — the eye that knows where to look does not re-scan.

**Interaction:** the entire field is one `<button>` (or `role="button"` div with `tabIndex=0`) that opens `/approvals` in the parent tab. Focus ring comes from the global `*:focus-visible` rule. There is no other click target in slice 1.

**Chrome that does not exist:** header, logo, posture pill, icon buttons, stat tiles, approvals list, actions log, connection footer, nav, settings, scrollbars.

---

## 4. Posture precedence

Evaluated top-down; **the first match owns the ring, the glyph, and the caption.**

| Rank | State | Trigger |
|---|---|---|
| 0 | **STALE** | No confirmed feed for > 90s, **or** `EventSource` in error/reconnecting state |
| 1 | **DEGRADED** | Any sub-query in the snapshot failed (`queriesDegraded` non-empty) |
| 2 | **OWED-APPROVAL** | `pending.count > 0` |
| 3 | **OWED-SIGNAL** | `pending.count === 0 && signals.red > 0` |
| 4 | **UNCONFIRMED** | Nothing owed **and** no heartbeat evidence in the window |
| 5 | **ACTIVE** | Nothing owed, heartbeat confirmed, ≥1 action in the last 15 min |
| 6 | **CALM** | Nothing owed, heartbeat confirmed, no action in the last 15 min |

### Precedence rules (non-negotiable)

- **R1 — The approval always outranks the signal.** A red signal firing while approvals wait must never replace the pending count. This is the single correction the thesis judge demanded and it is the difference between shipping the product and shipping a monitor.
- **R2 — The displaced obligation is never silent.** When approvals own the glyph, signals render as the left rail with an `!N` head *and* as a line in the reveal. When signals own the glyph, the rail is not drawn (no double-encoding).
- **R3 — Amber never owns the ring.** Amber-only signals draw the rail in `--color-warning` with no head count. They never escalate posture.
- **R4 — Presence NEVER drives the ring.** In any posture, a Desktop Presence verdict raises the notch and adds one reveal line. Nothing more. A stale screen-frame pipeline is not a governance obligation, and letting it trip the master caution trains the operator to ignore the master caution.
- **R5 — Activity NEVER drives the ring or the glyph.** New actions move the baseline strip. That is the entire visual consequence of a working fleet.
- **R6 — Degradation is dim, obligation is chromatic.** STALE / DEGRADED / UNCONFIRMED all use dashed + `--color-text-disabled` at reduced opacity. They are visibly *weaker* than calm, never louder. (THE LEVEL's vacuum-flag principle, applied globally.)

### Dwell escalation (PORCHLIGHT graft)

For each pending row:

```
budget = riskScore >= 70 ? 5min
       : riskScore >= 40 ? 20min
       : 60min
dwellRatio = (now - timestampStart) / budget
```

- The row with the **highest** `dwellRatio` owns the caption (not necessarily the oldest — a risk-92 ask at 4 min outranks a risk-15 ask at 25 min).
- `maxDwellRatio >= 1.0` → ring escalates `--color-brand` → `--color-error`, fires one additional 700ms swell at the crossing, and starts the breathe. Caption prefixes `overdue Nm ·`.
- `pending.count >= 5` → caption reads `N waiting · oldest Nm` instead of naming a single row. A queue forming is a different fact from a single ask.

---

## 5. Data → element mapping

All fields are already on the server. **No new ingestion.** Real column names from `app/lib/repositories/actions.repository.ts`.

### 5.1 The one new route: `GET /api/widget/pulse`

Returns exactly this shape. Each sub-query is independently `try`-wrapped; a failure appends its name to `queriesDegraded` and **never** returns a zero for it.

```ts
{
  asOf: string,                    // ISO — the snapshot's own timestamp
  windowMinutes: 60,
  pending: {
    count: number,
    rows: Array<{                  // max 5, ordered by dwellRatio desc
      actionId, actionType, agentName,
      riskScore: number,
      timestampStart: string,
      declaredGoal: string | null, // ≤64 chars, WORD-BOUNDARY truncated
      policyLabel?: string         // ONLY if already on the row; never a new join
    }>
  },
  signals: {
    red: number, amber: number,
    top: { severity: 'red'|'amber', kind: string, label: string } | null
  },
  agents: { activeCount: number, lastActiveAt: string | null },
  lastActionAt: string | null,
  recentActionCount: number,
  queriesDegraded: string[]
}
```

### 5.2 Element map

| Element | Source | Rule |
|---|---|---|
| **Ring colour** | posture (§4) + `maxDwellRatio` | Table §6 |
| **Ring dash** | posture ∈ {STALE, DEGRADED, UNCONFIRMED} | dashed |
| **Glyph — solid dash `—`** | nothing owed **and** heartbeat confirmed | `--color-text-disabled` |
| **Glyph — hollow dash `┈`** | UNCONFIRMED | `--color-text-disabled` @70% |
| **Glyph — hatched dash `╌`** | STALE / DEGRADED | `--color-text-disabled` @55% |
| **Glyph — plain numeral** | `pending.count` | `--color-brand`, or `--color-error` when overdue |
| **Glyph — numeral + 3px bar** | `signals.red` (only when `pending.count === 0`) | `--color-error` |
| **Caption — approval** | winning row's `actionType` · `agentName` · `held Nm` (from `timestampStart`) | prefix `overdue Nm ·` past budget; `policyLabel` appended only if present |
| **Caption — signal** | `signals.top.label`, word-boundary truncated to fit one line | see §5.3 |
| **Caption — active** | `agents.activeCount` + `now - lastActionAt` → `nothing owed · 3 agents live` | |
| **Caption — calm** | `now - lastActionAt` → `all clear · last action 12m` | clamped at window (§8) |
| **Caption — unconfirmed** | `now - max(lastActionAt, agents.lastActiveAt)` → `no agent check-in · 3h` | |
| **Caption — stale** | seconds since last confirmed heartbeat + wall clock of it | past tense |
| **Signal rail** | `signals.red` → `--color-error` + `!N`; else `signals.amber` → `--color-warning`, no head | never drawn when signals own the glyph |
| **Presence notch** | Desktop Presence verdict | §7 |
| **Baseline pulse** | SSE event kind | §5.4 |
| **Reveal rows** | `pending.rows` — `actionType`, `agentName`, `riskScore` (in `text-error` at ≥80), age | + one signal line, + one presence line |
| **Reveal goal text** | `declaredGoal`, ≤64 chars, word boundary, no tooltip expansion | reveal layer only |
| **`document.title`** | posture | `— DashClaw` / `2 · DashClaw` / `! DashClaw` / `? DashClaw` |
| **Favicon dot** | posture | neutral / brand / error / dim (PORCHLIGHT graft — the doorbell still reaches him behind the poker table) |

### 5.3 Signal-label truncation (verified-fact graft)

`computeSignals` (`app/lib/signals.ts`) emits **50–70 character prose labels that embed truncated `declared_goal` substrings** — e.g. `` `Ungoverned high-risk decision: ${action.declared_goal?.substring(0,5…)}` ``, `` `Governance alert: ${agent} (${count} …)` ``. Therefore:

- **Never hard-cut mid-word at 44 chars.** Truncate on a word boundary with an explicit `…`.
- **Never claim goal text is not rendered while rendering `label`.** It is. It is capped and it lives on this surface only in the caption and reveal.
- Prefer a short `kind` string derived from the builder that produced the signal (`heartbeat-lost`, `ungoverned-high-risk`, `stalled-decision`, …) for the caption, and keep the full `label` for the reveal. `signals[].detail` is **never rendered anywhere** — it carries excerpted command context.

### 5.4 Baseline strip (activity — never urgency)

One 60px lit segment travels left→right over 900ms per SSE event, colour by kind:

| Event | Colour |
|---|---|
| `action.updated` → completed | `--color-success` |
| `action.created` with `status = pending_approval`, or `guard.decision.created` blocked | `--color-brand` |
| failed `outcome_status` | `--color-error` |
| `signal.detected` | `--color-warning` |
| `decision.created` | `--color-info` |

**Frenzy governor (Paper Tape graft):** the animation budget is **per interval, not per event.** Max one segment in flight; bursts queue at 150ms spacing; sustained > 6 events/sec collapses to a steady lit strip rather than a strobe. A steady strip is honest — it is hammering.

---

## 6. Token table — verified against `app/globals.css` + `tailwind.config.js`

All tokens below were read from the files. **No hex anywhere in the component.**

| State | Ring | Field | Glyph | Caption | Rail |
|---|---|---|---|---|---|
| CALM | `--color-border` | `--color-bg-primary` | `--color-text-disabled` | `--color-text-tertiary` | — |
| ACTIVE | `--color-border-hover` | `--color-bg-primary` | `--color-text-disabled` | `--color-text-tertiary` | — |
| UNCONFIRMED | `--color-text-disabled` @55%, dashed | `--color-bg-primary` | `--color-text-disabled` @70% | `--color-text-tertiary` | — |
| OWED-APPROVAL | `--color-brand` solid | `--color-bg-primary` **(no tint)** | `--color-brand` | `--color-text-secondary` | `--color-error` / `--color-warning` |
| OWED-APPROVAL overdue | `--color-error` + breathe | `--color-bg-primary` | `--color-error` | `--color-text-secondary` | as above |
| OWED-SIGNAL | `--color-error` + breathe | `--color-bg-primary` | `--color-error` + 3px bar | `--color-text-secondary` | — |
| DEGRADED | `--color-text-disabled` @40%, dashed | `--color-bg-primary` | `--color-text-disabled` @55% | `--color-text-tertiary` | — |
| STALE | `--color-text-disabled` @40%, dashed | + 4px diagonal hatch, white 4% | `--color-text-disabled` @55% | `--color-text-tertiary` | — |

Supporting tokens: baseline track `--color-bg-tertiary`; reveal divider `--color-border`; reveal risk ≥80 `--color-error`; focus ring inherited from the global `*:focus-visible` (`--color-brand`, 2px, 2px offset).

### Implementation traps (all verified in this repo)

1. ~~**`borderColor` in `tailwind.config.js` only defines `DEFAULT` / `hover` / `active`.** `border-brand` and `border-error` **do not exist**. Set the ring colour with an inline style (`style={{ borderColor: 'var(--color-brand)' }}`) or an arbitrary value (`border-[color:var(--color-brand)]`).~~
   **Superseded 2026-08-10.** Half right at the time: `border-brand` always resolved (`borderColor` spreads `theme('colors')`, which carries the `brand` group), but `border-error` / `border-success` / `border-warning` genuinely did not — only `textColor` had the single-prefix status aliases. `borderColor` and `backgroundColor` now carry them too, so `border-error` and `bg-error` resolve. No inline style needed.
2. ~~**Alpha modifiers compile to nothing here** (`bg-brand/10` → no CSS). Use element `opacity`, the `-subtle` tokens, or `rgba()` on the token layer.~~
   **Superseded 2026-08-10.** Token colours are now function-valued in `tailwind.config.js`, which is the one form Tailwind hands an opacity modifier to, so `bg-brand/10` compiles to a real `color-mix()` rule. Write the modifier you mean. Pinned by `__tests__/unit/tailwind-token-alpha.test.js`.
3. **Field tinting is deleted** from the original OWED concept. Zero brand orange at rest is stronger and cheaper than a full-field `--color-brand-subtle` wash, and it answers OWED's own stated concern about spending orange as a surface. The ring carries the signal on its own.
4. **Type floor:** `text-xs` is 13px in this repo (`fontSize.xs = 0.8125rem`). Nothing on this surface goes below it at any window size.

---

## 7. Presence — behaviour and the never-fake-live rule

Desktop Presence is **machine-local and has no route, no field, and no verdict anywhere in this repo today.** `unknown` will be the real-world default for a long time and must not read as a fault.

| Verdict | Notch | Reveal line |
|---|---|---|
| `live` | **not rendered at all** | none — absence *is* the report |
| `stale` | 10px filled diamond, `--color-warning` | `desktop presence stale · frame 74s` |
| `inactive` | 1px outline, `--color-text-disabled` | `desktop presence inactive` |
| `never-started` | 1px outline, `--color-text-disabled` | `desktop presence off` |
| `unknown` | 1px **dashed** outline, `--color-text-disabled` @55% | `desktop presence unknown` |

**Rules:**
- **P1 — Never fake live.** If no verdict is available, the state is `unknown` and renders `unknown`. Absence of a verdict is never rendered as `live`, and `live` is never the default.
- **P2 — Unknown renders weaker than known-bad.** Dashed outline (unknown) is visibly weaker than a filled warning diamond (stale). We do not know ≠ we know it is bad.
- **P3 — Presence never drives the ring** (rule R4). In any posture.
- **P4 — `aria-label` carries the full presence string at all times**, even when the notch is not rendered.

---

## 8. Honesty rules for degraded and stale data (Dispatch graft — the highest-value steal)

These are **invariants, not polish.** Each one gets a test (§11).

- **H1 — Calm requires positive heartbeat evidence.** The solid dash may render **only if** `pending.count === 0 && signals.red === 0 && (lastActionAt is inside the window || agents.lastActiveAt is inside the window) && queriesDegraded.length === 0`. Otherwise the glyph is a hollow dash and the caption says so. A stopped hook and a quiet fleet produce identical zeros; only this rule separates them.
- **H2 — Held agents do not count as quiet.** An agent frozen at an approval emits nothing by design. Its silence must never contribute to the UNCONFIRMED state. (Paper Tape's expected-silence principle.)
- **H3 — Graded freshness.** The stream sends a heartbeat every 15s (`HEARTBEAT_INTERVAL_MS` in `app/api/stream/route.ts`).
  - `< 35s` → **FRESH**. Present tense.
  - `35–90s` → **DRIFTING**. Posture and glyph unchanged; the caption alone appends `· unconfirmed 41s`. A normal hiccup must not look like an incident.
  - `> 90s`, or `EventSource` error/reconnecting → **STALE**. Full takeover, past tense, stamped.
- **H4 — Refetch before repaint.** On reconnect, fetch the snapshot **before** leaving STALE. The widget never flashes a stale calm.
- **H5 — A failed sub-query never renders as zero.** `queriesDegraded` containing `pending` → DEGRADED posture, caption `can't confirm approval queue`. Never a dash, never a `0`.
- **H6 — Window-derived claims are clamped.** `last action 12m` is true only up to the fetched window. Past it, render `last action 60m+`. Same for `no agent check-in 60m+`.
- **H7 — Loading is the resting mark at 30% opacity.** No skeleton shimmer, no spinner. First run with no governed action ever: dim dash, caption `waiting for first governed action`.
- **H8 — 30-minute stream cap.** `MAX_SSE_DURATION_MS` closes the stream every 30 minutes; the shared hook reconnects at 1500ms. That reconnect must go through H4, not repaint from cache.

### Required transport change (prerequisite, both losing judges flagged it)

`app/api/stream/route.ts` currently writes `': heartbeat\n\n'` — an **SSE comment, invisible to `EventSource`**. Two small changes are required before H3 exists at all:

1. Emit a **named** `heartbeat` event instead of a comment.
2. `app/hooks/useRealtime.ts` exposes `{ connected, lastEventAt }` from the shared `EventSource` (it currently exposes neither).

Without these, "no SSE message in 20s = offline" false-fires on every quiet fleet, and the rule *unknown never renders as calm* inverts into *calm always renders as unknown*.

---

## 9. Motion

Total sanctioned motion: **five behaviours.** Everything else on this surface is static. `app/globals.css` neutralises all animation under `prefers-reduced-motion` globally — no component modifiers needed, but every motion-carried signal needs a static fallback.

| # | Motion | Spec | Justification | Reduced-motion fallback |
|---|---|---|---|---|
| 1 | Baseline segment | 60px lit segment, 900ms linear, one per SSE event, governed per §5.4 | The only proof the pipeline is alive and agents are acting | Segment appears in place, fades over 400ms, no travel |
| 2 | Ring arm | 240ms colour cross-fade, then **one** 700ms luminance swell (55%→100%→85%), then holds | A state change while he is looking at his cards must still be catchable two seconds later. One swell — a loop is alarm fatigue | Instant colour change |
| 3 | Elevated breathe | Ring only, 2.4s ease-in-out, opacity .55 ↔ 1.0. **The only loop in the product.** Applies to OWED-SIGNAL and overdue OWED-APPROVAL | Master caution: something is wrong and nobody is handling it | **MANDATORY:** second inner 1px `--color-error` ring. Double ring = elevated |
| 4 | Glyph crossfade | 160ms opacity + 2px rise on any count change | No spring, no bounce, no count-up | Instant |
| 5 | Reveal | 120ms fade + 4px translate, reusing the existing `fadeSlideIn` keyframe | The operator asked; do not make him wait | Instant |

**Banned on this surface:** spinners, skeleton shimmer, number roll-ups, particle/orb effects, gradient sweeps, blur or bloom on the ring, any loop in calm/active/unconfirmed, and **any motion at all triggered by a completed action**. A successful governed action is the most common event in the system; if it moved anything beyond the baseline strip, this widget would be closed within a day.

**Failing to ship the #3 fallback ships a dishonest widget** — the global reduced-motion block will silently disarm the master caution for anyone whose OS asks for less motion. This is the single implementation detail most likely to be dropped.

---

## 10. Slice 1 non-goals (explicit)

Not built, not stubbed, not "just in case":

1. **No approve / deny / dismiss controls.** Read-only. The 36px reveal row is reserved and empty.
2. **No spend, cost, or token metrics.** Money is not a doorbell.
3. **No agent list, no per-agent filtering, no lanes.**
4. **No chart, no log, no scroll, no history visualisation.** `/decisions` owns the ledger.
5. **No header, logo, posture pill, icon buttons, stat tiles, or connection footer.**
6. **No `output_summary`, prompts, reasoning, message bodies, artifact contents, `signal.detail`, parameters, or secrets** — anywhere, at any size, including `title` tooltips.
7. **No sound, no OS notifications, no push.**
8. **No new ingestion, no new table, no new column, no new SSE event kind** (the heartbeat change in §8 renames an existing keepalive; it adds no data).
9. **No settings, preferences, or configuration UI.** Thresholds are constants in the lib.
10. **No light mode.**
11. **No `/widget` entry in nav.** It is a deliberate standalone window; discovery is a link from `/approvals`.

---

## 11. Build shape and required tests

**Files (the whole build):**

```
app/widget/page.jsx              client page — must be .jsx, this repo's
                                 testable-pages convention
app/lib/widget/pulse.ts          composePulse(snapshot, now) — PURE
app/api/widget/pulse/route.ts    the snapshot route (repository calls only —
                                 no direct SQL in route files)
```

`composePulse(snapshot, now) → { posture, ring, glyph, caption, revealRows, railKind, presence, baselineKind, title, favicon }`. Every visual decision is a pure function of the snapshot. There is **no geometry** — no polar math, no measured-height bucketing, no persisted lane state — so there is no class of bug the unit tests cannot reach.

**Fixture matrix** (posture × freshness × boundary): agents `0 / 1 / 3`; pending `0 / 1 / 2 / 5 / 9`; red signals `0 / 1 / 2`; ages `59s / 61s / 89s / 91s`; dwellRatio `0.9 / 1.0 / 1.1` at each risk band; `queriesDegraded` empty and `['pending']`.

**Invariants that must be asserted (honesty that is not tested is decoration):**

- `glyph === 'solid-dash'` **implies** `pending === 0 && red === 0 && heartbeat === true && queriesDegraded.length === 0`
- `pending > 0` **implies** the glyph renders the pending count — for **every** signal count (this is rule R1, the correction that resolved the judge disagreement)
- `signals > 0 && pending > 0` **implies** the rail is rendered
- `posture === 'stale'` **implies** the caption is past tense and carries a wall-clock stamp
- presence verdict absent **implies** `unknown`, never `live`
- no caption string exceeds the window-clamped forms in H6
- no rendered string contains `output_summary`, `signal.detail`, or an untruncated `declared_goal`

**Gates before push:** `npm run lint`, `npx vitest run` (full suite), `npx next build` (this change is under `app/**`), `npm run typecheck` (changed `.ts` files).

**Rendered proof (required — HUMAN-EXPERIENCE.md clause 4):** drive `/widget` at 360×560, 300×220, and 400×700 with the frontend-verify skill. Confirm calm renders three marks with zero chroma; confirm an injected pending row flips the ring to brand while a simultaneous red signal renders as the rail and not as the glyph; confirm the reduced-motion double ring appears with `prefers-reduced-motion: reduce` forced. Tests prove the data exists; only the rendered page proves a human can use it.
