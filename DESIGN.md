---
name: DashClaw
description: Governance runtime for AI agents — a calm, evidence-first dark instrument panel.
colors:
  brand: "#f97316"
  brand-hover: "#fb923c"
  brand-subtle: "#f973161f"
  bg-primary: "#0e1014"
  bg-secondary: "#15171c"
  bg-tertiary: "#1d2026"
  bg-elevated: "#272b32"
  border: "#ffffff14"
  border-hover: "#ffffff24"
  border-active: "#f9731666"
  text-primary: "#fafafa"
  text-secondary: "#c2c2cc"
  text-tertiary: "#9b9ba8"
  text-disabled: "#5c5c66"
  success: "#22c55e"
  warning: "#eab308"
  error: "#ef4444"
  info: "#3b82f6"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.75rem, 4vw, 2.5rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.14em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
rounded:
  md: "8px"
  lg: "12px"
  full: "9999px"
components:
  card:
    backgroundColor: "{colors.bg-secondary}"
    rounded: "{rounded.lg}"
    padding: "20px"
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
    textColor: "#ffffff"
  button-ghost-brand:
    backgroundColor: "{colors.brand-subtle}"
    textColor: "{colors.brand}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.bg-tertiary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  badge:
    backgroundColor: "{colors.brand-subtle}"
    textColor: "{colors.brand}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
---

# Design System: DashClaw

> **Canonical source:** [`.impeccable.md`](.impeccable.md) is DashClaw's source-of-truth design context. This `DESIGN.md` is a derived, Stitch-format capture of the **visual** system for the impeccable skill and other DESIGN.md-aware tooling. The live token values are defined as CSS custom properties in [`app/globals.css`](app/globals.css) and aliased in `tailwind.config.js` — **those files win** over the hex mirrored in the frontmatter above. Users and brand voice live in [`.impeccable.md`](.impeccable.md); product strategy and scope live in [`THESIS.md`](THESIS.md).

## 1. Overview

**Creative North Star: "The Calm Instrument Panel."**

DashClaw is a governance runtime that sits between an AI agent's intent and the real world, so its interface carries the weight of that position: a pitch-black operations console an engineer can read at 1am during an incident without flinching. The canvas is near-black (`#0a0a0a`), surfaces are layered near-blacks, and all interaction chrome is built from translucent whites — depth comes from border-color, not shadow. Brand orange (`#f97316`) is the single chromatic voice, and it is rationed: it appears only where the UI has something to say — an active state, a required approval, a live pulse, a primary action. Everything else is white, zinc, and four semantic status hues.

The system is dense but readable, technical but calm. Hierarchy is carried by type scale, weight, and whitespace rather than motion or color. Motion is reserved for genuinely live events (an incoming decision, an approval landing); the panel does not pulse for decoration.

It explicitly rejects four neighbors: the **generic SaaS dashboard** (flat blue, Bootstrap cards), the **consumer-AI wrapper** (gradients, emoji, pastel, "AI sparkle"), the **heavy enterprise compliance UI** (gray-on-gray, no personality), and the **crypto/web3 dark theme** (neon gradients, glassmorphism, glow spam) — the last being the most tempting failure mode given the dark + orange palette.

**Key Characteristics:**
- Dark-mode only; no light variant exists.
- Brand orange as signal, never wallpaper (a few elements per screen at most).
- Depth via 1px translucent-white borders and border-color lift, not drop shadows.
- Tabular numerals on every data column.
- Tiny uppercase wide-tracked labels as the recurring meta-label motif.

## 2. Colors

A near-monochrome dark foundation, one rationed chromatic signal (brand orange), and four semantic status hues.

### Primary
- **Brand Orange** (`#f97316`, Tailwind `orange-500`): the single brand voice. Reserved for the active brand mark, primary CTAs, focus rings, required-attention cues, and live-stream pulses. Hover lifts to **Brand Hover** (`#fb923c`). **Brand Subtle** (`rgba(249,115,22,0.12)`) backs ghost-brand buttons, count pills, and hover surfaces.

