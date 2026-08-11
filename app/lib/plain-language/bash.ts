import { parseShell, type ShellStage } from './parse-shell';
import { type PlainDescription, unknownDescription } from './types';

export interface BashIntel {
  intent?: string;
  risk_score?: number;
  reversible?: boolean;
  validations?: Array<{ check?: string; reason?: string }>;
}

interface Clause {
  text: string;
  warnings: string[];
  ruleId: string;
}

const MAX_OPERAND = 80;

/**
 * The read-rule's reassurance. Named so it can be found and stripped from
 * the aggregate warnings when it is not the whole story — see describeBash.
 */
const READ_ONLY_WARNING = 'Reads only, changes nothing.';

/** Extracted values are bounded; the card renders them as data, not as prose. */
function noun(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_OPERAND ? `${flat.slice(0, MAX_OPERAND)}…` : flat;
}

function firstOperand(stage: ShellStage, fallback: string): string {
  const first = stage.operands[0];
  return first !== undefined ? noun(first) : fallback;
}

/**
 * True only when a token is purely a dash followed by letters, e.g. `-rf`.
 * A value-bearing token like `-oci.fast` must never be scanned letter by
 * letter, or the letter 'f' inside ".fast" reads as a force flag.
 */
function isBundledShortFlags(f: string): boolean {
  return /^-[a-zA-Z]+$/.test(f);
}

function hasFlag(stage: ShellStage, ...names: string[]): boolean {
  return stage.flags.some((f) => {
    if (names.includes(f)) return true;
    // A long flag can carry its value attached: --force-with-lease=refs/heads/main.
    if (names.some((n) => n.startsWith('--') && f.startsWith(`${n}=`))) return true;
    if (!isBundledShortFlags(f)) return false;
    return names.some((n) => {
      const ch = n[1];
      return n.length === 2 && ch !== undefined && f.includes(ch);
    });
  });
}

/**
 * parse-shell.ts has no notion of redirection, so `>`/`>>` survive
 * tokenisation as ordinary operand text — usually glued to its target with
 * no space (`>out.txt`, `>>/etc/passwd`), since splitting only happens on
 * whitespace. Matching on containment, not equality, catches every spacing
 * variant. A filename that legitimately contains '>' is vanishingly rare,
 * and reading it as a write is the safe direction to be wrong in.
 */
function hasRedirection(stage: ShellStage): boolean {
  return stage.operands.some((o) => o.includes('>'));
}

