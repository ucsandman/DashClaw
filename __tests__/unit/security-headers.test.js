/**
 * Security regression tests for the per-response addSecurityHeaders helper
 * (middleware.js → app/lib/security-headers.js) and for the static Next.js
 * security header rules emitted from next.config.js → app/lib/next-config-headers.cjs.
 *
 * Both modules were extracted specifically so this test imports the same
 * code production runs, instead of mirroring an inlined copy that silently
 * drifts from the real implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addSecurityHeaders } from '../../app/lib/security-headers.js';
import { buildSecurityHeaderRules } from '../../app/lib/next-config-headers.cjs';

function makeTestResponse() {
  const store = new Map();
  return {
    headers: {
      set: (k, v) => store.set(k.toLowerCase(), v),
      get: (k) => store.get(k.toLowerCase()),
      delete: (k) => store.delete(k.toLowerCase()),
      has: (k) => store.has(k.toLowerCase()),
    },
  };
}

function makeTestRequest(pathname) {
  return { nextUrl: { pathname } };
}

function findHeader(rules, key) {
  return rules[0].headers.find((h) => h.key === key);
}

describe('addSecurityHeaders (per-response, from middleware.js)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('public replay route', () => {
    it('removes X-Frame-Options and sets permissive CSP frame-ancestors', () => {
      const response = makeTestResponse();
      addSecurityHeaders(response, makeTestRequest('/replay/abc123'));
      expect(response.headers.has('X-Frame-Options')).toBe(false);
      expect(response.headers.get('Content-Security-Policy')).toBe('frame-ancestors *;');
    });
  });

  describe('non-replay routes', () => {
    it('sets X-Frame-Options to DENY', () => {
      const response = makeTestResponse();
      addSecurityHeaders(response, makeTestRequest('/api/guard'));
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('does not set permissive Content-Security-Policy', () => {
      const response = makeTestResponse();
      addSecurityHeaders(response, makeTestRequest('/api/guard'));
      expect(response.headers.get('Content-Security-Policy')).toBeUndefined();
    });
  });

  describe('always-on headers', () => {
    it('sets X-Content-Type-Options to nosniff', () => {
      const response = makeTestResponse();
      addSecurityHeaders(response, makeTestRequest('/api/guard'));
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('sets X-XSS-Protection', () => {
      const response = makeTestResponse();
      addSecurityHeaders(response, makeTestRequest('/api/guard'));
      expect(response.headers.get('X-XSS-Protection')).toBe('1; mode=block');
    });
  });

  describe('HSTS gating on NODE_ENV', () => {
    it('sets HSTS in production', () => {
      process.env.NODE_ENV = 'production';
      const response = makeTestResponse();
      addSecurityHeaders(response, makeTestRequest('/api/guard'));
      expect(response.headers.get('Strict-Transport-Security')).toBe(
        'max-age=63072000; includeSubDomains; preload',
      );
    });

    it('omits HSTS outside production', () => {
      process.env.NODE_ENV = 'development';
      const response = makeTestResponse();
      addSecurityHeaders(response, makeTestRequest('/api/guard'));
      expect(response.headers.has('Strict-Transport-Security')).toBe(false);
    });
  });

  describe('null/undefined request safety', () => {
    it('does not throw when request is undefined', () => {
      const response = makeTestResponse();
      expect(() => addSecurityHeaders(response)).not.toThrow();
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('does not throw when request.nextUrl is missing', () => {
      const response = makeTestResponse();
      expect(() => addSecurityHeaders(response, {})).not.toThrow();
    });
  });
});

describe('buildSecurityHeaderRules (static, from next.config.js)', () => {
  describe('LAN self-host (plain HTTP)', () => {
    it('CSP omits upgrade-insecure-requests', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'http://192.168.1.50:3000' });
      const csp = findHeader(rules, 'Content-Security-Policy').value;
      expect(csp).not.toContain('upgrade-insecure-requests');
      expect(csp).not.toContain('block-all-mixed-content');
    });

    it('does not include HSTS (would lock operator out of plain-HTTP host)', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'http://192.168.1.50:3000' });
      expect(findHeader(rules, 'Strict-Transport-Security')).toBeUndefined();
    });
  });

  describe('TLS-terminated deployment (https)', () => {
    it('CSP includes upgrade-insecure-requests', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'https://dashclaw.example.com' });
      const csp = findHeader(rules, 'Content-Security-Policy').value;
      expect(csp).toContain('upgrade-insecure-requests');
      expect(csp).toContain('block-all-mixed-content');
    });

    it('includes HSTS', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'https://dashclaw.example.com' });
      expect(findHeader(rules, 'Strict-Transport-Security').value).toBe(
        'max-age=63072000; includeSubDomains; preload',
      );
    });
  });

  describe('always-on rules', () => {
    it('always sets X-Frame-Options to DENY', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'https://example.com' });
      expect(findHeader(rules, 'X-Frame-Options').value).toBe('DENY');
    });

    it('always sets Referrer-Policy', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'http://localhost:3000' });
      expect(findHeader(rules, 'Referrer-Policy').value).toBe('strict-origin-when-cross-origin');
    });

    it('always sets Permissions-Policy that disables camera/mic/geo', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'http://localhost:3000' });
      expect(findHeader(rules, 'Permissions-Policy').value).toContain('camera=()');
      expect(findHeader(rules, 'Permissions-Policy').value).toContain('microphone=()');
      expect(findHeader(rules, 'Permissions-Policy').value).toContain('geolocation=()');
    });

    it('CSP forbids inline event handlers (script-src-attr none)', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'https://example.com' });
      const csp = findHeader(rules, 'Content-Security-Policy').value;
      expect(csp).toContain("script-src-attr 'none'");
    });

    it('CSP allows Cloudflare Turnstile (hosted-trial mint widget)', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'https://example.com' });
      const csp = findHeader(rules, 'Content-Security-Policy').value;
      const directives = Object.fromEntries(csp.split(';').map((d) => {
        const [name, ...rest] = d.trim().split(' ');
        return [name, rest.join(' ')];
      }));
      expect(directives['script-src']).toContain('https://challenges.cloudflare.com');
      expect(directives['frame-src']).toContain('https://challenges.cloudflare.com');
    });

    it('CSP forbids object-src and base-uri', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'https://example.com' });
      const csp = findHeader(rules, 'Content-Security-Policy').value;
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
    });
  });

  describe('dev vs production', () => {
    it('dev mode CSP allows unsafe-eval (for hot reload)', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'http://localhost:3000', nodeEnv: 'development' });
      const csp = findHeader(rules, 'Content-Security-Policy').value;
      expect(csp).toContain("'unsafe-eval'");
    });

    it('production CSP forbids unsafe-eval', () => {
      const rules = buildSecurityHeaderRules({ nextauthUrl: 'https://example.com', nodeEnv: 'production' });
      const csp = findHeader(rules, 'Content-Security-Policy').value;
      expect(csp).not.toContain("'unsafe-eval'");
    });
  });
});