### Neutral — surfaces
- **Canvas** (`#0a0a0a`): the pitch-black body background; the room everything sits in.
- **Surface Secondary** (`#111111`): the card atom's background — the default raised plane.
- **Surface Tertiary** (`#1a1a1a`): inputs, nested wells, secondary panels.
- **Surface Elevated** (`#222222`): menus, popovers, `<option>` lists.

### Neutral — text
- **Text Primary** (`#fafafa`): headings and primary data.
- **Text Secondary** (`#a1a1aa`): supporting copy, labels with content.
- **Text Tertiary** (`#808088`): meta-labels and de-emphasized text. Lifted from `#71717a` (4.1:1, failed AA) to clear 4.6:1 on canvas — do not darken it again.
- **Text Disabled** (`#52525b`): disabled controls only.

### Neutral — borders
- **Border** (`rgba(255,255,255,0.06)`): the default 1px hairline on every card and field.
- **Border Hover** (`rgba(255,255,255,0.12)`): the hover/active lift — this is how surfaces respond, not shadow.
- **Border Active** (`rgba(249,115,22,0.4)`): the brand-tinted active/focus border.

### Status
- **Success** `#22c55e`, **Warning** `#eab308`, **Error** `#ef4444`, **Info** `#3b82f6`, each with a `-subtle` 12%-alpha background. Always paired with an icon or text label — never color alone.

### Named Rules
**The Signal Rule.** Brand orange is reserved for meaning — active state, required attention, primary action, brand identity. The moment it becomes ambient background it stops signaling and the product loses a primary affordance. Default data color is white/zinc; orange enters only when the UI has something to say.

**The Token Rule.** Never hardcode a hex value in JSX. Every color flows through the CSS custom properties in `app/globals.css` and the Tailwind theme; if a token is missing, add it to the token layer first. The one sanctioned exception is brand `#f97316` in non-CSS contexts (e.g. Discord embed `color` integers) that can't read a CSS variable.

## 3. Typography

**Display / Body / Label Font:** Inter (via `next/font/google`, exposed as `var(--font-inter)`), falling back to `system-ui, -apple-system, sans-serif`.
**Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`.

**Character:** One family, Inter, does the work across display, body, and labels — hierarchy comes from scale and weight contrast, not a second typeface. Mono is reserved for code, IDs, and dense data. This single-family discipline keeps the panel technical and undecorated.

### Hierarchy
- **Display** (600, `clamp(1.75rem, 4vw, 2.5rem)`, line-height ~1.1, letter-spacing −0.02em): page and section heroes. Restrained — no shouting clamp maxes.
- **Body** (400, `0.875rem` / 14px, line-height ~1.6): the operational workhorse size. Cap prose at 65–75ch.
- **Label / Meta** (600, `0.6875rem` / 11px, UPPERCASE, letter-spacing 0.14em, Text Tertiary): the recurring meta-label motif — card headers and eyebrows like "DECISION INTERCEPTION DEMO".
- **Mono / Data** (400, ~`0.8125rem` / 13px): code blocks, IDs (`act_…`, `sn_…`), and any column that benefits from `font-variant-numeric: tabular-nums`.

### Named Rules
**The Tabular Rule.** Any column of numbers uses `.tabular-nums` so figures align and don't jitter as values update live.

**The One-Family Rule.** Inter carries display, body, and label. Reach for weight and size contrast before a second face; mono is the only other family, and only for code and data.

## 4. Elevation

DashClaw is **flat by default**. Depth is conveyed almost entirely through 1px translucent-white borders and a border-color lift on hover — not drop shadows. A surface at rest is a near-black plane with a `rgba(255,255,255,0.06)` hairline; on hover the hairline brightens to `0.12`. This keeps the panel calm and avoids the chunky-shadow look of a 2014 app.

### Shadow Vocabulary (rare, structural only)
- **Hero ring** (`box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 30px 90px rgba(0,0,0,0.55)`): reserved for genuine hero cards / focal moments — an inset hairline plus a deep soft shadow, never a hard drop shadow.
- **Drag lift** (`box-shadow: 0 8px 32px rgba(0,0,0,0.4)`): only while a dashboard tile is actively being dragged.

### Named Rules
**The Border-Not-Shadow Rule.** Surfaces respond to state by shifting border-color, not by casting a shadow. If you're reaching for a `box-shadow` to separate two resting surfaces, use a border and a darker background instead.

## 5. Components

### Cards (the atom)
- **Shape:** 12px radius (`rounded-xl`).
- **Background / Border:** Surface Secondary (`#111`) with a 1px `border` hairline.
- **Hover:** `border-color` lifts to Border Hover (`transition-colors duration-150`); no shadow, no scale.
- **Focus:** the whole card is focusable (`tabIndex=0`, `outline-none`) and relies on the global `:focus-visible` brand ring.
- **Header:** a 14px lucide icon + an 11px UPPERCASE wide-tracked Tertiary label, with an optional count pill (`rounded-full bg-brand/10 text-brand tabular-nums`).
- **Never nest a card inside a card.**

