/**
 * Server-side evidence classifier: grades the actual act (shell / http / sql /
 * file) a caller attaches to a guard request, so risk is derived from what will
 * run — not only from self-declared descriptors. Pure and synchronous (no I/O),
 * unit-testable in isolation. The reference for the shell families is
 * hooks/dashclaw_agent_intel/bash_classifier.py, and the intent→action_type
 * mapping mirrors hooks/dashclaw_pretool.py's _INTENT_TO_ACTION so policies
 * behave consistently across surfaces.
 */

export type ActKind = 'shell' | 'http' | 'sql' | 'file';

/** Wire shape of the optional `act` payload (validated in app/lib/validate.js). */
export interface ActInput {
  kind?: unknown;
  command?: unknown;
  request?: { method?: unknown; url?: unknown; body_excerpt?: unknown };
  statement?: unknown;
  file?: { path?: unknown; content_excerpt?: unknown; bytes?: unknown };
  [field: string]: unknown;
}

export interface EvidenceModifier {
  reason: string;
  delta: number;
}

export interface EvidenceClassification {
  derived_action_type: string;
  base_risk: number;
  modifiers: EvidenceModifier[];
  reversible_hint: boolean | null;
  flags: string[];
}

const clamp = (n: number): number => Math.max(0, Math.min(Math.round(n), 100));

/** base_risk + Σ modifiers, clamped 0-100 — the evidence-derived risk total. */
export function evidenceTotal(c: EvidenceClassification): number {
  return clamp(c.base_risk + c.modifiers.reduce((s, m) => s + m.delta, 0));
}

// Sensitive file / path patterns (mirrors bash_classifier.SENSITIVE_PATTERNS).
const SENSITIVE_PATH_RE = /(\.env\b|secret|credential|private_key|\.pem\b|id_rsa|\.key\b)/i;
const CI_CONFIG_RE = /(\.github\/workflows|\.gitlab-ci|dockerfile|vercel\.json|\.circleci|jenkinsfile|\.deploy)/i;

// ── shell ──────────────────────────────────────────────────────────────────

function classifyShellSegment(seg: string): EvidenceClassification {
  const s = seg.toLowerCase();
  const flags: string[] = [];
  const modifiers: EvidenceModifier[] = [];
  let base = 30;
  let action = 'other';
  let reversible: boolean | null = null;

  const isSudo = /^\s*sudo\b/.test(s);

  if (/\brm\s+-\S*r|\bshred\b|\bmkfs(\.|\b)|\bdd\b|\btruncate\b/.test(s)) {
    base = 80; action = 'security'; reversible = false; flags.push('destructive');
  } else if (/\bgit\s+push\b[^&|;]*(--force\b|--force-with-lease\b|(^|\s)-f\b)|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-\S*f/.test(s)) {
    base = 70; action = 'security'; reversible = false; flags.push('vcs_dangerous');
  } else if (/\bvercel\b[^&|;]*--prod|\bkubectl\s+apply\b|\bterraform\s+(apply|destroy)\b/.test(s)) {
    base = 75; action = 'deploy'; flags.push('deploy');
  } else if (/\b(npm|pnpm|yarn)\s+(i\b|install\b|add\b)|\bpip3?\s+install\b|\bpipx\s+install\b|\b(gem|cargo|go|brew|apt|apt-get|dnf|yum)\s+install\b/.test(s)) {
    base = 30; action = 'build'; flags.push('package');
  } else if (/(^|\s)(env|printenv)(\s|$)|\bcat\s+[^&|;]*(\.env\b|id_rsa|\.pem\b|secret)/.test(s)) {
    base = 40; action = 'security'; flags.push('secret_exposure');
  } else if (/^\s*(cat|ls|head|tail|grep|rg|find|stat|pwd|whoami|echo|which|wc|diff|file)\b|^\s*git\s+(status|log|diff|show|branch|remote)\b/.test(s)) {
    base = 5; action = 'review'; reversible = true;
  } else if (/^\s*(cp|mv|mkdir|touch|chmod|chown|ln|tee|write)\b|\bsed\s+-i|^\s*git\s+(add|commit|checkout|switch|restore|merge|pull|fetch)\b/.test(s)) {
    base = 35; action = 'apply';
  }

  if (SENSITIVE_PATH_RE.test(s) && !flags.includes('secret_exposure')) {
    modifiers.push({ reason: 'sensitive path referenced', delta: 15 });
    flags.push('sensitive_path');
  }

  if (isSudo) {
    if (base < 75) {
      base = 75;
      if (action === 'other' || action === 'review' || action === 'apply') action = 'deploy';
    }
    if (!flags.includes('privilege')) flags.push('privilege');
  }

  return { derived_action_type: action, base_risk: base, modifiers, reversible_hint: reversible, flags };
}

