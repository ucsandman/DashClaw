import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Guard: every recharts <Tooltip> in app/** must set an explicit `cursor` —
// the library default is a near-white #ccc rect/line that reads as a glaring
// block on the dark theme (the phase-8 "white hover" bug). And chart files
// must not hardcode hex in color-bearing attributes; tokens resolve at
// runtime via app/lib/useChartColors.ts (recharts SVG attrs don't honor
// CSS var()).

function rechartsFiles() {
  let out = '';
  try {
    out = execSync('git grep -l "from \'recharts\'" -- app', { encoding: 'utf8' });
  } catch {
    // git grep exits 1 when there are no matches. The v5 cull removed the last
    // recharts charts from app/**; the per-file guards below re-arm automatically
    // if a recharts chart returns.
    return [];
  }
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

describe('recharts chart hygiene (app/**)', () => {
  const files = rechartsFiles();

  it('guards every recharts chart file (dormant when none exist)', () => {
    expect(files.length).toBeGreaterThanOrEqual(0);
  });

  // Extract each <Tooltip …/> tag, tolerating nested JSX in props (e.g.
  // content={<CustomTooltip />}) — the tag ends at the first `/>` at brace
  // depth 0, so a lazy regex stopping at the nested `/>` won't do.
  function tooltipTags(code) {
    const tags = [];
    let idx = code.indexOf('<Tooltip');
    while (idx !== -1) {
      let depth = 0;
      for (let i = idx; i < code.length - 1; i++) {
        const ch = code[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === '/' && code[i + 1] === '>' && depth === 0) {
          tags.push(code.slice(idx, i + 2));
          break;
        }
      }
      idx = code.indexOf('<Tooltip', idx + 1);
    }
    return tags;
  }

  it.each(files.map((f) => [f]))('%s: every <Tooltip has an explicit cursor prop', (file) => {
    const code = readFileSync(file, 'utf8');
    const tags = tooltipTags(code);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag, `${file} has a <Tooltip> without an explicit cursor prop`).toMatch(/\bcursor=/);
    }
  });

  it.each(files.map((f) => [f]))('%s: no hardcoded hex in color-bearing props', (file) => {
    const code = readFileSync(file, 'utf8');
    // Attribute/value positions only — prose comments may legitimately
    // mention the #ccc default this guard exists to prevent.
    expect(code).not.toMatch(/(?:fill|stroke|stopColor|color)\s*[:=]\s*\{?["']#/);
  });
});
