/** @type {import('tailwindcss').Config} */
// Force reload after file move

// Theme tokens are CSS custom properties, which Tailwind cannot parse into
// channels — so it silently dropped any opacity modifier written against them.
// `bg-brand/10`, `border-status-success/20` and friends compiled to ZERO CSS and
// the element just fell back to whatever it inherited. Function-valued colors are
// the one form Tailwind hands the modifier to directly (see `withAlphaValue`), so
// we compose it with `color-mix()` and keep the custom property intact.
//
// When no modifier is present Tailwind passes its own `var(--tw-*-opacity, 1)`
// placeholder; we return the bare custom property in that case, so every
// modifier-free utility emits exactly the CSS it always has. (The legacy
// `bg-opacity-*` utilities are unused here and were already inert against these
// tokens, so nothing depends on that placeholder.)
const token = (name) => {
  const value = `var(${name})`
  return ({ opacityValue } = {}) =>
    opacityValue === undefined || String(opacityValue).startsWith('var(')
      ? value
      : `color-mix(in srgb, ${value} calc(${opacityValue} * 100%), transparent)`
}

module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: token('--color-brand'),
          subtle: token('--color-brand-subtle'),
          hover: token('--color-brand-hover'),
        },
        surface: {
          primary: token('--color-bg-primary'),
          secondary: token('--color-bg-secondary'),
          tertiary: token('--color-bg-tertiary'),
          elevated: token('--color-bg-elevated'),
        },
        border: {
          DEFAULT: token('--color-border'),
          hover: token('--color-border-hover'),
          active: token('--color-border-active'),
        },
        text: {
          primary: token('--color-text-primary'),
          secondary: token('--color-text-secondary'),
          tertiary: token('--color-text-tertiary'),
          disabled: token('--color-text-disabled'),
        },
        status: {
          success: token('--color-success'),
          warning: token('--color-warning'),
          error: token('--color-error'),
          info: token('--color-info'),
          'success-subtle': token('--color-success-subtle'),
          'warning-subtle': token('--color-warning-subtle'),
          'error-subtle': token('--color-error-subtle'),
          'info-subtle': token('--color-info-subtle'),
        },
      },
      // Ergonomic single-prefix aliases. `colors.text.primary` above generates
      // `text-text-primary`; these add the cleaner `text-primary` / `bg-secondary`
      // / `border-active` forms so we can wean components off `text-zinc-*`
      // without losing the existing `text-text-primary` callsites.
      textColor: {
        primary: token('--color-text-primary'),
        secondary: token('--color-text-secondary'),
        tertiary: token('--color-text-tertiary'),
        disabled: token('--color-text-disabled'),
        success: token('--color-success'),
        warning: token('--color-warning'),
        error: token('--color-error'),
        info: token('--color-info'),
      },
      backgroundColor: {
        primary: token('--color-bg-primary'),
        secondary: token('--color-bg-secondary'),
        tertiary: token('--color-bg-tertiary'),
        elevated: token('--color-bg-elevated'),
        // Status aliases, matching `textColor` above. Without these, `bg-success`
        // and `border-error` were never in the scale at all and compiled to
        // nothing — a separate failure from the modifier one, and a silent one,
        // since only the longer `bg-status-success` form ever resolved.
        success: token('--color-success'),
        warning: token('--color-warning'),
        error: token('--color-error'),
        info: token('--color-info'),
        'success-subtle': token('--color-success-subtle'),
        'warning-subtle': token('--color-warning-subtle'),
        'error-subtle': token('--color-error-subtle'),
        'info-subtle': token('--color-info-subtle'),
      },
      borderColor: {
        DEFAULT: token('--color-border'),
        hover: token('--color-border-hover'),
        active: token('--color-border-active'),
        success: token('--color-success'),
        warning: token('--color-warning'),
        error: token('--color-error'),
        info: token('--color-info'),
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      // Type-scale floor. The product leans on `text-xs`/`text-sm` for the bulk of
      // its body and label copy; Tailwind's stock 12px/14px read as cramped on a
      // dense dark UI. Nudge the small steps up (with a touch more leading for air)
      // so everyday copy is comfortably readable. Larger steps keep their defaults.
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.125rem' }], // 13px (was 12px)
        sm: ['0.9375rem', { lineHeight: '1.375rem' }], // 15px (was 14px)
        base: ['1rem', { lineHeight: '1.5rem' }], // 16px
      },
    },
  },
  plugins: [],
}