function classifyShell(command: string): EvidenceClassification {
  // Pipe-to-shell is destroyed by chain-splitting, so detect it on the whole
  // command first: `curl … | sh` / `wget … | bash` executes remote code.
  if (/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|python[0-9]?|node)\b/i.test(command)) {
    return { derived_action_type: 'security', base_risk: 70, modifiers: [], reversible_hint: false, flags: ['remote_exec'] };
  }
  // Chain-split on &&, ;, ||, | and classify the highest-risk segment.
  const segments = command.split(/&&|\|\||;|\|/).map((p) => p.trim()).filter(Boolean);
  const parts = segments.length ? segments : [command];
  return parts.map(classifyShellSegment).reduce((a, b) => (evidenceTotal(b) >= evidenceTotal(a) ? b : a));
}

// ── http ───────────────────────────────────────────────────────────────────

const HTTP_METHOD_BASE: Record<string, number> = {
  GET: 10, HEAD: 10, OPTIONS: 10, POST: 45, PUT: 45, PATCH: 45, DELETE: 65,
};

// Payment / cloud-admin / package-registry hosts warrant a bump.
const SENSITIVE_HOST_RE = /(^|\.)(stripe\.com|paypal\.com|braintreegateway\.com|amazonaws\.com|googleapis\.com|azure\.com|windows\.net|cloudflare\.com|digitalocean\.com|vercel\.com|netlify\.com|npmjs\.(com|org)|pypi\.org|rubygems\.org)$/i;
const LOCAL_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|::1|\[::1\])/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    const m = url.match(/^[a-z]+:\/\/([^/:?#]+)/i) || url.match(/^([^/:?#]+)/);
    return m && m[1] ? m[1].toLowerCase() : '';
  }
}

function classifyHttp(act: ActInput): EvidenceClassification {
  const req = act.request ?? {};
  const method = (typeof req.method === 'string' ? req.method : 'GET').toUpperCase();
  const url = typeof req.url === 'string' ? req.url : '';
  const base = HTTP_METHOD_BASE[method] ?? 45;
  const modifiers: EvidenceModifier[] = [];
  const flags: string[] = [];
  const host = hostOf(url);
  if (host && SENSITIVE_HOST_RE.test(host)) {
    modifiers.push({ reason: `sensitive host ${host}`, delta: 20 });
    flags.push('sensitive_host');
  } else if (host && LOCAL_HOST_RE.test(host)) {
    modifiers.push({ reason: 'localhost target', delta: -10 });
  }
  return {
    derived_action_type: 'api',
    base_risk: base,
    modifiers,
    reversible_hint: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? true : null,
    flags,
  };
}

// ── sql ────────────────────────────────────────────────────────────────────

function classifySql(act: ActInput): EvidenceClassification {
  const stmt = typeof act.statement === 'string' ? act.statement : '';
  const s = stmt.trim().toLowerCase();
  const modifiers: EvidenceModifier[] = [];
  const flags: string[] = [];
  let base = 35;
  let action = 'apply';
  let reversible: boolean | null = null;

  if (/^select\b/.test(s)) {
    base = 10; action = 'review'; reversible = true;
  } else if (/^insert\b/.test(s)) {
    base = 35; action = 'apply';
  } else if (/^update\b/.test(s)) {
    base = 45; action = 'apply';
  } else if (/^delete\b/.test(s)) {
    base = 60; action = 'security'; reversible = false;
  } else if (/^(drop|truncate|alter|create)\b/.test(s)) {
    base = 75; action = 'migrate'; reversible = false; flags.push('ddl');
  }

  if (/^(update|delete)\b/.test(s) && !/\bwhere\b/.test(s)) {
    modifiers.push({ reason: 'UPDATE/DELETE without WHERE', delta: 20 });
    flags.push('whereless');
  }

  return { derived_action_type: action, base_risk: base, modifiers, reversible_hint: reversible, flags };
}

// ── file ───────────────────────────────────────────────────────────────────

function classifyFile(act: ActInput): EvidenceClassification {
  const f = act.file ?? {};
  const path = typeof f.path === 'string' ? f.path : '';
  const modifiers: EvidenceModifier[] = [];
  const flags: string[] = [];
  if (SENSITIVE_PATH_RE.test(path)) {
    modifiers.push({ reason: `sensitive path ${path}`, delta: 20 });
    flags.push('sensitive_path');
  }
  if (CI_CONFIG_RE.test(path)) {
    modifiers.push({ reason: 'CI / deploy config write', delta: 15 });
    flags.push('ci_config');
  }
  return { derived_action_type: 'apply', base_risk: 35, modifiers, reversible_hint: null, flags };
}

/**
 * Classify a caller-attached act, or return null when there is no gradeable
 * evidence (absent / malformed / empty payload). Never throws.
 */
export function classifyAct(act: unknown): EvidenceClassification | null {
  if (!act || typeof act !== 'object' || Array.isArray(act)) return null;
  const a = act as ActInput;
  switch (a.kind) {
    case 'shell':
      return typeof a.command === 'string' && a.command.trim() ? classifyShell(a.command) : null;
    case 'http':
      return a.request && typeof a.request === 'object' && typeof a.request.url === 'string' && a.request.url
        ? classifyHttp(a)
        : null;
    case 'sql':
      return typeof a.statement === 'string' && a.statement.trim() ? classifySql(a) : null;
    case 'file':
      return a.file && typeof a.file === 'object' && typeof a.file.path === 'string' && a.file.path
        ? classifyFile(a)
        : null;
    default:
      return null;
  }
}
