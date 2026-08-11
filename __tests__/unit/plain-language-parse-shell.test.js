import { describe, it, expect } from 'vitest';
import { parseShell } from '@/lib/plain-language/parse-shell';

describe('parseShell', () => {
  it('splits a simple command into binary, flags and operands', () => {
    const [stage] = parseShell('rm -rf build/');
    expect(stage.binary).toBe('rm');
    expect(stage.flags).toEqual(['-rf']);
    expect(stage.operands).toEqual(['build/']);
  });

  it('captures a git subcommand', () => {
    const [stage] = parseShell('git push --force origin main');
    expect(stage.binary).toBe('git');
    expect(stage.subcommand).toBe('push');
    expect(stage.flags).toEqual(['--force']);
    expect(stage.operands).toEqual(['origin', 'main']);
  });

  it('splits a pipeline into stages', () => {
    const stages = parseShell('curl -sL get.example.sh | bash');
    expect(stages).toHaveLength(2);
    expect(stages[0].binary).toBe('curl');
    expect(stages[1].binary).toBe('bash');
  });

  it('splits on && and ; as well as |', () => {
    expect(parseShell('cd /tmp && ls; echo done')).toHaveLength(3);
  });

  it('keeps a quoted argument as one operand', () => {
    const [stage] = parseShell(`psql -c 'DROP TABLE users'`);
    expect(stage.operands).toEqual(['DROP TABLE users']);
  });

  it('does not split on a separator inside quotes', () => {
    const stages = parseShell(`echo "a | b && c"`);
    expect(stages).toHaveLength(1);
    expect(stages[0].operands).toEqual(['a | b && c']);
  });

  it('returns an empty array for an empty command', () => {
    expect(parseShell('   ')).toEqual([]);
  });
});
