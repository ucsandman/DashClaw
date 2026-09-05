import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { collectTrackedMarkdownFiles } from '../../scripts/lib/docs-validator.mjs';

describe('collectTrackedMarkdownFiles', () => {
  it('returns only tracked markdown files', async () => {
    const root = path.resolve('/repo');
    const execFile = vi.fn().mockResolvedValue({
      stdout: [
        'README.md',
        'docs/guide.md',
        'notes/todo.txt',
        'graphify-pilot/README.md',
      ].join('\n'),
    });

    const files = await collectTrackedMarkdownFiles({ root, execFile, fileExists: async () => true });

    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
      expect.objectContaining({ cwd: root }),
    );
    expect(files).toEqual([
      path.join(root, 'README.md'),
      path.join(root, 'docs/guide.md'),
    ]);
  });

  it('excludes generated and system directories even if git reports them', async () => {
    const root = path.resolve('/repo');
    const execFile = vi.fn().mockResolvedValue({
      stdout: [
        '.git/HEAD.md',
        '.next/build.md',
        '.vercel/output.md',
        'node_modules/pkg/README.md',
        'docs/real.md',
      ].join('\n'),
    });

    const files = await collectTrackedMarkdownFiles({ root, execFile, fileExists: async () => true });

    expect(files).toEqual([
      path.join(root, 'docs/real.md'),
    ]);
  });

  it('includes nonignored untracked markdown and excludes tracked files deleted from disk', async () => {
    const root = path.resolve('/repo');
    const execFile = vi.fn().mockResolvedValue({
      stdout: [
        'README.md',
        '.claude/skills/old/SKILL.md',
        'docs/new-untracked.md',
      ].join('\n'),
    });
    const fileExists = vi.fn(async (file) => !file.endsWith(path.join('old', 'SKILL.md')));

    const files = await collectTrackedMarkdownFiles({ root, execFile, fileExists });

    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
      expect.objectContaining({ cwd: root }),
    );
    expect(files).toEqual([
      path.join(root, 'README.md'),
      path.join(root, 'docs/new-untracked.md'),
    ]);
  });
});
