# v3.6 — Enforcement over assertion

**Status:** Ratified (maintainer, under the MAINTAINER.md delegation) · 2026-07-04
**Roadmap item:** v3.6 (`docs/plans/owner-roadmap.md`) — "'Blocks are absolute'
must be true mechanically, not socially — or the docs must say exactly where
the boundary is."

## Evidence base (gathered 2026-07-04)

1. **The live fleet has zero verified-JWT traffic.** Query over the production
   ledger: 176,149 guard decisions, all `verification_status='unverified'`
   (plus 2 `failed`). No caller sends JWKS-verified JWTs today, so
   `replay_status` and `act_status` have never been anything but
   `not_applicable` in production.
2. **Both `required` modes are scoped to verified traffic only.** Code-verified:
   API-key-only callers (no bearer token) get `replay_status='not_applicable'`
   and `act_status='not_applicable'` (`app/api/guard/route.ts:269-275`), and
   neither `replayReasonFor` nor `computeActBindingBlockReason` blocks on
   `not_applicable` (`app/lib/guard.ts:329-336, 354-369`). Flipping defaults
   cannot affect the Phase-1 API-key fleet.
3. **Test asymmetry.** Act binding has five `evaluateGuard`-level mode-toggle
   tests (`guard-engine.test.js` "evaluateGuard — action binding"); JTI replay
   has none at that level — only repository mechanics and env-enum shape.
4. **Flip precedent.** `DASHCLAW_SUBAGENT_IDENTITY` (v4.35.0) and
   `DASHCLAW_GUARD_FALLBACK` (fail-open → fail-closed) both flipped defaults in
   a minor release with a one-env-var rollback kept indefinitely and a
   CHANGELOG note. No major-version gate.
5. **No prior enforcing-proxy spec exists.** The only mention is the roadmap
   item itself. The honest boundary is already written in three engineering
   docs (PLUGIN_PARITY.md, the 2026-06-01 Desktop plugin spec,
   `docs/agent-identity.md`) but never consolidated, and the user-facing
   Desktop connect guide (`docs/CLAUDE-DESKTOP-PLUGIN.md`) omits it entirely.

## D1 — `DASHCLAW_JTI_REPLAY_PROTECTION` default: `best_effort` → `required`

**Decision: flip.** Rationale: the blast radius is exactly the verified-JWT
fleet, which is empty (evidence 1–2). Waiting for adoption before flipping
inverts the precedent's logic — today the flip is free; after adoption it is a
breaking change. Future issuers onboard against the full contract from day
one: verified tokens must carry `jti` + `exp`, and a replay-store outage
fails closed *for verified traffic only* (API-key traffic is untouched;
`DASHCLAW_GUARD_FALLBACK` continues to govern evaluation-path degradation).

Mechanics:

- The default literal is duplicated in `app/api/guard/route.ts:213` and
  `app/lib/guard.ts:330` — exactly the drift a flip could miss. Extract one
  getter (`getJtiReplayMode()`, mirroring `getActBindingMode()`), used by both
  call sites; invalid values fall back to the default.
- `app/lib/env.ts` enum default updated to match.
- **Close the test gap (evidence 3):** add an
  `evaluateGuard — replay protection` block mirroring act binding's:
  blocks `replayed` under `best_effort`; does not block `not_present` under
  `best_effort`; blocks `not_present` and `unavailable` under `required`;
  allows `unique` under `required`; never blocks `not_applicable` under
  `required` (pins the API-key exemption).
- Rollback is one env var: `DASHCLAW_JTI_REPLAY_PROTECTION=best_effort` (or
  `off`). `.env.example`, `docs/agent-identity.md`, CHANGELOG breaking-note.

## D2 — `DASHCLAW_ACT_BINDING` default: `off` → `best_effort`; `required` stays opt-in

**Decision: flip to `best_effort` only.** In `best_effort`, the only blocking
status is `mismatch`, which requires a *present* binding claim — issuers that
don't mint the claim see zero behavior change, while an actually-repurposed
token (minted for one `(action, target, goal)`, replayed against another)
starts blocking. That is pure win at zero blast radius.

`required` stays opt-in **with reason**: it blocks `not_present`, which would
make minting the `urn:dashclaw:act-binding` claim a precondition for JWKS
adoption at all. jti is a standard claim; act binding is DashClaw-specific
per-request work. Graduating `required` waits for the readiness signal the
code already emits (`act_status` is computed in every mode for exactly this
purpose — `app/api/guard/route.ts:259-267`).

Mechanics: default in `app/lib/act-binding.ts` (single source, has a getter);
invalid values fall back to the new default; update the default-mode
assertions in `act-binding.test.js`; `.env.example`, `docs/agent-identity.md`
("why off" paragraph rewritten to "why best_effort / why not required"),
CHANGELOG + rollback env var.

## D3 — Enforcing proxy for non-cooperating harnesses: **KILL**, with the boundary written

