import { describe, it, expect } from 'vitest';
import { describeFile } from '@/lib/plain-language/files';

describe('describeFile', () => {
  it('describes a Write without claiming whether the file already existed', () => {
    const out = describeFile('Write', 'app/api/billing/route.ts');
    expect(out.confidence).toBe('high');
    expect(out.headline).toBe('Creates or replaces a file in your project.');
    expect(out.detail).toBe('app/api/billing/route.ts');
  });

  it('describes an Edit as a change to an existing file', () => {
    const out = describeFile('Edit', 'app/page.tsx');
    expect(out.headline).toBe('Changes an existing file in your project.');
  });

  it('warns when the file holds credentials', () => {
    const out = describeFile('Write', '.env.local', { sensitive_path: true });
    expect(out.warnings.join(' ')).toContain('credentials');
  });

  it('warns when the file is outside the project folder', () => {
    const out = describeFile('Write', '/etc/hosts', { outside_workspace: true });
    expect(out.warnings.join(' ')).toContain('outside your project folder');
  });

  it('warns on path traversal', () => {
    const out = describeFile('Write', '../../secrets', { traversal_detected: true });
    expect(out.warnings.join(' ')).toContain('outside the folder it named');
  });

  it('stacks every warning that applies, worst first', () => {
    const out = describeFile('Write', '../../.env', { sensitive_path: true, traversal_detected: true, outside_workspace: true });
    expect(out.warnings).toHaveLength(3);
    expect(out.warnings[0]).toContain('credentials');
  });

  it('returns unknown for an unrecognised file tool', () => {
    expect(describeFile('Frobnicate', 'x.txt').confidence).toBe('unknown');
  });

  it('returns unknown when the hook could not resolve a path', () => {
    expect(describeFile('Write', 'unknown').confidence).toBe('unknown');
  });
});
