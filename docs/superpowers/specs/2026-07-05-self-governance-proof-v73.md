# v7.3 — The self-governance proof surface

**Date:** 2026-07-05 · **Roadmap:** v7.3 (`docs/plans/owner-roadmap.md`) · **Status:** BUILDING

The project's most distinctive true fact — DashClaw's maintenance is itself governed
by DashClaw — made visible where strangers land, as live evidence rather than copy.

## What ships

1. **`GET /api/self-governance`** — a public, aggregate-only evidence endpoint,
   following the `/api/hosted/funnel` precedent (public at the middleware layer,
   self-guarding in the route, 60s in-memory memo).
   - **404 unless `DASHCLAW_SELF_GOVERNANCE_PUBLIC === 'true'`.** Default off on
     every instance. Only the instance that governs this repo's maintenance opts in.
   - Data via a new repository, `app/lib/repositories/self-governance.repository.ts`
     (no direct SQL in the route — `route-sql:check`).
2. **`/proof`** — a public marketing page (server component) that renders the
   evidence. Fetches `SELF_GOVERNANCE_SOURCE_URL` server-side with
   `next: { revalidate: 300 }`. Registered in `MARKETING_ROUTES`
   (`app/lib/marketingSeo.ts`, v6.3 rule), linked from the front page, navbar, and
   footer — a deep URL nobody links to is not a surface.
3. **The human-readable trail**, linked from the page: the maintainer log,
   `MAINTAINER.md`, the livingcode dashboard, and GitHub releases.

## Exposure boundary (the security-review contract)

Aggregate-only, same posture as `/api/hosted/funnel`:

- **No org identifiers, no slugs, no key prefixes, no agent ids.**
- **No free-text columns cross the boundary.** `action_type`, `declared_goal`,
  decision reasons, and rule names are all excluded — even "probably benign" labels
  are free text on the wire. The only string fields in the payload are the
  manifest-derived platform version (`NEXT_PUBLIC_DASHCLAW_VERSION`, injected from
  `package.json` by `next.config.js`) and ISO timestamps.
- **`byDecision` uses fixed literals** (`allow` / `warn` / `block` /
  `require_approval`) via `COUNT(*) FILTER (WHERE decision = '<literal>')` — an
  unexpected value in the column simply doesn't leave the instance.
- **Synthetic verification traffic is excluded** (smoke/loadtest/liveproof
  families via the shared `SYNTHETIC_*_LIKE_PATTERNS`, same as coverage and
  posture) — the proof counts real governance only; zero fabricated claims
  includes not inflating the numbers with the instance's own test traffic.
- **Instance-wide, not org-scoped** — an explicit decision: the flag is a
  per-instance operator opt-in that publishes that instance's aggregate governance
  posture. The governing instance is single-org by design. Multi-tenant instances
  should not set the flag; the `.env.example` entry says so.
- The upstream URL the page fetches is an operator-set env var, never user input —
  no SSRF surface. Fetch failures render an honest "live evidence unavailable"
  state; the page never fabricates numbers and never hardcodes them.

## Payload contract

```json
{
  "selfGovernance": true,
  "version": "<running platform version = the latest governed ship>",
  "generatedAt": "<ISO>",
  "actions": {
    "total": 0, "last30d": 0, "last7d": 0,
    "firstAt": "<ISO|null>", "latestAt": "<ISO|null>",
    "activeDays": 0
  },
  "decisions": {
    "total": 0, "last30d": 0,
    "byDecision": { "allow": 0, "warn": 0, "block": 0, "require_approval": 0 }
  }
}
```

- "Latest governed ship" = the governing instance's own running `version`. That
  instance redeploys from `main` on every ship, and every ship is a governed act —
  the running version *is* the evidence, with `actions.latestAt` alongside it.
- "Decision cadence" = `last30d` / `last7d` / `activeDays`
  (`COUNT(DISTINCT created_at::date)`).
- All `created_at` comparisons cast `::timestamptz` — on fresh schemas
  `guard_decisions.created_at` is TEXT (known drift class); counts cast `::int`
  and are `Number()`-wrapped (pg numerics arrive as strings).

## Env vars (both in `.env.example`)

- `DASHCLAW_SELF_GOVERNANCE_PUBLIC` — opt-in on the *source* instance. Default off.
- `SELF_GOVERNANCE_SOURCE_URL` — set on the *marketing* deployment (www); absolute
  URL of the source instance's `/api/self-governance`. Unset → the page renders the
  trail and the honest fallback state, never an error page.

## Acceptance (from the roadmap, unchanged)

- Page live and crawl-clean; linked from the front page.
- The numbers are live queries, not hardcoded.
- Security review recorded (below).
- Zero fabricated claims.

## Security review

**PASS — recorded 2026-07-05** (dashclaw-security-reviewer, Opus; BLOCKER 0,
HIGH 0, MEDIUM 0, LOW 1, INFO 1). Sign-off:

> The v7.3 self-governance proof surface enforces the aggregate-only exposure
> boundary — the repository SQL emits only counts, min/max timestamps, and
> distinct-day counts with fixed-literal decision buckets; no org identifier,
> key material, or free-text column can cross `/api/self-governance`; the
> middleware exemption is limited to `GET /api/self-governance` exactly with
> untrusted identity headers stripped; the `/proof` page fetches an
> operator-set URL (no SSRF) and renders only React-escaped strings (no XSS);
> and the surface is default-off on every instance, leaving a
> deliberately-documented multi-tenant opt-in as the sole aggregate-disclosure
> path.

Accepted findings: **LOW** — the 60s memo is per-lambda on serverless, so a
cold-start fan-out can run the two aggregate scans more than once per window;
bounded by the per-IP rate limiter and single-org table sizes, same posture as
`/api/hosted/funnel`. **INFO** — upstream fields beyond the two validated
totals aren't individually type-checked on `/proof`; a bad value renders as
React-escaped text/NaN, cosmetic only.
