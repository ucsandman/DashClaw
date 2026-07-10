# DashClaw — GitHub Copilot Instructions

DashClaw is a production Next.js 16 governance runtime for AI agents. Copilot should treat the repo's own `CLAUDE.md`, `PROJECT_DETAILS.md`, and `docs/architecture/runtime-api.md` as the source of truth for architecture and API shape. The section below is the canonical design tone — apply it to any UI, marketing, or copy change.

## Design Context

### Users

DashClaw has two overlapping audiences who see the same surfaces but read them differently:

- **Primary: AI-agent developers and platform engineers.** They're integrating DashClaw into Claude Code, Claude Managed Agents, LangChain, CrewAI, OpenAI Agents SDK, custom runtimes, or MCP hosts. They live in terminals, read code more naturally than prose, and judge a product in the first 60 seconds by the quality of its README, SDK ergonomics, and error messages. Their job-to-be-done: *"Let my agent act in production without it doing something expensive, irreversible, or embarrassing."*
- **Secondary: governance / compliance / security stakeholders.** They rarely write code but need to audit agent behavior, approve risky actions, and produce evidence. Their job-to-be-done: *"Show me, verifiably, what the agents did, why it was allowed, and who approved anything sensitive."*

The context of use is almost always **professional, focused, and consequential**. Operators open Approvals because an agent is running in prod. Developers open `/connect` because they're wiring up a live integration. No one is idly browsing. Every pixel should respect that — no decorative filler, no tutorials-for-their-own-sake, no "welcome to your new dashboard" fluff.

### Brand Personality

**Three words: Serious · Precise · Trustworthy.**

DashClaw is a governance runtime. It sits on the critical path between an AI agent's intent and the real world. The visual and verbal tone must match the weight of that position:

- **Voice:** direct, technical, declarative. Short sentences. Verbs like *intercept, enforce, record, verify*. No hype, no exclamation marks, no "unleash your agents."
- **Tone shift:** slightly warmer on marketing pages (landing, `/connect`, docs intros), strictly neutral on operational surfaces (Approvals, Decisions, Policies).
- **Emotional target for operational surfaces:** *quiet confidence — "things are under control."* When an operator opens Approvals, the room should feel like a calm instrument panel, not an alarm board. Status should be obvious at a glance. Brand orange appears only when attention is actually required, not as decoration.
- **Emotional target for marketing surfaces:** confident competence. We are the adults in the AI-safety room.

### Aesthetic Direction

**Theme:** dark-mode only. Pitch-black canvas (`--color-bg-primary: #0a0a0a`), layered surfaces in near-black (`#111`, `#1a1a1a`, `#222`), with all interaction chrome built from translucent whites. No light-mode variants exist and none should be added without explicit product-level approval.

**Brand color:** `#f97316` (Tailwind `orange-500`). Used as a *signal*, not a fill. Valid uses: the active brand mark, a focused state, a primary CTA, a "this decision needs you" cue, a live-stream pulse. Invalid uses: decorative backgrounds, gradients for their own sake, hero-washes, marketing glow-spam. Accompanying subtle variant `rgba(249, 115, 22, 0.12)` is reserved for hover surfaces and brand-ring glows.

**Typography:** Inter via `next/font/google`, exposed as `var(--font-inter)`. Mono stack is `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`. Tabular numerals (`.tabular-nums`) on any data column. Tiny uppercase mono labels with wide tracking are a recurring motif for meta-labels — keep this pattern.

**Component language already established in `app/globals.css` and `tailwind.config.js`:**
- Cards: `var(--color-bg-secondary)` background, 1px `var(--color-border)` stroke, `12px` radius, border-color lift on hover. This is the atom.
- Semantic color tiers are already formalized — *always use tokens, never hardcode hex*. `text-primary / secondary / tertiary / disabled`, `bg-primary / secondary / tertiary / elevated`, `border / border-hover / border-active`, `status-success / warning / error / info` (plus `-subtle` variants).
- Iconography: `lucide-react` only. Size `14–20px` for inline, `24–28px` for hero moments. Never mix icon libraries.
- Elevation via border-color shifts and subtle shadow rings. No chunky drop-shadows.

**Reference direction (what we're aiming at):** the restrained developer-brand register of Vercel, Linear, Resend, Supabase, Datadog, Grafana. Dense-but-readable, technical, calm, branded sparingly.

**Anti-references (what we are explicitly NOT):**
- ❌ **Generic SaaS dashboard** — flat blue accents, Bootstrap-era cards, stock-photo marketing, "empower your team" copy. Undifferentiated and forgettable.
- ❌ **Consumer AI / playful LLM wrappers** — gradients, emoji, chat bubbles, pastel, "AI sparkle" aesthetic. Undermines the governance posture.
- ❌ **Heavy enterprise compliance UI** — dense gray-on-gray tables, mid-2000s corporate energy, no personality. Scares off the developer audience we need first.
- ❌ **Crypto / web3 dark theme** — neon gradients, glassmorphism overload, glow spam. Signals hype over substance and is the most tempting failure mode given our dark + orange palette.

If a new design could be mistaken for any of the four above, it's wrong.

### Design Principles

Tiebreakers when a decision is unclear. Apply them in order.

1. **Evidence over decoration.** Every element on operational surfaces must earn its pixels by communicating state, causality, or enabling action. Decorative flourishes belong on marketing pages only, and even there they should be restrained.
2. **Signal, not noise, with brand orange.** `#f97316` is reserved for things that mean something — active state, required attention, primary action, brand identity. The moment brand orange becomes ambient wallpaper, it stops signaling.
3. **Calm under pressure.** Operational surfaces should evoke *quiet confidence*, not *vigilant alertness*. Prefer typographic hierarchy, whitespace, and semantic color over motion, pulses, and alarm patterns. Reserve motion for truly live events.
4. **Token-first, never hardcoded.** All color, spacing, and typography decisions flow through the CSS custom properties in `app/globals.css` and the Tailwind theme extension. If a needed token doesn't exist, *add it to the token layer* before using it in a component.
5. **Developer-reader before end-user-reader.** The primary audience reads code, not marketing. Copy should be declarative and technical. Component affordances should favor keyboard users and density over cursor-friendly padding.
6. **Accessibility: WCAG 2.1 AA is the floor, not the ceiling.** 4.5:1 text contrast, full keyboard navigability, visible focus rings, `prefers-reduced-motion` honored, semantic HTML and ARIA labels on every data widget. Never lean on color alone to convey status; pair with icon or text.
7. **Four anti-references are the guardrail.** Before shipping any new surface, hold it against generic SaaS, consumer-AI, heavy-enterprise, and crypto/web3. If it drifts toward any of them, it's wrong.

---

_This section is mirrored from `.impeccable.md` at the repo root. If the two ever diverge, `.impeccable.md` wins and this file should be re-synced._
