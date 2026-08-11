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
  });
});