**Decision: recorded kill.** A guard-enforcing gateway in front of consumer
Claude Desktop / web-chat tool execution is not buildable by DashClaw:
enforcement requires sitting between "model decides to call a tool" and "tool
executes," and that boundary lives inside Anthropic's client, which exposes no
third-party interception point on plain chat (MCP lets DashClaw *offer* tools,
never *wrap* tools it doesn't own; Cowork hard-gating remains unverified).
Every surface where DashClaw achieves mechanical enforcement follows one
pattern — a host runtime that exposes a pre-execution veto (Claude Code /
Codex / Hermes hooks, the OpenClaw gateway plugin) or DashClaw itself being
the executor (`dashclaw_invoke` capability proxy, which guards, withholds on
approval, and executes server-side).

The one real alternative — re-registering every connector as a DashClaw
`http_api` capability so `dashclaw_invoke` is the only tool surface — is
rejected: it turns DashClaw into a connector broker, contradicting the
governance boundary ("a minimal governance runtime, not an agent platform",
CLAUDE.md / PROJECT_DETAILS.md), and still cannot cover Anthropic-native tools
(web search, code execution) that Desktop exposes outside any connector.

Deliverable: `docs/architecture/enforcement-boundary.md` — an ADR in the
`trust-and-failure-model.md` genre containing (a) the kill decision + reasons +
supersession rule (revisit if consumer surfaces ever ship a hook contract),
and (b) the **canonical per-surface enforcement table** (D4's anchor):

| Surface | Enforcement |
|---|---|
| Claude Code / Codex hooks (`enforce` mode) | Mechanical — PreToolUse exit-2 halts the tool; fail-closed on unreachable instance |
| Hermes `pre_tool_call` | Mechanical — lifecycle veto |
| OpenClaw gateway plugin | Mechanical — `before_tool_call` veto, fail-closed default |
| `dashclaw_invoke` capability proxy | Mechanical — DashClaw is the executor; block = never executes, approval withholds execution server-side |
| SDK / direct API / bare MCP tools | Cooperative — guard returns the decision; the caller must honor it |
| Claude Desktop / consumer chat (OAuth connector) | Cooperative — governance skill guides the model; no interception layer exists |

Constitution §1 ("blocks are absolute") is a **decision-layer** invariant and
is untouched: no approval, grant, or maintainer action ever downgrades a
`block` decision, on any surface. What varies per surface is whether a block
decision is mechanically *executed* or cooperatively *honored*.

## D4 — Truth pass: every "blocks" claim states the boundary

Rule: product copy may say "block/enforce" only where the mechanism is
mechanical, or with a qualifier + pointer to the enforcement boundary. The
gold standard to replicate is `app/docs/page.tsx:567`. Fixes, from the
2026-07-04 sweep (overclaims first):

- `README.md` §top ("intercepts… enforces", the Intercept/Enforce capability
  rows, "blocked at guard time") — add the one-sentence boundary + link to the
  ADR; add the per-surface table to the hardening/identity section.
- `QUICK-START.md:16` ("intercepts and blocks it") — scope to the hook path
  the demo actually uses; `:112` "Abort on `block`" → state the SDK caller
  writes the abort.
- `sdk-python/README.md:374-376` — delete "unauthorized action prevented"
  framing; the developer's `if` is the enforcement.
- `sdk/README.md` guard section — keep "advisory" labels, add boundary link.
- `app/docs/page.tsx` SDK snippets ("abort on hard block") — align wording
  with its own line-567 paragraph.
- `app/self-host/page.tsx:199` ("no-code policy enforcement") — qualifier.
- `app/page.tsx:610` feature card — decision-layer wording.
- `docs/architecture/runtime-api.md:62` — keep "blocks are absolute"
  (constitution phrase) + add the per-surface sentence and ADR link.
- `PROJECT_DETAILS.md:35,85` — "before an action proceeds" → decision-layer
  wording + link.
- `plugins/dashclaw/skills/dashclaw-governance/SKILL.md` — add a boundary
  note: the skill is the cooperative half; hooks are the mechanical backstop.
- `docs/CLAUDE-DESKTOP-PLUGIN.md` — add the advisory-vs-enforced caveat
  (currently absent entirely).
- PLUGIN_PARITY.md — link to the ADR as the canonical table.

## D5 — Human surface (HUMAN-EXPERIENCE.md)

1. **Where does a human SEE it?** `/setup` gains a compact **Enforcement
   posture** card: the instance's live modes (`DASHCLAW_JTI_REPLAY_PROTECTION`,
   `DASHCLAW_ACT_BINDING`, `DASHCLAW_GUARD_FALLBACK`, hook mode is
   client-side so it is described, not read) with one line each on what is
   mechanical vs cooperative, linking to `/docs`' boundary section. Click
   path: existing `/setup` page, beside the live-canary card.
   *In-ship security scoping (review LOW, fixed not filed, v3.4 precedent):
   `/setup` is unauthenticated, so a knob set BELOW its hardened default
   renders as "review recommended" with the value withheld — a hardened
   instance discloses only the defaults; a weakened one hands no recon to
   anonymous visitors. Full values stay operator-verifiable via the env and
   the authenticated Doctor panel.*
2. **Discoverable?** `/setup` is the readiness surface humans already visit;
   `/docs` already renders the gold-standard boundary paragraph.
3. **Every human step a click?** Yes — the card is read-only posture truth;
   changing a mode is an env var by nature (self-host operator act), and the
   card says exactly which var and value, which is the honest shape.
4. **Verified rendered?** Headless proof of the card on /setup pre-ship.

Marketing: `app/page.tsx` already carries accurate boundary copy (lines 47,
719); D4's card-610 fix is the only marketing edit. No stronger claim ships.

## Acceptance (mirrors the roadmap)

- Defaults flipped (D1, D2) and pinned: new `evaluateGuard` replay-mode tests
  + updated act-binding default tests; full gates green.
- The proxy decision exists as a recorded kill with the boundary ADR (D3).
- README/docs/marketing say nothing stronger than what the code enforces (D4
  list applied); `/setup` renders the enforcement-posture card (D5, rendered
  proof).
- CHANGELOG notes both flips with their one-env-var rollbacks.
