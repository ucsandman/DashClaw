import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The static explainer (public/explain/index.html) hand-mirrors PublicNavbar.
// This test is the drift tripwire: if the navbar's links, order, or labels
// change without the mirror being updated, it fails (that drift shipped once:
// the mirror was missing "Proof" and still said "Mission Control").

const root = process.cwd();
const navbarSrc = readFileSync(path.join(root, 'app/components/PublicNavbar.tsx'), 'utf8');
const explainHtml = readFileSync(path.join(root, 'public/explain/index.html'), 'utf8');

// Desktop links + CTA blocks of the React navbar (brand link precedes this slice,
// the mobile overlay duplicates follow it).
const navbarSection = navbarSrc.slice(
  navbarSrc.indexOf('hidden sm:flex'),
  navbarSrc.indexOf('{/* Mobile overlay */}'),
);

// The static explainer's mirrored main nav (its brand link is filtered below).
const mainnavSection = explainHtml.slice(
  explainHtml.indexOf('<nav class="mainnav"'),
  explainHtml.indexOf('</nav>'),
);

function hrefs(src) {
  return [...src.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h !== '/');
}

function labelFor(src, href) {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = src.match(new RegExp(`href="${escaped}"[^>]*>\\s*([A-Za-z][A-Za-z ]*)`));
  return m ? m[1].trim() : null;
}

describe('explain page main nav mirrors PublicNavbar', () => {
  it('found both nav sections', () => {
    expect(navbarSection.length).toBeGreaterThan(0);
    expect(mainnavSection.length).toBeGreaterThan(0);
  });

  it('has the same links in the same order', () => {
    expect(hrefs(mainnavSection)).toEqual(hrefs(navbarSection));
  });

  it('uses the same label for every internal link', () => {
    const internal = hrefs(navbarSection).filter((h) => h.startsWith('/'));
    expect(internal.length).toBeGreaterThan(0);
    for (const href of internal) {
      expect(labelFor(mainnavSection, href), `label for ${href}`).toBe(labelFor(navbarSection, href));
    }
  });
});
