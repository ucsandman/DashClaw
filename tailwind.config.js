/** @type {import('tailwindcss').Config} */
// Force reload after file move
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
          DEFAULT: 'var(--color-brand)',
          subtle: 'var(--color-brand-subtle)',
          hover: 'var(--color-brand-hover)',
        },
        surface: {
          primary: 'var(--color-bg-primary)',
          secondary: 'var(--color-bg-secondary)',
          tertiary: 'var(--color-bg-tertiary)',
          elevated: 'var(--color-bg-elevated)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          hover: 'var(--color-border-hover)',
          active: 'var(--color-border-active)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
          disabled: 'var(--color-text-disabled)',
        },
        status: {
          success: 'var(--color-success)',
          warning: 'var(--color-warning)',
          error: 'var(--color-error)',
          info: 'var(--color-info)',
          'success-subtle': 'var(--color-success-subtle)',
          'warning-subtle': 'var(--color-warning-subtle)',
          'error-subtle': 'var(--color-error-subtle)',
          'info-subtle': 'var(--color-info-subtle)',
        },
      },
      // Ergonomic single-prefix aliases. `colors.text.primary` above generates
      // `text-text-primary`; these add the cleaner `text-primary` / `bg-secondary`
      // / `border-active` forms so we can wean components off `text-zinc-*`
      // without losing the existing `text-text-primary` callsites.
      textColor: {
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        tertiary: 'var(--color-text-tertiary)',
        disabled: 'var(--color-text-disabled)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        info: 'var(--color-info)',
      },
      backgroundColor: {
        primary: 'var(--color-bg-primary)',
        secondary: 'var(--color-bg-secondary)',
        tertiary: 'var(--color-bg-tertiary)',
        elevated: 'var(--color-bg-elevated)',
        'success-subtle': 'var(--color-success-subtle)',
        'warning-subtle': 'var(--color-warning-subtle)',
        'error-subtle': 'var(--color-error-subtle)',
        'info-subtle': 'var(--color-info-subtle)',
      },
      borderColor: {
        DEFAULT: 'var(--color-border)',
        hover: 'var(--color-border-hover)',
        active: 'var(--color-border-active)',
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
