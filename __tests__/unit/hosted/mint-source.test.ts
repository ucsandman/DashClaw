// v6.4 reach attribution: the mint-source sanitizer/resolver
// (spec docs/superpowers/specs/2026-07-05-reach-attribution-v64.md).
import { describe, it, expect } from 'vitest';
import { resolveMintSource } from '../../../app/lib/hosted/mint-source';

const OWN_HOST = 'hosted.dashclaw.io';

describe('resolveMintSource', () => {
  it('utm_source wins over referrer and is normalized', () => {
    const r = resolveMintSource(
      { utm_source: 'Awesome MCP Servers!', referrer: 'https://reddit.com/r/mcp' },
      OWN_HOST,
    );
    expect(r.source).toBe('awesome-mcp-servers');
    expect(r.raw).toEqual({ utm_source: 'Awesome MCP Servers!', referrer: 'https://reddit.com/r/mcp' });
  });

  it('falls back to referrer host, www-stripped', () => {
    expect(resolveMintSource({ referrer: 'https://www.reddit.com/r/mcp/comments/x' }, OWN_HOST).source)
      .toBe('reddit.com');
  });

  it('own-host referrer is not a channel → direct', () => {
    expect(resolveMintSource({ referrer: `https://${OWN_HOST}/` }, OWN_HOST).source).toBe('direct');
    expect(resolveMintSource({ referrer: `https://www.${OWN_HOST}/x` }, OWN_HOST).source).toBe('direct');
  });

  it('no input, junk input, or non-http referrer → direct with honest raw', () => {
    expect(resolveMintSource(undefined, OWN_HOST)).toEqual({ source: 'direct', raw: null });
    expect(resolveMintSource('not-an-object', OWN_HOST)).toEqual({ source: 'direct', raw: null });
    expect(resolveMintSource({ referrer: 'javascript:alert(1)' }, OWN_HOST).source).toBe('direct');
    expect(resolveMintSource({ referrer: 'not a url' }, OWN_HOST).source).toBe('direct');
  });

  it('caps field length, drops unknown keys and non-strings', () => {
    const r = resolveMintSource(
      { utm_source: 'x'.repeat(500), evil: 'dropped', utm_medium: 42 },
      OWN_HOST,
    );
    expect(r.raw!.utm_source!.length).toBe(300);
    expect(r.source.length).toBeLessThanOrEqual(64);
    expect(r.raw).not.toHaveProperty('evil');
    expect(r.raw).not.toHaveProperty('utm_medium');
  });

  it('utm_source that normalizes to nothing falls through to referrer', () => {
    expect(resolveMintSource({ utm_source: '!!!', referrer: 'https://news.ycombinator.com/item' }, OWN_HOST).source)
      .toBe('news.ycombinator.com');
  });
  it("reserves 'drill' for server-forced drill mints — client claims are remapped (v8.3 security review)", () => {
    expect(resolveMintSource({ utm_source: 'drill' }, OWN_HOST).source).toBe('drill-claimed');
    expect(resolveMintSource({ utm_source: 'DRILL' }, OWN_HOST).source).toBe('drill-claimed');
    expect(resolveMintSource({ referrer: 'https://drill/' }, OWN_HOST).source).toBe('drill-claimed');
  });
});
