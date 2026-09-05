import { describe, it, expect } from 'vitest';
import { scanSensitiveData, SECURITY_PATTERNS } from '@/lib/security.js';

const TEST_AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const TEST_GITHUB_TOKEN = ['ghp', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl'].join('_');
const TEST_SLACK_TOKEN = ['xoxb', '1234567890', 'abcdefghij'].join('-');
const TEST_JWT = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
].join('.');
const TEST_PRIVATE_KEY_BLOCK = ['-----BEGIN RSA ', 'PRIVATE KEY-----', '\nMIIEpAIBAAKCAQ...'].join('');
const TEST_DATABASE_URL = `postgres://${['user', 'pass'].join(':')}@host:5432/dbname`;

describe('scanSensitiveData', () => {
  // --- Clean input ---

  it('returns clean for normal text', () => {
    const result = scanSensitiveData('Hello world, this is a normal message.');
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.redacted).toBe('Hello world, this is a normal message.');
  });

  it('returns clean for null input', () => {
    const result = scanSensitiveData(null);
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns clean for empty string', () => {
    const result = scanSensitiveData('');
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns clean for non-string input', () => {
    const result = scanSensitiveData(42);
    expect(result.clean).toBe(true);
  });

  // --- Generic API key ---

  it('detects generic API key', () => {
    const result = scanSensitiveData('api_key=sk_test_1234567890abcdef');
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'api_key_generic')).toBe(true);
    expect(result.redacted).toContain('[REDACTED:api_key_generic]');
  });

  // --- OpenAI key ---

  it('detects OpenAI key', () => {
    const result = scanSensitiveData('Using key sk-abcdefghijklmnopqrstuvwx');
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'openai_key')).toBe(true);
    expect(result.findings.find(f => f.pattern === 'openai_key').severity).toBe('critical');
  });

  // --- Anthropic key ---

  it('detects Anthropic key', () => {
    const result = scanSensitiveData('sk-ant-api03-abcdefghijklmnopqrst');
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'anthropic_key')).toBe(true);
  });

  // --- Stripe key ---

  it('detects Stripe live key', () => {
    // Build key via concatenation to avoid GitHub push protection false positive
    const stripeKey = ['sk', 'live', '00TESTKEY00FAKE000000000'].join('_');
    const result = scanSensitiveData(stripeKey);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'stripe_key')).toBe(true);
  });

  // --- AWS access key ---

  it('detects AWS access key', () => {
    const result = scanSensitiveData(TEST_AWS_KEY);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'aws_access_key')).toBe(true);
    expect(result.findings.find(f => f.pattern === 'aws_access_key').category).toBe('cloud_credential');
  });

  // --- AWS secret key ---

  it('detects AWS secret key', () => {
    const result = scanSensitiveData('aws_secret_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'aws_secret_key')).toBe(true);
  });

  // --- GitHub token ---

  it('detects GitHub personal access token', () => {
    const result = scanSensitiveData(TEST_GITHUB_TOKEN);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'github_token')).toBe(true);
  });

  // --- Slack token ---

  it('detects Slack token', () => {
    const result = scanSensitiveData(TEST_SLACK_TOKEN);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'slack_token')).toBe(true);
  });

  // --- JWT ---

  it('detects JWT token', () => {
    const result = scanSensitiveData(TEST_JWT);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'jwt_token')).toBe(true);
    expect(result.findings.find(f => f.pattern === 'jwt_token').severity).toBe('high');
  });

  // --- Bearer token ---

  it('detects Bearer token', () => {
    const result = scanSensitiveData('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0');
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'bearer_token')).toBe(true);
  });

  // --- Private key ---

  it('detects private key header', () => {
    const result = scanSensitiveData(TEST_PRIVATE_KEY_BLOCK);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'private_key')).toBe(true);
    expect(result.findings.find(f => f.pattern === 'private_key').category).toBe('private_key');
  });

  // --- Password field ---

  it('detects password field', () => {
    const result = scanSensitiveData('password="supersecret123"');
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'password_field')).toBe(true);
    expect(result.findings.find(f => f.pattern === 'password_field').severity).toBe('high');
  });

  // --- Database URL ---

  it('detects database URL', () => {
    const result = scanSensitiveData(TEST_DATABASE_URL);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'database_url')).toBe(true);
    expect(result.findings.find(f => f.pattern === 'database_url').category).toBe('connection_string');
  });

  // --- Redaction ---

  it('redacts matched secrets from text', () => {
    const result = scanSensitiveData(`key is ${TEST_AWS_KEY}, done`);
    expect(result.redacted).toContain('[REDACTED:aws_access_key]');
    expect(result.redacted).not.toContain(TEST_AWS_KEY);
    expect(result.redacted).toContain(', done');
  });

  // --- Multiple secrets ---

  it('detects multiple secrets in one text', () => {
    const text = `API: ${TEST_AWS_KEY} and password="hunter2secret"`;
    const result = scanSensitiveData(text);
    expect(result.clean).toBe(false);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
  });

  // --- Preview truncation ---

  it('truncates preview in findings', () => {
    const result = scanSensitiveData(TEST_AWS_KEY);
    const finding = result.findings.find(f => f.pattern === 'aws_access_key');
    expect(finding.preview.length).toBeLessThanOrEqual(11); // 8 chars + '***'
    expect(finding.preview).toContain('***');
  });

  // --- URL-embedded credentials ---

  it('detects credentials embedded in a URL (scheme://user:pass@host)', () => {
    const result = scanSensitiveData(`fetching ${['https://user', 'hunter2secret'].join(':')}@host.example.com/api`);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'url_userinfo')).toBe(true);
    expect(result.redacted).toContain('[REDACTED:url_userinfo]');
    expect(result.redacted).not.toContain('hunter2secret');
    expect(result.redacted).toContain('host.example.com/api');
  });

  it('detects bare userinfo without a URL scheme (user:token@host)', () => {
    const result = scanSensitiveData(`connect via ${['svc', 'abcd1234tok'].join(':')}@internal.example.com`);
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'bare_userinfo')).toBe(true);
    expect(result.redacted).toContain('[REDACTED:bare_userinfo]');
    expect(result.redacted).not.toContain('abcd1234tok');
  });

  it('detects secrets in URL query parameters (?token=, ?api_key=)', () => {
    const result = scanSensitiveData('https://api.example.com/data?api_key=abc123XYZ&user=1');
    expect(result.clean).toBe(false);
    expect(result.findings.some(f => f.pattern === 'url_query_secret')).toBe(true);
    expect(result.redacted).toContain('[REDACTED:url_query_secret]');
    expect(result.redacted).not.toContain('abc123XYZ');
    expect(result.redacted).toContain('&user=1');
  });

  it('leaves a normal URL with a port untouched', () => {
    const result = scanSensitiveData('https://api.example.com:8443/status?foo=bar');
    expect(result.clean).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.redacted).toBe('https://api.example.com:8443/status?foo=bar');
  });

  it('does not read "time@place" or "ratio@scale" prose as bare userinfo', () => {
    for (const text of ['meeting 10:30@HQ tomorrow', 'ratio 3:4@scale', 'mail me at wes@example.com']) {
      const result = scanSensitiveData(text);
      expect(result.findings.map((f) => f.pattern)).not.toContain('bare_userinfo');
      expect(result.redacted).toBe(text);
    }
  });

  it('still detects bare userinfo in front of localhost and an IPv4 host', () => {
    for (const text of [`db ${['admin', 'pw12345'].join(':')}@localhost:5432`, `${['u', 'p'].join(':')}@10.0.0.7/x`]) {
      const result = scanSensitiveData(text);
      expect(result.findings.some((f) => f.pattern === 'bare_userinfo')).toBe(true);
    }
  });

  it('does not treat a mailto: link as bare userinfo credentials', () => {
    for (const text of ['mailto:wes@example.com', '[email me](mailto:wes@example.com)']) {
      const result = scanSensitiveData(text);
      expect(result.findings.map((f) => f.pattern)).not.toContain('bare_userinfo');
      expect(result.redacted).toBe(text);
    }
  });

  it('does not swallow a query string as url_userinfo when the host has no path', () => {
    const result = scanSensitiveData('https://example.com?email=a@b.com');
    expect(result.findings.some((f) => f.pattern === 'url_userinfo')).toBe(false);
    expect(result.redacted).toBe('https://example.com?email=a@b.com');
  });

  it('does not double-count a connection string as both database_url and url_userinfo', () => {
    const result = scanSensitiveData(TEST_DATABASE_URL);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].pattern).toBe('database_url');
  });

  // --- F1: url_userinfo must not match a comma/semicolon/hash-delimited address ---

  it('does not treat a comma/semicolon/hash-delimited address as url_userinfo', () => {
    for (const text of [
      'https://example.com,wes@example.com',
      'https://example.com#contact-wes@example.com',
      'https://site.com;ops@team.example.com',
    ]) {
      const result = scanSensitiveData(text);
      expect(result.findings.map((f) => f.pattern)).not.toContain('url_userinfo');
      expect(result.redacted).toBe(text);
    }
  });

  it('still redacts a real scheme://user:pass@host credential', () => {
    const result = scanSensitiveData(`fetching ${['https://user', 'pass'].join(':')}@host.example.com/x`);
    expect(result.findings.some((f) => f.pattern === 'url_userinfo')).toBe(true);
    expect(result.redacted).toContain('[REDACTED:url_userinfo]');
  });

  // --- F2: bare_userinfo must not match a time-like "HH:MM@place" prose fragment ---

  it('does not read a time-like "HH:MM@place" fragment as bare userinfo', () => {
    for (const text of [
      'standup 09:30@zoom.us',
      'sync 2:00@meet.google.com',
      '2026-09-05T02:04:04@server.example.com ok',
    ]) {
      const result = scanSensitiveData(text);
      expect(result.findings.map((f) => f.pattern)).not.toContain('bare_userinfo');
      expect(result.redacted).toBe(text);
    }
  });

  it('still redacts a real deploy:token@host bare credential', () => {
    const result = scanSensitiveData(`${['deploy', 's3cr3tT0ken'].join(':')}@db.internal.example.com`);
    expect(result.findings.some((f) => f.pattern === 'bare_userinfo')).toBe(true);
    expect(result.redacted).toContain('[REDACTED:bare_userinfo]');
  });

  // --- F3: url_query_secret must not match bare key= / sig= ---

  it('does not treat a bare key= or sig= query param as url_query_secret', () => {
    for (const text of [
      'https://example.com/search?key=widget&page=2',
      'GET /v1/items?sig=asc&limit=10',
    ]) {
      const result = scanSensitiveData(text);
      expect(result.findings.map((f) => f.pattern)).not.toContain('url_query_secret');
      expect(result.redacted).toBe(text);
    }
  });

  it('still redacts a real api_key= query param', () => {
    // api_key_generic claims this exact span first (16+ char value), which is
    // fine — the secret is still detected and redacted, just under a
    // different pre-existing pattern name than url_query_secret.
    const result = scanSensitiveData('?api_key=abcdef1234567890abcdef');
    expect(result.clean).toBe(false);
    expect(result.redacted).not.toContain('abcdef1234567890abcdef');
  });

  // --- F4: overlapping spans of DIFFERENT categories must both be reported ---

  it('reports both bearer_token and jwt_token when their spans overlap', () => {
    const result = scanSensitiveData(`Authorization: Bearer ${TEST_JWT}`);
    const patterns = result.findings.map((f) => f.pattern);
    expect(patterns).toContain('bearer_token');
    expect(patterns).toContain('jwt_token');
  });
});
