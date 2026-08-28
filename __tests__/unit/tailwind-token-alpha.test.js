// __tests__/unit/tailwind-token-alpha.test.js
//
// Theme tokens resolve to CSS custom properties, which Tailwind cannot parse into
// channels. While the token values were plain `var(--color-*)` strings, every
// utility written with an opacity modifier — `bg-brand/10`, `border-status-success/20`
// — compiled to ZERO CSS and the element silently fell back to whatever it
// inherited. It shipped that way and was only caught by eye in a live instance
// (a button with `border-success/20` rendering the default white 8% border).
//
// Nothing in lint, typecheck, the build, or the rest of the suite notices a class
// that produces no rule, so this test is the only thing standing between a config
// refactor and that whole failure mode coming back silently.
import { describe, it, expect, beforeAll } from 'vitest';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import config from '../../tailwind.config.js';

// Utilities are only emitted for classes Tailwind finds in `content`, so drive it
// from a raw string rather than the repo globs — this pins behaviour, not usage.
async function compile(classes) {
  const { css } = await postcss([
    tailwindcss({ ...config, content: [{ raw: classes.join('\n'), extension: 'html' }] }),
  ]).process('@tailwind utilities;', { from: undefined });
  return css;
}

// Tailwind escapes `/` in the selector, so `.bg-brand/10` is written `.bg-brand\/10`.
const selectorFor = (cls) => '.' + cls.replace(/[\\./]/g, (m) => '\\' + m);

const emitted = (css, cls) => {
  const sel = selectorFor(cls);
  return css.includes(`${sel} `) || css.includes(`${sel},`) || css.includes(`${sel}{`) || css.includes(`${sel}:`);
};

// One per utility family that reads a token scale, since each resolves its colours
// from a different key (`colors`, `textColor`, `backgroundColor`, `borderColor`).
const WITH_MODIFIER = [
  'bg-brand/10',
  'bg-brand-subtle/40',
  'bg-surface-primary/90',
  'bg-status-success/10',
  'bg-error/10',
  'border-brand/40',
  'border-success/20',
  'border-error/30',
  'border-status-warning/40',
  'border-active/20',
  'text-brand/70',
  'text-success/80',
  'text-text-tertiary/50',
  'ring-brand/20',
  'from-brand/20',
  'shadow-brand/20',
];

// The single-prefix status aliases. `textColor` always had these; `backgroundColor`
// and `borderColor` did not, so `border-success` was dead even without a modifier.
const ALIASES = [
  'text-success', 'text-warning', 'text-error', 'text-info',
  'bg-success', 'bg-warning', 'bg-error', 'bg-info',
  'border-success', 'border-warning', 'border-error', 'border-info',
];

// Modifier-free utilities must keep emitting exactly what they always did.
const UNMODIFIED = ['bg-brand', 'text-secondary', 'border-border', 'border-hover', 'bg-success-subtle'];

describe('tailwind theme tokens', () => {
  let css;
  beforeAll(async () => {
    css = await compile([...WITH_MODIFIER, ...ALIASES, ...UNMODIFIED]);
  }, 30_000);

  it.each(WITH_MODIFIER)('emits CSS for %s', (cls) => {
    expect(emitted(css, cls), `${cls} compiled to no CSS`).toBe(true);
  });

  it.each(ALIASES)('resolves the single-prefix alias %s', (cls) => {
    expect(emitted(css, cls), `${cls} is not in that utility's colour scale`).toBe(true);
  });

  it.each(UNMODIFIED)('still emits CSS for %s', (cls) => {
    expect(emitted(css, cls)).toBe(true);
  });

  it('applies the authored opacity rather than dropping it', async () => {
    const rule = css.match(/\.bg-brand\\\/10\s*{[^}]*}/)?.[0];
    expect(rule).toBeTruthy();
    // The modifier has to reach the output; `0.1` is what `/10` means.
    expect(rule).toMatch(/0?\.1/);
    expect(rule).toContain('var(--color-brand)');
  });

  it('keeps a modifier-free utility free of any opacity maths', () => {
    const rule = css.match(/\.bg-brand\s*{[^}]*}/)?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toContain('var(--color-brand)');
    expect(rule).not.toContain('color-mix');
  });
});
