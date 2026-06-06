# Product

> **Canonical source:** [`.impeccable.md`](.impeccable.md) at the repo root is DashClaw's source-of-truth design context, referenced by `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, and the `impeccable-reminder.py` hook. This file is a derived, impeccable-format view of that **strategic** content so the impeccable skill can read it. **If the two diverge, `.impeccable.md` wins** — update it first, then re-derive this file. The **visual** system lives in [`DESIGN.md`](DESIGN.md).

## Register

product

## Users

DashClaw serves two overlapping audiences who see the same surfaces but read them differently:

- **Primary — AI-agent developers and platform engineers.** They integrate DashClaw into Claude Code, Claude Managed Agents, LangChain, CrewAI, the OpenAI Agents SDK, custom runtimes, or MCP hosts. They live in terminals, read code more naturally than prose, and judge a product in the first 60 seconds by its README, SDK ergonomics, and error messages. Job-to-be-done: *"Let my agent act in production without it doing something expensive, irreversible, or embarrassing."*
- **Secondary — governance / compliance / security stakeholders.** They rarely write code but need to audit agent behavior, approve risky actions, and produce evidence. Job-to-be-done: *"Show me, verifiably, what the agents did, why it was allowed, and who approved anything sensitive."*

The context of use is almost always **professional, focused, and consequential**. Operators open Mission Control because an agent is running in prod; developers open `/connect` because they're wiring a live integration. No one is idly browsing — every pixel should respect that. No decorative filler, no tutorials for their own sake, no "welcome to your new dashboard" fluff.

## Product Purpose

DashClaw is a **minimal governance runtime** — AI-agent decision infrastructure that sits on the critical path between an agent's intent and the real world. It enforces policy, records decisions, tracks assumptions, and surfaces risk signals. It is deliberately **not an agent platform**: it does not give agents tools to achieve goals (Calendar, Messaging, CRM); it provides the infrastructure to *govern* those goals. Success looks like an agent fleet running in production where every consequential action is intercepted, evaluated, recorded, and — when sensitive — approved, with verifiable evidence available for any auditor.

## Brand Personality

**Three words: Serious · Precise · Trustworthy.**

- **Voice:** direct, technical, declarative. Short sentences. Verbs like *intercept, enforce, record, verify*. No hype, no exclamation marks, no "unleash your agents."
- **Tone shift:** slightly warmer on marketing surfaces (landing, `/connect`, docs intros); strictly neutral on operational surfaces (Mission Control, Approvals, Decisions, Policies).
- **Emotional target — operational surfaces:** *quiet confidence; "things are under control."* Mission Control should feel like a calm instrument panel, not an alarm board. Status obvious at a glance; brand orange appears only when attention is actually required.
- **Emotional target — marketing surfaces:** confident competence. We are the adults in the AI-safety room.

## Anti-references

Before shipping any surface, hold it against these four. If a design could be mistaken for any of them, it's wrong. The tell: remove the DashClaw logo — would someone still recognize this as a governance runtime, not a generic AI product? If not, push further toward *serious · precise · trustworthy*.

- ❌ **Generic SaaS dashboard** — flat blue accents, Bootstrap-era cards, stock-photo marketing, "empower your team" copy. Undifferentiated and forgettable.
- ❌ **Consumer AI / playful LLM wrapper** — gradients, emoji, chat bubbles, pastel, "AI sparkle." Undermines the governance posture.
- ❌ **Heavy enterprise compliance UI** — dense gray-on-gray tables, mid-2000s corporate energy, no personality. Scares off the developer audience we need first.
- ❌ **Crypto / web3 dark theme** — neon gradients, glassmorphism overload, glow spam. Signals hype over substance, and is the most tempting failure mode given our dark + orange palette.

## Design Principles

The tiebreakers when a decision is unclear. Apply in order. The numbering is canonical and referenced elsewhere in the codebase (e.g. `app/globals.css` cites "principle #6"), so do not renumber.

1. **Evidence over decoration.** Every element on operational surfaces must earn its pixels by communicating state, causality, or enabling action. Decoration belongs on marketing pages only, and even there restrained. If a visual doesn't help the operator prove what happened or decide what to do next, cut it.
2. **Signal, not noise, with brand orange.** `#f97316` is reserved for things that mean something — active state, required attention, primary action, brand identity. The moment it becomes ambient wallpaper it stops signaling and the product loses a primary affordance. Default data color is white/zinc; orange enters only when the UI has something to say.
3. **Calm under pressure.** Operational surfaces evoke *quiet confidence*, not *vigilant alertness*. Prefer typographic hierarchy, whitespace, and semantic color over motion, pulses, and alarm patterns. Reserve motion for truly live events (incoming decisions, approval arrivals).
4. **Token-first, never hardcoded.** All color, spacing, and typography flow through the CSS custom properties in `app/globals.css` and the Tailwind theme. If a needed token doesn't exist, add it to the token layer before using it. Ad-hoc hex in JSX is a regression — refactor on sight.
5. **Developer-reader before end-user-reader.** The primary audience reads code, not marketing. Copy is declarative and technical; affordances favor keyboard users and density over cursor-friendly padding. Imagine a senior platform engineer reading it at 1am during an incident — would it help or annoy them?
6. **Accessibility: WCAG 2.1 AA is the floor, not the ceiling.** 4.5:1 on primary text, 3:1 on large text and meaningful UI; full keyboard navigability; visible focus rings (brand orange or `border-active`); `prefers-reduced-motion` honored on every animation; semantic HTML and ARIA on every data widget. Never lean on color alone for status — always pair with icon or text.
7. **Four anti-references are the guardrail.** Before shipping, hold the surface against generic-SaaS, consumer-AI, heavy-enterprise, and crypto/web3. If it drifts toward any, it's wrong. Cheap check; catches 90% of drift.

## Accessibility & Inclusion

WCAG 2.1 AA is the explicit floor (Principle 6). Concretely: 4.5:1 contrast on primary text and 3:1 on large text / meaningful UI components; full keyboard navigability with visible `:focus-visible` rings (the global brand-orange ring defined in `app/globals.css`); `prefers-reduced-motion` honored globally at the platform layer; semantic HTML and ARIA labels on every data widget; status never conveyed by color alone (always paired with an icon or text). DashClaw is dark-mode only — no light variant exists — and the text ramp was brightened to clear the floor with headroom (`text-secondary #c2c2cc` ≈ 10.8:1, `text-tertiary #9b9ba8` ≈ 6.9:1 on the lifted `#0e1014` canvas; tertiary was previously `#808088` at a borderline 4.6:1).
