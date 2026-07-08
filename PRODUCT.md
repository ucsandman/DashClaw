# Product

> Derived view for design tooling (impeccable). Canonical sources win on conflict:
> product strategy/scope = [`THESIS.md`](THESIS.md), design context = [`.impeccable.md`](.impeccable.md),
> visual system = [`DESIGN.md`](DESIGN.md). Update those first, then re-derive this file.

## Register

product

## Users

- **Primary: AI-agent developers and platform engineers** running long, unattended autonomous coding-agent sessions (overnight runs, CI agents, background fleets) against real repos and real infrastructure. They live in terminals, judge tools in 60 seconds by README/SDK/error-message quality, and are one bad run away from an agent that force-pushes over main or drops a table. Job to be done: *"Let my agent act in production without it doing something expensive, irreversible, or embarrassing."*
- **Secondary: governance / compliance / security stakeholders** who audit agent behavior, approve risky actions, and produce evidence. Job to be done: *"Show me, verifiably, what the agents did, why it was allowed, and who approved anything sensitive."*

Context of use is always professional, focused, and consequential — an agent is running in prod, or a live integration is being wired. No one is idly browsing.

## Product Purpose

DashClaw is a fail-closed approval layer for unattended AI agent runs: it intercepts a tool call before it executes, risk-scores it against policy (`allow < warn < require_approval < block`), freezes dangerous actions until a human approves with one click from anywhere (phone, inbox — not a terminal), and writes a signed, replayable audit row for every decision. One loop: **Intercept → Decide → Approve → Prove.** The hero surface is the **Approvals inbox**; support surfaces are `/setup`, `/policies`, `/decisions`. Success = governance that earns its interruptions (calibrated false-block bound) and proves it is still enforcing (liveness), instead of nagging users into disabling it.

## Brand Personality

**Serious · Precise · Trustworthy.** Voice is direct, technical, declarative — verbs like *intercept, enforce, record, verify*; no hype, no exclamation marks. Operational surfaces target *quiet confidence* ("things are under control" — a calm instrument panel, not an alarm board). Marketing surfaces target confident competence: the adults in the AI-safety room. Reference register: Vercel, Linear, Resend, Supabase, Datadog, Grafana.

## Anti-references

1. **Generic SaaS dashboard** — flat blue accents, Bootstrap-era cards, "empower your team" copy.
2. **Consumer AI / playful LLM wrappers** — gradients, emoji, chat bubbles, pastel sparkle.
3. **Heavy enterprise compliance UI** — dense gray-on-gray tables, mid-2000s corporate energy.
4. **Crypto / web3 dark theme** — neon gradients, glassmorphism overload, glow spam (the most tempting failure mode given the dark + orange palette).

If a surface could be mistaken for any of the four, it's wrong.

## Design Principles

1. **Evidence over decoration.** Every element on operational surfaces earns its pixels by communicating state, causality, or enabling action.
2. **Signal, not noise, with brand orange.** `#f97316` is reserved for active state, required attention, primary action, brand identity — never ambient wallpaper.
3. **Calm under pressure.** Prefer typographic hierarchy, whitespace, and semantic color over motion and alarm patterns; reserve motion for truly live events.
4. **Token-first, never hardcoded.** All color/spacing/typography flows through `app/globals.css` tokens and the Tailwind theme; ad-hoc hex in JSX is a regression.
5. **Developer-reader first.** Declarative, technical copy; keyboard-friendly, density-tolerant components. Would it help a senior platform engineer at 1am mid-incident?

## Accessibility & Inclusion

WCAG 2.1 AA is the floor: 4.5:1 contrast on primary text, 3:1 on large text and meaningful UI components, full keyboard navigability, visible focus rings (brand orange or `border-active`), `prefers-reduced-motion` honored on every animation, semantic HTML and ARIA labels on data widgets. Never convey status by color alone — always pair with icon or text. Dark-mode only by explicit product decision.