### Buttons
- **Shape:** 8px radius (`rounded-lg`), `text-sm`, `transition-colors`, `disabled:opacity-60`.
- **Ghost-brand (default primary):** `border border-brand/20 bg-brand/10 text-brand`, hover `bg-brand/15 border-brand/40`. The most common emphasis — orange text on a 10% orange tint, high-contrast on the dark canvas.
- **Solid brand (top CTA only):** `bg-brand text-white`, hover `bg-brand-hover`. Reserve for the single most important action on a surface.
- **Hover / Focus:** color/tint shift only; the global brand ring handles `:focus-visible`.

### Inputs / Fields
- **Style:** Surface Tertiary (`#1a1a1a`) background, 1px `border`, 8px radius, `text-sm`, white text.
- **Focus:** border shifts to `brand/50` with `focus:outline-none` — the border carries the focus signal.
- **Select / option:** option lists render on Surface Elevated (`#222`).

### Badges / Chips
- **Style:** an inline pill, 1px border, `xs` / `sm` sizes, semantic variant (`success` / `warning` / `error` / `info` / `brand` / `default`) using the `-subtle` background + the matching solid text color + a `/20` border. Always pairs a color with a word — never color alone.

### Iconography
- **lucide-react only.** 14–20px inline, 24–28px for hero moments. Never mix icon libraries.

### Signature — the live decision stream
Approvals' live stream is the one surface where motion is sanctioned. New decisions animate in; brand orange marks the items that need attention. Everything else stays still — the motion *is* the signal.

## 6. Do's and Don'ts

### Do:
- **Do** use the CSS tokens in `app/globals.css` / the Tailwind theme for every color, and add a token before using a new value.
- **Do** reserve brand orange (`#f97316`) for meaning — active state, required attention, primary action, brand identity — and keep it to a few elements per screen.
- **Do** convey depth with 1px translucent-white borders and border-color lift; keep surfaces flat at rest.
- **Do** put `.tabular-nums` on every column of numbers.
- **Do** carry hierarchy with Inter weight + size contrast and whitespace.
- **Do** pair every status color with an icon or text label, and keep `:focus-visible` rings visible (the global brand ring).
- **Do** honor `prefers-reduced-motion` (handled globally) and reserve motion for genuinely live events.

### Don't:
- **Don't** ship anything mistakable for the four anti-references: **generic SaaS** (flat blue, Bootstrap cards), **consumer-AI** (gradients, emoji, chat bubbles, pastel, "AI sparkle"), **heavy-enterprise** (gray-on-gray, no personality), or **crypto/web3** (neon gradients, glassmorphism, glow spam).
- **Don't** let brand orange become an ambient background, a hero-wash, or a gradient. Its rarity is the affordance.
- **Don't** hardcode hex in JSX (the one exception: brand orange in non-CSS contexts like Discord embed integers).
- **Don't** add a light-mode variant without explicit product approval — DashClaw is dark-only.
- **Don't** separate two resting surfaces with a drop shadow; use a border and a darker background.
- **Don't** darken Text Tertiary below `#808088` — it sits at the 4.6:1 AA floor on canvas.
- **Don't** nest cards, and don't mix icon libraries (lucide-react only).
