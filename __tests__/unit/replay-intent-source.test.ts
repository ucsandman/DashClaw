import { describe, it, expect } from 'vitest';
import { actExcerpt } from '../../app/replay/[actionId]/page';

// Evidence-first guard (v4.63.0, spec §7): the replay page's "Intent source"
// row shows a redacted excerpt of the act a caller attached to guard. This
// pins the kind-specific excerpt selection + truncation, independent of the
// full page render (fetch/useParams wiring is exercised via frontend-verify).
describe('actExcerpt', () => {
  it('returns null when no act is present (declared-only decision)', () => {
    expect(actExcerpt(null)).toBeNull();
    expect(actExcerpt(undefined)).toBeNull();
  });

  it('shell: excerpts the command', () => {
    expect(actExcerpt({ kind: 'shell', command: 'rm -rf /prod-data' })).toBe('rm -rf /prod-data');
  });

  it('http: excerpts method + url', () => {
    expect(actExcerpt({ kind: 'http', request: { method: 'POST', url: 'https://api.example.com/charge' } }))
      .toBe('POST https://api.example.com/charge');
  });

  it('sql: excerpts the statement', () => {
    expect(actExcerpt({ kind: 'sql', statement: 'DELETE FROM users' })).toBe('DELETE FROM users');
  });

  it('file: excerpts the path', () => {
    expect(actExcerpt({ kind: 'file', file: { path: '/etc/secrets/.env' } })).toBe('/etc/secrets/.env');
  });

  it('truncates a long excerpt for on-page readability', () => {
    const long = 'x'.repeat(200);
    const out = actExcerpt({ kind: 'shell', command: long });
    expect(out).toHaveLength(121); // 120 chars + ellipsis
    expect(out?.endsWith('…')).toBe(true);
  });

  it('returns null when the kind-specific payload field is missing', () => {
    expect(actExcerpt({ kind: 'http' })).toBeNull();
  });
});
