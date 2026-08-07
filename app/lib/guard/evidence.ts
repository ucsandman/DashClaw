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

// ── path-aware rm grading (F5, governance gap audit 2026-08-05) ─────────────
// The risk model was target-blind: `rm -rf node_modules` graded identically to
// `rm -rf /c/Users/<user>` (both security/80, folding to a 100 block). A
// safety system that blocks routine artifact cleanup trains the operator to
// turn it off — alarm fatigue is how governance actually dies. Mirrors the
// hook classifier (bash_classifier.py _REGENERABLE_ARTIFACT_DIRS /
// is_regenerable_artifact_rm): the name list is deliberately conservative
// (dot-dirs and unambiguous outputs only — no `build`/`out`/`target`, too
// often real content), and ANY glob, absolute path, traversal, or unknown
// name disqualifies the whole command.
const REGENERABLE_ARTIFACT_DIRS = new Set([
  '.next', '.turbo', '.cache', '.parcel-cache', 'dist', 'coverage',
  'node_modules', '__pycache__', '.pytest_cache', '.nuxt', '.svelte-kit',
]);

// Recursive delete forms this grading applies to. Remove-Item rides the same
// shell path as Bash (the hook forwards PowerShell as kind:'shell') and was
// previously invisible to the destructive branch entirely.
const RM_RECURSIVE_RE = /\brm\s+-\S*r|\bremove-item\b[^&|;]*\s-\S*rec/i;

// ── F2 coverage backlog (governance gap audit 2026-08-05) ───────────────────
// Destructive shapes the rm-centric patterns missed. `find -delete` /
// `find -exec rm` is a mass delete wearing a read-only command's name; an
// interpreter one-liner reaches the same filesystem APIs without any shell
// delete verb; and a redirect or dd onto a raw block device destroys a disk
// without naming a file at all.
const FIND_DELETE_RE = /\bfind\b[^&|;]*(\s-delete\b|\s-exec\s+(\S*\/)?(rm|shred)\b)/i;
const INTERPRETER_DESTRUCTIVE_RE =
  /\b(python[0-9]?|node(?:js)?|ruby|perl|php|deno|bun|tsx|ts-node)\b[^&|;]*(shutil\.rmtree|os\.(remove|unlink|rmdir)|fs\.(rm|rmdir|unlink)|rmsync|unlinksync|rimraf)/i;
// Whole-command variant: the quoted payload legitimately contains `;` and `|`
// (`python -c "import shutil; shutil.rmtree(…)"`), so the segment-safe bridge
// above can never span it — this one runs before chain-splitting instead.
const INTERPRETER_DESTRUCTIVE_FULL_RE =
  /\b(python[0-9]?|node(?:js)?|ruby|perl|php|deno|bun|tsx|ts-node)\b[^\n]*(shutil\.rmtree|os\.(remove|unlink|rmdir)|fs\.(rm|rmdir|unlink)|rmsync|unlinksync|rimraf)/i;
// Raw block devices (Linux sd/hd/nvme/mmcblk/vd/xvd, macOS disk, Windows
// PhysicalDrive) reached via output redirect or dd's of=.
const DEVICE_WRITE_RE =
  /(>\s*|\bof=)("|')?(\/dev\/(sd[a-z]|hd[a-z]|nvme\d+(?:n\d+)?(?:p\d+)?|disk\d+|mmcblk\d+|vd[a-z]|xvd[a-z])\b|\\\\\.\\physicaldrive\d+)/i;

/** Path arguments of a find command: tokens after `find` up to the first predicate/flag. */
function findRootTargets(segment: string): string[] {
  const tokens = segment.trim().split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ''));
  const idx = tokens.findIndex((t) => /^(?:\S*\/)?find$/i.test(t));
  if (idx === -1) return [];
  const roots: string[] = [];
  for (const t of tokens.slice(idx + 1)) {
    if (!t || t.startsWith('-') || t.startsWith('!') || t.startsWith('(')) break;
    roots.push(t);
  }
  return roots;
}

