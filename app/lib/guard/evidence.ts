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
  /** Shell only: the local script the command executes, when the caller could
   *  read it. The command text `node buy.mjs x.com` names nothing; the script
   *  body is where the act lives (spend gap, 2026-09-04). */
  script?: { path?: unknown; content_excerpt?: unknown };
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

// A regenerable artifact root OR any path beneath one. Bare-name matching made
// a strict subset score higher than its superset: `rm -rf node_modules` graded
// cleanup/35 while `rm -rf node_modules/.cache` missed the allowlist and
// clamped to 100 (2026-08-11 calibration probe). Mirrors
// bash_classifier.py _is_regenerable_dir_name — the max() fold (risk.ts:193)
// takes the WORSE of the two labels, so the two must stay byte-equivalent.
// Absolute, home-relative, drive-qualified and `..`-traversing paths are
// rejected EXPLICITLY: requiring a bare name used to imply all four.
// Directories the OPERATING SYSTEM designates as scratch. Content strictly
// inside one is disposable by construction (the OS may clear it on reboot), so
// a recursive delete there is routine maintenance. Each entry starts and ends
// with '/', so a substring search already enforces path boundaries and
// '/nottmp/x' cannot match '/tmp/'. Mirrors _OS_SCRATCH_ROOTS in
// bash_classifier.py — max() takes the worse label, so both sides must agree.
const OS_SCRATCH_ROOTS = ['/tmp/', '/var/tmp/', '/private/tmp/', '/appdata/local/temp/'];

/**
 * A path STRICTLY INSIDE an OS scratch root. Something must remain after the
 * root, so `rm -rf /tmp` itself keeps the destructive grade, and `..` is
 * rejected outright or `/tmp/../etc` would inherit the scratch grade.
 *
 * Live evidence 2026-08-11: the frontend-verify skill's
 * `rm -rf <temp>/scratchpad/e2e-out` graded security/100 and was hand-approved
 * four times in one evening from a phone.
 */
function isOsScratchTarget(target: string): boolean {
  const t = target.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!t || t.split('/').includes('..')) return false;
  let low = t.toLowerCase();
  // Only an ABSOLUTE path can be OS scratch; a project-relative `tmp/build` is
  // ordinary repo content and keeps the destructive grade.
  if (!low.startsWith('/')) {
    if (!/^[a-z]:\//.test(low)) return false;
    low = `/${low}`;
  }
  return OS_SCRATCH_ROOTS.some((root) => {
    const idx = low.indexOf(root);
    return idx !== -1 && low.length > idx + root.length;
  });
}