/** Returns null when the stage is not recognised. Null is a valid outcome. */
function describeStage(stage: ShellStage): Clause | null {
  const { binary, subcommand } = stage;

  if (binary === 'git' && subcommand === 'push') {
    if (hasFlag(stage, '--force', '--force-with-lease', '-f')) {
      return {
        text: 'Overwrites the shared code history on GitHub',
        warnings: ['Work other people pushed can be lost.'],
        ruleId: 'bash.git.push.force',
      };
    }
    return { text: 'Sends your code changes to GitHub', warnings: [], ruleId: 'bash.git.push' };
  }

  if (binary === 'rm') {
    const target = firstOperand(stage, 'a file');
    const recursive = hasFlag(stage, '-r', '-R', '--recursive');
    return {
      text: recursive
        ? `Deletes ${target} and everything inside it`
        : `Deletes ${target}`,
      warnings: ['Deleted files do not go to the Recycle Bin.'],
      ruleId: 'bash.rm',
    };
  }

  if (binary === 'curl' || binary === 'wget') {
    const url = firstOperand(stage, 'a website');
    return { text: `Downloads a file from ${url}`, warnings: [], ruleId: 'bash.download' };
  }

  if (binary === 'bash' || binary === 'sh' || binary === 'zsh') {
    // A -c payload is the actual command. Without reading it, "Runs a
    // script" would be a confident sentence about nothing.
    if (hasFlag(stage, '-c')) return null;
    return { text: 'Runs a script', warnings: [], ruleId: 'bash.interpreter' };
  }

  if ((binary === 'npm' || binary === 'pnpm' || binary === 'yarn') && (subcommand === 'install' || subcommand === 'i' || subcommand === 'add')) {
    const pkgOperand = stage.operands[0];
    const pkg = pkgOperand !== undefined ? noun(pkgOperand) : null;
    return {
      text: pkg
        ? `Adds a third-party package, ${pkg}, to your project`
        : "Installs the project's third-party packages",
      warnings: [],
      ruleId: 'bash.package.install',
    };
  }

  if (binary === 'psql' || binary === 'mysql') {
    const sql = stage.operands.join(' ').toUpperCase();
    if (sql.includes('DROP TABLE')) {
      return { text: 'Permanently deletes a table from your database', warnings: ['This cannot be undone.'], ruleId: 'bash.sql.drop' };
    }
    if (sql.includes('DELETE FROM')) {
      return { text: 'Deletes rows from your database', warnings: ['This cannot be undone.'], ruleId: 'bash.sql.delete' };
    }
    return { text: 'Runs a command against your database', warnings: [], ruleId: 'bash.sql' };
  }

  if (['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'which', 'echo', 'grep'].includes(binary)) {
    // A redirected stage writes a file; it must not take the calm read rule.
    // `find` is deliberately absent — it takes -delete and -exec, so it is
    // not read-only and we cannot cheaply prove otherwise. It falls through
    // to the unrecognised return below.
    if (hasRedirection(stage)) return null;
    return { text: 'Reads information from your computer', warnings: [READ_ONLY_WARNING], ruleId: 'bash.read' };
  }

  return null;
}

/**
 * curl|bash is materially different from either half: the operator never
 * sees the code that runs. `curlStage` is the matched curl/wget stage
 * itself, never `stages[0]` — the source noun must name what was actually
 * downloaded, not whatever happened to run first in the pipeline.
 */
function describePipeToShell(curlStage: ShellStage): Clause {
  const source = firstOperand(curlStage, 'a website');
  return {
    text: `Downloads a script from ${source} and runs it straight away, without showing it to you`,
    warnings: ['Whoever controls that website chooses what runs.'],
    ruleId: 'bash.pipe-to-shell',
  };
}

/**
 * Walks every stage once, in order. A curl/wget stage immediately followed
 * by a shell stage is consumed as one pair and produces a single combined
 * clause; every other stage is described on its own. This keeps every stage
 * accounted for — no short-circuit ever discards the rest of the pipeline
 * the way a pre-check over the whole command would.
 *
 * `stagesUnderstood` counts input stages, not output clauses (a pair counts
 * as two), so completeness stays a true count of the whole command.
 */
function describeStages(stages: ShellStage[]): { clauses: Clause[]; complete: boolean } {
  const clauses: Clause[] = [];
  let stagesUnderstood = 0;
  let i = 0;
  while (i < stages.length) {
    const stage = stages[i];
    if (!stage) break;
    const next = stages[i + 1];
    if ((stage.binary === 'curl' || stage.binary === 'wget') && next && ['bash', 'sh', 'zsh'].includes(next.binary)) {
      clauses.push(describePipeToShell(stage));
      stagesUnderstood += 2;
      i += 2;
      continue;
    }
    const clause = describeStage(stage);
    if (clause) {
      clauses.push(clause);
      stagesUnderstood += 1;
    }
    i += 1;
  }
  return { clauses, complete: stagesUnderstood === stages.length };
}

export function describeBash(command: string, bashIntel?: BashIntel): PlainDescription {
  const stages = parseShell(command);
  if (stages.length === 0) return unknownDescription('bash.empty');

  // The classifier is the only source of reversibility. Absent means unknown,
  // never true — a missing signal must not read as reassurance.
  const reversible: boolean | 'unknown' =
    typeof bashIntel?.reversible === 'boolean' ? bashIntel.reversible : 'unknown';

  const { clauses: known, complete } = describeStages(stages);
  if (known.length === 0) return unknownDescription('bash.unrecognised');

  // A mixed pipeline is not calm even if its first stage is; only a single
  // fully-recognised read stays on the calm rule id. Reused below: the
  // read-only reassurance is honest only under this same condition.
  const soleClause = known.length === 1 ? known[0] : undefined;

  const text = known.map((c) => c.text).join(', then ');
  const warnings = [...new Set(known.flatMap((c) => c.warnings))]
    // "Reads only, changes nothing." is true of the whole command only when
    // it IS the whole command. Next to another clause's warning it reads
    // calmest-first on a pipeline that may not be calm at all — worse than
    // no warning, because it is the one the operator reads first.
    .filter((w) => soleClause !== undefined || w !== READ_ONLY_WARNING);

  if (!complete) {
    warnings.unshift("There is more in this command that I can't read. Check it below before approving.");
  }

  const ruleId = complete && soleClause ? soleClause.ruleId : complete ? 'bash.sequence' : 'bash.partial';

  return {
    headline: complete ? `${text}.` : `${text}. There is more here I can't read.`,
    warnings,
    confidence: complete ? 'high' : 'partial',
    reversible,
    ruleId,
  };
}