/** Non-flag tokens after the rm / Remove-Item command word, unquoted. */
function rmDeleteTargets(segment: string): string[] {
  const tokens = segment.trim().split(/\s+/).map((t) => t.replace(/^["']|["']$/g, ''));
  const idx = tokens.findIndex((t) => /^(?:\S*\/)?rm$/i.test(t) || /^remove-item$/i.test(t));
  if (idx === -1) return [];
  return tokens.slice(idx + 1).filter((t) => t && !t.startsWith('-'));
}

function isRegenerableArtifactTarget(target: string): boolean {
  if (/[*?[]/.test(target)) return false;
  let t = target.replace(/\\/g, '/').replace(/\/+$/, '');
  if (t.startsWith('./')) t = t.slice(2);
  return REGENERABLE_ARTIFACT_DIRS.has(t.toLowerCase());
}

// The catastrophic-root class: filesystem/drive roots, home and user-profile
// roots, and core system trees. Deliberately roots-only — deeper paths keep
// the ordinary destructive grade (80) rather than over-escalating routine
// temp-dir cleanup under a profile.
function isProtectedRootTarget(target: string): boolean {
  let t = target.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!t) return target.includes('/'); // `rm -rf /` normalizes to '' — root
  if (t === '~' || t === '$home' || t === '${home}' || t === '%userprofile%') return true;
  if (/^[a-z]:$/.test(t)) return true;               // drive root C:
  if (/^\/[a-z]$/.test(t)) return true;              // git-bash drive root /c
  t = t.replace(/^[a-z]:/, '');                      // strip drive for the tree checks
  if (t === '' || t === '/') return true;
  if (/^\/(c\/)?(users|home)\/[^/]+$/.test(t)) return true;  // profile/home root
  if (t === '/root') return true;
  if (/^\/(windows|winnt|etc|usr|bin|sbin|boot|system32|program files( \(x86\))?)($|\/)/.test(t)) return true;
  return false;
}

// ── shell ──────────────────────────────────────────────────────────────────

function classifyShellSegment(seg: string): EvidenceClassification {
  // `env` as a launcher prefix (`env -u TOKEN cmd`, `env VAR=x cmd`) is
  // transparent — classify the command it runs. A BARE `env` (nothing after
  // the flags) is left intact for the secret-exposure branch below: that form
  // dumps the environment.
  const s = seg.toLowerCase().replace(/^\s*env((\s+-u\s+\S+)|(\s+-[i0]\b)|(\s+\w+=\S*))*\s+(?=\S)/, '');
  const flags: string[] = [];
  const modifiers: EvidenceModifier[] = [];
  let base = 30;
  let action = 'other';
  let reversible: boolean | null = null;

  const isSudo = /^\s*sudo\b/.test(s);

  const deviceWrite = DEVICE_WRITE_RE.test(s);
  if (RM_RECURSIVE_RE.test(s) || /\bshred\b|\bmkfs(\.|\b)|\bdd\b|\btruncate\b/.test(s)
      || FIND_DELETE_RE.test(s) || INTERPRETER_DESTRUCTIVE_RE.test(s) || deviceWrite) {
    base = 80; action = 'security'; reversible = false; flags.push('destructive');
    if (INTERPRETER_DESTRUCTIVE_RE.test(s)) flags.push('interpreter_destructive');
    // Path-aware grading (F5) for the rm / Remove-Item and find -delete
    // classes only — shred / mkfs / dd / interpreter payloads never
    // de-escalate. Every target a bare regenerable artifact name → routine
    // cleanup; any catastrophic-root target → escalate so the evidence alone
    // reaches the block band regardless of soft declarations. A raw-device
    // write is always the catastrophic case: the "target" is the disk itself.
    if (deviceWrite) {
      modifiers.push({ reason: 'raw block device write target', delta: 20 });
      flags.push('device_write', 'protected_target');
    } else if (RM_RECURSIVE_RE.test(s)) {
      const targets = rmDeleteTargets(s);
      if (targets.length > 0 && targets.every(isRegenerableArtifactTarget)) {
        base = 45; action = 'cleanup'; flags.push('regenerable_artifact');
      } else if (targets.some(isProtectedRootTarget)) {
        modifiers.push({ reason: 'protected root/home/system delete target', delta: 20 });
        flags.push('protected_target');
      }
    } else if (FIND_DELETE_RE.test(s)) {
      const roots = findRootTargets(s);
      if (roots.length > 0 && roots.every(isRegenerableArtifactTarget)) {
        base = 45; action = 'cleanup'; flags.push('regenerable_artifact');
      } else if (roots.some(isProtectedRootTarget)) {
        modifiers.push({ reason: 'protected root/home/system delete target', delta: 20 });
        flags.push('protected_target');
      }
    }
  } else if (/\bgit\s+push\b[^&|;]*(--force\b|--force-with-lease\b|(^|\s)-f\b)|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-\S*f/.test(s)) {
    base = 70; action = 'security'; reversible = false; flags.push('vcs_dangerous');
  } else if (/\bvercel\b[^&|;]*--prod|\bkubectl\s+apply\b|\bterraform\s+(apply|destroy)\b/.test(s)) {
    base = 75; action = 'deploy'; flags.push('deploy');
  } else if (/\b(npm|pnpm|yarn)\s+(i\b|install\b|add\b)|\bpip3?\s+install\b|\bpipx\s+install\b|\b(gem|cargo|go|brew|apt|apt-get|dnf|yum)\s+install\b/.test(s)) {
    base = 30; action = 'build'; flags.push('package');
  } else if (/(^|\s)printenv(\s|$)|(^|\s)env(\s+-[0i]*)?\s*$|\bcat\s[^&|;]*(\.env\b|id_rsa|\.pem\b|secret)/.test(s)) {
    // Bare `env` / `printenv` DUMPS the environment — secret exposure. But
    // `env -u TOKEN cmd` / `env VAR=x cmd` is a launcher prefix (unsetting a
    // credential before a push is hygiene, not exposure) — classify those as
    // the underlying command instead (stripped below, F5 follow-up
    // 2026-08-06: the old `(env)(\s|$)` form scored `env -u GITHUB_TOKEN git
    // push` security/40, the mismatch swap lifted the heuristic to
    // security/80, and the first post-flip tag push hard-blocked at 100).
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
  // Interpreter one-liners are detected pre-split too: the quoted payload
  // legitimately contains `;` (`python -c "import shutil; shutil.rmtree(…)"`),
  // which the chain-splitter would sever from its interpreter (F2).
  if (INTERPRETER_DESTRUCTIVE_FULL_RE.test(command)) {
    return {
      derived_action_type: 'security', base_risk: 80, modifiers: [],
      reversible_hint: false, flags: ['destructive', 'interpreter_destructive'],
    };
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
