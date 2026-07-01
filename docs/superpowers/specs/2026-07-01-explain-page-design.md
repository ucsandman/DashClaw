# Design: `public/explain/index.html` — "DashClaw, explained"

**Date:** 2026-07-01
**Status:** Approved (brainstorm complete, pending spec review)

## Purpose

A single interactive HTML page that explains DashClaw to a layered audience: evaluators ("what is this, why do I need it") at the top, integrators ("how do I wire it up") at the bottom. Explainers, interactive prototypes, diagrams, code examples, and best practices in one artifact.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Audience | Both evaluators and integrators, layered shallow→deep on one page |
| Delivery | Standalone self-contained HTML at `public/explain/index.html`, served at `/explain/` (Next serves `public/` directories with `index.html` resolution — same mechanism as `/livingcode/`) |
| Interactive centerpieces | All four: guard decision simulator, governance-loop walkthrough, live code examples, policy playground |
| Fidelity | **Illustrative** — real decision types, real 40/70 risk bands, real policy shapes, but simplified math, clearly labeled "illustrative simulation." No porting of `app/lib/guard.ts` logic; no live API calls |
| Structure | One long scrollytelling page with sticky section nav and deep-linkable anchors |
| Visual identity | DashClaw brand — token values replicated from `app/globals.css` as CSS custom properties with a source-of-truth comment; no arbitrary hexes |

## Constraints

- **Zero dependencies, zero build step.** Inline CSS + vanilla JS, system font stack, inline SVG only. Works offline; shareable as one file.
- **No version numbers, no drift-prone counts** (routes, SDK methods, MCP tools, policies) anywhere on the page. The page teaches stable concepts; the app and docs are the source of truth for numbers.
- **No live API calls, no auth, no analytics.**
- Accessibility: all controls keyboard-operable; `prefers-reduced-motion` respected (animations degrade to static states).
- Target size: roughly ≤ 250 KB of hand-written HTML/CSS/JS.

## Page structure

1. **Hero** — "Decision infrastructure for AI agents." One-paragraph definition: policy enforcement, decision recording, assumption tracking, risk signals. Sticky top nav with anchors to every section.

2. **The problem (before/after toggle)** — simulated agent action feed. "Ungoverned": the agent silently sends emails, spends money, deletes files. "Governed": the same feed with guard verdicts, an approval interception, and a decision ledger accumulating. Emotional hook for evaluators.

3. **The governance loop (animated walkthrough)** — step-through diagram of the real 4-step loop from `docs/architecture/runtime-api.md`:
   1. **Guard** (`POST /api/guard`) — "Can I do this?" → `allow | warn | block | require_approval`
   2. **Record** (`POST /api/actions`) — "I am doing this."
   3. **Assumption** (`POST /api/assumptions`) — "This belief matters while I act."
   4. **Outcome** (`POST /api/actions/:actionId/outcome`) — "This completed / partially completed / failed."

   Clicking a step highlights the actor in the diagram and shows the endpoint plus a short example payload (shapes taken from the runtime-api doc). Prev/next buttons + keyboard arrows.

4. **Guard decision simulator** — controls: action type (e.g. `message.send`, `payment.create`, `file.delete`, `deploy`), spend amount, reversibility toggle, systems-touched picker, agent trust slider, one or two policy toggles. Output: illustrative risk score on a band gauge with the real 40/70 thresholds, decision chip, and a plain-English "why" trace listing contributing signals. Labeled: *"Illustrative simulation — production decisions come from the guard runtime."*

5. **Policy playground** — compose a policy (spend cap, blocked action types, approval-above-risk threshold); a table of ~8 sample agent actions re-evaluates live showing pass / warn / block / require-approval under the composed contract.

6. **One action, four integrations** — scenario picker + tabbed code panel: Node SDK / Python SDK / MCP tool call / raw HTTP, same governed action in each style, copy button per snippet. Snippets follow real SDK conventions (camelCase Node per `sdk/README.md`, snake_case Python) and the minimal-flow example in `docs/architecture/runtime-api.md`, but stay short — mental-model examples, not API reference.

7. **Best practices** — ~8 expandable cards distilled from docs and the governance skill: fail closed; record everything; never self-approve; declare goals honestly; use idempotency keys; track assumptions; session lifecycle; approval hygiene.

8. **Architecture at a glance** — one inline SVG: agents ↔ SDK/MCP ↔ governance runtime ↔ Postgres, with dashboard surfaces (Mission Control, Decisions, Policies) attached.

9. **Go deeper** — links to `/connect`, `/mission-control`, `QUICK-START.md` (GitHub), docs, SDK READMEs. Relative links for in-app routes so the page works on any instance host.

## Out of scope

- Any change to app code, middleware, or `next.config.js` (none needed for serving).
- Mirroring real guard math or calling live APIs.
- A generated/refreshable pipeline (this is a hand-authored page; `public/livingcode/` remains the only generated HTML).

## Files touched

- `public/explain/index.html` — new, the entire deliverable.
- `README.md` — one discoverability line linking `/explain/`.

## Verification

- Dev server: `/explain/` loads clean; frontend-verify pass (console errors, every interactive control exercised).
- `npm run lint` and `npx vitest run` (full suite) — expected no-op, confirms nothing else was touched.
- `node scripts/check-doc-counts.mjs --strict` — confirms the new file trips no count gates.
- Manual: open the raw file from disk (offline check), keyboard-only pass, reduced-motion pass.