function isRegenerableArtifactTarget(target: string): boolean {
  if (/[*?[]/.test(target)) return false;
  // OS scratch roots are the one absolute-path exception, and safe for the same
  // reason the named dirs are. Checked first: the guards below reject absolutes.
  if (isOsScratchTarget(target)) return true;
  let t = target.replace(/\\/g, '/').replace(/\/+$/, '');
  if (t.startsWith('./')) t = t.slice(2);
  if (!t || t.startsWith('/') || t.startsWith('~') || /^[a-z]:/i.test(t)) return false;
  const parts = t.toLowerCase().split('/');
  if (parts.includes('..')) return false;
  return REGENERABLE_ARTIFACT_DIRS.has(parts[0] ?? '');
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

// ── inert git-message exemption (2026-08-08 false-positive class) ────────────
// The hook forwards the raw command as the shell act, so a git COMMIT/TAG
// message describing a destructive-command fix ("fix the rm -rf policy",
// "curl … | sh is the remote-exec pattern") was scanned as if it were the
// command and hard-blocked the commit at risk 100. git never executes its
// commit/tag/stash/notes message as shell — it is inert data. The exemption
// is deliberately narrow: it fires only when the command's EXECUTABLE skeleton
// (quoted data blanked, command substitution preserved — see codeSkeleton) is
// a lone git message verb with no shell operator and no substitution. So
// `git commit … && rm -rf /` (operator survives), `git commit -m "$(rm -rf /)"`
// (substitution survives), and `git commit … | sh` all fall through to normal
// scanning. Matches shell quoting semantics: single-quoted `$(…)` does NOT
// substitute, double-quoted `$(…)`/backticks do.
// Backtracking-safe on hostile input (CodeQL 140/141/139/143): the /i flag
// already folds -C into -c, and `--\S+` already matches `--opt=value`, so the
// redundant alternatives that made `git --aaa…` backtrack are gone. The two
// branches are prefix-disjoint and \S/\s never overlap, so matching is linear.
const GIT_MESSAGE_VERB_RE = /^\s*git\s+(?:(?:-c\s+\S+|--\S+)\s+)*(?:commit|tag|stash|notes)\b/i;

// Prefixes that are transparent to the command word: env assignments, launcher
// wrappers and their flags. `sudo -u root "rm" -rf /` puts the quoted command
// word two tokens in, so "first token of the segment" is too narrow a test.
// `rtk` is here because it is installed as a PreToolUse hook that rewrites EVERY
// Bash command to `rtk <cmd>` — without it, `rtk "rm" -rf /` blanks the quoted
// command word as data and hides it from this scanner on any machine running it.
// ponytail: the `rtk proxy <cmd>` form still shadows a quoted command word here
// (this regex tests one token at a time and cannot express "proxy only after
// rtk"). The intent classifier in hooks/ unwraps `proxy` correctly, so that form
// is still graded; only this secondary quoted-word scan misses it.
const TRANSPARENT_PREFIX_RE =
  /^(?:[a-z_]\w*=\S*|sudo|env|nohup|nice|ionice|time|timeout|command|builtin|rtk|-\S*|\d+(?:\.\d+)?[smhd]?)$/i;

/**
 * True when the next token starts in COMMAND-WORD position for its segment —
 * everything before it in the segment is whitespace, an env assignment, or a
 * launcher wrapper. Reads the skeleton built so far, in which argument quotes
 * are already blanked, so its token boundaries are the executable ones.
 */
function isCommandWordPosition(skeletonSoFar: string): boolean {
  const tail = skeletonSoFar.split(/[|&;\n\r(]/).pop() ?? '';
  const tokens = tail.split(/\s+/).filter(Boolean);
  // A tail not ending in whitespace means the quote CONTINUES the last token
  // (`r"m" -rf /`), so that token is the one being formed — not a predecessor.
  const preceding = /\s$/.test(tail) || !tail ? tokens : tokens.slice(0, -1);
  return preceding.every((t) => TRANSPARENT_PREFIX_RE.test(t));
}

/**
 * Executable skeleton of a shell command: the content of quoted string literals
 * is blanked to spaces (it is data, not code) while command substitution
 * (`$(…)` and backticks) inside double quotes is preserved verbatim, because a
 * shell executes it regardless of the surrounding quotes. Single-quoted spans
 * are blanked entirely (no substitution happens inside them). Used only to
 * decide the inert-git-message exemption — never to replace the pattern checks
 * themselves, which still run against the original command.
 *
 * One exception (2026-08-11 adversarial review): a quoted span in COMMAND-WORD
 * position is code, not data. `"rm" -rf /` is legal shell and still deletes the
 * filesystem, but blanking it left `-rf /` behind, no pattern family matched,
 * and the segment fell through to other/30. Only ARGUMENTS are inert.
 */
function codeSkeleton(command: string): string {
  let out = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null;
      out += ' ';
      continue;
    }
    if (quote === '"') {
      if (ch === '\\') { out += '  '; i++; continue; } // escaped char: drop both
      if (ch === '`') { out += '`'; continue; }        // backtick substitution executes
      if (ch === '$' && command[i + 1] === '(') {       // $(…) substitution executes
        let depth = 0;
        while (i < command.length) {
          const c = command[i] as string;
          if (c === '(') depth++;
          else if (c === ')') { depth--; out += c; i++; if (depth === 0) break; continue; }
          out += c;
          i++;
        }
        i--;
        continue;
      }
      if (ch === '"') quote = null;
      out += ' ';
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (isCommandWordPosition(out)) {
        const close = command.indexOf(ch, i + 1);
        const end = close === -1 ? command.length : close;
        out += ` ${command.slice(i + 1, end)}${close === -1 ? '' : ' '}`;
        i = end;
        continue;
      }
      quote = ch; out += ' '; continue;
    }
    out += ch;
  }
  return out;
}

function isInertGitMessageCommand(command: string): boolean {
  const skel = codeSkeleton(command);
  if (!GIT_MESSAGE_VERB_RE.test(skel)) return false;
  // Any surviving shell operator or substitution in the executable skeleton
  // means a second command could run — disqualify and let normal scanning grade
  // it (the rm/curl segment or the substitution payload). A NEWLINE is such an
  // operator and was missing here: the pretool hook forwards multi-line Bash
  // verbatim, so `git commit -m "wip"\nrm -rf ~` graded git_message/35
  // (2026-08-11 adversarial review). Testing the SKELETON is what keeps a
  // multi-line commit MESSAGE inert — its newlines are blanked with the quote.
  return !/[|&;\n\r]|\$\(|`/.test(skel);
}

/**
 * Segment-level inert-git test. Chain-splitting already removed the shell
 * operators, so a git message verb reaches here as its own segment — which is
 * the real-world shape (`cd <repo> && git commit -m "…"`, the only way the
 * Bash tool issues a commit). Still reject a segment carrying command
 * substitution: `git commit -m "$(rm -rf /)"` splits to a single segment (no
 * bare operator) whose `$(…)` genuinely executes, so it must fall through to
 * the destructive scan. Uses the raw segment (not codeSkeleton) because the
 * split already stripped operators; the substitution guard is what matters.
 */
function isInertGitMessageSegment(seg: string): boolean {
  // Newline is in the guard as well as the splitter: if a later edit narrows the
  // split, a segment carrying `\n<destructive>` must not be exempted silently.
  if (/[\n\r]|\$\(|`/.test(seg)) return false;
  return GIT_MESSAGE_VERB_RE.test(seg);
}

// ── quoted data is inert (2026-08-08, generalizes the git-message exemption) ─
// The false-positive class the git exemption fixed narrowly exists for ANY
// quoted string argument: `gh release --notes "…rm -rf…"`, `echo "curl … | sh"`,
// PR bodies. Quoted data can only become code through an exec sink — a shell or
// interpreter that evaluates a string/stdin (`sh -c`, `eval`, `ssh host "…"`,
// `python -c`, a pipe into `sh`) or command substitution. So: when the
// command's executable skeleton contains NO sink word and no substitution, the
// command-word pattern families scan the SKELETON (quoted prose is invisible);
// when ANY sink is present, everything scans the raw string exactly as before.
// Deliberately conservative — a sink word anywhere disables the relaxation for
// the whole command, because pipes and quotes move data across segments. The
// word list errs broad (`exec`, `su`, `cmd`): a false sink only means the old
// raw-scan behavior, never a missed catch.
const EXEC_SINK_RE =
  /(^|[\s|&;(/])(sh|bash|zsh|ksh|dash|fish|csh|tcsh|pwsh|powershell|cmd|eval|exec|source|ssh|su|xargs|python[0-9]?|node(?:js)?|ruby|perl|php|deno|bun|tsx|ts-node)\b/i;

function hasExecSink(skeleton: string): boolean {
  return EXEC_SINK_RE.test(skeleton) || /\$\(|`/.test(skeleton);
}

// ── shell ──────────────────────────────────────────────────────────────────

const ENV_LAUNCHER_PREFIX_RE = /^\s*env((\s+-u\s+\S+)|(\s+-[i0]\b)|(\s+\w+=\S*))*\s+(?=\S)/;

// ── database acts (RFC 2026-09-04-database-containment) ─────────────────────
// A shell act whose command slot is a Postgres client, or whose executable
// text carries a connection-string literal, mutates a DATABASE — an effect
// class the shell families above never named. Today `psql -c "DROP TABLE
// users"` grades other/30 with no flags; this branch grades the SQL it
// actually runs. It NEVER sets `protected_target` (the default packs'
// mass-destructive line keys on that flag, 2026-08-21), so honest grading here
// does not change a fresh install's hold behavior — it only makes the act
// legible, which is what `db_branch` containment eligibility reads.
const DB_URL_LITERAL_RE = /\bpostgres(?:ql)?:\/\//i;
// Package runners that are transparent to the real command word.
const PKG_RUNNER_RE = /^(npx|bunx|pnpm|yarn|npm)$/i;
const PKG_RUNNER_NOISE_RE = /^(dlx|exec|run|-y|--yes|--silent|-s)$/i;
// Clients whose every invocation talks to a database.
const DB_CLIENT_RE = /^(?:\S*[/\\])?(psql|pg_restore)(?:\.exe)?$/i;
// Migration toolchains: only the subcommands that WRITE (RFC list).
const DB_MIGRATION_TOOLS: Record<string, RegExp> = {
  prisma: /^(db\s+(push|execute)|migrate\s+(deploy|dev|reset))\b/i,
  'drizzle-kit': /^(push|migrate|drop)\b/i,
};

/** Tokens of a segment from its command slot on (env assignments and launcher
 *  wrappers skipped — mirrors TRANSPARENT_PREFIX_RE / isCommandWordPosition). */
function commandSlotTokens(segment: string): string[] {
  const tokens = segment.trim().split(/\s+/).map((t) => t.replace(/^["']|["']$/g, '')).filter(Boolean);
  let i = 0;
  while (i < tokens.length && TRANSPARENT_PREFIX_RE.test(tokens[i] as string)) i++;
  // `npx prisma migrate deploy` / `pnpm dlx drizzle-kit push`: the runner and
  // its own flags are transparent to the tool being run.
  while (i < tokens.length && PKG_RUNNER_RE.test(tokens[i] as string)) {
    i++;
    while (i < tokens.length && PKG_RUNNER_NOISE_RE.test(tokens[i] as string)) i++;
  }
  return tokens.slice(i);
}

/** True when this segment's command slot targets a database. Reads the scan
 *  text (the executable skeleton when the command is sink-free), so a quoted
 *  connection string in prose is data, exactly like every other family here. */
function isDatabaseSegment(scanText: string): boolean {
  if (DB_URL_LITERAL_RE.test(scanText)) return true;
  const tokens = commandSlotTokens(scanText);
  const cmd = tokens[0];
  if (!cmd) return false;
  if (DB_CLIENT_RE.test(cmd)) return true;
  const tool = cmd.replace(/^\S*[/\\]/, '').replace(/\.exe$/i, '').toLowerCase();
  const subcommands = DB_MIGRATION_TOOLS[tool];
  return subcommands ? subcommands.test(tokens.slice(1).join(' ')) : false;
}

/** Inline SQL a database client carries: `-c "…"` / `--command=…`. `-f file`
 *  is NOT inline (the statements live in a file the server never sees). Read
 *  from the RAW segment — an argument's quoted content names what runs. */
function inlineSqlOf(segment: string): string | null {
  const m = /(?:^|\s)(?:-c|--command)(?:\s+|=)(?:"([^"]*)"|'([^']*)'|(\S+))/i.exec(segment);
  if (!m) return null;
  const sql = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  return sql || null;
}

/** The grade for a database act: its inline SQL when there is one (graded by
 *  the existing SQL classifier, flags and modifiers included), otherwise the
 *  migrate default the RFC fixes for `-f file.sql`, pg_restore and migration
 *  tools whose statements the server never sees. */
function databaseActClassification(inlineSql: string | null): EvidenceClassification {
  if (inlineSql) {
    const sqlCls = classifySql({ statement: inlineSql });
    return {
      derived_action_type: sqlCls.derived_action_type,
      base_risk: sqlCls.base_risk,
      modifiers: sqlCls.modifiers,
      reversible_hint: sqlCls.reversible_hint,
      flags: ['database', ...sqlCls.flags],
    };
  }
  return { derived_action_type: 'migrate', base_risk: 60, modifiers: [], reversible_hint: false, flags: ['database'] };
}

// A heredoc-fed client (`psql … <<'SQL' … SQL`) loses its body to the
// chain-splitter below (it splits on newlines), so the body is graded
// pre-split and folded into the segment result by the same max() rule.
const DB_HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2\b/;

function databaseHeredocClassification(command: string): EvidenceClassification | null {
  const m = DB_HEREDOC_RE.exec(command);
  if (!m) return null;
  if (!isDatabaseSegment(command.slice(0, m.index))) return null;
  const body = (m[3] ?? '').trim();
  return body ? databaseActClassification(body) : null;
}

// ── spend (real money) ──────────────────────────────────────────────────────
// 2026-09-04: an agent bought two domains from `node domain-buy.mjs <name>`
// inside a governed Bash call. The command text carried no money signal, so it
// graded other/30 and ran, and the org's spend line (action_type `spend`)
// never saw a spend. Money leaving an account unattended is the class the
// human wants to see, so a purchase endpoint or a purchase CLI grades `spend`
// and the declared/derived type swap lets the spend policies fire. Reads that
// merely price or check a domain stay out: a lookup is not a purchase.
const SPEND_URL_PATH_RE = new RegExp(
  [
    // Registrar buys (Vercel, Cloudflare, GoDaddy shapes) — lookups excluded below.
    String.raw`/registrar/`,
    String.raw`/domains/[^/\s"'?]+/(buy|transfer-in|renew)\b`,
    String.raw`/domains/(buy|purchase)\b`,
    // Card / checkout APIs (Stripe, PayPal shapes).
    String.raw`/v1/(charges|payment_intents|checkout/sessions|subscriptions|setup_intents)\b`,
    String.raw`/invoices/[^/\s"'?]+/pay\b`,
    String.raw`/v[12]/(checkout/orders|payments)\b`,
  ].join('|'),
  'i',
);
// Generic purchase / credit top-up path segments. On their own these match
// any host — `git clone .../checkout` and `curl stripe.com/docs/checkout`
// are not purchases — so a hit only counts when the URL also looks like an
// API or a payment surface: an /api/ or /v<digits>/ segment ahead of the
// purchase segment, or a hostname whose first label names one.
const SPEND_GENERIC_URL_PATH_RE = /\/(purchase|purchases|checkout|top-?up|buy[-_]credits|credits\/(buy|purchase))\b/i;
const SPEND_GENERIC_API_SHAPE_RE = /\/(api|v\d+)\//i;
const SPEND_GENERIC_HOST_RE = /^(api|checkout|pay|payments|billing|commerce|shop|store|secure)\./i;
const SPEND_LOOKUP_PATH_RE = /\/(availability|price|prices|status|quote)\b/i;
const SPEND_CLI_RE =
  /\bvercel\s+domains?\s+(buy|transfer-in)\b|\bstripe\s+(charges|payment_intents|subscriptions|checkout\s+sessions)\s+create\b|\bagentcash\s+pay\b|\bgcloud\s+billing\b|\baws\s+\S+\s+purchase-\S+|\bnamecheap\b[^&|;]*domains\.create\b/i;
const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

/** The purchase-endpoint reason for a URL, or null when it is not one. */
function spendUrlHit(url: string): string | null {
  let path = url;
  let hostname = '';
  try {
    const parsed = new URL(url);
    path = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    path = url.replace(/^[a-z]+:\/\/[^/]*/i, '').split(/[?#]/)[0] ?? '';
  }
  const specificHit = SPEND_URL_PATH_RE.test(path);
  const genericMatch = SPEND_GENERIC_URL_PATH_RE.exec(path);
  const genericHit =
    genericMatch !== null &&
    (SPEND_GENERIC_API_SHAPE_RE.test(path.slice(0, genericMatch.index + 1)) ||
      SPEND_GENERIC_HOST_RE.test(hostname));
  if (!specificHit && !genericHit) return null;
  if (SPEND_LOOKUP_PATH_RE.test(path)) return null;
  return `purchase endpoint ${path}`;
}

/** First purchase signal in free text (a shell segment or a script body). */
function spendHitInText(text: string): string | null {
  if (SPEND_CLI_RE.test(text)) return 'purchase CLI';
  for (const url of text.match(URL_IN_TEXT_RE) ?? []) {
    const hit = spendUrlHit(url);
    if (hit) return hit;
  }
  return null;
}

// Pure read / print commands: a URL they carry is data being shown, not a
// request being made (`echo https://…/buy` documents a purchase, `curl` makes
// one).
const READ_PRINT_CMD_RE = /^\s*(sudo\s+)?(cat|ls|head|tail|less|more|grep|rg|find|stat|pwd|whoami|echo|printf|which|wc|diff|file|type)\b/i;

// Interpreter-side APIs that delete files / trees — the script-body twin of
// INTERPRETER_DESTRUCTIVE_RE (that one needs an interpreter in the command).
const SCRIPT_DESTRUCTIVE_RE = /\b(shutil\.rmtree|os\.(remove|unlink|rmdir)|fs\.(rm|rmdir|unlink)(Sync)?\s*\(|rimraf|rm\s+-\S*r)/i;
const SCRIPT_SECRET_READ_RE = /(readFileSync|readFile|open|read_text)\s*\([^)]*(secrets?[\\/]|\.env\b|credential|private_key|id_rsa|token)/i;

/**
 * Grade the body of a locally executed script. The command that runs it names
 * only a path, so this is the only evidence of what will actually happen.
 * Null when the body carries nothing the classifier understands.
 */
function classifyScriptExcerpt(excerpt: string): EvidenceClassification | null {
  const flags: string[] = ['script_content'];
  const modifiers: EvidenceModifier[] = [];
  let base = 0;
  let action = 'other';
  let reversible: boolean | null = null;

  const spend = spendHitInText(excerpt);
  if (SCRIPT_DESTRUCTIVE_RE.test(excerpt)) {
    base = 80; action = 'security'; reversible = false; flags.push('destructive', 'interpreter_destructive');
  } else if (spend) {
    base = 75; action = 'spend'; reversible = false; flags.push('spend');
    modifiers.push({ reason: `script body: ${spend}`, delta: 0 });
  } else if (DB_URL_LITERAL_RE.test(excerpt)) {
    base = 60; action = 'migrate'; reversible = false; flags.push('database');
  }
  if (SCRIPT_SECRET_READ_RE.test(excerpt)) {
    modifiers.push({ reason: 'script reads a secret / credential file', delta: 15 });
    flags.push('sensitive_path');
    if (base === 0) { base = 30; }
  }
  if (base === 0) return null;
  return { derived_action_type: action, base_risk: base, modifiers, reversible_hint: reversible, flags };
}

function classifyShellSegment(seg: string, rawScan: boolean): EvidenceClassification {
  // `env` as a launcher prefix (`env -u TOKEN cmd`, `env VAR=x cmd`) is
  // transparent — classify the command it runs. A BARE `env` (nothing after
  // the flags) is left intact for the secret-exposure branch below: that form
  // dumps the environment.
  // A git commit/tag/stash/notes segment carries an inert message git never
  // executes — don't let its body trip the destructive scan below (this is the
  // `cd <repo> && git commit -m "…"` shape after chain-split).
  if (isInertGitMessageSegment(seg)) {
    return { derived_action_type: 'apply', base_risk: 35, modifiers: [], reversible_hint: true, flags: ['git_message'] };
  }

  const s = seg.toLowerCase().replace(ENV_LAUNCHER_PREFIX_RE, '');
  // Command-word patterns scan the executable skeleton when the whole command
  // is sink-free (quoted prose is data); argument-content checks (delete
  // targets, sensitive paths, secret reads) always read the raw text — a quoted
  // ARGUMENT to a real command still names what the command touches.
  const scan = rawScan ? s : codeSkeleton(seg).toLowerCase().replace(ENV_LAUNCHER_PREFIX_RE, '');
  const flags: string[] = [];
  const modifiers: EvidenceModifier[] = [];
  let base = 30;
  let action = 'other';
  let reversible: boolean | null = null;

  const isSudo = /^\s*sudo\b/.test(s);

  const deviceWrite = DEVICE_WRITE_RE.test(scan);
  // `dd` only in command position: the bare `\bdd\b` form graded every
  // `yyyy-MM-dd` date-format string destructive (OpenClaw's read-only startup
  // `Get-Content SOUL.md; $d.ToString('yyyy-MM-dd')` held for approval,
  // 2026-08-21). Segments are chain-split above, so start-of-segment (after an
  // optional sudo) is the command slot — mirrors bash_classifier.py's
  // token-based `base == "dd"`.
  if (RM_RECURSIVE_RE.test(scan) || /\bshred\b|\bmkfs(\.|\b)|^\s*(sudo\s+)?dd\s|\btruncate\b/.test(scan)
      || FIND_DELETE_RE.test(scan) || INTERPRETER_DESTRUCTIVE_RE.test(scan) || deviceWrite) {
    base = 80; action = 'security'; reversible = false; flags.push('destructive');
    if (INTERPRETER_DESTRUCTIVE_RE.test(scan)) flags.push('interpreter_destructive');
    // Path-aware grading (F5) for the rm / Remove-Item and find -delete
    // classes only — shred / mkfs / dd / interpreter payloads never
    // de-escalate. Every target a bare regenerable artifact name → routine
    // cleanup; any catastrophic-root target → escalate so the evidence alone
    // reaches the block band regardless of soft declarations. A raw-device
    // write is always the catastrophic case: the "target" is the disk itself.
    if (deviceWrite) {
      modifiers.push({ reason: 'raw block device write target', delta: 20 });
      flags.push('device_write', 'protected_target');
    } else if (/\bmkfs(\.|\b)/.test(scan)) {
      // Formatting a filesystem IS a raw device write: same modifier and the
      // same flags as the dd/redirect branch. `protected_target` is what the
      // default packs' mass-destructive line keys on (rules.only_evidence_flags)
      // and the +20 is what lifts it to the line's threshold — with the flag
      // alone mkfs graded 90 on the live guard and ran unheld (2026-08-21).
      modifiers.push({ reason: 'filesystem format (raw device write)', delta: 20 });
      flags.push('device_write', 'protected_target');
    } else if (RM_RECURSIVE_RE.test(scan)) {
      const targets = rmDeleteTargets(s);
      if (targets.length > 0 && targets.every(isRegenerableArtifactTarget)) {
        base = 45; action = 'cleanup'; flags.push('regenerable_artifact');
      } else if (targets.some(isProtectedRootTarget)) {
        modifiers.push({ reason: 'protected root/home/system delete target', delta: 20 });
        flags.push('protected_target');
      }
    } else if (FIND_DELETE_RE.test(scan)) {
      const roots = findRootTargets(s);
      if (roots.length > 0 && roots.every(isRegenerableArtifactTarget)) {
        base = 45; action = 'cleanup'; flags.push('regenerable_artifact');
      } else if (roots.some(isProtectedRootTarget)) {
        modifiers.push({ reason: 'protected root/home/system delete target', delta: 20 });
        flags.push('protected_target');
      }
    }
  } else if (SPEND_CLI_RE.test(scan) || (!READ_PRINT_CMD_RE.test(s) && spendHitInText(s))) {
    // Argument-content check on the raw text: a quoted URL handed to curl is
    // still the request curl makes. Command-position CLIs read the skeleton.
    const hit = SPEND_CLI_RE.test(scan) ? 'purchase CLI' : spendHitInText(s);
    base = 75; action = 'spend'; reversible = false; flags.push('spend');
    modifiers.push({ reason: `real-money spend: ${hit}`, delta: 0 });
  } else if (/\bgit\s+push\b[^&|;]*(--force\b|--force-with-lease\b|(^|\s)-f\b)|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-\S*f/.test(scan)) {
    base = 70; action = 'security'; reversible = false; flags.push('vcs_dangerous');
  } else if (/\bvercel\b[^&|;]*--prod|\bkubectl\s+apply\b|\bterraform\s+(apply|destroy)\b/.test(scan)) {
    base = 75; action = 'deploy'; flags.push('deploy');
  } else if (/\b(npm|pnpm|yarn)\s+(i\b|install\b|add\b)|\bpip3?\s+install\b|\bpipx\s+install\b|\b(gem|cargo|go|brew|apt|apt-get|dnf|yum)\s+install\b/.test(scan)) {
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
  } else if (isDatabaseSegment(scan)) {
    // Database act (RFC 2026-09-04): graded by the SQL it carries, or as a
    // migration when the statements live in a file the server never sees.
    const db = databaseActClassification(inlineSqlOf(seg));
    base = db.base_risk; action = db.derived_action_type; reversible = db.reversible_hint;
    modifiers.push(...db.modifiers);
    flags.push(...db.flags);
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

function classifyShell(command: string, script?: ActInput['script']): EvidenceClassification {
  // Inert git message command (commit/tag/stash/notes): the message is data
  // git never executes, so a dangerous-looking message must not trip the
  // destructive / remote-exec patterns below. Short-circuit before any of them.
  if (isInertGitMessageCommand(command)) {
    return { derived_action_type: 'apply', base_risk: 35, modifiers: [], reversible_hint: true, flags: ['git_message'] };
  }
  const commandGrade = classifyShellCommand(command);
  // The executed script's body is graded like the inline command would be and
  // folded by the same max() rule: `node buy.mjs` is other/30 by its text and
  // spend/75 by what it runs.
  const excerpt = script && typeof script.content_excerpt === 'string' ? script.content_excerpt : '';
  const scriptGrade = excerpt.trim() ? classifyScriptExcerpt(excerpt) : null;
  if (scriptGrade && evidenceTotal(scriptGrade) > evidenceTotal(commandGrade)) return scriptGrade;
  return commandGrade;
}

function classifyShellCommand(command: string): EvidenceClassification {
  // Pipe-to-shell is destroyed by chain-splitting, so detect it on the whole
  // command first: `curl … | sh` / `wget … | bash` executes remote code.
  // Exemption (2026-08-07 false-positive class): piping fetched bytes into an
  // INLINE interpreter script (`curl … | python -c "…"`, `… | node -e "…"`)
  // feeds them to the script as stdin DATA — jq-style processing, not remote
  // execution — so it falls through to segment classification (a destructive
  // inline payload still grades 80 via INTERPRETER_DESTRUCTIVE_FULL_RE
  // below). Shells always execute stdin, a bare interpreter or `python -`
  // executes stdin, and an inline payload that re-executes stdin
  // (`exec(`/`eval(`) keeps the remote_exec grade — all of those stay 70.
  // Quote-awareness (2026-08-08): when the executable skeleton carries no exec
  // sink, quoted spans are provably inert data — scan the skeleton here and in
  // the segments below. Any sink present → raw scanning, the old behavior. A
  // REAL pipe-to-shell always has its pipe and interpreter in code position,
  // so a sink-free skeleton (pipe only inside quotes) cannot be one.
  const skeleton = codeSkeleton(command);
  const rawScan = hasExecSink(skeleton);
  const pipeToInterp = /\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|python[0-9]?|node(?:js)?)\b\s*(\S*)/i.exec(rawScan ? command : skeleton);
  if (pipeToInterp) {
    const interp = (pipeToInterp[3] || '').toLowerCase();
    const firstArg = pipeToInterp[4] || '';
    const inlineDataPipe =
      !/^(sh|bash|zsh)$/.test(interp) &&
      /^(-c|-e|-p|--eval|--print)$/.test(firstArg) &&
      !/\b(exec|eval)\s*\(/i.test(command);
    if (!inlineDataPipe) {
      return { derived_action_type: 'security', base_risk: 70, modifiers: [], reversible_hint: false, flags: ['remote_exec'] };
    }
  }
  // Interpreter one-liners are detected pre-split too: the quoted payload
  // legitimately contains `;` (`python -c "import shutil; shutil.rmtree(…)"`),
  // which the chain-splitter would sever from its interpreter (F2). Gated on
  // rawScan: an interpreter must actually appear in code position — a QUOTED
  // "python … shutil.rmtree" mention is prose, not an invocation.
  if (rawScan && INTERPRETER_DESTRUCTIVE_FULL_RE.test(command)) {
    return {
      derived_action_type: 'security', base_risk: 80, modifiers: [],
      reversible_hint: false, flags: ['destructive', 'interpreter_destructive'],
    };
  }
  // Chain-split on &&, ;, ||, | and newline, classifying the highest-risk
  // segment. A newline separates sequential commands exactly as `;` does and
  // the hook forwards multi-line Bash verbatim, so leaving it out meant only
  // the first line of a multi-line command was ever graded (2026-08-11
  // adversarial review). Matches split_chain_texts in
  // hooks/dashclaw_agent_intel/command_parser.py, which added "\n" in the
  // round-2 evasion audit; `\r` covers CRLF.
  const segments = command.split(/&&|\|\||;|\||[\n\r]/).map((p) => p.trim()).filter(Boolean);
  const parts = segments.length ? segments : [command];
  const folded = parts.map((p) => classifyShellSegment(p, rawScan)).reduce((a, b) => (evidenceTotal(b) >= evidenceTotal(a) ? b : a));
  // A heredoc body fed to a database client was severed from its command word
  // by the split above — grade it here and fold it in the same way.
  const heredoc = databaseHeredocClassification(command);
  if (heredoc && evidenceTotal(heredoc) > evidenceTotal(folded)) return heredoc;
  return folded;
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
  const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  // A write to a purchase endpoint is real money (a GET to the same path is a
  // lookup and keeps the api grade).
  const spend = isRead ? null : spendUrlHit(url);
  if (spend) {
    modifiers.push({ reason: `real-money spend: ${spend}`, delta: 0 });
    flags.push('spend');
    return { derived_action_type: 'spend', base_risk: 75, modifiers, reversible_hint: false, flags };
  }
  return {
    derived_action_type: 'api',
    base_risk: base,
    modifiers,
    reversible_hint: isRead ? true : null,
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
      return typeof a.command === 'string' && a.command.trim()
        ? classifyShell(a.command, a.script && typeof a.script === 'object' ? a.script : undefined)
        : null;
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
