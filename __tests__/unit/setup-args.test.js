import { describe, expect, it } from 'vitest';
import { parseSetupArgs } from '../../scripts/lib/setup-args.mjs';

describe('parseSetupArgs', () => {
  it('defaults to interactive', () => {
    expect(parseSetupArgs([])).toEqual({ yes: false, databaseUrl: null, json: false });
  });
  it('parses the non-interactive trio', () => {
    expect(parseSetupArgs(['--yes', '--database-url', 'postgresql://u:p@h:5433/db', '--json']))
      .toEqual({ yes: true, databaseUrl: 'postgresql://u:p@h:5433/db', json: true });
  });
  it('rejects a non-postgres database-url', () => {
    expect(() => parseSetupArgs(['--database-url', 'mysql://x'])).toThrow(/postgresql:\/\//);
  });
  it('throws when --database-url has no value (end of args)', () => {
    expect(() => parseSetupArgs(['--database-url'])).toThrow(/requires a value/);
  });
  it('throws when --database-url is given an empty string', () => {
    expect(() => parseSetupArgs(['--database-url', ''])).toThrow(/requires a value/);
  });
  it('is flag-order independent (--json before --yes)', () => {
    expect(parseSetupArgs(['--json', '--yes']))
      .toEqual({ yes: true, databaseUrl: null, json: true });
  });
  it('returns databaseUrl: null when only --yes --json passed', () => {
    expect(parseSetupArgs(['--yes', '--json'])).toMatchObject({ databaseUrl: null });
  });
});
