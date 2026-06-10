/**
 * Guard: the compliance framework LIST can never drift from the framework
 * definition FILES again. The old hardcoded lists shipped 'eu-ai-act' (no
 * JSON on disk → exports emitted "Framework not found. Skipping." inside
 * generated reports) and omitted 'imda-agentic' (which exists). Both compliance
 * pages now derive their lists from app/lib/compliance/framework-labels.ts,
 * and this test pins that map to the files on disk in both directions.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAMEWORK_LABELS } from '../../app/lib/compliance/framework-labels';

const ROOT = path.resolve(__dirname, '..', '..');
const FRAMEWORKS_DIR = path.join(ROOT, 'app', 'lib', 'compliance', 'frameworks');

function frameworkIdsOnDisk() {
  return readdirSync(FRAMEWORKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

describe('compliance framework list ↔ files drift guard', () => {
  it('FRAMEWORK_LABELS keys exactly match the framework JSONs on disk', () => {
    expect(Object.keys(FRAMEWORK_LABELS).sort()).toEqual(frameworkIdsOnDisk());
  });

  it('neither compliance page hardcodes a framework id list anymore', () => {
    const page = readFileSync(path.join(ROOT, 'app', 'compliance', 'page.tsx'), 'utf8');
    const exportsPage = readFileSync(path.join(ROOT, 'app', 'compliance', 'exports', 'page.tsx'), 'utf8');

    // The phantom framework must not reappear anywhere in the compliance UI.
    expect(page).not.toContain('eu-ai-act');
    expect(exportsPage).not.toContain('eu-ai-act');

    // Both pages must read the drift-guarded label map instead of local consts.
    expect(page).toContain("from '../lib/compliance/framework-labels'");
    expect(exportsPage).toContain("from '../../lib/compliance/framework-labels'");
  });

  it('every framework JSON parses and declares the id its filename promises', () => {
    for (const id of frameworkIdsOnDisk()) {
      const parsed = JSON.parse(readFileSync(path.join(FRAMEWORKS_DIR, `${id}.json`), 'utf8'));
      expect(parsed.id ?? id).toBe(id);
      expect(Array.isArray(parsed.controls)).toBe(true);
    }
  });
});
