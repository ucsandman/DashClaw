/**
 * Security scanning utility for detecting sensitive data.
 * Ported from outbound_filter for use in API routes.
 */

interface SecurityPattern {
  name: string;
  pattern: RegExp;
  category: string;
  severity: 'critical' | 'high';
}

interface ScanFinding {
  pattern: string;
  category: string;
  severity: string;
  preview: string;
}

interface ScanResult {
  findings: ScanFinding[];
  redacted: string;
  clean: boolean;
}

export const SECURITY_PATTERNS: SecurityPattern[] = [
  { name: 'api_key_generic', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{16,})['"]?/gi, category: 'api_key', severity: 'critical' },
  { name: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/g, category: 'cloud_credential', severity: 'critical' },
  { name: 'aws_secret_key', pattern: /(?:aws)?[_-]?secret[_-]?(?:access)?[_-]?key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi, category: 'cloud_credential', severity: 'critical' },
  { name: 'github_token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, category: 'token', severity: 'critical' },
  { name: 'openai_key', pattern: /sk-[A-Za-z0-9]{20,}/g, category: 'api_key', severity: 'critical' },
  { name: 'anthropic_key', pattern: /sk-ant-[A-Za-z0-9_\-]{20,}/g, category: 'api_key', severity: 'critical' },
  { name: 'stripe_key', pattern: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}/g, category: 'api_key', severity: 'critical' },
  { name: 'slack_token', pattern: /xox[bpsar]-[A-Za-z0-9\-]{10,}/g, category: 'token', severity: 'critical' },
  { name: 'jwt_token', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, category: 'token', severity: 'high' },
  { name: 'private_key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, category: 'private_key', severity: 'critical' },
  { name: 'password_field', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{6,})['"]?/gi, category: 'password', severity: 'high' },
  { name: 'bearer_token', pattern: /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g, category: 'token', severity: 'high' },
  { name: 'database_url', pattern: /(?:postgres|mysql|mongodb|redis):\/\/[^\s'"]{10,}/gi, category: 'connection_string', severity: 'critical' },
  // An explicit user:password allows URI sub-delimiters in the password
  // and single-label hosts. Keep the stricter token-only alternative so
  // comma/semicolon-joined contact addresses are not treated as secrets.
  { name: 'url_userinfo', pattern: /[A-Za-z][A-Za-z0-9+.\-]{0,19}:\/\/(?:[^\/:\s@'"?&,;#]+:[^\/\s@'"?#]*@(?=[A-Za-z0-9\[])|[^\/\s@'"?&,;#]+@(?=(?:[A-Za-z0-9\-]+\.)+[A-Za-z0-9\-]+|localhost\b|\[))/g, category: 'url_credential', severity: 'critical' },
  // The host after the @ must look like one (a dotted name, localhost, an
  // IPv4, or a bracketed IPv6): "10:30@HQ" and "3:4@scale" are prose, not
  // credentials, and with DASHCLAW_AUTOSCAN_BLOCK on a critical false
  // positive here blocks the action outright. Non-credential URI schemes
  // (mailto:, tel:, sms:, callto:, xmpp:, news:) are excluded too: a
  // "mailto:" link is a contact address, not a leaked secret, and agent
  // content routinely carries them (email bodies, Messaging acts). The
  // lookbehind before the user half also excludes ":", and the user half
  // must either look non-numeric or pair with an 8+ char secret half:
  // without that, a clock/timestamp reads as a credential ("09:30@zoom.us",
  // "2026-09-05T02:04:04@server.example.com" - the digits-and-":" prefix
  // before the final "HH:MM@host" would otherwise pass as "user:pass@host").
  { name: 'bare_userinfo', pattern: /(?<![A-Za-z0-9_.%+\-\/:])(?:(?!\d[\d\-T]*:)[^\s:/@'"]+(?<!\b(?:mailto|tel|sms|callto|xmpp|news)):[^\s/@'"]+|[^\s:/@'"]+(?<!\b(?:mailto|tel|sms|callto|xmpp|news)):[^\s/@'"]{8,})@(?=(?:[A-Za-z0-9\-]+\.)+[A-Za-z0-9\-]+|localhost\b|\[)/g, category: 'url_credential', severity: 'critical' },
  // No bare "key" or "sig" alternatives: they match ordinary query params
  // like "?key=widget" or "?sig=asc" that carry no secret. "signature" and
  // "api_key"/"apikey" stay since those spellings are credential-specific.
  { name: 'url_query_secret', pattern: /(?<=[?&#])(?:access[_-]?token|auth[_-]?token|token|bearer|api[_-]?key|password|passwd|secret|signature|session(?:id)?|cookie|credential)=[^&#\s'"]+/gi, category: 'url_credential', severity: 'high' },
];

/**
 * Recursively redacts sensitive data from any value (string, array, or object).
 * Strings are scanned with scanSensitiveData; nested structures are walked.
 * @param value - The value to redact.
 * @param findings - Accumulator array; push-appended with any findings.
 * @returns The redacted value (same shape as input).
 */
export function redactAny(value: unknown, findings: unknown[]): unknown {
  if (typeof value === 'string') {
    const scan = scanSensitiveData(value);
    if (!scan.clean) findings.push(...scan.findings);
    return scan.redacted;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactAny(v, findings));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
    return out;
  }
  return value;
}

/**
 * Scans text for sensitive data.
 */
export function scanSensitiveData(text: unknown): ScanResult {
  if (!text || typeof text !== 'string') {
    return { findings: [], redacted: text as string, clean: true };
  }

  const findings: ScanFinding[] = [];
  // Ranges already claimed by an earlier (higher-priority) pattern. Only a
  // match fully CONTAINED within an already-claimed span is skipped (e.g.
  // url_userinfo re-matching the userinfo inside a database_url connection
  // string, a strict subset) — that's a re-detection of text already
  // redacted, not a second finding. A match that merely overlaps but extends
  // beyond the claim (e.g. bearer_token wrapping an already-claimed
  // jwt_token) is a distinct finding in its own right and is kept, even
  // though the redaction it would perform is a no-op (the wrapped text is
  // already gone from `redacted`).
  const claimed: Array<[number, number]> = [];
  let redacted = text;

  for (const { name, pattern, category, severity } of SECURITY_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const full = match[0];
      if (full === undefined) break;
      const start = match.index;
      const end = start + full.length;
      if (claimed.some(([s, e]) => start >= s && end <= e)) continue;
      claimed.push([start, end]);
      findings.push({ pattern: name, category, severity, preview: full.substring(0, 8) + '***' });
      redacted = redacted.replace(full, `[REDACTED:${name}]`);
    }
  }

  return { findings, redacted, clean: findings.length === 0 };
}
