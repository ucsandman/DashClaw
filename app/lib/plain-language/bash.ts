import { parseShell, type ShellStage } from './parse-shell';
import { CALM_RULE_IDS, type PlainDescription, unknownDescription } from './types';

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

/** Code runs that the operator has not seen. Fixed phrases, never built from command text. */
const UNSEEN_CODE_WARNING = 'You are approving code that nobody has read.';
const UNSEEN_SCRIPT_WARNING = "I can't see what is inside that script.";

/**
 * The only characters a command may contain and still be called harmless.
 *
 * This is an ALLOW-list, deliberately, rather than a deny-list of dangerous
 * sequences. "Is this binary read-only?" cannot be answered from the binary's
 * name, because the SHELL EXPANDS THE ARGUMENTS BEFORE THE BINARY RUNS:
 * `echo $(rm -rf /)` is an rm wearing an echo costume, and so is every other
 * entry in the read list. No list of bad shapes stays complete against that,
 * so we enumerate what is permitted and refuse everything else.
 *
 * Permitted, and why none of them can start a subshell, a redirect, a glob,
 * or a second command:
 *   A-Z a-z 0-9  plain words
 *   space        separates words
 *   - _          flags and identifiers (-la, my_file)
 *   . /          paths (./src/app.ts)
 *   = , :        flag values, lists, host:port (--depth=1)
 *   ' "          quoting, which is inert once $ and ` are excluded, since
 *                command substitution needs one of those two
 *
 * Everything else is refused, including $ ( ) ` < > { } [ ] * ? ~ ! \ ; | &
 * and any newline, carriage return or tab. Excluded even though they look
 * harmless: ~ (home expansion), + % @ (no rule needs them) and # (starts a
 * comment, which hides the rest of the line). Erring narrow is the point —
 * a refused sentence costs an operator a careful read; a wrong one costs
 * them the thing the product exists to protect.
 *
 * Expressed as its complement so the test is exact: `$` in a JS regex also
 * matches before a trailing newline, which would let `'ls -la\n'` pass an
 * anchored allow-list.
 */
const NON_INERT_CHARACTER = /[^A-Za-z0-9 \-_./=,:'"]/;

function hasInertShape(text: string): boolean {
  return !NON_INERT_CHARACTER.test(text);
}

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
 * tokenisation as ordinary token text — usually glued to its target with no
 * space (`>out.txt`, `>>/etc/passwd`), since splitting only happens on
 * whitespace. Matching on containment, not equality, catches every spacing
 * variant. A filename that legitimately contains '>' is vanishingly rare,
 * and reading it as a write is the safe direction to be wrong in.
 *
 * Scans flags AND operands: parse-shell routes any token starting with '-'
 * into flags, so a redirect glued to a short flag (`ls -la>out.txt`) arrives
 * as one flag token and an operand-only scan never sees it.
 */
function hasRedirection(stage: ShellStage): boolean {
  return [...stage.flags, ...stage.operands].some((t) => t.includes('>'));
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
    const script = firstOperand(stage, '');
    return {
      // Naming the file is not the same as reading it: whatever is inside
      // runs with the operator's own authority, and nothing here shows it to
      // them. A bare interpreter with no script named is wider still.
      text: script ? `Runs the script ${script}` : 'Opens a shell that can run any command',
      warnings: [UNSEEN_SCRIPT_WARNING],
      ruleId: 'bash.interpreter',
    };
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
    // None of these mutates state through its own flags, but that is not the
    // question: the shell expands the arguments first, so only a boringly
    // shaped stage may claim to read. Anything else refuses rather than
    // reassures. See NON_INERT_CHARACTER.
    if (!hasInertShape(stage.raw)) return null;
    // Redundant against the shape gate above (a '>' is already refused), and
    // kept anyway as the narrower, independently correct guard: if the shape
    // gate is ever relaxed, redirection coverage must not vanish with it.
    if (hasRedirection(stage)) return null;
    // `find` is deliberately absent from the list — it takes -delete and
    // -exec, so it is not read-only and we cannot cheaply prove otherwise.
    return { text: 'Reads information from your computer', warnings: [READ_ONLY_WARNING], ruleId: 'bash.read' };
  }

  return null;
}

/**
 * True when this stage is a shell that takes its script from whatever is fed
 * into it: a bare `bash`, or an explicit `bash -s`. `bash deploy.sh` runs a
 * named file and `bash -c '...'` runs an inline payload, so neither of those
 * is fed by the step before it and neither may be paired with one.
 */
