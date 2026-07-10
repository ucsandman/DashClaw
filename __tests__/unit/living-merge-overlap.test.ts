import { describe, it, expect } from 'vitest';
import {
  computeAuthoredOverlap,
  renderOverlapSignal,
  type WorktreeState,
} from '../../scripts/living-merge/overlap';

const TS = '2026-06-06T00:00:00.000Z';
function wt(path: string, branch: string, files: string[]): WorktreeState {
  return { worktreePath: path, branch, changedFiles: files, updatedAt: TS };
}

describe('computeAuthoredOverlap', () => {
  it('reports an intersection for a shared AUTHORED file', () => {
    const others = [wt('/wt/b', 'feat-b', ['app/api/guard/route.ts', 'README.md'])];
    const hits = computeAuthoredOverlap(['app/api/guard/route.ts', 'app/foo.ts'], others, '/wt/a');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sharedAuthoredFiles).toEqual(['app/api/guard/route.ts']);
    expect(hits[0]!.branch).toBe('feat-b');
  });

  it('reports NOTHING when the only shared file is GENERATED', () => {
    const shared = 'public/downloads/dashclaw-governance.zip';
    const others = [wt('/wt/b', 'feat-b', [shared, 'docs/api-inventory.json'])];
    const hits = computeAuthoredOverlap([shared, 'docs/api-inventory.md'], others, '/wt/a');
    expect(hits).toHaveLength(0);
  });

  it('filters generated files but still flags a co-edited authored file', () => {
    const others = [wt('/wt/b', 'feat-b', ['docs/api-inventory.json', 'middleware.js'])];
    const hits = computeAuthoredOverlap(['docs/api-inventory.json', 'middleware.js'], others, '/wt/a');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sharedAuthoredFiles).toEqual(['middleware.js']); // api-inventory.json filtered out
  });

  it("excludes the session's own worktree", () => {
    const others = [wt('/wt/a', 'feat-a', ['middleware.js'])];
    expect(computeAuthoredOverlap(['middleware.js'], others, '/wt/a')).toHaveLength(0);
  });

  it('handles multiple other worktrees, generated-only ones stay silent', () => {
    const others = [
      wt('/wt/b', 'feat-b', ['middleware.js']),
      wt('/wt/c', 'feat-c', ['app/api/guard/route.ts']),
      wt('/wt/d', 'feat-d', ['docs/api-inventory.json']), // generated only -> no hit
    ];
    const hits = computeAuthoredOverlap(['middleware.js', 'app/api/guard/route.ts'], others, '/wt/a');
    expect(hits.map((h) => h.branch).sort()).toEqual(['feat-b', 'feat-c']);
  });
});

describe('renderOverlapSignal', () => {
  it('is empty when there are no hits (silent for generated-only overlap)', () => {
    expect(renderOverlapSignal([])).toBe('');
  });
  it('renders factual text naming the worktree, branch, and files', () => {
    const text = renderOverlapSignal([
      { worktreePath: '/wt/b', branch: 'feat-b', sharedAuthoredFiles: ['middleware.js'] },
    ]);
    expect(text).toContain('/wt/b');
    expect(text).toContain('feat-b');
    expect(text).toContain('middleware.js');
    expect(text.toLowerCase()).toContain('facts'); // phrased as facts, not instructions
  });
});
