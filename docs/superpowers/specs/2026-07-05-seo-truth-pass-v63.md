# v6.3 — Organic search surface: marketing SEO truth pass

Roadmap: `docs/plans/owner-roadmap.md` v6.3. Drafted and built 2026-07-05 by the
maintainer under the MAINTAINER.md outward-acts clause.

## Recon findings (verified live + in source, 2026-07-05)

- **`/robots.txt` and `/sitemap.xml` 404 on the live marketing site**
  (`www.dashclaw.io`). No sitemap/robots infrastructure exists anywhere in the
  repo — from-scratch build.
- Canonical host is `www.dashclaw.io` (apex `dashclaw.io` 307s to it), but
  `app/layout.tsx` sets `openGraph.url: 'https://dashclaw.io'` and no
  `metadataBase`, so relative OG image URLs have no absolute base.
- All 20 public pages are server components with `metadata` exports (landing
  inherits the root layout's), but **zero pages set `alternates.canonical`**,
  only 2 override `openGraph` (title/description only), and **no page emits
  JSON-LD structured data**.
- Guides and blog posts are already self-contained landing pages (PublicNavbar
  + PublicFooter, framework-specific titles/descriptions). No structural work
  needed there.
- Host detection: the exact-match `isMarketingHost` pattern
  (`dashclaw.io` / `www.dashclaw.io`) already exists in
  `app/lib/guideContent.ts` and is the proven-safe way to distinguish the
  marketing site from hosted-trial and self-host instances. There is no env
  var meaning "this is the marketing build" — host header is the mechanism.

## Claims audit (truth pass — every marketing claim verified)

| Claim | Verdict |
|---|---|
| Landing: "33 tools and 6 resources" (MCP) | **Accurate** (counted in `mcp-server/src/tools.ts` / `resources.ts`) and already drift-guarded by `scripts/check-doc-counts.mjs:135`. No action. |
| Blog beachhead: placeholder Loom video | **Not fabricated** — `VideoHero` detects `PLACEHOLDER` and renders an honest "Walkthrough recording coming soon" poster, never a broken iframe. No action. |
| Hermes guide: doctor "runs a 4-section check: env vars, hooks, skills, API reachability, and a finalize probe" | **True but confusing** — the doctor has exactly 4 sections (`__init__.py:163-181`); the sentence enumerates 5 items because the API section contains two probes. Copy clarified to "API reachability plus a finalize: true probe". |
| Hermes guide: "all 8 hooks" | **Accurate** — `REQUIRED_HOOKS` has 8 entries. No action. |
| Practical Systems bio stats ("40+ tools", "50+ users") | Wes-provided biography on his own company page, not maintainer-authored claims; outside this pass's scope. Left untouched. |
| No testimonials / "trusted by" / user counts exist anywhere | Confirmed — nothing to audit. |

## Scope (what ships)

1. **`app/robots.txt/route.ts`** — plain route handler (not the metadata-file
   convention: host-aware behavior needs the request `Host` header, which
   route handlers support unambiguously). Marketing host → allow all, disallow
   `/api/` and `/approve`, `Sitemap:` line. **Any other host (hosted trial,
   self-host instances, previews) → `Disallow: /`** so strangers' and Wes's
   instances never get indexed.
2. **`app/sitemap.xml/route.ts`** — marketing host → the 17 marketing URLs on
   `https://www.dashclaw.io`; other hosts → empty urlset. No fabricated
   `lastmod` values (omitted rather than faked).
3. **`app/lib/marketingSeo.ts`** — `MARKETING_ORIGIN`, the marketing route
   list (single source for sitemap + tests), and `marketingPageMetadata()`
   which builds canonical + openGraph + twitter for a page from its existing
   title/description. `isMarketingHost` is exported from
   `app/lib/guideContent.ts` (already implemented there) and reused.
4. **`metadataBase` + canonical-host fix** in `app/layout.tsx`
   (`https://www.dashclaw.io`).
5. **Per-page canonical + OG** on all 17 marketing pages: landing, 8 guides,
   3 blog posts, /docs, /self-host, /privacy, /connect, /downloads,
   /practical-systems. Existing titles/descriptions preserved verbatim.
6. **JSON-LD** via a small `JsonLd` component: landing (Organization +
   SoftwareApplication), blog posts (BlogPosting with real `datePublished`
   from git first-commit dates: beachhead 2026-04-22, codex-parity and
   hermes-plugin 2026-05-14), guides (TechArticle).
7. **Hermes guide copy clarity fix** (the one truth finding).
8. **Unit tests** for the robots/sitemap handlers (per-host behavior) and the
   metadata helper.

Out of scope, stated per HUMAN-EXPERIENCE.md: this is crawl infrastructure —
the human-visible surface **is the existing marketing pages themselves**
(unchanged visually; `.impeccable.md` untouched). No new UI surface because
robots/sitemap/meta tags have no human click path by nature; rendered proof
covers what a stranger's browser and a crawler actually receive. No `/blog` or
`/guides` index pages are added (feature work, not a truth pass).

## Measured bar (set at build time, per the acceptance clause)

**Build-time bar (verified before ship, evidence in the maintainer log):**
- `curl` against a production build: `/robots.txt` and `/sitemap.xml` return
  200 with marketing rules under `Host: www.dashclaw.io` and `Disallow: /` /
  empty urlset under any other host.
- Every sitemap URL returns HTTP 200 on the production build (crawl-clean).
- Rendered proof: landing + one guide + one blog post show canonical link,
  og:title matching the page (not the site default), and valid JSON-LD in
  served HTML.

**Outcome bar (read at v6.5, not asserted now):** within the v6.5 measurement
window, organic search arrivals are attributable via v6.4's `bySource`
funnel annotation (referrer capture already live in v4.60.0). The v6.5 read
cites the per-source numbers; this item's success is "findable and
attributable", not a traffic promise.