function readsScriptFromPipe(stage: ShellStage): boolean {
  if (!['bash', 'sh', 'zsh'].includes(stage.binary)) return false;
  if (hasFlag(stage, '-c')) return false;
  return stage.operands.length === 0 || hasFlag(stage, '-s');
}

/**
 * Piping into a shell is materially different from either half: the operator
 * never sees the code that runs. That hazard is identical whether the code
 * arrives from the network (`curl x.sh | bash`) or off the disk
 * (`cat payload.sh | bash`), so both get a sentence about running unseen
 * code and a warning — never a sentence that opens with the word "Reads".
 *
 * `source` is the stage feeding the shell, never `stages[0]`, so the sentence
 * names what actually runs rather than whatever happened to run first.
 *
 * Returns null unless the source stage's whole job is to emit bytes, because
 * a pair collapses two stages into ONE clause and drops the source's own
 * sentence and warnings. That is only truthful when the source's output IS
 * the script: a downloader, or the read family (`cat payload.sh`, `echo ...`).
 * For anything else — `rm -rf build/ ; bash` — pairing would delete the
 * deletion from the sentence, so the caller describes both stages separately
 * instead. An unrecognised source returns null for the same reason plus one
 * more: counting it as understood would inflate confidence to high.
 */
function describePipeToShell(source: ShellStage): Clause | null {
  if (source.binary === 'curl' || source.binary === 'wget') {
    const from = firstOperand(source, 'a website');
    return {
      text: `Downloads a script from ${from} and runs it straight away, without showing it to you`,
      warnings: ['Whoever controls that website chooses what runs.'],
      ruleId: 'bash.pipe-to-shell',
    };
  }
  if (describeStage(source)?.ruleId !== 'bash.read') return null;
  const from = firstOperand(source, '');
  return {
    text: from
      ? `Runs code from ${from} straight away, without showing it to you`
      : 'Runs code from the step before it, without showing it to you',
    warnings: [UNSEEN_CODE_WARNING],
    ruleId: 'bash.pipe-to-shell.local',
  };
}

/**
 * Walks every stage once, in order. A script-producing stage immediately
 * followed by a shell that reads its script from the pipe is consumed as one
 * pair and produces a single combined clause (see describePipeToShell for
 * which sources qualify and why the set is narrow); every other stage is
 * described on its own. This keeps every stage accounted for — no
 * short-circuit ever discards the rest of the pipeline the way a pre-check
 * over the whole command would.
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
    const paired = next && readsScriptFromPipe(next) ? describePipeToShell(stage) : null;
    if (paired) {
      clauses.push(paired);
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

  // A mixed OR incompletely-understood pipeline is never calm, even when the
  // one stage we did recognise is a read: "one clause was recognised" is not
  // "the whole command was understood". Folding `complete` into soleClause
  // keeps its two consumers below from drifting apart, as they did in round 3.
  const soleClause = complete && known.length === 1 ? known[0] : undefined;

  // The shape gate applied a second time, now to the WHOLE raw command rather
  // than to the one stage we described, so nothing outside that stage can
  // leave a reassurance standing.
  const inertShape = hasInertShape(command);

  // Sounding calm is a promise about the whole command, not about one stage.
  const calmEligible = soleClause !== undefined && inertShape;

  const text = known.map((c) => c.text).join(', then ');
  const warnings = [...new Set(known.flatMap((c) => c.warnings))]
    // "Reads only, changes nothing." is an unsupportable claim unless the
    // whole command was understood and IS that one read — otherwise it is
    // either reassurance about a stage we just admitted we can't read, or it
    // reads calmest-first next to a warning from a more dangerous clause.
    .filter((w) => calmEligible || w !== READ_ONLY_WARNING);

  if (!complete) {
    warnings.unshift("There is more in this command that I can't read. Check it below before approving.");
  }

  // calmEligible's condition with one exception: a rule id that was never
  // calm to begin with (bash.rm, bash.pipe-to-shell) promises the operator
  // nothing, so it keeps its own identity even when the shape gate closes
  // the calm path. Only a CALM_RULE_IDS member is suppressed by the shape.
  const ruleId =
    soleClause !== undefined && (inertShape || !CALM_RULE_IDS.has(soleClause.ruleId))
      ? soleClause.ruleId
      : complete
        ? 'bash.sequence'
        : 'bash.partial';

  return {
    headline: complete ? `${text}.` : `${text}. There is more here I can't read.`,
    warnings,
    confidence: complete ? 'high' : 'partial',
    reversible,
    ruleId,
  };
}
